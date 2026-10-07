const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../server');
const { createCompanyWithManager, createEmployee } = require('./helpers');
const { logAudit } = require('../utils/audit');

jest.setTimeout(30000);
authenticator.options = { window: 1 };

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const getLogs = (token, query = '') => request(app).get(`/audit-logs${query}`).set(auth(token));

// Active le 2FA pour le porteur de ce jeton et renvoie ses codes de récupération
async function enable2FA(token) {
  const setup = await request(app).post('/2fa/setup').set(auth(token));
  if (setup.status !== 200) {
    throw new Error(`Setup 2FA échoué : ${setup.status} ${JSON.stringify(setup.body)}`);
  }
  const secret = setup.body.secret.replace(/\s/g, '');
  const verify = await request(app)
    .post('/2fa/verify-setup')
    .set(auth(token))
    .send({ code: authenticator.generate(secret) });
  if (verify.status !== 200) {
    throw new Error(`Activation 2FA échouée : ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return { recoveryCodes: verify.body.recoveryCodes };
}

describe("Journal d'audit", () => {
  test('Connexions réussies et ratées enregistrées, sans aucun secret', async () => {
    const company = await createCompanyWithManager('audit-login');
    const bad = await request(app).post('/login').send({ email: company.email, password: 'mauvaismotdepasse' });
    expect(bad.status).toBe(401);

    const res = await getLogs(company.token);
    expect(res.status).toBe(200);

    const actions = res.body.items.map(i => i.action);
    expect(actions).toContain('login.success');
    expect(actions).toContain('login.failed');

    // Les plus récents d'abord, avec l'auteur et la provenance
    expect(res.body.items[0].action).toBe('login.failed');
    expect(res.body.items[0].user.id).toBe(company.manager.id);
    expect(typeof res.body.items[0].ip).toBe('string');

    // Jamais de mot de passe dans le journal
    const brut = JSON.stringify(res.body);
    expect(brut).not.toContain('mauvaismotdepasse');
    expect(brut).not.toContain(company.password);
  });

  test('Événements 2FA : activation, échec de code, connexion par code de récupération, désactivation', async () => {
    const company = await createCompanyWithManager('audit-2fa');
    const { recoveryCodes } = await enable2FA(company.token);

    // Connexion avec 2FA : un mauvais code, puis un code de récupération
    const login = await request(app).post('/login').send({ email: company.email, password: company.password });
    const pendingToken = login.body.pendingToken;
    const wrong = await request(app).post('/login/verify-2fa').send({ pendingToken, code: '000000' });
    expect(wrong.status).toBe(401);
    const good = await request(app).post('/login/verify-2fa').send({ pendingToken, code: recoveryCodes[0] });
    expect(good.status).toBe(200);

    // Désactivation : mauvais mot de passe, puis le bon
    const noPwd = await request(app).post('/2fa/disable').set(auth(company.token)).send({ password: 'faux' });
    expect(noPwd.status).toBe(401);
    const okPwd = await request(app).post('/2fa/disable').set(auth(company.token)).send({ password: company.password });
    expect(okPwd.status).toBe(200);

    const items = (await getLogs(company.token)).body.items;
    const actions = items.map(i => i.action);
    expect(actions).toEqual(expect.arrayContaining([
      'twofactor.enabled', 'twofactor.login_failed', 'twofactor.disable_failed', 'twofactor.disabled'
    ]));

    const loginOk = items.find(i => i.action === 'login.success' && i.details && i.details.deuxFacteurs === true);
    expect(loginOk.details.methode).toBe('code de récupération');
    expect(items.find(i => i.action === 'twofactor.login_failed').details.tentative).toBe(1);

    // Ni code ni secret dans le journal
    expect(JSON.stringify(items)).not.toContain(recoveryCodes[0]);
  });

  test('Gestion des collaborateurs : création, changement de rôle, désactivation, réactivation', async () => {
    const company = await createCompanyWithManager('audit-users');
    const emp = await createEmployee(company.token);
    const id = emp.user.id;

    const role = await request(app).put(`/users/${id}`).set(auth(company.token)).send({ role: 'manager' });
    expect(role.status).toBe(200);
    expect((await request(app).patch(`/users/${id}/deactivate`).set(auth(company.token))).status).toBe(200);
    expect((await request(app).patch(`/users/${id}/reactivate`).set(auth(company.token))).status).toBe(200);

    const items = (await getLogs(company.token)).body.items;
    const parAction = (a) => items.find(i => i.action === a);

    expect(parAction('user.created').details.cibleId).toBe(id);
    expect(parAction('user.role_changed').details).toMatchObject({ cibleId: id, de: 'employee', vers: 'manager' });
    expect(parAction('user.deactivated').details.cibleId).toBe(id);
    expect(parAction('user.reactivated').details.cibleId).toBe(id);
    // Seul le rôle a changé : pas de faux « user.updated »
    expect(parAction('user.updated')).toBeUndefined();
    // L'acteur est le manager, pas le collaborateur concerné
    expect(parAction('user.deactivated').user.id).toBe(company.manager.id);
  });

  test("Réservé au manager, et chaque société ne voit que son propre journal", async () => {
    const A = await createCompanyWithManager('audit-A');
    const empA = await createEmployee(A.token);
    const B = await createCompanyWithManager('audit-B');
    await enable2FA(A.token); // événement propre à la société A

    expect((await getLogs(empA.token)).status).toBe(403);
    expect((await request(app).get('/audit-logs')).status).toBe(401);

    const resB = await getLogs(B.token);
    expect(resB.status).toBe(200);
    expect(resB.body.items.length).toBeGreaterThan(0);
    expect(resB.body.items.every(i => i.user && i.user.id === B.manager.id)).toBe(true);
    expect(resB.body.items.map(i => i.action)).not.toContain('twofactor.enabled');
  });

  test('Pagination par curseur et filtre par type', async () => {
    const company = await createCompanyWithManager('audit-pagination');
    for (let i = 0; i < 3; i++) {
      await request(app).post('/login').send({ email: company.email, password: 'faux-mot-de-passe' });
    }
    // 1 connexion réussie (création de la société) + 3 échecs = 4 lignes de connexion (+ 1 ligne company.registered : 5 au total)

    const page1 = (await getLogs(company.token, '?limit=2')).body;
    expect(page1.items).toHaveLength(2);
    expect(typeof page1.nextCursor).toBe('number');

    const page2 = (await getLogs(company.token, `?limit=2&before=${page1.nextCursor}`)).body;
    expect(page2.items).toHaveLength(2);
    expect(page2.items.every(i => i.id < page1.nextCursor)).toBe(true);
    // 5 lignes au total (company.registered + 1 connexion + 3 echecs) : la page 3 n'en contient qu'une
    expect(typeof page2.nextCursor).toBe('number');
    const page3 = (await getLogs(company.token, "?limit=2&before=" + page2.nextCursor)).body;
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const echecs = (await getLogs(company.token, '?action=login.failed')).body.items;
    expect(echecs).toHaveLength(3);
    expect(echecs.every(i => i.action === 'login.failed')).toBe(true);
    expect((await getLogs(company.token, '?action=login')).body.items).toHaveLength(4);

    expect((await getLogs(company.token, '?before=abc')).status).toBe(400);
  });

  test("Une panne d'écriture du journal ne casse jamais la requête", async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Société inexistante : l'écriture échoue (clé étrangère), la fonction avale l'erreur
    await expect(
      logAudit({ ip: '1.2.3.4', headers: {} }, { companyId: 999999999, action: 'test.panne' })
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();

    // Sans société ou sans action : ignoré silencieusement
    await expect(logAudit({ headers: {} }, { action: 'test.sans-societe' })).resolves.toBeUndefined();
    await expect(logAudit({ headers: {} }, { companyId: 1 })).resolves.toBeUndefined();

    spy.mockRestore();
  });
});