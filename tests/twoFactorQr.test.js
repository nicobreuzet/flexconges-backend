const request = require('supertest');
const app = require('../server');
const prisma = require('../config/prisma');
const { createCompanyWithManager } = require('./helpers');
const { codeAtStep } = require('./totpHelper');

jest.setTimeout(30000);

const auth = (company) => ({ Authorization: `Bearer ${company.token}` });

describe('2FA : QR code renvoyé par /2fa/setup', () => {
  test('La réponse contient le secret ET un QR code PNG valide (data URL)', async () => {
    const company = await createCompanyWithManager('2FA-qr');
    const res = await request(app).post('/2fa/setup').set(auth(company));
    expect(res.status).toBe(200);
    expect(typeof res.body.secret).toBe('string');

    expect(res.body.qrCode.startsWith('data:image/png;base64,')).toBe(true);
    const png = Buffer.from(res.body.qrCode.split(',')[1], 'base64');
    // Signature d'un fichier PNG : 0x89 "PNG"
    expect(png[0]).toBe(0x89);
    expect(png.slice(1, 4).toString('ascii')).toBe('PNG');
  });

  test('Chaque nouveau setup donne un nouveau secret et un nouveau QR code', async () => {
    const company = await createCompanyWithManager('2FA-qr-nouveau');
    const first = await request(app).post('/2fa/setup').set(auth(company));
    const second = await request(app).post('/2fa/setup').set(auth(company));
    expect(second.body.secret).not.toBe(first.body.secret);
    expect(second.body.qrCode).not.toBe(first.body.qrCode);
  });

  test('Le QR code n\'est pas stocké, et le secret en base reste chiffré', async () => {
    const company = await createCompanyWithManager('2FA-qr-base');
    const res = await request(app).post('/2fa/setup').set(auth(company));
    const secret = res.body.secret.replace(/\s/g, '');

    const user = await prisma.user.findUnique({ where: { email: company.email } });
    expect(user.twoFactorSecret.startsWith('v1:')).toBe(true);
    expect(user.twoFactorSecret).not.toContain(secret);
    expect(JSON.stringify(user)).not.toContain('data:image');
  });

  test('Une fois le 2FA actif, /2fa/setup est refusé (409) et ne renvoie pas de QR code', async () => {
    const company = await createCompanyWithManager('2FA-qr-actif');
    const setup = await request(app).post('/2fa/setup').set(auth(company));
    const secret = setup.body.secret.replace(/\s/g, '');
    await request(app).post('/2fa/verify-setup').set(auth(company)).send({ code: codeAtStep(secret, 0) });

    const again = await request(app).post('/2fa/setup').set(auth(company));
    expect(again.status).toBe(409);
    expect(again.body.qrCode).toBeUndefined();
  });
});