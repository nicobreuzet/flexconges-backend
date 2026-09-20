const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.leaveType.createMany({
    data: [
      { code: 'CP', label: 'Congés payés', color: '#3B82F6', annualCap: 25 },
      { code: 'RTT', label: 'RTT', color: '#10B981', annualCap: 10 },
      { code: 'MAL', label: 'Arrêt maladie', color: '#c0392b', requiresProof: true },
      { code: 'EXC', label: 'Congé Exceptionnel', color: '#d97706', requiresProof: true, annualCap: 5 },
      { code: 'TT', label: 'Télétravail', color: '#7c3aed' },
      { code: 'CSS', label: 'Congé Sans Solde', color: '#94a3b8' }
    ]
  });
  console.log('Types de congés créés !');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());