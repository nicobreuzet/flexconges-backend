const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee } = require('./helpers');

jest.setTimeout(30000);

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const sidOf = (token) => jwt.decode(token).sid;
const HOURS = 60 * 60 * 1000;

const setHours = (token, hours) =>
  request(app).patch('/company').set(auth(token)).send({ securityConfig: { sessionInactivityHours: hours } });

// Vieillit la session d'un jeton : "dernière activité il y a N heures"
async function ageSession(token, hours) {
  await prisma.session.update({ where: { id: sidOf(token) }, data: { lastSeenAt: new Date(Date.now() - hours * HOURS) } });
}
async function companyIdOf(email) {
  return (await prisma.user.findUnique({ where: { email } })).companyId;
}
async function loginAgain(company) {
  const res = await request(app).post('/login').send({ email: company.email, password: company.password });
  return res.body.token;
}

describe('Réglages de sécurité du cabinet (B5)', () => {
  test('Par défaut : 8 h d\'inactivité', async () => {
    const c = await createCompanyWithManager('SC-defaut');
    const res = await request(app).get('/company').set(auth(c.token));
    expect(res.status).toBe(200);
    expect(res.body.securityConfig).toEqual({ sessionInactivityHours: 8 });
  });

  test('Un changement valide est enregistré', async () => {
    const c = await createCompanyWithManager('SC-valide');
    const res = await setHours(c.token, 4);
    expect(res.status).toBe(200);
    expect(res.body.securityConfig.sessionInactivityHours).toBe(4);
    const stored = await prisma.company.findUnique({ where: { id: await companyIdOf(c.email) } });
    expect(stored.securityConfig).toEqual({ sessionInactivityHours: 4 });
  });

  test('Tout ce qui est invalide est refusé et ne change rien', async () => {
    const c = await createCompanyWithManager('SC-invalide');
    const bad = [
      { sessionInactivityHours: 5 },
      { sessionInactivityHours: '4' },
      { sessionInactivityHours: null },
      { inconnu: true },
      [],
      'texte',
      4
    ];
    for (const securityConfig of bad) {
      const res = await request(app).patch('/company').set(auth(c.token)).send({ securityConfig });
      expect(res.status).toBe(400);
    }
    const get = await request(app).get('/company').set(auth(c.token));
    expect(get.body.securityConfig.sessionInactivityHours).toBe(8);
    const stored = await prisma.company.findUnique({ where: { id: await companyIdOf(c.email) } });
    expect(stored.securityConfig).toBeNull();
  });

  test('Un employé ne peut pas modifier les réglages de sécurité', async () => {
    const c = await createCompanyWithManager('SC-employe');
    const emp = await createEmployee(c.token);
    const res = await setHours(emp.token, 1);
    expect(res.status).toBe(403);
    const get = await request(app).get('/company').set(auth(c.token));
    expect(get.body.securityConfig.sessionInactivityHours).toBe(8);
  });

  test('Avec 1 h, une session inactive depuis 2 h est refusée ; un cabinet resté à 8 h l\'accepte', async () => {
    const a = await createCompanyWithManager('SC-effet-A');
    const b = await createCompanyWithManager('SC-effet-B');
    expect((await setHours(a.token, 1)).status).toBe(200);
    await ageSession(a.token, 2);
    await ageSession(b.token, 2);

    const resA = await request(app).get('/me').set(auth(a.token));
    expect(resA.status).toBe(401);
    expect(resA.body.error).toMatch(/expirée après 1 h/);

    const resB = await request(app).get('/me').set(auth(b.token));
    expect(resB.status).toBe(200);
  });

  test('Avec 24 h, une session inactive depuis 20 h reste valable', async () => {
    const c = await createCompanyWithManager('SC-24h');
    expect((await setHours(c.token, 24)).status).toBe(200);
    await ageSession(c.token, 20);
    const res = await request(app).get('/me').set(auth(c.token));
    expect(res.status).toBe(200);
  });

  test('Le réglage d\'un cabinet ne touche pas un autre cabinet', async () => {
    const a = await createCompanyWithManager('SC-iso-A');
    const b = await createCompanyWithManager('SC-iso-B');
    expect((await setHours(a.token, 1)).status).toBe(200);
    const get = await request(app).get('/company').set(auth(b.token));
    expect(get.body.securityConfig.sessionInactivityHours).toBe(8);
  });

  test('Le changement est tracé dans le journal d\'audit (ancienne et nouvelle valeur)', async () => {
    const c = await createCompanyWithManager('SC-audit');
    expect((await setHours(c.token, 4)).status).toBe(200);
    const res = await request(app).get('/audit-logs?action=company.security_updated').set(auth(c.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].details.de.sessionInactivityHours).toBe(8);
    expect(res.body.items[0].details.vers.sessionInactivityHours).toBe(4);
  });

  test('Une modification vide n\'efface pas le réglage existant', async () => {
    const c = await createCompanyWithManager('SC-vide');
    expect((await setHours(c.token, 4)).status).toBe(200);
    const empty = await request(app).patch('/company').set(auth(c.token)).send({ securityConfig: {} });
    expect(empty.status).toBe(200);
    const get = await request(app).get('/company').set(auth(c.token));
    expect(get.body.securityConfig.sessionInactivityHours).toBe(4);
  });

  test('La liste des sessions actives suit la durée du cabinet', async () => {
    const c = await createCompanyWithManager('SC-liste');
    const token2 = await loginAgain(c);
    await ageSession(token2, 2);

    const avant = await request(app).get('/sessions').set(auth(c.token));
    expect(avant.body).toHaveLength(2);

    expect((await setHours(c.token, 1)).status).toBe(200);
    const apres = await request(app).get('/sessions').set(auth(c.token));
    expect(apres.body).toHaveLength(1);
    expect(apres.body[0].current).toBe(true);
  });

  test('Une valeur corrompue en base retombe sur 8 h', async () => {
    const c = await createCompanyWithManager('SC-corrompu');
    await prisma.company.update({
      where: { id: await companyIdOf(c.email) },
      data: { securityConfig: { sessionInactivityHours: 999 } }
    });
    const get = await request(app).get('/company').set(auth(c.token));
    expect(get.body.securityConfig.sessionInactivityHours).toBe(8);

    await ageSession(c.token, 7);
    const me = await request(app).get('/me').set(auth(c.token));
    expect(me.status).toBe(200);
  });
});
