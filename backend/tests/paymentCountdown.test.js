/**
 * backend/tests/paymentCountdown.test.js
 *
 * Test suite for BUG 1A: Payment Countdown Timer logic.
 * Validates Source of Truth, deadline calculations, fallbacks, refresh invariance, and fail-safes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { calcPaymentTimeLeft } = require('../../shared/paymentCountdown.mjs');

// =========================================================================
// 1. paymentDeadline อีก 15 นาที
// =========================================================================
test('Case 1: paymentDeadline in 15 minutes -> returns 900 seconds remaining and not expired', () => {
  const nowMs = 1756900000000;
  const fifteenMinsMs = 15 * 60 * 1000;
  const deadline = new Date(nowMs + fifteenMinsMs).toISOString();

  const booking = {
    id: 1,
    booking_code: 'BK-000001',
    paymentDeadline: deadline,
    payment_window_minutes: 15
  };

  const res = calcPaymentTimeLeft(booking, 15, nowMs);

  assert.equal(res.remainingSeconds, 900);
  assert.equal(res.isExpired, false);
  assert.equal(res.hasDeadline, true);
  assert.equal(res.deadlineMs, nowMs + fifteenMinsMs);
});

// =========================================================================
// 2. paymentDeadline เหลือ 5 นาที
// =========================================================================
test('Case 2: paymentDeadline remaining 5 minutes -> returns 300 seconds remaining', () => {
  const nowMs = 1756900000000;
  const fiveMinsMs = 5 * 60 * 1000;
  const deadline = new Date(nowMs + fiveMinsMs).toISOString();

  const booking = {
    id: 2,
    booking_code: 'BK-000002',
    paymentDeadline: deadline,
    payment_window_minutes: 15
  };

  const res = calcPaymentTimeLeft(booking, 15, nowMs);

  assert.equal(res.remainingSeconds, 300);
  assert.equal(res.isExpired, false);
  assert.equal(res.hasDeadline, true);
});

// =========================================================================
// 3. expired deadline
// =========================================================================
test('Case 3: expired deadline -> returns 0 seconds remaining and isExpired = true', () => {
  const nowMs = 1756900000000;
  const pastMs = 30 * 1000; // 30 seconds ago
  const deadline = new Date(nowMs - pastMs).toISOString();

  const booking = {
    id: 3,
    booking_code: 'BK-000003',
    paymentDeadline: deadline,
    payment_window_minutes: 15
  };

  const res = calcPaymentTimeLeft(booking, 15, nowMs);

  assert.equal(res.remainingSeconds, 0);
  assert.equal(res.isExpired, true);
  assert.equal(res.hasDeadline, true);
});

// =========================================================================
// 4. page refresh ไม่ reset timer
// =========================================================================
test('Case 4: page refresh does not reset timer back to 15:00', () => {
  const t0 = 1756900000000;
  const initial15Mins = 15 * 60 * 1000;
  const fixedDeadline = new Date(t0 + initial15Mins).toISOString();

  // Booking created at T0
  const booking = {
    id: 4,
    booking_code: 'BK-000004',
    paymentDeadline: fixedDeadline,
    payment_window_minutes: 15
  };

  // Initial visit: 15 minutes left (900 sec)
  const initialRes = calcPaymentTimeLeft(booking, 15, t0);
  assert.equal(initialRes.remainingSeconds, 900);

  // Customer browses for 5 minutes and 30 seconds (330 sec), then page refreshes at T1
  const t1 = t0 + 330 * 1000;
  const refreshRes = calcPaymentTimeLeft(booking, 15, t1);

  // Timer must NOT be 900 sec. It must reflect elapsed time: 900 - 330 = 570 sec (09:30)
  assert.equal(refreshRes.remainingSeconds, 570);
  assert.equal(refreshRes.isExpired, false);

  // Customer waits until past deadline at T2 (16 minutes after T0)
  const t2 = t0 + 16 * 60 * 1000;
  const expiredRefreshRes = calcPaymentTimeLeft(booking, 15, t2);
  assert.equal(expiredRefreshRes.remainingSeconds, 0);
  assert.equal(expiredRefreshRes.isExpired, true);
});

// =========================================================================
// 5. created_at missing แต่ paymentDeadline มี
// =========================================================================
test('Case 5: created_at missing but paymentDeadline present -> calculates accurately', () => {
  const nowMs = 1756900000000;
  const eightMinsMs = 8 * 60 * 1000;
  const deadline = new Date(nowMs + eightMinsMs).toISOString();

  const booking = {
    id: 5,
    booking_code: 'BK-000005',
    // created_at is strictly undefined
    paymentDeadline: deadline,
    payment_window_minutes: 15
  };

  const res = calcPaymentTimeLeft(booking, 15, nowMs);

  assert.equal(res.remainingSeconds, 480); // 8 minutes
  assert.equal(res.isExpired, false);
  assert.equal(res.hasDeadline, true);
});

// =========================================================================
// 6. malformed deadline fail-safe
// =========================================================================
test('Case 6: malformed deadline fail-safe -> does not hang at 15:00', () => {
  const nowMs = 1756900000000;

  // 6A: Malformed deadline and no created_at
  const bookingNoFallback = {
    id: 6,
    paymentDeadline: 'MALFORMED_GARBAGE_DATE_STRING'
  };
  const resNoFallback = calcPaymentTimeLeft(bookingNoFallback, 15, nowMs);
  assert.equal(resNoFallback.remainingSeconds, 0);
  assert.equal(resNoFallback.isExpired, true);
  assert.equal(resNoFallback.hasDeadline, false);

  // 6B: Malformed deadline but valid created_at fallback
  const bookingWithFallback = {
    id: 6,
    paymentDeadline: 'MALFORMED_DATE',
    created_at: new Date(nowMs - 5 * 60 * 1000).toISOString(), // created 5 min ago
    payment_window_minutes: 15
  };
  const resWithFallback = calcPaymentTimeLeft(bookingWithFallback, 15, nowMs);
  // Fallback calculates: 15 - 5 = 10 min left (600 sec)
  assert.equal(resWithFallback.remainingSeconds, 600);
  assert.equal(resWithFallback.isExpired, false);
  assert.equal(resWithFallback.hasDeadline, true);
});

// =========================================================================
// 7. Fallback: paymentDeadline absent, created_at present
// =========================================================================
test('Case 7: paymentDeadline absent, created_at present -> calculates from created_at', () => {
  const nowMs = 1756900000000;
  const booking = {
    id: 7,
    created_at: new Date(nowMs - 7 * 60 * 1000).toISOString(), // 7 mins ago
    payment_window_minutes: 15
  };

  const res = calcPaymentTimeLeft(booking, 15, nowMs);
  assert.equal(res.remainingSeconds, 8 * 60); // 8 mins left (480 sec)
  assert.equal(res.isExpired, false);
  assert.equal(res.hasDeadline, true);
});
