// Le role est relu en base a CHAQUE requete (comme l'etat actif du compte) : une promotion ou une
// retrogradation s'applique immediatement, sans attendre l'expiration du jeton de connexion.
const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager, createEmployee } = require('./helpers');

jest.setTimeout(60000);

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const MOT_DE_PASSE_EMPLOYE = 'MotDePasseTest123!'; // celui de createEmployee (tests/helpers.js)
const lireUtilisateurs = (token) => request(app).get('/users').set(auth(token));
const changerRole = (token, userId, role) =>
  request(app).put(`/users/${userId}`).set(auth(token)).send({ role });

describe('Role relu en base a chaque requete', () => {
  test('un employe promu a immediatement les droits de responsable avec son ancien jeton', async () => {
    const m = await createCompanyWithManager('RoleLuPromo');
    const e = await createEmployee(m.token);
    expect((await lireUtilisateurs(e.token)).status).toBe(403);

    expect((await changerRole(m.token, e.user.id, 'manager')).status).toBe(200);
    expect((await lireUtilisateurs(e.token)).status).toBe(200);
  });

  test('un responsable retrograde perd immediatement ses droits avec son ancien jeton', async () => {
    const m = await createCompanyWithManager('RoleLuRetro');
    const e = await createEmployee(m.token);
    expect((await changerRole(m.token, e.user.id, 'manager')).status).toBe(200);

    const login = await request(app).post('/login').send({ email: e.email, password: MOT_DE_PASSE_EMPLOYE });
    expect(login.status).toBe(200);
    const ancienJeton = login.body.token;
    expect((await lireUtilisateurs(ancienJeton)).status).toBe(200);

    expect((await changerRole(m.token, e.user.id, 'employee')).status).toBe(200);
    expect((await lireUtilisateurs(ancienJeton)).status).toBe(403);
  });

  test('temoin : un employe reste refuse sur les routes de responsable, un responsable reste accepte', async () => {
    const m = await createCompanyWithManager('RoleLuTemoin');
    const e = await createEmployee(m.token);
    expect((await lireUtilisateurs(e.token)).status).toBe(403);
    expect((await lireUtilisateurs(m.token)).status).toBe(200);
  });
});