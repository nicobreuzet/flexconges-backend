const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee } = require('./helpers');

jest.setTimeout(30000);
authenticator.options = { window: 1 };

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// Active le 2FA pour le porteur de ce jeton, comme le ferait le front
async function enable2FA(token) {
  const setup = await request(app).post('/2fa/setup').set(auth(token));
  if (setup.status !== 200) {
    throw new Error(`Setup 2FA échoué : ${setup.status} ${JSON.stringify(setup.body)}`);
  }
  const secret = setup.body.secret.replace(/\s/g, '');
  const verify = await request(app)
    .post('/2fa/verify-setup')
    .set(auth(token))
    .send({ code: authenticator.generate(secret) });
  if (verify.status !== 200) {
    throw new Error(`Activation 2FA échouée : ${verify.status} ${JSON.stringify(verify.body)}`);
  }
}

describe('2FA obligatoire pour tout le cabinet', () => {
  test("Par défaut l'option est désactivée, et un employé ne peut pas la modifier", async () => {
    const company = await createCompanyWithManager('req2fa-defaut');
    const emp = await createEmployee(company.token);

    const get = await request(app).get('/company').set(auth(emp.token));
    expect(get.status).toBe(200);
    expect(get.body.requireTwoFactor).toBe(false);

    const patch = await request(app).patch('/company').set(auth(emp.token)).send({ requireTwoFactor: true });
    expect(patch.status).toBe(403);
  });

  test("Un manager sans 2FA ne peut pas l'imposer, et la valeur doit être un booléen", async () => {
    const company = await createCompanyWithManager('req2fa-garde-fou');

    const noTfa = await request(app).patch('/company').set(auth(company.token)).send({ requireTwoFactor: true });
    expect(noTfa.status).toBe(400);
    expect(noTfa.body.error).toMatch(/2FA/);

    const notBool = await request(app).patch('/company').set(auth(company.token)).send({ requireTwoFactor: 'oui' });
    expect(notBool.status).toBe(400);

    const get = await request(app).get('/company').set(auth(company.token));
    expect(get.body.requireTwoFactor).toBe(false);
  });

  test("Un manager qui a le 2FA peut l'imposer", async () => {
    const company = await createCompanyWithManager('req2fa-activation');
    await enable2FA(company.token);

    const patch = await request(app).patch('/company').set(auth(company.token)).send({ requireTwoFactor: true });
    expect(patch.status).toBe(200);
    expect(patch.body.requireTwoFactor).toBe(true);

    const get = await request(app).get('/company').set(auth(company.token));
    expect(get.body.requireTwoFactor).toBe(true);
  });

  test("Un employé sans 2FA est bloqué (403) sauf pour finir sa configuration, puis débloqué", async () => {
    const company = await createCompanyWithManager('req2fa-force');
    const emp = await createEmployee(company.token);
    await enable2FA(company.token);
    await request(app).patch('/company').set(auth(company.token)).send({ requireTwoFactor: true });

    // Routes métier : refusées avec un code lisible par le front
    const blocked = await request(app).get('/leave-types').set(auth(emp.token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('2FA_SETUP_REQUIRED');

    // Routes nécessaires pour finir la configuration : autorisées
    expect((await request(app).get('/me').set(auth(emp.token))).status).toBe(200);
    expect((await request(app).get('/company').set(auth(emp.token))).status).toBe(200);
    expect((await request(app).get('/2fa/status').set(auth(emp.token))).status).toBe(200);

    // Il active son 2FA avec le même jeton : l'accès revient immédiatement
    await enable2FA(emp.token);
    const ok = await request(app).get('/leave-types').set(auth(emp.token));
    expect(ok.status).toBe(200);
  });

  test("Désactiver l'option débloque tout le monde, et elle ne touche pas les autres sociétés", async () => {
    const companyA = await createCompanyWithManager('req2fa-A');
    const empA = await createEmployee(companyA.token);
    const companyB = await createCompanyWithManager('req2fa-B');

    await enable2FA(companyA.token);
    await request(app).patch('/company').set(auth(companyA.token)).send({ requireTwoFactor: true });

    expect((await request(app).get('/leave-types').set(auth(empA.token))).status).toBe(403);
    // Société B : aucune obligation, aucun 2FA, aucun blocage
    expect((await request(app).get('/leave-types').set(auth(companyB.token))).status).toBe(200);

    const off = await request(app).patch('/company').set(auth(companyA.token)).send({ requireTwoFactor: false });
    expect(off.status).toBe(200);
    expect(off.body.requireTwoFactor).toBe(false);
    expect((await request(app).get('/leave-types').set(auth(empA.token))).status).toBe(200);
  });

  test("Un compte désactivé perd l'accès tout de suite, même avec un jeton encore valide", async () => {
    const company = await createCompanyWithManager('req2fa-desactive');
    const emp = await createEmployee(company.token);

    expect((await request(app).get('/leave-types').set(auth(emp.token))).status).toBe(200);

    await prisma.user.update({ where: { email: emp.email }, data: { isActive: false } });

    const res = await request(app).get('/leave-types').set(auth(emp.token));
    expect(res.status).toBe(401);
  });
});