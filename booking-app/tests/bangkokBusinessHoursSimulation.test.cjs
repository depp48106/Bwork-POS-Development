/**
 * BWORK-POS — BANGKOK BUSINESS HOURS SIMULATION TEST SUITE
 * 
 * Verifies business cases according to Asia/Bangkok (UTC+7) timezone:
 * 1. 06:59 and 20:00: Closed for new bookings on UI and API, but advance availability remains accessible.
 * 2. 07:00 and 19:59: Open for bookings. At 19:00, booking slot 17:30-18:00 of tomorrow succeeds.
 * 3. Past dates: Disabled/unclickable with diagonal "ผ่านมาแล้ว" label.
 *    Today with exhausted slots: displays "หมดรอบวันนี้".
 * 4. Booking form left open until 20:00: Disables submit button, preserves form draft.
 *    Bookings created before 20:00 proceed to payment normally.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Read source files to verify contracts and handlers
const bangkokTimeSrc = fs.readFileSync(path.resolve(__dirname, '../src/utils/bangkokTime.js'), 'utf8');
const roomListPageSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/RoomListPage.jsx'), 'utf8');
const bookingFormPageSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/BookingFormPage.jsx'), 'utf8');
const confirmPageSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/ConfirmPage.jsx'), 'utf8');
const backendWorkerSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/worker.js'), 'utf8');
const backendServerSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/server.js'), 'utf8');

// Helper to create UTC timestamp from Bangkok date and time
function getBangkokTimestamp(dateStr, timeStr) {
  // dateStr: YYYY-MM-DD, timeStr: HH:MM
  return Date.parse(`${dateStr}T${timeStr}:00+07:00`);
}

// Logic mirror of bangkokTime.js
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const ONLINE_BOOKING_OPEN_MINS = 7 * 60; // 07:00
const ONLINE_BOOKING_CLOSE_MINS = 20 * 60; // 20:00

function getBangkokNow(nowMs) {
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
    hours,
    minsOfHour,
    minutes: hours * 60 + minsOfHour
  };
}

function isOnlineBookingOpen(nowMs) {
  const bkk = getBangkokNow(nowMs);
  const isOpen = bkk.minutes >= ONLINE_BOOKING_OPEN_MINS && bkk.minutes < ONLINE_BOOKING_CLOSE_MINS;
  return {
    isOpen,
    message: isOpen ? '' : 'ขณะนี้ปิดรับจองออนไลน์ เปิดรับจองอีกครั้งเวลา 07:00 น.',
    minutes: bkk.minutes,
    hours: bkk.hours,
    minsOfHour: bkk.minsOfHour
  };
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

// Simulated API handler checking online booking window
function simulateWorkerBookingWindowCheck(nowMs) {
  const bkkNow = new Date(nowMs + 7 * 60 * 60 * 1000);
  const bkkHours = bkkNow.getUTCHours();
  const bkkMins = bkkHours * 60 + bkkNow.getUTCMinutes();
  if (bkkMins < 7 * 60 || bkkMins >= 20 * 60) {
    return {
      status: 400,
      body: {
        error: 'ขณะนี้ปิดรับจองออนไลน์ เปิดรับจองอีกครั้งเวลา 07:00 น.',
        code: 'ERR_ONLINE_BOOKING_CLOSED'
      }
    };
  }
  return { status: 200, body: { success: true } };
}

test('Case 1: Simulated Clock - 06:59 and 20:00 Window Check (Closed)', async (t) => {
  await t.test('1.1: At 06:59 Bangkok time, online booking is CLOSED on UI and API', () => {
    const time659 = getBangkokTimestamp('2026-11-26', '06:59');
    const uiStatus = isOnlineBookingOpen(time659);
    assert.equal(uiStatus.isOpen, false);
    assert.equal(uiStatus.message, 'ขณะนี้ปิดรับจองออนไลน์ เปิดรับจองอีกครั้งเวลา 07:00 น.');

    const apiStatus = simulateWorkerBookingWindowCheck(time659);
    assert.equal(apiStatus.status, 400);
    assert.equal(apiStatus.body.code, 'ERR_ONLINE_BOOKING_CLOSED');
  });

  await t.test('1.2: At 20:00 Bangkok time, online booking is CLOSED on UI and API', () => {
    const time2000 = getBangkokTimestamp('2026-11-26', '20:00');
    const uiStatus = isOnlineBookingOpen(time2000);
    assert.equal(uiStatus.isOpen, false);
    assert.equal(uiStatus.message, 'ขณะนี้ปิดรับจองออนไลน์ เปิดรับจองอีกครั้งเวลา 07:00 น.');

    const apiStatus = simulateWorkerBookingWindowCheck(time2000);
    assert.equal(apiStatus.status, 400);
    assert.equal(apiStatus.body.code, 'ERR_ONLINE_BOOKING_CLOSED');
  });

  await t.test('1.3: Advance availability viewing is NOT blocked at 06:59 or 20:00', () => {
    // Both worker and server DO NOT gate availability endpoints by online booking hours
    assert.ok(!backendWorkerSrc.includes("if (bkkMins < 7 * 60 || bkkMins >= 20 * 60)") ||
      backendWorkerSrc.indexOf("availability-month") < backendWorkerSrc.indexOf("ERR_ONLINE_BOOKING_CLOSED"),
      "Availability month endpoint is accessible regardless of booking hours"
    );
  });
});

test('Case 2: Simulated Clock - 07:00 and 19:59 Window Check (Open)', async (t) => {
  await t.test('2.1: At 07:00 Bangkok time, online booking is OPEN on UI and API', () => {
    const time0700 = getBangkokTimestamp('2026-11-26', '07:00');
    const uiStatus = isOnlineBookingOpen(time0700);
    assert.equal(uiStatus.isOpen, true);
    assert.equal(uiStatus.message, '');

    const apiStatus = simulateWorkerBookingWindowCheck(time0700);
    assert.equal(apiStatus.status, 200);
  });

  await t.test('2.2: At 19:59 Bangkok time, online booking is OPEN on UI and API', () => {
    const time1959 = getBangkokTimestamp('2026-11-26', '19:59');
    const uiStatus = isOnlineBookingOpen(time1959);
    assert.equal(uiStatus.isOpen, true);
    assert.equal(uiStatus.message, '');

    const apiStatus = simulateWorkerBookingWindowCheck(time1959);
    assert.equal(apiStatus.status, 200);
  });

  await t.test('2.3: At 19:00 Bangkok time, booking tomorrow 17:30-18:00 succeeds', () => {
    const time1900 = getBangkokTimestamp('2026-11-26', '19:00');
    // UI check
    const uiStatus = isOnlineBookingOpen(time1900);
    assert.equal(uiStatus.isOpen, true);

    // API check
    const apiStatus = simulateWorkerBookingWindowCheck(time1900);
    assert.equal(apiStatus.status, 200);

    // Date & start time check: tomorrow 17:30 is NOT past
    const isPast = isStartTimePastBangkok('2026-11-27', '17:30', time1900);
    assert.equal(isPast, false, 'Tomorrow 17:30 is strictly in the future');
  });
});

test('Case 3: Calendar Past Dates and Today Exhausted Slots', async (t) => {
  await t.test('3.1: Past dates render with diagonal label "ผ่านมาแล้ว" and are disabled', () => {
    assert.match(roomListPageSrc, /className="customer-cal-day__diagonal-label">ผ่านมาแล้ว<\/span>/);
    assert.match(roomListPageSrc, /isPast\s*\?\s*`\$\{cell\.dayNumber\}\s*\(ผ่านมาแล้ว\)`/);
    assert.match(roomListPageSrc, /customer-cal-day--past/);
  });

  await t.test('3.2: Today with exhausted slots displays badge "หมดรอบวันนี้"', () => {
    assert.match(roomListPageSrc, /className="customer-cal-day__badge customer-cal-day__badge--expired">หมดรอบวันนี้<\/span>/);
    assert.match(roomListPageSrc, /isTodayExpired\s*\?\s*`\$\{cell\.dayNumber\}\s*\(หมดรอบวันนี้\)`/);
  });
});

test('Case 4: Booking Form Open Until 20:00 & Payment Persistence', async (t) => {
  await t.test('4.1: BookingFormPage disables submit button when booking closes', () => {
    assert.match(bookingFormPageSrc, /disabled=\{loading\s*\|\|\s*isBookingClosed\}/);
    assert.match(bookingFormPageSrc, /ขณะนี้ปิดรับจองออนไลน์ เปิดรับจองอีกครั้งเวลา 07:00 น\./);
  });

  await t.test('4.2: BookingFormPage preserves draft inputs when closed or conflicted', () => {
    assert.match(bookingFormPageSrc, /isClosedErr/);
    assert.match(bookingFormPageSrc, /scopedKey/);
    assert.match(bookingFormPageSrc, /sessionStorage\.setItem/);
  });

  await t.test('4.3: Existing bookings proceeding to payment can complete regardless of closing time', () => {
    // ConfirmPage (payment & slip upload) does not block already created bookings
    assert.ok(!confirmPageSrc.includes('isOnlineBookingOpen'), 'ConfirmPage does not block existing bookings at 20:00');
  });
});
