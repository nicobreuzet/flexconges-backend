// Jours feries francais d'une annee : 8 a date fixe + 3 qui dependent de Paques (calcul, pas de liste en dur).
const { frenchHolidays } = require('../utils/frenchHolidays');

const dates = (annee) => frenchHolidays(annee).map((h) => h.date);

describe('frenchHolidays', () => {
  test('2026 : les 11 jours feries, tries par date', () => {
    expect(dates(2026)).toEqual([
      '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25',
      '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25'
    ]);
  });

  test('jours dependant de Paques : lundi de Paques, Ascension, lundi de Pentecote (2025 a 2030)', () => {
    const attendu = {
      2025: ['2025-04-21', '2025-05-29', '2025-06-09'],
      2027: ['2027-03-29', '2027-05-06', '2027-05-17'],
      2028: ['2028-04-17', '2028-05-25', '2028-06-05'],
      2030: ['2030-04-22', '2030-05-30', '2030-06-10']
    };
    for (const [annee, [paques, ascension, pentecote]] of Object.entries(attendu)) {
      const liste = dates(Number(annee));
      expect(liste).toContain(paques);
      expect(liste).toContain(ascension);
      expect(liste).toContain(pentecote);
    }
  });

  test('libelles : en francais, non vides, et les trois jours mobiles sont nommes', () => {
    const l = frenchHolidays(2026);
    const label = (d) => l.find((h) => h.date === d).label;
    expect(label('2026-04-06')).toBe('Lundi de P\u00e2ques');
    expect(label('2026-05-14')).toBe('Ascension');
    expect(label('2026-05-25')).toBe('Lundi de Pentec\u00f4te');
    expect(label('2026-12-25')).toBe('No\u00ebl');
    for (const h of l) {
      expect(typeof h.label).toBe('string');
      expect(h.label.length).toBeGreaterThan(0);
    }
  });

  test('chaque annee a 11 dates distinctes au format AAAA-MM-JJ', () => {
    for (let annee = 2024; annee <= 2035; annee++) {
      const liste = dates(annee);
      expect(liste).toHaveLength(11);
      expect(new Set(liste).size).toBe(11);
      for (const d of liste) expect(d).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
      expect(liste.every((d) => d.startsWith(String(annee)))).toBe(true);
      expect([...liste].sort()).toEqual(liste);
    }
  });

  test('une annee qui n est pas un entier est refusee', () => {
    for (const mauvais of ['2026', 2026.5, null, undefined, NaN]) {
      expect(() => frenchHolidays(mauvais)).toThrow();
    }
  });
});