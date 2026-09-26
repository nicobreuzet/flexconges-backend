const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');

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

    const company = await prisma.company.update({
      where: { id: req.user.companyId },
      data
    });

    res.json({
      ...company,
      brandingConfig: company.brandingConfig || DEFAULT_BRANDING,
      roleConfig: company.roleConfig || DEFAULT_ROLES,
      rulesConfig: company.rulesConfig || DEFAULT_RULES,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;