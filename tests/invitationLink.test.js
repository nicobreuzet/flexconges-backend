const prisma = require('../config/prisma');
const { createInvitation, buildInvitationLink, inviteNewCompany } = require('../utils/invitations');
const { createCompanyWithManager } = require('./helpers');

const DAY = 24 * 3600 * 1000;
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
const TOKEN = 'a'.repeat(64);

describe('buildInvitationLink', () => {
  test('construit le lien avec un fragment', () => {
    expect(buildInvitationLink('https://flexconges.netlify.app', TOKEN))
      .toBe(`https://flexconges.netlify.app/#invitation=${TOKEN}`);
  });

  test('retire la barre finale de l adresse du front', () => {
    expect(buildInvitationLink('https://flexconges.netlify.app/', TOKEN))
      .toBe(`https://flexconges.netlify.app/#invitation=${TOKEN}`);
  });

  test('accepte http sur localhost', () => {
    expect(buildInvitationLink('http://localhost:3000', TOKEN))
      .toBe(`http://localhost:3000/#invitation=${TOKEN}`);
  });

  test.each([
    ['http hors localhost', 'http://example.com'],
    ['vide', ''],
    ['absente', undefined],
    ['pas une adresse', 'pas une url'],
    ['avec un chemin', 'https://x.netlify.app/chemin'],
    ['avec une requete', 'https://x.netlify.app/?a=1'],
    ['avec un fragment', 'https://x.netlify.app/#h']
  ])('refuse une adresse de front invalide (%s)', (_label, frontUrl) => {
    expect(() => buildInvitationLink(frontUrl, TOKEN)).toThrow('Adresse du front invalide');
  });

  test.each([
    ['trop court', 'abc'],
    ['absent', undefined],
    ['caracteres hors hexadecimal', 'g'.repeat(64)]
  ])('refuse un jeton mal forme (%s)', (_label, token) => {
    expect(() => buildInvitationLink('https://flexconges.netlify.app', token)).toThrow('Jeton invalide');
  });
});

describe('inviteNewCompany', () => {
  test('cree une invitation pour une adresse neuve', async () => {
    const email = `nouveau${uniq()}@test.com`;
    const r = await inviteNewCompany(email);
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    expect(r.invitation.email).toBe(email);
    expect(r.autresValides).toBe(0);
  });

  test('compte les autres invitations valides pour la meme adresse', async () => {
    const email = `double${uniq()}@test.com`;
    const premiere = await inviteNewCompany(email);
    expect(premiere.autresValides).toBe(0);
    const seconde = await inviteNewCompany(email);
    expect(seconde.autresValides).toBe(1);
    expect(seconde.token).not.toBe(premiere.token);
  });

  test('ignore une invitation expiree dans ce compte', async () => {
    const email = `ancien${uniq()}@test.com`;
    await createInvitation(email, { now: new Date(Date.now() - 10 * DAY) });
    const r = await inviteNewCompany(email);
    expect(r.autresValides).toBe(0);
  });

  test('normalise l adresse', async () => {
    const local = `norm${uniq()}`;
    const r = await inviteNewCompany(`  ${local.toUpperCase()}@Test.COM  `);
    expect(r.invitation.email).toBe(`${local}@test.com`);
  });

  test('refuse une adresse invalide', async () => {
    await expect(inviteNewCompany('pas-un-email')).rejects.toThrow('Adresse e-mail invalide');
  });

  test('refuse une adresse qui a deja un compte', async () => {
    const c = await createCompanyWithManager('InvitDeja');
    await expect(inviteNewCompany(c.email)).rejects.toThrow('Un compte existe d\u00e9j\u00e0 pour cette adresse');
  }, 30000);

  test('ne cree aucune invitation quand un compte existe', async () => {
    const c = await createCompanyWithManager('InvitAucune');
    const avant = await prisma.companyInvitation.count({ where: { email: c.email } });
    await expect(inviteNewCompany(c.email)).rejects.toThrow('Un compte existe');
    const apres = await prisma.companyInvitation.count({ where: { email: c.email } });
    expect(apres).toBe(avant);
  }, 30000);
});