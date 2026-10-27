// Tache D : le refus 409 de /2fa/verify-setup (2FA deja actif) est ecrit dans le journal d'audit.
const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');

jest.setTimeout(30000);
authenticator.options = { window: 1 };

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const ACTION = 'twofactor.verify_setup_refused';

const lignesRefus = (companyId) =>
  prisma.auditLog.findMany({ where: { companyId, action: ACTION } });

describe('Audit du refus de /2fa/verify-setup', () => {
  test('2FA deja actif : refus 409, une ligne d audit sans aucun secret', async () => {
    const company = await createCompanyWithManager('audit-verify-setup');
    const setup = await request(app).post('/2fa/setup').set(auth(company.token));
    expect(setup.status).toBe(200);
    const secret = setup.body.secret.replace(/\s/g, '');

    const activation = await request(app)
      .post('/2fa/verify-setup').set(auth(company.token)).send({ code: authenticator.generate(secret) });
    expect(activation.status).toBe(200);
    expect(await lignesRefus(company.company.id)).toHaveLength(0);

    const refus = await request(app)
      .post('/2fa/verify-setup').set(auth(company.token)).send({ code: authenticator.generate(secret) });
    expect(refus.status).toBe(409);

    const lignes = await lignesRefus(company.company.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].userId).toBe(company.manager.id);
    expect(lignes[0].details).toEqual({ raison: 'deja actif' });
    expect(JSON.stringify(lignes[0])).not.toContain(secret);
  });

  test('temoin : un code faux pendant une activation en cours (400) n ecrit pas cette ligne', async () => {
    const company = await createCompanyWithManager('audit-verify-setup-temoin');
    const setup = await request(app).post('/2fa/setup').set(auth(company.token));
    expect(setup.status).toBe(200);
    const secret = setup.body.secret.replace(/\s/g, '');

    const bon = authenticator.generate(secret);
    const faux = bon === '000000' ? '000001' : '000000';
    const res = await request(app)
      .post('/2fa/verify-setup').set(auth(company.token)).send({ code: faux });
    expect(res.status).toBe(400);

    expect(await lignesRefus(company.company.id)).toHaveLength(0);
  });
});