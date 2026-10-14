const { authenticator } = require('otplib');

authenticator.options = { window: 1 };

// Code TOTP du créneau courant + décalage (en créneaux de 30 s).
// Le serveur accepte les décalages -1, 0 et +1.
function codeAtStep(secret, offset = 0) {
  return authenticator.clone({ epoch: Date.now() + offset * 30000 }).generate(secret);
}

module.exports = { codeAtStep };