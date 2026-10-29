const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee } = require('./helpers');
const { DEFAULT_BRANDING, DEFAULT_RULES } = require('../utils/companyConfig');

jest.setTimeout(30000);

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const patch = (token, body) => request(app).patch('/company').set(auth(token)).send(body);
const getCompany = (token) => request(app).get('/company').set(auth(token));
const companyIdOf = async (email) => (await prisma.user.findUnique({ where: { email } })).companyId;
const storedCompany = async (email) => prisma.company.findUnique({ where: { id: await companyIdOf(email) } });

describe('Réglages du cabinet : identité, rôles, règles (C9)', () => {
  test('Par défaut : les trois blocs sont renvoyés avec leurs valeurs par défaut', async () => {
    const c = await createCompanyWithManager('CC-defaut');
    const res = await getCompany(c.token);
    expect(res.status).toBe(200);
    // Une societe neuve porte desormais le nom de la societe (et non le nom de demonstration).
    expect(res.body.brandingConfig).toEqual({ ...DEFAULT_BRANDING, name: c.company.name });
    expect(res.body.rulesConfig).toEqual(DEFAULT_RULES);
    expect(res.body.roleConfig.manager.singular).toBe('Manager');
    expect(res.body.roleConfig.manager.permissions.canAdmin).toBe(true);
    expect(res.body.roleConfig.employee.permissions.canAdmin).toBe(false);
  });

  test('Un changement de règle valide est enregistré et fusionné avec l\'existant', async () => {
    const c = await createCompanyWithManager('CC-regles');
    const res = await patch(c.token, { rulesConfig: { noticeDays: 30 } });
    expect(res.status).toBe(200);
    expect(res.body.rulesConfig).toEqual({ ...DEFAULT_RULES, noticeDays: 30 });
    const stored = await storedCompany(c.email);
    expect(stored.rulesConfig).toEqual({ ...DEFAULT_RULES, noticeDays: 30 });
  });

  test('Tout ce qui est invalide est refusé et ne change rien', async () => {
    const c = await createCompanyWithManager('CC-invalide');
    const avant = await storedCompany(c.email);
    const bad = [
      { brandingConfig: { primaryColor: 'red' } },
      { brandingConfig: { inconnu: 'x' } },
      { brandingConfig: [] },
      { brandingConfig: null },
      { roleConfig: { admin: { singular: 'X' } } },
      { roleConfig: { manager: { color: 'red' } } },
      { rulesConfig: { noticeDays: -1 } },
      { rulesConfig: { noticeDays: '14' } },
      { rulesConfig: { workflowLevels: 2 } },
      { rulesConfig: 'texte' },
    ];
    for (const body of bad) {
      const res = await patch(c.token, body);
      expect(res.status).toBe(400);
    }
    const apres = await storedCompany(c.email);
    expect(apres.brandingConfig).toEqual(avant.brandingConfig);
    expect(apres.roleConfig).toEqual(avant.roleConfig);
    expect(apres.rulesConfig).toEqual(avant.rulesConfig);
  });

  test('Tout ou rien : une règle invalide empêche aussi les autres champs d\'être enregistrés', async () => {
    const c = await createCompanyWithManager('CC-toutourien');
    const avant = (await getCompany(c.token)).body;
    const res = await patch(c.token, { sector: 'secteur-tout-ou-rien', rulesConfig: { noticeDays: -1 } });
    expect(res.status).toBe(400);
    const apres = (await getCompany(c.token)).body;
    expect(apres.sector).toBe(avant.sector);
  });

  test('Un employé ne peut pas modifier les règles', async () => {
    const c = await createCompanyWithManager('CC-employe');
    const emp = await createEmployee(c.token);
    const res = await patch(emp.token, { rulesConfig: { noticeDays: 1 } });
    expect(res.status).toBe(403);
    expect((await getCompany(c.token)).body.rulesConfig.noticeDays).toBe(14);
  });

  test('Ce que le front envoie pour les rôles est accepté, mais les permissions restent celles du serveur', async () => {
    const c = await createCompanyWithManager('CC-roles');
    const res = await patch(c.token, {
      roleConfig: {
        manager: {
          singular: 'Associé', plural: 'Associés', feminine: 'Associée', icon: '⚖️', color: '#dc2626',
          badgeClass: 'role-manager',
          permissions: { canApprove: false, canManageUsers: false, canSeeReports: false, canAdmin: false, canManageBilling: false },
        },
        employee: {
          singular: 'Avocat', plural: 'Avocats', feminine: 'Avocate', icon: '👤', color: '#2d7a4f',
          badgeClass: 'role-employee',
          permissions: { canApprove: true, canManageUsers: true, canSeeReports: true, canAdmin: true, canManageBilling: true },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.roleConfig.manager.singular).toBe('Associé');
    expect(res.body.roleConfig.employee.singular).toBe('Avocat');
    // Les permissions renvoyées sont celles du serveur, pas celles envoyées par le client
    expect(res.body.roleConfig.manager.permissions.canAdmin).toBe(true);
    expect(res.body.roleConfig.employee.permissions.canAdmin).toBe(false);
    expect(res.body.roleConfig.employee.permissions.canApprove).toBe(false);
    // Et elles ne sont jamais stockées
    const stored = (await storedCompany(c.email)).roleConfig;
    expect(stored.manager.permissions).toBeUndefined();
    expect(stored.manager.badgeClass).toBeUndefined();
    expect(stored.employee.permissions).toBeUndefined();
  });

  test('Une modification partielle des rôles n\'efface pas l\'autre rôle', async () => {
    const c = await createCompanyWithManager('CC-roles-partiel');
    expect((await patch(c.token, { roleConfig: { manager: { singular: 'Associé' } } })).status).toBe(200);
    expect((await patch(c.token, { roleConfig: { employee: { singular: 'Avocat' } } })).status).toBe(200);
    const res = await getCompany(c.token);
    expect(res.body.roleConfig.manager.singular).toBe('Associé');
    expect(res.body.roleConfig.employee.singular).toBe('Avocat');
  });

  test('L\'identité envoyée comme le fait le front (champs vides compris) est acceptée', async () => {
    const c = await createCompanyWithManager('CC-identite');
    const res = await patch(c.token, {
      sector: 'law',
      brandingConfig: {
        name: 'Cabinet Martin', sidebarSubtitle: '', welcomeMsg: '', teamLabel: 'Pôle',
        primaryColor: '#0d1b2a', accentColor: '#c9a84c',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.sector).toBe('law');
    expect(res.body.brandingConfig.name).toBe('Cabinet Martin');
    expect(res.body.brandingConfig.sidebarSubtitle).toBe('');
    expect(res.body.brandingConfig.teamLabel).toBe('Pôle');
  });

  test('Les réglages d\'un cabinet ne touchent pas un autre cabinet', async () => {
    const a = await createCompanyWithManager('CC-iso-A');
    const b = await createCompanyWithManager('CC-iso-B');
    expect((await patch(a.token, { rulesConfig: { noticeDays: 3 }, roleConfig: { manager: { singular: 'Associé' } } })).status).toBe(200);
    const get = await getCompany(b.token);
    expect(get.body.rulesConfig.noticeDays).toBe(14);
    expect(get.body.roleConfig.manager.singular).toBe('Manager');
  });

  test('Un changement de règle est tracé (ancienne et nouvelle valeur), sans doublon « company.updated »', async () => {
    const c = await createCompanyWithManager('CC-audit-regles');
    const countUpdated = async () =>
      (await request(app).get('/audit-logs?action=company.updated').set(auth(c.token))).body.items.length;
    const avant = await countUpdated();

    expect((await patch(c.token, { rulesConfig: { noticeDays: 30 } })).status).toBe(200);

    const res = await request(app).get('/audit-logs?action=company.rules_updated').set(auth(c.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].details.de.noticeDays).toBe(14);
    expect(res.body.items[0].details.vers.noticeDays).toBe(30);
    expect(await countUpdated()).toBe(avant);
  });

  test('Les trois blocs modifiés ensemble laissent trois traces d\'audit', async () => {
    const c = await createCompanyWithManager('CC-audit-trois');
    const res = await patch(c.token, {
      brandingConfig: { name: 'Cabinet Martin' },
      roleConfig: { employee: { singular: 'Avocat' } },
      rulesConfig: { maxSimultaneousAbsences: 3 },
    });
    expect(res.status).toBe(200);
    for (const action of ['company.branding_updated', 'company.roles_updated', 'company.rules_updated']) {
      const r = await request(app).get(`/audit-logs?action=${action}`).set(auth(c.token));
      expect(r.body.items).toHaveLength(1);
    }
  });

  test('Des données corrompues déjà en base ressortent propres (valeurs par défaut, permissions du serveur)', async () => {
    const c = await createCompanyWithManager('CC-corrompu');
    await prisma.company.update({
      where: { id: await companyIdOf(c.email) },
      data: {
        brandingConfig: { primaryColor: 'rouge' },
        roleConfig: { employee: { singular: '', permissions: { canAdmin: true } } },
        rulesConfig: { noticeDays: 'abc', workflowLevels: 2 },
      },
    });
    const res = await getCompany(c.token);
    expect(res.body.brandingConfig.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
    expect(res.body.roleConfig.employee.singular).toBe('Employé');
    expect(res.body.roleConfig.employee.permissions.canAdmin).toBe(false);
    expect(res.body.rulesConfig.noticeDays).toBe(14);
    expect(res.body.rulesConfig.workflowLevels).toBe(1);
  });

  test('Une modification vide n\'efface pas les règles existantes', async () => {
    const c = await createCompanyWithManager('CC-vide');
    expect((await patch(c.token, { rulesConfig: { noticeDays: 7 } })).status).toBe(200);
    expect((await patch(c.token, { rulesConfig: {} })).status).toBe(200);
    expect((await getCompany(c.token)).body.rulesConfig.noticeDays).toBe(7);
  });
});