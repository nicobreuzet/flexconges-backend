const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');

describe('Authentification et inscription', () => {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
  const registration = {
    companyName: `Societe Auth ${unique}`,
    email: `auth${unique}@test.com`,
    password: 'motdepasse123',
    firstName: 'Test',
    lastName: 'User',
    role: 'employee' // le client tente d'imposer un rôle : il doit être ignoré
  };

  test('POST /register crée une société et son premier manager', async () => {
    const res = await request(app).post('/register').send(registration);
    expect(res.status).toBe(201);
    expect(res.body.company.name).toBe(registration.companyName);
    expect(res.body.user.email).toBe(registration.email);
    expect(res.body.user.companyId).toBe(res.body.company.id);
    expect(res.body.user.password).toBeUndefined();
  });

  test('Le rôle est imposé côté serveur : toujours manager', async () => {
    const res = await request(app).post('/login').send({
      email: registration.email, password: registration.password
    });
    const payload = jwt.decode(res.body.token);
    expect(payload.role).toBe('manager'); // malgré role: 'employee' envoyé à l'inscription
  });

  test('POST /login renvoie un token qui contient le companyId', async () => {
    const res = await request(app).post('/login').send({
      email: registration.email, password: registration.password
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(Number.isInteger(jwt.decode(res.body.token).companyId)).toBe(true);
  });

  test('POST /login échoue avec un mauvais mot de passe', async () => {
    const res = await request(app).post('/login').send({
      email: registration.email, password: 'mauvais-mot-de-passe'
    });
    expect(res.status).toBe(401);
  });

  test('POST /register refuse un e-mail déjà utilisé', async () => {
    const res = await request(app).post('/register').send({
      ...registration, companyName: `Autre societe ${unique}`
    });
    expect(res.status).toBe(409);
  });

  test('POST /register refuse un champ obligatoire manquant', async () => {
    const res = await request(app).post('/register').send({
      email: `x${unique}@test.com`, password: 'motdepasse123', firstName: 'A', lastName: 'B'
    }); // pas de companyName
    expect(res.status).toBe(400);
  });

  test('POST /register refuse un mot de passe trop court', async () => {
    const res = await request(app).post('/register').send({
      ...registration, email: `court${unique}@test.com`, password: 'abc'
    });
    expect(res.status).toBe(400);
  });
});