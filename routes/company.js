const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');
const { logAudit } = require('../utils/audit');
const { getSecurityConfig, validateSecurityPatch } = require('../utils/securityConfig');

const router = express.Router();

const ALLOWED_FIELDS = ['sector', 'siret', 'barreau', 'convention', 'taille', 'pays', 'adresse'];

// Valeurs par défaut si une société n'a jamais touché à ces réglages
// (colonnes encore à null en base)
const DEFAULT_BRANDING = {
  name: 'FlexCongés Démo',
  sidebarSubtitle: 'Gestion des Absences',
  welcomeMsg: 'Bienvenue sur FlexCongés',
  teamLabel: 'Équipe',
  primaryColor: '#0d1b2a',
  accentColor: '#c9a84c',
};

const DEFAULT_ROLES = {
  manager: {
    singular: 'Manager', plural: 'Managers', feminine: 'Manager',
    icon: '👔', color: '#dc2626',
    permissions: { canApprove: true, canManageUsers: true, canSeeReports: true, canAdmin: true, canManageBilling: true },
  },
  employee: {
    singular: 'Employé', plural: 'Employés', feminine: 'Employée',
    icon: '👤', color: '#2d7a4f',
    permissions: { canApprove: false, canManageUsers: false, canSeeReports: false, canAdmin: false, canManageBilling: false },
  },
};

const DEFAULT_RULES = {
  noticeDays: 14,
  maxSimultaneousAbsences: 2,
  carryOverDate: '31 mai N+1',
  workflowLevels: 1, // 1 = manager seul, 2 = manager + validation RH
};

// Lecture des infos de la société de l'utilisateur connecté.
// Accessible à tout le monde (employé ou manager) : tout le monde a besoin
// des libellés de rôle et de l'identité visuelle pour afficher l'écran.
router.get('/company', authenticate, async (req, res) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId }
    });

    if (!company) {
      return res.status(404).json({ error: 'Société introuvable' });
    }

    res.json({
      ...company,
      brandingConfig: company.brandingConfig || DEFAULT_BRANDING,
      roleConfig: company.roleConfig || DEFAULT_ROLES,
      rulesConfig: company.rulesConfig || DEFAULT_RULES,
      securityConfig: getSecurityConfig(company.securityConfig),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Modification des infos de la société : réservé au manager, et toujours
// limité à SA société (req.user.companyId vient du token, jamais du client).
router.patch('/company', authenticate, requireManager, async (req, res) => {
  try {
    const data = {};

    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) data[field] = req.body[field] || null;
    }

    // Les 3 blocs de réglages : on attend un objet (ou rien du tout)
    for (const field of ['brandingConfig', 'roleConfig', 'rulesConfig']) {
      if (req.body[field] !== undefined) {
        if (typeof req.body[field] !== 'object' || req.body[field] === null || Array.isArray(req.body[field])) {
          return res.status(400).json({ error: `${field} doit être un objet` });
        }
        data[field] = req.body[field];
      }
    }

    // Obligation du 2FA pour tout le cabinet : un vrai booléen, traité à part
    // (la boucle ALLOWED_FIELDS transformerait false en null).
    if (req.body.requireTwoFactor !== undefined) {
      if (typeof req.body.requireTwoFactor !== 'boolean') {
        return res.status(400).json({ error: 'requireTwoFactor doit être vrai ou faux' });
      }
      if (req.body.requireTwoFactor === true) {
        // Garde-fou : un manager sans 2FA qui l'impose à tous se bloquerait lui-même
        const me = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { twoFactorEnabled: true }
        });
        if (!me.twoFactorEnabled) {
          return res.status(400).json({
            error: 'Activez d\'abord votre propre 2FA (page « Mon 2FA ») avant de l\'imposer au cabinet.'
          });
        }
      }
      data.requireTwoFactor = req.body.requireTwoFactor;
    }

    // Réglages de sécurité : validés par le serveur (clés et valeurs connues uniquement),
    // fusionnés avec l'existant pour qu'une modification partielle n'efface rien.
    let securityChange = null;
    if (req.body.securityConfig !== undefined) {
      const check = validateSecurityPatch(req.body.securityConfig);
      if (check.error) return res.status(400).json({ error: check.error });
      const current = await prisma.company.findUnique({
        where: { id: req.user.companyId },
        select: { securityConfig: true }
      });
      const before = getSecurityConfig(current.securityConfig);
      data.securityConfig = { ...before, ...check.value };
      securityChange = { de: before, vers: data.securityConfig };
    }

    const company = await prisma.company.update({
      where: { id: req.user.companyId },
      data
    });

    // Journal d'audit : l'obligation du 2FA est un événement à part, le reste est regroupé
    if (data.requireTwoFactor !== undefined) {
      await logAudit(req, {
        companyId: req.user.companyId,
        userId: req.user.userId,
        action: data.requireTwoFactor ? 'company.twofactor_required' : 'company.twofactor_optional'
      });
    }
    if (securityChange) {
      await logAudit(req, {
        companyId: req.user.companyId,
        userId: req.user.userId,
        action: 'company.security_updated',
        details: securityChange
      });
    }
    const autresChamps = Object.keys(data).filter(k => k !== 'requireTwoFactor' && k !== 'securityConfig');
    if (autresChamps.length > 0) {
      await logAudit(req, {
        companyId: req.user.companyId,
        userId: req.user.userId,
        action: 'company.updated',
        details: { champs: autresChamps }
      });
    }

    res.json({
      ...company,
      brandingConfig: company.brandingConfig || DEFAULT_BRANDING,
      roleConfig: company.roleConfig || DEFAULT_ROLES,
      rulesConfig: company.rulesConfig || DEFAULT_RULES,
      securityConfig: getSecurityConfig(company.securityConfig),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Journal d'audit de la société : réservé au manager, limité à SA société.
// Pagination par curseur : ?limit=50&before=<id> (les plus récents d'abord).
// Filtre optionnel : ?action=login  (tout ce qui commence par "login").
router.get('/audit-logs', authenticate, requireManager, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

    const where = { companyId: req.user.companyId };
    if (req.query.before !== undefined) {
      const before = Number(req.query.before);
      if (!Number.isInteger(before) || before < 1) {
        return res.status(400).json({ error: 'before doit être un identifiant valide' });
      }
      where.id = { lt: before };
    }
    if (req.query.action) {
      where.action = { startsWith: String(req.query.action) };
    }

    // On lit une ligne de plus que demandé pour savoir s'il existe une page suivante
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true, action: true, details: true, ip: true, userAgent: true, createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    res.json({ items, nextCursor: hasMore ? items[items.length - 1].id : null });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;