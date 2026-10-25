const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createInvitation, hashInvitationToken, generateInvitationToken } = require('../utils/invitations');

function uniq() {
  return `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
}

function corps(extra = {}) {
  const id = uniq();
  return {
    companyName: `Societe invit ${id}`,
    email: `reg${id}@test.com`,
    password: 'Motdepasse123!',
    firstName: 'Test',
    lastName: 'Invite',
    ...extra
  };
}

const comptesAvecAdresse = (email) => prisma.user.count({ where: { email } });
const ligneInvitation = (token) =>
  prisma.companyInvitation.findUnique({ where: { tokenHash: hashInvitationToken(token) } });

describe('Inscription sur invitation (/register)', () => {
  const valeurInitiale = process.env.REGISTRATION_OPEN;

  afterEach(() => {
    if (valeurInitiale === undefined) delete process.env.REGISTRATION_OPEN;
    else process.env.REGISTRATION_OPEN = valeurInitiale;
  });

  test('refuse sans jeton d invitation et ne cree rien', async () => {
    const b = corps();
    expect(await comptesAvecAdresse(b.email)).toBe(0);
    const res = await request(app).post('/register').send(b);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Invitation invalide/);
    expect(await comptesAvecAdresse(b.email)).toBe(0);
    expect(await prisma.company.findFirst({ where: { name: b.companyName } })).toBeNull();
  });

  test('refuse un jeton bien forme mais inconnu', async () => {
    const b = corps({ invitationToken: generateInvitationToken().token });
    const res = await request(app).post('/register').send(b);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Invitation invalide/);
    expect(await comptesAvecAdresse(b.email)).toBe(0);
  });

  test('refuse un jeton mal forme', async () => {
    const b = corps({ invitationToken: 'abc' });
    const res = await request(app).post('/register').send(b);
    expect(res.status).toBe(403);
    expect(await comptesAvecAdresse(b.email)).toBe(0);
  });

  test('refuse un jeton valide utilise avec une autre adresse, sans le consommer', async () => {
    const { token } = await createInvitation(`invite${uniq()}@test.com`);
    const b = corps({ invitationToken: token });
    const res = await request(app).post('/register').send(b);
    expect(res.status).toBe(403);
    expect(await comptesAvecAdresse(b.email)).toBe(0);
    expect((await ligneInvitation(token)).usedAt).toBeNull();
  });

  test('refuse une invitation expiree', async () => {
    const b = corps();
    const { token } = await createInvitation(b.email, { now: new Date(Date.now() - 10 * 24 * 3600 * 1000) });
    const res = await request(app).post('/register').send({ ...b, invitationToken: token });
    expect(res.status).toBe(403);
    expect(await comptesAvecAdresse(b.email)).toBe(0);
  });

  test('accepte une invitation valide et la marque utilisee avec la societe creee', async () => {
    const b = corps();
    const { token } = await createInvitation(b.email);
    const res = await request(app).post('/register').send({ ...b, invitationToken: token });
    expect(res.status).toBe(201);
    const ligne = await ligneInvitation(token);
    expect(ligne.usedAt).not.toBeNull();
    expect(ligne.companyId).toBe(res.body.company.id);
  });

  test('compare l adresse apres normalisation (majuscules et espaces)', async () => {
    const b = corps();
    const { token } = await createInvitation(b.email);
    const res = await request(app).post('/register').send({
      ...b, email: `  ${b.email.toUpperCase()}  `, invitationToken: token
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(b.email);
    expect((await ligneInvitation(token)).usedAt).not.toBeNull();
  });

  test('une invitation ne sert qu une fois, et son refus passe avant le doublon', async () => {
    const b = corps();
    const { token } = await createInvitation(b.email);
    const premier = await request(app).post('/register').send({ ...b, invitationToken: token });
    expect(premier.status).toBe(201);
    const autreNom = `Autre societe ${uniq()}`;
    const second = await request(app).post('/register').send({ ...b, companyName: autreNom, invitationToken: token });
    expect(second.status).toBe(403);
    expect(await prisma.company.findFirst({ where: { name: autreNom } })).toBeNull();
  });

  test('deux requetes simultanees avec le meme jeton : une seule societe', async () => {
    const b = corps();
    const { token } = await createInvitation(b.email);
    const [r1, r2] = await Promise.all([
      request(app).post('/register').send({ ...b, invitationToken: token }),
      request(app).post('/register').send({ ...b, companyName: `Jumelle ${uniq()}`, invitationToken: token })
    ]);
    const statuts = [r1.status, r2.status];
    expect(statuts.filter((s) => s === 201)).toHaveLength(1);
    expect(await comptesAvecAdresse(b.email)).toBe(1);
    expect((await ligneInvitation(token)).usedAt).not.toBeNull();
  });

  test('un mot de passe refuse ne consomme pas l invitation', async () => {
    const b = corps();
    const { token } = await createInvitation(b.email);
    const refus = await request(app).post('/register').send({ ...b, password: 'abc', invitationToken: token });
    expect(refus.status).toBe(400);
    expect((await ligneInvitation(token)).usedAt).toBeNull();
    const ok = await request(app).post('/register').send({ ...b, invitationToken: token });
    expect(ok.status).toBe(201);
    expect((await ligneInvitation(token)).usedAt).not.toBeNull();
  });

  test('la porte fermee refuse meme avec une invitation valide, sans la consommer', async () => {
    delete process.env.REGISTRATION_OPEN;
    const b = corps();
    const { token } = await createInvitation(b.email);
    const res = await request(app).post('/register').send({ ...b, invitationToken: token });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/ferm/);
    expect((await ligneInvitation(token)).usedAt).toBeNull();
    expect(await comptesAvecAdresse(b.email)).toBe(0);
  });
});