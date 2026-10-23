const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;

function corpsInscription(overrides = {}) {
  const u = uniq();
  return {
    companyName: `Societe MdP ${u}`,
    email: `mdp${u}@test.com`,
    password: 'Abcdefghij1!',
    firstName: 'Test',
    lastName: 'Mdp',
    ...overrides
  };
}

async function jetonValide(email) {
  const resetToken = `mdp${uniq()}`;
  await prisma.user.update({
    where: { email },
    data: { resetToken, resetTokenExpires: new Date(Date.now() + 10 * 60 * 1000) }
  });
  return resetToken;
}

describe("Regle de mot de passe a l'inscription (/register)", () => {
  test.each([
    ['trop court (8 caracteres)', 'Abcde1!x', /12 caract/],
    ['sans majuscule', 'abcdefghij1!', /majuscule/],
    ['sans chiffre', 'Abcdefghijk!', /chiffre/],
    ['sans caractere special', 'Abcdefghijk1', /sp.cial/],
    ['de plus de 72 octets', 'Aa1!' + 'x'.repeat(69), /72/]
  ])('refuse un mot de passe %s', async (_label, password, message) => {
    const body = corpsInscription({ password });
    const res = await request(app).post('/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await prisma.user.findUnique({ where: { email: body.email } })).toBeNull();
  });

  test("refuse un mot de passe qui contient l'adresse e-mail", async () => {
    const base = corpsInscription();
    const local = base.email.split('@')[0];
    const res = await request(app).post('/register').send({ ...base, password: 'Xx!' + local });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/e-mail/);
    expect(await prisma.user.findUnique({ where: { email: base.email } })).toBeNull();
  });

  test("accepte un mot de passe conforme dont le seul caractere special est un tiret", async () => {
    const body = corpsInscription({ password: 'Abcdefghij-1' });
    const res = await request(app).post('/register').send(body);
    expect(res.status).toBe(201);
  });
});

describe('Regle de mot de passe a la reinitialisation (/reset-password)', () => {
  test('accepte un tiret comme caractere special', async () => {
    const c = await createCompanyWithManager('MdP-tiret');
    const token = await jetonValide(c.email);
    const password = 'Motdepasse-123';
    const res = await request(app).post('/reset-password').send({ token, password });
    expect(res.status).toBe(200);
    const login = await request(app).post('/login').send({ email: c.email, password });
    expect(login.status).toBe(200);
  });

  test('refuse plus de 72 octets', async () => {
    const c = await createCompanyWithManager('MdP-long');
    const token = await jetonValide(c.email);
    const res = await request(app).post('/reset-password').send({ token, password: 'Aa1!' + 'x'.repeat(69) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/72/);
  });

  test("refuse un mot de passe contenant l'e-mail, sans consommer le jeton", async () => {
    const c = await createCompanyWithManager('MdP-email');
    const token = await jetonValide(c.email);
    const local = c.email.split('@')[0];

    const refuse = await request(app).post('/reset-password').send({ token, password: 'Xx!' + local });
    expect(refuse.status).toBe(400);
    expect(refuse.body.error).toMatch(/e-mail/);

    const accepte = await request(app).post('/reset-password').send({ token, password: 'NouveauMotDePasse1!' });
    expect(accepte.status).toBe(200);
  });
});