const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { createDefaultLeaveTypes } = require('../utils/defaultLeaveTypes');
const { sendMail } = require('../config/mailer');

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

// Demande de réinitialisation : envoie un lien à usage unique, valable 15 minutes
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obligatoire' });

    // Toujours la même réponse, que l'e-mail existe ou non : on ne révèle jamais
    // si une adresse est enregistrée.
    const genericResponse = { message: 'Si cet e-mail existe, un lien de réinitialisation a été envoyé.' };

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json(genericResponse);

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpires: expires }
    });

    // Affiché dans la console du serveur, pratique pour les tests sans avoir à ouvrir l'e-mail
    if (process.env.FRONT_URL) {
      console.log(`Lien de réinitialisation pour ${email} : ${process.env.FRONT_URL}?resetToken=${token} (valable 15 min)`);
    } else {
      console.log(`Jeton de réinitialisation pour ${email} : ${token} (valable 15 min, FRONT_URL non défini)`);
    }

    sendMail(
      email,
      'Réinitialisation de votre mot de passe FlexCongés',
      `Voici votre lien de réinitialisation (valable 15 minutes) :\n\n${process.env.FRONT_URL || '(URL non configurée)'}?resetToken=${token}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`
    ).catch(err => console.error('Erreur envoi email:', err));

    res.json(genericResponse);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Finalise la réinitialisation : vérifie le jeton, puis change le mot de passe
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Jeton et mot de passe obligatoires' });

    if (password.length < 12 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 12 caractères, une majuscule, un chiffre et un caractère spécial'
      });
    }

    const user = await prisma.user.findUnique({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
      return res.status(400).json({ error: 'Lien invalide ou expiré' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, resetToken: null, resetTokenExpires: null }
    });

    res.json({ message: 'Mot de passe mis à jour' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;