// Responsable direct : une donnee informative sur la fiche d'un collaborateur (pas de routage des demandes).
// Un responsable valide = un utilisateur ACTIF de la MEME societe, au role manager, different de la personne.
// Ces tests passent uniquement par l'API.
const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee } = require('./helpers');

jest.setTimeout(120000);

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
const fixer = (token, id, managerId) => request(app).put(`/users/${id}`).set(auth(token)).send({ managerId });
const modifier = (token, id, corps) => request(app).put(`/users/${id}`).set(auth(token)).send(corps);
const promouvoir = (token, id) => modifier(token, id, { role: 'manager' });
const lister = async (token) => (await request(app).get('/users').set(auth(token))).body;
const fiche = async (token, id) => (await lister(token)).find((u) => u.id === id);

// Un cabinet : le manager m, un employe e (la cible), un employe r promu responsable.
async function cabinet(label) {
  const m = await createCompanyWithManager(label);
  const e = await createEmployee(m.token);
  const r = await createEmployee(m.token);
  expect((await promouvoir(m.token, r.user.id)).status).toBe(200);
  return { m, e, r };
}

describe('Responsable direct', () => {
  test('un responsable actif de la meme societe peut etre designe : fiche, liste et /me le montrent', async () => {
    const { m, e, r } = await cabinet('RdValide');
    const res = await fixer(m.token, e.user.id, r.user.id);
    expect(res.status).toBe(200);
    expect(res.body.managerId).toBe(r.user.id);
    expect((await fiche(m.token, e.user.id)).managerId).toBe(r.user.id);
    const me = await request(app).get('/me').set(auth(e.token));
    expect(me.body.managerId).toBe(r.user.id);
  });

  test('a la creation, on peut indiquer le responsable direct', async () => {
    const m = await createCompanyWithManager('RdCreation');
    const res = await request(app).post('/users').set(auth(m.token)).send({
      email: `rd${uniq()}@test.com`, firstName: 'Test', lastName: 'Cree', role: 'employee', managerId: m.manager.id
    });
    expect(res.status).toBe(201);
    expect(res.body.managerId).toBe(m.manager.id);
  });

  test('refus (400) : employe, desactive, autre societe, inexistant, soi-meme, mauvais types ; rien ne change', async () => {
    const { m, e, r } = await cabinet('RdRefus');
    const e2 = await createEmployee(m.token);
    const inactif = await createEmployee(m.token);
    expect((await promouvoir(m.token, inactif.user.id)).status).toBe(200);
    expect((await request(app).patch(`/users/${inactif.user.id}/deactivate`).set(auth(m.token))).status).toBe(200);
    const autre = await createCompanyWithManager('RdRefusAutre');

    const invalides = [
      e2.user.id, inactif.user.id, autre.manager.id, 99999999, 0, -1,
      'abc', String(r.user.id), 1.5, true, [r.user.id], { id: r.user.id }
    ];
    for (const v of invalides) {
      const res = await fixer(m.token, e.user.id, v);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/responsable direct/i);
    }
    // une personne ne peut pas etre son propre responsable
    const soi = await fixer(m.token, r.user.id, r.user.id);
    expect(soi.status).toBe(400);
    expect((await fiche(m.token, e.user.id)).managerId).toBeNull();
    expect((await fiche(m.token, r.user.id)).managerId).toBeNull();
  });

  test('retirer avec null efface ; une modification sans managerId ne change rien', async () => {
    const { m, e, r } = await cabinet('RdRetrait');
    expect((await fixer(m.token, e.user.id, r.user.id)).body.managerId).toBe(r.user.id);
    const sans = await modifier(m.token, e.user.id, { firstName: 'Nouveau' });
    expect(sans.status).toBe(200);
    expect((await fiche(m.token, e.user.id)).managerId).toBe(r.user.id);
    const retire = await fixer(m.token, e.user.id, null);
    expect(retire.status).toBe(200);
    expect(retire.body.managerId).toBeNull();
    expect((await fiche(m.token, e.user.id)).managerId).toBeNull();
  });

  test('un cycle direct est refuse (A a pour responsable B, puis B ne peut pas avoir A)', async () => {
    const { m, r } = await cabinet('RdCycle');
    expect((await fixer(m.token, r.user.id, m.manager.id)).status).toBe(200);
    const cycle = await fixer(m.token, m.manager.id, r.user.id);
    expect(cycle.status).toBe(400);
    expect((await fiche(m.token, m.manager.id)).managerId).toBeNull();
  });

  test('le lien est conserve quand le responsable est desactive, puis retrograde', async () => {
    const { m, e, r } = await cabinet('RdLien');
    expect((await fixer(m.token, e.user.id, r.user.id)).status).toBe(200);
    expect((await request(app).patch(`/users/${r.user.id}/deactivate`).set(auth(m.token))).status).toBe(200);
    expect((await fiche(m.token, e.user.id)).managerId).toBe(r.user.id);
    expect((await request(app).patch(`/users/${r.user.id}/reactivate`).set(auth(m.token))).status).toBe(200);
    expect((await modifier(m.token, r.user.id, { role: 'employee' })).status).toBe(200);
    expect((await fiche(m.token, e.user.id)).managerId).toBe(r.user.id);
  });

  test('audit : une ligne user.manager_changed par vrai changement, aucune quand la valeur ne change pas', async () => {
    const { m, e, r } = await cabinet('RdAudit');
    expect((await fixer(m.token, e.user.id, r.user.id)).status).toBe(200);
    expect((await fixer(m.token, e.user.id, r.user.id)).status).toBe(200);
    expect((await fixer(m.token, e.user.id, null)).status).toBe(200);
    const lignes = await prisma.auditLog.findMany({
      where: { companyId: m.company.id, action: 'user.manager_changed' },
      orderBy: { id: 'asc' }
    });
    expect(lignes).toHaveLength(2);
    expect(lignes[0].details.cibleId).toBe(e.user.id);
    expect(lignes[0].details.de).toBeNull();
    expect(lignes[0].details.vers).toBe(r.user.id);
    expect(lignes[1].details.de).toBe(r.user.id);
    expect(lignes[1].details.vers).toBeNull();
  });

  test('temoin : modifier une fiche sans managerId reste accepte', async () => {
    const { m, e } = await cabinet('RdTemoin1');
    expect((await modifier(m.token, e.user.id, { firstName: 'Autre' })).status).toBe(200);
  });

  test('temoin : un role invalide reste refuse', async () => {
    const { m, e } = await cabinet('RdTemoin2');
    expect((await modifier(m.token, e.user.id, { role: 'admin' })).status).toBe(400);
  });
});