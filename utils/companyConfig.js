// Réglages d'un cabinet : identité visuelle (Company.brandingConfig), libellés des rôles
// (Company.roleConfig) et règles (Company.rulesConfig), trois colonnes JSON.
// Le SERVEUR est la seule autorité : valeurs par défaut, validation et fusion sont ici.
// Même principe que utils/securityConfig.js. Le front affiche et envoie, il ne décide de rien.

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const ROLE_KEYS = ['manager', 'employee'];

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Chaque fonction renvoie la valeur nettoyée si elle est valide, sinon null.
function cleanText(v, min, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length < min || t.length > max) return null;
  if (CONTROL_CHARS.test(t)) return null;
  return t;
}
function cleanColor(v) {
  return typeof v === 'string' && HEX_COLOR.test(v) ? v.toLowerCase() : null;
}
function cleanInt(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max ? v : null;
}

// Configuration EFFECTIVE : valeur stockée si elle est valide, sinon valeur par défaut.
function effective(defaults, fields, stored) {
  const s = isPlainObject(stored) ? stored : {};
  const out = {};
  for (const key of Object.keys(fields)) {
    const ok = fields[key].check(s[key]);
    out[key] = ok !== null ? ok : defaults[key];
  }
  return out;
}

// Valide une modification demandée par le client. Renvoie { error } ou { value } (le fragment à fusionner).
function validatePatch(input, fields, objectName, unknownLabel, prefix = '') {
  if (!isPlainObject(input)) return { error: `${objectName} doit être un objet` };
  const value = {};
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      return { error: `${unknownLabel} : ${key}` };
    }
    const clean = fields[key].check(input[key]);
    if (clean === null) return { error: `${prefix}${fields[key].msg}` };
    value[key] = clean;
  }
  return { value };
}

// ───────────── Identité visuelle ─────────────
const DEFAULT_BRANDING = {
  name: 'FlexCongés Démo',
  sidebarSubtitle: 'Gestion des Absences',
  welcomeMsg: 'Bienvenue sur FlexCongés',
  teamLabel: 'Équipe',
  primaryColor: '#0d1b2a',
  accentColor: '#c9a84c',
};

const BRANDING_FIELDS = {
  name: { check: (v) => cleanText(v, 1, 80), msg: 'name doit être un texte de 1 à 80 caractères' },
  sidebarSubtitle: { check: (v) => cleanText(v, 0, 80), msg: 'sidebarSubtitle doit être un texte de 80 caractères au plus' },
  welcomeMsg: { check: (v) => cleanText(v, 0, 200), msg: 'welcomeMsg doit être un texte de 200 caractères au plus' },
  teamLabel: { check: (v) => cleanText(v, 1, 40), msg: 'teamLabel doit être un texte de 1 à 40 caractères' },
  primaryColor: { check: cleanColor, msg: 'primaryColor doit être une couleur au format #rrggbb' },
  accentColor: { check: cleanColor, msg: 'accentColor doit être une couleur au format #rrggbb' },
};

function getBrandingConfig(stored) {
  return effective(DEFAULT_BRANDING, BRANDING_FIELDS, stored);
}
function validateBrandingPatch(input) {
  return validatePatch(input, BRANDING_FIELDS, 'brandingConfig', 'Réglage d\'identité inconnu');
}

// ───────────── Rôles ─────────────
// Les PERMISSIONS sont fixées par le serveur (les droits réels viennent du rôle en base,
// via requireManager). Ce que le client envoie à ce sujet est ignoré ; seul l'aspect
// (libellés, icône, couleur) est personnalisable.
const FIXED_PERMISSIONS = {
  manager: { canApprove: true, canManageUsers: true, canSeeReports: true, canAdmin: true, canManageBilling: true },
  employee: { canApprove: false, canManageUsers: false, canSeeReports: false, canAdmin: false, canManageBilling: false },
};

const DEFAULT_ROLES = {
  manager: { singular: 'Manager', plural: 'Managers', feminine: 'Manager', icon: '👔', color: '#dc2626' },
  employee: { singular: 'Employé', plural: 'Employés', feminine: 'Employée', icon: '👤', color: '#2d7a4f' },
};

const ROLE_FIELDS = {
  singular: { check: (v) => cleanText(v, 1, 40), msg: 'singular doit être un texte de 1 à 40 caractères' },
  plural: { check: (v) => cleanText(v, 1, 40), msg: 'plural doit être un texte de 1 à 40 caractères' },
  feminine: { check: (v) => cleanText(v, 1, 40), msg: 'feminine doit être un texte de 1 à 40 caractères' },
  icon: { check: (v) => cleanText(v, 1, 16), msg: 'icon doit être un texte de 1 à 16 caractères' },
  color: { check: cleanColor, msg: 'color doit être une couleur au format #rrggbb' },
};

// Envoyés par le front mais jamais pris en compte (ni refusés, pour ne pas casser l'enregistrement).
const ROLE_IGNORED_KEYS = ['badgeClass', 'permissions'];

function getRoleConfig(stored) {
  const s = isPlainObject(stored) ? stored : {};
  const out = {};
  for (const role of ROLE_KEYS) {
    out[role] = {
      ...effective(DEFAULT_ROLES[role], ROLE_FIELDS, s[role]),
      permissions: { ...FIXED_PERMISSIONS[role] },
    };
  }
  return out;
}

function validateRolePatch(input) {
  if (!isPlainObject(input)) return { error: 'roleConfig doit être un objet' };
  const value = {};
  for (const role of Object.keys(input)) {
    if (!ROLE_KEYS.includes(role)) return { error: `Rôle inconnu : ${role}` };
    let raw = input[role];
    if (isPlainObject(raw)) {
      raw = { ...raw };
      for (const k of ROLE_IGNORED_KEYS) delete raw[k];
    }
    const res = validatePatch(raw, ROLE_FIELDS, `roleConfig.${role}`, `Réglage de rôle inconnu (${role})`, `${role} : `);
    if (res.error) return res;
    value[role] = res.value;
  }
  return { value };
}

// Fusionne un fragment validé avec l'existant, rôle par rôle. Ne stocke JAMAIS les permissions.
function mergeRoleConfig(stored, fragment) {
  const before = getRoleConfig(stored);
  const merged = {};
  for (const role of ROLE_KEYS) {
    const { permissions, ...cosmetic } = before[role];
    merged[role] = { ...cosmetic, ...(fragment[role] || {}) };
  }
  return merged;
}

// ───────────── Règles ─────────────
// 0 = pas de règle (préavis 0 = aucun préavis ; absents max 0 = illimité).
// carryOverDate est INFORMATIF : rien ne l'applique encore.
// workflowLevels : seul le niveau 1 est disponible pour l'instant (le second niveau viendra à part).
const DEFAULT_RULES = {
  noticeDays: 14,
  maxSimultaneousAbsences: 2,
  carryOverDate: '31 mai N+1',
  workflowLevels: 1,
};

const RULES_FIELDS = {
  noticeDays: { check: (v) => cleanInt(v, 0, 365), msg: 'noticeDays doit être un nombre entier de 0 à 365 (0 = aucun préavis)' },
  maxSimultaneousAbsences: { check: (v) => cleanInt(v, 0, 999), msg: 'maxSimultaneousAbsences doit être un nombre entier de 0 à 999 (0 = pas de limite)' },
  carryOverDate: { check: (v) => cleanText(v, 0, 40), msg: 'carryOverDate doit être un texte de 40 caractères au plus' },
  workflowLevels: { check: (v) => (v === 1 ? 1 : null), msg: 'Le second niveau de validation n\'est pas encore disponible : workflowLevels doit valoir 1' },
};

function getRulesConfig(stored) {
  return effective(DEFAULT_RULES, RULES_FIELDS, stored);
}
function validateRulesPatch(input) {
  return validatePatch(input, RULES_FIELDS, 'rulesConfig', 'Règle inconnue');
}

module.exports = {
  DEFAULT_BRANDING, DEFAULT_ROLES, DEFAULT_RULES,
  getBrandingConfig, getRoleConfig, getRulesConfig,
  validateBrandingPatch, validateRolePatch, validateRulesPatch,
  mergeRoleConfig,
};