// Cree une invitation de cabinet et ecrit UNE ligne de JSON (ASCII pur) sur la sortie standard.
// Usage : DATABASE_URL et INVITE_FRONT_URL poses AVANT le lancement, puis : node scripts/create-invitation.js adresse@exemple.fr
// Le lien contient le jeton : il ne doit jamais etre affiche ni copie dans une discussion.

const KNOWN = new Set([
  'Adresse e-mail invalide',
  'Un compte existe d\u00e9j\u00e0 pour cette adresse',
  'Adresse du front invalide',
  'Jeton invalide'
]);

function out(obj) {
  const json = JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  process.stdout.write(json + '\n');
}

async function main() {
  // Avant tout require : config/prisma.js chargerait .env (la base de DEVELOPPEMENT) si rien n'est pose.
  if (!process.env.DATABASE_URL) {
    out({ ok: false, error: 'DATABASE_URL absente : ce script ne vise jamais une base par defaut' });
    process.exitCode = 1;
    return;
  }
  const email = process.argv[2];
  if (!email) {
    out({ ok: false, error: 'Adresse e-mail manquante' });
    process.exitCode = 1;
    return;
  }

  let prisma = null;
  try {
    prisma = require('../config/prisma');
    const { buildInvitationLink, inviteNewCompany } = require('../utils/invitations');
    const front = process.env.INVITE_FRONT_URL;
    // Verifie l'adresse du front AVANT de creer quoi que ce soit (jeton factice).
    buildInvitationLink(front, 'a'.repeat(64));
    const { token, invitation, autresValides } = await inviteNewCompany(email);
    out({
      ok: true,
      link: buildInvitationLink(front, token),
      email: invitation.email,
      invitationId: invitation.id,
      expiresAt: invitation.expiresAt.toISOString(),
      autresValides
    });
  } catch (error) {
    const message = error && error.message;
    out({
      ok: false,
      error: KNOWN.has(message) ? message : 'Erreur inattendue (' + ((error && (error.code || error.name)) || 'inconnue') + ')'
    });
    process.exitCode = 1;
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

main();