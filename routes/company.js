const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');
const { logAudit } = require('../utils/audit');
const { getSecurityConfig, validateSecurityPatch } = require('../utils/securityConfig');
const { getBrandingConfig, getRoleConfig, getRulesConfig, validateBrandingPatch, validateRolePatch, validateRulesPatch, mergeRoleConfig } = require('../utils/companyConfig');
const { sendError } = require('../utils/httpErrors');
const { parseSiret } = require('../utils/normalizeSiret');
const router = express.Router();

const ALLOWED_FIELDS = ['sector', 'siret', 'barreau', 'convention', 'taille', 'pays', 'adresse'];

// Réglages d'un cabinet : valeurs par défaut, validation et fusion sont dans
// utils/companyConfig.js (le serveur est la seule autorité ; le front affiche et envoie).
const CONFIG_BLOCKS = ['brandingConfig', 'roleConfig', 'rulesConfig'];

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
      brandingConfig: getBrandingConfig(company.brandingConfig, company.name),
      roleConfig: getRoleConfig(company.roleConfig),
      rulesConfig: getRulesConfig(company.rulesConfig),
      securityConfig: getSecurityConfig(company.securityConfig),
    });
  } catch (error) {
    sendError(req, res, error);
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
    // SIRET : valide et normalise (14 chiffres) ; vide = effacer. Ecrase la valeur brute posee par la boucle.
    if (req.body.siret !== undefined) {
      const siretCheck = parseSiret(req.body.siret);
      if (siretCheck.error) return res.status(400).json({ error: siretCheck.error });
      data.siret = siretCheck.value;
    }

    // Les 3 blocs de réglages (identité, rôles, règles) : validés par le serveur
    // (clés et valeurs connues uniquement), puis fusionnés avec l'existant pour
    // qu'une modification partielle n'efface rien. Voir utils/companyConfig.js.
    const configChanges = [];
    if (CONFIG_BLOCKS.some((bloc) => req.body[bloc] !== undefined)) {
      const current = await prisma.company.findUnique({
        where: { id: req.user.companyId },
        select: { name: true, brandingConfig: true, roleConfig: true, rulesConfig: true }
      });

      if (req.body.brandingConfig !== undefined) {
        const check = validateBrandingPatch(req.body.brandingConfig);
        if (check.error) return res.status(400).json({ error: check.error });
        const before = getBrandingConfig(current?.brandingConfig, current?.name);
        data.brandingConfig = { ...before, ...check.value };
        configChanges.push({ action: 'company.branding_updated', details: { de: before, vers: data.brandingConfig } });
      }

      if (req.body.roleConfig !== undefined) {
        const check = validateRolePatch(req.body.roleConfig);
        if (check.error) return res.status(400).json({ error: check.error });
        const before = mergeRoleConfig(current?.roleConfig, {});
        data.roleConfig = mergeRoleConfig(current?.roleConfig, check.value);
        configChanges.push({ action: 'company.roles_updated', details: { de: before, vers: data.roleConfig } });
      }

      if (req.body.rulesConfig !== undefined) {
        const check = validateRulesPatch(req.body.rulesConfig);
        if (check.error) return res.status(400).json({ error: check.error });
        const before = getRulesConfig(current?.rulesConfig);
        data.rulesConfig = { ...before, ...check.value };
        configChanges.push({ action: 'company.rules_updated', details: { de: before, vers: data.rulesConfig } });
      }
    }

    // Obligation du 2FA pour tout le cabinet : un vrai booléen, traité à part
    // (la boucle ALLOWED_FIELDS transformerait false en null).
    if (req.body.requireTwoFactor !== undefined) {
      if (typeof req.body.requireTwoFactor !== 'boolean') {
        return res.status(400).json({ error: 'L\u2019obligation du 2FA doit \u00eatre vraie ou fausse.' });
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
    for (const change of configChanges) {
      await logAudit(req, {
        companyId: req.user.companyId,
        userId: req.user.userId,
        action: change.action,
        details: change.details
      });
    }
    const autresChamps = Object.keys(data).filter(
      k => k !== 'requireTwoFactor' && k !== 'securityConfig' && !CONFIG_BLOCKS.includes(k)
    );
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
      brandingConfig: getBrandingConfig(company.brandingConfig, company.name),
      roleConfig: getRoleConfig(company.roleConfig),
      rulesConfig: getRulesConfig(company.rulesConfig),
      securityConfig: getSecurityConfig(company.securityConfig),
    });
  } catch (error) {
    sendError(req, res, error);
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
    sendError(req, res, error);
  }
});

module.exports = router;