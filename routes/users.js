const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { sendMail } = require('../config/mailer');
const { authenticate, requireManager } = require('../middlewares/auth');
const { logAudit } = require('../utils/audit');
const { revokeUserSessions } = require('../utils/sessions');

const router = express.Router();

const SAFE_USER_FIELDS = {
  id: true, email: true, firstName: true, lastName: true,
  role: true, isActive: true, phone: true, team: true, teamId: true,
  address: true, startDate: true, createdAt: true
};

// Durée de validité du lien d'invitation envoyé à un nouveau collaborateur : 7 jours
// (plus long que "mot de passe oublié", qui n'est valable que 15 minutes — un collaborateur
// ne consulte pas forcément son email dans la minute qui suit la création de son compte).
const INVITATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Cherche un utilisateur par son id, mais UNIQUEMENT dans la société de l'appelant.
function findUserInCompany(id, companyId) {
  return prisma.user.findFirst({ where: { id: Number(id), companyId } });
}

// Vérifie que teamId (s'il est fourni) appartient à la société de l'appelant, et renvoie
// { teamId, team } prêt à être fusionné dans un `data` de création/modification.
// teamId === null signifie "retirer l'équipe" ; teamId === undefined signifie "ne rien changer".
async function resolveTeamFields(teamId, companyId) {
  if (teamId === undefined) return {};
  if (teamId === null) return { teamId: null, team: null };

  const team = await prisma.team.findFirst({ where: { id: Number(teamId), companyId } });
  if (!team) throw Object.assign(new Error('Équipe introuvable'), { status: 404 });

  return { teamId: team.id, team: team.name };
}

router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  const { password, ...userWithoutPassword } = user;
  res.json(userWithoutPassword);
});

router.get('/users', authenticate, requireManager, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { companyId: req.user.companyId },
    select: SAFE_USER_FIELDS
  });
  res.json(users);
});

// Créer un utilisateur (managers uniquement).
// Personne — pas même le manager qui crée le compte — ne connaît le mot de passe initial :
// un email d'invitation est envoyé au collaborateur, avec un lien à usage unique lui
// permettant de choisir lui-même son mot de passe (même mécanisme que "mot de passe oublié").
router.post('/users', authenticate, requireManager, async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { email, firstName, lastName, role, phone, teamId, address, startDate, cpAlloc, rttAlloc } = req.body;

    if (!email || !firstName || !lastName || !role) {
      return res.status(400).json({ error: 'Email, prénom, nom et rôle sont obligatoires' });
    }

    const teamFields = await resolveTeamFields(teamId, companyId);

    // Mot de passe aléatoire, jamais révélé à personne : le champ est obligatoire en base,
    // mais l'accès réel au compte passera par le lien d'invitation ci-dessous.
    const randomPassword = crypto.randomBytes(24).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 10);

    const invitationToken = crypto.randomBytes(32).toString('hex');
    const invitationExpires = new Date(Date.now() + INVITATION_TOKEN_TTL_MS);

    const user = await prisma.user.create({
      data: {
        email, firstName, lastName, role,
        password: hashedPassword,
        resetToken: invitationToken,
        resetTokenExpires: invitationExpires,
        phone: phone || null,
        address: address || null,
        startDate: startDate ? new Date(startDate) : null,
        companyId,
        ...teamFields
      },
      select: SAFE_USER_FIELDS
    });

    // Création des soldes initiaux CP/RTT pour l'année en cours (types de CETTE société)
    const year = new Date().getFullYear();
    const cpType = await prisma.leaveType.findFirst({ where: { code: 'CP', companyId } });
    const rttType = await prisma.leaveType.findFirst({ where: { code: 'RTT', companyId } });

    const balanceCreates = [];
    if (cpType) {
      balanceCreates.push(prisma.leaveBalance.create({
        data: { userId: user.id, leaveTypeId: cpType.id, year, companyId, allocated: cpAlloc ?? cpType.annualCap ?? 25 }
      }));
    }
    if (rttType) {
      balanceCreates.push(prisma.leaveBalance.create({
        data: { userId: user.id, leaveTypeId: rttType.id, year, companyId, allocated: rttAlloc ?? rttType.annualCap ?? 10 }
      }));
    }
    await Promise.all(balanceCreates);

    await logAudit(req, { companyId, userId: req.user.userId, action: 'user.created', details: { cibleId: user.id, cible: user.email, role: user.role } });

    // Affiché dans la console du serveur, pratique pour les tests sans avoir à ouvrir l'e-mail
    if (process.env.FRONT_URL) {
      console.log(`Invitation pour ${email} : ${process.env.FRONT_URL}?resetToken=${invitationToken} (valable 7 jours)`);
    } else {
      console.log(`Jeton d'invitation pour ${email} : ${invitationToken} (valable 7 jours, FRONT_URL non défini)`);
    }

    sendMail(
      email,
      'Votre accès FlexCongés',
      `Bonjour ${firstName},\n\nUn compte vient d'être créé pour vous sur FlexCongés. Cliquez sur le lien ci-dessous pour choisir votre mot de passe (valable 7 jours) :\n\n${process.env.FRONT_URL || '(URL non configurée)'}?resetToken=${invitationToken}\n\nSi vous ne vous attendiez pas à cet e-mail, vous pouvez l'ignorer.`
    ).catch(err => console.error('Erreur envoi email invitation:', err));

    res.status(201).json({ ...user, invitationSent: true });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

// Modifier un utilisateur (managers uniquement)
router.put('/users/:id', authenticate, requireManager, async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { firstName, lastName, email, role, phone, teamId, address, startDate, cpAlloc, rttAlloc } = req.body;

    const existing = await findUserInCompany(req.params.id, companyId);
    if (!existing) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const teamFields = await resolveTeamFields(teamId, companyId);

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        firstName, lastName, email, role,
        phone: phone || null,
        address: address || null,
        startDate: startDate ? new Date(startDate) : null,
        ...teamFields
      },
      select: SAFE_USER_FIELDS
    });

    // Journal d'audit : un changement de rôle est enregistré à part, le reste est regroupé
    if (role !== undefined && role !== existing.role) {
      await logAudit(req, { companyId, userId: req.user.userId, action: 'user.role_changed', details: { cibleId: existing.id, cible: existing.email, de: existing.role, vers: role } });
    }
    const champsModifies = [];
    for (const f of ['firstName', 'lastName', 'email']) {
      if (req.body[f] !== undefined && req.body[f] !== existing[f]) champsModifies.push(f);
    }
    if ((phone || null) !== existing.phone) champsModifies.push('phone');
    if ((address || null) !== existing.address) champsModifies.push('address');
    if (teamId !== undefined && user.teamId !== existing.teamId) champsModifies.push('team');
    if (champsModifies.length > 0) {
      await logAudit(req, { companyId, userId: req.user.userId, action: 'user.updated', details: { cibleId: existing.id, cible: existing.email, champs: champsModifies } });
    }

    // Mise à jour (ou création) des soldes CP/RTT de l'année en cours, si fournis
    const year = new Date().getFullYear();
    if (cpAlloc !== undefined || rttAlloc !== undefined) {
      const cpType = await prisma.leaveType.findFirst({ where: { code: 'CP', companyId } });
      const rttType = await prisma.leaveType.findFirst({ where: { code: 'RTT', companyId } });

      if (cpAlloc !== undefined && cpType) {
        await prisma.leaveBalance.upsert({
          where: { userId_leaveTypeId_year: { userId: existing.id, leaveTypeId: cpType.id, year } },
          update: { allocated: cpAlloc },
          create: { userId: existing.id, leaveTypeId: cpType.id, year, companyId, allocated: cpAlloc }
        });
      }
      if (rttAlloc !== undefined && rttType) {
        await prisma.leaveBalance.upsert({
          where: { userId_leaveTypeId_year: { userId: existing.id, leaveTypeId: rttType.id, year } },
          update: { allocated: rttAlloc },
          create: { userId: existing.id, leaveTypeId: rttType.id, year, companyId, allocated: rttAlloc }
        });
      }
    }

    res.json(user);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

// Désactiver un utilisateur (managers uniquement)
router.patch('/users/:id/deactivate', authenticate, requireManager, async (req, res) => {
  try {
    const existing = await findUserInCompany(req.params.id, req.user.companyId);
    if (!existing) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { isActive: false },
      select: SAFE_USER_FIELDS
    });
    await revokeUserSessions(existing.id);
    await logAudit(req, { companyId: req.user.companyId, userId: req.user.userId, action: 'user.deactivated', details: { cibleId: existing.id, cible: existing.email } });
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Réactiver un utilisateur (managers uniquement)
router.patch('/users/:id/reactivate', authenticate, requireManager, async (req, res) => {
  try {
    const existing = await findUserInCompany(req.params.id, req.user.companyId);
    if (!existing) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { isActive: true },
      select: SAFE_USER_FIELDS
    });
    await logAudit(req, { companyId: req.user.companyId, userId: req.user.userId, action: 'user.reactivated', details: { cibleId: existing.id, cible: existing.email } });
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;