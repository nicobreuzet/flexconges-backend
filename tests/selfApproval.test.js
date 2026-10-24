const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, getLeaveTypeId } = require('./helpers');

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// Cree un second responsable dans la societe du premier (meme chemin qu un vrai
// collaborateur : invitation, puis choix du mot de passe), et le connecte.
async function createSecondManager(managerToken) {
  const email = `mgr2${uniq()}@test.com`;
  const password = 'MotDePasseTest123!';
  const res = await request(app).post('/users').set(bearer(managerToken))
    .send({ email, firstName: 'Second', lastName: 'Manager', role: 'manager' });
  if (res.status !== 201) {
    throw new Error(`Creation du second responsable echouee : ${res.status} ${JSON.stringify(res.body)}`);
  }
  const created = await prisma.user.findUnique({ where: { email } });
  if (!created || !created.resetToken) throw new Error('Jeton d invitation du second responsable introuvable');
  const reset = await request(app).post('/reset-password').send({ token: created.resetToken, password });
  if (reset.status !== 200) {
    throw new Error(`Mot de passe du second responsable refuse : ${reset.status} ${JSON.stringify(reset.body)}`);
  }
  const login = await request(app).post('/login').send({ email, password });
  if (login.status !== 200) throw new Error(`Connexion du second responsable echouee : ${login.status}`);
  return { id: created.id, email, token: login.body.token };
}

async function demander(token, startDate, endDate) {
  const leaveTypeId = await getLeaveTypeId(token, 'CP');
  const res = await request(app).post('/leave-requests').set(bearer(token)).send({ startDate, endDate, leaveTypeId });
  if (res.status !== 201) throw new Error(`Creation de demande echouee : ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function decider(token, id, decision) {
  return request(app).patch(`/leave-requests/${id}/decision`).set(bearer(token))
    .send({ decision, managerComment: 'test' });
}

async function statutDe(token, id) {
  const res = await request(app).get('/leave-requests/me').set(bearer(token));
  return res.body.find((r) => r.id === id).status;
}

async function enAttente(token) {
  const res = await request(app).get('/leave-requests/pending').set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.map((r) => r.id);
}

async function idSociete(email) {
  const u = await prisma.user.findUnique({ where: { email } });
  return u.companyId;
}

// Ligne du journal d audit pour une demande precise (recherche dans la societe du test)
async function auditDe(companyId, demandeId, action) {
  const logs = await prisma.auditLog.findMany({ where: { companyId, action } });
  return logs.find((l) => l.details && l.details.demandeId === demandeId);
}

describe('Valider sa propre demande : deux responsables dans la societe', () => {
  let A, B, companyId, R0;

  beforeAll(async () => {
    const c = await createCompanyWithManager('AutoValid2');
    A = c.token;
    companyId = await idSociete(c.email);
    B = await createSecondManager(A);
    R0 = await demander(A, '2027-07-05', '2027-07-06');
  });

  test('la liste en attente du demandeur ne contient pas sa propre demande', async () => {
    expect(await enAttente(A)).not.toContain(R0.id);
  });

  test('la liste en attente de l autre responsable contient la demande', async () => {
    expect(await enAttente(B.token)).toContain(R0.id);
  });

  test('un responsable ne peut pas approuver sa propre demande', async () => {
    const r = await demander(A, '2027-07-12', '2027-07-13');
    const res = await decider(A, r.id, 'approved');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/propre demande/);
    expect(await statutDe(A, r.id)).toBe('pending');
  });

  test('un responsable ne peut pas refuser sa propre demande', async () => {
    const r = await demander(A, '2027-07-19', '2027-07-20');
    const res = await decider(A, r.id, 'rejected');
    expect(res.status).toBe(403);
    expect(await statutDe(A, r.id)).toBe('pending');
  });

  test('l autre responsable peut approuver, sans marque d auto-validation', async () => {
    const r = await demander(A, '2027-07-26', '2027-07-27');
    const res = await decider(B.token, r.id, 'approved');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    const log = await auditDe(companyId, r.id, 'leave.approved');
    expect(log).toBeDefined();
    expect(log.userId).toBe(B.id);
    expect(log.details.autoValidation).toBeUndefined();
  });
});

describe('Valider sa propre demande : un seul responsable dans la societe', () => {
  let A, companyId, R1;

  beforeAll(async () => {
    const c = await createCompanyWithManager('AutoValid1');
    A = c.token;
    companyId = await idSociete(c.email);
    R1 = await demander(A, '2027-08-02', '2027-08-03');
  });

  test('sa liste en attente contient sa propre demande', async () => {
    expect(await enAttente(A)).toContain(R1.id);
  });

  test('il peut approuver sa propre demande', async () => {
    const res = await decider(A, R1.id, 'approved');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  test('l audit marque l auto-validation', async () => {
    const log = await auditDe(companyId, R1.id, 'leave.approved');
    expect(log).toBeDefined();
    expect(log.details.autoValidation).toBe(true);
  });
});

describe('Valider sa propre demande : le pair est desactive', () => {
  let A, B, companyId;

  beforeAll(async () => {
    const c = await createCompanyWithManager('AutoValidDesactive');
    A = c.token;
    companyId = await idSociete(c.email);
    B = await createSecondManager(A);
  });

  test('tant que l autre responsable est actif : refus', async () => {
    const r = await demander(A, '2027-09-06', '2027-09-07');
    const res = await decider(A, r.id, 'approved');
    expect(res.status).toBe(403);
    expect(await statutDe(A, r.id)).toBe('pending');
  });

  test('une fois l autre responsable desactive : auto-validation permise et tracee', async () => {
    const r = await demander(A, '2027-09-13', '2027-09-14');
    const desactive = await request(app).patch(`/users/${B.id}/deactivate`).set(bearer(A));
    expect(desactive.status).toBe(200);
    const res = await decider(A, r.id, 'approved');
    expect(res.status).toBe(200);
    const log = await auditDe(companyId, r.id, 'leave.approved');
    expect(log.details.autoValidation).toBe(true);
  });
});