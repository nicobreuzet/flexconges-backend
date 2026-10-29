// Tache 3.2 : tant qu'un cabinet n'a rien enregistre, son identite porte le NOM DE LA SOCIETE,
// jamais le nom de demonstration (c'est le serveur qui l'envoyait).
const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');
const { DEFAULT_BRANDING, getBrandingConfig } = require('../utils/companyConfig');

jest.setTimeout(30000);

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const getCompany = (token) => request(app).get('/company').set(auth(token));
const patch = (token, body) => request(app).patch('/company').set(auth(token)).send(body);
const NOM_DEMO = 'FlexCong\u00e9s D\u00e9mo';

describe('getBrandingConfig : nom par defaut', () => {
  test('sans nom de societe : le nom historique est conserve (comportement inchange)', () => {
    expect(getBrandingConfig(null).name).toBe(DEFAULT_BRANDING.name);
    expect(DEFAULT_BRANDING.name).toBe(NOM_DEMO);
  });

  test('avec le nom de la societe : il remplace le nom par defaut, le reste ne change pas', () => {
    const r = getBrandingConfig(null, 'Cabinet Dupont');
    expect(r.name).toBe('Cabinet Dupont');
    expect(r).toEqual({ ...DEFAULT_BRANDING, name: 'Cabinet Dupont' });
  });

  test('un nom enregistre par le cabinet l emporte sur le nom de la societe', () => {
    expect(getBrandingConfig({ name: 'Nom choisi' }, 'Cabinet Dupont').name).toBe('Nom choisi');
  });

  test('un nom de societe trop long est borne a 80 caracteres', () => {
    const r = getBrandingConfig(null, 'A'.repeat(120));
    expect(r.name).toBe('A'.repeat(80));
  });

  test('un nom de societe inutilisable retombe sur le nom par defaut', () => {
    for (const mauvais of ['', '   ', 42, null, 'abc\u0001def']) {
      expect(getBrandingConfig(null, mauvais).name).toBe(DEFAULT_BRANDING.name);
    }
  });
});

describe('Route /company : nom par defaut', () => {
  test('GET /company d une societe neuve renvoie le nom de la societe, pas le nom de demonstration', async () => {
    const c = await createCompanyWithManager('NomDefaut');
    const res = await getCompany(c.token);
    expect(res.status).toBe(200);
    expect(res.body.brandingConfig.name).toBe(c.company.name);
    expect(res.body.brandingConfig).toEqual({ ...DEFAULT_BRANDING, name: c.company.name });
    expect(JSON.stringify(res.body.brandingConfig)).not.toContain('D\u00e9mo');
  });

  test('un PATCH partiel de l identite n ecrit pas le nom de demonstration dans la base', async () => {
    const c = await createCompanyWithManager('NomPatch');
    const res = await patch(c.token, { brandingConfig: { primaryColor: '#112233' } });
    expect(res.status).toBe(200);
    expect(res.body.brandingConfig.name).toBe(c.company.name);
    expect(res.body.brandingConfig.primaryColor).toBe('#112233');

    const stocke = await prisma.company.findUnique({ where: { id: c.company.id } });
    expect(stocke.brandingConfig.name).toBe(c.company.name);
    expect(JSON.stringify(stocke.brandingConfig)).not.toContain('D\u00e9mo');
  });
});