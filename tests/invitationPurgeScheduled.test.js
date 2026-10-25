const prisma = require('../config/prisma');
const { createInvitation, hashInvitationToken } = require('../utils/invitations');
const { runPurgeSafely } = require('../utils/auditPurge');

const DAY = 24 * 3600 * 1000;
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
const existe = async (token) =>
  (await prisma.companyInvitation.findUnique({ where: { tokenHash: hashInvitationToken(token) } })) !== null;

describe('Purge planifiee : les invitations en font partie', () => {
  test('runPurgeSafely supprime une invitation expiree depuis 33 jours et garde une invitation valide', async () => {
    const ancienne = await createInvitation(`purge${uniq()}@test.com`, { now: new Date(Date.now() - 40 * DAY) });
    const valide = await createInvitation(`purge${uniq()}@test.com`);

    await runPurgeSafely();

    expect(await existe(ancienne.token)).toBe(false);
    expect(await existe(valide.token)).toBe(true);

    await prisma.companyInvitation.deleteMany({ where: { id: valide.invitation.id } });
  });
});