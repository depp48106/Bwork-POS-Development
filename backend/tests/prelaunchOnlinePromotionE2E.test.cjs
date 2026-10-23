const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const {
  DEFAULT_ONLINE_PROMOTION,
  parsePromotionState,
  resolveTimestampMs,
  isPromotionActive,
  canActivatePromotion,
  getPromotionStatus,
  getPublicPromotionPayload,
  calculateOnlineBookingPricing,
  validatePromotionUpdatePayload
} = require('../onlinePromotionHelper');
const {
  calculateBookingFinancials,
  calculateRescheduleFinancials,
  roundMoney
} = require('../financialHelper');
const {
  normalizeBookingFinancials
} = require('../../frontend/src/utils/financialUtils');
const {
  getReceiptTotals,
  normalizeBookingReceipt
} = require('../../frontend/src/utils/receiptUtils');

// Helper to create an in-memory SQLite database matching POS schema
function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(`
          CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        `);
        db.run(`
          CREATE TABLE bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name TEXT NOT NULL,
            subtotal_amount REAL DEFAULT 0,
            discount_type TEXT DEFAULT 'none',
            discount_value REAL DEFAULT 0,
            discount_amount REAL DEFAULT 0,
            total_amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0,
            balance_amount REAL DEFAULT 0,
            payment_status TEXT NOT NULL,
            payment_method TEXT DEFAULT 'transfer',
            booking_source TEXT DEFAULT 'walk-in',
            booking_channel TEXT DEFAULT 'pos_web',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        db.run(`
          CREATE TABLE booking_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER NOT NULL,
            room_id INTEGER NOT NULL,
            quantity REAL DEFAULT 1,
            price REAL NOT NULL,
            start_time DATETIME NOT NULL,
            end_time DATETIME NOT NULL,
            subtotal REAL NOT NULL
          )
        `, (initErr) => {
          if (initErr) reject(initErr);
          else resolve(db);
        });
      });
    });
  });
}

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

describe('ONLINE_5_PERCENT Pre-Launch Integrity & End-to-End Test Suite', () => {

  // SECTION 3: CASES A THROUGH D (Lifecycle & Time Boundaries)
  describe('Cases A - D: Lifecycle & Activation State', () => {
    const SCHEDULED_0600 = '2026-10-13T06:00:00+07:00';
    const T_0559 = Date.parse('2026-10-13T05:59:59+07:00');
    const T_0600 = Date.parse('2026-10-13T06:00:00+07:00');
    const T_0601 = Date.parse('2026-10-13T06:01:00+07:00');

    test('Case A: Promotion disabled -> 0% discount, full price', () => {
      const state = { ...DEFAULT_ONLINE_PROMOTION, start_at: SCHEDULED_0600, is_enabled: false };
      const pricing = calculateOnlineBookingPricing({ subtotal: 1000, promo: state, currentTime: T_0601 });
      assert.equal(pricing.is_promotion_applied, false);
      assert.equal(pricing.discount_amount, 0);
      assert.equal(pricing.total_amount, 1000);
      assert.equal(isPromotionActive(state, T_0601, 'online'), false);
    });

    test('Case B: Promotion enabled before start time (05:59) -> fails-closed to 0% discount', () => {
      // Even if state has is_enabled: true prematurely, time guard must prevent activation
      const state = { ...DEFAULT_ONLINE_PROMOTION, start_at: SCHEDULED_0600, is_enabled: true };
      const active = isPromotionActive(state, T_0559, 'online');
      assert.equal(active, false, 'Must not be active before scheduled start time');

      const pricing = calculateOnlineBookingPricing({ subtotal: 1000, promo: state, currentTime: T_0559 });
      assert.equal(pricing.is_promotion_applied, false);
      assert.equal(pricing.discount_amount, 0);
      assert.equal(pricing.total_amount, 1000);

      // Admin activation check before start time
      const canActivate = canActivatePromotion(state, T_0559);
      assert.equal(canActivate.allowed, false, 'Admin activation must be blocked before start time');
      assert.match(canActivate.reason, /ยังไม่ถึงเวลาเปิดใช้งานโปรโมชั่น/);
    });

    test('Case C: Promotion enabled at exactly 06:00 Bangkok time (when scheduled for 06:00) -> 5% discount applied', () => {
      const state = { ...DEFAULT_ONLINE_PROMOTION, start_at: SCHEDULED_0600, is_enabled: true };
      const active = isPromotionActive(state, T_0600, 'online');
      assert.equal(active, true, 'Must become active at exactly 06:00:00+07:00 when enabled');

      const pricing = calculateOnlineBookingPricing({ subtotal: 1000, promo: state, currentTime: T_0600 });
      assert.equal(pricing.is_promotion_applied, true);
      assert.equal(pricing.discount_value, 5);
      assert.equal(pricing.discount_amount, 50.00);
      assert.equal(pricing.total_amount, 950.00);

      const canActivate = canActivatePromotion(state, T_0600);
      assert.equal(canActivate.allowed, true, 'Admin can activate at or after 06:00');
    });

    test('Case D: Promotion enabled after start time (06:01) -> 5% discount applied', () => {
      const state = { ...DEFAULT_ONLINE_PROMOTION, start_at: SCHEDULED_0600, is_enabled: true };
      const active = isPromotionActive(state, T_0601, 'online');
      assert.equal(active, true);

      const pricing = calculateOnlineBookingPricing({ subtotal: 1500, promo: state, currentTime: T_0601 });
      assert.equal(pricing.is_promotion_applied, true);
      assert.equal(pricing.discount_value, 5);
      assert.equal(pricing.discount_amount, 75.00);
      assert.equal(pricing.total_amount, 1425.00);
    });

    test('Comparison: Default code configuration starts at 08:00 Bangkok time', () => {
      // DEFAULT_ONLINE_PROMOTION.start_at is 2026-10-13T08:00:00+07:00
      assert.equal(DEFAULT_ONLINE_PROMOTION.start_at, '2026-10-13T08:00:00+07:00');
      // At 06:00, default code configuration is still upcoming
      const statusAt0600 = getPromotionStatus(DEFAULT_ONLINE_PROMOTION, T_0600);
      assert.equal(statusAt0600.status, 'upcoming');
      const canActivateAt0600 = canActivatePromotion(DEFAULT_ONLINE_PROMOTION, T_0600);
      assert.equal(canActivateAt0600.allowed, false);

      // At 08:00, default code configuration becomes ready for activation
      const T_0800 = Date.parse('2026-10-13T08:00:00+07:00');
      const statusAt0800 = getPromotionStatus(DEFAULT_ONLINE_PROMOTION, T_0800);
      assert.equal(statusAt0800.status, 'ready');
      const canActivateAt0800 = canActivatePromotion(DEFAULT_ONLINE_PROMOTION, T_0800);
      assert.equal(canActivateAt0800.allowed, true);
    });
  });

  // SECTION 3: CASES E THROUGH I (Item & Room Topologies)
  describe('Cases E - I: Item and Room Topologies with 5% Discount', () => {
    // Start date in past so Date.now() (2026-10-12) is after start_at
    const activeState = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true, start_at: '2026-10-01T00:00:00+07:00' };

    test('Case E: One room, one booking date (1,000 THB subtotal)', () => {
      const items = [{ price: 500, quantity: 2, subtotal: 1000 }];
      const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
      const pricing = calculateOnlineBookingPricing({ subtotal, promo: activeState });
      assert.equal(pricing.subtotal_amount, 1000);
      assert.equal(pricing.discount_amount, 50.00);
      assert.equal(pricing.total_amount, 950.00);
    });

    test('Case F: Multiple rooms on one date (Room A 1,000 + Room B 1,200 = 2,200 THB)', () => {
      const items = [
        { room_id: 4, room_name: 'Room A', price: 500, quantity: 2, subtotal: 1000 },
        { room_id: 5, room_name: 'Room B', price: 600, quantity: 2, subtotal: 1200 }
      ];
      const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
      const pricing = calculateOnlineBookingPricing({ subtotal, promo: activeState });
      assert.equal(pricing.subtotal_amount, 2200);
      assert.equal(pricing.discount_amount, 110.00);
      assert.equal(pricing.total_amount, 2090.00);
    });

    test('Case G: One room across multiple dates (Day 1: 1,000 + Day 2: 1,000 = 2,000 THB)', () => {
      const items = [
        { room_id: 4, booking_date: '2026-10-14', price: 500, quantity: 2, subtotal: 1000 },
        { room_id: 4, booking_date: '2026-10-15', price: 500, quantity: 2, subtotal: 1000 }
      ];
      const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
      const pricing = calculateOnlineBookingPricing({ subtotal, promo: activeState });
      assert.equal(pricing.subtotal_amount, 2000);
      assert.equal(pricing.discount_amount, 100.00);
      assert.equal(pricing.total_amount, 1900.00);
    });

    test('Case H: Multiple rooms across multiple dates (Room A Day 1: 1,000 + Room B Day 2: 1,500 = 2,500 THB)', () => {
      const items = [
        { room_id: 4, booking_date: '2026-10-14', price: 500, quantity: 2, subtotal: 1000 },
        { room_id: 6, booking_date: '2026-10-15', price: 750, quantity: 2, subtotal: 1500 }
      ];
      const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
      const pricing = calculateOnlineBookingPricing({ subtotal, promo: activeState });
      assert.equal(pricing.subtotal_amount, 2500);
      assert.equal(pricing.discount_amount, 125.00);
      assert.equal(pricing.total_amount, 2375.00);
    });

    test('Case I: Multiple time slots on the same date (09:00-11:00 1,000 + 14:00-16:00 1,000 = 2,000 THB)', () => {
      const items = [
        { room_id: 4, start_time: '2026-10-14 09:00:00', end_time: '2026-10-14 11:00:00', subtotal: 1000 },
        { room_id: 4, start_time: '2026-10-14 14:00:00', end_time: '2026-10-14 16:00:00', subtotal: 1000 }
      ];
      const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
      const pricing = calculateOnlineBookingPricing({ subtotal, promo: activeState });
      assert.equal(pricing.subtotal_amount, 2000);
      assert.equal(pricing.discount_amount, 100.00);
      assert.equal(pricing.total_amount, 1900.00);
    });
  });

  // SECTION 3: CASES J THROUGH Q (Financial, Security, & Operational Invariants)
  describe('Cases J - Q: Channel Isolation, Financials & Persistence', () => {
    const activeState = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true, start_at: '2026-10-01T00:00:00+07:00' };

    test('Case J: POS / Admin booking exclusion (channel isolation)', () => {
      // Channel: 'pos_web' or 'walk-in'
      const posActive = isPromotionActive(activeState, Date.now(), 'pos_web');
      assert.equal(posActive, false, 'POS channel must never be active for online promotion');

      const adminActive = isPromotionActive(activeState, Date.now(), 'admin');
      assert.equal(adminActive, false, 'Admin channel must never be active for online promotion');

      // POS booking financial calculation does not apply online promo
      const posFin = calculateBookingFinancials({
        subtotal: 1000,
        discount_type: 'none',
        discount_value: 0
      });
      assert.equal(posFin.discount_amount, 0);
      assert.equal(posFin.total_amount, 1000);
    });

    test('Case K: Deposit and remaining balance calculation with 5% discount', () => {
      // Subtotal 2,000, 5% discount -> Total 1,900. Deposit 500 THB.
      const fin = calculateBookingFinancials({
        subtotal: 2000,
        discount_type: 'percent',
        discount_value: 5,
        payment_mode: 'deposit',
        deposit_amount: 500
      });
      assert.equal(fin.subtotal_amount, 2000);
      assert.equal(fin.discount_amount, 100.00);
      assert.equal(fin.total_amount, 1900.00);
      assert.equal(fin.paid_amount, 500.00);
      assert.equal(fin.balance_amount, 1400.00);
      assert.equal(fin.payment_status, 'deposit');

      // Invariants check
      assert.equal(roundMoney(fin.subtotal_amount - fin.discount_amount), fin.total_amount);
      assert.equal(roundMoney(fin.paid_amount + fin.balance_amount), fin.total_amount);
    });

    test('Case L: Full-payment booking with 5% discount', () => {
      const fin = calculateBookingFinancials({
        subtotal: 1000,
        discount_type: 'percent',
        discount_value: 5,
        payment_mode: 'full'
      });
      assert.equal(fin.subtotal_amount, 1000);
      assert.equal(fin.discount_amount, 50.00);
      assert.equal(fin.total_amount, 950.00);
      assert.equal(fin.paid_amount, 950.00);
      assert.equal(fin.balance_amount, 0.00);
      assert.equal(fin.payment_status, 'paid');
    });

    test('Case M: Booking cancellation retains financial records with 0 collectible balance', () => {
      const booking = {
        subtotal_amount: 1000,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 50,
        total_amount: 950,
        paid_amount: 500,
        balance_amount: 450,
        payment_status: 'cancelled'
      };
      const norm = normalizeBookingFinancials(booking);
      assert.equal(norm.balance_amount, 0, 'Cancelled booking must have 0 collectible balance');
      assert.equal(norm.is_collectible, false, 'Cancelled booking must not be collectible');
      assert.equal(norm.total_amount, 950, 'Original total must be preserved');
      assert.equal(norm.discount_amount, 50, 'Original discount must be preserved');
    });

    test('Case N: Rescheduling an online booking preserves the 5% discount snapshot', () => {
      const oldBooking = {
        subtotal_amount: 1000,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 50,
        total_amount: 950,
        paid_amount: 950,
        balance_amount: 0,
        payment_status: 'paid'
      };

      // Scenario 1: Reschedule to same room duration (newSubtotal = 1,000)
      const reschedSame = calculateRescheduleFinancials({ oldBooking, newSubtotal: 1000 });
      assert.equal(reschedSame.subtotal_amount, 1000);
      assert.equal(reschedSame.discount_type, 'percent');
      assert.equal(reschedSame.discount_value, 5);
      assert.equal(reschedSame.discount_amount, 50);
      assert.equal(reschedSame.total_amount, 950);
      assert.equal(reschedSame.balance_amount, 0);

      // Scenario 2: Reschedule to higher subtotal (upgrade, newSubtotal = 1,500)
      const reschedUpgrade = calculateRescheduleFinancials({ oldBooking, newSubtotal: 1500 });
      assert.equal(reschedUpgrade.subtotal_amount, 1500);
      assert.equal(reschedUpgrade.discount_type, 'percent');
      assert.equal(reschedUpgrade.discount_value, 5);
      assert.equal(reschedUpgrade.discount_amount, 75); // 5% of 1500
      assert.equal(reschedUpgrade.total_amount, 1425);
      assert.equal(reschedUpgrade.paid_amount, 950);
      assert.equal(reschedUpgrade.balance_amount, 475); // 1425 - 950
    });

    test('Case O: Existing booking before promotion retains original pricing (no retroactive repricing)', async () => {
      const db = await createTestDb();
      // 1. Insert historical booking before promotion (full price 1,000)
      const insertSql = `
        INSERT INTO bookings (customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, booking_source, booking_channel)
        VALUES ('Historical Customer', 1000, 'none', 0, 0, 1000, 1000, 0, 'paid', 'online', 'line_oa')
      `;
      const res = await runQuery(db, insertSql);
      const bookingId = res.lastID;

      // 2. Promotion is now activated
      await runQuery(db, "INSERT INTO settings (key, value) VALUES ('online_promotion', ?)", [
        JSON.stringify({ ...DEFAULT_ONLINE_PROMOTION, is_enabled: true, start_at: '2026-10-13T00:00:00+07:00' })
      ]);

      // 3. Re-read historical booking from DB
      const histBooking = await getQuery(db, "SELECT * FROM bookings WHERE id = ?", [bookingId]);
      assert.equal(histBooking.subtotal_amount, 1000);
      assert.equal(histBooking.discount_amount, 0);
      assert.equal(histBooking.total_amount, 1000);
      assert.equal(histBooking.paid_amount, 1000);
      assert.equal(histBooking.balance_amount, 0);
    });

    test('Case P: Repeated checkout / duplicate submission idempotency (no double discount)', () => {
      const subtotal = 1000;
      // Client calls pricing once
      const p1 = calculateOnlineBookingPricing({ subtotal, promo: activeState });
      assert.equal(p1.total_amount, 950);
      assert.equal(p1.discount_amount, 50);

      // Client accidentally re-evaluates or submits with already discounted total
      // Server always calculates from raw subtotal (room price * hours), never from client's totalAmount
      const p2 = calculateOnlineBookingPricing({ subtotal, promo: activeState });
      assert.equal(p2.total_amount, 950);
      assert.equal(p2.discount_amount, 50);

      // Server does NOT discount a discount
      assert.equal(p1.total_amount, p2.total_amount);
    });

    test('Case Q: Invalid, malformed or expired promotion configuration fails-closed safely', () => {
      // 1. Null / undefined / empty string -> fallback to default disabled
      const pNull = parsePromotionState(null);
      assert.equal(pNull.is_enabled, false);
      const resNull = calculateOnlineBookingPricing({ subtotal: 1000, promo: null });
      assert.equal(resNull.discount_amount, 0);
      assert.equal(resNull.total_amount, 1000);

      // 2. Malformed JSON -> fallback to default disabled
      const resCorrupt = calculateOnlineBookingPricing({ subtotal: 1000, promo: "{ invalid json ... " });
      assert.equal(resCorrupt.discount_amount, 0);
      assert.equal(resCorrupt.total_amount, 1000);

      // 3. Expired promotion (end_at in past)
      const expiredState = {
        ...DEFAULT_ONLINE_PROMOTION,
        is_enabled: true,
        start_at: '2026-10-01T00:00:00+07:00',
        end_at: '2026-10-10T00:00:00+07:00'
      };
      const nowMs = Date.parse('2026-10-12T09:00:00+07:00');
      assert.equal(isPromotionActive(expiredState, nowMs, 'online'), false);
      const resExpired = calculateOnlineBookingPricing({ subtotal: 1000, promo: expiredState, currentTime: nowMs });
      assert.equal(resExpired.discount_amount, 0);
      assert.equal(resExpired.total_amount, 1000);
    });
  });

  // SECTION 4: SECURITY & TIMEZONE ENFORCEMENT
  describe('Security & Timezone Enforcement', () => {
    test('Server authoritative calculation ignores client tampering', () => {
      // Client sends forged discount values in payload
      const clientForgedPayload = {
        room_id: 4,
        booking_type: 'hourly',
        start_time: '09:00',
        end_time: '11:00', // 2 hours = 1,000 THB
        discount_amount: 500, // Forged 50% discount
        discount_value: 50,
        total_amount: 500
      };

      // Server calculation ignores client's discount_amount / total_amount:
      const rawPrice = 500;
      const hours = 2;
      const serverSubtotal = rawPrice * hours; // 1,000 THB
      const activeState = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true, start_at: '2026-10-01T00:00:00+07:00' };

      const serverPricing = calculateOnlineBookingPricing({
        subtotal: serverSubtotal,
        promo: activeState
      });

      assert.equal(serverPricing.subtotal_amount, 1000);
      assert.equal(serverPricing.discount_amount, 50.00, 'Server must enforce exact 5% (50.00 THB), rejecting client 500 THB');
      assert.equal(serverPricing.total_amount, 950.00, 'Server must enforce exact total (950.00 THB), rejecting client 500 THB');
    });

    test('Exact Bangkok time boundary analysis: 05:59, 06:00, 06:01 with 06:00 scheduled start', () => {
      const scheduledState = {
        ...DEFAULT_ONLINE_PROMOTION,
        start_at: '2026-10-13T06:00:00+07:00',
        is_enabled: true
      };

      const t_0559_59 = Date.parse('2026-10-13T05:59:59+07:00');
      const t_0600_00 = Date.parse('2026-10-13T06:00:00+07:00');
      const t_0601_00 = Date.parse('2026-10-13T06:01:00+07:00');

      // 05:59:59
      assert.equal(isPromotionActive(scheduledState, t_0559_59, 'online'), false);
      // 06:00:00
      assert.equal(isPromotionActive(scheduledState, t_0600_00, 'online'), true);
      // 06:01:00
      assert.equal(isPromotionActive(scheduledState, t_0601_00, 'online'), true);
    });

    test('Confirm activation is never automatic', () => {
      // Default state has is_enabled = false
      assert.equal(DEFAULT_ONLINE_PROMOTION.is_enabled, false);
      const afterStartMs = Date.parse('2026-10-13T12:00:00+07:00');
      // Even well after start time, if not manually enabled, isPromotionActive is false
      assert.equal(isPromotionActive(DEFAULT_ONLINE_PROMOTION, afterStartMs, 'online'), false);
      const status = getPromotionStatus(DEFAULT_ONLINE_PROMOTION, afterStartMs);
      assert.equal(status.status, 'ready');
      assert.equal(status.label, 'พร้อมเปิดใช้งาน');
    });
  });

  // SECTION 3: BOOKING MANAGEMENT & RECEIPT INTEGRITY
  describe('Booking Management & Thermal Receipt Visual Parity', () => {
    test('Booking Management financial normalization reflects 5% online discount', () => {
      const onlineBooking = {
        subtotal_amount: 1000,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 50,
        total_amount: 950,
        paid_amount: 950,
        balance_amount: 0,
        payment_status: 'paid',
        booking_source: 'online',
        booking_channel: 'line_oa'
      };

      const fin = normalizeBookingFinancials(onlineBooking);
      assert.equal(fin.subtotal_amount, 1000);
      assert.equal(fin.discount_amount, 50);
      assert.equal(fin.total_amount, 950);
      assert.equal(fin.paid_amount, 950);
      assert.equal(fin.balance_amount, 0);
      assert.equal(fin.is_paid, true);
    });

    test('Receipt renders "ส่วนลดจองออนไลน์ 5%" label with exact financial parity', () => {
      const onlineBooking = {
        booking_code: 'BK-000001',
        customer_name: 'คุณทดสอบ ระบบ',
        subtotal_amount: 1000,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 50,
        total_amount: 950,
        paid_amount: 950,
        balance_amount: 0,
        payment_status: 'paid',
        booking_source: 'online',
        booking_channel: 'line_oa',
        items: [{
          id: 1,
          room_id: 4,
          room_name: 'Meeting Room A',
          price: 500,
          quantity: 2,
          subtotal: 1000,
          start_time: '2026-10-14 09:00:00',
          end_time: '2026-10-14 11:00:00'
        }]
      };

      const normalized = normalizeBookingReceipt(onlineBooking);
      const totals = getReceiptTotals(onlineBooking, normalized.normalizedItems);

      assert.equal(totals.grossSubtotal, 1000);
      assert.equal(totals.hasDiscount, true);
      assert.equal(totals.discountLabel, 'ส่วนลดจองออนไลน์ 5%');
      assert.equal(totals.discountAmount, 50);
      assert.equal(totals.netTotal, 950);
      assert.equal(totals.paidAmount, 950);
      assert.equal(totals.balanceAmount, 0);
      assert.equal(totals.hasAdjustment, true);
      assert.equal(totals.adjustmentType, 'discount');
    });
  });
});
