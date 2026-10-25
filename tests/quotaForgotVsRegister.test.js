// Tache 1.11 : epuiser le quota de /forgot-password ne doit PAS bloquer /register.
process.env.ENABLE_RATE_LIMIT_IN_TESTS = '1';

const request = require('supertest');
const app = require('../server');

jest.setTimeout(60000);

afterAll(() => {
  delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
});

describe('Quotas separes : /forgot-password puis /register', () => {
  test('apres 10 requetes sur /forgot-password (11e = 429), /register ne repond pas 429', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(app)
        .post('/forgot-password')
        .send({ email: `quota-b-${i}-${Date.now()}@test.com` });
      expect(r.status).not.toBe(429);
    }

    const blocked = await request(app)
      .post('/forgot-password')
      .send({ email: `quota-b-bloque-${Date.now()}@test.com` });
    expect(blocked.status).toBe(429);

    const register = await request(app).post('/register').send({});
    expect(register.status).not.toBe(429);
  });
});