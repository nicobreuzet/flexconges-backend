// Script local scripts/add-french-holidays.js : ajoute les jours feries aux societes EXISTANTES.
// Simulation par defaut ; ecriture seulement avec --apply ET la reponse OUI ; jamais de doublon.
const { spawnSync } = require('child_process');
const path = require('path');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');

jest.setTimeout(120000);

const RACINE = path.join(__dirname, '..');
const SCRIPT = path.join(RACINE, 'scripts', 'add-french-holidays.js');
const annee = () => new Date().getUTCFullYear();

// Lance le script dans un processus separe ; la DERNIERE ligne non vide de la sortie est un JSON.
function lancer(args, { input = '', env = process.env } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { input, env, encoding: 'utf8', cwd: RACINE, timeout: 90000 });
  const lignes = (r.stdout || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  let json = null;
  try { json = JSON.parse(lignes[lignes.length - 1]); } catch (e) { json = null; }
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', json };
}
const nb = (id) => prisma.holiday.count({ where: { companyId: id } });
async function cabinetSansFeries(label) {
  const c = await createCompanyWithManager(label);
  await prisma.holiday.deleteMany({ where: { companyId: c.company.id } });
  return c.company.id;
}

describe('scripts/add-french-holidays.js', () => {
  test('simulation par defaut : n ecrit rien et annonce 33 jours a ajouter', async () => {
    const id = await cabinetSansFeries('ScriptSimulation');
    const r = lancer(['--company', String(id)]);
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ mode: 'simulation', societes: 1, a_ajouter: 33 });
    expect(await nb(id)).toBe(0);
  });

  test('--apply sans la reponse OUI : annule et n ecrit rien', async () => {
    const id = await cabinetSansFeries('ScriptRefus');
    const r = lancer(['--company', String(id), '--apply'], { input: 'non\n' });
    expect(r.out).toMatch(/Annul/);
    expect(r.code).toBe(1);
    expect(await nb(id)).toBe(0);
  });

  test('--apply avec OUI : cree 33 jours pour la seule societe visee et laisse une ligne d audit', async () => {
    const a = await cabinetSansFeries('ScriptApplyA');
    const b = await cabinetSansFeries('ScriptApplyB');
    const r = lancer(['--company', String(a), '--apply'], { input: 'OUI\n' });
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ mode: 'ecriture', societes: 1, ajoutes: 33 });
    expect(await nb(a)).toBe(33);
    expect(await nb(b)).toBe(0);
    expect(await prisma.auditLog.count({ where: { companyId: a, action: 'holiday.bulk_created' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { companyId: b, action: 'holiday.bulk_created' } })).toBe(0);
  });

  test('un second passage n ajoute rien', async () => {
    const id = await cabinetSansFeries('ScriptIdempotent');
    expect(lancer(['--company', String(id), '--apply'], { input: 'OUI\n' }).code).toBe(0);
    const r = lancer(['--company', String(id), '--apply'], { input: 'OUI\n' });
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ mode: 'ecriture', societes: 1, ajoutes: 0 });
    expect(await nb(id)).toBe(33);
  });

  test('un jour deja present (meme date) n est pas duplique et garde son libelle', async () => {
    const id = await cabinetSansFeries('ScriptDoublon');
    await prisma.holiday.create({ data: { companyId: id, date: new Date(`${annee()}-12-25T00:00:00.000Z`), label: 'Noel du cabinet' } });
    const r = lancer(['--company', String(id), '--apply'], { input: 'OUI\n' });
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ mode: 'ecriture', societes: 1, ajoutes: 32 });
    expect(await nb(id)).toBe(33);
    const noel = await prisma.holiday.findMany({ where: { companyId: id, date: new Date(`${annee()}-12-25T00:00:00.000Z`) } });
    expect(noel).toHaveLength(1);
    expect(noel[0].label).toBe('Noel du cabinet');
  });

  test('refuse de tourner sans DATABASE_URL', () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const r = lancer(['--company', '1'], { env });
    expect(r.out + r.err).toMatch(/DATABASE_URL/);
    expect(r.code).toBe(1);
  });

  test('refuse un identifiant de societe invalide', () => {
    const r = lancer(['--company', 'abc']);
    expect(r.out + r.err).toMatch(/--company/);
    expect(r.code).toBe(1);
  });
});