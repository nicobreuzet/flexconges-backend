const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { SESSION_RETENTION_DAYS, sessionCutoff, purgeOldSessions } = require('../utils/sessionPurge');
const { runPurgeSafely } = require('../utils/auditPurge');
const { createCompanyWithManager } = require('./helpers');

const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

describe('Purge des anciennes sessions (30 jours)', () => {
  test('La date limite est exactement 30 jours avant la date donnee', () => {
    expect(SESSION_RETENTION_DAYS).toBe(30);
    expect(sessionCutoff(new Date('2027-10-07T12:00:00.000Z')).toISOString()).toBe('2027-09-07T12:00:00.000Z');
  });

  test('Supprime les sessions de plus de 30 jours, garde les autres, et le jeton courant reste valable', async () => {
    const company = await createCompanyWithManager('purge-sessions');
    const mk = (createdAt, revokedAt = null) => prisma.session.create({
      data: {
        userId: company.manager.id, companyId: company.company.id,
        createdAt, lastSeenAt: createdAt, revokedAt, userAgent: 'test-purge'
      }
    });
    const vieille = await mk(daysAgo(31));
    const vieilleRevoquee = await mk(daysAgo(40), daysAgo(39));
    const recente = await mk(daysAgo(29));
    const aujourdhui = await mk(new Date());

    // On ne compte pas les suppressions : une autre suite de tests peut purger en meme temps
    // (runPurgeSafely dans auditPurge.test.js). Les identifiants ci-dessous prouvent le resultat.
    await purgeOldSessions();

    const ids = [vieille.id, vieilleRevoquee.id, recente.id, aujourdhui.id];
    const reste = await prisma.session.findMany({ where: { id: { in: ids } }, select: { id: true } });
    expect(reste.map((s) => s.id).sort()).toEqual([recente.id, aujourdhui.id].sort());

    // La session creee par la vraie connexion du manager n'a pas ete touchee
    const res = await request(app).get('/company').set('Authorization', 'Bearer ' + company.token);
    expect(res.status).toBe(200);
  }, 30000);

  test('La tache planifiee (runPurgeSafely) purge aussi les sessions', async () => {
    const company = await createCompanyWithManager('purge-sessions-tache');
    const vieille = await prisma.session.create({
      data: {
        userId: company.manager.id, companyId: company.company.id,
        createdAt: daysAgo(45), lastSeenAt: daysAgo(45), userAgent: 'test-purge'
      }
    });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runPurgeSafely();
    spy.mockRestore();
    expect(await prisma.session.findUnique({ where: { id: vieille.id } })).toBeNull();
  }, 30000);
});