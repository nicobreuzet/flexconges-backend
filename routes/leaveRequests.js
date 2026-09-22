const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');
const { countWorkdays, hasOverlappingRequest } = require('../utils/workdays');
const { sendMail } = require('../config/mailer');
const router = express.Router();

router.post('/leave-requests', authenticate, async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { startDate, endDate, leaveTypeId, comment } = req.body;

    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
    }

    // Le type de congé doit exister ET appartenir à la société de l'appelant
    const typeId = Number(leaveTypeId);
    if (!Number.isInteger(typeId)) {
      return res.status(400).json({ error: 'Type de congé obligatoire' });
    }
    const leaveType = await prisma.leaveType.findFirst({ where: { id: typeId, companyId } });
    if (!leaveType) return res.status(404).json({ error: 'Type de congé introuvable' });

    const overlap = await hasOverlappingRequest(req.user.userId, startDate, endDate, companyId);
    if (overlap) {
      return res.status(400).json({ error: 'Vous avez déjà une demande sur cette période' });
    }

    const daysCount = await countWorkdays(startDate, endDate, companyId);
    const year = new Date(startDate).getFullYear();

    let balance = await prisma.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId: req.user.userId, leaveTypeId: typeId, year } }
    });

    if (!balance) {
      balance = await prisma.leaveBalance.create({
        data: {
          userId: req.user.userId, leaveTypeId: typeId, year, companyId,
          allocated: leaveType.annualCap || 0
        }
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
          daysCount, comment, userId: req.user.userId, leaveTypeId: typeId, companyId
        },
        include: { leaveType: true }
      }),
      prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { increment: daysCount } }
      })
    ]);

    res.status(201).json(leaveRequest);

    // Notification email aux managers de CETTE société uniquement
    const managers = await prisma.user.findMany({
      where: { role: 'manager', isActive: true, companyId }
    });
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
    where: { userId: req.user.userId, companyId: req.user.companyId },
    include: { leaveType: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json(requests);
});

router.get('/leave-requests/pending', authenticate, requireManager, async (req, res) => {
  const requests = await prisma.leaveRequest.findMany({
    where: { status: 'pending', companyId: req.user.companyId },
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

    // La demande doit appartenir à la société du manager
    const existingRequest = await prisma.leaveRequest.findFirst({
      where: { id: Number(id), companyId: req.user.companyId }
    });
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
        where: { id: existingRequest.id },
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
    const existingRequest = await prisma.leaveRequest.findFirst({
      where: { id: Number(req.params.id), companyId: req.user.companyId }
    });
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
        where: { id: existingRequest.id },
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

// Toutes les demandes de la société (pour le calendrier d'équipe)
router.get('/leave-requests/all', authenticate, async (req, res) => {
  const requests = await prisma.leaveRequest.findMany({
    where: {
      companyId: req.user.companyId,
      status: { in: ['pending', 'approved'] } // on ignore refusées/annulées pour le calendrier
    },
    include: {
      leaveType: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } }
    },
    orderBy: { startDate: 'asc' }
  });
  res.json(requests);
});

module.exports = router;