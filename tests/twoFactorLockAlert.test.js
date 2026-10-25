// Tache 1.4b : e-mail d'alerte quand un verrou de la 2e etape 2FA est pose.
// sendMail est remplace par un faux : on lit les appels, rien n'est envoye.
jest.mock('../config/mailer', () => ({
  sendMail: jest.fn()
}));

const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../server');
const prisma = require('../config/prisma');
const { sendMail } = require('../config/mailer');
const { createCompanyWithManager, createEmployee } = require('./helpers');

// Chaque echec fait des comparaisons bcrypt : on laisse de la marge
jest.setTimeout(120000);

authenticator.options = { window: 1 };

// Adresses reservees a la documentation (RFC 5737) : jamais de vraie IP
const IPS = ['203.0.113.11', '203.0.113.12', '203.0.113.13', '203.0.113.14'];

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue(undefined);
});

async function enable2FA(account) {
  const setup = await request(app)
    .post('/2fa/setup')
    .set('Authorization', `Bearer ${account.token}`);
  const secret = setup.body.secret.replace(/\s/g, '');
  const verify = await request(app)
    .post('/2fa/verify-setup')
    .set('Authorization', `Bearer ${account.token}`)
    .send({ code: authenticator.generate(secret) });
  if (verify.status !== 200) {
    throw new Error(`Activation 2FA echouee : ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return { secret };
}

async function loginPending(account) {
  const res = await request(app).post('/login').send({ email: account.email, password: account.password });
  return res.body.pendingToken;
}

function wrongCode(secret) {
  return authenticator.generate(secret) === '000000' ? '111111' : '000000';
}

function verifyFrom(ip, pendingToken, code) {
  return request(app)
    .post('/login/verify-2fa')
    .set('X-Forwarded-For', ip)
    .send({ pendingToken, code });
}

// 5 faux codes d'affilee depuis une adresse : renvoie la reponse du 5e
async function failFiveTimes(ip, pendingToken, secret) {
  let last;
  for (let i = 1; i <= 5; i++) {
    last = await verifyFrom(ip, pendingToken, wrongCode(secret));
  }
  return last;
}

function callsTo(email) {
  return sendMail.mock.calls.filter(c => c[0] === email);
}

describe('2FA : e-mail d alerte quand un verrou est pose (tache 1.4b)', () => {
  test('Le 5e faux code envoie 1 mail au titulaire, sans IP, sans code, sans lien', async () => {
    const company = await createCompanyWithManager('alerte-ip');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);
    sendMail.mockClear();

    const fifth = await failFiveTimes(IPS[0], pending, secret);
    expect(fifth.status).toBe(429);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const [to, subject, text] = sendMail.mock.calls[0];
    expect(to).toBe(company.email);
    expect(subject).toMatch(/FlexCong/);
    expect(text).toMatch(/5 fois/);
    expect(text).toMatch(/15 minutes/);
    expect(text).not.toContain(IPS[0]);
    expect(text).not.toMatch(/\d{6}/);
    expect(text).not.toMatch(/https?:/);
  });

  test('Une deuxieme adresse verrouillee dans l heure n envoie pas de second mail', async () => {
    const company = await createCompanyWithManager('alerte-limite');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);
    sendMail.mockClear();

    await failFiveTimes(IPS[0], pending, secret);
    await failFiveTimes(IPS[1], pending, secret);

    expect(callsTo(company.email)).toHaveLength(1);
  });

  test('Verrou de compte : le titulaire et les responsables actifs de SA societe, personne d autre', async () => {
    const A = await createCompanyWithManager('alerte-compte'); // titulaire, responsable
    const B = await createEmployee(A.token); // deviendra responsable actif
    const C = await createEmployee(A.token); // deviendra responsable desactive
    const E = await createEmployee(A.token); // reste employe
    const D = await createCompanyWithManager('autre-societe'); // autre societe
    await prisma.user.update({ where: { email: B.email }, data: { role: 'manager' } });
    await prisma.user.update({ where: { email: C.email }, data: { role: 'manager', isActive: false } });

    const { secret } = await enable2FA(A);
    const pending = await loginPending(A);
    sendMail.mockClear();

    // 4 adresses x 5 faux codes = 20 echecs pour le compte
    for (const ip of IPS) {
      await failFiveTimes(ip, pending, secret);
    }

    // Le titulaire (aussi responsable) recoit UN seul mail de portee compte
    const compteDuTitulaire = callsTo(A.email).filter(c => /20 codes/.test(c[2]));
    expect(compteDuTitulaire).toHaveLength(1);
    // L'autre responsable actif est prevenu
    const pourB = callsTo(B.email);
    expect(pourB).toHaveLength(1);
    expect(pourB[0][2]).toMatch(/20 codes/);
    expect(pourB[0][2]).not.toMatch(/https?:/);
    // Ni le responsable desactive, ni l'employe, ni l'autre societe
    expect(callsTo(C.email)).toHaveLength(0);
    expect(callsTo(E.email)).toHaveLength(0);
    expect(callsTo(D.email)).toHaveLength(0);
    // Au total : alerte ip + alerte compte du titulaire + alerte du responsable B
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  test('Le 20e echec obtenu depuis 4 adresses est etiquete portee compte dans l audit', async () => {
    const company = await createCompanyWithManager('alerte-audit');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);
    const titulaire = await prisma.user.findUnique({ where: { email: company.email } });

    for (const ip of IPS) {
      await failFiveTimes(ip, pending, secret);
    }

    const logs = await prisma.auditLog.findMany({
      where: { userId: titulaire.id, action: 'twofactor.locked' },
      orderBy: { id: 'asc' }
    });
    expect(logs.map(l => l.details.portee)).toEqual(['ip', 'ip', 'ip', 'compte']);
  });

  test('Une panne d envoi du mail ne change pas la reponse 429', async () => {
    const company = await createCompanyWithManager('alerte-panne');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);
    sendMail.mockClear();
    sendMail.mockRejectedValue(new Error('panne simulee'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const fifth = await failFiveTimes(IPS[0], pending, secret);
    errSpy.mockRestore();

    expect(fifth.status).toBe(429);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test('Temoin : 4 faux codes ne declenchent aucune alerte', async () => {
    const company = await createCompanyWithManager('alerte-temoin');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);
    sendMail.mockClear();

    for (let i = 1; i <= 4; i++) {
      const r = await verifyFrom(IPS[0], pending, wrongCode(secret));
      expect(r.status).toBe(401);
    }
    expect(sendMail).not.toHaveBeenCalled();
  });
});