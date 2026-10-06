const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee } = require('./helpers');

jest.setTimeout(30000);
authenticator.options = { window: 1 };

// Un code volontairement faux (différent du code valide du moment)
function wrongCode(secret) {
  return authenticator.generate(secret) === '000000' ? '111111' : '000000';
}

describe('A3 : trous côté serveur', () => {
  test('Un compte désactivé ne peut pas se connecter, et son ancien jeton est refusé', async () => {
    const company = await createCompanyWithManager('A3-desactive');
    const emp = await createEmployee(company.token);
    expect(emp.token).toBeTruthy();

    await prisma.user.update({ where: { email: emp.email }, data: { isActive: false } });

    const login = await request(app).post('/login').send({ email: emp.email, password: 'MotDePasseTest123!' });
    expect(login.status).toBe(403);
    expect(login.body.token).toBeUndefined();
    expect(login.body.error).toMatch(/désactivé/);

    // Le jeton émis avant la désactivation ne marche plus non plus
    const me = await request(app).get('/me').set('Authorization', `Bearer ${emp.token}`);
    expect(me.status).toBe(401);
  });

  test('/2fa/verify-setup : 5 codes faux verrouillent, le verrou expire, le bon code active et remet à zéro', async () => {
    const company = await createCompanyWithManager('A3-setup-lock');
    const auth = { Authorization: `Bearer ${company.token}` };

    const setup = await request(app).post('/2fa/setup').set(auth);
    expect(setup.status).toBe(200);
    const secret = setup.body.secret.replace(/\s/g, '');

    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/2fa/verify-setup').set(auth).send({ code: wrongCode(secret) });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 429]);

    // Pendant le blocage, même le BON code est refusé
    const locked = await request(app).post('/2fa/verify-setup').set(auth).send({ code: authenticator.generate(secret) });
    expect(locked.status).toBe(429);

    // On simule l'expiration du blocage
    await prisma.user.update({ where: { email: company.email }, data: { twoFactorLockedUntil: new Date(Date.now() - 1000) } });

    const ok = await request(app).post('/2fa/verify-setup').set(auth).send({ code: authenticator.generate(secret) });
    expect(ok.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { email: company.email } });
    expect(after.twoFactorEnabled).toBe(true);
    expect(after.twoFactorFailedAttempts).toBe(0);
    expect(after.twoFactorLockedUntil).toBeNull();
  });
});