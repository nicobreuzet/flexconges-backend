const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const prisma = require('../config/prisma');
const { createDefaultLeaveTypes } = require('../utils/defaultLeaveTypes');
const { sendMail } = require('../config/mailer');
const { logAudit } = require('../utils/audit');
const { createSession, revokeUserSessions } = require('../utils/sessions');
const router = express.Router();

authenticator.options = { window: 1 };

// Inscription d'une NOUVELLE société : crée la société + son premier manager
router.post('/register', async (req, res) => {
  try {
    const { companyName, email, password, firstName, lastName } = req.body;

    if (!companyName || !email || !password || !firstName || !lastName) {
      return res.status(400).json({
        error: 'Société, e-mail, mot de passe, prénom et nom sont obligatoires'
      });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const year = new Date().getFullYear();

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: companyName } });

      await createDefaultLeaveTypes(tx, company.id);

      const user = await tx.user.create({
        data: {
          email, password: hashedPassword, firstName, lastName,
          role: 'manager', companyId: company.id
        }
      });

      const types = await tx.leaveType.findMany({
        where: { companyId: company.id, code: { in: ['CP', 'RTT'] } }
      });
      for (const t of types) {
        await tx.leaveBalance.create({
          data: {
            userId: user.id, leaveTypeId: t.id, year,
            companyId: company.id, allocated: t.annualCap ?? 0
          }
        });
      }

      return { company, user };
    });

    const { password: _, ...userWithoutPassword } = result.user;
    await logAudit(req, { companyId: result.company.id, userId: result.user.id, action: 'company.registered', details: { societe: result.company.name } });
    res.status(201).json({ company: result.company, user: userWithoutPassword });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'login.failed', details: { raison: 'mot de passe incorrect' } });
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    // Compte désactivé : refusé APRÈS le contrôle du mot de passe (on ne révèle pas
    // l'état d'un compte à quelqu'un qui n'a pas le bon mot de passe).
    if (!user.isActive) {
      await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'login.failed', details: { raison: 'compte désactivé' } });
      return res.status(403).json({ error: 'Compte désactivé. Contactez votre administrateur.' });
    }
    if (user.twoFactorEnabled) {
      // Mot de passe correct, mais il manque le code 2FA : on ne renvoie PAS le vrai
      // jeton. Ce jeton temporaire n'a pas de companyId, donc toutes les routes
      // protégées le refusent automatiquement (voir middlewares/auth.js).
      const pendingToken = jwt.sign(
        { userId: user.id, pending2FA: true },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ requiresTwoFactor: true, pendingToken });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role, companyId: user.companyId, sid: await createSession(req, user) },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'login.success', details: { deuxFacteurs: false } });
    res.json({ token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const MAX_2FA_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Deuxième étape de connexion quand le 2FA est actif : code TOTP ou code de récupération.
// Après 5 codes faux d'affilée, le compte est verrouillé 15 minutes pour cette étape.
router.post('/login/verify-2fa', async (req, res) => {
  try {
    const { pendingToken, code } = req.body;
    if (!pendingToken || !code) {
      return res.status(400).json({ error: 'Jeton temporaire et code obligatoires' });
    }

    let decoded;
    try {
      decoded = jwt.verify(pendingToken, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Session de connexion expirée, recommencez' });
    }
    if (!decoded.pending2FA) {
      return res.status(401).json({ error: 'Jeton invalide' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.isActive || !user.twoFactorEnabled) {
      return res.status(401).json({ error: 'Session de connexion invalide' });
    }

    // Verrouillage en cours ? On refuse AVANT de tester le moindre code.
    if (user.twoFactorLockedUntil && user.twoFactorLockedUntil > new Date()) {
      const minutes = Math.ceil((user.twoFactorLockedUntil - new Date()) / 60000);
      return res.status(429).json({ error: `Trop d'essais. Réessayez dans ${minutes} minute(s).` });
    }

    const cleanCode = String(code).replace(/\s/g, '');
    let ok = authenticator.check(cleanCode, user.twoFactorSecret);
    let methode = ok ? 'application' : null;

    // Si ce n'est pas un code TOTP valide, on tente un code de récupération non utilisé
    if (!ok) {
      const normalizedCode = cleanCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const unusedCodes = await prisma.recoveryCode.findMany({
        where: { userId: user.id, used: false }
      });
      for (const rc of unusedCodes) {
        if (await bcrypt.compare(normalizedCode, rc.codeHash)) {
          // updateMany avec "used: false" : si deux requêtes arrivent en même temps
          // avec le même code, une seule peut le consommer (count === 1).
          const claimed = await prisma.recoveryCode.updateMany({
            where: { id: rc.id, used: false },
            data: { used: true, usedAt: new Date() }
          });
          if (claimed.count === 1) { ok = true; methode = 'code de récupération'; }          break;
        }
      }
    }

    if (!ok) {
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorFailedAttempts: { increment: 1 } }
      });
      if (updated.twoFactorFailedAttempts >= MAX_2FA_ATTEMPTS) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            twoFactorFailedAttempts: 0,
            twoFactorLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
          }
        });
        await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'twofactor.locked', details: { minutes: LOCK_MINUTES } });
        return res.status(429).json({ error: `Trop d'essais. Réessayez dans ${LOCK_MINUTES} minutes.` });
      }
      await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'twofactor.login_failed', details: { tentative: updated.twoFactorFailedAttempts } });
      return res.status(401).json({ error: 'Code invalide' });
    }
    // Succès : on remet les compteurs à zéro
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorFailedAttempts: 0, twoFactorLockedUntil: null }
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role, companyId: user.companyId, sid: await createSession(req, user) },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'login.success', details: { deuxFacteurs: true, methode } });
    res.json({ token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Demande de réinitialisation : envoie un lien à usage unique, valable 15 minutes
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obligatoire' });

    const genericResponse = { message: 'Si cet e-mail existe, un lien de réinitialisation a été envoyé.' };

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json(genericResponse);

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpires: expires }
    });
    await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'password.reset_requested' });

    if (process.env.FRONT_URL) {
      console.log(`Lien de réinitialisation pour ${email} : ${process.env.FRONT_URL}?resetToken=${token} (valable 15 min)`);
    } else {
      console.log(`Jeton de réinitialisation pour ${email} : ${token} (valable 15 min, FRONT_URL non défini)`);
    }

    sendMail(
      email,
      'Réinitialisation de votre mot de passe FlexCongés',
      `Voici votre lien de réinitialisation (valable 15 minutes) :\n\n${process.env.FRONT_URL || '(URL non configurée)'}?resetToken=${token}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`
    ).catch(err => console.error('Erreur envoi email:', err));

    res.json(genericResponse);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Finalise la réinitialisation : vérifie le jeton, puis change le mot de passe
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Jeton et mot de passe obligatoires' });

    if (password.length < 12 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 12 caractères, une majuscule, un chiffre et un caractère spécial'
      });
    }

    const user = await prisma.user.findUnique({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
      return res.status(400).json({ error: 'Lien invalide ou expiré' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, resetToken: null, resetTokenExpires: null }
    });
    await revokeUserSessions(user.id);
    await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'password.reset' });
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;