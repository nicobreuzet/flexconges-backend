const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');

// Les tests de verrouillage font plusieurs comparaisons bcrypt : on laisse de la marge
jest.setTimeout(30000);

authenticator.options = { window: 1 };

// Active le 2FA pour un manager, comme le ferait le front, et renvoie secret + codes de récupération
async function enable2FA(company) {
  const setup = await request(app)
    .post('/2fa/setup')
    .set('Authorization', `Bearer ${company.token}`);
  const secret = setup.body.secret.replace(/\s/g, ''); // le serveur renvoie le secret avec des espaces

  const verify = await request(app)
    .post('/2fa/verify-setup')
    .set('Authorization', `Bearer ${company.token}`)
    .send({ code: authenticator.generate(secret) });
  if (verify.status !== 200) {
    throw new Error(`Activation 2FA échouée : ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return { secret, recoveryCodes: verify.body.recoveryCodes };
}

// Première étape de connexion quand le 2FA est actif : renvoie le jeton temporaire
async function loginPending(company) {
  const res = await request(app).post('/login').send({ email: company.email, password: company.password });
  return res.body.pendingToken;
}

// Un code volontairement faux (différent du code valide du moment)
function wrongCode(secret) {
  return authenticator.generate(secret) === '000000' ? '111111' : '000000';
}

describe('Authentification à deux facteurs (2FA)', () => {
  test('Activation : setup puis verify-setup avec un vrai code renvoie 8 codes de récupération', async () => {
    const company = await createCompanyWithManager('2FA-activation');

    const before = await request(app).get('/2fa/status').set('Authorization', `Bearer ${company.token}`);
    expect(before.body.enabled).toBe(false);

    const setup = await request(app).post('/2fa/setup').set('Authorization', `Bearer ${company.token}`);
    expect(setup.status).toBe(200);
    const secret = setup.body.secret.replace(/\s/g, '');

    // Un mauvais code n'active rien
    const bad = await request(app)
      .post('/2fa/verify-setup')
      .set('Authorization', `Bearer ${company.token}`)
      .send({ code: wrongCode(secret) });
    expect(bad.status).toBe(400);

    const good = await request(app)
      .post('/2fa/verify-setup')
      .set('Authorization', `Bearer ${company.token}`)
      .send({ code: authenticator.generate(secret) });
    expect(good.status).toBe(200);
    expect(good.body.recoveryCodes).toHaveLength(8);
    expect(good.body.recoveryCodes[0]).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);

    const after = await request(app).get('/2fa/status').set('Authorization', `Bearer ${company.token}`);
    expect(after.body.enabled).toBe(true);
  });

  test('Avec le 2FA actif, /login renvoie un jeton temporaire, pas un vrai jeton, et il est refusé partout', async () => {
    const company = await createCompanyWithManager('2FA-pending');
    await enable2FA(company);

    const res = await request(app).post('/login').send({ email: company.email, password: company.password });
    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(typeof res.body.pendingToken).toBe('string');
    expect(res.body.token).toBeUndefined();

    const me = await request(app).get('/me').set('Authorization', `Bearer ${res.body.pendingToken}`);
    expect(me.status).toBe(401);
  });

  test('verify-2fa : un bon code donne un vrai jeton qui fonctionne, un mauvais code est refusé', async () => {
    const company = await createCompanyWithManager('2FA-verify');
    const { secret } = await enable2FA(company);

    const pending = await loginPending(company);

    const bad = await request(app).post('/login/verify-2fa').send({ pendingToken: pending, code: wrongCode(secret) });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatch(/Code invalide/);

    const good = await request(app).post('/login/verify-2fa').send({ pendingToken: pending, code: authenticator.generate(secret) });
    expect(good.status).toBe(200);
    expect(typeof good.body.token).toBe('string');

    const me = await request(app).get('/me').set('Authorization', `Bearer ${good.body.token}`);
    expect(me.status).toBe(200);
  });

  test('Un jeton de connexion normal ne peut pas servir de jeton temporaire', async () => {
    const company = await createCompanyWithManager('2FA-fauxpending');
    const { secret } = await enable2FA(company);

    const res = await request(app)
      .post('/login/verify-2fa')
      .send({ pendingToken: company.token, code: authenticator.generate(secret) });
    expect(res.status).toBe(401);
  });

  test('Un code de récupération fonctionne une seule fois', async () => {
    const company = await createCompanyWithManager('2FA-recovery');
    const { recoveryCodes } = await enable2FA(company);

    const pending1 = await loginPending(company);
    const first = await request(app).post('/login/verify-2fa').send({ pendingToken: pending1, code: recoveryCodes[0] });
    expect(first.status).toBe(200);
    expect(typeof first.body.token).toBe('string');

    const pending2 = await loginPending(company);
    const second = await request(app).post('/login/verify-2fa').send({ pendingToken: pending2, code: recoveryCodes[0] });
    expect(second.status).toBe(401);

    // Un autre code de récupération, lui, est toujours valable
    const other = await request(app).post('/login/verify-2fa').send({ pendingToken: pending2, code: recoveryCodes[1] });
    expect(other.status).toBe(200);
  });

  test('Après 5 mauvais codes, le compte est verrouillé (429), même avec le bon code', async () => {
    const company = await createCompanyWithManager('2FA-lock');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);

    for (let i = 1; i <= 4; i++) {
      const r = await request(app).post('/login/verify-2fa').send({ pendingToken: pending, code: wrongCode(secret) });
      expect(r.status).toBe(401);
    }
    const fifth = await request(app).post('/login/verify-2fa').send({ pendingToken: pending, code: wrongCode(secret) });
    expect(fifth.status).toBe(429);

    // Verrouillé : même le bon code est refusé
    const locked = await request(app).post('/login/verify-2fa').send({ pendingToken: pending, code: authenticator.generate(secret) });
    expect(locked.status).toBe(429);

    // On simule la fin des 15 minutes : le bon code passe de nouveau
    await prisma.user.update({
      where: { email: company.email },
      data: { twoFactorLockedUntil: new Date(Date.now() - 1000) }
    });
    const unlocked = await request(app).post('/login/verify-2fa').send({ pendingToken: pending, code: authenticator.generate(secret) });
    expect(unlocked.status).toBe(200);
  });

  test('Un succès remet le compteur d\'échecs à zéro', async () => {
    const company = await createCompanyWithManager('2FA-reset-compteur');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);

    await request(app).post('/login/verify-2fa').send({ pendingToken: pending, code: wrongCode(secret) });
    await request(app).post('/login/verify-2fa').send({ pendingToken: pending, code: wrongCode(secret) });
    let user = await prisma.user.findUnique({ where: { email: company.email } });
    expect(user.twoFactorFailedAttempts).toBe(2);

    const ok = await request(app).post('/login/verify-2fa').send({ pendingToken: pending, code: authenticator.generate(secret) });
    expect(ok.status).toBe(200);
    user = await prisma.user.findUnique({ where: { email: company.email } });
    expect(user.twoFactorFailedAttempts).toBe(0);
  });

  test('/2fa/setup est refusé (409) quand le 2FA est déjà actif, et le secret n\'est pas modifié', async () => {
    const company = await createCompanyWithManager('2FA-setup-refuse');
    await enable2FA(company);
    const before = await prisma.user.findUnique({ where: { email: company.email } });

    const res = await request(app).post('/2fa/setup').set('Authorization', `Bearer ${company.token}`);
    expect(res.status).toBe(409);

    const after = await prisma.user.findUnique({ where: { email: company.email } });
    expect(after.twoFactorEnabled).toBe(true);
    expect(after.twoFactorSecret).toBe(before.twoFactorSecret);
  });

  test('/2fa/disable exige le mot de passe, puis /login redonne un jeton direct', async () => {
    const company = await createCompanyWithManager('2FA-disable');
    await enable2FA(company);

    const noPwd = await request(app).post('/2fa/disable').set('Authorization', `Bearer ${company.token}`).send({});
    expect(noPwd.status).toBe(400);

    const badPwd = await request(app).post('/2fa/disable').set('Authorization', `Bearer ${company.token}`).send({ password: 'mauvais' });
    expect(badPwd.status).toBe(401);

    const ok = await request(app).post('/2fa/disable').set('Authorization', `Bearer ${company.token}`).send({ password: company.password });
    expect(ok.status).toBe(200);

    const login = await request(app).post('/login').send({ email: company.email, password: company.password });
    expect(typeof login.body.token).toBe('string');
    expect(login.body.requiresTwoFactor).toBeUndefined();
  });
});