// Ce fichier réactive les limites anti-force-brute (désactivées par défaut en test).
process.env.ENABLE_RATE_LIMIT_IN_TESTS = '1';

const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager } = require('./helpers');

jest.setTimeout(60000);

afterAll(() => {
  delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
});

describe('Limites anti-force-brute', () => {
  test('/login : 10 échecs sur un e-mail, puis 429 (même avec le bon mot de passe), sans gêner un autre compte', async () => {
    const target = await createCompanyWithManager('RL-cible');
    const other = await createCompanyWithManager('RL-autre');

    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/login').send({ email: target.email, password: 'mauvais-mot-de-passe' });
      expect(r.status).toBe(401);
    }

    const blocked = await request(app).post('/login').send({ email: target.email, password: 'mauvais-mot-de-passe' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Trop de tentatives/);

    const blockedRight = await request(app).post('/login').send({ email: target.email, password: target.password });
    expect(blockedRight.status).toBe(429);

    const otherLogin = await request(app).post('/login').send({ email: other.email, password: other.password });
    expect(otherLogin.status).toBe(200);
    expect(otherLogin.body.token).toBeTruthy();
  });

  test('/login : les connexions réussies ne consomment aucun quota', async () => {
    const company = await createCompanyWithManager('RL-succes');
    for (let i = 0; i < 12; i++) {
      const r = await request(app).post('/login').send({ email: company.email, password: company.password });
      expect(r.status).toBe(200);
    }
  });


  
  test('/2fa/disable : 5 mots de passe incorrects par compte, puis 429 (même avec le bon), sans gêner un autre compte', async () => {
    const target = await createCompanyWithManager('RL-2fa-cible');
    const other = await createCompanyWithManager('RL-2fa-autre');

    const tokenOf = async (account) => {
      const r = await request(app).post('/login').send({ email: account.email, password: account.password });
      expect(r.status).toBe(200);
      return r.body.token;
    };
    const targetToken = await tokenOf(target);
    const otherToken = await tokenOf(other);

    const disable = (token, password) =>
      request(app).post('/2fa/disable').set('Authorization', `Bearer ${token}`).send({ password });

    // Contrôle : le jeton est bien accepté (sinon un 401 plus bas prouverait autre chose)
    const status = await request(app).get('/2fa/status').set('Authorization', `Bearer ${targetToken}`);
    expect(status.status).toBe(200);

    for (let i = 0; i < 5; i++) {
      const r = await disable(targetToken, 'mauvais-mot-de-passe');
      expect(r.status).toBe(401);
    }

    const blocked = await disable(targetToken, 'mauvais-mot-de-passe');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Trop de tentatives/);

    const blockedRight = await disable(targetToken, target.password);
    expect(blockedRight.status).toBe(429);

    const otherOk = await disable(otherToken, other.password);
    expect(otherOk.status).toBe(200);
  });

  test('/2fa/disable : les réussites ne consomment aucun quota', async () => {
    const company = await createCompanyWithManager('RL-2fa-succes');
    const login = await request(app).post('/login').send({ email: company.email, password: company.password });
    expect(login.status).toBe(200);

    for (let i = 0; i < 7; i++) {
      const r = await request(app).post('/2fa/disable').set('Authorization', `Bearer ${login.body.token}`).send({ password: company.password });
      expect(r.status).toBe(200);
    }
  });
    test('/forgot-password : finit par répondre 429 (10 demandes par heure et par IP)', async () => {
    const statuses = [];
    for (let i = 0; i < 15; i++) {
      const r = await request(app).post('/forgot-password').send({ email: `inconnu${i}${Date.now()}@test.com` });
      statuses.push(r.status);
    }
    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(429);
  });
});