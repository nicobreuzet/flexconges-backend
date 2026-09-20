const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');

const router = express.Router();

router.get('/leave-types', authenticate, async (req, res) => {
  const types = await prisma.leaveType.findMany({ orderBy: { id: 'asc' } });
  res.json(types);
});

router.post('/leave-types', authenticate, requireManager, async (req, res) => {
  try {
    const { code, label, color, requiresProof, annualCap } = req.body;
    if (!code || !label) return res.status(400).json({ error: 'Code et libellé obligatoires' });
    const type = await prisma.leaveType.create({
      data: { code: code.toUpperCase(), label, color: color || '#3B82F6', requiresProof: !!requiresProof, annualCap: annualCap || null }
    });
    res.status(201).json(type);
  } catch (error) {
    res.status(400).json({ error: 'Ce code existe peut-être déjà.' });
  }
});

router.put('/leave-types/:id', authenticate, requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const { code, label, color, requiresProof, annualCap } = req.body;
    const type = await prisma.leaveType.update({
      where: { id: Number(id) },
      data: { code: code.toUpperCase(), label, color, requiresProof: !!requiresProof, annualCap: annualCap || null }
    });
    res.json(type);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/leave-types/:id', authenticate, requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.leaveType.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: 'Impossible de supprimer : des demandes existantes utilisent ce type.' });
  }
});

module.exports = router;