const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

describe('Soldes de congés', () => {
  let token;
  let cpId;

  beforeAll(async () => {
    const company = await createCompanyWithManager('Soldes');
    const employee = await createEmployee(company.token);
    token = employee.token;
    cpId = await getLeaveTypeId(token, 'CP');
  });

  test('Un nouvel employé a ses soldes CP et RTT, sans jour en attente ni pris', async () => {
    const res = await request(app)
      .get('/balances/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const codes = res.body.map(b => b.leaveType.code).sort();
    expect(codes).toEqual(['CP', 'RTT']);
    res.body.forEach(b => {
      expect(b.pending).toBe(0);
      expect(b.taken).toBe(0);
    });
  });

  test('Le solde passe en "pending" après une demande', async () => {
    const created = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-07-05', endDate: '2027-07-09', leaveTypeId: cpId });
    expect(created.status).toBe(201);

    const res = await request(app)
      .get('/balances/me')
      .set('Authorization', `Bearer ${token}`);

    // La demande porte sur 2027 : on cherche le solde CP de CETTE année-là
    const cp = res.body.find(b => b.leaveType.code === 'CP' && b.year === 2027);
    expect(cp).toBeDefined();
    expect(cp.pending).toBe(5);
    expect(cp.taken).toBe(0);
  });

  test('Refuse une demande si le solde est insuffisant', async () => {
    // On tente de demander plus de jours que le plafond de 25 (déjà 5 en pending)
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-08-02', endDate: '2028-01-29', leaveTypeId: cpId }); // très longue période

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Solde insuffisant/);
  });
});