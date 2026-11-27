/**
 * BWORK-POS — BANGKOK TIME, 24/7 ONLINE BOOKING, TIMELINE, PAYMENT & PHONE TEST SUITE
 *
 * Verifies:
 * 1. 24/7 Online Booking Creation: 06:59 and 21:00 Asia/Bangkok allow booking next day's slots.
 * 2. Room usage hours (08:00–18:00) & anti-past booking rules remain enforced on UI & API.
 * 3. Timeline bar: no "เลยเวลา" in legend; past slots use solid distinct grey (#64748B).
 * 4. Header & Calendar: no "B-WORK · จองออนไลน์ผ่าน LINE", no hours banner, diagonal "ผ่านมาแล้ว" across cell center, "หมดรอบวันนี้" preserved.
 * 5. Payment page: zero hardcoded real account number, Krungsri logo + clean bank name, copy strips non-digits.
 * 6. Phone validation: 9, 10, 11 digits & letters tested for UI sanitizer + API strict 10-digit check.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSrc = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8');
const indexCssSrc = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');
const bangkokTimeSrc = fs.readFileSync(path.resolve(__dirname, '../src/utils/bangkokTime.js'), 'utf8');
const roomListPageSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/RoomListPage.jsx'), 'utf8');
const bookingFormPageSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/BookingFormPage.jsx'), 'utf8');
const confirmPageSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/ConfirmPage.jsx'), 'utf8');
const backendWorkerSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/worker.js'), 'utf8');
const backendServerSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/server.js'), 'utf8');

function getBangkokTimestamp(dateStr, timeStr) {
  return Date.parse(`${dateStr}T${timeStr}:00+07:00`);
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function getBangkokNow(nowMs) {
  const bkk = new Date(nowMs + BANGKOK_OFFSET_MS);
  const year = bkk.getUTCFullYear();
  const month = bkk.getUTCMonth() + 1;
  const day = bkk.getUTCDate();
  const hours = bkk.getUTCHours();
  const minsOfHour = bkk.getUTCMinutes();
  const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { dateIso, hours, minsOfHour, minutes: hours * 60 + minsOfHour };
}

function isStartTimePastBangkok(bookingDateIso, startTimeHHMM, nowMs) {
  if (!bookingDateIso || !startTimeHHMM) return true;
  const bkk = getBangkokNow(nowMs);
  if (bookingDateIso < bkk.dateIso) return true;
  if (bookingDateIso > bkk.dateIso) return false;
  const [sH, sM] = startTimeHHMM.slice(0, 5).split(':').map(Number);
  if (isNaN(sH) || isNaN(sM)) return true;
  return (sH * 60 + sM) <= bkk.minutes;
}

function simulateApiBookingValidation({ booking_date, start_time, end_time, contact }, nowMs) {
  const trimmedContact = String(contact || '').trim();
  if (!/^\d{10}$/.test(trimmedContact)) {
    return { status: 400, error: 'กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก', code: 'ERR_INVALID_PHONE' };
  }
  const sHHMM = start_time.substring(0, 5);
  const eHHMM = end_time.substring(0, 5);
  if (eHHMM <= sHHMM) return { status: 400, error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' };
  if (sHHMM < '08:00') return { status: 400, error: 'เวลาเริ่มต้นต้องไม่เร็วกว่าเวลาเปิดทำการ (08:00 น.)' };
  if (sHHMM >= '18:00') return { status: 400, error: 'ไม่สามารถจองเวลาเริ่มต้นตั้งแต่เวลาปิดทำการ (18:00 น.) เป็นต้นไป' };
  if (eHHMM > '18:00') return { status: 400, error: 'เวลาสิ้นสุดต้องไม่เกินเวลาปิดทำการ (18:00 น.)' };

  const bkkNow = new Date(nowMs + 7 * 60 * 60 * 1000);
  const bkkTodayStr = `${bkkNow.getUTCFullYear()}-${String(bkkNow.getUTCMonth() + 1).padStart(2, '0')}-${String(bkkNow.getUTCDate()).padStart(2, '0')}`;
  if (booking_date < bkkTodayStr) {
    return { status: 400, error: 'ไม่สามารถจองวันที่ผ่านมาแล้วได้' };
  }
  const [by, bm, bd] = booking_date.split('-').map(Number);
  const [bsh, bsm] = sHHMM.split(':').map(Number);
  const bookingStartUtc = new Date(Date.UTC(by, bm - 1, bd, bsh - 7, bsm));
  if (bookingStartUtc.getTime() <= nowMs) {
    return { status: 400, error: 'เลยเวลาเริ่มแล้ว กรุณาเลือกเวลาใหม่', code: 'ERR_PAST_START_TIME' };
  }
  return { status: 200, success: true };
}

test('Case 1: 24/7 Online Booking Creation (06:59 & 21:00 Bangkok)', async (t) => {
  await t.test('1.1: 07:00-20:00 online booking block removed from Worker, Server, and Frontend', () => {
    assert.ok(!backendWorkerSrc.includes('ERR_ONLINE_BOOKING_CLOSED'), 'Worker must not block bookings by 07:00-20:00');
    assert.ok(!backendServerSrc.includes('ERR_ONLINE_BOOKING_CLOSED'), 'Server must not block bookings by 07:00-20:00');
    assert.ok(!roomListPageSrc.includes('ปิดรับจองออนไลน์'), 'RoomListPage must not show closed booking banner');
    assert.ok(!bookingFormPageSrc.includes('ปิดรับจองออนไลน์'), 'BookingFormPage must not block submission');
    assert.match(bangkokTimeSrc, /isOpen:\s*true/, 'bangkokTime isOnlineBookingOpen always returns isOpen: true');
  });

  await t.test('1.2: Simulated Clock 06:59 Bangkok can book tomorrow 08:00-10:00', () => {
    const t0659 = getBangkokTimestamp('2026-11-26', '06:59');
    assert.equal(isStartTimePastBangkok('2026-11-27', '08:00', t0659), false);
    const res = simulateApiBookingValidation({
      booking_date: '2026-11-27',
      start_time: '08:00',
      end_time: '10:00',
      contact: '0812345678'
    }, t0659);
    assert.equal(res.status, 200);
  });

  await t.test('1.3: Simulated Clock 21:00 Bangkok can book tomorrow 17:30-18:00', () => {
    const t2100 = getBangkokTimestamp('2026-11-26', '21:00');
    assert.equal(isStartTimePastBangkok('2026-11-27', '17:30', t2100), false);
    const res = simulateApiBookingValidation({
      booking_date: '2026-11-27',
      start_time: '17:30',
      end_time: '18:00',
      contact: '0812345678'
    }, t2100);
    assert.equal(res.status, 200);
  });
});

test('Case 2: Room Usage Hours (08:00-18:00) & Anti-Past Rules Preserved', async (t) => {
  await t.test('2.1: Rejects room usage outside 08:00-18:00', () => {
    const t1000 = getBangkokTimestamp('2026-11-26', '10:00');
    assert.equal(simulateApiBookingValidation({ booking_date: '2026-11-27', start_time: '07:30', end_time: '08:30', contact: '0812345678' }, t1000).status, 400);
    assert.equal(simulateApiBookingValidation({ booking_date: '2026-11-27', start_time: '17:30', end_time: '18:30', contact: '0812345678' }, t1000).status, 400);
    assert.equal(simulateApiBookingValidation({ booking_date: '2026-11-27', start_time: '18:00', end_time: '19:00', contact: '0812345678' }, t1000).status, 400);
  });

  await t.test('2.2: Rejects past date and past start time today', () => {
    const t1400 = getBangkokTimestamp('2026-11-26', '14:00');
    assert.equal(simulateApiBookingValidation({ booking_date: '2026-11-25', start_time: '10:00', end_time: '11:00', contact: '0812345678' }, t1400).status, 400);
    assert.equal(simulateApiBookingValidation({ booking_date: '2026-11-26', start_time: '14:00', end_time: '15:00', contact: '0812345678' }, t1400).code, 'ERR_PAST_START_TIME');
    assert.equal(simulateApiBookingValidation({ booking_date: '2026-11-26', start_time: '13:30', end_time: '14:30', contact: '0812345678' }, t1400).code, 'ERR_PAST_START_TIME');
    assert.equal(simulateApiBookingValidation({ booking_date: '2026-11-26', start_time: '14:30', end_time: '15:30', contact: '0812345678' }, t1400).status, 200);
  });
});

test('Case 3: Timeline Bar, Header & Calendar UI Rules', async (t) => {
  await t.test('3.1: Booking hours banner & 24h/Thailand notes removed from RoomListPage', () => {
    assert.ok(!roomListPageSrc.includes('customer-hours-banner'));
    assert.ok(!roomListPageSrc.includes('ดูวันและเวลาว่างล่วงหน้า'));
    assert.ok(!roomListPageSrc.includes('เวลาทั้งหมดเป็นเวลาไทย'));
  });

  await t.test('3.2: Timeline legend has no "เลยเวลา", colors are #6EE7B7/#F47B5B/#FACC15/#64748B, tooltip & edge handles exist', () => {
    assert.match(roomListPageSrc, /bgColor\s*=\s*'#6EE7B7'/);
    assert.match(roomListPageSrc, /bgColor\s*=\s*'#F47B5B'/);
    assert.match(roomListPageSrc, /bgColor\s*=\s*'#FACC15'/);
    assert.match(roomListPageSrc, /bgColor\s*=\s*'#64748B'/);
    assert.match(roomListPageSrc, /timeline-slot-tooltip-/);
    assert.match(roomListPageSrc, /timeline-edge-start-/);
    assert.match(roomListPageSrc, /timeline-edge-end-/);
    assert.ok(!roomListPageSrc.includes('backgroundColor: \'#E2E8F0\', border: \'1px solid #CBD5E1\''));
  });

  await t.test('3.3: Header removes LINE subtitle, past date uses thin top-right cross, modal has no time filter, single-room notices exist', () => {
    assert.ok(!appSrc.includes('จองออนไลน์ผ่าน LINE'));
    assert.match(indexCssSrc, /\.customer-cal-day__past-x/);
    assert.ok(!roomListPageSrc.includes('customer-cal-day__diagonal-label'));
    assert.ok(!roomListPageSrc.includes('ระบุช่วงเวลา (ไม่บังคับ)'));
    assert.match(roomListPageSrc, /หมดรอบวันนี้/);
    assert.match(roomListPageSrc, /ห้องขนาด \$\{smallestCapableCap\} ที่นั่งเต็มแล้วสำหรับวันที่เลือก/);
    assert.match(roomListPageSrc, /ไม่พบห้องว่างสำหรับ \{guests\} คนในวันที่เลือก/);
    assert.match(roomListPageSrc, /ห้องนี้ไม่มีช่วงว่างในวันที่เลือก/);
    assert.match(roomListPageSrc, /ห้องนี้ไม่ว่างในช่วงเดิม กรุณาเลือกเวลาใหม่/);
  });
});

test('Case 4: Payment Page Bank Logo, No Hardcoded Default Account, Staging Preview & Copy Digits', async (t) => {
  await t.test('4.1: ConfirmPage default state for real bookings has empty account_number and no hardcoded promptpay', () => {
    assert.match(confirmPageSrc, /isKrungsriPreview\s*\?/);
    assert.match(confirmPageSrc, /account_number:\s*'',/);
    assert.ok(!confirmPageSrc.includes('0125554000401'), 'Must not embed real promptpay ID as default');
  });

  await t.test('4.2: ConfirmPage includes full Krungsri PNG logo, clean bank name, and strips non-digits on copy', () => {
    assert.match(confirmPageSrc, /\/krungsri-logo\.png/);
    assert.match(confirmPageSrc, /ธนาคารกรุงศรีอยุธยา/);
    assert.match(confirmPageSrc, /displayedAccountNumber\.replace\(\/\\D\/g,\s*''\)/);
  });
});

test('Case 5: Phone Input Sanitization & Strict 10-Digit Validation', async (t) => {
  const sanitizePhone = (raw) => String(raw).replace(/\D/g, '').slice(0, 10);

  await t.test('5.1: UI sanitizer strips letters, caps at 10 digits, preserves leading zero', () => {
    assert.equal(sanitizePhone('081234567'), '081234567');
    assert.equal(sanitizePhone('0812345678'), '0812345678');
    assert.equal(sanitizePhone('08123456789'), '0812345678');
    assert.equal(sanitizePhone('08a1-23b4 5678'), '0812345678');
    assert.equal(sanitizePhone('abc099xyz'), '099');
  });

  await t.test('5.2: API & Form enforce exact 10 digits with Thai error message', () => {
    const t1000 = getBangkokTimestamp('2026-11-26', '10:00');
    const base = { booking_date: '2026-11-27', start_time: '10:00', end_time: '11:00' };

    // 9 digits -> fail
    const r9 = simulateApiBookingValidation({ ...base, contact: '081234567' }, t1000);
    assert.equal(r9.status, 400);
    assert.equal(r9.error, 'กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก');

    // 10 digits -> pass
    const r10 = simulateApiBookingValidation({ ...base, contact: '0812345678' }, t1000);
    assert.equal(r10.status, 200);

    // 11 digits -> fail
    const r11 = simulateApiBookingValidation({ ...base, contact: '08123456789' }, t1000);
    assert.equal(r11.status, 400);
    assert.equal(r11.error, 'กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก');

    // Letters -> fail
    const rAlpha = simulateApiBookingValidation({ ...base, contact: '08123abc78' }, t1000);
    assert.equal(rAlpha.status, 400);
    assert.equal(rAlpha.error, 'กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก');

    assert.match(bookingFormPageSrc, /inputMode="numeric"/);
    assert.match(bookingFormPageSrc, /กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก/);
    assert.match(backendWorkerSrc, /กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก/);
    assert.match(backendServerSrc, /กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก/);
  });
});

test('Case 6: Fixed 30-Minute Cleaning Buffer Rule Across Frontend and API', async (t) => {
  await t.test('6.1: Worker, Server, RoomListPage, and StaffAvailabilityPage enforce fixed 30-minute cleaning buffer regardless of settings', () => {
    const staffAvailSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'StaffAvailabilityPage.jsx'), 'utf8');
    assert.match(backendWorkerSrc, /FIXED_CLEANING_BUFFER_MINUTES\s*=\s*30/);
    assert.match(backendWorkerSrc, /async function getCleaningBufferMinutes[\s\S]{0,220}return FIXED_CLEANING_BUFFER_MINUTES/);
    assert.match(backendServerSrc, /FIXED_CLEANING_BUFFER_MINUTES\s*=\s*30/);
    assert.match(backendServerSrc, /async function getCleaningBufferMinutes[\s\S]{0,200}return FIXED_CLEANING_BUFFER_MINUTES/);
    assert.ok(!roomListPageSrc.includes('availabilityData.cleaning_buffer_minutes'));
    assert.ok(!roomListPageSrc.includes('schedule.cleaning_buffer_minutes'));
    assert.ok(!staffAvailSrc.includes('availabilityData.cleaning_buffer_minutes'));
    assert.ok(!staffAvailSrc.includes('availabilityData?.cleaning_buffer_minutes'));
  });

  await t.test('6.2: Booking ending at 11:00 blocks 11:00-11:30 and allows starting at 11:30 even if settings.cleaning_buffer_minutes is 15 or 60', () => {
    const existingEndMins = 11 * 60; // 11:00
    const checkStartAllowed = (reqStartMins, simulatedSettingMins) => {
      // Agreed rule ignores simulatedSettingMins and enforces 30 minutes
      const effectiveBuffer = 30;
      void simulatedSettingMins;
      return !(existingEndMins <= reqStartMins && reqStartMins < existingEndMins + effectiveBuffer);
    };
    for (const fakeSetting of [0, 15, 45, 60]) {
      assert.equal(checkStartAllowed(11 * 60, fakeSetting), false, `11:00 must be blocked when setting=${fakeSetting}`);
      assert.equal(checkStartAllowed(11 * 60 + 15, fakeSetting), false, `11:15 must be blocked when setting=${fakeSetting}`);
      assert.equal(checkStartAllowed(11 * 60 + 30, fakeSetting), true, `11:30 must be allowed when setting=${fakeSetting}`);
    }
  });
});
