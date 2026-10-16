// Convertit les secrets 2FA encore en clair en secrets chiffrés (format "v1:").
//
// Usage :
//   node scripts/encrypt-2fa-secrets.js                                  -> simulation (ne modifie RIEN)
//   node scripts/encrypt-2fa-secrets.js --apply --confirm-db=<nom_base>  -> applique
//
// Sans danger à relancer : les secrets déjà chiffrés sont ignorés.
// N'affiche JAMAIS un secret ni la clé : uniquement des nombres.
const prisma = require('../config/prisma');
const {
  encryptSecret, decryptSecret, isEncrypted, assertKeyConfigured
} = require('../utils/twoFactorCrypto');

async function main() {
  const apply = process.argv.includes('--apply');
  const confirmArg = process.argv.find((a) => a.startsWith('--confirm-db='));
  const confirmedDb = confirmArg ? confirmArg.split('=')[1] : '';

  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.replace('/', '');
  console.log(`Base visée : ${url.hostname} / ${dbName}`);
  console.log(apply ? 'Mode : APPLICATION' : 'Mode : simulation (rien ne sera modifié)');

  assertKeyConfigured(); // clé absente ou invalide : on s'arrête avant de toucher à la base

  if (apply && confirmedDb !== dbName) {
    throw new Error(
      `STOP : ajoute --confirm-db=${dbName} pour confirmer la base visée (reçu : "${confirmedDb || 'rien'}"). Rien n'a été modifié.`
    );
  }

  const users = await prisma.user.findMany({
    where: { twoFactorSecret: { not: null } },
    select: { id: true, twoFactorSecret: true }
  });
  const toConvert = users.filter((u) => !isEncrypted(u.twoFactorSecret));

  console.log(`Comptes avec un secret 2FA : ${users.length}`);
  console.log(`Déjà chiffrés : ${users.length - toConvert.length}`);
  console.log(`À convertir : ${toConvert.length}`);

  if (!apply) {
    console.log("Simulation terminée : rien n'a été modifié.");
    return;
  }

  let converted = 0;
  let skipped = 0;
  let failed = 0;
  for (const u of toConvert) {
    try {
      const encrypted = encryptSecret(u.twoFactorSecret);
      // Contrôle avant d'écrire : le déchiffrement doit redonner exactement le secret d'origine
      if (decryptSecret(encrypted) !== u.twoFactorSecret) throw new Error('contrôle');
      // La condition sur l'ancienne valeur évite d'écraser un secret modifié entre-temps
      const res = await prisma.user.updateMany({
        where: { id: u.id, twoFactorSecret: u.twoFactorSecret },
        data: { twoFactorSecret: encrypted }
      });
      if (res.count === 1) converted++;
      else skipped++;
    } catch (e) {
      failed++;
    }
  }
  console.log(`Convertis : ${converted} | ignorés (modifiés entre-temps) : ${skipped} | échecs : ${failed}`);

  const remaining = await prisma.user.count({
    where: {
      twoFactorSecret: { not: null },
      NOT: { twoFactorSecret: { startsWith: 'v1:' } }
    }
  });
  console.log(`Secrets restant en clair : ${remaining}`);
  if (failed > 0 || remaining > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
