const request = require('supertest');
const app = require('../server');
const { sendError } = require('../utils/httpErrors');
const { createCompanyWithManager, createEmployee } = require('./helpers');

const bearer = (t) => ({ Authorization: 'Bearer ' + t });
const fakeReq = { method: 'POST', path: '/exemple' };
function fakeRes() {
  return {
    headersSent: false, statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

describe('sendError : jamais de message technique cote client', () => {
  let spy;
  beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { spy.mockRestore(); });

  test('Chaque type d erreur recoit le bon code et un message generique', () => {
    const cas = [
      [{ code: 'P2002', message: 'Unique constraint failed on the fields: (`email`)' }, 409],
      [{ code: 'P2025', message: 'Record to update not found.' }, 404],
      [{ code: 'P2003', message: 'Foreign key constraint failed on the field: `leaveTypeId`' }, 409],
      [{ name: 'PrismaClientValidationError', message: 'Invalid `prisma.holiday.create()` invocation' }, 400],
      [{ name: 'RangeError', message: 'Invalid time value' }, 400],
      [{ status: 400, expose: true, message: 'Unexpected end of JSON input' }, 400],
      [new Error('connect ECONNREFUSED 10.0.0.1:5432'), 500],
    ];
    for (const [erreur, attendu] of cas) {
      const res = fakeRes();
      sendError(fakeReq, res, erreur);
      expect(res.statusCode).toBe(attendu);
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(res.body.error).not.toContain(erreur.message);
      expect(res.body.error).not.toMatch(/prisma|ECONNREFUSED|10\.0\.0\.1|constraint/i);
    }
  });

  test('Le journal du serveur ne contient ni les valeurs ni le detail Prisma', () => {
    const erreur = new Error("\nInvalid `prisma.user.create()` invocation:\n\n{ data: { password: 'SECRETHASH123' } }");
    erreur.name = 'PrismaClientValidationError';
    sendError(fakeReq, fakeRes(), erreur);
    const logue = spy.mock.calls.map((c) => c.join(' ')).join(' | ');
    expect(logue).toContain('PrismaClientValidationError');
    expect(logue).toContain('POST /exemple');
    expect(logue).not.toContain('SECRETHASH123');
  });

  test('Si la reponse est deja partie, on ne renvoie rien de plus', () => {
    const res = fakeRes();
    res.headersSent = true;
    sendError(fakeReq, res, new Error('boum'));
    expect(res.statusCode).toBeNull();
  });
});

describe('sendError : cas reels via l API', () => {
  let spy;
  beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { spy.mockRestore(); });

  test('Date invalide sur POST /holidays : reponse generique, pas de trace Prisma', async () => {
    const company = await createCompanyWithManager('errors');
    const res = await request(app).post('/holidays').set(bearer(company.token)).send({ date: 'pas-une-date', label: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Donn\u00e9es invalides.' });
  }, 30000);

  test('JSON mal forme : 400 generique en JSON', async () => {
    const res = await request(app).post('/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Requ\u00eate invalide.' });
  });

  test('POST /users avec un e-mail deja pris : 409 propre, pas le message Prisma', async () => {
    const company = await createCompanyWithManager('errors-users');
    const emp = await createEmployee(company.token);
    const res = await request(app).post('/users').set(bearer(company.token))
      .send({ email: emp.email, firstName: 'Doublon', lastName: 'Test', role: 'employee' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Cette valeur existe d\u00e9j\u00e0.' });
  }, 30000);

  test('POST /users avec une equipe d une autre societe : refus voulu, pas une erreur 500', async () => {
    const A = await createCompanyWithManager('errors-team-A');
    const B = await createCompanyWithManager('errors-team-B');
    const teamB = await request(app).post('/teams').set(bearer(B.token)).send({ name: 'Equipe B' });
    expect(teamB.status).toBe(201);
    const res = await request(app).post('/users').set(bearer(A.token))
      .send({ email: 'x' + Date.now() + '@test.com', firstName: 'Test', lastName: 'Equipe', role: 'employee', teamId: teamB.body.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).not.toBe('Erreur interne du serveur.');
  }, 30000);
});