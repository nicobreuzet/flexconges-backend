const prisma = require('../config/prisma');

// Les echecs de 2e etape sont gardes par couple (compte, adresse IP). Une adresse IP est une
// donnee personnelle : on ne la conserve pas au-dela du necessaire. Au bout de 24 h sans
// activite, la ligne est supprimee (le verrou ne dure que 15 minutes).
const ATTEMPT_RETENTION_HOURS = 24;

function attemptCutoff(now = new Date()) {
  return new Date(now.getTime() - ATTEMPT_RETENTION_HOURS * 3600 * 1000);
}

// Supprime les lignes dont la derniere activite date de plus de 24 h. Renvoie le nombre supprime.
async function purgeOldTwoFactorAttempts(now = new Date()) {
  const { count } = await prisma.twoFactorLoginAttempt.deleteMany({
    where: { updatedAt: { lt: attemptCutoff(now) } }
  });
  return count;
}

module.exports = { ATTEMPT_RETENTION_HOURS, attemptCutoff, purgeOldTwoFactorAttempts };