const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');

const router = express.Router();

const SAFE_USER_FIELDS = {
  id: true, email: true, firstName: true, lastName: true,
  role: true, isActive: true, phone: true, team: true,
  address: true, startDate: true, createdAt: true
};

router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  const { password, ...userWithoutPassword } = user;
  res.json(userWithoutPassword);
});

router.get('/users', authenticate, requireManager, async (req, res) => {
  const users = await prisma.user.findMany({ select: SAFE_USER_FIELDS });
  res.json(users);
});

// Créer un utilisateur (managers uniquement) — avec mot de passe temporaire généré
router.post('/users', authenticate, requireManager, async (req, res) => {
  try {
    const { email, firstName, lastName, role, phone, team, address, startDate, cpAlloc, rttAlloc } = req.body;

    if (!email || !firstName || !lastName || !role) {
      return res.status(400).json({ error: 'Email, prénom, nom et rôle sont obligatoires' });
    }

    const tempPassword = Math.random().toString(36).slice(-10);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const user = await prisma.user.create({
      data: {
        email, firstName, lastName, role,
        password: hashedPassword,
        phone: phone || null,
        team: team || null,
        address: address || null,
        startDate: startDate ? new Date(startDate) : null
      },
      select: SAFE_USER_FIELDS
    });

    // Création des soldes initiaux CP/RTT pour l'année en cours
    const year = new Date().getFullYear();
    const cpType = await prisma.leaveType.findUnique({ where: { code: 'CP' } });
    const rttType = await prisma.leaveType.findUnique({ where: { code: 'RTT' } });

    const balanceCreates = [];
    if (cpType) {
      balanceCreates.push(prisma.leaveBalance.create({
        data: { userId: user.id, leaveTypeId: cpType.id, year, allocated: cpAlloc ?? cpType.annualCap ?? 25 }
      }));
    }
    if (rttType) {
      balanceCreates.push(prisma.leaveBalance.create({
        data: { userId: user.id, leaveTypeId: rttType.id, year, allocated: rttAlloc ?? rttType.annualCap ?? 10 }
      }));
    }
    await Promise.all(balanceCreates);

    res.status(201).json({ ...user, tempPassword });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Modifier un utilisateur (managers uniquement)
router.put('/users/:id', authenticate, requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, role, phone, team, address, startDate, cpAlloc, rttAlloc } = req.body;

    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: {
        firstName, lastName, email, role,
        phone: phone || null,
        team: team || null,
        address: address || null,
        startDate: startDate ? new Date(startDate) : null
      },
      select: SAFE_USER_FIELDS
    });

    // Mise à jour (ou création) des soldes CP/RTT de l'année en cours, si fournis
    const year = new Date().getFullYear();
    if (cpAlloc !== undefined || rttAlloc !== undefined) {
      const cpType = await prisma.leaveType.findUnique({ where: { code: 'CP' } });
      const rttType = await prisma.leaveType.findUnique({ where: { code: 'RTT' } });

      if (cpAlloc !== undefined && cpType) {
        await prisma.leaveBalance.upsert({
          where: { userId_leaveTypeId_year: { userId: Number(id), leaveTypeId: cpType.id, year } },
          update: { allocated: cpAlloc },
          create: { userId: Number(id), leaveTypeId: cpType.id, year, allocated: cpAlloc }
        });
      }
      if (rttAlloc !== undefined && rttType) {
        await prisma.leaveBalance.upsert({
          where: { userId_leaveTypeId_year: { userId: Number(id), leaveTypeId: rttType.id, year } },
          update: { allocated: rttAlloc },
          create: { userId: Number(id), leaveTypeId: rttType.id, year, allocated: rttAlloc }
        });
      }
    }

    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Désactiver un utilisateur (managers uniquement)
router.patch('/users/:id/deactivate', authenticate, requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.update({
      where: { id: Number(id) },
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
    const { id } = req.params;
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: { isActive: true },
      select: SAFE_USER_FIELDS
    });
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;