const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { verifyTotp } = require('../utils/totp');
const prisma = require('../config/prisma');
const { createDefaultLeaveTypes } = require('../utils/defaultLeaveTypes');
const { sendMail } = require('../config/mailer');
const { logAudit } = require('../utils/audit');
const { createSession, revokeUserSessions } = require('../utils/sessions');
const { sendError } = require('../utils/httpErrors');
const { reserveIpAttempt, clearIpAttempts } = require('../utils/twoFactorAttempts');
const { sendLockAlert } = require('../utils/twoFactorLockAlert');
const { validatePassword } = require('../utils/passwordPolicy');
const { normalizeEmail } = require('../utils/normalizeEmail');
const { hashInvitationToken } = require('../utils/invitations');
const router = express.Router();

// Faux hash (meme cout que les vrais : 10 tours) : sert a faire le meme travail pour un e-mail
// inconnu, afin qu'on ne puisse pas deviner quels comptes existent en mesurant le temps de reponse.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('mot-de-passe-factice-pour-egaliser-le-temps', 10);

// Inscription d'une NOUVELLE société : crée la société + son premier manager
router.post('/register', async (req, res) => {

  // Porte d'inscription : fermée par défaut, ouverte seulement si REGISTRATION_OPEN vaut "true".
  // La variable est lue à chaque requête : on peut l'ouvrir ou la refermer sans toucher au code.
  if (process.env.REGISTRATION_OPEN !== 'true') {
    return res.status(403).json({ error: 'Les inscriptions sont fermées pour le moment.' });
  }
  try {
    const { companyName, email: rawEmail, password, firstName, lastName, invitationToken } = req.body;

    if (!companyName || !rawEmail || !password || !firstName || !lastName) {
      return res.status(400).json({
        error: 'Société, e-mail, mot de passe, prénom et nom sont obligatoires'
      });
    }
    const email = normalizeEmail(rawEmail);
    if (!email) {
      return res.status(400).json({ error: 'Adresse e-mail invalide' });
    }
    const passwordError = validatePassword(password, { email });
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    // Invitation : sans jeton valide, lie a cette adresse et encore libre, on n'ouvre pas de cabinet.
    // Un seul message pour tous les cas : on n'apprend rien a celui qui essaie.
    // Ce controle passe AVANT le doublon d'adresse : sinon le 409 reveillerait quelles adresses ont un compte.
    const invitationHash = hashInvitationToken(invitationToken);
    const invitation = invitationHash
      ? await prisma.companyInvitation.findUnique({ where: { tokenHash: invitationHash } })
      : null;
    if (!invitation || invitation.usedAt || invitation.expiresAt <= new Date() || invitation.email !== email) {
      return res.status(403).json({ error: 'Invitation invalide ou expir\u00e9e.' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const year = new Date().getFullYear();

    const result = await prisma.$transaction(async (tx) => {
      // Premier geste : prendre l'invitation. La mise a jour n'a lieu que si elle est encore libre et valide :
      // de deux requetes simultanees, une seule obtient count 1.
      const claim = await tx.companyInvitation.updateMany({
        where: { id: invitation.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() }
      });
      if (claim.count !== 1) return null; // rien n'a ete ecrit : rien a annuler

      const company = await tx.company.create({ data: { name: companyName } });
      await tx.companyInvitation.update({
        where: { id: invitation.id },
        data: { companyId: company.id }
      });

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

    // Invitation prise par une autre requete entre-temps : rien n'a ete cree.
    if (!result) {
      return res.status(403).json({ error: 'Invitation invalide ou expir\u00e9e.' });
    }

    const { password: _, ...userWithoutPassword } = result.user;
    await logAudit(req, { companyId: result.company.id, userId: result.user.id, action: 'company.registered', details: { societe: result.company.name, invitationId: invitation.id } });
    res.status(201).json({ company: result.company, user: userWithoutPassword });
  } catch (error) {
    sendError(req, res, error);
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;
    if (typeof rawEmail !== 'string' || typeof password !== 'string' || !rawEmail || !password) {
      return res.status(400).json({ error: 'E-mail et mot de passe obligatoires' });
    }
    const email = normalizeEmail(rawEmail);
    if (!email) {
      return res.status(400).json({ error: 'Adresse e-mail invalide' });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Meme travail qu'avec un vrai compte : sinon un e-mail inconnu repond beaucoup plus vite
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

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
        { userId: user.id, pending2FA: true, jti: crypto.randomUUID() },
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
    sendError(req, res, error);
  }
});

const MAX_2FA_ATTEMPTS = 5; // echecs permis par couple (compte, adresse IP)
const MAX_2FA_ATTEMPTS_ACCOUNT = 20; // filet : echecs permis pour le compte entier, toutes IP confondues
const LOCK_MINUTES = 15;
const LOCK_ALERT_OPTS = { maxIp: MAX_2FA_ATTEMPTS, maxAccount: MAX_2FA_ATTEMPTS_ACCOUNT, lockMinutes: LOCK_MINUTES };

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
    // Jeton temporaire sans identifiant (emis avant ce controle) ou deja utilise : refuse
    if (!decoded.jti) {
      return res.status(401).json({ error: 'Session de connexion expir\u00e9e, recommencez' });
    }
    const alreadyUsed = await prisma.usedPendingToken.findUnique({ where: { jti: decoded.jti } });
    if (alreadyUsed) {
      return res.status(401).json({ error: 'Session de connexion d\u00e9j\u00e0 utilis\u00e9e, recommencez' });
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

    // 1) Un ancien verrou de compte expire : on remet les compteurs a zero.
    //    updateMany avec condition : si plusieurs requetes arrivent ensemble, une seule le fait.
    const maintenant = new Date();
    if (user.twoFactorLockedUntil && user.twoFactorLockedUntil <= maintenant) {
      await prisma.user.updateMany({
        where: { id: user.id, twoFactorLockedUntil: { lte: maintenant } },
        data: { twoFactorFailedAttempts: 0, twoFactorLockedUntil: null }
      });
    }

    // 2) On RESERVE l'essai AVANT de tester le code (numerotation atomique en base).
    //    Meme avec 50 requetes simultanees, au plus MAX_2FA_ATTEMPTS codes sont testes
    //    pour une adresse IP : les suivantes sont refusees sans toucher au code.
    const ip = req.ip || 'inconnue';
    const ipAttempt = await reserveIpAttempt(user.id, ip, { max: MAX_2FA_ATTEMPTS, lockMinutes: LOCK_MINUTES });
    if (ipAttempt.failures > MAX_2FA_ATTEMPTS) {
      const minutes = ipAttempt.lockedUntil
        ? Math.max(1, Math.ceil((ipAttempt.lockedUntil - new Date()) / 60000))
        : LOCK_MINUTES;
      return res.status(429).json({ error: `Trop d'essais. R\u00e9essayez dans ${minutes} minute(s).` });
    }

    // 3) Filet de compte : meme principe pour le compte entier, toutes adresses IP confondues.
    //    Les requetes deja refusees ci-dessus ne le consomment pas.
    const accountState = await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorFailedAttempts: { increment: 1 } },
      select: { twoFactorFailedAttempts: true }
    });
    const accountAttempts = accountState.twoFactorFailedAttempts;
    if (accountAttempts >= MAX_2FA_ATTEMPTS_ACCOUNT) {
      await prisma.user.updateMany({
        where: { id: user.id, twoFactorLockedUntil: null },
        data: { twoFactorLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) }
      });
    }
    if (accountAttempts > MAX_2FA_ATTEMPTS_ACCOUNT) {
      return res.status(429).json({ error: `Trop d'essais. R\u00e9essayez dans ${LOCK_MINUTES} minutes.` });
    }

    const cleanCode = String(code).replace(/\s/g, '');
    let ok = await verifyTotp(user, cleanCode); 
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
      // L'essai a deja ete compte (reservation plus haut) : ici on choisit seulement la reponse.
      // Si le filet de compte est atteint, c'est lui qui prime (etiquette 'compte', alerte aux responsables).
      if (ipAttempt.failures >= MAX_2FA_ATTEMPTS && accountAttempts < MAX_2FA_ATTEMPTS_ACCOUNT) {
        await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'twofactor.locked', details: { minutes: LOCK_MINUTES, portee: 'ip' } });
        await sendLockAlert(user, 'ip', LOCK_ALERT_OPTS);
        return res.status(429).json({ error: `Trop d'essais. R\u00e9essayez dans ${LOCK_MINUTES} minutes.` });
      }
      if (accountAttempts >= MAX_2FA_ATTEMPTS_ACCOUNT) {
        await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'twofactor.locked', details: { minutes: LOCK_MINUTES, portee: 'compte' } });
        await sendLockAlert(user, 'compte', LOCK_ALERT_OPTS);
        return res.status(429).json({ error: `Trop d'essais. R\u00e9essayez dans ${LOCK_MINUTES} minutes.` });
      }
      await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'twofactor.login_failed', details: { tentative: ipAttempt.failures } });
      return res.status(401).json({ error: 'Code invalide' });
    }
    // Succès : on remet les compteurs à zéro
        // Le jeton temporaire est consomme ici : la cle primaire (jti) est unique, donc
    // si deux requetes arrivent en meme temps avec le meme jeton, une seule peut le reserver.
    try {
      await prisma.usedPendingToken.create({ data: { jti: decoded.jti, expiresAt: new Date(decoded.exp * 1000) } });
    } catch (e) {
      if (e.code === 'P2002') {
        return res.status(401).json({ error: 'Session de connexion d\u00e9j\u00e0 utilis\u00e9e, recommencez' });
      }
      throw e;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorFailedAttempts: 0, twoFactorLockedUntil: null }
    });
    await clearIpAttempts(user.id, ip);

    const token = jwt.sign(
      { userId: user.id, role: user.role, companyId: user.companyId, sid: await createSession(req, user) },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    await logAudit(req, { companyId: user.companyId, userId: user.id, action: 'login.success', details: { deuxFacteurs: true, methode } });
    res.json({ token });
  } catch (error) {
    sendError(req, res, error);
  }
});

// Demande de réinitialisation : envoie un lien à usage unique, valable 15 minutes
router.post('/forgot-password', async (req, res) => {
  try {
    const { email: rawEmail } = req.body;
    if (!rawEmail) return res.status(400).json({ error: 'Email obligatoire' });
    const email = normalizeEmail(rawEmail);
    if (!email) return res.status(400).json({ error: 'Adresse e-mail invalide' });

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

    // Le jeton ne s'affiche dans la console qu'en développement local.
    // En production, les logs de Render ne doivent jamais contenir de jeton.
    if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
      console.log(`[dev] Lien de réinitialisation pour ${email} : ${process.env.FRONT_URL || '(FRONT_URL non défini)'}?resetToken=${token}`);
    }

    sendMail(
      email,
      'Réinitialisation de votre mot de passe FlexCongés',
      `Voici votre lien de réinitialisation (valable 15 minutes) :\n\n${process.env.FRONT_URL || '(URL non configurée)'}?resetToken=${token}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`
    ).catch(err => console.error('Erreur envoi email:', err));

    res.json(genericResponse);
  } catch (error) {
    sendError(req, res, error);
  }
});

// Finalise la réinitialisation : vérifie le jeton, puis change le mot de passe
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Jeton et mot de passe obligatoires' });

    const passwordFormatError = validatePassword(password);
    if (passwordFormatError) {
      return res.status(400).json({ error: passwordFormatError });
    }

    const user = await prisma.user.findUnique({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
      return res.status(400).json({ error: 'Lien invalide ou expiré' });
    }

    const passwordEmailError = validatePassword(password, { email: user.email });
    if (passwordEmailError) {
      return res.status(400).json({ error: passwordEmailError });
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
    sendError(req, res, error);
  }
});

module.exports = router;