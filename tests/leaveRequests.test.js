const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

describe('Demandes de congés', () => {
  let token;
  let cpId;

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
        startDate: '2027-03-01',
        endDate: '2027-03-05',
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
        startDate: '2027-03-03',
        endDate: '2027-03-08',
        leaveTypeId: cpId
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/déjà une demande/);
  });
});

describe('Brouillons de demande', () => {
  let token, otherToken, cpId;

  beforeAll(async () => {
    const company = await createCompanyWithManager('Brouillons');
    const employee = await createEmployee(company.token);
    const otherEmployee = await createEmployee(company.token);
    token = employee.token;
    otherToken = otherEmployee.token;
    cpId = await getLeaveTypeId(token, 'CP');
  });

  test('Crée un brouillon sans vérifier le solde ni les chevauchements', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2027-06-01',
        endDate: '2027-06-05',
        leaveTypeId: cpId,
        comment: 'Brouillon test',
        asDraft: true
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('brouillon');
  });

  test('Un brouillon peut chevaucher une autre demande sans être refusé', async () => {
    await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-07-01', endDate: '2027-07-05', leaveTypeId: cpId });

    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2027-07-03', endDate: '2027-07-08', leaveTypeId: cpId, asDraft: true
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('brouillon');
  });

  test('Modifie un brouillon existant', async () => {
    const createRes = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-08-02', endDate: '2027-08-04', leaveTypeId: cpId, asDraft: true });

    const draftId = createRes.body.id;

    const res = await request(app)
      .put(`/leave-requests/${draftId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-08-02', endDate: '2027-08-06', leaveTypeId: cpId, comment: 'Modifié' });

    expect(res.status).toBe(200);
    expect(res.body.daysCount).toBe(5);
    expect(res.body.comment).toBe('Modifié');
  });

  test("Refuse de modifier le brouillon d'un autre utilisateur", async () => {
    const createRes = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-09-06', endDate: '2027-09-08', leaveTypeId: cpId, asDraft: true });

    const res = await request(app)
      .put(`/leave-requests/${createRes.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ startDate: '2027-09-06', endDate: '2027-09-08', leaveTypeId: cpId });

    expect(res.status).toBe(403);
  });

  test('Soumet un brouillon : il devient une vraie demande en attente', async () => {
    const createRes = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-10-04', endDate: '2027-10-08', leaveTypeId: cpId, asDraft: true });

    const res = await request(app)
      .patch(`/leave-requests/${createRes.body.id}/submit`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  test('Refuse de soumettre un brouillon qui chevauche une demande devenue existante entretemps', async () => {
    await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-11-02', endDate: '2027-11-04', leaveTypeId: cpId });

    const draftRes = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-11-03', endDate: '2027-11-05', leaveTypeId: cpId, asDraft: true });

    const res = await request(app)
      .patch(`/leave-requests/${draftRes.body.id}/submit`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/déjà une demande/);
  });

  test('Supprime un brouillon', async () => {
    const createRes = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2027-12-06', endDate: '2027-12-08', leaveTypeId: cpId, asDraft: true });

    const delRes = await request(app)
      .delete(`/leave-requests/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(delRes.status).toBe(204);

    const listRes = await request(app)
      .get('/leave-requests/me')
      .set('Authorization', `Bearer ${token}`);
    const stillThere = listRes.body.some(r => r.id === createRes.body.id);
    expect(stillThere).toBe(false);
  });

  test("Refuse de soumettre une demande qui n'est plus un brouillon", async () => {
    const createRes = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2028-01-03', endDate: '2028-01-05', leaveTypeId: cpId, asDraft: true });

    await request(app)
      .patch(`/leave-requests/${createRes.body.id}/submit`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .patch(`/leave-requests/${createRes.body.id}/submit`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/brouillon/);
  });
});

describe('Demandes de congé avec demi-journées', () => {
  let token, cpId;

  beforeAll(async () => {
    const company = await createCompanyWithManager('DemiJournees');
    const employee = await createEmployee(company.token);
    token = employee.token;
    cpId = await getLeaveTypeId(token, 'CP');
  });

  test('Demi-journée du matin sur un seul jour = 0,5j', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2028-05-10', endDate: '2028-05-10', leaveTypeId: cpId,
        startHalf: 'morning', endHalf: 'morning'
      });

    expect(res.status).toBe(201);
    expect(res.body.daysCount).toBe(0.5);
  });

  test("Demi-journée de l'après-midi sur un seul jour = 0,5j", async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2028-05-17', endDate: '2028-05-17', leaveTypeId: cpId,
        startHalf: 'afternoon', endHalf: 'afternoon'
      });

    expect(res.status).toBe(201);
    expect(res.body.daysCount).toBe(0.5);
  });

  test("Refuse la combinaison incohérente après-midi → matin sur un seul jour", async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2028-05-18', endDate: '2028-05-18', leaveTypeId: cpId,
        startHalf: 'afternoon', endHalf: 'morning'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/incohérente/);
  });

  test('Lundi à vendredi, fin le vendredi matin = 4,5j', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2028-05-01', endDate: '2028-05-05', leaveTypeId: cpId,
        endHalf: 'morning'
      });

    expect(res.status).toBe(201);
    expect(res.body.daysCount).toBe(4.5);
  });

  test('Jeudi après-midi + vendredi = 1,5j', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2028-05-25', endDate: '2028-05-26', leaveTypeId: cpId,
        startHalf: 'afternoon'
      });

    expect(res.status).toBe(201);
    expect(res.body.daysCount).toBe(1.5);
  });

  test('Mercredi après-midi + jeudi + vendredi = 2,5j', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2028-06-07', endDate: '2028-06-09', leaveTypeId: cpId,
        startHalf: 'afternoon'
      });

    expect(res.status).toBe(201);
    expect(res.body.daysCount).toBe(2.5);
  });

  test('Refuse une demi-journée posée un jour non travaillé (samedi)', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2028-05-06', endDate: '2028-05-06', leaveTypeId: cpId,
        startHalf: 'morning', endHalf: 'morning'
      });

    expect(res.status).toBe(400);
  });

  test('Refuse une valeur startHalf/endHalf invalide', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        startDate: '2028-06-12', endDate: '2028-06-12', leaveTypeId: cpId,
        startHalf: 'nuit', endHalf: 'afternoon'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/morning.*afternoon/);
  });
});