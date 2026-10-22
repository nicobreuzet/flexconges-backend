const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../server');
const { createCompanyWithManager } = require('./helpers');
const { codeAtStep } = require('./totpHelper');

// Chaque echec fait des comparaisons bcrypt : on laisse de la marge
jest.setTimeout(60000);

authenticator.options = { window: 1 };

// Adresses reservees a la documentation (RFC 5737) : jamais de vraie IP
const IP_X = '203.0.113.10';
const IP_Y = '203.0.113.20';

// Active le 2FA pour un manager (meme methode que twoFactor.test.js)
async function enable2FA(company) {
  const setup = await request(app)
    .post('/2fa/setup')
    .set('Authorization', `Bearer ${company.token}`);
  const secret = setup.body.secret.replace(/\s/g, '');

  const verify = await request(app)
    .post('/2fa/verify-setup')
    .set('Authorization', `Bearer ${company.token}`)
    .send({ code: authenticator.generate(secret) });
  if (verify.status !== 200) {
    throw new Error(`Activation 2FA echouee : ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return { secret };
}

// Premiere etape de connexion : renvoie le jeton temporaire
async function loginPending(company) {
  const res = await request(app).post('/login').send({ email: company.email, password: company.password });
  return res.body.pendingToken;
}

// Un code volontairement faux
function wrongCode(secret) {
  return authenticator.generate(secret) === '000000' ? '111111' : '000000';
}

// Appelle /login/verify-2fa en se faisant passer pour une adresse IP donnee
function verifyFrom(ip, pendingToken, code) {
  return request(app)
    .post('/login/verify-2fa')
    .set('X-Forwarded-For', ip)
    .send({ pendingToken, code });
}

describe('2FA : verrouillage par compte et par adresse IP (tache 1.4)', () => {
  test('Apres 5 mauvais codes depuis une IP, cette IP est verrouillee (429), meme avec le bon code', async () => {
    const company = await createCompanyWithManager('2FA-ip-lock');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);

    for (let i = 1; i <= 4; i++) {
      const r = await verifyFrom(IP_X, pending, wrongCode(secret));
      expect(r.status).toBe(401);
    }
    const fifth = await verifyFrom(IP_X, pending, wrongCode(secret));
    expect(fifth.status).toBe(429);

    const locked = await verifyFrom(IP_X, pending, codeAtStep(secret, 1));
    expect(locked.status).toBe(429);
  });

  test('Le verrou d une IP ne bloque pas la vraie personne qui se connecte depuis une autre IP', async () => {
    const company = await createCompanyWithManager('2FA-ip-other');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);

    // Un tiers qui connait le mot de passe verrouille SA adresse
    for (let i = 1; i <= 5; i++) {
      await verifyFrom(IP_X, pending, wrongCode(secret));
    }

    // La vraie personne, depuis une autre adresse, passe avec le bon code
    const good = await verifyFrom(IP_Y, pending, codeAtStep(secret, 1));
    expect(good.status).toBe(200);
    expect(typeof good.body.token).toBe('string');
  });

  test('Filet de compte : 20 echecs repartis sur plusieurs IP verrouillent tout le monde', async () => {
    const company = await createCompanyWithManager('2FA-account-cap');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);

    const ips = ['203.0.113.31', '203.0.113.32', '203.0.113.33', '203.0.113.34', '203.0.113.35'];
    let n = 0;
    for (const ip of ips) {
      for (let i = 0; i < 4; i++) {
        n++;
        const r = await verifyFrom(ip, pending, wrongCode(secret));
        // 4 echecs par IP : aucune IP n atteint son propre seuil, seul le 20e declenche le filet
        expect(r.status).toBe(n < 20 ? 401 : 429);
      }
    }

    // Une adresse neuve est elle aussi refusee : le compte entier est verrouille
    const good = await verifyFrom('203.0.113.99', pending, codeAtStep(secret, 1));
    expect(good.status).toBe(429);
  });

  test('20 requetes simultanees depuis la meme IP : au plus 4 codes refuses comme invalides, aucune ne passe', async () => {
    const company = await createCompanyWithManager('2FA-parallel');
    const { secret } = await enable2FA(company);
    const pending = await loginPending(company);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => verifyFrom(IP_X, pending, wrongCode(secret)))
    );
    const statuses = results.map((r) => r.status);
    const invalid = statuses.filter((s) => s === 401).length;

    expect(statuses).not.toContain(200);
    // Si le compteur est reserve AVANT le test du code : 4 x 401, puis que des 429
    expect(invalid).toBeLessThanOrEqual(4);

    const locked = await verifyFrom(IP_X, pending, codeAtStep(secret, 1));
    expect(locked.status).toBe(429);
  });

  test('Un succes remet a zero le compteur de cette IP', async () => {
    const company = await createCompanyWithManager('2FA-ip-reset');
    const { secret } = await enable2FA(company);
    const pending1 = await loginPending(company);

    for (let i = 1; i <= 4; i++) {
      const r = await verifyFrom(IP_X, pending1, wrongCode(secret));
      expect(r.status).toBe(401);
    }
    const ok = await verifyFrom(IP_X, pending1, codeAtStep(secret, 1));
    expect(ok.status).toBe(200);

    // Nouvelle connexion : si le compteur de l IP n avait pas ete remis a zero, le 1er echec serait le 5e
    const pending2 = await loginPending(company);
    for (let i = 1; i <= 4; i++) {
      const r = await verifyFrom(IP_X, pending2, wrongCode(secret));
      expect(r.status).toBe(401);
    }
  });
});