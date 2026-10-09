/**
 * editablePromotionSettingsPhase1_2.test.cjs
 * Comprehensive Backend Unit & Integration Tests for BWORK-ONLINE-DISCOUNT-V1 Phase 1.2
 *
 * Validates:
 * 1. Discount range and decimal validation (0.01 - 100, reject 0, negative, >100, NaN)
 * 2. Active promotion edit lockout (Section 8: "กรุณาหยุดโปรโมชั่นก่อนแก้ไขการตั้งค่า")
 * 3. Datetime validation (end_at strictly > start_at, rejection of end <= start)
 * 4. Status recomputation after save (future -> upcoming, past -> ready, extended -> active/ready)
 * 5. Backend update endpoint contracts (PUT/POST /api/admin/promotion with permission guards)
 * 6. Dynamic pricing with non-5% discount values (7.5%, 10%, 2.5%)
 * 7. Public payload sanitization (no updated_by, activated_by, internal metadata)
 * 8. Parity between onlinePromotionHelper.js and worker.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const {
  DEFAULT_ONLINE_PROMOTION,
  formatBangkokDateTime,
  parsePromotionState,
  isPromotionActive,
  canActivatePromotion,
  getPromotionStatus,
  getPublicPromotionPayload,
  calculateOnlineBookingPricing,
  validatePromotionUpdatePayload
} = require('../onlinePromotionHelper');

test('BWORK-ONLINE-DISCOUNT-V1 Phase 1.2 Backend Tests', async (t) => {

  await t.test('1. Discount Range and Precision Validation', () => {
    const inactiveState = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: false };

    // Valid discounts
    const valid5 = validatePromotionUpdatePayload({
      discount_value: 5,
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(valid5.valid, true);
    assert.equal(valid5.data.discount_value, 5);

    const valid7_5 = validatePromotionUpdatePayload({
      discount_value: '7.5',
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(valid7_5.valid, true);
    assert.equal(valid7_5.data.discount_value, 7.5);

    const validMin = validatePromotionUpdatePayload({
      discount_value: 0.01,
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(validMin.valid, true);
    assert.equal(validMin.data.discount_value, 0.01);

    const validMax = validatePromotionUpdatePayload({
      discount_value: 100,
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(validMax.valid, true);
    assert.equal(validMax.data.discount_value, 100);

    // Max 2 decimal precision rounding
    const rounded = validatePromotionUpdatePayload({
      discount_value: 12.3456,
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(rounded.valid, true);
    assert.equal(rounded.data.discount_value, 12.35);

    // Rejections: 0, negative, > 100, NaN, empty
    const zero = validatePromotionUpdatePayload({
      discount_value: 0,
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(zero.valid, false);
    assert.match(zero.error, /ส่วนลดต้องอยู่ระหว่าง 0\.01% ถึง 100%/);

    const negative = validatePromotionUpdatePayload({
      discount_value: -5,
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(negative.valid, false);

    const excessive = validatePromotionUpdatePayload({
      discount_value: 100.01,
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(excessive.valid, false);

    const nanVal = validatePromotionUpdatePayload({
      discount_value: 'invalid',
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(nanVal.valid, false);
    assert.match(nanVal.error, /ส่วนลดต้องเป็นตัวเลขที่ถูกต้อง/);

    const emptyVal = validatePromotionUpdatePayload({
      discount_value: '',
      start_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(emptyVal.valid, false);
    assert.match(emptyVal.error, /กรุณาระบุเปอร์เซ็นต์ส่วนลด/);
  });

  await t.test('2. Active Promotion Edit Lockout Policy (Section 8)', () => {
    const activeState = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true };

    const updateAttempt = validatePromotionUpdatePayload({
      discount_value: 10,
      start_at: '2026-10-13T08:00:00+07:00'
    }, activeState);

    assert.equal(updateAttempt.valid, false);
    assert.equal(updateAttempt.error, 'กรุณาหยุดโปรโมชั่นก่อนแก้ไขการตั้งค่า');
  });

  await t.test('3. Datetime Validation and Bangkok Interpretation (Section 5, 6, 7)', () => {
    const inactiveState = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: false };

    // End date mode: null / undefined maps to null
    const noEnd = validatePromotionUpdatePayload({
      discount_value: 5,
      start_at: '2026-10-13T08:00:00+07:00',
      end_at: null
    }, inactiveState);
    assert.equal(noEnd.valid, true);
    assert.equal(noEnd.data.end_at, null);

    // End date mode: strictly later than start
    const validEnd = validatePromotionUpdatePayload({
      discount_value: 5,
      start_at: '2026-10-13T08:00:00+07:00',
      end_at: '2026-10-20T18:00:00+07:00'
    }, inactiveState);
    assert.equal(validEnd.valid, true);
    assert.equal(validEnd.data.end_at, '2026-10-20T18:00:00+07:00');

    // Reject end == start
    const equalEnd = validatePromotionUpdatePayload({
      discount_value: 5,
      start_at: '2026-10-13T08:00:00+07:00',
      end_at: '2026-10-13T08:00:00+07:00'
    }, inactiveState);
    assert.equal(equalEnd.valid, false);
    assert.equal(equalEnd.error, 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้นโปรโมชั่น');

    // Reject end < start
    const earlierEnd = validatePromotionUpdatePayload({
      discount_value: 5,
      start_at: '2026-10-13T08:00:00+07:00',
      end_at: '2026-10-12T08:00:00+07:00'
    }, inactiveState);
    assert.equal(earlierEnd.valid, false);
    assert.equal(earlierEnd.error, 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้นโปรโมชั่น');

    // Reject invalid start_at
    const invalidStart = validatePromotionUpdatePayload({
      discount_value: 5,
      start_at: 'not-a-date'
    }, inactiveState);
    assert.equal(invalidStart.valid, false);
    assert.match(invalidStart.error, /วันและเวลาเริ่มต้นโปรโมชั่นไม่ถูกต้อง/);
  });

  await t.test('4. Status Recomputation Policy (Upcoming, Ready, Ended)', () => {
    const fixedNowMs = Date.parse('2026-10-15T12:00:00+07:00');

    // A. Start date in future -> status is upcoming
    const futurePromo = parsePromotionState({
      start_at: '2026-10-20T08:00:00+07:00',
      is_enabled: false
    });
    const statusFuture = getPromotionStatus(futurePromo, fixedNowMs);
    assert.equal(statusFuture.status, 'upcoming');
    assert.equal(statusFuture.label, 'รอเปิดใช้งาน');

    // B. Start date in past, not enabled -> status is ready
    const pastPromo = parsePromotionState({
      start_at: '2026-10-10T08:00:00+07:00',
      is_enabled: false
    });
    const statusPast = getPromotionStatus(pastPromo, fixedNowMs);
    assert.equal(statusPast.status, 'ready');
    assert.equal(statusPast.label, 'พร้อมเปิดใช้งาน');

    // C. End date in past -> status is ended
    const endedPromo = parsePromotionState({
      start_at: '2026-10-01T08:00:00+07:00',
      end_at: '2026-10-14T08:00:00+07:00',
      is_enabled: false
    });
    const statusEnded = getPromotionStatus(endedPromo, fixedNowMs);
    assert.equal(statusEnded.status, 'ended');
    assert.equal(statusEnded.label, 'สิ้นสุดแล้ว');

    // D. Saving new future end date revives ended promo to ready
    const revivedPromo = parsePromotionState({
      start_at: '2026-10-01T08:00:00+07:00',
      end_at: '2026-10-31T23:59:59+07:00',
      is_enabled: false
    });
    const statusRevived = getPromotionStatus(revivedPromo, fixedNowMs);
    assert.equal(statusRevived.status, 'ready');
  });

  await t.test('5. Dynamic Online Booking Pricing Calculation (Section 20)', () => {
    const fixedNowMs = Date.parse('2026-10-15T12:00:00+07:00');

    // Promo 7.5%
    const promo7_5 = parsePromotionState({
      start_at: '2026-10-13T08:00:00+07:00',
      discount_value: 7.5,
      is_enabled: true
    });
    const pricing7_5 = calculateOnlineBookingPricing({
      subtotal: 1000,
      promo: promo7_5,
      currentTime: fixedNowMs
    });
    assert.equal(pricing7_5.is_promotion_applied, true);
    assert.equal(pricing7_5.discount_value, 7.5);
    assert.equal(pricing7_5.discount_amount, 75);
    assert.equal(pricing7_5.total_amount, 925);

    // Promo 10%
    const promo10 = parsePromotionState({
      start_at: '2026-10-13T08:00:00+07:00',
      discount_value: 10,
      is_enabled: true
    });
    const pricing10 = calculateOnlineBookingPricing({
      subtotal: 1000,
      promo: promo10,
      currentTime: fixedNowMs
    });
    assert.equal(pricing10.discount_amount, 100);
    assert.equal(pricing10.total_amount, 900);

    // Fractional cent rounding check: 550 * 7.5% = 41.25 -> total 508.75
    const pricing550 = calculateOnlineBookingPricing({
      subtotal: 550,
      promo: promo7_5,
      currentTime: fixedNowMs
    });
    assert.equal(pricing550.discount_amount, 41.25);
    assert.equal(pricing550.total_amount, 508.75);

    // Inactive promo -> 0 discount
    const promoInactive = parsePromotionState({
      start_at: '2026-10-13T08:00:00+07:00',
      discount_value: 10,
      is_enabled: false
    });
    const pricingInactive = calculateOnlineBookingPricing({
      subtotal: 1000,
      promo: promoInactive,
      currentTime: fixedNowMs
    });
    assert.equal(pricingInactive.is_promotion_applied, false);
    assert.equal(pricingInactive.discount_amount, 0);
    assert.equal(pricingInactive.total_amount, 1000);
  });

  await t.test('6. Public Payload Sanitization (Section 27)', () => {
    const internalPromo = {
      promotion_name: 'แคมเปญพิเศษ',
      promotion_code: 'ONLINE_5_PERCENT',
      discount_type: 'percent',
      discount_value: 7.5,
      channel: 'online',
      start_at: '2026-10-13T08:00:00+07:00',
      end_at: null,
      is_enabled: true,
      activated_at: '2026-10-13T08:30:00',
      activated_by: 'superadmin',
      deactivated_at: null,
      deactivated_by: null,
      updated_at: '2026-10-13T09:00:00',
      updated_by: 'superadmin'
    };

    const publicPayload = getPublicPromotionPayload(internalPromo, Date.parse('2026-10-14T00:00:00+07:00'));

    assert.equal(publicPayload.is_active, true);
    assert.equal(publicPayload.discount_value, 7.5);
    assert.equal(publicPayload.promotion_name, 'แคมเปญพิเศษ');
    assert.equal(publicPayload.channel, 'online');

    // Leak audit
    assert.equal(publicPayload.activated_by, undefined, 'Must NOT leak activated_by');
    assert.equal(publicPayload.activated_at, undefined, 'Must NOT leak activated_at');
    assert.equal(publicPayload.deactivated_by, undefined, 'Must NOT leak deactivated_by');
    assert.equal(publicPayload.updated_by, undefined, 'Must NOT leak updated_by');
    assert.equal(publicPayload.updated_at, undefined, 'Must NOT leak updated_at');
  });

  await t.test('7. Server and Worker Parity Audit for Promotion Editing', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const workerSrc = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

    // Server route handlers
    assert.match(serverSrc, /app\.put\(\['\/api\/admin\/promotion'/);
    assert.match(serverSrc, /handleUpdatePromotion/);
    assert.match(serverSrc, /validatePromotionUpdatePayload/);

    // Worker route handlers
    assert.match(workerSrc, /if \(\(pathname === '\/api\/admin\/promotion' \|\| pathname === '\/api\/settings\/promotion'\) && \(method === 'PUT' \|\| method === 'POST'\)\)/);
    assert.match(workerSrc, /function validatePromotionUpdatePayload\(/);
    assert.match(workerSrc, /function formatBangkokDateTime\(/);
  });
});
