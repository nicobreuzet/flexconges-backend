const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee } = require('./helpers');

jest.setTimeout(30000);

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const sidOf = (token) => jwt.decode(token).sid;
const HOURS = 60 * 60 * 1000;

async function loginAgain(company) {
  const res = await request(app).post('/login').send({ email: company.email, password: company.password });
  return res.body.token;
}

describe('Sessions réelles (B4)', () => {
  test('La connexion crée une session et le jeton contient son identifiant', async () => {
    const c = await createCompanyWithManager('S-creation');
    const user = await prisma.user.findUnique({ where: { email: c.email } });
    const session = await prisma.session.findUnique({ where: { id: sidOf(c.token) } });
    expect(session).not.toBeNull();
    expect(session.userId).toBe(user.id);
    expect(session.companyId).toBe(user.companyId);
    expect(session.revokedAt).toBeNull();
  });

  test('Un jeton sans identifiant de session est refusé', async () => {
    const c = await createCompanyWithManager('S-sans-sid');
    const user = await prisma.user.findUnique({ where: { email: c.email } });
    const old = jwt.sign({ userId: user.id, role: 'manager', companyId: user.companyId }, process.env.JWT_SECRET);
    const res = await request(app).get('/me').set(auth(old));
    expect(res.status).toBe(401);
  });

  test('Une session révoquée est refusée', async () => {
    const c = await createCompanyWithManager('S-revoquee');
    await prisma.session.update({ where: { id: sidOf(c.token) }, data: { revokedAt: new Date() } });
    const res = await request(app).get('/me').set(auth(c.token));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/révoquée/);
  });

  test('Une session inactive depuis plus de 8 h est refusée, puis révoquée', async () => {
    const c = await createCompanyWithManager('S-inactive');
    const sid = sidOf(c.token);
    await prisma.session.update({ where: { id: sid }, data: { lastSeenAt: new Date(Date.now() - 9 * HOURS) } });
    const res = await request(app).get('/me').set(auth(c.token));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expirée/);
    const after = await prisma.session.findUnique({ where: { id: sid } });
    expect(after.revokedAt).not.toBeNull();
  });

  test('lastSeenAt est mis à jour quand la dernière activité date de plus de 5 minutes', async () => {
    const c = await createCompanyWithManager('S-lastseen');
    const sid = sidOf(c.token);
    await prisma.session.update({ where: { id: sid }, data: { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) } });
    const res = await request(app).get('/me').set(auth(c.token));
    expect(res.status).toBe(200);
    const after = await prisma.session.findUnique({ where: { id: sid } });
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 60 * 1000);
  });

  test('GET /sessions liste mes sessions et marque la session actuelle', async () => {
    const c = await createCompanyWithManager('S-liste');
    const token2 = await loginAgain(c);
    const res = await request(app).get('/sessions').set(auth(c.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const current = res.body.filter(s => s.current);
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(sidOf(c.token));
    expect(res.body.map(s => s.id)).toContain(sidOf(token2));
  });

  test('DELETE /sessions/:id révoque une autre session, et seulement celle-là', async () => {
    const c = await createCompanyWithManager('S-delete');
    const token2 = await loginAgain(c);
    const del = await request(app).delete(`/sessions/${sidOf(token2)}`).set(auth(c.token));
    expect(del.status).toBe(200);
    expect((await request(app).get('/me').set(auth(token2))).status).toBe(401);
    expect((await request(app).get('/me').set(auth(c.token))).status).toBe(200);
  });

  test('On ne peut pas révoquer la session d\'un autre utilisateur', async () => {
    const a = await createCompanyWithManager('S-iso-A');
    const b = await createCompanyWithManager('S-iso-B');
    const del = await request(app).delete(`/sessions/${sidOf(b.token)}`).set(auth(a.token));
    expect(del.status).toBe(404);
    expect((await request(app).get('/me').set(auth(b.token))).status).toBe(200);
  });

  test('POST /sessions/revoke-others garde seulement la session actuelle', async () => {
    const c = await createCompanyWithManager('S-others');
    const token2 = await loginAgain(c);
    const token3 = await loginAgain(c);
    const res = await request(app).post('/sessions/revoke-others').set(auth(c.token));
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);
    expect((await request(app).get('/me').set(auth(token2))).status).toBe(401);
    expect((await request(app).get('/me').set(auth(token3))).status).toBe(401);
    expect((await request(app).get('/me').set(auth(c.token))).status).toBe(200);
  });

  test('POST /logout ferme la session courante', async () => {
    const c = await createCompanyWithManager('S-logout');
    expect((await request(app).post('/logout').set(auth(c.token))).status).toBe(200);
    expect((await request(app).get('/me').set(auth(c.token))).status).toBe(401);
  });

  test('Un changement de mot de passe (reset) révoque toutes les sessions', async () => {
    const c = await createCompanyWithManager('S-reset');
    const resetToken = `reset${Date.now()}${Math.floor(Math.random() * 1000000)}`;
    await prisma.user.update({
      where: { email: c.email },
      data: { resetToken, resetTokenExpires: new Date(Date.now() + 10 * 60 * 1000) }
    });
    const reset = await request(app).post('/reset-password').send({ token: resetToken, password: 'NouveauMdp123!!' });
    expect(reset.status).toBe(200);
    expect((await request(app).get('/me').set(auth(c.token))).status).toBe(401);
  });

  test('Désactiver un compte révoque ses sessions', async () => {
    const c = await createCompanyWithManager('S-deactivate');
    const emp = await createEmployee(c.token);
    const empUser = await prisma.user.findUnique({ where: { email: emp.email } });
    expect(await prisma.session.count({ where: { userId: empUser.id, revokedAt: null } })).toBeGreaterThan(0);

    const res = await request(app).patch(`/users/${empUser.id}/deactivate`).set(auth(c.token));
    expect(res.status).toBe(200);
    expect(await prisma.session.count({ where: { userId: empUser.id, revokedAt: null } })).toBe(0);
  });
});
