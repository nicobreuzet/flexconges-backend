// Tache "petits points backend" : /register ne renvoie que des champs choisis (liste d'inclusion).
// Si une colonne est ajoutee un jour a User ou Company, elle ne doit jamais sortir sans decision.
const request = require('supertest');
const app = require('../server');
const { createInvitation } = require('../utils/invitations');

jest.setTimeout(60000);

function uniq() {
  return `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
}

async function inscrire() {
  const id = uniq();
  const body = {
    companyName: `Societe reponse ${id}`,
    email: `reponse${id}@test.com`,
    password: 'Motdepasse123!',
    firstName: 'Test',
    lastName: 'Reponse',
    role: 'employee'
  };
  const { token: invitationToken } = await createInvitation(body.email);
  const res = await request(app).post('/register').send({ ...body, invitationToken });
  return { body, res };
}

describe('Reponse de /register : liste d inclusion', () => {
  test('la reponse ne contient que les champs choisis, ni plus ni moins', async () => {
    const { res } = await inscrire();
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['company', 'user']);
    expect(Object.keys(res.body.company).sort()).toEqual(['id', 'name']);
    expect(Object.keys(res.body.user).sort()).toEqual(
      ['companyId', 'email', 'firstName', 'id', 'lastName', 'role']
    );
  });

  test('les champs gardes ont les bonnes valeurs (temoin : ce que le front et les tests utilisent)', async () => {
    const { body, res } = await inscrire();
    expect(res.status).toBe(201);
    expect(res.body.company.name).toBe(body.companyName);
    expect(typeof res.body.company.id).toBe('number');
    expect(res.body.user.email).toBe(body.email);
    expect(res.body.user.firstName).toBe('Test');
    expect(res.body.user.lastName).toBe('Reponse');
    expect(res.body.user.role).toBe('manager');
    expect(res.body.user.companyId).toBe(res.body.company.id);
    expect(res.body.user.password).toBeUndefined();
  });
});