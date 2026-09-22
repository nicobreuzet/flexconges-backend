const prisma = require('../config/prisma');

// Garde-fou : les tests n'ont le droit de tourner que sur une base locale dont le nom finit par _test
const dbUrl = new URL(process.env.DATABASE_URL);
const dbName = dbUrl.pathname.replace('/', '');
if (dbUrl.hostname !== 'localhost' || !dbName.endsWith('_test')) {
  throw new Error(
    `Tests refusés : base visée = ${dbUrl.hostname}/${dbName}. ` +
    `Une base locale dont le nom finit par _test est exigée.`
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});