const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');
const router = express.Router();

router.get('/balances/me', authenticate, async (req, res) => {
  const balances = await prisma.leaveBalance.findMany({
    where: { userId: req.user.userId, companyId: req.user.companyId },
    include: { leaveType: true }
  });
  res.json(balances);
});

// Soldes de toute l'équipe (managers uniquement) — limités à leur société
router.get('/balances/team', authenticate, requireManager, async (req, res) => {
  const balances = await prisma.leaveBalance.findMany({
    where: { companyId: req.user.companyId },
    include: { leaveType: true }
  });
  res.json(balances);
});

module.exports = router;