const prisma = require('../config/prisma');

// Un jeton temporaire de connexion vit 5 minutes : une fois expire, jwt.verify le refuse
// de toute facon, donc on n'a plus besoin de se souvenir qu'il a servi.
// Supprime les jetons utilises dont la date d'expiration est passee. Renvoie le nombre supprime.
async function purgeExpiredPendingTokens(now = new Date()) {
  const { count } = await prisma.usedPendingToken.deleteMany({
    where: { expiresAt: { lt: now } }
  });
  return count;
}

module.exports = { purgeExpiredPendingTokens };
