const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');
const { codeAtStep } = require('./totpHelper');

jest.setTimeout(30000);

// Démarre l'activation et renvoie le secret tel que l'utilisateur le voit (sans espaces)
async function startSetup(company) {
  const setup = await request(app).post('/2fa/setup').set('Authorization', `Bearer ${company.token}`);
  return setup.body.secret.replace(/\s/g, '');
}

async function activate(company, secret) {
  const res = await request(app)
    .post('/2fa/verify-setup')
    .set('Authorization', `Bearer ${company.token}`)
    .send({ code: codeAtStep(secret, 0) });
  expect(res.status).toBe(200);
}

async function loginWithCode(company, code) {
  const login = await request(app).post('/login').send({ email: company.email, password: company.password });
  return request(app).post('/login/verify-2fa').send({ pendingToken: login.body.pendingToken, code });
}

describe('2FA : secret chiffré en base', () => {
  test('Le secret stocké est chiffré (préfixe v1:) et ne contient pas le secret en clair', async () => {
    const company = await createCompanyWithManager('2FA-chiffre-base');
    const secret = await startSetup(company);

    const user = await prisma.user.findUnique({ where: { email: company.email } });
    expect(user.twoFactorSecret.startsWith('v1:')).toBe(true);
    expect(user.twoFactorSecret).not.toContain(secret);
  });

  test('Une connexion avec 2FA fonctionne avec un secret chiffré', async () => {
    const company = await createCompanyWithManager('2FA-chiffre-login');
    const secret = await startSetup(company);
    await activate(company, secret);

    const res = await loginWithCode(company, codeAtStep(secret, 1));
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  test("Un compte dont le secret est encore à l'ancien format (en clair) se connecte toujours", async () => {
    const company = await createCompanyWithManager('2FA-ancien-format');
    const secret = await startSetup(company);
    await activate(company, secret);

    // On remet le secret en clair, comme avant la conversion
    await prisma.user.update({ where: { email: company.email }, data: { twoFactorSecret: secret } });

    const res = await loginWithCode(company, codeAtStep(secret, 1));
    expect(res.status).toBe(200);
  });

  test('Avec une mauvaise clé, la connexion échoue proprement (500), sans fuite du secret', async () => {
    const company = await createCompanyWithManager('2FA-mauvaise-cle');
    const secret = await startSetup(company);
    await activate(company, secret);

    const originalKey = process.env.TWO_FACTOR_ENCRYPTION_KEY;
    try {
      process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
      const res = await loginWithCode(company, codeAtStep(secret, 1));
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain(secret);
    } finally {
      process.env.TWO_FACTOR_ENCRYPTION_KEY = originalKey;
    }
  });
});