/**
 * Pure Asia/Bangkok (UTC+7, year-round, no DST) date and time utilities.
 * Immune to client device/browser timezone differences.
 */

export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
export const BUSINESS_OPEN_MINS = 8 * 60; // 08:00
export const BUSINESS_CLOSE_MINS = 18 * 60; // 18:00 (end time only)
export const ONLINE_BOOKING_OPEN_MINS = 7 * 60; // 07:00
export const ONLINE_BOOKING_CLOSE_MINS = 20 * 60; // 20:00
export const ONLINE_CLOSED_MESSAGE = 'ขณะนี้ปิดรับจองออนไลน์ เปิดรับจองอีกครั้งเวลา 07:00 น.';

/**
 * Checks whether online booking creation is currently open in Asia/Bangkok.
 * Allowed: 07:00 <= time < 20:00 (420 <= minutes < 1200).
 * @param {number} [nowMs=Date.now()]
 */
export function isOnlineBookingOpen(nowMs = Date.now()) {
  const bkk = getBangkokNow(nowMs);
  const isOpen = bkk.minutes >= ONLINE_BOOKING_OPEN_MINS && bkk.minutes < ONLINE_BOOKING_CLOSE_MINS;
  return {
    isOpen,
    message: isOpen ? '' : ONLINE_CLOSED_MESSAGE,
    minutes: bkk.minutes,
    hours: bkk.hours,
    minsOfHour: bkk.minsOfHour
  };
}

/**
 * Returns current date/time components in Asia/Bangkok.
 * @param {number} [nowMs=Date.now()]
 */
export function getBangkokNow(nowMs = Date.now()) {
  const bkk = new Date(nowMs + BANGKOK_OFFSET_MS);
  const year = bkk.getUTCFullYear();
  const month = bkk.getUTCMonth() + 1;
  const day = bkk.getUTCDate();
  const hours = bkk.getUTCHours();
  const minsOfHour = bkk.getUTCMinutes();
  const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const tomorrow = new Date(nowMs + BANGKOK_OFFSET_MS + 24 * 60 * 60 * 1000);
  const tomorrowIso = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;
  return {
    dateIso,
    tomorrowIso,
    monthKey: dateIso.slice(0, 7),
    hours,
    minsOfHour,
    minutes: hours * 60 + minsOfHour
  };
}

/**
 * Computes the earliest selectable 30-minute start slot (in minutes from 00:00)
 * for today in Asia/Bangkok.
 * Examples:
 * - 07:59 (479) -> 480 (08:00)
 * - 08:00 (480) -> 510 (08:30)
 * - 10:17 (617) -> 630 (10:30)
 * - 17:30 (1050) -> 1080 (18:00, no start slots left)
 */
export function getMinStartMinutesToday(bkkMinutes) {
  return Math.max(BUSINESS_OPEN_MINS, Math.ceil((bkkMinutes + 1) / 30) * 30);
}

/**
 * Formats minutes since 00:00 to 'HH:MM'.
 */
export function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Checks whether a given booking date + start_time ('HH:MM') is strictly in the future
 * relative to current Asia/Bangkok wall-clock time.
 */
export function isStartTimePastBangkok(bookingDateIso, startTimeHHMM, nowMs = Date.now()) {
  if (!bookingDateIso || !startTimeHHMM) return true;
  const bkk = getBangkokNow(nowMs);
  if (bookingDateIso < bkk.dateIso) return true;
  if (bookingDateIso > bkk.dateIso) return false;
  const [sH, sM] = startTimeHHMM.slice(0, 5).split(':').map(Number);
  if (isNaN(sH) || isNaN(sM)) return true;
  return (sH * 60 + sM) <= bkk.minutes;
}
