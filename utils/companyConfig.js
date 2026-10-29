// Réglages d'un cabinet : identité visuelle (Company.brandingConfig), libellés des rôles
// (Company.roleConfig) et règles (Company.rulesConfig), trois colonnes JSON.
// Le SERVEUR est la seule autorité : valeurs par défaut, validation et fusion sont ici.
// Même principe que utils/securityConfig.js. Le front affiche et envoie, il ne décide de rien.

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const ROLE_KEYS = ['manager', 'employee'];
const ROLE_LABELS_FR = { manager: 'manager', employee: 'employ\u00e9' };

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
  name: { check: (v) => cleanText(v, 1, 80), msg: 'Le nom de l\u2019organisation doit \u00eatre un texte de 1 \u00e0 80 caract\u00e8res.' },
  sidebarSubtitle: { check: (v) => cleanText(v, 0, 80), msg: 'Le sous-titre doit contenir 80 caract\u00e8res au plus.' },
  welcomeMsg: { check: (v) => cleanText(v, 0, 200), msg: 'Le message d\u2019accueil doit contenir 200 caract\u00e8res au plus.' },
  teamLabel: { check: (v) => cleanText(v, 1, 40), msg: 'Le libell\u00e9 d\u2019\u00e9quipe doit \u00eatre un texte de 1 \u00e0 40 caract\u00e8res.' },
  primaryColor: { check: cleanColor, msg: 'La couleur principale doit \u00eatre au format #rrggbb.' },
  accentColor: { check: cleanColor, msg: 'La couleur d\u2019accent doit \u00eatre au format #rrggbb.' },
};

function getBrandingConfig(stored, companyName) {
  // Tant que le cabinet n'a rien enregistre, son identite porte le NOM DE LA SOCIETE (et non le nom
  // de demonstration). Un nom enregistre par le cabinet l'emporte toujours. Le nom de repli est borne a
  // 80 caracteres (sans couper un caractere en deux) et refuse s'il contient un caractere de controle.
  let repli = null;
  if (typeof companyName === 'string') {
    let t = '';
    for (const ch of companyName.trim()) {
      if (t.length + ch.length > 80) break;
      t += ch;
    }
    repli = cleanText(t, 1, 80);
  }
  const defaults = repli !== null ? { ...DEFAULT_BRANDING, name: repli } : DEFAULT_BRANDING;
  return effective(defaults, BRANDING_FIELDS, stored);
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
  singular: { check: (v) => cleanText(v, 1, 40), msg: 'le libell\u00e9 au singulier doit \u00eatre un texte de 1 \u00e0 40 caract\u00e8res.' },
  plural: { check: (v) => cleanText(v, 1, 40), msg: 'le libell\u00e9 au pluriel doit \u00eatre un texte de 1 \u00e0 40 caract\u00e8res.' },
  feminine: { check: (v) => cleanText(v, 1, 40), msg: 'le libell\u00e9 au f\u00e9minin doit \u00eatre un texte de 1 \u00e0 40 caract\u00e8res.' },
  icon: { check: (v) => cleanText(v, 1, 16), msg: 'l\u2019ic\u00f4ne doit \u00eatre un texte de 1 \u00e0 16 caract\u00e8res.' },
  color: { check: cleanColor, msg: 'la couleur doit \u00eatre au format #rrggbb.' },
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
    const res = validatePatch(raw, ROLE_FIELDS, `roleConfig.${role}`, `Réglage de rôle inconnu (${role})`, `R\u00f4le ${ROLE_LABELS_FR[role]} : `);
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
  noticeDays: { check: (v) => cleanInt(v, 0, 365), msg: 'Le pr\u00e9avis doit \u00eatre un nombre entier de jours, de 0 \u00e0 365 (0 = aucun pr\u00e9avis).' },
  maxSimultaneousAbsences: { check: (v) => cleanInt(v, 0, 999), msg: 'Le nombre maximum d\u2019absents simultan\u00e9s doit \u00eatre un nombre entier de 0 \u00e0 999 (0 = pas de limite).' },
  carryOverDate: { check: (v) => cleanText(v, 0, 40), msg: 'La date de report des cong\u00e9s doit contenir 40 caract\u00e8res au plus.' },
  workflowLevels: { check: (v) => (v === 1 ? 1 : null), msg: 'Le second niveau de validation n\u2019est pas encore disponible : seul le niveau 1 est possible.' },
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