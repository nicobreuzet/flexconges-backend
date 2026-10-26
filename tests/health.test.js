// Route de sante : repond sans toucher a la base, sans identification, sans detail.
process.env.ENABLE_RATE_LIMIT_IN_TESTS = '1';

const request = require('supertest');
const app = require('../server');

jest.setTimeout(60000);

afterAll(() => {
  delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
});

describe('Route de sante GET /health', () => {
  test('repond 200 avec exactement {"status":"ok"}, sans aucun autre detail', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('25 appels de suite sans identification repondent tous 200 (aucun compteur ne la bloque)', async () => {
    for (let i = 0; i < 25; i++) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
  });
});