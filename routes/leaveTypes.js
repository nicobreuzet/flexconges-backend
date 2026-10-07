const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');
const { logAudit } = require('../utils/audit');

// Plafond annuel en nombre simple (ou null) pour le journal d'audit
const plafond = (v) => (v == null ? null : Number(v));

const router = express.Router();

router.get('/leave-types', authenticate, async (req, res) => {
  const types = await prisma.leaveType.findMany({
    where: { companyId: req.user.companyId },
    orderBy: { id: 'asc' }
  });
  res.json(types);
});

router.post('/leave-types', authenticate, requireManager, async (req, res) => {
  try {
    const { code, label, color, requiresProof, annualCap } = req.body;
    if (!code || !label) return res.status(400).json({ error: 'Code et libellé obligatoires' });
    const type = await prisma.leaveType.create({
      data: {
        code: code.toUpperCase(),
        label,
        color: color || '#3B82F6',
        requiresProof: !!requiresProof,
        annualCap: annualCap || null,
        companyId: req.user.companyId
      }
    });
    await logAudit(req, {
      companyId: req.user.companyId, userId: req.user.userId, action: 'leave_type.created',
      details: { typeId: type.id, code: type.code, libelle: type.label, plafondAnnuel: plafond(type.annualCap) }
    });
    res.status(201).json(type);
  } catch (error) {
    res.status(400).json({ error: 'Ce code existe peut-être déjà.' });
  }
});

router.put('/leave-types/:id', authenticate, requireManager, async (req, res) => {
  try {
    const { code, label, color, requiresProof, annualCap } = req.body;

    // On vérifie que ce type appartient bien à la société de l'appelant
    const existing = await prisma.leaveType.findFirst({
      where: { id: Number(req.params.id), companyId: req.user.companyId }
    });
    if (!existing) return res.status(404).json({ error: 'Type de congé introuvable' });

    const type = await prisma.leaveType.update({
      where: { id: existing.id },
      data: { code: code.toUpperCase(), label, color, requiresProof: !!requiresProof, annualCap: annualCap || null }
    });
    await logAudit(req, {
      companyId: req.user.companyId, userId: req.user.userId, action: 'leave_type.updated',
      details: { typeId: type.id, code: type.code, libelle: type.label, plafondAnnuel: { de: plafond(existing.annualCap), vers: plafond(type.annualCap) } }
    });
    res.json(type);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/leave-types/:id', authenticate, requireManager, async (req, res) => {
  try {
    const existing = await prisma.leaveType.findFirst({
      where: { id: Number(req.params.id), companyId: req.user.companyId }
    });
    if (!existing) return res.status(404).json({ error: 'Type de congé introuvable' });

    await prisma.leaveType.delete({ where: { id: existing.id } });
    await logAudit(req, {
      companyId: req.user.companyId, userId: req.user.userId, action: 'leave_type.deleted',
      details: { typeId: existing.id, code: existing.code, libelle: existing.label }
    });
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: 'Impossible de supprimer : des demandes existantes utilisent ce type.' });
  }
});

module.exports = router;