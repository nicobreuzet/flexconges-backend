const { normalizeEmail } = require('../utils/normalizeEmail');

describe('normalizeEmail', () => {
  test('met en minuscules et retire les espaces autour', () => {
    expect(normalizeEmail('  Jean.Dupont@Cabinet.FR  ')).toBe('jean.dupont@cabinet.fr');
  });

  test('deux casses differentes donnent la meme valeur', () => {
    expect(normalizeEmail('A@x.fr')).toBe(normalizeEmail('a@X.FR'));
  });

  test('garde la partie +etiquette', () => {
    expect(normalizeEmail('Nicolas+Flex@Gmail.com')).toBe('nicolas+flex@gmail.com');
  });

  test('unifie un accent compose et decompose', () => {
    const compose = '\u00c9mile@x.fr';
    const decompose = 'E\u0301mile@x.fr';
    expect(normalizeEmail(compose)).toBe('\u00e9mile@x.fr');
    expect(normalizeEmail(decompose)).toBe('\u00e9mile@x.fr');
  });

  test('est idempotente (normaliser deux fois ne change rien)', () => {
    const une = normalizeEmail('  Marie@Cabinet.FR ');
    expect(normalizeEmail(une)).toBe(une);
  });

  test.each([
    [undefined],
    [null],
    [42],
    [{}],
    [['a@x.fr']],
    [''],
    ['   '],
    ['sans-arobase'],
    ['a@b'],
    ['a b@x.fr'],
    ['a@@x.fr'],
    ['@x.fr'],
    ['a@.fr'],
    ['a@x.'],
    ['a'.repeat(250) + '@x.fr'],
  ])('refuse %p (renvoie null)', (valeur) => {
    expect(normalizeEmail(valeur)).toBeNull();
  });

  test('accepte une adresse de 254 caracteres exactement', () => {
    const adresse = 'a'.repeat(254 - '@x.fr'.length) + '@x.fr';
    expect(adresse.length).toBe(254);
    expect(normalizeEmail(adresse)).toBe(adresse);
  });
});