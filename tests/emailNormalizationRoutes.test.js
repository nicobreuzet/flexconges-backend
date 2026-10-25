const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');
const { createInvitation } = require('../utils/invitations');

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;

function corpsInscription(overrides = {}) {
  const u = uniq();
  return {
    companyName: `Societe Mail ${u}`,
    email: `mail${u}@test.com`,
    password: 'Abcdefghij1!',
    firstName: 'Test',
    lastName: 'Mail',
    ...overrides
  };
}

describe('Normalisation des e-mails a l inscription (/register)', () => {
  test('temoin : une adresse deja propre est enregistree telle quelle', async () => {
    const body = corpsInscription();
    const { token: invitationToken } = await createInvitation(body.email);
    const res = await request(app).post('/register').send({ ...body, invitationToken });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    expect(user).not.toBeNull();
  });

  test('enregistre l adresse en minuscules et sans espaces', async () => {
    const base = corpsInscription();
    const { token: invitationToken } = await createInvitation(base.email);
    const res = await request(app).post('/register').send({ ...base, email: `  ${base.email.toUpperCase()}  `, invitationToken });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { email: base.email } });
    expect(user).not.toBeNull();
    expect(user.email).toBe(base.email);
  });

  test('deux casses differentes ne creent qu un seul compte', async () => {
    const base = corpsInscription();
    const { token: tokenPremier } = await createInvitation(base.email);
    const premier = await request(app).post('/register').send({ ...base, invitationToken: tokenPremier });
    expect(premier.status).toBe(201);

    const secondeSociete = `${base.companyName} bis`;
    // Une invitation valide pour cette adresse : le refus attendu vient bien du doublon (409), pas de l'invitation.
    const { token: tokenSecond } = await createInvitation(base.email);
    const second = await request(app).post('/register').send({
      ...base, companyName: secondeSociete, email: base.email.toUpperCase(), invitationToken: tokenSecond
    });
    expect(second.status).toBe(409);

    const comptes = await prisma.user.findMany({
      where: { email: { equals: base.email, mode: 'insensitive' } }
    });
    expect(comptes).toHaveLength(1);
    expect(await prisma.company.findFirst({ where: { name: secondeSociete } })).toBeNull();
  });

  test.each([
    ['sans arobase', 'pas-un-email'],
    ['domaine sans point', 'a@b'],
    ['espace dans l adresse', 'a b@x.fr'],
    ['un objet au lieu d une chaine', { a: 1 }],
  ])('refuse une adresse mal formee (%s)', async (_label, email) => {
    const body = corpsInscription({ email });
    const res = await request(app).post('/register').send(body);
    expect(res.status).toBe(400);
    expect(await prisma.company.findFirst({ where: { name: body.companyName } })).toBeNull();
  });
});

describe('Normalisation des e-mails a la connexion (/login)', () => {
  let c;
  beforeAll(async () => {
    c = await createCompanyWithManager('MailLogin');
  });

  test('temoin : connexion avec l adresse exacte', async () => {
    const res = await request(app).post('/login').send({ email: c.email, password: c.password });
    expect(res.status).toBe(200);
  });

  test('connexion avec la meme adresse en majuscules et avec des espaces', async () => {
    const res = await request(app).post('/login').send({
      email: `  ${c.email.toUpperCase()}  `, password: c.password
    });
    expect(res.status).toBe(200);
  });

  test.each([
    ['sans arobase', 'pas-un-email'],
    ['domaine sans point', 'a@b'],
  ])('refuse une adresse mal formee (%s)', async (_label, email) => {
    const res = await request(app).post('/login').send({ email, password: 'Abcdefghij1!' });
    expect(res.status).toBe(400);
  });
});

describe('Normalisation des e-mails au mot de passe oublie (/forgot-password)', () => {
  test('retrouve le compte quelle que soit la casse', async () => {
    const c = await createCompanyWithManager('MailOubli');
    const res = await request(app).post('/forgot-password').send({ email: `  ${c.email.toUpperCase()}  ` });
    expect(res.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email: c.email } });
    expect(user.resetToken).not.toBeNull();
  });

  test('refuse une adresse mal formee', async () => {
    const res = await request(app).post('/forgot-password').send({ email: 'pas-un-email' });
    expect(res.status).toBe(400);
  });
});