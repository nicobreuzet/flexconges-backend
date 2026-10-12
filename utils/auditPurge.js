const prisma = require('../config/prisma');
const { purgeOldSessions, SESSION_RETENTION_DAYS } = require('./sessionPurge');

// Duree de conservation du journal d audit
const RETENTION_MONTHS = 12;
const PURGE_EVERY_HOURS = 24;
const FIRST_RUN_DELAY_SECONDS = 30;

// Date limite : tout ce qui est plus ancien est supprime
function cutoffDate(now = new Date()) {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - RETENTION_MONTHS);
  return d;
}

// Supprime les lignes de plus de 12 mois (toutes societes). Renvoie le nombre supprime.
async function purgeOldAuditLogs(now = new Date()) {
  const { count } = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoffDate(now) } }
  });
  return count;
}

// Version "securisee" pour le planificateur : n echoue JAMAIS, ne logue que le nombre
async function runPurgeSafely() {
  try {
    const n = await purgeOldAuditLogs();
    if (n > 0) console.log('Purge du journal d audit : ' + n + ' ligne(s) de plus de ' + RETENTION_MONTHS + ' mois supprimee(s)');
  } catch (error) {
    console.error('Erreur de la purge du journal d audit :', error.message);
  }
  // Sessions de plus de 30 jours : meme tache, mais echec independant de la purge du journal
  try {
    const s = await purgeOldSessions();
    if (s > 0) console.log('Purge des sessions : ' + s + ' session(s) de plus de ' + SESSION_RETENTION_DAYS + ' jours supprimee(s)');
  } catch (error) {
    console.error('Erreur de la purge des sessions :', error.message);
  }
}

// Premiere passe peu apres le demarrage, puis toutes les 24 h.
// unref() : ces minuteurs ne maintiennent jamais le processus en vie.
// Renvoie une fonction pour tout arreter (utile aux tests).
function startAuditPurge() {
  const first = setTimeout(runPurgeSafely, FIRST_RUN_DELAY_SECONDS * 1000);
  const every = setInterval(runPurgeSafely, PURGE_EVERY_HOURS * 3600 * 1000);
  console.log('Purge du journal d audit planifiee : lignes de plus de ' + RETENTION_MONTHS + ' mois, 1re passe dans ' + FIRST_RUN_DELAY_SECONDS + ' s puis toutes les ' + PURGE_EVERY_HOURS + ' h (sessions : plus de ' + SESSION_RETENTION_DAYS + ' jours)');
  first.unref();
  every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}

module.exports = { RETENTION_MONTHS, cutoffDate, purgeOldAuditLogs, runPurgeSafely, startAuditPurge };