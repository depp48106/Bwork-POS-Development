// B-WORK Booking App Calendar Utilities
// 100% Client-side Google Calendar URL & RFC 5545 iCalendar (.ics) generation.
// No Google API, No OAuth, No Paid Services, Zero Customer PII leakage.

const UTF8_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/**
 * Normalizes and validates booking input safely.
 * Returns a clean, validated object or null if any required field is missing/invalid.
 */
export function normalizeBookingForCalendar(booking) {
  if (!booking || typeof booking !== 'object') return null;

  // 1. Booking code / ID
  const rawCode = booking.booking_code
    || booking.bookingCode
    || booking.receipt_number
    || booking.receiptNumber
    || (booking.id ? `BK-${String(booking.id).padStart(6, '0')}` : null)
    || (booking.booking_id ? `BK-${String(booking.booking_id).padStart(6, '0')}` : null);

  if (!rawCode || typeof rawCode !== 'string' || !rawCode.trim()) return null;
  const bookingCode = rawCode.trim();

  // 2. Room Name
  const rawRoom = booking.room_name
    || booking.roomName
    || booking.room?.name
    || (Array.isArray(booking.items) && booking.items[0]?.room_name)
    || null;

  if (!rawRoom || typeof rawRoom !== 'string' || !rawRoom.trim()) return null;
  const roomName = rawRoom.trim();

  // 3. Booking Date (YYYY-MM-DD)
  const rawDate = booking.date
    || booking.booking_date
    || (Array.isArray(booking.items) && booking.items[0]?.start_time?.split('T')[0])
    || null;

  if (!rawDate || typeof rawDate !== 'string') return null;
  const cleanDate = rawDate.trim().split('T')[0].split(' ')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return null;

  const [y, m, d] = cleanDate.split('-').map(Number);
  if (y < 2020 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;

  // Verify calendar day validity (e.g. Feb 30 check)
  const dateCheck = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (dateCheck.getUTCFullYear() !== y || dateCheck.getUTCMonth() !== m - 1 || dateCheck.getUTCDate() !== d) {
    return null;
  }

  // 4. Start Time & End Time (HH:mm)
  const rawStart = booking.start_time
    || booking.startTime
    || (Array.isArray(booking.items) && booking.items[0]?.start_time?.includes('T')
      ? booking.items[0].start_time.split('T')[1].substring(0, 5)
      : null);

  const rawEnd = booking.end_time
    || booking.endTime
    || (Array.isArray(booking.items) && booking.items[0]?.end_time?.includes('T')
      ? booking.items[0].end_time.split('T')[1].substring(0, 5)
      : null);

  if (!rawStart || !rawEnd || typeof rawStart !== 'string' || typeof rawEnd !== 'string') return null;

  const startTime = rawStart.trim().substring(0, 5);
  const endTime = rawEnd.trim().substring(0, 5);

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return null;

  // Ensure end_time > start_time (B-WORK bookings operate on same-day business hours)
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (endMinutes <= startMinutes) {
    return null; // fail closed: do not invent overnight guessing
  }

  return {
    bookingCode,
    roomName,
    date: cleanDate,
    startTime,
    endTime
  };
}

/**
 * Converts a Bangkok local wall-clock date (YYYY-MM-DD) and time (HH:mm) to UTC compact string.
 * Bangkok is strictly UTC+07:00 (no Daylight Saving Time).
 * Output format: YYYYMMDDTHHmmssZ
 */
export function bangkokTimeToUtcCompact(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) return null;

  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);

  // Validate calendar date
  const testDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (testDate.getUTCFullYear() !== y || testDate.getUTCMonth() !== m - 1 || testDate.getUTCDate() !== d) {
    return null;
  }

  // Subtract 7 hours to convert Bangkok local time (UTC+7) to UTC
  const utcMs = Date.UTC(y, m - 1, d, h - 7, min, 0);
  const utcDate = new Date(utcMs);

  const uy = utcDate.getUTCFullYear();
  const um = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const ud = String(utcDate.getUTCDate()).padStart(2, '0');
  const uh = String(utcDate.getUTCHours()).padStart(2, '0');
  const umin = String(utcDate.getUTCMinutes()).padStart(2, '0');

  return `${uy}${um}${ud}T${uh}${umin}00Z`;
}

/**
 * Formats a Date object to UTC compact format: YYYYMMDDTHHmmssZ
 */
function dateToUtcCompact(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

/**
 * Computes UTF-8 byte length safely in both Browser and Node.js.
 */
function getUtf8ByteLength(str) {
  if (!str) return 0;
  if (UTF8_ENCODER) {
    return UTF8_ENCODER.encode(str).length;
  }
  // Fallback if TextEncoder is absent
  return unescape(encodeURIComponent(str)).length;
}

/**
 * Escapes special characters for RFC 5545 iCalendar TEXT values.
 * \ -> \\
 * ; -> \;
 * , -> \,
 * \r?\n -> \n
 */
export function escapeIcsText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Folds an iCalendar property line to a maximum of 75 UTF-8 octets (bytes) per physical line.
 * Continuation lines begin with a single SPACE (1 octet).
 * Never splits a multi-byte UTF-8 character.
 */
export function foldIcsLine(line, maxOctets = 75) {
  if (!line) return '';
  if (getUtf8ByteLength(line) <= maxOctets) return line;

  const characters = Array.from(line);
  const physicalLines = [];
  let currentLine = '';

  for (const char of characters) {
    const candidate = currentLine ? currentLine + char : char;
    if (getUtf8ByteLength(candidate) <= maxOctets) {
      currentLine = candidate;
    } else {
      if (currentLine) {
        physicalLines.push(currentLine);
      }
      // Start continuation line with a single space (1 byte)
      currentLine = ' ' + char;
    }
  }

  if (currentLine) {
    physicalLines.push(currentLine);
  }

  return physicalLines.join('\r\n');
}

/**
 * Generates a direct Google Calendar template URL from booking data.
 * Returns null if booking data is incomplete or invalid.
 */
export function generateGoogleCalendarUrl(booking) {
  const norm = normalizeBookingForCalendar(booking);
  if (!norm) return null;

  const startUtc = bangkokTimeToUtcCompact(norm.date, norm.startTime);
  const endUtc = bangkokTimeToUtcCompact(norm.date, norm.endTime);
  if (!startUtc || !endUtc) return null;

  const title = `B-WORK - ${norm.roomName}`;
  const location = 'B-WORK Coworking Space & Meeting Rooms (ชั้น 3)';

  const [y, m, d] = norm.date.split('-');
  const formattedDate = `${d}/${m}/${y}`;

  const details = [
    `รหัสการจอง: ${norm.bookingCode}`,
    `ห้องประชุม: ${norm.roomName}`,
    `วันที่: ${formattedDate}`,
    `เวลา: ${norm.startTime} - ${norm.endTime} น. (เวลาประเทศไทย)`,
    '',
    'โปรดตรวจสอบข้อความยืนยันจาก B-WORK สำหรับรายละเอียดการเข้าใช้งานห้อง'
  ].join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${startUtc}/${endUtc}`,
    ctz: 'Asia/Bangkok',
    location,
    details
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generates RFC 5545-compliant iCalendar (.ics) UTF-8 string.
 * Uses UTC timestamps ending in Z, CRLF line endings, and 75-octet line folding.
 * Returns null if booking data is incomplete or invalid.
 */
export function generateIcsContent(booking, options = {}) {
  const norm = normalizeBookingForCalendar(booking);
  if (!norm) return null;

  const startUtc = bangkokTimeToUtcCompact(norm.date, norm.startTime);
  const endUtc = bangkokTimeToUtcCompact(norm.date, norm.endTime);
  if (!startUtc || !endUtc) return null;

  const now = options.now ? new Date(options.now) : new Date();
  const dtstamp = dateToUtcCompact(now);
  const uid = `bwork-booking-${norm.bookingCode}-${norm.date.replace(/-/g, '')}@bwork.local`;

  const summary = `B-WORK - ${norm.roomName}`;
  const location = 'B-WORK Coworking Space & Meeting Rooms (ชั้น 3)';

  const [y, m, d] = norm.date.split('-');
  const formattedDate = `${d}/${m}/${y}`;

  const description = [
    `รหัสการจอง: ${norm.bookingCode}`,
    `ห้องประชุม: ${norm.roomName}`,
    `วันที่: ${formattedDate}`,
    `เวลา: ${norm.startTime} - ${norm.endTime} น.`,
    'โปรดตรวจสอบข้อความยืนยันจาก B-WORK สำหรับรายละเอียดการเข้าใช้งานห้อง'
  ].join('\n');

  const logicalLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bwork POS//Booking App//TH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  const folded = logicalLines.map(line => foldIcsLine(line));
  return folded.join('\r\n') + '\r\n';
}

/**
 * Triggers a browser download of the .ics file.
 * Returns { success: true } or { success: false, error: string } for graceful UI fallback.
 */
export function downloadIcsFile(booking) {
  const icsContent = generateIcsContent(booking);
  if (!icsContent) {
    return { success: false, error: 'ข้อมูลการจองไม่ครบถ้วน ไม่สามารถสร้างไฟล์ปฏิทินได้' };
  }

  const norm = normalizeBookingForCalendar(booking);
  const filename = `bwork-booking-${norm?.bookingCode || 'calendar'}.ics`;

  try {
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });

    if (typeof window !== 'undefined' && window.URL && typeof window.URL.createObjectURL === 'function') {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        window.URL.revokeObjectURL(url);
      }, 500);

      return { success: true };
    }

    return {
      success: false,
      error: 'เบราว์เซอร์ไม่รองรับการดาวน์โหลดไฟล์โดยตรง กรุณาใช้ปุ่มเพิ่มลง Google Calendar'
    };
  } catch (err) {
    console.warn('ICS download error:', err);
    return {
      success: false,
      error: 'ไม่สามารถดาวน์โหลดไฟล์ได้ในเบราว์เซอร์นี้ กรุณาใช้ปุ่มเพิ่มลง Google Calendar'
    };
  }
}
