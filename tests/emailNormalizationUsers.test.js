const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee } = require('./helpers');

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;

let c;
beforeAll(async () => {
  c = await createCompanyWithManager('MailUsers');
});

function creer(email) {
  return request(app)
    .post('/users')
    .set('Authorization', `Bearer ${c.token}`)
    .send({ email, firstName: 'Test', lastName: 'Invite', role: 'employee' });
}

function modifier(id, corps) {
  return request(app)
    .put(`/users/${id}`)
    .set('Authorization', `Bearer ${c.token}`)
    .send(corps);
}

describe('Normalisation des e-mails a la creation d un collaborateur (POST /users)', () => {
  test('temoin : une adresse propre est enregistree telle quelle', async () => {
    const email = `inv${uniq()}@test.com`;
    const res = await creer(email);
    expect(res.status).toBe(201);
    expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();
  });

  test('enregistre l adresse en minuscules et sans espaces', async () => {
    const email = `inv${uniq()}@test.com`;
    const res = await creer(`  ${email.toUpperCase()}  `);
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);
    expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();
  });

  test.each([
    ['sans arobase', 'pas-un-email'],
    ['domaine sans point', 'a@b'],
    ['espace dans l adresse', 'a b@x.fr'],
  ])('refuse une adresse mal formee (%s)', async (_label, email) => {
    const filtre = { email: { equals: email, mode: 'insensitive' } };
    const avant = await prisma.user.count({ where: filtre });
    const res = await creer(email);
    expect(res.status).toBe(400);
    const apres = await prisma.user.count({ where: filtre });
    expect(apres).toBe(avant);
  });

  test('la meme adresse avec une autre casse ne cree pas un second compte', async () => {
    const email = `inv${uniq()}@test.com`;
    expect((await creer(email)).status).toBe(201);
    const second = await creer(email.toUpperCase());
    expect(second.status).toBe(409);
    const comptes = await prisma.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } }
    });
    expect(comptes).toHaveLength(1);
  });
});

describe('Normalisation des e-mails a la modification d un collaborateur (PUT /users/:id)', () => {
  test('temoin : modifier le prenom sans envoyer d e-mail ne change pas l adresse', async () => {
    const e = await createEmployee(c.token);
    const res = await modifier(e.user.id, { firstName: 'Nouveau' });
    expect(res.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { id: e.user.id } });
    expect(user.firstName).toBe('Nouveau');
    expect(user.email).toBe(e.email);
  });

  test('enregistre la nouvelle adresse en minuscules et sans espaces', async () => {
    const e = await createEmployee(c.token);
    const nouvelle = `chg${uniq()}@test.com`;
    const res = await modifier(e.user.id, { email: `  ${nouvelle.toUpperCase()}  ` });
    expect(res.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { id: e.user.id } });
    expect(user.email).toBe(nouvelle);
  });

  test.each([
    ['sans arobase', 'pas-un-email'],
    ['domaine sans point', 'a@b'],
  ])('refuse une adresse mal formee (%s) et ne change rien', async (_label, email) => {
    const e = await createEmployee(c.token);
    const res = await modifier(e.user.id, { email });
    expect(res.status).toBe(400);
    const user = await prisma.user.findUnique({ where: { id: e.user.id } });
    expect(user.email).toBe(e.email);
  });

  test('refuse l adresse d un autre compte ecrite avec une autre casse', async () => {
    const a = await createEmployee(c.token);
    const b = await createEmployee(c.token);
    const res = await modifier(b.user.id, { email: a.email.toUpperCase() });
    expect(res.status).toBe(409);
    const user = await prisma.user.findUnique({ where: { id: b.user.id } });
    expect(user.email).toBe(b.email);
  });
});