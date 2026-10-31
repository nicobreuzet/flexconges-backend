// GET /me : liste de champs AUTORISES (et non "tout sauf le mot de passe") : aucun jeton, aucun secret.
const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee } = require('./helpers');

jest.setTimeout(60000);

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const CHAMPS = ['address', 'createdAt', 'email', 'firstName', 'id', 'isActive', 'lastName', 'managerId', 'phone', 'role', 'startDate', 'team', 'teamId'];

describe('GET /me', () => {
  test('ne renvoie que les champs autorises, sans jeton de reinitialisation ni secret 2FA', async () => {
    const m = await createCompanyWithManager('MeChamps');
    const e = await createEmployee(m.token);

    // La personne a un jeton de reinitialisation en base et un secret 2FA en cours d'activation
    expect((await request(app).post('/forgot-password').send({ email: e.email })).status).toBe(200);
    const enBase = await prisma.user.findUnique({ where: { email: e.email } });
    expect(enBase.resetToken).toBeTruthy();
    expect((await request(app).post('/2fa/setup').set(auth(e.token))).status).toBe(200);

    const res = await request(app).get('/me').set(auth(e.token));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(CHAMPS);
    const brut = JSON.stringify(res.body);
    expect(brut).not.toContain(enBase.resetToken);
    for (const interdit of ['resetToken', 'twoFactorSecret', 'password', 'twoFactorFailedAttempts']) {
      expect(brut).not.toContain(interdit);
    }
  });

  test('temoin : les champs lus par le front (id, role, prenom, nom) sont corrects', async () => {
    const m = await createCompanyWithManager('MeTemoin');
    const e = await createEmployee(m.token);
    const rm = await request(app).get('/me').set(auth(m.token));
    const re = await request(app).get('/me').set(auth(e.token));
    expect(rm.status).toBe(200);
    expect(rm.body.id).toBe(m.manager.id);
    expect(rm.body.role).toBe('manager');
    expect(re.body.id).toBe(e.user.id);
    expect(re.body.role).toBe('employee');
    expect(re.body.firstName).toBe('Test');
    expect(re.body.lastName).toBe('Employee');
  });
});