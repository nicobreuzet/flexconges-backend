const prisma = require('../config/prisma');

// Nombre d'autres responsables actifs dans la societe (le responsable donne est exclu).
// Sert a decider si un responsable peut valider sa propre demande : oui seulement
// s'il n'y a personne d'autre pour le faire.
async function countOtherActiveManagers(companyId, userId) {
  return prisma.user.count({
    where: { companyId, role: 'manager', isActive: true, id: { not: userId } }
  });
}

module.exports = { countOtherActiveManagers };