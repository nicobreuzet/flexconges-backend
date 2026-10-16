const crypto = require('crypto');

// Format stocké en base : "v1:" + iv + ":" + tag + ":" + données chiffrées (tout en base64).
// "v1" permet de changer de méthode ou de clé plus tard sans casser les anciennes données.
const PREFIX = 'v1:';
const ALGO = 'aes-256-gcm'; // chiffre ET détecte toute modification des données

// Lit la clé (variable d'environnement : 32 octets encodés en base64, soit 44 caractères).
// Pas de clé = erreur claire : on ne stocke jamais un secret en clair "faute de clé".
function getKey() {
  const raw = process.env.TWO_FACTOR_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TWO_FACTOR_ENCRYPTION_KEY manquante : impossible de chiffrer ou déchiffrer les secrets 2FA');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('TWO_FACTOR_ENCRYPTION_KEY invalide : 32 octets encodés en base64 attendus');
  }
  return key;
}

// Vérifie que la clé est présente et valide (pour un contrôle au démarrage du serveur)
function assertKeyConfigured() {
  getKey();
  return true;
}

function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

// Chiffre un secret. Un nouvel iv aléatoire à chaque appel : deux chiffrements
// du même secret donnent deux résultats différents.
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, data].map((b) => b.toString('base64')).join(':');
}

// Déchiffre un secret. Un secret à l'ancien format (en clair, sans préfixe "v1:") est
// rendu tel quel : c'est ce qui permet à la production de continuer à fonctionner
// pendant la conversion des secrets existants.
function decryptSecret(stored) {
  if (!isEncrypted(stored)) return stored;
  try {
    const parts = stored.slice(PREFIX.length).split(':');
    if (parts.length !== 3) throw new Error('format');
    const [iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (error) {
    // Ne jamais inclure le contenu du secret dans le message
    throw new Error('Secret 2FA chiffré illisible (clé incorrecte ou donnée altérée)');
  }
}

module.exports = { encryptSecret, decryptSecret, isEncrypted, assertKeyConfigured };