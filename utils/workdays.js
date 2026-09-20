const prisma = require('../config/prisma');

async function countWorkdays(startDate, endDate) {
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: new Date(startDate), lte: new Date(endDate) } }
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

async function hasOverlappingRequest(userId, startDate, endDate) {
  const overlapping = await prisma.leaveRequest.findFirst({
    where: {
      userId,
      status: { in: ['pending', 'approved'] },
      startDate: { lte: new Date(endDate) },
      endDate: { gte: new Date(startDate) }
    }
  });
  return overlapping !== null;
}

module.exports = { countWorkdays, hasOverlappingRequest };