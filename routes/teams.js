const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');
const { logAudit } = require('../utils/audit');
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
    await logAudit(req, {
      companyId: req.user.companyId, userId: req.user.userId, action: 'team.created',
      details: { equipeId: team.id, equipe: team.name }
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

    await logAudit(req, {
      companyId: req.user.companyId, userId: req.user.userId, action: 'team.updated',
      details: { equipeId: team.id, de: existing.name, vers: team.name }
    });
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

    await logAudit(req, {
      companyId: req.user.companyId, userId: req.user.userId, action: 'team.deleted',
      details: { equipeId: existing.id, equipe: existing.name }
    });
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;