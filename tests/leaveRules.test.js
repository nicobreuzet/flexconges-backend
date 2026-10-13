const { checkNotice, findCrowdedDay, listWorkingDays, isoDay, frDate } = require('../utils/leaveRules');

// Semaine du lundi 12 au vendredi 16 octobre 2026
const SEMAINE = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];

describe('leaveRules : jours travaillés', () => {
  test('une semaine complète = 5 jours, week-end exclu', () => {
    expect(listWorkingDays('2026-10-12', '2026-10-18')).toEqual(SEMAINE);
  });

  test('un jour férié est exclu', () => {
    const jours = listWorkingDays('2026-10-12', '2026-10-18', new Set(['2026-10-14']));
    expect(jours).toEqual(['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16']);
  });

  test('un week-end seul ne contient aucun jour travaillé', () => {
    expect(listWorkingDays('2026-10-17', '2026-10-18')).toEqual([]);
  });
});

describe('leaveRules : préavis', () => {
  const base = { annualCap: 25, todayIso: '2026-10-13' };

  test('aucune règle (0) ou type sans solde annuel : toujours accepté', () => {
    expect(checkNotice({ ...base, noticeDays: 0, startIso: '2026-10-13' }).ok).toBe(true);
    expect(checkNotice({ ...base, noticeDays: 14, annualCap: null, startIso: '2026-10-13' }).ok).toBe(true);
  });

  test('la limite exacte est acceptée, un jour de moins est refusé avec le premier jour possible', () => {
    expect(checkNotice({ ...base, noticeDays: 14, startIso: '2026-10-27' }).ok).toBe(true);
    const refus = checkNotice({ ...base, noticeDays: 14, startIso: '2026-10-26' });
    expect(refus.ok).toBe(false);
    expect(refus.error).toMatch(/14 jour\(s\) de préavis/);
    expect(refus.error).toMatch(/27\/10\/2026/);
  });

  test('une date passée est refusée quand un préavis est exigé', () => {
    expect(checkNotice({ ...base, noticeDays: 14, startIso: '2026-10-01' }).ok).toBe(false);
  });
});

describe('leaveRules : absences simultanées', () => {
  const autres = [
    { userId: 1, startIso: '2026-10-12', endIso: '2026-10-13' },
    { userId: 2, startIso: '2026-10-13', endIso: '2026-10-14' }
  ];

  test('refuse le premier jour où le maximum serait dépassé', () => {
    expect(findCrowdedDay({ workingDays: SEMAINE, otherRanges: autres, max: 2 })).toBe('2026-10-13');
  });

  test('accepte quand le maximum est respecté', () => {
    expect(findCrowdedDay({ workingDays: SEMAINE, otherRanges: autres, max: 3 })).toBeNull();
    expect(findCrowdedDay({ workingDays: SEMAINE, otherRanges: [autres[0]], max: 2 })).toBeNull();
  });

  test('un même collaborateur n\'est compté qu\'une fois', () => {
    const doublon = [
      { userId: 1, startIso: '2026-10-12', endIso: '2026-10-13' },
      { userId: 1, startIso: '2026-10-13', endIso: '2026-10-14' }
    ];
    expect(findCrowdedDay({ workingDays: SEMAINE, otherRanges: doublon, max: 2 })).toBeNull();
  });

  test('les absences hors des jours de la demande sont ignorées', () => {
    expect(findCrowdedDay({ workingDays: ['2026-10-12'], otherRanges: [autres[1]], max: 1 })).toBeNull();
  });
});

describe('leaveRules : utilitaires', () => {
  test('isoDay et frDate', () => {
    expect(isoDay('2026-10-12')).toBe('2026-10-12');
    expect(isoDay(new Date('2026-10-12T00:00:00Z'))).toBe('2026-10-12');
    expect(frDate('2026-10-27')).toBe('27/10/2026');
  });
});