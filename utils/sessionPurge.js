const prisma = require('../config/prisma');

// Un jeton de connexion vit 7 jours au maximum : une session de plus de 30 jours
// ne peut plus servir a rien, on peut la supprimer sans deconnecter personne.
const SESSION_RETENTION_DAYS = 30;

function sessionCutoff(now = new Date()) {
  return new Date(now.getTime() - SESSION_RETENTION_DAYS * 24 * 3600 * 1000);
}

// Supprime les sessions creees il y a plus de 30 jours (revoquees ou non). Renvoie le nombre supprime.
async function purgeOldSessions(now = new Date()) {
  const { count } = await prisma.session.deleteMany({
    where: { createdAt: { lt: sessionCutoff(now) } }
  });
  return count;
}

module.exports = { SESSION_RETENTION_DAYS, sessionCutoff, purgeOldSessions };