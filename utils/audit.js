const prisma = require('../config/prisma');

// Écrit une ligne dans le journal d'audit.
// Elle N'ÉCHOUE JAMAIS : si la base du journal tombe en panne, la requête de l'utilisateur
// (connexion, activation du 2FA...) doit quand même aboutir.
//
// Règle absolue pour `details` : jamais de mot de passe, de code 2FA, de code de
// récupération, de jeton ni de secret. Uniquement des informations utiles à un humain.
async function logAudit(req, { companyId, userId = null, action, details = null }) {
  try {
    if (!companyId || !action) return;
    await prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action,
        details: details || undefined,
        ip: req.ip || null,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null
      }
    });
  } catch (error) {
    console.error("Erreur du journal d'audit :", error.message);
  }
}

module.exports = { logAudit };