import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBookingForCalendar,
  bangkokTimeToUtcCompact,
  generateGoogleCalendarUrl,
  generateIcsContent,
  escapeIcsText,
  foldIcsLine
} from '../src/utils/calendarUtils.js';

// ============================================================================
// 1. BANGKOK TO UTC CONVERSION TESTS
// ============================================================================
test('Bangkok UTC: Converts daytime 09:00 to 02:00:00Z', () => {
  const utc = bangkokTimeToUtcCompact('2026-09-10', '09:00');
  assert.equal(utc, '20260910T020000Z');
});

test('Bangkok UTC: Converts 12:00 to 05:00:00Z', () => {
  const utc = bangkokTimeToUtcCompact('2026-09-10', '12:00');
  assert.equal(utc, '20260910T050000Z');
});

test('Bangkok UTC: Converts 00:30 to previous UTC calendar date (17:30Z)', () => {
  const utc = bangkokTimeToUtcCompact('2026-09-10', '00:30');
  assert.equal(utc, '20260909T173000Z');
});

test('Bangkok UTC: Month boundary rollover (March 1 03:00 -> Feb 28 20:00Z)', () => {
  const utc = bangkokTimeToUtcCompact('2026-03-01', '03:00');
  assert.equal(utc, '20260228T200000Z');
});

test('Bangkok UTC: Year boundary rollover (Jan 1 02:00 -> Dec 31 previous year 19:00Z)', () => {
  const utc = bangkokTimeToUtcCompact('2026-01-01', '02:00');
  assert.equal(utc, '20251231T190000Z');
});

// ============================================================================
// 2. INVALID VALUES & FAIL-CLOSED GUARDS
// ============================================================================
test('Validation: Invalid calendar date (Feb 30) returns null', () => {
  assert.equal(bangkokTimeToUtcCompact('2026-02-30', '10:00'), null);
});

test('Validation: Invalid month (13) returns null', () => {
  assert.equal(bangkokTimeToUtcCompact('2026-13-01', '10:00'), null);
});

test('Validation: Invalid hour (24:00, 25:00) returns null', () => {
  assert.equal(bangkokTimeToUtcCompact('2026-09-10', '24:00'), null);
  assert.equal(bangkokTimeToUtcCompact('2026-09-10', '25:00'), null);
});

test('Validation: Invalid minute (10:60) returns null', () => {
  assert.equal(bangkokTimeToUtcCompact('2026-09-10', '10:60'), null);
});

test('Validation: Malformed strings return null', () => {
  assert.equal(bangkokTimeToUtcCompact('invalid', '10:00'), null);
  assert.equal(bangkokTimeToUtcCompact('2026-09-10', 'not-a-time'), null);
  assert.equal(bangkokTimeToUtcCompact(null, null), null);
});

test('Validation: normalizeBookingForCalendar fails closed on missing required fields', () => {
  // Missing booking code
  assert.equal(normalizeBookingForCalendar({ room_name: 'Room A', date: '2026-09-10', start_time: '09:00', end_time: '12:00' }), null);
  // Missing room name
  assert.equal(normalizeBookingForCalendar({ booking_code: 'BK-1', date: '2026-09-10', start_time: '09:00', end_time: '12:00' }), null);
  // Missing date
  assert.equal(normalizeBookingForCalendar({ booking_code: 'BK-1', room_name: 'Room A', start_time: '09:00', end_time: '12:00' }), null);
  // Missing start_time
  assert.equal(normalizeBookingForCalendar({ booking_code: 'BK-1', room_name: 'Room A', date: '2026-09-10', end_time: '12:00' }), null);
  // Missing end_time
  assert.equal(normalizeBookingForCalendar({ booking_code: 'BK-1', room_name: 'Room A', date: '2026-09-10', start_time: '09:00' }), null);
});

test('Validation: end_time <= start_time fails closed without guessing overnight', () => {
  assert.equal(normalizeBookingForCalendar({
    booking_code: 'BK-1',
    room_name: 'Room A',
    date: '2026-09-10',
    start_time: '12:00',
    end_time: '10:00'
  }), null);

  assert.equal(normalizeBookingForCalendar({
    booking_code: 'BK-1',
    room_name: 'Room A',
    date: '2026-09-10',
    start_time: '10:00',
    end_time: '10:00'
  }), null);
});

test('Normalization: Safely normalizes across field aliases', () => {
  const norm1 = normalizeBookingForCalendar({
    bookingCode: 'BK-000045',
    room: { name: 'Meeting Room A' },
    booking_date: '2026-09-10',
    start_time: '09:00',
    end_time: '12:00'
  });
  assert.equal(norm1.bookingCode, 'BK-000045');
  assert.equal(norm1.roomName, 'Meeting Room A');
  assert.equal(norm1.date, '2026-09-10');
  assert.equal(norm1.startTime, '09:00');
  assert.equal(norm1.endTime, '12:00');

  const norm2 = normalizeBookingForCalendar({
    id: 45,
    items: [{
      room_name: 'Boardroom',
      start_time: '2026-09-10T14:00:00',
      end_time: '2026-09-10T17:00:00'
    }]
  });
  assert.equal(norm2.bookingCode, 'BK-000045');
  assert.equal(norm2.roomName, 'Boardroom');
  assert.equal(norm2.date, '2026-09-10');
  assert.equal(norm2.startTime, '14:00');
  assert.equal(norm2.endTime, '17:00');
});

// ============================================================================
// 3. GOOGLE CALENDAR URL GENERATION
// ============================================================================
test('Google Calendar: Generates correct template URL with URLSearchParams', () => {
  const booking = {
    booking_code: 'BK-000045',
    room_name: 'Meeting Room A',
    date: '2026-09-10',
    start_time: '09:00',
    end_time: '12:00'
  };

  const urlString = generateGoogleCalendarUrl(booking);
  assert.ok(urlString);
  assert.ok(urlString.startsWith('https://calendar.google.com/calendar/render?'));

  const parsed = new URL(urlString);
  assert.equal(parsed.searchParams.get('action'), 'TEMPLATE');
  assert.equal(parsed.searchParams.get('text'), 'B-WORK - Meeting Room A');
  assert.equal(parsed.searchParams.get('dates'), '20260910T020000Z/20260910T050000Z');
  assert.equal(parsed.searchParams.get('ctz'), 'Asia/Bangkok');
  assert.equal(parsed.searchParams.get('location'), 'B-WORK Coworking Space & Meeting Rooms (ชั้น 3)');
  assert.ok(parsed.searchParams.get('details').includes('BK-000045'));
  assert.ok(parsed.searchParams.get('details').includes('10/09/2026'));
  assert.ok(parsed.searchParams.get('details').includes('09:00 - 12:00 น.'));
});

// ============================================================================
// 4. RFC 5545 ESCAPING & LINE FOLDING
// ============================================================================
test('RFC 5545: Escapes backslashes, semicolons, commas, and newlines', () => {
  const raw = 'Text with \\backslash, comma, ;semicolon\nand newline\r\nand CRLF';
  const escaped = escapeIcsText(raw);
  assert.equal(escaped, 'Text with \\\\backslash\\, comma\\, \\;semicolon\\nand newline\\nand CRLF');
});

test('RFC 5545 Line Folding: Every physical line is <= 75 UTF-8 octets with Thai text', () => {
  const thaiLine = 'SUMMARY:B-WORK - ห้องประชุม A (ชั้น 3) สำหรับการจัดประชุมคณะกรรมการบริษัทและผู้บริหารระดับสูง';
  const folded = foldIcsLine(thaiLine, 75);

  const encoder = new TextEncoder();
  const physicalLines = folded.split('\r\n');

  assert.ok(physicalLines.length > 1, 'Long Thai text must fold into multiple lines');

  physicalLines.forEach((line, idx) => {
    const bytes = encoder.encode(line).length;
    assert.ok(bytes <= 75, `Line ${idx + 1} has ${bytes} bytes (expected <= 75)`);
    if (idx > 0) {
      assert.ok(line.startsWith(' '), `Continuation line ${idx + 1} must begin with space`);
    }
  });

  // Verify unfolding recovers the exact original string
  const unfolded = folded.replace(/\r\n /g, '');
  assert.equal(unfolded, thaiLine);
});

// ============================================================================
// 5. ICS CONTENT GENERATION
// ============================================================================
test('ICS: Generates compliant VCALENDAR + VEVENT with deterministic UID and UTC times', () => {
  const booking = {
    booking_code: 'BK-000045',
    room_name: 'ห้องประชุม บิลท์ ฮาร์ท A',
    date: '2026-09-10',
    start_time: '09:00',
    end_time: '12:00'
  };

  const ics = generateIcsContent(booking, { now: '2026-09-09T06:00:00.000Z' });
  assert.ok(ics);

  // CRLF line endings
  assert.ok(ics.includes('\r\n'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));

  assert.ok(ics.includes('VERSION:2.0\r\n'));
  assert.ok(ics.includes('PRODID:-//Bwork POS//Booking App//TH\r\n'));
  assert.ok(ics.includes('CALSCALE:GREGORIAN\r\n'));
  assert.ok(ics.includes('METHOD:PUBLISH\r\n'));
  assert.ok(ics.includes('BEGIN:VEVENT\r\n'));
  assert.ok(ics.includes('UID:bwork-booking-BK-000045-20260910@bwork.local\r\n'));
  assert.ok(ics.includes('DTSTAMP:20260909T060000Z\r\n'));
  assert.ok(ics.includes('DTSTART:20260910T020000Z\r\n'));
  assert.ok(ics.includes('DTEND:20260910T050000Z\r\n'));
  assert.ok(ics.includes('STATUS:CONFIRMED\r\n'));
  assert.ok(ics.includes('END:VEVENT\r\n'));
});

// ============================================================================
// 6. PRIVACY & SECURITY GUARDRAIL ASSERTIONS
// ============================================================================
test('Privacy: Neither Google Calendar URL nor ICS contains sensitive PII, tokens, PIN, or payment data', () => {
  const sensitiveBooking = {
    booking_code: 'BK-000045',
    room_name: 'VIP Meeting Room',
    date: '2026-09-10',
    start_time: '09:00',
    end_time: '12:00',
    // Sensitive fields that MUST NOT leak into calendar outputs:
    customer_name: 'นายสมชาย ใจดี',
    customer_contact: '0812345678',
    contact: '0812345678',
    customer_email: 'somchai.confidential@example.com',
    email: 'somchai.confidential@example.com',
    tax_id: '0105554000401',
    tax_name: 'บริษัท ซีเคร็ท จำกัด',
    tax_address: '99/9 หมู่ 1 อาคารลับ กทม 10110',
    pin_code: '987654',
    pinCode: '987654',
    qr_token: 'SUPER_SECRET_QR_TOKEN_123',
    accessToken: 'SECRET_JWT_ACCESS_TOKEN_XYZ',
    slip_trans_ref: '016252094403AOR06770',
    slip_image_url: 'https://r2.bwork.co/slips/slip_12345.jpg',
    promptpay_number: '0125554000401',
    account_number: '329-1-38429-0',
    internal_notes: 'VIP customer requested extra coffee'
  };

  const gCalUrl = generateGoogleCalendarUrl(sensitiveBooking);
  const icsContent = generateIcsContent(sensitiveBooking);

  assert.ok(gCalUrl);
  assert.ok(icsContent);

  const sensitiveValues = [
    '0812345678',
    'somchai.confidential@example.com',
    '0105554000401',
    'บริษัท ซีเคร็ท จำกัด',
    'อาคารลับ',
    '987654',
    'SUPER_SECRET_QR_TOKEN_123',
    'SECRET_JWT_ACCESS_TOKEN_XYZ',
    '016252094403AOR06770',
    'slip_12345',
    '329-1-38429-0',
    'extra coffee'
  ];

  for (const secret of sensitiveValues) {
    assert.ok(!gCalUrl.includes(secret), `Google Calendar URL must not leak: ${secret}`);
    assert.ok(!icsContent.includes(secret), `ICS content must not leak: ${secret}`);
  }
});
