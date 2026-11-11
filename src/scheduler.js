const { randomBetween } = require('./humanize');

// Picks a random time inside the daily window, `daysFromNow` days out.
function pickNextRunTime(settings, fromDate = new Date(), daysFromNow = settings.intervalDays) {
  const start = Math.max(0, Math.min(23, Number(settings.windowStartHour)));
  const end = Math.max(start + 1, Math.min(24, Number(settings.windowEndHour)));
  const next = new Date(fromDate);
  next.setDate(next.getDate() + Number(daysFromNow));
  const minuteOfDay = Math.floor(randomBetween(start * 60, end * 60));
  next.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, Math.floor(randomBetween(0, 60)), 0);
  return next;
}

// When a run was missed (the PC was off), start a few minutes after launch instead of right away.
function pickCatchUpTime() {
  return new Date(Date.now() + randomBetween(3, 15) * 60 * 1000);
}

module.exports = { pickNextRunTime, pickCatchUpTime };
