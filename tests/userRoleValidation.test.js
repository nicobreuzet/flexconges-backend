// Le role d'un utilisateur ne peut valoir que 'manager' ou 'employee' (creation et modification).
const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager, createEmployee } = require('./helpers');

jest.setTimeout(60000);

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
const creer = (token, email, role) =>
  request(app).post('/users').set(auth(token)).send({ email, firstName: 'Test', lastName: 'Role', role });
const modifier = (token, id, corps) => request(app).put(`/users/${id}`).set(auth(token)).send(corps);
const roleEnBase = async (email) => (await prisma.user.findUnique({ where: { email } })).role;

describe('Role : valeurs acceptees', () => {
  test('creation : un role autre que manager ou employee est refuse (400) et rien n est cree', async () => {
    const m = await createCompanyWithManager('RoleCreationRefus');
    for (const role of ['Manager', 'admin', 'EMPLOYEE', ' manager', 'superviseur']) {
      const email = `role${uniq()}@test.com`;
      const res = await creer(m.token, email, role);
      expect(res.status).toBe(400);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    }
  });

  test('temoin : la creation avec manager ou employee reste acceptee', async () => {
    const m = await createCompanyWithManager('RoleCreationOk');
    for (const role of ['manager', 'employee']) {
      const email = `role${uniq()}@test.com`;
      const res = await creer(m.token, email, role);
      expect(res.status).toBe(201);
      expect(await roleEnBase(email)).toBe(role);
    }
  });

  test('modification : un role invalide est refuse (400) et le role ne change pas', async () => {
    const m = await createCompanyWithManager('RoleModifRefus');
    const e = await createEmployee(m.token);
    for (const role of ['Manager', 'admin', '']) {
      const res = await modifier(m.token, e.user.id, { role });
      expect(res.status).toBe(400);
      expect(await roleEnBase(e.email)).toBe('employee');
    }
  });

  test('temoin : modifier sans role, ou avec un role valide, reste accepte', async () => {
    const m = await createCompanyWithManager('RoleModifOk');
    const e = await createEmployee(m.token);
    expect((await modifier(m.token, e.user.id, { firstName: 'Nouveau' })).status).toBe(200);
    expect(await roleEnBase(e.email)).toBe('employee');
    expect((await modifier(m.token, e.user.id, { role: 'manager' })).status).toBe(200);
    expect(await roleEnBase(e.email)).toBe('manager');
  });
});