const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');

const router = express.Router();

router.get('/holidays', authenticate, async (req, res) => {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  res.json(holidays);
});

router.post('/holidays', authenticate, requireManager, async (req, res) => {
  try {
    const { date, label } = req.body;
    if (!date || !label) return res.status(400).json({ error: 'Date et libellé obligatoires' });
    const holiday = await prisma.holiday.create({ data: { date: new Date(date), label } });
    res.status(201).json(holiday);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/holidays/:id', authenticate, requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, label } = req.body;
    const holiday = await prisma.holiday.update({
      where: { id: Number(id) }, data: { date: new Date(date), label }
    });
    res.json(holiday);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/holidays/:id', authenticate, requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.holiday.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;