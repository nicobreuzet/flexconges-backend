// Tache 1.11 : epuiser le quota de /register ne doit PAS bloquer /forgot-password.
process.env.ENABLE_RATE_LIMIT_IN_TESTS = '1';

const request = require('supertest');
const app = require('../server');

jest.setTimeout(60000);

afterAll(() => {
  delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
});

describe('Quotas separes : /register puis /forgot-password', () => {
  test('apres 10 requetes sur /register (11e = 429), /forgot-password repond encore 200', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/register').send({});
      expect(r.status).not.toBe(429);
    }

    const blocked = await request(app).post('/register').send({});
    expect(blocked.status).toBe(429);

    const forgot = await request(app)
      .post('/forgot-password')
      .send({ email: `quota-a-${Date.now()}@test.com` });
    expect(forgot.status).toBe(200);
  });
});