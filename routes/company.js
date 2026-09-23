const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireManager } = require('../middlewares/auth');

const router = express.Router();

const ALLOWED_FIELDS = ['sector', 'siret', 'barreau', 'convention', 'taille', 'pays', 'adresse'];

router.patch('/company', authenticate, requireManager, async (req, res) => {
  try {
    const data = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) data[field] = req.body[field] || null;
    }

    const company = await prisma.company.update({
      where: { id: req.user.companyId },
      data
    });

    res.json(company);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;