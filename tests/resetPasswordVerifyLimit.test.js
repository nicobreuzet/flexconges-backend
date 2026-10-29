// Tache 3.6 : /reset-password/verify est couverte par le limiteur de /reset-password
// (30 echecs par 15 minutes et par adresse ; les reussites ne comptent pas).
process.env.ENABLE_RATE_LIMIT_IN_TESTS = '1';

const crypto = require('crypto');
const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');

jest.setTimeout(60000);

afterAll(() => {
  delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
});

const verifier = (token) => request(app).post('/reset-password/verify').send({ token });

describe('Limiteur sur /reset-password/verify', () => {
  test('les verifications reussies ne consomment aucun quota (35 de suite repondent 200)', async () => {
    const c = await createCompanyWithManager('VerifLimOk');
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { email: c.email },
      data: { resetToken: token, resetTokenExpires: new Date(Date.now() + 15 * 60 * 1000) }
    });
    for (let i = 0; i < 35; i++) {
      const res = await verifier(token);
      expect(res.status).toBe(200);
    }
  });

  test('apres 30 echecs, le 31e appel est refuse en 429', async () => {
    for (let i = 0; i < 30; i++) {
      const res = await verifier(crypto.randomBytes(32).toString('hex'));
      expect(res.status).toBe(400);
    }
    const bloque = await verifier(crypto.randomBytes(32).toString('hex'));
    expect(bloque.status).toBe(429);
  });
});