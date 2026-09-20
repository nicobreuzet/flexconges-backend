const request = require('supertest');
const app = require('../server');

describe('Authentification', () => {
  const testUser = {
    email: `test${Date.now()}@test.com`,
    password: 'motdepasse123',
    firstName: 'Test',
    lastName: 'User',
    role: 'employee'
  };

  test('POST /register crée un utilisateur', async () => {
    const res = await request(app).post('/register').send(testUser);
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(testUser.email);
    expect(res.body.password).toBeUndefined();
  });

  test('POST /login renvoie un token avec les bons identifiants', async () => {
    const res = await request(app).post('/login').send({
      email: testUser.email,
      password: testUser.password
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  test('POST /login échoue avec un mauvais mot de passe', async () => {
    const res = await request(app).post('/login').send({
      email: testUser.email,
      password: 'mauvais-mot-de-passe'
    });
    expect(res.status).toBe(401);
  });
});