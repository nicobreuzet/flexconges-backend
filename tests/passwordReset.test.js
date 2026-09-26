const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');

describe('Réinitialisation de mot de passe', () => {
  test('Le flux complet fonctionne : demande, jeton, nouveau mot de passe, connexion', async () => {
    const company = await createCompanyWithManager('Reset');

    const forgot = await request(app).post('/forgot-password').send({ email: company.email });
    expect(forgot.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: company.email } });
    expect(user.resetToken).not.toBeNull();

    const newPassword = 'NouveauMotDePasse1!';
    const reset = await request(app).post('/reset-password').send({ token: user.resetToken, password: newPassword });
    expect(reset.status).toBe(200);

    const loginNew = await request(app).post('/login').send({ email: company.email, password: newPassword });
    expect(loginNew.status).toBe(200);
    expect(typeof loginNew.body.token).toBe('string');

    const loginOld = await request(app).post('/login').send({ email: company.email, password: company.password });
    expect(loginOld.status).toBe(401);
  });

  test('Demander une réinitialisation pour un e-mail inexistant renvoie la même réponse générique, sans erreur', async () => {
    const res = await request(app).post('/forgot-password').send({ email: `inexistant${Date.now()}@test.com` });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Si cet e-mail existe/);
  });

  test('Un jeton invalide est refusé', async () => {
    const res = await request(app).post('/reset-password').send({ token: 'jeton-invente', password: 'NouveauMotDePasse1!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide ou expiré/);
  });

  test('Un mot de passe trop faible est refusé, même avec un jeton valide', async () => {
    const company = await createCompanyWithManager('ResetFaible');
    await request(app).post('/forgot-password').send({ email: company.email });
    const user = await prisma.user.findUnique({ where: { email: company.email } });

    const res = await request(app).post('/reset-password').send({ token: user.resetToken, password: 'faible' });
    expect(res.status).toBe(400);
  });
});