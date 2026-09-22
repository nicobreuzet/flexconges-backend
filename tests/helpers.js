const request = require('supertest');
const app = require('../server');

function uniq() {
  return `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
}

// Crée une société + son manager, puis connecte le manager
async function createCompanyWithManager(label = 'A') {
  const email = `manager${uniq()}@test.com`;
  const password = 'motdepasse123';

  const reg = await request(app).post('/register').send({
    companyName: `Societe ${label} ${uniq()}`,
    email, password, firstName: 'Test', lastName: 'Manager'
  });
  if (reg.status !== 201) {
    throw new Error(`Création de société échouée : ${reg.status} ${JSON.stringify(reg.body)}`);
  }

  const login = await request(app).post('/login').send({ email, password });
  return { company: reg.body.company, manager: reg.body.user, email, password, token: login.body.token };
}

// Crée un employé dans la société du manager (via POST /users), puis le connecte
async function createEmployee(managerToken) {
  const email = `employee${uniq()}@test.com`;

  const res = await request(app)
    .post('/users')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ email, firstName: 'Test', lastName: 'Employee', role: 'employee' });
  if (res.status !== 201) {
    throw new Error(`Création d'employé échouée : ${res.status} ${JSON.stringify(res.body)}`);
  }

  const login = await request(app).post('/login').send({ email, password: res.body.tempPassword });
  return { user: res.body, email, token: login.body.token };
}

// Retrouve l'identifiant d'un type de congé de la société de ce token
async function getLeaveTypeId(token, code = 'CP') {
  const res = await request(app).get('/leave-types').set('Authorization', `Bearer ${token}`);
  const type = res.body.find(t => t.code === code);
  if (!type) throw new Error(`Type de congé ${code} introuvable`);
  return type.id;
}

// Compatibilité avec les anciens tests : crée une société complète à chaque appel
async function createUserAndLogin(role = 'employee') {
  const company = await createCompanyWithManager('Legacy');
  if (role === 'manager') {
    return { user: { email: company.email, password: company.password, role: 'manager' }, token: company.token };
  }
  const employee = await createEmployee(company.token);
  return { user: { email: employee.email, role: 'employee' }, token: employee.token };
}

module.exports = { createUserAndLogin, createCompanyWithManager, createEmployee, getLeaveTypeId };