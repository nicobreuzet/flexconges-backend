require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = prisma;