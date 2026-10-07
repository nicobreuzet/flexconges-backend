const request = require('supertest');
const app = require('../server');
const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

const bearer = (t) => ({ Authorization: 'Bearer ' + t });
const getLogs = (token, query = '') => request(app).get('/audit-logs' + query).set(bearer(token));
// Toutes les lignes du journal dont l'action commence par ce prefixe (page de 100 max)
const logsOf = async (token, prefix) => (await getLogs(token, '?limit=100&action=' + prefix)).body.items;

describe('Journal d audit B6 : actions metier', () => {
  test('Cycle de vie d une demande : chaque etape est tracee, sans commentaire, brouillons exclus', async () => {
    const company = await createCompanyWithManager('audit-leave');
    const emp = await createEmployee(company.token);
    const cpId = await getLeaveTypeId(emp.token, 'CP');
    const post = (body) => request(app).post('/leave-requests').set(bearer(emp.token)).send(body);
    const decide = (id, decision, managerComment) =>
      request(app).patch('/leave-requests/' + id + '/decision').set(bearer(company.token)).send({ decision, managerComment });

    // A : creee puis approuvee (avec deux commentaires qui ne doivent JAMAIS finir dans le journal)
    const a = await post({ startDate: '2027-03-01', endDate: '2027-03-05', leaveTypeId: cpId, comment: 'SECRET-COMMENT-123' });
    expect(a.status).toBe(201);
    expect((await decide(a.body.id, 'approved', 'SECRET-MANAGER-456')).status).toBe(200);

    // B : creee puis refusee
    const b = await post({ startDate: '2027-03-08', endDate: '2027-03-10', leaveTypeId: cpId });
    expect(b.status).toBe(201);
    expect((await decide(b.body.id, 'rejected', 'Non')).status).toBe(200);

    // C : creee puis annulee par le collaborateur
    const c = await post({ startDate: '2027-03-15', endDate: '2027-03-16', leaveTypeId: cpId });
    expect(c.status).toBe(201);
    const cancel = await request(app).patch('/leave-requests/' + c.body.id + '/cancel').set(bearer(emp.token));
    expect(cancel.status).toBe(200);

    // Brouillons : creer, modifier, supprimer ne laisse AUCUNE trace
    const avant = (await logsOf(company.token, 'leave.')).length;
    const d1 = await post({ startDate: '2027-03-22', endDate: '2027-03-23', leaveTypeId: cpId, asDraft: true });
    expect(d1.status).toBe(201);
    const put = await request(app).put('/leave-requests/' + d1.body.id).set(bearer(emp.token))
      .send({ startDate: '2027-03-22', endDate: '2027-03-24', leaveTypeId: cpId });
    expect(put.status).toBe(200);
    const d2 = await post({ startDate: '2027-03-29', endDate: '2027-03-30', leaveTypeId: cpId, asDraft: true });
    expect(d2.status).toBe(201);
    expect((await request(app).delete('/leave-requests/' + d2.body.id).set(bearer(emp.token))).status).toBe(204);
    expect((await logsOf(company.token, 'leave.')).length).toBe(avant);

    // Soumettre le brouillon, en revanche, est une vraie etape
    const submit = await request(app).patch('/leave-requests/' + d1.body.id + '/submit').set(bearer(emp.token));
    expect(submit.status).toBe(200);

    const items = await logsOf(company.token, 'leave.');
    const by = (action) => items.filter(i => i.action === action);

    expect(by('leave.created')).toHaveLength(3); // A, B, C (pas les brouillons)
    const createdA = by('leave.created').find(i => i.details.demandeId === a.body.id);
    expect(createdA.details).toMatchObject({ typeConge: a.body.leaveType.label, du: '2027-03-01', au: '2027-03-05', jours: 5 });
    expect(createdA.user.id).toBe(emp.user.id);

    expect(by('leave.approved')).toHaveLength(1);
    expect(by('leave.approved')[0].details).toMatchObject({ demandeId: a.body.id, collaborateur: 'Test Employee', jours: 5 });
    expect(by('leave.approved')[0].user.id).toBe(company.manager.id);

    expect(by('leave.rejected')).toHaveLength(1);
    expect(by('leave.rejected')[0].details.demandeId).toBe(b.body.id);

    expect(by('leave.cancelled')).toHaveLength(1);
    expect(by('leave.cancelled')[0].details).toMatchObject({ demandeId: c.body.id, du: '2027-03-15', au: '2027-03-16', jours: 2 });
    expect(by('leave.cancelled')[0].user.id).toBe(emp.user.id);

    expect(by('leave.submitted')).toHaveLength(1);
    expect(by('leave.submitted')[0].details).toMatchObject({ demandeId: d1.body.id, du: '2027-03-22', au: '2027-03-24', jours: 3 });

    // Aucun commentaire (collaborateur ou manager) dans tout le journal
    const tout = JSON.stringify((await getLogs(company.token, '?limit=100')).body);
    expect(tout).not.toContain('SECRET-COMMENT-123');
    expect(tout).not.toContain('SECRET-MANAGER-456');

    // Une autre societe ne voit rien de tout cela
    const autre = await createCompanyWithManager('audit-leave-other');
    expect(await logsOf(autre.token, 'leave.')).toHaveLength(0);
  }, 30000);

  test('Equipes, jours feries, types de conge : ecritures tracees, refus non traces', async () => {
    const company = await createCompanyWithManager('audit-admin');
    const emp = await createEmployee(company.token);
    const m = bearer(company.token);

    // Un employe (403) et un nom vide (400) ne laissent aucune trace
    expect((await request(app).post('/teams').set(bearer(emp.token)).send({ name: 'Pirate' })).status).toBe(403);
    expect((await request(app).post('/teams').set(m).send({ name: '' })).status).toBe(400);
    expect(await logsOf(company.token, 'team.')).toHaveLength(0);

    // Equipes
    const team = await request(app).post('/teams').set(m).send({ name: 'Equipe Alpha' });
    expect(team.status).toBe(201);
    expect((await request(app).put('/teams/' + team.body.id).set(m).send({ name: 'Equipe Beta' })).status).toBe(200);
    expect((await request(app).delete('/teams/' + team.body.id).set(m)).status).toBe(204);
    const teams = await logsOf(company.token, 'team.');
    const t = (a) => teams.find(i => i.action === a);
    expect(teams).toHaveLength(3);
    expect(t('team.created').details).toEqual({ equipeId: team.body.id, equipe: 'Equipe Alpha' });
    expect(t('team.updated').details).toEqual({ equipeId: team.body.id, de: 'Equipe Alpha', vers: 'Equipe Beta' });
    expect(t('team.deleted').details).toEqual({ equipeId: team.body.id, equipe: 'Equipe Beta' });
    expect(t('team.deleted').user.id).toBe(company.manager.id);

    // Jours feries
    const h = await request(app).post('/holidays').set(m).send({ date: '2027-05-01', label: 'Fete A' });
    expect(h.status).toBe(201);
    expect((await request(app).put('/holidays/' + h.body.id).set(m).send({ date: '2027-05-08', label: 'Fete B' })).status).toBe(200);
    expect((await request(app).delete('/holidays/' + h.body.id).set(m)).status).toBe(204);
    const hol = await logsOf(company.token, 'holiday.');
    const hf = (a) => hol.find(i => i.action === a);
    expect(hol).toHaveLength(3);
    expect(hf('holiday.created').details).toEqual({ date: '2027-05-01', libelle: 'Fete A' });
    expect(hf('holiday.updated').details).toEqual({ de: { date: '2027-05-01', libelle: 'Fete A' }, vers: { date: '2027-05-08', libelle: 'Fete B' } });
    expect(hf('holiday.deleted').details).toEqual({ date: '2027-05-08', libelle: 'Fete B' });

    // Types de conge (ils changent le calcul des soldes : tracer le plafond avant/apres)
    const lt = await request(app).post('/leave-types').set(m).send({ code: 'tst', label: 'Type test', annualCap: 10 });
    expect(lt.status).toBe(201);
    expect((await request(app).put('/leave-types/' + lt.body.id).set(m)
      .send({ code: 'tst', label: 'Type renomme', color: '#111111', annualCap: 12 })).status).toBe(200);
    expect((await request(app).delete('/leave-types/' + lt.body.id).set(m)).status).toBe(204);
    const types = await logsOf(company.token, 'leave_type.');
    const tf = (a) => types.find(i => i.action === a);
    expect(types).toHaveLength(3);
    expect(tf('leave_type.created').details).toEqual({ typeId: lt.body.id, code: 'TST', libelle: 'Type test', plafondAnnuel: 10 });
    expect(tf('leave_type.updated').details).toEqual({ typeId: lt.body.id, code: 'TST', libelle: 'Type renomme', plafondAnnuel: { de: 10, vers: 12 } });
    expect(tf('leave_type.deleted').details).toEqual({ typeId: lt.body.id, code: 'TST', libelle: 'Type renomme' });
  }, 30000);

  test('La creation d une societe est tracee (company.registered)', async () => {
    const company = await createCompanyWithManager('audit-register');
    const items = await logsOf(company.token, 'company.registered');
    expect(items).toHaveLength(1);
    expect(items[0].details).toEqual({ societe: company.company.name });
    expect(items[0].user.id).toBe(company.manager.id);
  }, 30000);
});