const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');
const { codeAtStep } = require('./totpHelper');

jest.setTimeout(30000);

// Active le 2FA avec le code du créneau COURANT, comme le ferait le front
async function enable2FA(company) {
  const setup = await request(app).post('/2fa/setup').set('Authorization', `Bearer ${company.token}`);
  const secret = setup.body.secret.replace(/\s/g, '');
  const verify = await request(app)
    .post('/2fa/verify-setup')
    .set('Authorization', `Bearer ${company.token}`)
    .send({ code: codeAtStep(secret, 0) });
  if (verify.status !== 200) {
    throw new Error(`Activation 2FA échouée : ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return secret;
}

async function loginPending(company) {
  const res = await request(app).post('/login').send({ email: company.email, password: company.password });
  return res.body.pendingToken;
}

const verify = (pendingToken, code) =>
  request(app).post('/login/verify-2fa').send({ pendingToken, code });

describe('2FA : anti-rejeu des codes TOTP', () => {
  test('Un code déjà utilisé pour se connecter est refusé la deuxième fois', async () => {
    const company = await createCompanyWithManager('2FA-rejeu');
    const secret = await enable2FA(company);
    const code = codeAtStep(secret, 1);

    const first = await verify(await loginPending(company), code);
    expect(first.status).toBe(200);

    const replay = await verify(await loginPending(company), code);
    expect(replay.status).toBe(401);
    expect(replay.body.error).toMatch(/Code invalide/);
  });

  test('Un code plus ancien que le dernier utilisé est refusé, même dans la fenêtre de tolérance', async () => {
    const company = await createCompanyWithManager('2FA-ancien');
    const secret = await enable2FA(company);

    const ok = await verify(await loginPending(company), codeAtStep(secret, 1));
    expect(ok.status).toBe(200);

    const pending = await loginPending(company);
    expect((await verify(pending, codeAtStep(secret, 0))).status).toBe(401);
    expect((await verify(pending, codeAtStep(secret, -1))).status).toBe(401);
  });

  test("Le code qui a servi à activer le 2FA ne peut pas servir à la première connexion", async () => {
    const company = await createCompanyWithManager('2FA-code-activation');
    const secret = await enable2FA(company); // consomme le créneau courant

    const pending = await loginPending(company);
    expect((await verify(pending, codeAtStep(secret, 0))).status).toBe(401);
    expect((await verify(pending, codeAtStep(secret, 1))).status).toBe(200);
  });

  test('Deux requêtes simultanées avec le même code : une seule passe', async () => {
    const company = await createCompanyWithManager('2FA-simultane');
    const secret = await enable2FA(company);
    const pending = await loginPending(company);
    const code = codeAtStep(secret, 1);

    const [a, b] = await Promise.all([verify(pending, code), verify(pending, code)]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  test('Le dernier créneau accepté est enregistré en base', async () => {
    const company = await createCompanyWithManager('2FA-creneau-base');
    const secret = await enable2FA(company);

    const before = Math.floor(Date.now() / 30000) + 1;
    const res = await verify(await loginPending(company), codeAtStep(secret, 1));
    const after = Math.floor(Date.now() / 30000) + 1;
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: company.email } });
    expect(Number.isInteger(user.twoFactorLastStep)).toBe(true);
    expect(user.twoFactorLastStep).toBeGreaterThanOrEqual(before);
    expect(user.twoFactorLastStep).toBeLessThanOrEqual(after);
  });
});