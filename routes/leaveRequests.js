const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');
const { countWorkdays, hasOverlappingRequest } = require('../utils/workdays');
const { sendMail } = require('../config/mailer');
const router = express.Router();

router.post('/leave-requests', authenticate, async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { startDate, endDate, leaveTypeId, comment, asDraft } = req.body;

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

    const daysCount = await countWorkdays(startDate, endDate, companyId);

    // Un brouillon est enregistré tel quel : pas de vérification de chevauchement,
    // pas de vérification de solde, pas de notification aux managers.
    if (asDraft) {
      const draft = await prisma.leaveRequest.create({
        data: {
          startDate: new Date(startDate), endDate: new Date(endDate),
          daysCount, comment, userId: req.user.userId, leaveTypeId: typeId, companyId,
          status: 'brouillon'
        },
        include: { leaveType: true }
      });
      return res.status(201).json(draft);
    }

    const overlap = await hasOverlappingRequest(req.user.userId, startDate, endDate, companyId);
    if (overlap) {
      return res.status(400).json({ error: 'Vous avez déjà une demande sur cette période' });
    }

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

// Soumettre un brouillon : lance les vraies vérifications puis le transforme en demande en attente
router.patch('/leave-requests/:id/submit', authenticate, async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existingRequest = await prisma.leaveRequest.findFirst({
      where: { id: Number(req.params.id), companyId }
    });
    if (!existingRequest) return res.status(404).json({ error: 'Demande introuvable' });
    if (existingRequest.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Vous ne pouvez soumettre que vos propres brouillons' });
    }
    if (existingRequest.status !== 'brouillon') {
      return res.status(400).json({ error: 'Seul un brouillon peut être soumis' });
    }

    const leaveType = await prisma.leaveType.findFirst({ where: { id: existingRequest.leaveTypeId, companyId } });

    const overlap = await hasOverlappingRequest(
      req.user.userId, existingRequest.startDate, existingRequest.endDate, companyId
    );
    if (overlap) {
      return res.status(400).json({ error: 'Vous avez déjà une demande sur cette période' });
    }

    const year = existingRequest.startDate.getFullYear();
    let balance = await prisma.leaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId: req.user.userId, leaveTypeId: existingRequest.leaveTypeId, year } }
    });
    if (!balance) {
      balance = await prisma.leaveBalance.create({
        data: {
          userId: req.user.userId, leaveTypeId: existingRequest.leaveTypeId, year, companyId,
          allocated: leaveType.annualCap || 0
        }
      });
    }

    const availableDays = balance.allocated - balance.taken - balance.pending;
    if (leaveType.annualCap && existingRequest.daysCount > availableDays) {
      return res.status(400).json({
        error: `Solde insuffisant. Jours disponibles : ${availableDays}, demandés : ${existingRequest.daysCount}`
      });
    }

    const [updatedRequest] = await prisma.$transaction([
      prisma.leaveRequest.update({
        where: { id: existingRequest.id },
        data: { status: 'pending' },
        include: { leaveType: true }
      }),
      prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { increment: existingRequest.daysCount } }
      })
    ]);

    res.json(updatedRequest);

    const managers = await prisma.user.findMany({ where: { role: 'manager', isActive: true, companyId } });
    const requester = await prisma.user.findUnique({ where: { id: req.user.userId } });
    for (const manager of managers) {
      sendMail(
        manager.email,
        'Nouvelle demande de congé',
        `${requester.firstName} ${requester.lastName} a demandé ${existingRequest.daysCount} jour(s) de congé du ${existingRequest.startDate.toLocaleDateString()} au ${existingRequest.endDate.toLocaleDateString()}.\n\nType : ${leaveType.label}\nCommentaire : ${existingRequest.comment || 'Aucun'}`
      ).catch(err => console.error('Erreur envoi email:', err));
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Modifier un brouillon (pas de nouvelle vérification de solde ou de chevauchement, ce sera fait à la soumission)
router.put('/leave-requests/:id', authenticate, async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existingRequest = await prisma.leaveRequest.findFirst({
      where: { id: Number(req.params.id), companyId }
    });
    if (!existingRequest) return res.status(404).json({ error: 'Demande introuvable' });
    if (existingRequest.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres brouillons' });
    }
    if (existingRequest.status !== 'brouillon') {
      return res.status(400).json({ error: 'Seul un brouillon peut être modifié' });
    }

    const { startDate, endDate, leaveTypeId, comment } = req.body;
    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
    }
    const typeId = Number(leaveTypeId);
    if (!Number.isInteger(typeId)) {
      return res.status(400).json({ error: 'Type de congé obligatoire' });
    }
    const leaveType = await prisma.leaveType.findFirst({ where: { id: typeId, companyId } });
    if (!leaveType) return res.status(404).json({ error: 'Type de congé introuvable' });

    const daysCount = await countWorkdays(startDate, endDate, companyId);

    const updated = await prisma.leaveRequest.update({
      where: { id: existingRequest.id },
      data: {
        startDate: new Date(startDate), endDate: new Date(endDate),
        daysCount, comment, leaveTypeId: typeId
      },
      include: { leaveType: true }
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Supprimer un brouillon
router.delete('/leave-requests/:id', authenticate, async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existingRequest = await prisma.leaveRequest.findFirst({
      where: { id: Number(req.params.id), companyId }
    });
    if (!existingRequest) return res.status(404).json({ error: 'Demande introuvable' });
    if (existingRequest.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres brouillons' });
    }
    if (existingRequest.status !== 'brouillon') {
      return res.status(400).json({ error: 'Seul un brouillon peut être supprimé' });
    }

    await prisma.leaveRequest.delete({ where: { id: existingRequest.id } });
    res.status(204).end();
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