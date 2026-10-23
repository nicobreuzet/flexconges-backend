// Regle unique de mot de passe, appliquee par le serveur a chaque definition
// d'un mot de passe choisi par une personne (inscription, reinitialisation).
// Renvoie null si le mot de passe est accepte, sinon une phrase d'erreur.

const MIN_LENGTH = 12;
const MAX_BYTES = 72; // bcrypt ignore silencieusement tout ce qui depasse 72 octets
const MIN_EMAIL_LOCAL_LENGTH = 4;

function validatePassword(password, options) {
  if (typeof password !== 'string') {
    return 'Mot de passe invalide.';
  }

  if (Array.from(password).length < MIN_LENGTH) {
    return 'Le mot de passe doit contenir au moins ' + MIN_LENGTH + ' caract\u00e8res.';
  }

  if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) {
    return 'Le mot de passe est trop long (' + MAX_BYTES + ' octets maximum).';
  }

  if (!/\p{Lu}/u.test(password)) {
    return 'Le mot de passe doit contenir au moins une majuscule.';
  }

  if (!/[0-9]/.test(password)) {
    return 'Le mot de passe doit contenir au moins un chiffre.';
  }

  if (!/[^\p{L}\p{N}]/u.test(password)) {
    return 'Le mot de passe doit contenir au moins un caract\u00e8re sp\u00e9cial (symbole ou espace).';
  }

  const email = options && typeof options.email === 'string' ? options.email.toLowerCase() : '';
  if (email) {
    const lower = password.toLowerCase();
    const local = email.split('@')[0];
    if (lower.includes(email) || (local.length >= MIN_EMAIL_LOCAL_LENGTH && lower.includes(local))) {
      return 'Le mot de passe ne doit pas contenir votre adresse e-mail.';
    }
  }

  return null;
}

module.exports = { validatePassword, MIN_LENGTH, MAX_BYTES };