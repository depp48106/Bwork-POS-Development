/**
 * shared/paymentCountdown.mjs
 *
 * Calculates remaining payment time in seconds and expiration status.
 *
 * Source of Truth: paymentDeadline (ISO string or epoch milliseconds).
 * Formula: remainingSeconds = max(0, floor((paymentDeadline - now) / 1000))
 *
 * Fallback: created_at + (payment_window_minutes * 60 * 1000).
 * Fail-safe: if neither deadline nor created_at is valid, returns remainingSeconds: 0, isExpired: true.
 * (Never hangs at a static 15:00).
 *
 * @param {Object} booking - Booking object containing paymentDeadline, created_at, etc.
 * @param {number|string} [paymentWindowMinutes=15] - Payment window in minutes.
 * @param {number} [nowMs=Date.now()] - Current epoch time in milliseconds.
 * @returns {{ remainingSeconds: number, isExpired: boolean, hasDeadline: boolean, deadlineMs: number|null }}
 */
export function calcPaymentTimeLeft(booking, paymentWindowMinutes = 15, nowMs = Date.now()) {
  if (!booking) {
    return { remainingSeconds: 0, isExpired: false, hasDeadline: false, deadlineMs: null };
  }

  // 1. Primary Source of Truth: paymentDeadline / payment_deadline
  const rawDeadline = booking.paymentDeadline || booking.payment_deadline;
  if (rawDeadline) {
    let deadlineMs = NaN;
    if (typeof rawDeadline === 'number') {
      deadlineMs = rawDeadline;
    } else if (typeof rawDeadline === 'string') {
      const clean = rawDeadline.includes('T') ? rawDeadline : rawDeadline.replace(' ', 'T');
      deadlineMs = new Date(clean).getTime();
    } else if (rawDeadline instanceof Date) {
      deadlineMs = rawDeadline.getTime();
    }

    if (!isNaN(deadlineMs)) {
      const diffSec = Math.floor((deadlineMs - nowMs) / 1000);
      const remainingSeconds = Math.max(0, diffSec);
      return {
        remainingSeconds,
        isExpired: remainingSeconds <= 0,
        hasDeadline: true,
        deadlineMs
      };
    }
  }

  // 2. Fallback: created_at + payment_window_minutes (only when paymentDeadline is missing)
  const winMins = Number(paymentWindowMinutes || booking.payment_window_minutes || booking.paymentWindowMinutes || 15);
  const totalWindowSec = Math.max(1, isNaN(winMins) ? 15 : winMins) * 60;

  const rawCreated = booking.created_at || booking.createdAt;
  if (rawCreated) {
    let createdMs = NaN;
    if (typeof rawCreated === 'number') {
      createdMs = rawCreated;
    } else if (typeof rawCreated === 'string') {
      const clean = rawCreated.includes('T') ? rawCreated : rawCreated.replace(' ', 'T');
      createdMs = new Date(clean).getTime();
    } else if (rawCreated instanceof Date) {
      createdMs = rawCreated.getTime();
    }

    if (!isNaN(createdMs)) {
      const deadlineMs = createdMs + totalWindowSec * 1000;
      const elapsedSec = Math.floor((nowMs - createdMs) / 1000);
      const remainingSeconds = Math.max(0, totalWindowSec - elapsedSec);
      return {
        remainingSeconds,
        isExpired: remainingSeconds <= 0,
        hasDeadline: true,
        deadlineMs
      };
    }
  }

  // 3. Fail-safe if neither is valid: fail closed (expired), never hang at 15:00
  return {
    remainingSeconds: 0,
    isExpired: true,
    hasDeadline: false,
    deadlineMs: null
  };
}

export default {
  calcPaymentTimeLeft
};
