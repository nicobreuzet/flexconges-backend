// Dates des mails de conge : format francais JJ/MM/AAAA, quelle que soit la langue par defaut du serveur.
jest.mock('../config/mailer', () => ({ sendMail: jest.fn(() => Promise.resolve()) }));

const request = require('supertest');
const app = require('../server');
const { sendMail } = require('../config/mailer');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

jest.setTimeout(60000);

// Simule un serveur dont la langue par defaut est l'anglais americain (c'est le cas de Render) :
// un appel SANS langue donne alors "6/14/2027". Un appel avec une langue explicite n'est pas touche.
const originale = Date.prototype.toLocaleDateString;
let espion;
beforeAll(() => {
  espion = jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (locales, options) {
    return originale.call(this, locales === undefined ? 'en-US' : locales, options);
  });
});
afterAll(() => {
  espion.mockRestore();
});

async function attendre(condition, ms = 3000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return condition();
}

const mailAvecSujet = (motif) => sendMail.mock.calls.find((c) => motif.test(String(c[1])));

describe('Dates des mails de conge', () => {
  let managerToken, employeeToken, cpId;

  beforeAll(async () => {
    const company = await createCompanyWithManager('MailDates');
    managerToken = company.token;
    const employee = await createEmployee(managerToken);
    employeeToken = employee.token;
    cpId = await getLeaveTypeId(employeeToken, 'CP');
  });

  beforeEach(() => {
    sendMail.mockClear();
  });

  test('mail de decision : dates au format JJ/MM/AAAA', async () => {
    const created = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ startDate: '2027-06-14', endDate: '2027-06-16', leaveTypeId: cpId });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/leave-requests/${created.body.id}/decision`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ decision: 'approved', managerComment: 'Ok' });
    expect(res.status).toBe(200);

    await attendre(() => mailAvecSujet(/Votre demande de cong/) !== undefined);
    const mail = mailAvecSujet(/Votre demande de cong/);
    expect(mail).toBeDefined();
    expect(mail[2]).toContain('du 14/06/2027 au 16/06/2027');
  });

  test('mail de creation : dates au format JJ/MM/AAAA', async () => {
    const res = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ startDate: '2027-06-21', endDate: '2027-06-23', leaveTypeId: cpId });
    expect(res.status).toBe(201);

    await attendre(() => mailAvecSujet(/Nouvelle demande/) !== undefined);
    const mail = mailAvecSujet(/Nouvelle demande/);
    expect(mail).toBeDefined();
    expect(mail[2]).toContain('du 21/06/2027 au 23/06/2027');
  });

  test('mail de soumission d un brouillon : dates au format JJ/MM/AAAA', async () => {
    const draft = await request(app)
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ startDate: '2027-06-28', endDate: '2027-06-30', leaveTypeId: cpId, asDraft: true });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('brouillon');

    sendMail.mockClear();
    const res = await request(app)
      .patch(`/leave-requests/${draft.body.id}/submit`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);

    await attendre(() => mailAvecSujet(/Nouvelle demande/) !== undefined);
    const mail = mailAvecSujet(/Nouvelle demande/);
    expect(mail).toBeDefined();
    expect(mail[2]).toContain('du 28/06/2027 au 30/06/2027');
  });
});