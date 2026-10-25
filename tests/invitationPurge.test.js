const prisma = require('../config/prisma');
const { createInvitation, hashInvitationToken } = require('../utils/invitations');
const { purgeOldInvitations, INVITATION_RETENTION_DAYS } = require('../utils/invitationPurge');

const DAY = 24 * 3600 * 1000;
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
const adresse = (p) => `${p}${uniq()}@test.com`;
const existe = async (token) =>
  (await prisma.companyInvitation.findUnique({ where: { tokenHash: hashInvitationToken(token) } })) !== null;

describe('Purge des invitations', () => {
  test('la duree de conservation apres expiration est de 30 jours', () => {
    expect(INVITATION_RETENTION_DAYS).toBe(30);
  });

  test('supprime les invitations expirees depuis plus de 30 jours (utilisees ou non), garde les autres', async () => {
    const now = new Date();
    const il = (jours) => new Date(now.getTime() - jours * DAY);

    // createInvitation(adresse, { now }) fixe l expiration a now + 7 jours.
    const ancienne = await createInvitation(adresse('pa'), { now: il(40) });
    const ancienneUtilisee = await createInvitation(adresse('pb'), { now: il(40) });
    await prisma.companyInvitation.update({
      where: { id: ancienneUtilisee.invitation.id },
      data: { usedAt: il(39) }
    });
    const recente = await createInvitation(adresse('pc'), { now: il(17) });
    const valide = await createInvitation(adresse('pd'), { now });

    await purgeOldInvitations(now);

    expect(await existe(ancienne.token)).toBe(false);
    expect(await existe(ancienneUtilisee.token)).toBe(false);
    expect(await existe(recente.token)).toBe(true);
    expect(await existe(valide.token)).toBe(true);

    await prisma.companyInvitation.deleteMany({
      where: { id: { in: [recente.invitation.id, valide.invitation.id] } }
    });
  });
});