const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

let receiptUtils;
let onlinePromotionHelper;
let bookingAppPromoHelper;

before(async () => {
  const receiptPath = path.resolve(__dirname, '../src/utils/receiptUtils.js');
  const promoHelperPath = path.resolve(__dirname, '../src/utils/onlinePromotionHelper.js');
  const bookingAppHelperPath = path.resolve(__dirname, '../../booking-app/src/utils/onlinePromotionHelper.js');

  receiptUtils = await import(`file://${receiptPath.replace(/\\/g, '/')}`);
  onlinePromotionHelper = await import(`file://${promoHelperPath.replace(/\\/g, '/')}`);
  bookingAppPromoHelper = await import(`file://${bookingAppHelperPath.replace(/\\/g, '/')}`);
});

describe('BWORK-ONLINE-DISCOUNT-V1 Phase 1 Frontend Tests', () => {

  describe('1. Receipt Presentation & Online Discount Label', () => {
    test('Online booking with 5% discount displays "ส่วนลดจองออนไลน์ 5%" on receipt', () => {
      const onlineBooking = {
        id: 101,
        booking_source: 'online',
        booking_channel: 'line_oa',
        customer_type: 'general',
        subtotal_amount: 1000,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 50,
        total_amount: 950,
        paid_amount: 950,
        balance_amount: 0,
        payment_status: 'paid',
        items: [
          { room_id: 4, room_name: 'Mars (301)', subtotal: 1000, price: 500, quantity: 2 }
        ]
      };

      const totals = receiptUtils.getReceiptTotals(onlineBooking);
      assert.equal(totals.grossSubtotal, 1000);
      assert.equal(totals.hasDiscount, true);
      assert.equal(totals.discountAmount, 50);
      assert.equal(totals.discountLabel, 'ส่วนลดจองออนไลน์ 5%');
      assert.equal(totals.netTotal, 950);
    });

    test('POS / Walk-in booking with custom percent discount displays generic label (not online promo)', () => {
      const posBooking = {
        id: 102,
        booking_source: 'walk-in',
        booking_channel: 'pos_web',
        customer_type: 'walkin',
        subtotal_amount: 1000,
        discount_type: 'percent',
        discount_value: 10,
        discount_amount: 100,
        total_amount: 900,
        paid_amount: 900,
        balance_amount: 0,
        payment_status: 'paid',
        items: [
          { room_id: 4, room_name: 'Mars (301)', subtotal: 1000, price: 500, quantity: 2 }
        ]
      };

      const totals = receiptUtils.getReceiptTotals(posBooking);
      assert.equal(totals.grossSubtotal, 1000);
      assert.equal(totals.hasDiscount, true);
      assert.equal(totals.discountAmount, 100);
      assert.equal(totals.discountLabel, 'ส่วนลด (10%)');
      assert.notEqual(totals.discountLabel, 'ส่วนลดจองออนไลน์ 5%');
    });

    test('Full price POS booking displays zero discount', () => {
      const fullPriceBooking = {
        id: 103,
        booking_source: 'walk-in',
        booking_channel: 'pos_web',
        customer_type: 'walkin',
        subtotal_amount: 1000,
        discount_type: 'none',
        discount_value: 0,
        discount_amount: 0,
        total_amount: 1000,
        paid_amount: 1000,
        balance_amount: 0,
        payment_status: 'paid'
      };

      const totals = receiptUtils.getReceiptTotals(fullPriceBooking);
      assert.equal(totals.grossSubtotal, 1000);
      assert.equal(totals.hasDiscount, false);
      assert.equal(totals.discountAmount, 0);
    });
  });

  describe('2. Admin Settings & Time Boundary Validation', () => {
    const START_TIME_MS = Date.parse('2026-10-13T08:00:00+07:00');
    const BEFORE_START_MS = START_TIME_MS - 3600000;
    const AFTER_START_MS = START_TIME_MS + 3600000;

    test('Status before 13 Oct 2026 08:00 is "upcoming" (รอเปิดใช้งาน) and activation is disabled', () => {
      const promo = { is_enabled: false };
      const status = onlinePromotionHelper.getPromotionStatus(promo, BEFORE_START_MS);
      assert.equal(status.status, 'upcoming');
      assert.equal(status.label, 'รอเปิดใช้งาน');

      const canActivate = onlinePromotionHelper.canActivatePromotion(promo, BEFORE_START_MS);
      assert.equal(canActivate.allowed, false);
      assert.match(canActivate.reason, /ยังไม่ถึงเวลาเปิดใช้งานโปรโมชั่น/);
    });

    test('Status after 13 Oct 2026 08:00 before Admin clicks activate is "ready" (พร้อมเปิดใช้งาน)', () => {
      const promo = { is_enabled: false };
      const status = onlinePromotionHelper.getPromotionStatus(promo, AFTER_START_MS);
      assert.equal(status.status, 'ready');
      assert.equal(status.label, 'พร้อมเปิดใช้งาน');

      const canActivate = onlinePromotionHelper.canActivatePromotion(promo, AFTER_START_MS);
      assert.equal(canActivate.allowed, true);
    });

    test('Status when Admin enables is "active" (กำลังใช้งาน)', () => {
      const promo = { is_enabled: true };
      const status = onlinePromotionHelper.getPromotionStatus(promo, AFTER_START_MS);
      assert.equal(status.status, 'active');
      assert.equal(status.label, 'กำลังใช้งาน');
    });

    test('Manual deactivation returns status to "ready" (พร้อมเปิดใช้งาน)', () => {
      const promo = { is_enabled: false, deactivated_at: '2026-10-15T10:00:00' };
      const status = onlinePromotionHelper.getPromotionStatus(promo, AFTER_START_MS);
      assert.equal(status.status, 'ready');
      assert.equal(status.label, 'พร้อมเปิดใช้งาน');
    });

    test('Expired promotion returns status "ended" (สิ้นสุดแล้ว)', () => {
      const promo = { is_enabled: true, end_at: '2026-10-20T00:00:00+07:00' };
      const pastEndMs = Date.parse('2026-10-21T00:00:00+07:00');
      const status = onlinePromotionHelper.getPromotionStatus(promo, pastEndMs);
      assert.equal(status.status, 'ended');
      assert.equal(status.label, 'สิ้นสุดแล้ว');
    });
  });

  describe('3. Booking App (Client) Promotion Calculation Parity', () => {
    test('Client-side calculateOnlineBookingPricing matches server behavior exactly', () => {
      const activePromo = { is_active: true };

      // Case 1: ฿1,000
      const r1 = bookingAppPromoHelper.calculateOnlineBookingPricing({
        subtotal: 1000,
        promo: activePromo
      });
      assert.equal(r1.subtotal_amount, 1000);
      assert.equal(r1.discount_amount, 50);
      assert.equal(r1.total_amount, 950);
      assert.equal(r1.is_promotion_applied, true);

      // Case 2: ฿550
      const r2 = bookingAppPromoHelper.calculateOnlineBookingPricing({
        subtotal: 550,
        promo: activePromo
      });
      assert.equal(r2.subtotal_amount, 550);
      assert.equal(r2.discount_amount, 27.5);
      assert.equal(r2.total_amount, 522.5);
      assert.equal(r2.is_promotion_applied, true);

      // Case 3: Inactive promo
      const r3 = bookingAppPromoHelper.calculateOnlineBookingPricing({
        subtotal: 1000,
        promo: { is_active: false }
      });
      assert.equal(r3.subtotal_amount, 1000);
      assert.equal(r3.discount_amount, 0);
      assert.equal(r3.total_amount, 1000);
      assert.equal(r3.is_promotion_applied, false);
    });

    test('Booking Form Page summary data structures accurately model breakdown', () => {
      const pricing = bookingAppPromoHelper.calculateOnlineBookingPricing({
        subtotal: 1000,
        promo: { is_active: true }
      });

      const summaryLines = [
        { label: 'ค่าบริการห้องประชุม', amount: pricing.subtotal_amount },
        ...(pricing.is_promotion_applied ? [{ label: 'ส่วนลดจองออนไลน์ 5%', amount: -pricing.discount_amount }] : []),
        { label: 'ยอดชำระสุทธิ', amount: pricing.total_amount }
      ];

      assert.equal(summaryLines.length, 3);
      assert.equal(summaryLines[0].amount, 1000);
      assert.equal(summaryLines[1].amount, -50);
      assert.equal(summaryLines[2].amount, 950);
    });
  });

  describe('4. Historical Snapshot Preservation on Client Reload', () => {
    test('Receipt preserves historical discount even when global promo is disabled', () => {
      const historicalBooking = {
        booking_source: 'online',
        booking_channel: 'line_oa',
        subtotal_amount: 1000,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 50,
        total_amount: 950,
        paid_amount: 950,
        balance_amount: 0,
        payment_status: 'paid'
      };

      const receipt = receiptUtils.getReceiptTotals(historicalBooking);
      assert.equal(receipt.hasDiscount, true);
      assert.equal(receipt.discountAmount, 50);
      assert.equal(receipt.netTotal, 950);
      assert.equal(receipt.discountLabel, 'ส่วนลดจองออนไลน์ 5%');
    });
  });
});
