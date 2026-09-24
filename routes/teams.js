const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');
const router = express.Router();

router.get('/teams', authenticate, async (req, res) => {
  const teams = await prisma.team.findMany({
    where: { companyId: req.user.companyId },
    orderBy: { name: 'asc' }
  });
  res.json(teams);
});

router.post('/teams', authenticate, requireManager, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nom obligatoire' });

    const team = await prisma.team.create({
      data: { name: name.trim(), companyId: req.user.companyId }
    });
    res.status(201).json(team);
  } catch (error) {
    res.status(400).json({ error: 'Ce nom existe peut-être déjà.' });
  }
});

router.put('/teams/:id', authenticate, requireManager, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nom obligatoire' });

    const existing = await prisma.team.findFirst({
      where: { id: Number(req.params.id), companyId: req.user.companyId }
    });
    if (!existing) return res.status(404).json({ error: 'Équipe introuvable' });

    // Renomme l'équipe, et garde le texte affiché synchronisé chez tous ses membres
    const [team] = await prisma.$transaction([
      prisma.team.update({ where: { id: existing.id }, data: { name: name.trim() } }),
      prisma.user.updateMany({ where: { teamId: existing.id }, data: { team: name.trim() } })
    ]);

    res.json(team);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/teams/:id', authenticate, requireManager, async (req, res) => {
  try {
    const existing = await prisma.team.findFirst({
      where: { id: Number(req.params.id), companyId: req.user.companyId }
    });
    if (!existing) return res.status(404).json({ error: 'Équipe introuvable' });

    // Libère ses membres avant de supprimer l'équipe, plutôt que de bloquer la suppression
    await prisma.$transaction([
      prisma.user.updateMany({ where: { teamId: existing.id }, data: { teamId: null, team: null } }),
      prisma.team.delete({ where: { id: existing.id } })
    ]);

    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;