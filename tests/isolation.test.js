const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('Isolation entre sociétés', () => {
  let A, B, employeeA, cpA, cpB, holidayA, requestA;

  beforeAll(async () => {
    A = await createCompanyWithManager('A');
    B = await createCompanyWithManager('B');
    employeeA = await createEmployee(A.token);
    cpA = await getLeaveTypeId(A.token, 'CP');
    cpB = await getLeaveTypeId(B.token, 'CP');

    // Un jour férié dans la société A
    const h = await request(app).post('/holidays').set(auth(A.token))
      .send({ date: '2027-12-25', label: 'Noel A' });
    holidayA = h.body;

    // Une demande de congé de l'employé de A (crée aussi le solde et notifie les managers de A)
    const r = await request(app).post('/leave-requests').set(auth(employeeA.token))
      .send({ startDate: '2027-03-01', endDate: '2027-03-05', leaveTypeId: cpA, comment: 'Isolation' });
    requestA = r.body;
    expect(r.status).toBe(201);
  });

  // ---------- Tests témoins : A voit bien ses propres données ----------
  test('TÉMOIN : le manager A voit son employé, son jour férié et sa demande', async () => {
    const users = await request(app).get('/users').set(auth(A.token));
    expect(users.body.map(u => u.email)).toContain(employeeA.email);

    const holidays = await request(app).get('/holidays').set(auth(A.token));
    expect(holidays.body.map(h => h.id)).toContain(holidayA.id);

    const pending = await request(app).get('/leave-requests/pending').set(auth(A.token));
    expect(pending.body.map(r => r.id)).toContain(requestA.id);
  });

  // ---------- Utilisateurs ----------
  test('B ne voit pas les utilisateurs de A', async () => {
    const res = await request(app).get('/users').set(auth(B.token));
    const emails = res.body.map(u => u.email);
    expect(emails).not.toContain(employeeA.email);
    expect(emails).not.toContain(A.email);
    expect(emails).toContain(B.email);
  });

  test('B ne peut ni modifier, ni désactiver, ni réactiver un utilisateur de A', async () => {
    const put = await request(app).put(`/users/${employeeA.user.id}`).set(auth(B.token))
      .send({ firstName: 'Hack', lastName: 'Hack', email: 'hack@test.com', role: 'manager' });
    const off = await request(app).patch(`/users/${employeeA.user.id}/deactivate`).set(auth(B.token));
    const on = await request(app).patch(`/users/${employeeA.user.id}/reactivate`).set(auth(B.token));
    expect([put.status, off.status, on.status]).toEqual([404, 404, 404]);

    // L'utilisateur de A est intact
    const users = await request(app).get('/users').set(auth(A.token));
    const u = users.body.find(x => x.id === employeeA.user.id);
    expect(u.isActive).toBe(true);
    expect(u.firstName).toBe('Test');
  });

  // ---------- Types de congés ----------
  test('B ne voit pas les types de congés de A', async () => {
    const res = await request(app).get('/leave-types').set(auth(B.token));
    const idsB = res.body.map(t => t.id);
    expect(idsB).not.toContain(cpA);
    expect(idsB).toContain(cpB);
  });

  test('B ne peut ni modifier ni supprimer un type de congé de A', async () => {
    const put = await request(app).put(`/leave-types/${cpA}`).set(auth(B.token))
      .send({ code: 'HACK', label: 'Hack', color: '#000000' });
    const del = await request(app).delete(`/leave-types/${cpA}`).set(auth(B.token));
    expect([put.status, del.status]).toEqual([404, 404]);

    const types = await request(app).get('/leave-types').set(auth(A.token));
    const cp = types.body.find(t => t.id === cpA);
    expect(cp.code).toBe('CP');
  });

  // ---------- Jours fériés ----------
  test('B ne voit pas les jours fériés de A, et ne peut ni les modifier ni les supprimer', async () => {
    const list = await request(app).get('/holidays').set(auth(B.token));
    expect(list.body.map(h => h.id)).not.toContain(holidayA.id);

    const put = await request(app).put(`/holidays/${holidayA.id}`).set(auth(B.token))
      .send({ date: '2027-12-26', label: 'Hack' });
    const del = await request(app).delete(`/holidays/${holidayA.id}`).set(auth(B.token));
    expect([put.status, del.status]).toEqual([404, 404]);

    const after = await request(app).get('/holidays').set(auth(A.token));
    const h = after.body.find(x => x.id === holidayA.id);
    expect(h.label).toBe('Noel A');
  });

  // ---------- Soldes ----------
  test('B ne voit pas les soldes de A dans /balances/team', async () => {
    const res = await request(app).get('/balances/team').set(auth(B.token));
    const userIds = res.body.map(b => b.userId);
    expect(userIds).not.toContain(employeeA.user.id);
    expect(userIds.every(id => id === B.manager.id)).toBe(true);
  });

  // ---------- Demandes de congé ----------
  test('B ne voit pas les demandes de A (pending, all, me)', async () => {
    const pending = await request(app).get('/leave-requests/pending').set(auth(B.token));
    const all = await request(app).get('/leave-requests/all').set(auth(B.token));
    const me = await request(app).get('/leave-requests/me').set(auth(B.token));
    expect(pending.body.map(r => r.id)).not.toContain(requestA.id);
    expect(all.body.map(r => r.id)).not.toContain(requestA.id);
    expect(me.body.map(r => r.id)).not.toContain(requestA.id);
  });

  test('B ne peut ni décider ni annuler une demande de A', async () => {
    const dec = await request(app).patch(`/leave-requests/${requestA.id}/decision`).set(auth(B.token))
      .send({ decision: 'approved', managerComment: 'Hack' });
    const can = await request(app).patch(`/leave-requests/${requestA.id}/cancel`).set(auth(B.token));
    expect([dec.status, can.status]).toEqual([404, 404]);

    // La demande de A est toujours en attente, sans commentaire du manager
    const mine = await request(app).get('/leave-requests/me').set(auth(employeeA.token));
    const r = mine.body.find(x => x.id === requestA.id);
    expect(r.status).toBe('pending');
    expect(r.managerComment).toBeNull();
  });

  test('B ne peut pas créer une demande avec un type de congé de A', async () => {
    const res = await request(app).post('/leave-requests').set(auth(B.token))
      .send({ startDate: '2027-06-07', endDate: '2027-06-11', leaveTypeId: cpA });
    expect(res.status).toBe(404);
  });

  // ---------- Token ----------
  test('Un token sans companyId est refusé', async () => {
    const old = jwt.sign({ userId: A.manager.id, role: 'manager' }, process.env.JWT_SECRET);
    const res = await request(app).get('/users').set(auth(old));
    expect(res.status).toBe(401);
  });
});