const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

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
        company: { select: { requireTwoFactor: true } }
      }
    });

    if (!user || !user.isActive || user.companyId !== decoded.companyId) {
      return res.status(401).json({ error: 'Compte introuvable ou désactivé' });
    }

    if (user.company.requireTwoFactor && !user.twoFactorEnabled && !isAllowedWithout2FA(req)) {
      return res.status(403).json({
        error: 'Votre cabinet exige le 2FA : activez-le pour continuer.',
        code: '2FA_SETUP_REQUIRED'
      });
    }

    req.user = decoded;
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