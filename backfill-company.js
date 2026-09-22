const prisma = require('./config/prisma');

async function main() {
  const existing = await prisma.company.count();
  if (existing > 0) {
    console.log(`Arrêt : ${existing} société(s) existe(nt) déjà. Rien n'a été modifié.`);
    return;
  }

  const company = await prisma.company.create({
    data: { name: 'FlexCongés (démo)' }
  });

  const where = { companyId: null };
  const data = { companyId: company.id };

  const [users, leaveTypes, leaveRequests, leaveBalances, holidays] =
    await prisma.$transaction([
      prisma.user.updateMany({ where, data }),
      prisma.leaveType.updateMany({ where, data }),
      prisma.leaveRequest.updateMany({ where, data }),
      prisma.leaveBalance.updateMany({ where, data }),
      prisma.holiday.updateMany({ where, data }),
    ]);

  console.log('Société créée, id =', company.id);
  console.log('Utilisateurs rattachés :', users.count);
  console.log('Types de congés rattachés :', leaveTypes.count);
  console.log('Demandes rattachées :', leaveRequests.count);
  console.log('Soldes rattachés :', leaveBalances.count);
  console.log('Jours fériés rattachés :', holidays.count);
}

main()
  .catch((e) => {
    console.error('Erreur :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());