const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { TOUCH_EVERY_MINUTES } = require('../utils/sessions');
const { getSecurityConfig } = require('../utils/securityConfig');

// Routes qu'un utilisateur peut appeler même si son cabinet exige le 2FA
// et qu'il ne l'a pas encore activé : de quoi finir sa configuration, rien de plus.
function isAllowedWithout2FA(req) {
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
  if (path.startsWith('/2fa/')) return true;
  if (req.method === 'GET' && (path === '/me' || path === '/company')) return true;
  return false;
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  // Un jeton sans identifiant de session (émis avant les sessions réelles) est refusé.
  if (!decoded.sid) {
    return res.status(401).json({ error: 'Session obsolète, veuillez vous reconnecter' });
  }

  if (!decoded.companyId) {
    return res.status(401).json({ error: 'Session obsolète, veuillez vous reconnecter' });
  }

  try {
    // Le jeton prouve qui est l'utilisateur ; la base dit ce qu'il a le droit de faire MAINTENANT
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        isActive: true,
        twoFactorEnabled: true,
        companyId: true,
        company: { select: { requireTwoFactor: true, securityConfig: true } }
      }
    });

    if (!user || !user.isActive || user.companyId !== decoded.companyId) {
      return res.status(401).json({ error: 'Compte introuvable ou désactivé' });
    }

    // Session : la base dit si CE jeton correspond à une session encore valable.
    const session = await prisma.session.findUnique({
      where: { id: decoded.sid },
      select: { userId: true, revokedAt: true, lastSeenAt: true }
    });
    if (!session || session.userId !== decoded.userId || session.revokedAt) {
      return res.status(401).json({ error: 'Session révoquée, veuillez vous reconnecter' });
    }
    const security = getSecurityConfig(user.company.securityConfig);
    const idleMs = Date.now() - session.lastSeenAt.getTime();
    if (idleMs > security.sessionInactivityHours * 60 * 60 * 1000) {
      await prisma.session.update({ where: { id: decoded.sid }, data: { revokedAt: new Date() } });
      return res.status(401).json({ error: `Session expirée après ${security.sessionInactivityHours} h d'inactivité, veuillez vous reconnecter` });
    }
    if (idleMs > TOUCH_EVERY_MINUTES * 60 * 1000) {
      await prisma.session.update({ where: { id: decoded.sid }, data: { lastSeenAt: new Date() } });
    }

    if (user.company.requireTwoFactor && !user.twoFactorEnabled && !isAllowedWithout2FA(req)) {
      return res.status(403).json({
        error: 'Votre cabinet exige le 2FA : activez-le pour continuer.',
        code: '2FA_SETUP_REQUIRED'
      });
    }

    req.user = decoded;
    req.securityConfig = security;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

function requireManager(req, res, next) {
  if (req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Accès réservé aux managers' });
  }
  next();
}

module.exports = { authenticate, requireManager };