const request = require('supertest');
const app = require('../server');

describe('Demandes de congés', () => {
  let token;
  const testUser = {
    email: `leave-test${Date.now()}@test.com`,
    password: 'motdepasse123',
    firstName: 'Test',
    lastName: 'Leave',
    role: 'employee'
  };

  // beforeAll s'exécute UNE FOIS avant tous les tests de ce fichier
  beforeAll(async () => {
    await request(app).post('/register').send(testUser);
    const res = await request(app).post('/login').send({
      email: testUser.email,
      password: testUser.password
    });
    token = res.body.token;
  });

  test('Crée une demande avec le bon nombre de jours ouvrés', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2027-03-01', // lundi
        endDate: '2027-03-05',   // vendredi
        leaveTypeId: 1,
        comment: 'Test automatisé'
      });

    expect(res.status).toBe(201);
    expect(res.body.daysCount).toBe(5);
    expect(res.body.status).toBe('pending');
  });

  test('Refuse une demande sans token (non authentifié)', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .send({
        startDate: '2027-04-01',
        endDate: '2027-04-05',
        leaveTypeId: 1
      });

    expect(res.status).toBe(401);
  });

  test('Refuse une demande avec date de fin avant date de début', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2027-05-10',
        endDate: '2027-05-05',
        leaveTypeId: 1
      });

    expect(res.status).toBe(400);
  });

  test('Refuse une demande qui chevauche une demande existante', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2027-03-03', // chevauche la première demande (1er-5 mars)
        endDate: '2027-03-08',
        leaveTypeId: 1
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/déjà une demande/);
  });
});