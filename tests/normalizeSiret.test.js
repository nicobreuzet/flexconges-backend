// SIRET : 14 chiffres, espaces retires. Une valeur invalide donne null.
const { normalizeSiret } = require('../utils/normalizeSiret');

describe('normalizeSiret', () => {
  test('accepte 14 chiffres, y compris avec des zeros au debut', () => {
    expect(normalizeSiret('82341567800012')).toBe('82341567800012');
    expect(normalizeSiret('00012345678901')).toBe('00012345678901');
  });

  test('retire les espaces autour et au milieu (espace insecable compris)', () => {
    expect(normalizeSiret('  823 415 678 00012  ')).toBe('82341567800012');
    expect(normalizeSiret('823\u00a0415\u00a0678\u00a000012')).toBe('82341567800012');
  });

  test('refuse tout ce qui n est pas exactement 14 chiffres ASCII', () => {
    const mauvais = [
      '1234567890123', '123456789012345', '8234156780001A', '823-415-678-00012',
      '823.415.678.00012', '', '   ', '\u0668'.repeat(14), 'abc'
    ];
    for (const v of mauvais) expect(normalizeSiret(v)).toBeNull();
  });

  test('refuse ce qui n est pas une chaine (un nombre perdrait un zero initial)', () => {
    for (const v of [82341567800012, null, undefined, {}, [], true]) {
      expect(normalizeSiret(v)).toBeNull();
    }
  });
});