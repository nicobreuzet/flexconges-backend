const request = require('supertest');
const app = require('../server');

describe('En-tetes de securite (helmet)', () => {
  test('La page d accueil porte les en-tetes de securite et ne revele pas Express', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  test('Les reponses d erreur les portent aussi', async () => {
    const res = await request(app).get('/company');
    expect(res.status).toBe(401);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('CORS reste ouvert : le front local (origine null) peut toujours appeler l API', async () => {
    const res = await request(app).get('/company').set('Origin', 'null');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});