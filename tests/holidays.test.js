const request = require('supertest');
const app = require('../server');
const { createUserAndLogin } = require('./helpers');

describe('Jours fériés', () => {
  let employeeToken, managerToken;

  beforeAll(async () => {
    const employee = await createUserAndLogin('employee');
    const manager = await createUserAndLogin('manager');
    employeeToken = employee.token;
    managerToken = manager.token;
  });

  test('Un employé ne peut pas créer un jour férié', async () => {
    const res = await request(app)
      .post('/holidays')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ date: '2027-12-25', label: 'Noël' });

    expect(res.status).toBe(403);
  });

  test('Un manager peut créer un jour férié', async () => {
    const res = await request(app)
      .post('/holidays')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ date: '2027-12-25', label: 'Noël' });

    expect(res.status).toBe(201);
    expect(res.body.label).toBe('Noël');
  });

  test('Un jour férié en semaine réduit bien le nombre de jours calculé', async () => {
    // On crée un jour férié un mardi (jour de semaine garanti)
    await request(app)
      .post('/holidays')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ date: '2028-01-04', label: 'Jour férié test' }); // 4 janvier 2028 = mardi

    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ startDate: '2028-01-03', endDate: '2028-01-07', leaveTypeId: 1 }); // lundi à vendredi

    // 5 jours de semaine - 1 jour férié = 4
    expect(res.body.daysCount).toBe(4);
  })
});