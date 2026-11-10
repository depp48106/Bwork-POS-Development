// Booking times are Bangkok wall-clock values. UTC arithmetic here keeps calendar
// and slot calculations independent of the server or browser's local timezone.
const MINUTE_MS = 60_000;
const SLOT_MS = 30 * MINUTE_MS;
export const ROOM_OPEN_TIME = '08:00';
export const ROOM_CLOSE_TIME = '18:00';

function civilTime(value) {
  return Date.parse(`${value}Z`);
}

export function getAvailabilityMonth(month, offset = 0) {
  if (typeof month !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const start = new Date(`${month}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + offset);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const startIso = start.toISOString();
  const nextIso = next.toISOString();
  if (!/^[1-9]/.test(startIso) || startIso.length !== 24 || nextIso.length !== 24) return null;
  return {
    month: startIso.slice(0, 7),
    start: startIso.slice(0, 19),
    end: nextIso.slice(0, 19),
    days: new Date(next.getTime() - MINUTE_MS).getUTCDate(),
    firstWeekday: (start.getUTCDay() + 6) % 7
  };
}

export function getRoomAvailabilityForDay(day, bookings, bufferMinutes) {
  const opens = civilTime(`${day}T${ROOM_OPEN_TIME}:00`);
  const closes = civilTime(`${day}T${ROOM_CLOSE_TIME}:00`);
  const buffer = bufferMinutes * MINUTE_MS;
  const blocked = bookings.map(({ start, end }) => [civilTime(start) - buffer, civilTime(end) + buffer])
    .filter(([start, end]) => start < closes && end > opens && start < end)
    .sort(([first], [second]) => first - second);
  const ranges = [];
  let cursor = opens;

  function addRange(from, to) {
    const roundedStart = Math.ceil(from / SLOT_MS) * SLOT_MS;
    const roundedEnd = Math.floor(to / SLOT_MS) * SLOT_MS;
    if (roundedStart < roundedEnd) {
      ranges.push({ start: new Date(roundedStart).toISOString().slice(11, 16), end: new Date(roundedEnd).toISOString().slice(11, 16) });
    }
  }

  for (const [start, end] of blocked) {
    addRange(cursor, Math.min(start, closes));
    cursor = Math.max(cursor, end);
  }
  addRange(cursor, closes);

  const allDay = ranges.length === 1 && ranges[0].start === ROOM_OPEN_TIME && ranges[0].end === ROOM_CLOSE_TIME;
  return { ranges, status: allDay ? 'free' : ranges.length ? 'partial' : 'full' };
}
