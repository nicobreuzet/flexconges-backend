const prisma = require('../config/prisma');
const { ATTEMPT_RETENTION_HOURS, attemptCutoff, purgeOldTwoFactorAttempts } = require('../utils/twoFactorAttemptPurge');
const { runPurgeSafely } = require('../utils/auditPurge');

const hoursAgo = (n) => new Date(Date.now() - n * 3600 * 1000);
// Aucune relation avec User : un identifiant au hasard suffit, et on nettoie apres
const userId = 1000000000 + Math.floor(Math.random() * 1000000000);

async function nettoyer() {
  await prisma.twoFactorLoginAttempt.deleteMany({ where: { userId } });
}
beforeEach(nettoyer);
afterAll(nettoyer);

describe('Purge des echecs 2FA par adresse IP', () => {
  test('La duree de conservation est de 24 heures, date limite exacte', () => {
    expect(ATTEMPT_RETENTION_HOURS).toBe(24);
    const now = new Date('2027-10-07T12:00:00.000Z');
    expect(attemptCutoff(now).toISOString()).toBe('2027-10-06T12:00:00.000Z');
  });

  test('Supprime les lignes de plus de 24 h et garde les plus recentes (verifie par identifiant)', async () => {
    await prisma.twoFactorLoginAttempt.createMany({
      data: [
        { userId, ip: '203.0.113.60', failures: 3, updatedAt: hoursAgo(25) },
        { userId, ip: '203.0.113.61', failures: 2, updatedAt: hoursAgo(23) },
        { userId, ip: '203.0.113.62', failures: 1, updatedAt: new Date() }
      ]
    });

    await purgeOldTwoFactorAttempts();

    // On ne compte pas les suppressions (une autre suite peut purger en meme temps) :
    // on regarde ce qui reste pour CE compte.
    const reste = await prisma.twoFactorLoginAttempt.findMany({ where: { userId }, select: { ip: true } });
    expect(reste.map((r) => r.ip).sort()).toEqual(['203.0.113.61', '203.0.113.62']);
  });
});

describe('Purge planifiee : les echecs 2FA par adresse IP sont aussi purges', () => {
  test('runPurgeSafely supprime une ligne de 30 heures', async () => {
    await prisma.twoFactorLoginAttempt.create({
      data: { userId, ip: '203.0.113.70', failures: 2, updatedAt: hoursAgo(30) }
    });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runPurgeSafely();
    spy.mockRestore();
    const ligne = await prisma.twoFactorLoginAttempt.findUnique({
      where: { userId_ip: { userId, ip: '203.0.113.70' } }
    });
    expect(ligne).toBeNull();
  }, 30000);
});
