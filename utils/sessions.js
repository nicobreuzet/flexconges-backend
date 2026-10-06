const prisma = require('../config/prisma');

// Durée d'inactivité au-delà de laquelle une session est refusée.
// (B5 la rendra configurable par cabinet ; ici, valeur par défaut.)
const INACTIVITY_HOURS = 8;
// On ne met "lastSeenAt" à jour qu'au plus toutes les 5 minutes (évite une écriture par requête).
const TOUCH_EVERY_MINUTES = 5;

// Crée une session pour une connexion réussie et renvoie son identifiant (à mettre dans le jeton).
async function createSession(req, user) {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      companyId: user.companyId,
      ip: req.ip || null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null
    },
    select: { id: true }
  });
  return session.id;
}

// Révoque toutes les sessions encore actives d'un utilisateur (sauf, éventuellement, une).
async function revokeUserSessions(userId, exceptSessionId = null) {
  const where = { userId, revokedAt: null };
  if (exceptSessionId) where.id = { not: exceptSessionId };
  const result = await prisma.session.updateMany({ where, data: { revokedAt: new Date() } });
  return result.count;
}

module.exports = { INACTIVITY_HOURS, TOUCH_EVERY_MINUTES, createSession, revokeUserSessions };
