const { createCompanyWithManager, createEmployee, getLeaveTypeId } = require('./helpers');

describe('Helpers de test', () => {
  test('crée une société, un employé, et retrouve un type de congé', async () => {
    const a = await createCompanyWithManager('A');
    const employee = await createEmployee(a.token);
    const cpId = await getLeaveTypeId(employee.token, 'CP');

    expect(a.company.id).toBeGreaterThan(0);
    expect(typeof employee.token).toBe('string');
    expect(Number.isInteger(cpId)).toBe(true);
  });
});