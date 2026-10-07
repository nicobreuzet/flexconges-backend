// Réglages de sécurité d'un cabinet (colonne Company.securityConfig, JSON).
// Le SERVEUR est la seule autorité : valeurs par défaut ici, validation ici, application dans
// middlewares/auth.js. Le front affiche et envoie, il ne décide de rien.
const ALLOWED_INACTIVITY_HOURS = [1, 4, 8, 24];
const DEFAULT_SECURITY = { sessionInactivityHours: 8 };

// Renvoie la configuration EFFECTIVE : valeurs stockées si elles sont valides, sinon valeurs par défaut.
function getSecurityConfig(stored) {
  const s = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {};
  return {
    sessionInactivityHours: ALLOWED_INACTIVITY_HOURS.includes(s.sessionInactivityHours)
      ? s.sessionInactivityHours
      : DEFAULT_SECURITY.sessionInactivityHours
  };
}

// Valide une modification demandée par le client. Renvoie { error } ou { value } (le fragment à fusionner).
function validateSecurityPatch(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: 'securityConfig doit être un objet' };
  }
  const value = {};
  for (const key of Object.keys(input)) {
    if (key === 'sessionInactivityHours') {
      if (!ALLOWED_INACTIVITY_HOURS.includes(input[key])) {
        return { error: `sessionInactivityHours doit valoir ${ALLOWED_INACTIVITY_HOURS.join(', ')} (heures)` };
      }
      value[key] = input[key];
    } else {
      return { error: `Réglage de sécurité inconnu : ${key}` };
    }
  }
  return { value };
}

module.exports = { ALLOWED_INACTIVITY_HOURS, DEFAULT_SECURITY, getSecurityConfig, validateSecurityPatch };
