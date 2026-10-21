/**
 * thaiDateHelper.js
 * Central Thai Buddhist Era (พ.ศ.) Date Formatting & Calendar Utility for BWORK-POS
 *
 * Rules:
 * - Gregorian year + 543 = Buddhist Era (B.E.)
 * - Timezone: Asia/Bangkok (UTC+7)
 * - Safe string-based parser for 'YYYY-MM-DD' to prevent UTC/local timezone off-by-one shifts
 * - Display format: DD/MM/BBBB (e.g. 21/10/2569)
 */

export const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

export const THAI_WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/**
 * Checks if a given CE year, month (1-12), and day (1-31) is valid.
 */
export function isValidDate(ceYear, month, day) {
  if (!ceYear || !month || !day) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(ceYear, month - 1, day);
  return d.getFullYear() === ceYear && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Returns the number of days in a given CE year and month (1-12).
 */
export function getDaysInMonth(ceYear, month) {
  return new Date(ceYear, month, 0).getDate();
}

/**
 * Converts CE year to Buddhist Era (B.E.) year.
 */
export function toBuddhistYear(ceYear) {
  return parseInt(ceYear, 10) + 543;
}

/**
 * Converts Buddhist Era (B.E.) year to CE year.
 */
export function toGregorianYear(beYear) {
  return parseInt(beYear, 10) - 543;
}

/**
 * Parses user input in DD/MM/BBBB into ISO string 'YYYY-MM-DD'.
 * Returns null if invalid or incomplete.
 */
export function parseThaiDateInput(inputStr) {
  if (!inputStr) return null;
  const cleaned = inputStr.trim().replace(/[^0-9/]/g, '');
  const parts = cleaned.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const beYear = parseInt(parts[2], 10);
    if (!isNaN(day) && !isNaN(month) && !isNaN(beYear)) {
      const ceYear = beYear - 543;
      if (month >= 1 && month <= 12 && isValidDate(ceYear, month, day)) {
        return `${ceYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

/**
 * Formats an ISO date string (YYYY-MM-DD or full ISO string) into DD/MM/BBBB (Thai Buddhist Era).
 * @param {string|Date} dateVal - Date string or Date object
 * @returns {string} Formatted date string in DD/MM/BBBB or '-' if invalid
 */
export function formatThaiDate(dateVal) {
  if (!dateVal) return '-';

  // If string starts with YYYY-MM-DD, parse year, month, day directly
  // This avoids any JavaScript Date UTC/local midnight timezone shifts
  const str = typeof dateVal === 'string' ? dateVal.trim() : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
  const isoDateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoDateMatch) {
    const year = parseInt(isoDateMatch[1], 10);
    const month = isoDateMatch[2];
    const day = isoDateMatch[3];
    const beYear = year + 543;
    return `${day}/${month}/${beYear}`;
  }

  // Fallback for timestamps or arbitrary date formats using Intl.DateTimeFormat
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    const formatter = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    return formatter.format(d);
  } catch (e) {
    return String(dateVal);
  }
}

/**
 * Formats a date/timestamp into Thai Buddhist Era with time: DD/MM/BBBB HH:mm
 * @param {string|Date} dateVal - Date string or timestamp
 * @returns {string} Formatted date & time string or '-'
 */
export function formatThaiDateTime(dateVal) {
  if (!dateVal) return '-';

  try {
    // Check if it's already an SQLite timestamp 'YYYY-MM-DD HH:MM:SS'
    const sqlMatch = String(dateVal).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (sqlMatch) {
      const year = parseInt(sqlMatch[1], 10);
      const month = sqlMatch[2];
      const day = sqlMatch[3];
      const hours = sqlMatch[4];
      const minutes = sqlMatch[5];
      const beYear = year + 543;
      return `${day}/${month}/${beYear} ${hours}:${minutes}`;
    }

    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);

    const formatter = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return formatter.format(d);
  } catch (e) {
    return String(dateVal);
  }
}

/**
 * Returns helper description text for native HTML date inputs or badges
 * @param {string} isoDate - YYYY-MM-DD
 * @returns {string} e.g. "พ.ศ. 2569 (21/10/2569)"
 */
export function getThaiDateInputHint(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate.trim())) {
    return 'ระบุวันที่ในปฏิทิน';
  }
  const formatted = formatThaiDate(isoDate);
  return `ตรงกับ พ.ศ. ${formatted}`;
}
