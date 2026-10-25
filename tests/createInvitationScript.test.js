const { spawnSync } = require('child_process');
const path = require('path');
const prisma = require('../config/prisma');
const { hashInvitationToken } = require('../utils/invitations');
const { createCompanyWithManager } = require('./helpers');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'create-invitation.js');
const FRONT = 'https://flexconges.netlify.app';
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;

// Lance le vrai script dans un processus separe. "retirer" = variables a enlever de l environnement.
function lancer(args, envPerso = {}, retirer = []) {
  const env = { ...process.env, INVITE_FRONT_URL: FRONT, ...envPerso };
  for (const nom of retirer) delete env[nom];
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env, encoding: 'utf8', timeout: 25000, cwd: path.join(__dirname, '..')
  });
  let json;
  let ligne;
  try {
    const lignes = String(r.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    ligne = lignes[lignes.length - 1] || '';
    json = JSON.parse(ligne);
  } catch (e) {
    throw new Error('Sortie illisible (code ' + r.status + ') stdout=' + String(r.stdout).replace(/#invitation=[0-9a-f]{64}/g, '#invitation=***').slice(-300) +
      ' stderr=' + String(r.stderr).slice(0, 300));
  }
  return { status: r.status, json, stdout: String(r.stdout), ligne };
}

const nbInvitations = (email) => prisma.companyInvitation.count({ where: { email } });

describe('scripts/create-invitation.js', () => {
  test('cree une invitation et renvoie un lien a fragment, sans stocker le jeton', async () => {
    const email = `script${uniq()}@test.com`;
    const r = lancer([email]);
    expect(r.status).toBe(0);
    expect(r.json.ok).toBe(true);
    expect(r.json.link).toMatch(/^https:\/\/flexconges\.netlify\.app\/#invitation=[0-9a-f]{64}$/);
    expect(r.json.email).toBe(email);
    expect(r.json.autresValides).toBe(0);
    const token = r.json.link.split('#invitation=')[1];
    const ligne = await prisma.companyInvitation.findUnique({ where: { tokenHash: hashInvitationToken(token) } });
    expect(ligne).not.toBeNull();
    expect(ligne.email).toBe(email);
    expect(ligne.id).toBe(r.json.invitationId);
    expect(JSON.stringify(ligne)).not.toContain(token);
  }, 30000);

  test('refuse de demarrer sans DATABASE_URL et ne cree rien', async () => {
    const email = `sansbase${uniq()}@test.com`;
    const r = lancer([email], {}, ['DATABASE_URL', 'DOTENV_CONFIG_PATH']);
    expect(r.status).toBe(1);
    expect(r.json.ok).toBe(false);
    expect(r.json.error).toMatch(/DATABASE_URL/);
    expect(await nbInvitations(email)).toBe(0);
  }, 30000);

  test('refuse une adresse qui a deja un compte (message en ASCII) et ne cree rien', async () => {
    const c = await createCompanyWithManager('ScriptDeja');
    const avant = await nbInvitations(c.email);
    const r = lancer([c.email]);
    expect(r.status).toBe(1);
    expect(r.json.ok).toBe(false);
    expect(r.json.error).toBe('Un compte existe d\u00e9j\u00e0 pour cette adresse');
    expect(r.ligne).toMatch(/^[\x00-\x7F]*$/);
    expect(await nbInvitations(c.email)).toBe(avant);
  }, 60000);

  test('refuse une adresse de front invalide AVANT de creer l invitation', async () => {
    const email = `frontko${uniq()}@test.com`;
    const r = lancer([email], { INVITE_FRONT_URL: 'http://example.com' });
    expect(r.status).toBe(1);
    expect(r.json.ok).toBe(false);
    expect(r.json.error).toMatch(/front/);
    expect(await nbInvitations(email)).toBe(0);
  }, 30000);

  test('refuse quand l adresse e-mail est absente', () => {
    const r = lancer([]);
    expect(r.status).toBe(1);
    expect(r.json.ok).toBe(false);
  }, 30000);
});