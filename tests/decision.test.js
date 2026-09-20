const request = require('supertest');
const app = require('../server');
const { createUserAndLogin } = require('./helpers');

describe('Décision manager sur une demande', () => {
  let employeeToken, managerToken, requestId;

  beforeAll(async () => {
    const employee = await createUserAndLogin('employee');
    const manager = await createUserAndLogin('manager');
    employeeToken = employee.token;
    managerToken = manager.token;

    // On crée une demande à approuver/refuser dans les tests suivants
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ startDate: '2027-06-01', endDate: '2027-06-03', leaveTypeId: 1 });

    requestId = res.body.id;
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

  test('Une demande déjà traitée ne peut pas être re-traitée', async () => {
    const res = await request(app)
      .patch(`/leave-requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'rejected' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/déjà été traitée/);
  });

  test('Une décision invalide est refusée', async () => {
    const employee2 = await createUserAndLogin('employee');
    const res2 = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employee2.token}`)
      .send({ startDate: '2027-06-10', endDate: '2027-06-12', leaveTypeId: 1 });

    const res = await request(app)
      .patch(`/leave-requests/${res2.body.id}/decision`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'peut-etre' }); // valeur invalide, ni "approved" ni "rejected"

    expect(res.status).toBe(400);
  });
});