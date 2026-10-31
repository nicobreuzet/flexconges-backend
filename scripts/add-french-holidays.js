// Ajoute les jours feries francais (annee en cours + 2 suivantes) aux societes EXISTANTES.
// Usage : DATABASE_URL pose AVANT le lancement, puis :
//   node scripts/add-french-holidays.js [--company N] [--apply] [--noms]
// Simulation par defaut (n'ecrit rien). Ecriture : --apply ET reponse OUI. Jamais de doublon (meme date).
// Une ligne de JSON (ASCII) est ecrite EN DERNIER sur la sortie standard.

const readline = require('readline');

function out(obj) {
  const json = JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  process.stdout.write(json + '\n');
}
function fail(message) {
  out({ ok: false, error: message });
  process.exitCode = 1;
}
function say(text) {
  process.stdout.write(text + '\n');
}
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.question(question, (a) => { answered = true; rl.close(); resolve(String(a).trim()); });
    rl.on('close', () => { if (!answered) resolve(''); });
  });
}

async function main() {
  // Avant tout require : config/prisma.js chargerait .env (la base de DEVELOPPEMENT) si rien n'est pose.
  if (!process.env.DATABASE_URL) {
    fail('DATABASE_URL absente : ce script ne vise jamais une base par defaut');
    return;
  }
  const args = process.argv.slice(2);
  let companyId = null;
  let apply = false;
  let noms = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') apply = true;
    else if (a === '--noms') noms = true;
    else if (a === '--company') {
      const v = args[i + 1];
      if (!/^[0-9]+$/.test(v || '')) { fail('--company attend un identifiant numerique'); return; }
      companyId = Number(v);
      i++;
    } else { fail('Option inconnue : ' + a); return; }
  }

  let host = 'illisible';
  try { host = new URL(process.env.DATABASE_URL).hostname; } catch (e) { host = 'illisible'; }
  say('Base visee (hote) : ' + host);
  say(apply ? 'Mode : ECRITURE (apres confirmation)' : 'Mode : simulation (rien n\'est ecrit)');

  const prisma = require('../config/prisma');
  const { createHolidaysForCompany } = require('../utils/frenchHolidays');
  try {
    const societes = await prisma.company.findMany({
      where: companyId === null ? {} : { id: companyId },
      select: { id: true, name: true },
      orderBy: { id: 'asc' }
    });
    if (societes.length === 0) { fail('Aucune societe trouvee'); return; }

    let total = 0;
    for (const s of societes) {
      const n = await createHolidaysForCompany(prisma, s.id, new Date(), 2, { dryRun: true });
      total += n;
      say('Societe ' + s.id + (noms ? ' (' + s.name + ')' : '') + ' : ' + n + ' jour(s) a ajouter');
    }

    if (!apply) {
      out({ mode: 'simulation', societes: societes.length, a_ajouter: total });
      return;
    }
    if (total === 0) {
      say('Rien a ajouter.');
      out({ mode: 'ecriture', societes: societes.length, ajoutes: 0 });
      return;
    }
    const reponse = await ask('Ecrire ' + total + ' jour(s) dans la base ' + host + ' ? Taper OUI : ');
    process.stdout.write('\n');
    if (reponse !== 'OUI') {
      say('Annule : rien n\'a ete ecrit.');
      out({ mode: 'annule' });
      process.exitCode = 1;
      return;
    }
    const y = new Date().getUTCFullYear();
    let ajoutes = 0;
    for (const s of societes) {
      const n = await prisma.$transaction(async (tx) => {
        const cree = await createHolidaysForCompany(tx, s.id);
        if (cree > 0) {
          await tx.auditLog.create({
            data: {
              companyId: s.id,
              action: 'holiday.bulk_created',
              details: { ajoutes: cree, annees: [y, y + 1, y + 2] },
              userAgent: 'script local'
            }
          });
        }
        return cree;
      });
      ajoutes += n;
      say('Societe ' + s.id + ' : ' + n + ' jour(s) ajoute(s)');
    }
    out({ mode: 'ecriture', societes: societes.length, ajoutes });
  } catch (error) {
    fail(String(error && error.message ? error.message : error).split('\n')[0].slice(0, 200));
  } finally {
    await prisma.$disconnect();
  }
}

main();