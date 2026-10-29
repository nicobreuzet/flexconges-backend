// Tache 3.6 : POST /reset-password/verify verifie un jeton SANS le consommer (et sans rien ecrire).
const crypto = require('crypto');
const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');

jest.setTimeout(30000);

const verifier = (token) => request(app).post('/reset-password/verify').send({ token });

// Cree un cabinet et pose directement un jeton de reinitialisation sur son manager (aucun mail envoye).
async function avecJeton(label, { expire = false } = {}) {
  const c = await createCompanyWithManager(label);
  const token = crypto.randomBytes(32).toString('hex');
  const delta = expire ? -60 * 1000 : 15 * 60 * 1000;
  await prisma.user.update({
    where: { email: c.email },
    data: { resetToken: token, resetTokenExpires: new Date(Date.now() + delta) }
  });
  return { ...c, resetToken: token };
}

describe('POST /reset-password/verify', () => {
  test('un jeton valide repond 200 {valid:true} et n est PAS consomme', async () => {
    const c = await avecJeton('VerifOk');
    const res = await verifier(c.resetToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });

    const apres = await prisma.user.findUnique({ where: { email: c.email } });
    expect(apres.resetToken).toBe(c.resetToken);

    // Le meme jeton sert encore pour un vrai changement de mot de passe.
    const reset = await request(app).post('/reset-password').send({ token: c.resetToken, password: 'NouveauMotDePasse1!' });
    expect(reset.status).toBe(200);
  });

  test('un jeton inconnu est refuse avec le message habituel', async () => {
    const res = await verifier(crypto.randomBytes(32).toString('hex'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Lien invalide ou expir/);
  });

  test('un jeton expire est refuse avec le meme message', async () => {
    const c = await avecJeton('VerifExpire', { expire: true });
    const res = await verifier(c.resetToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Lien invalide ou expir/);
  });

  test('un jeton absent ou vide est refuse avec le meme message', async () => {
    for (const body of [{}, { token: '' }, { token: null }]) {
      const res = await request(app).post('/reset-password/verify').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Lien invalide ou expir/);
    }
  });

  test('un jeton qui n est pas une chaine (nombre, booleen, tableau, objet) est refuse, meme enveloppant un vrai jeton', async () => {
    const c = await avecJeton('VerifType');
    const mauvais = [12345, true, [c.resetToken], { equals: c.resetToken }, { not: '' }];
    for (const t of mauvais) {
      const res = await verifier(t);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Lien invalide ou expir/);
    }
  });

  test('la verification n ecrit rien : aucune ligne d audit de plus', async () => {
    const c = await avecJeton('VerifAudit');
    const avant = await prisma.auditLog.count({ where: { companyId: c.company.id } });
    expect((await verifier(c.resetToken)).status).toBe(200);
    expect((await verifier('inconnu')).status).toBe(400);
    const apres = await prisma.auditLog.count({ where: { companyId: c.company.id } });
    expect(apres).toBe(avant);
  });
});

describe('Route existante /reset-password : jeton enveloppe dans un objet', () => {
  test('un objet {equals: jeton} ne change pas le mot de passe et le jeton reste utilisable', async () => {
    const c = await avecJeton('ResetType');
    const res = await request(app)
      .post('/reset-password')
      .send({ token: { equals: c.resetToken }, password: 'NouveauMotDePasse1!' });
    expect(res.status).toBe(400);

    const login = await request(app).post('/login').send({ email: c.email, password: c.password });
    expect(login.status).toBe(200);
    const apres = await prisma.user.findUnique({ where: { email: c.email } });
    expect(apres.resetToken).toBe(c.resetToken);
  });
});