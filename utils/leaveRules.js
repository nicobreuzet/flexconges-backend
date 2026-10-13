// Règles du cabinet appliquées aux demandes de congé : préavis et absences simultanées.
// Le SERVEUR décide ; le front se contente d'afficher le message.
// Réglages lus dans Company.rulesConfig via utils/companyConfig.js (0 = pas de règle).
const prisma = require('../config/prisma');
const { getRulesConfig } = require('./companyConfig');

const DAY_MS = 24 * 60 * 60 * 1000;

// Tout est calculé en JOURS UTC (AAAA-MM-JJ) : même résultat sur un PC à Paris et sur Render.
function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function dayIndex(iso) {
  return Math.round(Date.parse(iso + 'T00:00:00Z') / DAY_MS);
}
function fromIndex(i) {
  return new Date(i * DAY_MS).toISOString().slice(0, 10);
}
function frDate(iso) {
  return iso.split('-').reverse().join('/');
}

// Jours travaillés d'une période : ni week-ends ni jours fériés.
function listWorkingDays(startIso, endIso, holidaySet = new Set()) {
  const days = [];
  const last = dayIndex(endIso);
  for (let i = dayIndex(startIso); i <= last; i++) {
    const weekday = new Date(i * DAY_MS).getUTCDay();
    const iso = fromIndex(i);
    if (weekday === 0 || weekday === 6 || holidaySet.has(iso)) continue;
    days.push(iso);
  }
  return days;
}

// Préavis en jours calendaires. Ne s'applique qu'aux types avec un solde annuel (annualCap) :
// un arrêt maladie ou un congé sans solde ne peuvent pas respecter un préavis.
function checkNotice({ noticeDays, annualCap, startIso, todayIso }) {
  if (!noticeDays || !annualCap) return { ok: true };
  const today = dayIndex(todayIso);
  if (dayIndex(startIso) - today >= noticeDays) return { ok: true };
  return {
    ok: false,
    error: `Préavis insuffisant : ce type de congé demande ${noticeDays} jour(s) de préavis. Premier jour possible : ${frDate(fromIndex(today + noticeDays))}.`
  };
}

// Premier jour où la demande ferait dépasser le maximum d'absents (le demandeur compte pour 1).
// otherRanges : demandes des AUTRES membres de l'équipe, [{ userId, startIso, endIso }].
// Un même collaborateur n'est compté qu'une fois par jour.
function findCrowdedDay({ workingDays, otherRanges, max }) {
  for (const day of workingDays) {
    const absents = new Set();
    for (const r of otherRanges) {
      if (r.startIso <= day && day <= r.endIso) absents.add(r.userId);
    }
    if (absents.size + 1 > max) return day;
  }
  return null;
}

// Vérifie les règles du cabinet pour une demande qui va passer « en attente ».
// Renvoie { ok: true } ou { ok: false, error }. Les managers ne sont pas bloqués pour leurs
// propres demandes. Le rôle est lu EN BASE (le jeton peut être périmé).
async function checkLeaveRules({ userId, companyId, leaveType, startDate, endDate, now = new Date() }) {
  if (!Number.isInteger(companyId)) {
    throw new Error('companyId manquant : appel refusé pour éviter un mélange de sociétés');
  }

  const [company, requester] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { rulesConfig: true } }),
    prisma.user.findFirst({ where: { id: userId, companyId }, select: { role: true, teamId: true } })
  ]);
  if (!company || !requester) return { ok: false, error: 'Utilisateur introuvable' };
  if (requester.role === 'manager') return { ok: true };

  const rules = getRulesConfig(company.rulesConfig);
  const startIso = isoDay(startDate);
  const endIso = isoDay(endDate);

  const notice = checkNotice({
    noticeDays: rules.noticeDays,
    annualCap: leaveType.annualCap,
    startIso,
    todayIso: isoDay(now)
  });
  if (!notice.ok) return notice;

  // Absences simultanées : uniquement pour un collaborateur qui a une équipe.
  const max = rules.maxSimultaneousAbsences;
  if (max > 0 && requester.teamId !== null) {
    const holidays = await prisma.holiday.findMany({
      where: { companyId, date: { gte: new Date(startIso), lte: new Date(endIso) } },
      select: { date: true }
    });
    const holidaySet = new Set(holidays.map((h) => isoDay(h.date)));
    const workingDays = listWorkingDays(startIso, endIso, holidaySet);
    if (workingDays.length === 0) return { ok: true };

    const others = await prisma.leaveRequest.findMany({
      where: {
        companyId,
        userId: { not: userId },
        status: { in: ['pending', 'approved'] },
        startDate: { lte: new Date(endIso) },
        endDate: { gte: new Date(startIso) },
        user: { teamId: requester.teamId, isActive: true, companyId }
      },
      select: { userId: true, startDate: true, endDate: true }
    });
    const otherRanges = others.map((r) => ({
      userId: r.userId, startIso: isoDay(r.startDate), endIso: isoDay(r.endDate)
    }));

    const crowded = findCrowdedDay({ workingDays, otherRanges, max });
    if (crowded) {
      return {
        ok: false,
        error: `Trop d'absences simultanées dans votre équipe le ${frDate(crowded)} : ${max} maximum.`
      };
    }
  }

  return { ok: true };
}

module.exports = { checkLeaveRules, checkNotice, findCrowdedDay, listWorkingDays, isoDay, frDate };