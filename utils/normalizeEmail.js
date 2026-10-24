// Normalisation des adresses e-mail : source unique, appelee par toutes les routes
// qui recoivent une adresse (inscription, connexion, mot de passe oublie,
// creation et modification d'utilisateur).

const MAX_LENGTH = 254;
const FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Renvoie l'adresse normalisee (sans espaces autour, accents unifies, en minuscules)
// ou null si la valeur n'est pas une adresse valide. La partie "+etiquette" est gardee.
function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().normalize('NFC').toLowerCase();
  if (email.length > MAX_LENGTH) return null;
  if (!FORMAT.test(email)) return null;
  return email;
}

module.exports = { normalizeEmail };