const prisma = require('../config/prisma');

afterAll(async () => {
  await prisma.$disconnect();
});