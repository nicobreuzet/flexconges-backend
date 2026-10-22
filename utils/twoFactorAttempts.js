const prisma = require('../config/prisma');

// Reserve UN essai de 2e etape pour le couple (compte, adresse IP), en une seule
// instruction SQL : la base numerote les essais un par un, meme si 20 requetes
// arrivent en meme temps. Le verrou est pose quand le numero atteint "max".
// Si un ancien verrou est expire, le compteur repart de 1.
// Renvoie { failures, lockedUntil } : le numero de CET essai et la fin du verrou (ou null).
//
// Les dates sont calculees PAR LA BASE en UTC (now() AT TIME ZONE 'UTC'), comme Prisma
// les stocke : aucune date JavaScript ne passe en parametre, donc aucun decalage de
// fuseau horaire possible, que le serveur soit a Paris ou en UTC.
async function reserveIpAttempt(userId, ip, { max, lockMinutes }) {
  const rows = await prisma.$queryRaw`
    INSERT INTO "TwoFactorLoginAttempt" AS t ("userId", "ip", "failures", "updatedAt")
    VALUES (${userId}::int, ${ip}, 1, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("userId", "ip") DO UPDATE SET
      "failures" = CASE
        WHEN t."lockedUntil" <= (now() AT TIME ZONE 'UTC') THEN 1
        ELSE t."failures" + 1
      END,
      "lockedUntil" = CASE
        WHEN t."lockedUntil" <= (now() AT TIME ZONE 'UTC') THEN NULL
        WHEN t."lockedUntil" IS NULL AND t."failures" + 1 >= ${max}::int
          THEN (now() AT TIME ZONE 'UTC') + (${lockMinutes}::int * interval '1 minute')
        ELSE t."lockedUntil"
      END,
      "updatedAt" = (now() AT TIME ZONE 'UTC')
    RETURNING "failures", "lockedUntil"
  `;
  return { failures: Number(rows[0].failures), lockedUntil: rows[0].lockedUntil };
}

// Apres un succes : on oublie les echecs de ce couple (compte, IP).
async function clearIpAttempts(userId, ip) {
  await prisma.twoFactorLoginAttempt.deleteMany({ where: { userId, ip } });
}

module.exports = { reserveIpAttempt, clearIpAttempts };