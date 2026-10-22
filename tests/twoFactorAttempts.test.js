const prisma = require('../config/prisma');
const { reserveIpAttempt, clearIpAttempts } = require('../utils/twoFactorAttempts');

const OPTS = { max: 5, lockMinutes: 15 };
// Aucune relation avec User : un identifiant au hasard suffit, et on nettoie apres
const userId = 1000000000 + Math.floor(Math.random() * 1000000000);
const ip = '203.0.113.50';

async function nettoyer() {
  await prisma.twoFactorLoginAttempt.deleteMany({ where: { userId } });
}
beforeEach(nettoyer);
afterAll(nettoyer);

describe('twoFactorAttempts : reservation atomique des essais par (compte, IP)', () => {
  test('Les essais sont numerotes 1, 2, 3... et le verrou est pose au 5e, pour environ 15 minutes', async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await reserveIpAttempt(userId, ip, OPTS));

    expect(results.map((r) => r.failures)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(results.slice(0, 4).every((r) => r.lockedUntil === null)).toBe(true);
    expect(results[4].lockedUntil).toBeInstanceOf(Date);

    // Verifie aussi qu il n y a pas de decalage de fuseau horaire
    const ms = results[4].lockedUntil.getTime() - Date.now();
    expect(ms).toBeGreaterThan(14 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
  });

  test('20 reservations simultanees recoivent chacune un numero different, de 1 a 20', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveIpAttempt(userId, ip, OPTS))
    );
    const numeros = results.map((r) => r.failures).sort((a, b) => a - b);
    expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test('Un verrou expire : le compteur repart de 1 et le verrou disparait', async () => {
    for (let i = 0; i < 5; i++) await reserveIpAttempt(userId, ip, OPTS);
    await prisma.twoFactorLoginAttempt.update({
      where: { userId_ip: { userId, ip } },
      data: { lockedUntil: new Date(Date.now() - 1000) }
    });
    const r = await reserveIpAttempt(userId, ip, OPTS);
    expect(r.failures).toBe(1);
    expect(r.lockedUntil).toBeNull();
  });

  test('Deux adresses IP ont des compteurs independants', async () => {
    await reserveIpAttempt(userId, ip, OPTS);
    await reserveIpAttempt(userId, ip, OPTS);
    const autre = await reserveIpAttempt(userId, '203.0.113.51', OPTS);
    expect(autre.failures).toBe(1);
  });

  test('clearIpAttempts remet le compteur a zero', async () => {
    for (let i = 0; i < 3; i++) await reserveIpAttempt(userId, ip, OPTS);
    await clearIpAttempts(userId, ip);
    const r = await reserveIpAttempt(userId, ip, OPTS);
    expect(r.failures).toBe(1);
  });
});