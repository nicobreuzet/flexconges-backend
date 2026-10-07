const express = require('express');
const prisma = require('../config/prisma');
const { authenticate } = require('../middlewares/auth');
const { revokeUserSessions } = require('../utils/sessions');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// Mes sessions encore actives (non révoquées et pas inactives depuis plus de 8 h).
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const limit = new Date(Date.now() - req.securityConfig.sessionInactivityHours * 60 * 60 * 1000);
    const sessions = await prisma.session.findMany({
      where: { userId: req.user.userId, revokedAt: null, lastSeenAt: { gte: limit } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true }
    });
    res.json(sessions.map(s => ({ ...s, current: s.id === req.user.sid })));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Révoque UNE de mes sessions. Une session qui n'est pas à moi répond "introuvable".
router.delete('/sessions/:id', authenticate, async (req, res) => {
  try {
    const session = await prisma.session.findFirst({
      where: { id: req.params.id, userId: req.user.userId, revokedAt: null }
    });
    if (!session) return res.status(404).json({ error: 'Session introuvable' });

    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await logAudit(req, { companyId: req.user.companyId, userId: req.user.userId, action: 'session.revoked', details: { actuelle: session.id === req.user.sid } });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Révoque toutes mes sessions SAUF celle que j'utilise en ce moment.
router.post('/sessions/revoke-others', authenticate, async (req, res) => {
  try {
    const count = await revokeUserSessions(req.user.userId, req.user.sid);
    await logAudit(req, { companyId: req.user.companyId, userId: req.user.userId, action: 'session.revoked_others', details: { nombre: count } });
    res.json({ success: true, revoked: count });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Déconnexion : ferme la session courante côté serveur.
router.post('/logout', authenticate, async (req, res) => {
  try {
    await prisma.session.updateMany({
      where: { id: req.user.sid, userId: req.user.userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    await logAudit(req, { companyId: req.user.companyId, userId: req.user.userId, action: 'logout' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
