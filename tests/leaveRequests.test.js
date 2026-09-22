const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

describe('Demandes de congés', () => {
  let token;
  let cpId;

  // beforeAll s'exécute UNE FOIS avant tous les tests de ce fichier
  beforeAll(async () => {
    const company = await createCompanyWithManager('Demandes');
    const employee = await createEmployee(company.token);
    token = employee.token;
    cpId = await getLeaveTypeId(token, 'CP');
  });

  test('Crée une demande avec le bon nombre de jours ouvrés', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2027-03-01', // lundi
        endDate: '2027-03-05',   // vendredi
        leaveTypeId: cpId,
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
        leaveTypeId: cpId
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
        leaveTypeId: cpId
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
        leaveTypeId: cpId
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/déjà une demande/);
  });
});