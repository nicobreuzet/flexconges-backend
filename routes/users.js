const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');

const router = express.Router();

const SAFE_USER_FIELDS = {
  id: true, email: true, firstName: true, lastName: true,
  role: true, isActive: true, phone: true, team: true, teamId: true,
  address: true, startDate: true, createdAt: true
};

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

// Créer un utilisateur (managers uniquement) — avec mot de passe temporaire généré
router.post('/users', authenticate, requireManager, async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { email, firstName, lastName, role, phone, teamId, address, startDate, cpAlloc, rttAlloc } = req.body;

    if (!email || !firstName || !lastName || !role) {
      return res.status(400).json({ error: 'Email, prénom, nom et rôle sont obligatoires' });
    }

    const teamFields = await resolveTeamFields(teamId, companyId);

    const tempPassword = Math.random().toString(36).slice(-10);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const user = await prisma.user.create({
      data: {
        email, firstName, lastName, role,
        password: hashedPassword,
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

    res.status(201).json({ ...user, tempPassword });
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
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;