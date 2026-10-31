// Jours feries francais (metropole, hors Alsace-Moselle) : 8 dates fixes + 3 qui dependent de Paques.
// Paques : algorithme de Meeus/Jones/Butcher (calendrier gregorien).

function easterUTC(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const isoDay = (d) => d.toISOString().slice(0, 10);
const plusDays = (d, n) => new Date(d.getTime() + n * 24 * 3600 * 1000);

// Les 11 jours feries d'une annee, tries par date : [{ date: 'AAAA-MM-JJ', label }]
function frenchHolidays(year) {
  if (!Number.isInteger(year) || year < 1583 || year > 9999) throw new Error('Annee invalide');
  const easter = easterUTC(year);
  const y = String(year);
  const list = [
    { date: y + '-01-01', label: "Jour de l'An" },
    { date: isoDay(plusDays(easter, 1)), label: 'Lundi de P\u00e2ques' },
    { date: y + '-05-01', label: 'F\u00eate du Travail' },
    { date: y + '-05-08', label: 'Victoire 1945' },
    { date: isoDay(plusDays(easter, 39)), label: 'Ascension' },
    { date: isoDay(plusDays(easter, 50)), label: 'Lundi de Pentec\u00f4te' },
    { date: y + '-07-14', label: 'F\u00eate Nationale' },
    { date: y + '-08-15', label: 'Assomption' },
    { date: y + '-11-01', label: 'Toussaint' },
    { date: y + '-11-11', label: 'Armistice' },
    { date: y + '-12-25', label: 'No\u00ebl' }
  ];
  return list.sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
}

// Cree les jours feries de l'annee en cours et des `yearsAhead` suivantes pour une societe.
// Saute ceux qui existent deja (la table n'a pas de contrainte d'unicite). Renvoie le nombre cree.
// `client` peut etre `prisma` ou le client d'une transaction (tx).
// dryRun : compte ce qui SERAIT cree sans rien ecrire (simulation de scripts/add-french-holidays.js).
async function createHolidaysForCompany(client, companyId, now = new Date(), yearsAhead = 2, { dryRun = false } = {}) {
  if (!Number.isInteger(companyId)) throw new Error('companyId manquant');
  const first = now.getUTCFullYear();
  const wanted = [];
  for (let y = first; y <= first + yearsAhead; y++) wanted.push(...frenchHolidays(y));
  const existing = await client.holiday.findMany({ where: { companyId }, select: { date: true } });
  const have = new Set(existing.map((h) => h.date.toISOString().slice(0, 10)));
  const data = wanted
    .filter((h) => !have.has(h.date))
    .map((h) => ({ date: new Date(h.date + 'T00:00:00.000Z'), label: h.label, companyId }));
  if (data.length > 0 && !dryRun) await client.holiday.createMany({ data });
  return data.length;
}

module.exports = { frenchHolidays, createHolidaysForCompany };