// SIRET : 14 chiffres. Source unique, appelee par /register et par PATCH /company.
const FORMAT = /^[0-9]{14}$/;

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

// Renvoie les 14 chiffres (espaces retires, espaces insecables compris) ou null si la valeur
// n'est pas un SIRET valide. Un nombre est refuse : il perdrait un eventuel zero initial.
function normalizeSiret(value) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/\s+/g, '');
  return FORMAT.test(s) ? s : null;
}

// Pour une route : { value: null } si la valeur est absente ou vide (le SIRET est facultatif),
// { value } si elle est valide, { error } sinon.
function parseSiret(value) {
  if (isBlank(value)) return { value: null };
  const s = normalizeSiret(value);
  if (s === null) return { error: 'SIRET invalide : 14 chiffres attendus.' };
  return { value: s };
}

module.exports = { normalizeSiret, parseSiret };
