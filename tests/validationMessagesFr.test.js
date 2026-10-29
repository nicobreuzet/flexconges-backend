// Tache 3.5 : les messages de validation des reglages du cabinet sont en francais et ne citent
// jamais un nom de champ technique (noticeDays, sidebarSubtitle...) : le front les affiche tels quels.
const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager } = require('./helpers');

jest.setTimeout(30000);

let token;
beforeAll(async () => {
  token = (await createCompanyWithManager('MsgFr')).token;
});

const patch = (body) => request(app).patch('/company').set({ Authorization: `Bearer ${token}` }).send(body);
const long = (n) => 'x'.repeat(n);

// Un nom en camelCase, ou l'un des anciens messages "<champ> doit ..." des champs en un seul mot.
const TECHNIQUE = /[a-z][A-Z]|\b(name|singular|plural|feminine|icon|color) doit\b/;

const cas = [
  ['identite : nom vide', { brandingConfig: { name: '' } }, /organisation/i],
  ['identite : sous-titre trop long', { brandingConfig: { sidebarSubtitle: long(81) } }, /sous-titre/i],
  ['identite : message d accueil trop long', { brandingConfig: { welcomeMsg: long(201) } }, /accueil/i],
  ['identite : libelle d equipe vide', { brandingConfig: { teamLabel: '' } }, /.quipe/i],
  ['identite : couleur principale invalide', { brandingConfig: { primaryColor: 'rouge' } }, /principale/i],
  ['identite : couleur d accent invalide', { brandingConfig: { accentColor: 'rouge' } }, /accent/i],
  ['role manager : singulier vide', { roleConfig: { manager: { singular: '' } } }, /^R.le manager : .*singulier/i],
  ['role manager : pluriel vide', { roleConfig: { manager: { plural: '' } } }, /^R.le manager : .*pluriel/i],
  ['role manager : feminin vide', { roleConfig: { manager: { feminine: '' } } }, /^R.le manager : .*f.minin/i],
  ['role manager : icone vide', { roleConfig: { manager: { icon: '' } } }, /^R.le manager : .*ic.ne/i],
  ['role manager : couleur invalide', { roleConfig: { manager: { color: 'red' } } }, /^R.le manager : .*couleur/i],
  ['role employe : singulier vide', { roleConfig: { employee: { singular: '' } } }, /^R.le employ. : .*singulier/i],
  ['regle : preavis negatif', { rulesConfig: { noticeDays: -1 } }, /pr.avis/i],
  ['regle : trop d absents simultanes', { rulesConfig: { maxSimultaneousAbsences: 1000 } }, /absents/i],
  ['regle : date de report trop longue', { rulesConfig: { carryOverDate: long(41) } }, /report/i],
  ['regle : second niveau de validation', { rulesConfig: { workflowLevels: 2 } }, /niveau/i],
  ['securite : duree d inactivite', { securityConfig: { sessionInactivityHours: 3 } }, /inactivit/i],
  ['securite : obligation du 2FA non booleenne', { requireTwoFactor: 'oui' }, /2FA/]
];

describe('Messages de validation en francais', () => {
  test.each(cas)('%s', async (_nom, corps, motif) => {
    const res = await patch(corps);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(motif);
    expect(res.body.error).not.toMatch(TECHNIQUE);
  });

  test('temoin : une cle inconnue est toujours nommee dans le message', async () => {
    const res = await patch({ brandingConfig: { logo: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/logo/);
  });
});