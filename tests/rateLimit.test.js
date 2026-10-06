// Ce fichier réactive les limites anti-force-brute (désactivées par défaut en test).
process.env.ENABLE_RATE_LIMIT_IN_TESTS = '1';

const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager } = require('./helpers');

jest.setTimeout(60000);

afterAll(() => {
  delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
});

describe('Limites anti-force-brute', () => {
  test('/login : 10 échecs sur un e-mail, puis 429 (même avec le bon mot de passe), sans gêner un autre compte', async () => {
    const target = await createCompanyWithManager('RL-cible');
    const other = await createCompanyWithManager('RL-autre');

    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/login').send({ email: target.email, password: 'mauvais-mot-de-passe' });
      expect(r.status).toBe(401);
    }

    const blocked = await request(app).post('/login').send({ email: target.email, password: 'mauvais-mot-de-passe' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Trop de tentatives/);

    const blockedRight = await request(app).post('/login').send({ email: target.email, password: target.password });
    expect(blockedRight.status).toBe(429);

    const otherLogin = await request(app).post('/login').send({ email: other.email, password: other.password });
    expect(otherLogin.status).toBe(200);
    expect(otherLogin.body.token).toBeTruthy();
  });

  test('/login : les connexions réussies ne consomment aucun quota', async () => {
    const company = await createCompanyWithManager('RL-succes');
    for (let i = 0; i < 12; i++) {
      const r = await request(app).post('/login').send({ email: company.email, password: company.password });
      expect(r.status).toBe(200);
    }
  });

  test('/forgot-password : finit par répondre 429 (10 demandes par heure et par IP)', async () => {
    const statuses = [];
    for (let i = 0; i < 15; i++) {
      const r = await request(app).post('/forgot-password').send({ email: `inconnu${i}${Date.now()}@test.com` });
      statuses.push(r.status);
    }
    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(429);
  });
});