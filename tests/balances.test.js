const request = require('supertest');
const app = require('../server');
const { createUserAndLogin } = require('./helpers');

describe('Soldes de congés', () => {
  let token;

  beforeAll(async () => {
    const employee = await createUserAndLogin('employee');
    token = employee.token;
  });

  test('Le solde est vide avant toute demande', async () => {
    const res = await request(app)
      .get('/balances/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('Le solde passe en "pending" après une demande', async () => {
    await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-07-05', endDate: '2027-07-09', leaveTypeId: 1 });

    const res = await request(app)
      .get('/balances/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body[0].pending).toBe(5);
    expect(res.body[0].taken).toBe(0);
  });

  test('Refuse une demande si le solde est insuffisant', async () => {
    // On tente de demander plus de jours que le plafond de 25 (déjà 5 en pending)
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-08-02', endDate: '2028-01-29', leaveTypeId: 1 }); // très longue période

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Solde insuffisant/);
  });
});