// Tache 1.4b : la brique d'alerte seule (avant branchement dans la route).
const prisma = require('../config/prisma');
const { reserveAlert, buildAlertMessages } = require('../utils/twoFactorLockAlert');
const { createCompanyWithManager } = require('./helpers');

jest.setTimeout(60000);

const OPTS = { maxIp: 5, maxAccount: 20, lockMinutes: 15 };
const titulaire = { email: 'titulaire@example.test', firstName: 'Alice', lastName: 'Martin' };
// 25/10/2026 = jour du passage a l'heure d'hiver : 12:31 UTC = 13:31 a Paris
const quand = new Date('2026-10-25T12:31:00Z');

async function findUser(company) {
  return prisma.user.findUnique({ where: { email: company.email } });
}

describe('buildAlertMessages (fonction pure)', () => {
  test('portee ip : 1 mail pour le titulaire, sans IP, sans code, sans lien', () => {
    const msgs = buildAlertMessages({ portee: 'ip', user: titulaire, quand, ...OPTS });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].to).toBe('titulaire@example.test');
    expect(msgs[0].text).toContain('Alice');
    expect(msgs[0].text).toMatch(/5 fois/);
    expect(msgs[0].text).toMatch(/15 minutes/);
    expect(msgs[0].text).not.toMatch(/https?:/);
    expect(msgs[0].text).not.toMatch(/\d{6}/);
    expect(msgs[0].text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  test('portee compte : le titulaire puis chaque responsable, avec le nom du titulaire', () => {
    const msgs = buildAlertMessages({
      portee: 'compte', user: titulaire, managers: [{ email: 'resp@example.test' }], quand, ...OPTS
    });
    expect(msgs.map(m => m.to)).toEqual(['titulaire@example.test', 'resp@example.test']);
    expect(msgs[0].text).toMatch(/20 codes/);
    expect(msgs[1].text).toContain('Alice Martin');
    expect(msgs[1].text).toMatch(/20 codes/);
    expect(msgs[1].text).not.toMatch(/https?:/);
  });

  test('la date est au format francais, heure de Paris (13:31 le jour du changement d heure)', () => {
    const msgs = buildAlertMessages({ portee: 'ip', user: titulaire, quand, ...OPTS });
    expect(msgs[0].text).toMatch(/25\/10\/2026.{1,3}13:31/);
  });

  test('une portee inconnue est refusee', () => {
    expect(() => buildAlertMessages({ portee: 'x', user: titulaire, quand, ...OPTS })).toThrow();
  });
});

describe('reserveAlert (reservation atomique, 1 alerte par heure et par portee)', () => {
  test('la 1re reservation gagne, la 2e (dans l heure) perd', async () => {
    const u = await findUser(await createCompanyWithManager('alerte-util-1'));
    expect(await reserveAlert(u.id, 'ip')).toBe(true);
    expect(await reserveAlert(u.id, 'ip')).toBe(false);
  });

  test('les deux portees sont independantes', async () => {
    const u = await findUser(await createCompanyWithManager('alerte-util-2'));
    expect(await reserveAlert(u.id, 'ip')).toBe(true);
    expect(await reserveAlert(u.id, 'compte')).toBe(true);
  });

  test('apres une heure, une nouvelle alerte est de nouveau permise', async () => {
    const u = await findUser(await createCompanyWithManager('alerte-util-3'));
    expect(await reserveAlert(u.id, 'ip')).toBe(true);
    await prisma.user.update({
      where: { id: u.id },
      data: { twoFactorAlertIpAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }
    });
    expect(await reserveAlert(u.id, 'ip')).toBe(true);
  });

  test('10 reservations simultanees : une seule gagne', async () => {
    const u = await findUser(await createCompanyWithManager('alerte-util-4'));
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveAlert(u.id, 'compte')));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test('une portee inconnue est refusee', async () => {
    await expect(reserveAlert(1, 'x')).rejects.toThrow();
  });
});