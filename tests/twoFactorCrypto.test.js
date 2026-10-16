const { encryptSecret, decryptSecret, isEncrypted, assertKeyConfigured } = require('../utils/twoFactorCrypto');

// Deux clés de test, fabriquées à la main : jamais celles de la production
const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

describe('Chiffrement des secrets 2FA', () => {
  let original;
  beforeEach(() => {
    original = process.env.TWO_FACTOR_ENCRYPTION_KEY;
    process.env.TWO_FACTOR_ENCRYPTION_KEY = KEY_A;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
    else process.env.TWO_FACTOR_ENCRYPTION_KEY = original;
  });

  test('Chiffrer puis déchiffrer redonne le secret ; le résultat est préfixé et ne contient pas le secret', () => {
    const enc = encryptSecret(SECRET);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain(SECRET);
    expect(decryptSecret(enc)).toBe(SECRET);
  });

  test('Deux chiffrements du même secret donnent des résultats différents', () => {
    expect(encryptSecret(SECRET)).not.toBe(encryptSecret(SECRET));
  });

  test("Un secret à l'ancien format (en clair) est rendu tel quel, et null reste null", () => {
    expect(decryptSecret(SECRET)).toBe(SECRET);
    expect(decryptSecret(null)).toBeNull();
    expect(isEncrypted(SECRET)).toBe(false);
    expect(isEncrypted(encryptSecret(SECRET))).toBe(true);
  });

  test('Une donnée modifiée est refusée', () => {
    const parts = encryptSecret(SECRET).split(':'); // ['v1', iv, tag, données]
    const data = Buffer.from(parts[3], 'base64');
    data[0] ^= 1;
    parts[3] = data.toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow(/illisible/);
  });

  test('Une mauvaise clé est refusée', () => {
    const enc = encryptSecret(SECRET);
    process.env.TWO_FACTOR_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptSecret(enc)).toThrow(/illisible/);
  });

  test('Clé absente ou de mauvaise taille : erreur claire, sans fuite du secret', () => {
    delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
    expect(() => encryptSecret(SECRET)).toThrow(/manquante/);
    expect(() => assertKeyConfigured()).toThrow(/manquante/);

    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'trop-court';
    expect(() => encryptSecret(SECRET)).toThrow(/invalide/);
    try { encryptSecret(SECRET); } catch (e) { expect(e.message).not.toContain(SECRET); }
  });

  test('Un format chiffré tronqué est refusé', () => {
    expect(() => decryptSecret('v1:abc')).toThrow(/illisible/);
  });

  test('assertKeyConfigured réussit avec une clé valide', () => {
    expect(assertKeyConfigured()).toBe(true);
  });
});