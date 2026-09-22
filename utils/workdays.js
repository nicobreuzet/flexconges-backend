const prisma = require('../config/prisma');

// Sécurité : sans companyId, Prisma ignorerait le filtre et renverrait les données de toutes les sociétés
function requireCompanyId(companyId) {
  if (!Number.isInteger(companyId)) {
    throw new Error('companyId manquant : appel refusé pour éviter un mélange de sociétés');
  }
}

async function countWorkdays(startDate, endDate, companyId) {
  requireCompanyId(companyId);

  const holidays = await prisma.holiday.findMany({
    where: {
      companyId,
      date: { gte: new Date(startDate), lte: new Date(endDate) }
    }
  });
  const holidayDates = holidays.map(h => h.date.toISOString().split('T')[0]);

  let count = 0;
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    const currentDateStr = current.toISOString().split('T')[0];

    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.includes(currentDateStr)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

async function hasOverlappingRequest(userId, startDate, endDate, companyId) {
  requireCompanyId(companyId);

  const overlapping = await prisma.leaveRequest.findFirst({
    where: {
      userId,
      companyId,
      status: { in: ['pending', 'approved'] },
      startDate: { lte: new Date(endDate) },
      endDate: { gte: new Date(startDate) }
    }
  });
  return overlapping !== null;
}

module.exports = { countWorkdays, hasOverlappingRequest };