const prisma = require('../config/prisma');

// Une invitation est gardee 30 jours apres son expiration, utilisee ou non : on ne conserve pas
// indefiniment une adresse e-mail. (La duree definitive sera decidee avec la tache 4.3.)
const INVITATION_RETENTION_DAYS = 30;

// Supprime les invitations expirees depuis plus de 30 jours. Renvoie le nombre supprime.
async function purgeOldInvitations(now = new Date()) {
  const limite = new Date(now.getTime() - INVITATION_RETENTION_DAYS * 24 * 3600 * 1000);
  const { count } = await prisma.companyInvitation.deleteMany({
    where: { expiresAt: { lt: limite } }
  });
  return count;
}

module.exports = { INVITATION_RETENTION_DAYS, purgeOldInvitations };