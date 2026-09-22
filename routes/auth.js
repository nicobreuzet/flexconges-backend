const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { createDefaultLeaveTypes } = require('../utils/defaultLeaveTypes');

const router = express.Router();

// Inscription d'une NOUVELLE société : crée la société + son premier manager
router.post('/register', async (req, res) => {
  try {
    const { companyName, email, password, firstName, lastName } = req.body;

    if (!companyName || !email || !password || !firstName || !lastName) {
      return res.status(400).json({
        error: 'Société, e-mail, mot de passe, prénom et nom sont obligatoires'
      });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const year = new Date().getFullYear();

    // Tout ou rien : si une étape échoue, rien n'est créé
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: companyName } });

      await createDefaultLeaveTypes(tx, company.id);

      // Le rôle est imposé côté serveur : le premier utilisateur est toujours manager
      const user = await tx.user.create({
        data: {
          email, password: hashedPassword, firstName, lastName,
          role: 'manager', companyId: company.id
        }
      });

      // Soldes initiaux CP et RTT du manager
      const types = await tx.leaveType.findMany({
        where: { companyId: company.id, code: { in: ['CP', 'RTT'] } }
      });
      for (const t of types) {
        await tx.leaveBalance.create({
          data: {
            userId: user.id, leaveTypeId: t.id, year,
            companyId: company.id, allocated: t.annualCap ?? 0
          }
        });
      }

      return { company, user };
    });

    const { password: _, ...userWithoutPassword } = result.user;
    res.status(201).json({ company: result.company, user: userWithoutPassword });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const token = jwt.sign(
      { userId: user.id, role: user.role, companyId: user.companyId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;