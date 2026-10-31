// A l'inscription, un cabinet recoit les jours feries francais de l'annee en cours et des deux suivantes.
const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, getLeaveTypeId } = require('./helpers');

jest.setTimeout(60000);

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const jours = async (companyId) =>
  (await prisma.holiday.findMany({ where: { companyId } })).map((h) => h.date.toISOString().slice(0, 10));
const annee = () => new Date().getUTCFullYear();

describe('Jours feries a l inscription', () => {
  test('un nouveau cabinet recoit 33 jours feries (11 par annee, annee en cours plus deux)', async () => {
    const c = await createCompanyWithManager('FeriesNombre');
    expect(await jours(c.company.id)).toHaveLength(33);
  });

  test('les jours a date fixe des trois annees sont presents', async () => {
    const c = await createCompanyWithManager('FeriesDates');
    const liste = await jours(c.company.id);
    for (let a = annee(); a <= annee() + 2; a++) {
      for (const md of ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25']) {
        expect(liste).toContain(`${a}-${md}`);
      }
    }
    expect(liste).not.toContain(`${annee() + 3}-01-01`);
  });

  test('chaque cabinet a ses propres jours feries (aucun partage entre societes)', async () => {
    const a = await createCompanyWithManager('FeriesA');
    const b = await createCompanyWithManager('FeriesB');
    expect(await jours(a.company.id)).toHaveLength(33);
    expect(await jours(b.company.id)).toHaveLength(33);
  });

  test('temoin : un responsable peut toujours ajouter un jour ferie (un de plus)', async () => {
    const c = await createCompanyWithManager('FeriesAjout');
    const avant = (await jours(c.company.id)).length;
    const res = await request(app).post('/holidays').set(auth(c.token)).send({ date: `${annee() + 5}-12-26`, label: 'Saint-Etienne' });
    expect(res.status).toBe(201);
    expect((await jours(c.company.id)).length).toBe(avant + 1);
  });

  test('effet sur le calcul : un jour ferie en semaine n est pas decompte d une demande', async () => {
    const c = await createCompanyWithManager('FeriesCalcul');
    const y = annee() + 1;
    const candidats = ['05-01', '07-14', '08-15', '11-01', '11-11', '12-25'].map((md) => `${y}-${md}`);
    const jourFerie = candidats.find((d) => {
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      return dow >= 1 && dow <= 4; // du lundi au jeudi : le lendemain est aussi un jour ouvre
    });
    expect(jourFerie).toBeDefined();
    const lendemain = new Date(new Date(jourFerie + 'T00:00:00Z').getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const cp = await getLeaveTypeId(c.token, 'CP');
    const res = await request(app).post('/leave-requests').set(auth(c.token))
      .send({ startDate: jourFerie, endDate: lendemain, leaveTypeId: cp });
    expect(res.status).toBe(201);
    expect(res.body.daysCount).toBe(1);
  });
});