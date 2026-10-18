const { sendMail, deliver, parseFrom, isAllowedRecipient } = require('../config/mailer');

describe('mailer (Brevo)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.MAIL_FROM;
  });

  test('parseFrom lit "Nom <adresse>" et une adresse seule', () => {
    expect(parseFrom('FlexCongés <noreply@flexiabilite.fr>')).toEqual({ name: 'FlexCongés', email: 'noreply@flexiabilite.fr' });
    expect(parseFrom('noreply@flexiabilite.fr').email).toBe('noreply@flexiabilite.fr');
  });

  test('parseFrom refuse une valeur invalide', () => {
    expect(() => parseFrom('pas une adresse')).toThrow(/MAIL_FROM invalide/);
    expect(() => parseFrom('')).toThrow(/MAIL_FROM invalide/);
  });

  test('deliver envoie le bon JSON, la clé dans l\'entête api-key', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    process.env.MAIL_FROM = 'FlexCongés <noreply@flexiabilite.fr>';
    await deliver('cle-de-test', 'a@b.fr', 'Sujet', 'Corps');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(opts.method).toBe('POST');
    expect(opts.headers['api-key']).toBe('cle-de-test');
    const body = JSON.parse(opts.body);
    expect(body.sender).toEqual({ name: 'FlexCongés', email: 'noreply@flexiabilite.fr' });
    expect(body.to).toEqual([{ email: 'a@b.fr' }]);
    expect(body.subject).toBe('Sujet');
    expect(body.textContent).toBe('Corps');
    expect(opts.body).not.toContain('cle-de-test');
  });

  test('un refus de Brevo lève une erreur sans jamais contenir la clé', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: 'unauthorized', message: 'Key not found' }) });
    process.env.MAIL_FROM = 'noreply@flexiabilite.fr';
    let message = '';
    try { await deliver('cle-secrete-xyz', 'a@b.fr', 'S', 'C'); } catch (e) { message = e.message; }
    expect(message).toMatch(/HTTP 401/);
    expect(message).not.toContain('cle-secrete-xyz');
  });

  test('une panne réseau lève une erreur claire', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { name: 'TypeError' }));
    process.env.MAIL_FROM = 'noreply@flexiabilite.fr';
    await expect(deliver('k', 'a@b.fr', 'S', 'C')).rejects.toThrow(/Brevo injoignable/);
  });

  test('sendMail pendant les tests : aucun appel réseau', async () => {
    global.fetch = jest.fn();
    await sendMail('a@b.fr', 'S', 'C');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('liste blanche des destinataires', () => {
  afterEach(() => { delete process.env.MAIL_ALLOWED_RECIPIENTS; });

  test('sans variable : tout le monde est autorisé', () => {
    expect(isAllowedRecipient('n.importe@qui.com')).toBe(true);
  });

  test('avec une liste : adresse exacte et domaine entier, sans tenir compte des majuscules', () => {
    process.env.MAIL_ALLOWED_RECIPIENTS = 'moi@gmail.com, @flexiabilite.fr';
    expect(isAllowedRecipient('Moi@Gmail.com')).toBe(true);
    expect(isAllowedRecipient('paul@flexiabilite.fr')).toBe(true);
    expect(isAllowedRecipient('nic.olas@bbr.com')).toBe(false);
    expect(isAllowedRecipient('moi@gmail.com.evil.fr')).toBe(false);
  });

  test('une variable vide ou avec seulement des virgules autorise tout (pas de blocage involontaire)', () => {
    process.env.MAIL_ALLOWED_RECIPIENTS = '  ';
    expect(isAllowedRecipient('a@b.fr')).toBe(true);
  });
});