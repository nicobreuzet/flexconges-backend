const prisma = require('../config/prisma');

// Sécurité : sans companyId, Prisma ignorerait le filtre et renverrait les données de toutes les sociétés
function requireCompanyId(companyId) {
  if (!Number.isInteger(companyId)) {
    throw new Error('companyId manquant : appel refusé pour éviter un mélange de sociétés');
  }
}

async function countWorkdays(startDate, endDate, companyId, startHalf = 'morning', endHalf = 'afternoon') {
  requireCompanyId(companyId);

  const holidays = await prisma.holiday.findMany({
    where: {
      companyId,
      date: { gte: new Date(startDate), lte: new Date(endDate) }
    }
  });
  const holidayDates = holidays.map(h => h.date.toISOString().split('T')[0]);

  const start = new Date(startDate);
  const end = new Date(endDate);
  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay) {
    const dayOfWeek = start.getDay();
    const dateStr = start.toISOString().split('T')[0];
    if (dayOfWeek === 0 || dayOfWeek === 6 || holidayDates.includes(dateStr)) {
      return 0;
    }
    if (startHalf === 'morning' && endHalf === 'afternoon') return 1;
    if (startHalf === 'afternoon' && endHalf === 'morning') return 0; // incohérent
    return 0.5; // matin→matin ou après-midi→après-midi
  }

  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    const dateStr = current.toISOString().split('T')[0];
    const isHoliday = holidayDates.includes(dateStr);

    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isHoliday) {
      const isFirst = current.toDateString() === start.toDateString();
      const isLast = current.toDateString() === end.toDateString();
      if (isFirst && startHalf === 'afternoon') {
        count += 0.5;
      } else if (isLast && endHalf === 'morning') {
        count += 0.5;
      } else {
        count += 1;
      }
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