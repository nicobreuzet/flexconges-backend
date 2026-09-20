const request = require('supertest');
const app = require('../server');

async function createUserAndLogin(role = 'employee') {
  const user = {
    email: `test${Date.now()}${Math.random()}@test.com`,
    password: 'motdepasse123',
    firstName: 'Test',
    lastName: role === 'manager' ? 'Manager' : 'Employee',
    role
  };

  await request(app).post('/register').send(user);
  const res = await request(app).post('/login').send({
    email: user.email,
    password: user.password
  });

  return { user, token: res.body.token };
}

module.exports = { createUserAndLogin };