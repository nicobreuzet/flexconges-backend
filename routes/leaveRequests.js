const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');
const { countWorkdays, hasOverlappingRequest } = require('../utils/workdays');
const { sendMail } = require('../config/mailer');
const router = express.Router();

router.post('/leave-requests', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, leaveTypeId, comment } = req.body;

    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
    }

    const overlap = await hasOverlappingRequest(req.user.userId, startDate, endDate);
    if (overlap) {
      return res.status(400).json({ error: 'Vous avez déjà une demande sur cette période' });
    }

    const daysCount = await countWorkdays(startDate, endDate);
    const year = new Date(startDate).getFullYear();

    let balance = await prisma.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId: req.user.userId, leaveTypeId, year } }
    });

    const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });

    if (!balance) {
      balance = await prisma.leaveBalance.create({
        data: { userId: req.user.userId, leaveTypeId, year, allocated: leaveType.annualCap || 0 }
      });
    }

    const availableDays = balance.allocated - balance.taken - balance.pending;
    if (leaveType.annualCap && daysCount > availableDays) {
      return res.status(400).json({
        error: `Solde insuffisant. Jours disponibles : ${availableDays}, demandés : ${daysCount}`
      });
    }

    const [leaveRequest] = await prisma.$transaction([
      prisma.leaveRequest.create({
        data: {
          startDate: new Date(startDate), endDate: new Date(endDate),
          daysCount, comment, userId: req.user.userId, leaveTypeId
        },
        include: { leaveType: true }
      }),
      prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { increment: daysCount } }
      })
    ]);

    res.status(201).json(leaveRequest);

    // Notification email aux managers
    const managers = await prisma.user.findMany({ where: { role: 'manager', isActive: true } });
    const requester = await prisma.user.findUnique({ where: { id: req.user.userId } });

    for (const manager of managers) {
      sendMail(
        manager.email,
        'Nouvelle demande de congé',
        `${requester.firstName} ${requester.lastName} a demandé ${daysCount} jour(s) de congé du ${startDate} au ${endDate}.\n\nType : ${leaveType.label}\nCommentaire : ${comment || 'Aucun'}`
      ).catch(err => console.error('Erreur envoi email:', err));
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/leave-requests/me', authenticate, async (req, res) => {
  const requests = await prisma.leaveRequest.findMany({
    where: { userId: req.user.userId },
    include: { leaveType: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json(requests);
});

router.get('/leave-requests/pending', authenticate, requireManager, async (req, res) => {
  const requests = await prisma.leaveRequest.findMany({
    where: { status: 'pending' },
    include: {
      leaveType: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } }
    },
    orderBy: { createdAt: 'asc' }
  });
  res.json(requests);
});

router.patch('/leave-requests/:id/decision', authenticate, requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, managerComment } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'La décision doit être "approved" ou "rejected"' });
    }

    const existingRequest = await prisma.leaveRequest.findUnique({ where: { id: Number(id) } });
    if (!existingRequest) return res.status(404).json({ error: 'Demande introuvable' });
    if (existingRequest.status !== 'pending') return res.status(400).json({ error: 'Cette demande a déjà été traitée' });

    const year = existingRequest.startDate.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: {
        userId_leaveTypeId_year: {
          userId: existingRequest.userId, leaveTypeId: existingRequest.leaveTypeId, year
        }
      }
    });

    const balanceUpdate = decision === 'approved'
      ? { pending: { decrement: existingRequest.daysCount }, taken: { increment: existingRequest.daysCount } }
      : { pending: { decrement: existingRequest.daysCount } };

    const [updatedRequest] = await prisma.$transaction([
      prisma.leaveRequest.update({
        where: { id: Number(id) },
        data: { status: decision, managerComment },
        include: { leaveType: true, user: { select: { firstName: true, lastName: true, email: true } } }
      }),
      prisma.leaveBalance.update({ where: { id: balance.id }, data: balanceUpdate })
    ]);

    res.json(updatedRequest);

    // Notification email à l'employé
    const statusLabel = decision === 'approved' ? 'approuvée ✅' : 'refusée ❌';
    sendMail(
      updatedRequest.user.email,
      `Votre demande de congé a été ${decision === 'approved' ? 'approuvée' : 'refusée'}`,
      `Votre demande du ${existingRequest.startDate.toLocaleDateString()} au ${existingRequest.endDate.toLocaleDateString()} a été ${statusLabel}.\n\nCommentaire du manager : ${managerComment || 'Aucun'}`
    ).catch(err => console.error('Erreur envoi email:', err));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Annuler sa propre demande (uniquement si encore en attente)
router.patch('/leave-requests/:id/cancel', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const existingRequest = await prisma.leaveRequest.findUnique({ where: { id: Number(id) } });
    if (!existingRequest) return res.status(404).json({ error: 'Demande introuvable' });
    if (existingRequest.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Vous ne pouvez annuler que vos propres demandes' });
    }
    if (existingRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Seule une demande en attente peut être annulée' });
    }

    const year = existingRequest.startDate.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: {
        userId_leaveTypeId_year: {
          userId: existingRequest.userId, leaveTypeId: existingRequest.leaveTypeId, year
        }
      }
    });

    const [updated] = await prisma.$transaction([
      prisma.leaveRequest.update({
        where: { id: Number(id) },
        data: { status: 'cancelled' },
        include: { leaveType: true }
      }),
      prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { decrement: existingRequest.daysCount } }
      })
    ]);

    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Toutes les demandes de l'organisation (pour le calendrier d'équipe)
router.get('/leave-requests/all', authenticate, async (req, res) => {
  const requests = await prisma.leaveRequest.findMany({
    where: { status: { in: ['pending', 'approved'] } }, // on ignore refusées/annulées pour le calendrier
    include: {
      leaveType: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } }
    },
    orderBy: { startDate: 'asc' }
  });
  res.json(requests);
});

// Annuler sa propre demande (uniquement si encore en attente)
router.patch('/leave-requests/:id/cancel', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const existingRequest = await prisma.leaveRequest.findUnique({ where: { id: Number(id) } });
    if (!existingRequest) return res.status(404).json({ error: 'Demande introuvable' });
    if (existingRequest.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Vous ne pouvez annuler que vos propres demandes' });
    }
    if (existingRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Seule une demande en attente peut être annulée' });
    }

    const year = existingRequest.startDate.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: {
        userId_leaveTypeId_year: {
          userId: existingRequest.userId, leaveTypeId: existingRequest.leaveTypeId, year
        }
      }
    });

    const [updated] = await prisma.$transaction([
      prisma.leaveRequest.update({
        where: { id: Number(id) },
        data: { status: 'cancelled' },
        include: { leaveType: true }
      }),
      prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { decrement: existingRequest.daysCount } }
      })
    ]);

    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;