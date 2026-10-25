const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createInvitation } = require('../utils/invitations');

describe('Porte d\'inscription /register', () => {
  const valeurInitiale = process.env.REGISTRATION_OPEN;

  afterEach(() => {
    // On remet la variable comme elle était, pour ne pas perturber les autres tests
    if (valeurInitiale === undefined) delete process.env.REGISTRATION_OPEN;
    else process.env.REGISTRATION_OPEN = valeurInitiale;
  });

  const corps = () => {
    const id = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
    return {
      companyName: `Societe fermee ${id}`,
      email: `ferme${id}@test.com`,
      password: 'Motdepasse123!',
      firstName: 'Test',
      lastName: 'Ferme'
    };
  };

  test('refuse l\'inscription quand la variable est absente, sans rien créer', async () => {
    delete process.env.REGISTRATION_OPEN;
    const body = corps();

    const res = await request(app).post('/register').send(body);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/fermées/);
    expect(await prisma.company.findFirst({ where: { name: body.companyName } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: body.email } })).toBeNull();
  });

  test('refuse aussi quand la variable vaut autre chose que "true"', async () => {
    process.env.REGISTRATION_OPEN = 'oui';
    const res = await request(app).post('/register').send(corps());
    expect(res.status).toBe(403);
  });

  test('accepte l\'inscription quand la variable vaut "true"', async () => {
    process.env.REGISTRATION_OPEN = 'true';
    const b = corps();
    const { token } = await createInvitation(b.email);
    const res = await request(app).post('/register').send({ ...b, invitationToken: token });
    expect(res.status).toBe(201);
  });
});