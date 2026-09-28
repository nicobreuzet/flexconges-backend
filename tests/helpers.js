const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');

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

// Crée un employé dans la société du manager (via POST /users), puis le connecte.
// Depuis le chantier "invitation par email" : POST /users ne renvoie plus de mot de
// passe (personne ne le connaît). Pour se connecter dans les tests, on suit le même
// chemin qu'un vrai collaborateur : on récupère le jeton d'invitation directement en
// base (un test a un accès direct à la base, contrairement à un collaborateur réel),
// puis on passe par POST /reset-password, exactement comme "mot de passe oublié".
async function createEmployee(managerToken) {
  const email = `employee${uniq()}@test.com`;
  const testPassword = 'MotDePasseTest123!';

  const res = await request(app)
    .post('/users')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ email, firstName: 'Test', lastName: 'Employee', role: 'employee' });
  if (res.status !== 201) {
    throw new Error(`Création d'employé échouée : ${res.status} ${JSON.stringify(res.body)}`);
  }

  const created = await prisma.user.findUnique({ where: { email } });
  if (!created || !created.resetToken) {
    throw new Error(`Jeton d'invitation introuvable pour ${email}`);
  }

  const reset = await request(app)
    .post('/reset-password')
    .send({ token: created.resetToken, password: testPassword });
  if (reset.status !== 200) {
    throw new Error(`Définition du mot de passe via l'invitation échouée : ${reset.status} ${JSON.stringify(reset.body)}`);
  }

  const login = await request(app).post('/login').send({ email, password: testPassword });
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