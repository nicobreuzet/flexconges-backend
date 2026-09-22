const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');

const router = express.Router();

router.get('/holidays', authenticate, async (req, res) => {
  const holidays = await prisma.holiday.findMany({
    where: { companyId: req.user.companyId },
    orderBy: { date: 'asc' }
  });
  res.json(holidays);
});

router.post('/holidays', authenticate, requireManager, async (req, res) => {
  try {
    const { date, label } = req.body;
    if (!date || !label) return res.status(400).json({ error: 'Date et libellé obligatoires' });
    const holiday = await prisma.holiday.create({
      data: { date: new Date(date), label, companyId: req.user.companyId }
    });
    res.status(201).json(holiday);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/holidays/:id', authenticate, requireManager, async (req, res) => {
  try {
    const { date, label } = req.body;

    // On vérifie que ce jour férié appartient bien à la société de l'appelant
    const existing = await prisma.holiday.findFirst({
      where: { id: Number(req.params.id), companyId: req.user.companyId }
    });
    if (!existing) return res.status(404).json({ error: 'Jour férié introuvable' });

    const holiday = await prisma.holiday.update({
      where: { id: existing.id },
      data: { date: new Date(date), label }
    });
    res.json(holiday);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/holidays/:id', authenticate, requireManager, async (req, res) => {
  try {
    const existing = await prisma.holiday.findFirst({
      where: { id: Number(req.params.id), companyId: req.user.companyId }
    });
    if (!existing) return res.status(404).json({ error: 'Jour férié introuvable' });

    await prisma.holiday.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;