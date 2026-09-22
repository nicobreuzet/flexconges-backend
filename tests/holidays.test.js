const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

describe('Jours fériés', () => {
  let employeeToken, managerToken, cpId;

  beforeAll(async () => {
    // Le manager et l'employé appartiennent à la MÊME société
    const company = await createCompanyWithManager('Feries');
    managerToken = company.token;
    const employee = await createEmployee(managerToken);
    employeeToken = employee.token;
    cpId = await getLeaveTypeId(employeeToken, 'CP');
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
      .send({ startDate: '2028-01-03', endDate: '2028-01-07', leaveTypeId: cpId }); // lundi à vendredi

    // 5 jours de semaine - 1 jour férié = 4
    expect(res.status).toBe(201);
    expect(res.body.daysCount).toBe(4);
  });

  test("Le jour férié d'une société n'est PAS décompté dans une autre société", async () => {
    // Société B, sans aucun jour férié : la même semaine doit compter 5 jours
    const B = await createCompanyWithManager('FeriesB');
    const employeeB = await createEmployee(B.token);
    const cpB = await getLeaveTypeId(employeeB.token, 'CP');

    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employeeB.token}`)
      .send({ startDate: '2028-01-03', endDate: '2028-01-07', leaveTypeId: cpB });

    expect(res.status).toBe(201);
    expect(res.body.daysCount).toBe(5);
  });
});