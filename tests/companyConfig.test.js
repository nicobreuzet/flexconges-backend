const {
  DEFAULT_BRANDING, DEFAULT_ROLES, DEFAULT_RULES,
  getBrandingConfig, getRoleConfig, getRulesConfig,
  validateBrandingPatch, validateRolePatch, validateRulesPatch,
  mergeRoleConfig,
} = require('../utils/companyConfig');

describe('companyConfig : identité visuelle', () => {
  test('sans réglage enregistré, renvoie les valeurs par défaut', () => {
    expect(getBrandingConfig(null)).toEqual(DEFAULT_BRANDING);
    expect(getBrandingConfig(undefined)).toEqual(DEFAULT_BRANDING);
    expect(getBrandingConfig([])).toEqual(DEFAULT_BRANDING);
  });

  test('garde les valeurs valides et remplace les invalides par le défaut', () => {
    const r = getBrandingConfig({ name: 'Cabinet Martin', primaryColor: 'rouge', teamLabel: 42 });
    expect(r.name).toBe('Cabinet Martin');
    expect(r.primaryColor).toBe(DEFAULT_BRANDING.primaryColor);
    expect(r.teamLabel).toBe(DEFAULT_BRANDING.teamLabel);
  });

  test('accepte un patch valide, retire les espaces et met les couleurs en minuscules', () => {
    const r = validateBrandingPatch({ name: '  Cabinet Martin  ', primaryColor: '#0D1B2A' });
    expect(r.error).toBeUndefined();
    expect(r.value).toEqual({ name: 'Cabinet Martin', primaryColor: '#0d1b2a' });
  });

  test('accepte un sous-titre et un message de bienvenue vides (le front peut les envoyer vides)', () => {
    const r = validateBrandingPatch({ sidebarSubtitle: '', welcomeMsg: '' });
    expect(r.value).toEqual({ sidebarSubtitle: '', welcomeMsg: '' });
  });

  test('refuse les valeurs invalides', () => {
    const mauvais = [
      { name: '' }, { name: 'x'.repeat(81) }, { name: 5 }, { name: 'a\nb' },
      { teamLabel: '' }, { primaryColor: 'red' }, { accentColor: '#12345' },
      { primaryColor: 'red; background:url(x)' }, { welcomeMsg: 'x'.repeat(201) },
    ];
    for (const patch of mauvais) {
      expect(validateBrandingPatch(patch).error).toBeDefined();
    }
  });

  test('refuse une clé inconnue, une clé héritée et tout ce qui n\'est pas un objet', () => {
    expect(validateBrandingPatch({ logo: 'x' }).error).toBeDefined();
    expect(validateBrandingPatch({ constructor: 'x' }).error).toBeDefined();
    expect(validateBrandingPatch(JSON.parse('{"__proto__": "x"}')).error).toBeDefined();
    for (const v of [null, [], 'abc', 12, undefined]) {
      expect(validateBrandingPatch(v).error).toBeDefined();
    }
  });
});

describe('companyConfig : rôles', () => {
  test('renvoie les libellés par défaut et des permissions fixées par le serveur', () => {
    const r = getRoleConfig(null);
    expect(r.manager.singular).toBe('Manager');
    expect(r.employee.singular).toBe('Employé');
    expect(r.manager.permissions).toEqual({
      canApprove: true, canManageUsers: true, canSeeReports: true, canAdmin: true, canManageBilling: true,
    });
    expect(Object.values(r.employee.permissions).every((v) => v === false)).toBe(true);
  });

  test('ignore les permissions enregistrées en base (anciennes sauvegardes du front)', () => {
    const stored = { employee: { singular: 'Collaborateur', permissions: { canApprove: true, canAdmin: true } } };
    const r = getRoleConfig(stored);
    expect(r.employee.singular).toBe('Collaborateur');
    expect(r.employee.permissions.canApprove).toBe(false);
    expect(r.employee.permissions.canAdmin).toBe(false);
  });

  test('accepte ce que le front envoie, mais ignore badgeClass et permissions', () => {
    const r = validateRolePatch({
      manager: {
        singular: 'Associé', plural: 'Associés', feminine: 'Associée', icon: '⚖️', color: '#DC2626',
        badgeClass: 'role-manager', permissions: { canAdmin: false },
      },
      employee: { singular: 'Avocat', color: '#2d7a4f', permissions: { canApprove: true } },
    });
    expect(r.error).toBeUndefined();
    expect(r.value.manager).toEqual({
      singular: 'Associé', plural: 'Associés', feminine: 'Associée', icon: '⚖️', color: '#dc2626',
    });
    expect(r.value.employee).toEqual({ singular: 'Avocat', color: '#2d7a4f' });
  });

  test('refuse un rôle inconnu, un champ inconnu, une couleur invalide ou un libellé vide', () => {
    expect(validateRolePatch({ admin: { singular: 'X' } }).error).toBeDefined();
    expect(validateRolePatch({ manager: { superpower: 'x' } }).error).toBeDefined();
    expect(validateRolePatch({ manager: { color: 'red' } }).error).toBeDefined();
    expect(validateRolePatch({ employee: { singular: '' } }).error).toBeDefined();
    expect(validateRolePatch({ manager: 'x' }).error).toBeDefined();
    expect(validateRolePatch(null).error).toBeDefined();
  });

  test('mergeRoleConfig ne modifie que ce qui est envoyé et ne stocke jamais les permissions', () => {
    const stored = { manager: { singular: 'Associé' } };
    const merged = mergeRoleConfig(stored, { employee: { singular: 'Avocat' } });
    expect(merged.manager.singular).toBe('Associé');
    expect(merged.manager.plural).toBe(DEFAULT_ROLES.manager.plural);
    expect(merged.employee.singular).toBe('Avocat');
    expect(merged.manager.permissions).toBeUndefined();
    expect(merged.employee.permissions).toBeUndefined();
  });
});

describe('companyConfig : règles', () => {
  test('valeurs par défaut, valeurs valides conservées, second niveau stocké ramené à 1', () => {
    expect(getRulesConfig(null)).toEqual(DEFAULT_RULES);
    const r = getRulesConfig({ noticeDays: 7, maxSimultaneousAbsences: 0, workflowLevels: 2 });
    expect(r.noticeDays).toBe(7);
    expect(r.maxSimultaneousAbsences).toBe(0);
    expect(r.workflowLevels).toBe(1);
    expect(r.carryOverDate).toBe(DEFAULT_RULES.carryOverDate);
  });

  test('accepte 0 (= aucune règle) et des valeurs valides', () => {
    const r = validateRulesPatch({ noticeDays: 0, maxSimultaneousAbsences: 0, carryOverDate: '', workflowLevels: 1 });
    expect(r.value).toEqual({ noticeDays: 0, maxSimultaneousAbsences: 0, carryOverDate: '', workflowLevels: 1 });
    expect(validateRulesPatch({ noticeDays: 30, maxSimultaneousAbsences: 5 }).value)
      .toEqual({ noticeDays: 30, maxSimultaneousAbsences: 5 });
  });

  test('refuse les valeurs invalides, dont le second niveau pas encore disponible', () => {
    const mauvais = [
      { noticeDays: -1 }, { noticeDays: 366 }, { noticeDays: '14' }, { noticeDays: 1.5 }, { noticeDays: null },
      { maxSimultaneousAbsences: 1000 }, { maxSimultaneousAbsences: 'deux' },
      { carryOverDate: 'x'.repeat(41) }, { carryOverDate: 20 },
      { workflowLevels: 2 }, { workflowLevels: 0 }, { workflowLevels: '1' },
      { delaiMagique: 3 },
    ];
    for (const patch of mauvais) {
      expect(validateRulesPatch(patch).error).toBeDefined();
    }
  });

  test('refuse tout ce qui n\'est pas un objet', () => {
    for (const v of [null, [], 'abc', 12, undefined]) {
      expect(validateRulesPatch(v).error).toBeDefined();
    }
  });
});