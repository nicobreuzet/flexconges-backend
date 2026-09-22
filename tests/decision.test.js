const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

describe('Décision manager sur une demande', () => {
  let employeeToken, managerToken, cpId, requestId, requestDays;

  beforeAll(async () => {
    // Le manager et les employés appartiennent à la MÊME société
    const company = await createCompanyWithManager('Decision');
    managerToken = company.token;
    const employee = await createEmployee(managerToken);
    employeeToken = employee.token;
    cpId = await getLeaveTypeId(employeeToken, 'CP');

    // On crée une demande à approuver/refuser dans les tests suivants
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ startDate: '2027-06-01', endDate: '2027-06-03', leaveTypeId: cpId });

    expect(res.status).toBe(201);
    requestId = res.body.id;
    requestDays = res.body.daysCount;
  });

  test('Un employé ne peut pas approuver une demande', async () => {
    const res = await request(app)
      .patch(`/leave-requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(403);
  });

  test('Un manager peut approuver une demande', async () => {
    const res = await request(app)
      .patch(`/leave-requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'approved', managerComment: 'Ok' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  test("L'approbation fait passer les jours de « en attente » à « pris »", async () => {
    const res = await request(app)
      .get('/balances/me')
      .set('Authorization', `Bearer ${employeeToken}`);

    const cp = res.body.find(b => b.leaveType.code === 'CP' && b.year === 2027);
    expect(cp).toBeDefined();
    expect(cp.pending).toBe(0);
    expect(cp.taken).toBe(requestDays);
  });

  test('Une demande déjà traitée ne peut pas être re-traitée', async () => {
    const res = await request(app)
      .patch(`/leave-requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'rejected' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/déjà été traitée/);
  });

  test('Une décision invalide est refusée', async () => {
    const employee2 = await createEmployee(managerToken);
    const cp2 = await getLeaveTypeId(employee2.token, 'CP');
    const res2 = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employee2.token}`)
      .send({ startDate: '2027-06-10', endDate: '2027-06-12', leaveTypeId: cp2 });
    expect(res2.status).toBe(201);

    const res = await request(app)
      .patch(`/leave-requests/${res2.body.id}/decision`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'peut-etre' }); // valeur invalide, ni "approved" ni "rejected"

    expect(res.status).toBe(400);
  });

  test('Un refus libère les jours en attente', async () => {
    const employee3 = await createEmployee(managerToken);
    const cp3 = await getLeaveTypeId(employee3.token, 'CP');
    const created = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employee3.token}`)
      .send({ startDate: '2027-09-06', endDate: '2027-09-08', leaveTypeId: cp3 });
    expect(created.status).toBe(201);

    const decision = await request(app)
      .patch(`/leave-requests/${created.body.id}/decision`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'rejected', managerComment: 'Non' });
    expect(decision.status).toBe(200);

    const balances = await request(app)
      .get('/balances/me')
      .set('Authorization', `Bearer ${employee3.token}`);
    const cp = balances.body.find(b => b.leaveType.code === 'CP' && b.year === 2027);
    expect(cp.pending).toBe(0);
    expect(cp.taken).toBe(0);
  });
});