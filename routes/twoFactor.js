const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const prisma = require('../config/prisma');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

authenticator.options = { window: 1 }; // tolère 30s d'avance/retard d'horloge

const RECOVERY_CODE_COUNT = 8;

// Génère des codes de récupération bruts (8 caractères hexadécimaux, sans séparateur)
function generateRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
}

// Ajoute un tiret au milieu, uniquement pour l'affichage (ex: A1B2C3D4 -> A1B2-C3D4)
function formatRecoveryCode(code) {
  return code.slice(0, 4) + '-' + code.slice(4);
}

// Démarre (ou redémarre) l'activation du 2FA : génère un secret, PAS ENCORE actif
// Démarre l'activation du 2FA : génère un secret, PAS ENCORE actif.
// Refusé si le 2FA est déjà actif : sinon un simple jeton de session volé
// suffirait à le désactiver sans mot de passe (on doit passer par /2fa/disable).
router.post('/2fa/setup', authenticate, async (req, res) => {
  try {
    const current = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (current.twoFactorEnabled) {
      return res.status(409).json({
        error: 'Le 2FA est déjà activé. Désactivez-le d\'abord (mot de passe requis) pour le reconfigurer.'
      });
    }

    const secret = authenticator.generateSecret();
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { twoFactorSecret: secret, twoFactorEnabled: false }
    });
    const formatted = secret.match(/.{1,4}/g).join(' ');
    res.json({ secret: formatted });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Confirme l'activation avec un premier code, puis active réellement le 2FA
router.post('/2fa/verify-setup', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code obligatoire' });

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user.twoFactorSecret) {
      return res.status(400).json({ error: 'Aucune activation en cours. Relancez la configuration.' });
    }

    const isValid = authenticator.check(code.replace(/\s/g, ''), user.twoFactorSecret);
    if (!isValid) return res.status(400).json({ error: 'Code incorrect' });

    const recoveryCodes = generateRecoveryCodes();
    const hashedCodes = await Promise.all(recoveryCodes.map(c => bcrypt.hash(c, 10)));

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: true }
      }),
      prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.recoveryCode.createMany({
        data: hashedCodes.map(codeHash => ({ userId: user.id, codeHash }))
      })
    ]);

    res.json({ success: true, recoveryCodes: recoveryCodes.map(formatRecoveryCode) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Désactive le 2FA (redemande le mot de passe par sécurité)
router.post('/2fa/disable', authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Mot de passe obligatoire' });

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: 'Mot de passe incorrect' });

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: false, twoFactorSecret: null }
      }),
      prisma.recoveryCode.deleteMany({ where: { userId: user.id } })
    ]);

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// État actuel du 2FA pour l'utilisateur connecté (pour affichage dans Sécurité)
router.get('/2fa/status', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  res.json({ enabled: user.twoFactorEnabled });
});

module.exports = router;