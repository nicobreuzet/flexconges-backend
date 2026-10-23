const { validatePassword } = require('../utils/passwordPolicy');

describe('validatePassword', () => {
  test('accepte un mot de passe qui respecte toutes les regles', () => {
    expect(validatePassword('Abcdefghij1!')).toBeNull();
  });

  test('accepte une phrase de passe : un espace compte comme caractere special', () => {
    expect(validatePassword('Mon cabinet 2026')).toBeNull();
  });

  test('accepte une majuscule accentuee et un tiret comme caractere special', () => {
    expect(validatePassword('\u00c9lodie-Motdepasse1')).toBeNull();
  });

  test('refuse 11 caracteres, accepte 12', () => {
    expect(validatePassword('Abcdefghi1!')).toMatch(/12/);
    expect(validatePassword('Abcdefghij1!')).toBeNull();
  });

  test('refuse sans majuscule', () => {
    expect(validatePassword('abcdefghij1!')).toMatch(/majuscule/);
  });

  test('refuse sans chiffre', () => {
    expect(validatePassword('Abcdefghijk!')).toMatch(/chiffre/);
  });

  test('refuse sans caractere special', () => {
    expect(validatePassword('Abcdefghijk1')).toMatch(/sp.cial/);
  });

  test('la limite est de 72 octets, pas de 72 caracteres', () => {
    expect(validatePassword('Aa1!' + 'x'.repeat(68))).toBeNull();
    expect(validatePassword('Aa1!' + 'x'.repeat(69))).toMatch(/72/);
    // 4 + 35 caracteres mais 4 + 70 = 74 octets (chaque e accentue pese 2 octets)
    expect(validatePassword('Aa1!' + '\u00e9'.repeat(35))).toMatch(/72/);
  });

  test('refuse ce qui n est pas une chaine', () => {
    [undefined, null, 123, {}, ['Abcdefghij1!']].forEach((v) => {
      expect(validatePassword(v)).not.toBeNull();
    });
  });

  test('refuse un mot de passe qui contient l e-mail ou sa partie avant le @', () => {
    expect(validatePassword('Jean.Dupont1!', { email: 'jean.dupont@cabinet.fr' })).toMatch(/e-mail/);
    expect(validatePassword('xJEAN.DUPONT@cabinet.fr1', { email: 'jean.dupont@cabinet.fr' })).toMatch(/e-mail/);
  });

  test('ne compare pas avec une partie avant le @ trop courte (moins de 4 caracteres)', () => {
    expect(validatePassword('Alexandre-2026!', { email: 'al@x.fr' })).toBeNull();
  });

  test('sans e-mail fourni, pas de comparaison avec l e-mail', () => {
    expect(validatePassword('Jean.Dupont1!')).toBeNull();
  });

  test('ne retire jamais les espaces : un espace final fait partie du mot de passe', () => {
    // 11 caracteres + 1 espace = 12, et l espace est le caractere special
    expect(validatePassword('Abcdefghij1 ')).toBeNull();
  });
});