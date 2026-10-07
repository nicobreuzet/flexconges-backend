const prisma = require('../config/prisma');
const { RETENTION_MONTHS, cutoffDate, purgeOldAuditLogs, runPurgeSafely } = require('../utils/auditPurge');
const { createCompanyWithManager } = require('./helpers');

// Date situee a "n mois" avant maintenant, decalee de "jours" (positif = plus ancien)
const monthsAgo = (n, jours = 0) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(d.getUTCDate() - jours);
  return d;
};

describe('Purge du journal d audit (12 mois)', () => {
  test('Supprime ce qui a plus de 12 mois, garde le reste, toutes societes confondues', async () => {
    const A = await createCompanyWithManager('purge-A');
    const B = await createCompanyWithManager('purge-B');
    const mk = (c, createdAt, action) => prisma.auditLog.create({
      data: { companyId: c.company.id, userId: c.manager.id, action, createdAt }
    });

    const vieuxA = await mk(A, monthsAgo(13), 'test.purge.vieux');
    const limiteA = await mk(A, monthsAgo(12, 1), 'test.purge.douze_mois_et_un_jour');
    const justeAvantA = await mk(A, monthsAgo(12, -1), 'test.purge.douze_mois_moins_un_jour');
    const recentA = await mk(A, monthsAgo(11), 'test.purge.recent');
    const vieuxB = await mk(B, monthsAgo(24), 'test.purge.vieux');
    const recentB = await mk(B, new Date(), 'test.purge.recent');

    const supprimees = await purgeOldAuditLogs();
    expect(supprimees).toBeGreaterThanOrEqual(3); // vieuxA, limiteA, vieuxB (au moins)

    const ids = [vieuxA.id, limiteA.id, justeAvantA.id, recentA.id, vieuxB.id, recentB.id];
    const reste = await prisma.auditLog.findMany({ where: { id: { in: ids } }, select: { id: true } });
    expect(reste.map(r => r.id).sort((x, y) => x - y))
      .toEqual([justeAvantA.id, recentA.id, recentB.id].sort((x, y) => x - y));
  }, 30000);

  test('La date limite est exactement 12 mois avant la date donnee', () => {
    expect(RETENTION_MONTHS).toBe(12);
    expect(cutoffDate(new Date('2027-10-07T12:00:00.000Z')).toISOString()).toBe('2026-10-07T12:00:00.000Z');
  });

  test('Une panne de la base pendant la purge ne fait jamais planter le serveur', async () => {
    const spyDb = jest.spyOn(prisma.auditLog, 'deleteMany').mockRejectedValueOnce(new Error('panne simulee'));
    const spyErr = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runPurgeSafely()).resolves.toBeUndefined();
    expect(spyErr).toHaveBeenCalled();
    spyDb.mockRestore();
    spyErr.mockRestore();
  });
});