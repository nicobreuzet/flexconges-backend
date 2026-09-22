const prisma = require('./config/prisma');
const { createDefaultLeaveTypes } = require('./utils/defaultLeaveTypes');

// Usage : node seed.js <idDeLaSociété>
async function main() {
  const companyId = Number(process.argv[2]);
  if (!Number.isInteger(companyId)) {
    console.error('Usage : node seed.js <idDeLaSociété>   (exemple : node seed.js 1)');
    process.exit(1);
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    console.error(`Aucune société avec l'id ${companyId} dans cette base.`);
    process.exit(1);
  }

  // On affiche la base visée pour ne jamais se tromper de cible
  const host = new URL(process.env.DATABASE_URL).hostname;
  console.log(`Base : ${host} | Société : ${company.name} (id ${company.id})`);

  const result = await createDefaultLeaveTypes(prisma, company.id);
  console.log(`${result.count} type(s) de congé créé(s) (les types déjà présents sont ignorés).`);
}

main()
  .catch((e) => {
    console.error('Erreur :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());