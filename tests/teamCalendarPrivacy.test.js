// Calendrier d'equipe : un employe ne recoit pas les donnees sensibles de ses collegues
// (commentaires, adresse e-mail, type des absences sensibles). Un responsable recoit tout.
const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

jest.setTimeout(60000);

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const SECRET_EMP = 'motif-medical-prive-du-demandeur';
const SECRET_MGR = 'consigne-privee-du-responsable';

let mgr, A, B, ids;

async function demander(token, typeId, start, end, comment) {
  const res = await request(app).post('/leave-requests').set(auth(token))
    .send({ startDate: start, endDate: end, leaveTypeId: typeId, comment });
  expect(res.status).toBe(201);
  return res.body.id;
}
const tout = (token) => request(app).get('/leave-requests/all').set(auth(token));
const trouve = (body, id) => body.find((r) => r.id === id);

beforeAll(async () => {
  mgr = await createCompanyWithManager('CalPrive');
  A = await createEmployee(mgr.token);
  B = await createEmployee(mgr.token);
  const mat = await request(app).post('/leave-types').set(auth(mgr.token))
    .send({ code: 'MAT', label: 'Conge maternite', color: '#112233' });
  expect(mat.status).toBe(201);

  const mal = await getLeaveTypeId(A.token, 'MAL');
  const cp = await getLeaveTypeId(A.token, 'CP');
  const matId = await getLeaveTypeId(A.token, 'MAT');
  const malB = await getLeaveTypeId(B.token, 'MAL');
  ids = {
    malA: await demander(A.token, mal, '2027-09-06', '2027-09-08', SECRET_EMP),
    cpA: await demander(A.token, cp, '2027-09-13', '2027-09-15', 'vacances ' + SECRET_EMP),
    matA: await demander(A.token, matId, '2027-09-27', '2027-09-29', SECRET_EMP),
    malB: await demander(B.token, malB, '2027-09-20', '2027-09-22', 'mes notes ' + SECRET_EMP)
  };
  const dec = await request(app).patch(`/leave-requests/${ids.malA}/decision`).set(auth(mgr.token))
    .send({ decision: 'approved', managerComment: SECRET_MGR });
  expect(dec.status).toBe(200);
});

describe('GET /leave-requests/all : vue d un employe', () => {
  test('arret maladie d un collegue : type neutre, aucun commentaire, aucune adresse e-mail', async () => {
    const res = await tout(B.token);
    expect(res.status).toBe(200);
    const r = trouve(res.body, ids.malA);
    expect(r).toBeDefined();
    expect(r.leaveType.code).toBe('ABS');
    expect(r.leaveTypeId).toBeNull();
    expect(r.comment).toBeNull();
    expect(r.managerComment).toBeNull();
    expect(r.user.email).toBe('');
    expect(r.user.id).toBe(A.user.id);
    expect(typeof r.user.firstName).toBe('string');
    expect(r.status).toBe('approved');
    const brut = JSON.stringify(r);
    for (const interdit of [SECRET_EMP, SECRET_MGR, A.email, 'maladie', '"MAL"']) {
      expect(brut).not.toContain(interdit);
    }
  });

  test('conge paye d un collegue : type visible, mais ni commentaire ni adresse e-mail', async () => {
    const res = await tout(B.token);
    const r = trouve(res.body, ids.cpA);
    expect(r).toBeDefined();
    expect(r.leaveType.code).toBe('CP');
    expect(r.status).toBe('pending');
    expect(r.comment).toBeNull();
    expect(r.managerComment).toBeNull();
    expect(r.user.email).toBe('');
    expect(JSON.stringify(r)).not.toContain(SECRET_EMP);
  });

  test('type cree par le cabinet (conge maternite) : masque comme un arret maladie', async () => {
    const res = await tout(B.token);
    const r = trouve(res.body, ids.matA);
    expect(r).toBeDefined();
    expect(r.leaveType.code).toBe('ABS');
    expect(r.leaveTypeId).toBeNull();
    expect(JSON.stringify(r)).not.toContain('maternite');
  });

  test('temoin : ses propres demandes restent intactes (type, commentaire)', async () => {
    const res = await tout(B.token);
    const r = trouve(res.body, ids.malB);
    expect(r).toBeDefined();
    expect(r.leaveType.code).toBe('MAL');
    expect(typeof r.leaveTypeId).toBe('number');
    expect(r.comment).toContain(SECRET_EMP);
  });

  test('temoin : les demandes en attente des collegues restent visibles', async () => {
    const res = await tout(B.token);
    const vus = res.body.map((r) => r.id);
    for (const id of [ids.malA, ids.cpA, ids.matA, ids.malB]) expect(vus).toContain(id);
  });
});

describe('GET /leave-requests/all : vue d un responsable', () => {
  test('temoin : le responsable recoit tout (type, commentaires, adresse e-mail)', async () => {
    const res = await tout(mgr.token);
    expect(res.status).toBe(200);
    const r = trouve(res.body, ids.malA);
    expect(r).toBeDefined();
    expect(r.leaveType.code).toBe('MAL');
    expect(r.comment).toContain(SECRET_EMP);
    expect(r.managerComment).toBe(SECRET_MGR);
    expect(r.user.email).toBe(A.email);
  });
});