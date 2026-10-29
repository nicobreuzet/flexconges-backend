// SIRET : stocke a l'inscription et valide aux deux endroits (/register et PATCH /company).
const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createInvitation } = require('../utils/invitations');
const { createCompanyWithManager } = require('./helpers');

jest.setTimeout(30000);

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const patch = (token, body) => request(app).patch('/company').set(auth(token)).send(body);
const SIRET = '82341567800012';

function corps(extra = {}) {
  const id = uniq();
  return {
    companyName: `Societe siret ${id}`,
    email: `siret${id}@test.com`,
    password: 'Motdepasse123!',
    firstName: 'Test',
    lastName: 'Siret',
    ...extra
  };
}
async function inscrire(extra) {
  const b = corps(extra);
  const inv = await createInvitation(b.email);
  const res = await request(app).post('/register').send({ ...b, invitationToken: inv.token });
  return { b, inv, res };
}
const stocke = (companyId) => prisma.company.findUnique({ where: { id: companyId } });

describe('SIRET a l inscription (/register)', () => {
  test('un SIRET valide (avec espaces) est stocke normalise dans la societe', async () => {
    const { res } = await inscrire({ siret: '823 415 678 00012' });
    expect(res.status).toBe(201);
    expect((await stocke(res.body.company.id)).siret).toBe(SIRET);
  });

  test('sans SIRET, l inscription reste possible et le SIRET est vide (compatibilite)', async () => {
    const { res } = await inscrire({});
    expect(res.status).toBe(201);
    expect((await stocke(res.body.company.id)).siret).toBeNull();
  });

  test('un SIRET vide ou d espaces est traite comme absent', async () => {
    const { res } = await inscrire({ siret: '   ' });
    expect(res.status).toBe(201);
    expect((await stocke(res.body.company.id)).siret).toBeNull();
  });

  test('un SIRET invalide est refuse en 400 sans rien creer ni consommer l invitation', async () => {
    const b = corps({ siret: '1234' });
    const inv = await createInvitation(b.email);
    const res = await request(app).post('/register').send({ ...b, invitationToken: inv.token });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SIRET/);
    expect(await prisma.company.findFirst({ where: { name: b.companyName } })).toBeNull();
    expect(await prisma.user.count({ where: { email: b.email } })).toBe(0);
    const ligne = await prisma.companyInvitation.findUnique({ where: { id: inv.invitation.id } });
    expect(ligne.usedAt).toBeNull();

    const ok = await request(app).post('/register').send({ ...b, siret: SIRET, invitationToken: inv.token });
    expect(ok.status).toBe(201);
  });
});

describe('SIRET dans PATCH /company', () => {
  test('un SIRET valide est enregistre normalise et renvoye normalise', async () => {
    const c = await createCompanyWithManager('SiretPatch');
    const res = await patch(c.token, { siret: ' 823 415 678 00012 ' });
    expect(res.status).toBe(200);
    expect(res.body.siret).toBe(SIRET);
    expect((await stocke(c.company.id)).siret).toBe(SIRET);
  });

  test('un SIRET invalide est refuse en 400 et l ancien SIRET est conserve', async () => {
    const c = await createCompanyWithManager('SiretRefus');
    expect((await patch(c.token, { siret: SIRET })).status).toBe(200);
    const res = await patch(c.token, { siret: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SIRET/);
    expect((await stocke(c.company.id)).siret).toBe(SIRET);
  });

  test('un nombre JSON est refuse (400), pas une erreur du serveur', async () => {
    const c = await createCompanyWithManager('SiretNombre');
    const res = await patch(c.token, { siret: 82341567800012 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SIRET/);
  });

  test('un SIRET vide efface la valeur (comportement existant)', async () => {
    const c = await createCompanyWithManager('SiretVide');
    expect((await patch(c.token, { siret: SIRET })).status).toBe(200);
    const res = await patch(c.token, { siret: '' });
    expect(res.status).toBe(200);
    expect((await stocke(c.company.id)).siret).toBeNull();
  });
});