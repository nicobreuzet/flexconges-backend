const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../server');
const { createCompanyWithManager } = require('./helpers');

describe('Connexion : meme travail pour un e-mail inconnu, erreurs claires pour les champs invalides', () => {
  let spy;
  beforeEach(() => { spy = jest.spyOn(bcrypt, 'compare'); });
  afterEach(() => { spy.mockRestore(); });

  test('E-mail inconnu : 401 identique, mais le mot de passe est quand meme compare a un faux hash', async () => {
    const res = await request(app).post('/login').send({ email: 'inconnu' + Date.now() + '@test.com', password: 'nimporte' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Email ou mot de passe incorrect' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('E-mail connu, mauvais mot de passe : exactement la meme reponse, meme travail', async () => {
    const company = await createCompanyWithManager('login-unknown');
    spy.mockClear();
    const res = await request(app).post('/login').send({ email: company.email, password: 'faux-mot-de-passe' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Email ou mot de passe incorrect' });
    expect(spy).toHaveBeenCalledTimes(1);
  }, 30000);

  test('Champs absents ou de mauvais type : 400 clair, sans aucun calcul de hash', async () => {
    const corps = [{}, { email: 'a@b.com' }, { password: 'x' }, { email: { ne: 1 }, password: 'x' }, { email: 'a@b.com', password: 12345 }, { email: '', password: '' }];
    for (const body of corps) {
      const res = await request(app).post('/login').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'E-mail et mot de passe obligatoires' });
    }
    expect(spy).not.toHaveBeenCalled();
  });
});