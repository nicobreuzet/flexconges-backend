const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

jest.setTimeout(30000);

const DAY_MS = 24 * 60 * 60 * 1000;
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const post = (token, body) => request(app).post('/leave-requests').set(auth(token)).send(body);
const patchRules = (token, rulesConfig) => request(app).patch('/company').set(auth(token)).send({ rulesConfig });
const submit = (token, id) => request(app).patch(`/leave-requests/${id}/submit`).set(auth(token));

// Jour travaillé (lundi à vendredi) situé dans `days` jours à partir d'aujourd'hui (UTC, comme le serveur).
function weekdayIn(days) {
  const d = new Date(Date.now() + days * DAY_MS);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Cabinet de test : un manager, `n` employés, et (si team) une équipe qui les réunit.
async function setup(label, n = 3, { team = true } = {}) {
  const c = await createCompanyWithManager(label);
  const cpId = await getLeaveTypeId(c.token, 'CP');
  const emps = [];
  for (let i = 0; i < n; i++) emps.push(await createEmployee(c.token));
  let teamRow = null;
  if (team) {
    teamRow = await prisma.team.create({ data: { name: `Equipe ${label}`, companyId: c.company.id } });
    await prisma.user.updateMany({
      where: { email: { in: emps.map((e) => e.email) } },
      data: { teamId: teamRow.id, team: teamRow.name }
    });
  }
  return { c, cpId, emps, team: teamRow };
}

describe('Règles du cabinet : préavis (14 jours par défaut)', () => {
  test('Un employé est refusé à 5 jours, avec le premier jour possible, et rien n\'est écrit', async () => {
    const { cpId, emps } = await setup('RP-refus', 1, { team: false });
    const day = weekdayIn(5);
    const res = await post(emps[0].token, { startDate: day, endDate: day, leaveTypeId: cpId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Préavis insuffisant/);
    expect(res.body.error).toMatch(/14 jour/);
    const premier = new Date(Date.now() + 14 * DAY_MS).toISOString().slice(0, 10).split('-').reverse().join('/');
    expect(res.body.error).toContain(premier);
    const user = await prisma.user.findUnique({ where: { email: emps[0].email } });
    expect(await prisma.leaveRequest.count({ where: { userId: user.id } })).toBe(0);
  });

  test('Une demande à 40 jours est acceptée', async () => {
    const { cpId, emps } = await setup('RP-loin', 1, { team: false });
    const day = weekdayIn(40);
    const res = await post(emps[0].token, { startDate: day, endDate: day, leaveTypeId: cpId });
    expect(res.status).toBe(201);
  });

  test('Avec un préavis à 0, la même demande à 5 jours est acceptée', async () => {
    const { c, cpId, emps } = await setup('RP-zero', 1, { team: false });
    expect((await patchRules(c.token, { noticeDays: 0 })).status).toBe(200);
    const day = weekdayIn(5);
    const res = await post(emps[0].token, { startDate: day, endDate: day, leaveTypeId: cpId });
    expect(res.status).toBe(201);
  });

  test('Un type sans solde annuel n\'est pas soumis au préavis', async () => {
    const { c, cpId, emps } = await setup('RP-sans-solde', 1, { team: false });
    const created = await request(app).post('/leave-types').set(auth(c.token))
      .send({ code: 'MALX', label: 'Maladie test', color: '#3B82F6' });
    expect([200, 201]).toContain(created.status);
    const day = weekdayIn(2);

    const cp = await post(emps[0].token, { startDate: day, endDate: day, leaveTypeId: cpId });
    expect(cp.status).toBe(400);
    const mal = await post(emps[0].token, { startDate: day, endDate: day, leaveTypeId: created.body.id });
    expect(mal.status).toBe(201);
  });

  test('Un manager n\'est pas bloqué pour ses propres demandes', async () => {
    const { c, cpId } = await setup('RP-manager', 0, { team: false });
    const day = weekdayIn(5);
    const res = await post(c.token, { startDate: day, endDate: day, leaveTypeId: cpId });
    expect(res.status).toBe(201);
  });

  test('Un brouillon n\'est pas contrôlé à la création, mais l\'est à la soumission', async () => {
    const { cpId, emps } = await setup('RP-brouillon', 1, { team: false });
    const day = weekdayIn(5);
    const draft = await post(emps[0].token, { startDate: day, endDate: day, leaveTypeId: cpId, asDraft: true });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('brouillon');

    const res = await submit(emps[0].token, draft.body.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Préavis insuffisant/);
    const after = await prisma.leaveRequest.findUnique({ where: { id: draft.body.id } });
    expect(after.status).toBe('brouillon');
  });

  test('Un brouillon lointain se soumet normalement', async () => {
    const { cpId, emps } = await setup('RP-brouillon-loin', 1, { team: false });
    const day = weekdayIn(40);
    const draft = await post(emps[0].token, { startDate: day, endDate: day, leaveTypeId: cpId, asDraft: true });
    expect(draft.status).toBe(201);
    const res = await submit(emps[0].token, draft.body.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });
});

describe('Règles du cabinet : absences simultanées (2 par équipe par défaut)', () => {
  test('Le collaborateur qui ferait dépasser le maximum est refusé ; un jour libre est accepté', async () => {
    const { cpId, emps } = await setup('RA-depasse');
    const [e1, e2, e3] = emps;
    expect((await post(e1.token, { startDate: '2027-09-06', endDate: '2027-09-08', leaveTypeId: cpId })).status).toBe(201);
    expect((await post(e2.token, { startDate: '2027-09-07', endDate: '2027-09-09', leaveTypeId: cpId })).status).toBe(201);

    const refus = await post(e3.token, { startDate: '2027-09-08', endDate: '2027-09-08', leaveTypeId: cpId });
    expect(refus.status).toBe(400);
    expect(refus.body.error).toMatch(/Trop d'absences simultanées/);
    expect(refus.body.error).toMatch(/08\/09\/2027/);

    const libre = await post(e3.token, { startDate: '2027-09-10', endDate: '2027-09-10', leaveTypeId: cpId });
    expect(libre.status).toBe(201);
  });

  test('Les absences d\'une autre équipe ne comptent pas', async () => {
    const { c, cpId, emps } = await setup('RA-autre-equipe');
    const [e1, e2, e3] = emps;
    const teamB = await prisma.team.create({ data: { name: 'Equipe B', companyId: c.company.id } });
    await prisma.user.update({ where: { email: e3.email }, data: { teamId: teamB.id, team: teamB.name } });

    const body = { startDate: '2027-09-13', endDate: '2027-09-14', leaveTypeId: cpId };
    expect((await post(e1.token, body)).status).toBe(201);
    expect((await post(e2.token, body)).status).toBe(201);
    expect((await post(e3.token, body)).status).toBe(201);
  });

  test('Une demande refusée libère la place', async () => {
    const { c, cpId, emps } = await setup('RA-libere');
    const [e1, e2, e3] = emps;
    const body = { startDate: '2027-09-13', endDate: '2027-09-14', leaveTypeId: cpId };
    const r1 = await post(e1.token, body);
    expect(r1.status).toBe(201);
    expect((await post(e2.token, body)).status).toBe(201);
    expect((await post(e3.token, body)).status).toBe(400);

    const decision = await request(app).patch(`/leave-requests/${r1.body.id}/decision`)
      .set(auth(c.token)).send({ decision: 'rejected' });
    expect(decision.status).toBe(200);
    expect((await post(e3.token, body)).status).toBe(201);
  });

  test('Un collaborateur sans équipe n\'est pas concerné', async () => {
    const { cpId, emps } = await setup('RA-sans-equipe');
    const [e1, e2, e3] = emps;
    await prisma.user.update({ where: { email: e3.email }, data: { teamId: null, team: null } });
    const body = { startDate: '2027-09-13', endDate: '2027-09-14', leaveTypeId: cpId };
    expect((await post(e1.token, body)).status).toBe(201);
    expect((await post(e2.token, body)).status).toBe(201);
    expect((await post(e3.token, body)).status).toBe(201);
  });

  test('Un maximum à 0 veut dire pas de limite', async () => {
    const { c, cpId, emps } = await setup('RA-zero');
    expect((await patchRules(c.token, { maxSimultaneousAbsences: 0 })).status).toBe(200);
    const body = { startDate: '2027-09-13', endDate: '2027-09-14', leaveTypeId: cpId };
    for (const e of emps) {
      expect((await post(e.token, body)).status).toBe(201);
    }
  });

  test('Un brouillon ne compte pas, mais sa soumission est contrôlée', async () => {
    const { c, cpId, emps } = await setup('RA-brouillon', 2);
    expect((await patchRules(c.token, { maxSimultaneousAbsences: 1 })).status).toBe(200);
    const [e1, e3] = emps;
    const body = { startDate: '2027-09-20', endDate: '2027-09-21', leaveTypeId: cpId };

    const draft = await post(e1.token, { ...body, asDraft: true });
    expect(draft.status).toBe(201);
    expect((await post(e3.token, body)).status).toBe(201);

    const res = await submit(e1.token, draft.body.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Trop d'absences simultanées/);
  });

  test('Les absences d\'un cabinet ne comptent pas pour un autre', async () => {
    const A = await setup('RA-iso-A');
    const B = await setup('RA-iso-B', 1);
    const body = { startDate: '2027-09-27', endDate: '2027-09-28', leaveTypeId: A.cpId };
    expect((await post(A.emps[0].token, body)).status).toBe(201);
    expect((await post(A.emps[1].token, body)).status).toBe(201);
    expect((await post(A.emps[2].token, body)).status).toBe(400);
    expect((await post(B.emps[0].token, { ...body, leaveTypeId: B.cpId })).status).toBe(201);
  });
});