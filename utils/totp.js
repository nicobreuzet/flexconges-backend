const { authenticator } = require('otplib');
const prisma = require('../config/prisma');

authenticator.options = { window: 1 }; // tolère 30 s d'avance/retard d'horloge

const STEP_MS = 30 * 1000;

// Vérifie un code TOTP ET refuse un code déjà utilisé (anti-rejeu).
//
// Un code reste valable ~90 s (créneau courant ± 1). Sans mémoire, quelqu'un qui l'a vu
// passer pourrait le réutiliser. On retient donc le dernier créneau accepté pour cet
// utilisateur : un code n'est valable que si son créneau est STRICTEMENT plus récent.
//
// `user` doit contenir au minimum : id, twoFactorSecret.
// L'écriture est atomique (updateMany avec condition) : si deux requêtes arrivent en même
// temps avec le même code, une seule peut le consommer (count === 1).
async function verifyTotp(user, code) {
  if (!user || !user.twoFactorSecret) return false;

  const cleanCode = String(code).replace(/\s/g, '');
  const delta = authenticator.checkDelta(cleanCode, user.twoFactorSecret);
  if (delta === null) return false; // code faux ou hors fenêtre

  const step = Math.floor(Date.now() / STEP_MS) + delta;
  const claimed = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }]
    },
    data: { twoFactorLastStep: step }
  });
  return claimed.count === 1;
}

module.exports = { verifyTotp };