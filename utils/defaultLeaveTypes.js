const DEFAULT_LEAVE_TYPES = [
  { code: 'CP', label: 'Congés payés', color: '#3B82F6', annualCap: 25 },
  { code: 'RTT', label: 'RTT', color: '#10B981', annualCap: 10 },
  { code: 'MAL', label: 'Arrêt maladie', color: '#c0392b', requiresProof: true },
  { code: 'EXC', label: 'Congé Exceptionnel', color: '#d97706', requiresProof: true, annualCap: 5 },
  { code: 'TT', label: 'Télétravail', color: '#7c3aed' },
  { code: 'CSS', label: 'Congé Sans Solde', color: '#94a3b8' }
];

// `client` peut être `prisma` ou le client d'une transaction (tx).
// skipDuplicates : si un type existe déjà dans cette société, il est ignoré.
function createDefaultLeaveTypes(client, companyId) {
  return client.leaveType.createMany({
    data: DEFAULT_LEAVE_TYPES.map(t => ({ ...t, companyId })),
    skipDuplicates: true
  });
}

module.exports = { DEFAULT_LEAVE_TYPES, createDefaultLeaveTypes };