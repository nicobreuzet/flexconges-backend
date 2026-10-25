const crypto = require('crypto');
const prisma = require('../config/prisma');
const {
  INVITATION_VALID_DAYS,
  generateInvitationToken,
  hashInvitationToken,
  createInvitation
} = require('../utils/invitations');

function uniq() {
  return `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

describe('Jeton d invitation : generation et empreinte', () => {
  test('le jeton fait 64 caracteres hexadecimaux et l empreinte est son SHA-256', () => {
    const { token, tokenHash } = generateInvitationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(sha256(token));
    expect(tokenHash).not.toBe(token);
  });

  test('deux jetons successifs sont differents', () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  test('hashInvitationToken redonne l empreinte d un jeton genere', () => {
    const { token, tokenHash } = generateInvitationToken();
    expect(hashInvitationToken(token)).toBe(tokenHash);
  });

  test.each([
    [undefined], [null], [123], [''], ['abc'],
    ['a'.repeat(63)], ['a'.repeat(65)], ['g'.repeat(64)], ['A'.repeat(64)], [{}]
  ])('hashInvitationToken refuse la valeur %p', (valeur) => {
    expect(hashInvitationToken(valeur)).toBeNull();
  });
});

describe('createInvitation', () => {
  test('la duree par defaut est de 7 jours', () => {
    expect(INVITATION_VALID_DAYS).toBe(7);
  });

  test('stocke l empreinte et jamais le jeton', async () => {
    const email = `invit${uniq()}@test.com`;
    const { token, invitation } = await createInvitation(email);
    const row = await prisma.companyInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) }
    });
    expect(row).not.toBeNull();
    expect(row.id).toBe(invitation.id);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.usedAt).toBeNull();
    expect(row.companyId).toBeNull();
  });

  test('normalise l adresse (espaces et majuscules)', async () => {
    const local = `invit${uniq()}`;
    const { invitation } = await createInvitation(`  ${local.toUpperCase()}@Test.COM  `);
    expect(invitation.email).toBe(`${local}@test.com`);
  });

  test('expire 7 jours apres la date donnee', async () => {
    const now = new Date('2026-01-10T10:00:00.000Z');
    const { invitation } = await createInvitation(`invit${uniq()}@test.com`, { now });
    expect(invitation.expiresAt.getTime()).toBe(now.getTime() + 7 * 24 * 3600 * 1000);
  });

  test('accepte une duree personnalisee', async () => {
    const now = new Date('2026-01-10T10:00:00.000Z');
    const { invitation } = await createInvitation(`invit${uniq()}@test.com`, { now, days: 1 });
    expect(invitation.expiresAt.getTime()).toBe(now.getTime() + 24 * 3600 * 1000);
  });

  test('refuse une adresse invalide', async () => {
    await expect(createInvitation('pas-un-email')).rejects.toThrow('Adresse e-mail invalide');
  });

  test.each([[0], [-1], [1.5], ['7'], [NaN]])('refuse la duree %p', async (days) => {
    await expect(createInvitation(`invit${uniq()}@test.com`, { days })).rejects.toThrow('Dur\u00e9e invalide');
  });
});