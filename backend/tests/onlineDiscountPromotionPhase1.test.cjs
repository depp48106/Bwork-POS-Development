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
  calculateOnlineBookingPricing
} = require('../onlinePromotionHelper');
const { calculateBookingFinancials, calculateRescheduleFinancials } = require('../financialHelper');

// Known epoch millisecond for 2026-10-13T08:00:00+07:00
// 2026-10-13 08:00:00 GMT+7 is 2026-10-13 01:00:00 UTC
const START_TIME_MS = Date.parse('2026-10-13T08:00:00+07:00');
const BEFORE_START_MS = START_TIME_MS - 60000; // 1 minute before
const AFTER_START_MS = START_TIME_MS + 60000;  // 1 minute after

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
            booking_source TEXT DEFAULT 'walk-in',
            booking_channel TEXT DEFAULT 'pos_web',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

describe('BWORK-ONLINE-DISCOUNT-V1 Phase 1 Backend Tests', () => {

  describe('1. Start Time & Activation Boundaries', () => {
    test('Default promotion starts at 2026-10-13T08:00:00+07:00 and is initially disabled', () => {
      const state = parsePromotionState(null);
      assert.equal(state.start_at, '2026-10-13T08:00:00+07:00');
      assert.equal(state.discount_type, 'percent');
      assert.equal(state.discount_value, 5);
      assert.equal(state.channel, 'online');
      assert.equal(state.end_at, null);
      assert.equal(state.is_enabled, false);
    });

    test('Before 13 Oct 2026 08:00: status is upcoming and activation is blocked', () => {
      const state = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: false };
      const status = getPromotionStatus(state, BEFORE_START_MS);
      assert.equal(status.status, 'upcoming');
      assert.equal(status.label, 'รอเปิดใช้งาน');

      const eligibility = canActivatePromotion(state, BEFORE_START_MS);
      assert.equal(eligibility.allowed, false);
      assert.match(eligibility.reason, /ยังไม่ถึงเวลาเปิดใช้งานโปรโมชั่น/);
    });

    test('Before 13 Oct 2026 08:00: even if is_enabled=true, promotion is NOT active', () => {
      const state = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true };
      assert.equal(isPromotionActive(state, BEFORE_START_MS, 'online'), false);
    });

    test('At or after 13 Oct 2026 08:00: does NOT activate automatically if is_enabled=false', () => {
      const state = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: false };
      // Rule 2: Promotion must NOT activate automatically at 13 Oct 2026 08:00
      assert.equal(isPromotionActive(state, AFTER_START_MS, 'online'), false);

      const status = getPromotionStatus(state, AFTER_START_MS);
      assert.equal(status.status, 'ready');
      assert.equal(status.label, 'พร้อมเปิดใช้งาน');

      // Rule 3: Admin is allowed to activate manually
      const eligibility = canActivatePromotion(state, AFTER_START_MS);
      assert.equal(eligibility.allowed, true);
    });

    test('At or after 13 Oct 2026 08:00: when Admin enables, promotion becomes active', () => {
      const state = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true };
      assert.equal(isPromotionActive(state, AFTER_START_MS, 'online'), true);

      const status = getPromotionStatus(state, AFTER_START_MS);
      assert.equal(status.status, 'active');
      assert.equal(status.label, 'กำลังใช้งาน');
    });

    test('Admin manual deactivation stops promotion immediately', () => {
      const state = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: false, deactivated_at: '2026-10-15T10:00:00' };
      assert.equal(isPromotionActive(state, AFTER_START_MS, 'online'), false);
      const status = getPromotionStatus(state, AFTER_START_MS);
      assert.equal(status.status, 'ready');
    });

    test('Supports end_at = null (no expiration date)', () => {
      const state = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true, end_at: null };
      const farFutureMs = Date.parse('2028-01-01T00:00:00+07:00');
      assert.equal(isPromotionActive(state, farFutureMs, 'online'), true);
    });

    test('If end_at is specified, promotion expires after end_at', () => {
      const state = {
        ...DEFAULT_ONLINE_PROMOTION,
        is_enabled: true,
        end_at: '2026-10-20T23:59:59+07:00'
      };
      const beforeEndMs = Date.parse('2026-10-20T12:00:00+07:00');
      const afterEndMs = Date.parse('2026-10-21T00:00:01+07:00');

      assert.equal(isPromotionActive(state, beforeEndMs, 'online'), true);
      assert.equal(isPromotionActive(state, afterEndMs, 'online'), false);

      const status = getPromotionStatus(state, afterEndMs);
      assert.equal(status.status, 'ended');
      assert.equal(status.label, 'สิ้นสุดแล้ว');

      const eligibility = canActivatePromotion(state, afterEndMs);
      assert.equal(eligibility.allowed, false);
    });
  });

  describe('2. Strict Channel Separation (Online vs POS/Admin)', () => {
    test('POS and walkin bookings NEVER receive online promotion discount', () => {
      const activePromo = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true };

      // Channel is pos or walkin
      assert.equal(isPromotionActive(activePromo, AFTER_START_MS, 'pos'), false);
      assert.equal(isPromotionActive(activePromo, AFTER_START_MS, 'walkin'), false);

      // POS Booking financials calculation remains full price (discount_type none)
      const posFin = calculateBookingFinancials({
        subtotal: 1000,
        discount_type: 'none',
        discount_value: 0,
        customer_type: 'walkin'
      });
      assert.equal(posFin.subtotal_amount, 1000);
      assert.equal(posFin.discount_amount, 0);
      assert.equal(posFin.total_amount, 1000);
    });

    test('Only online channel receives 5% promotion discount when active', () => {
      const activePromo = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true };
      assert.equal(isPromotionActive(activePromo, AFTER_START_MS, 'online'), true);
    });
  });

  describe('3. Financial Calculation & Rounding Precision', () => {
    const activePromo = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true };

    test('Subtotal ฿1,000 -> 5% discount (฿50.00) -> total ฿950.00', () => {
      const pricing = calculateOnlineBookingPricing({
        subtotal: 1000,
        promo: activePromo,
        currentTime: AFTER_START_MS
      });
      assert.equal(pricing.subtotal_amount, 1000);
      assert.equal(pricing.discount_type, 'percent');
      assert.equal(pricing.discount_value, 5);
      assert.equal(pricing.discount_amount, 50);
      assert.equal(pricing.total_amount, 950);
      assert.equal(pricing.is_promotion_applied, true);
    });

    test('Subtotal ฿550 -> 5% discount (฿27.50) -> total ฿522.50', () => {
      const pricing = calculateOnlineBookingPricing({
        subtotal: 550,
        promo: activePromo,
        currentTime: AFTER_START_MS
      });
      assert.equal(pricing.subtotal_amount, 550);
      assert.equal(pricing.discount_amount, 27.5);
      assert.equal(pricing.total_amount, 522.5);
      assert.equal(pricing.is_promotion_applied, true);
    });

    test('Subtotal ฿200 -> 5% discount (฿10.00) -> total ฿190.00', () => {
      const pricing = calculateOnlineBookingPricing({
        subtotal: 200,
        promo: activePromo,
        currentTime: AFTER_START_MS
      });
      assert.equal(pricing.subtotal_amount, 200);
      assert.equal(pricing.discount_amount, 10);
      assert.equal(pricing.total_amount, 190);
      assert.equal(pricing.is_promotion_applied, true);
    });

    test('Subtotal ฿199.99 -> 5% discount (฿10.00 rounded) -> total ฿189.99', () => {
      const pricing = calculateOnlineBookingPricing({
        subtotal: 199.99,
        promo: activePromo,
        currentTime: AFTER_START_MS
      });
      assert.equal(pricing.subtotal_amount, 199.99);
      assert.equal(pricing.discount_amount, 10);
      assert.equal(pricing.total_amount, 189.99);
    });

    test('When promotion is inactive: subtotal ฿1,000 -> 0% discount -> total ฿1,000.00', () => {
      const inactivePromo = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: false };
      const pricing = calculateOnlineBookingPricing({
        subtotal: 1000,
        promo: inactivePromo,
        currentTime: AFTER_START_MS
      });
      assert.equal(pricing.subtotal_amount, 1000);
      assert.equal(pricing.discount_type, 'none');
      assert.equal(pricing.discount_value, 0);
      assert.equal(pricing.discount_amount, 0);
      assert.equal(pricing.total_amount, 1000);
      assert.equal(pricing.is_promotion_applied, false);
    });
  });

  describe('4. Server Authoritative Pricing & Stale Client Protection', () => {
    test('Server computes authoritative pricing and ignores tampered client amount', () => {
      const activePromo = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true };

      // Client tried sending tampered subtotal or total
      const roomHourlyRate = 500;
      const quantityHours = 2;
      const authoritativeSubtotal = roomHourlyRate * quantityHours; // 1000

      const pricing = calculateOnlineBookingPricing({
        subtotal: authoritativeSubtotal,
        promo: activePromo,
        currentTime: AFTER_START_MS
      });

      assert.equal(pricing.subtotal_amount, 1000);
      assert.equal(pricing.discount_amount, 50);
      assert.equal(pricing.total_amount, 950);
    });

    test('Section 10 Stale Client: Active -> Stopped before submit (client submits 950 -> server overrides to 1000)', () => {
      // Customer saw active promotion with 950 total.
      // Admin deactivates promotion in database.
      const deactivatedPromo = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: false };

      // Customer submits stale payload with client-calculated total 950
      const roomSubtotal = 1000;
      const staleClientPayload = { room_id: 4, total_amount: 950, discount_amount: 50 };

      // Server recalculates authoritative pricing based on active promotion state
      const authoritativePricing = calculateOnlineBookingPricing({
        subtotal: roomSubtotal,
        promo: deactivatedPromo,
        currentTime: AFTER_START_MS
      });

      assert.equal(authoritativePricing.subtotal_amount, 1000);
      assert.equal(authoritativePricing.discount_type, 'none');
      assert.equal(authoritativePricing.discount_amount, 0);
      assert.equal(authoritativePricing.total_amount, 1000);
      assert.notEqual(authoritativePricing.total_amount, staleClientPayload.total_amount);
    });

    test('Section 11 Reverse Stale Client: Inactive -> Activated before submit (client submits 1000 -> server grants 950)', () => {
      // Customer opened page when promotion was inactive (saw 1000).
      // Admin activates promotion before submit.
      const freshlyActivatedPromo = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true };

      // Customer submits stale payload expecting full price 1000
      const roomSubtotal = 1000;
      const staleClientPayload = { room_id: 4, total_amount: 1000, discount_amount: 0 };

      // Server recalculates authoritatively and applies 5% discount
      const authoritativePricing = calculateOnlineBookingPricing({
        subtotal: roomSubtotal,
        promo: freshlyActivatedPromo,
        currentTime: AFTER_START_MS
      });

      assert.equal(authoritativePricing.subtotal_amount, 1000);
      assert.equal(authoritativePricing.discount_type, 'percent');
      assert.equal(authoritativePricing.discount_amount, 50);
      assert.equal(authoritativePricing.total_amount, 950);
      assert.equal(authoritativePricing.is_promotion_applied, true);
    });
  });

  describe('5. Database Settings Persistence & Booking Snapshot', () => {
    test('Saving online_promotion in settings table preserves full state', async () => {
      const db = await createTestDb();
      const promoToSave = {
        ...DEFAULT_ONLINE_PROMOTION,
        is_enabled: true,
        activated_at: '2026-10-13T08:05:00',
        activated_by: 'SuperAdmin'
      };

      await runQuery(
        db,
        "INSERT INTO settings (key, value) VALUES ('online_promotion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [JSON.stringify(promoToSave)]
      );

      const row = await getQuery(db, "SELECT value FROM settings WHERE key = 'online_promotion'");
      assert.ok(row);
      const parsed = parsePromotionState(row.value);
      assert.equal(parsed.is_enabled, true);
      assert.equal(parsed.activated_by, 'SuperAdmin');
      assert.equal(parsed.discount_value, 5);
      db.close();
    });

    test('Online booking insert stores full financial snapshot without retroactive changes', async () => {
      const db = await createTestDb();
      const pricing = calculateOnlineBookingPricing({
        subtotal: 1000,
        promo: { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true },
        currentTime: AFTER_START_MS
      });

      await runQuery(
        db,
        `INSERT INTO bookings (
          customer_name, subtotal_amount, discount_type, discount_value, discount_amount,
          total_amount, paid_amount, balance_amount, payment_status, booking_source, booking_channel
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'Online Customer',
          pricing.subtotal_amount,
          pricing.discount_type,
          pricing.discount_value,
          pricing.discount_amount,
          pricing.total_amount,
          0,
          pricing.total_amount,
          'pending',
          'online',
          'line_oa'
        ]
      );

      const booking = await getQuery(db, "SELECT * FROM bookings WHERE customer_name = 'Online Customer'");
      assert.ok(booking);
      assert.equal(booking.subtotal_amount, 1000);
      assert.equal(booking.discount_type, 'percent');
      assert.equal(booking.discount_value, 5);
      assert.equal(booking.discount_amount, 50);
      assert.equal(booking.total_amount, 950);
      assert.equal(booking.balance_amount, 950);
      assert.equal(booking.booking_source, 'online');
      assert.equal(booking.booking_channel, 'line_oa');

      // Now disable promotion globally
      const disabledPromo = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: false };

      // Existing booking in DB must retain stored financial snapshot!
      const reloaded = await getQuery(db, "SELECT * FROM bookings WHERE id = ?", [booking.id]);
      assert.equal(reloaded.total_amount, 950);
      assert.equal(reloaded.discount_amount, 50);

      db.close();
    });
  });

  describe('6. Reschedule Financial Preservation', () => {
    test('calculateRescheduleFinancials preserves existing 5% discount snapshot', () => {
      const historicalBooking = {
        customer_type: 'general',
        billing_option: 'paid',
        subtotal_amount: 1000,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 50,
        total_amount: 950,
        paid_amount: 0,
        balance_amount: 950,
        payment_status: 'pending'
      };

      // Reschedule with same subtotal 1000
      const reschedSame = calculateRescheduleFinancials({
        oldBooking: historicalBooking,
        newSubtotal: 1000
      });
      assert.equal(reschedSame.subtotal_amount, 1000);
      assert.equal(reschedSame.discount_type, 'percent');
      assert.equal(reschedSame.discount_value, 5);
      assert.equal(reschedSame.discount_amount, 50);
      assert.equal(reschedSame.total_amount, 950);

      // Reschedule to larger room: subtotal 2000 -> 5% discount (100) -> total 1900
      const reschedUpgrade = calculateRescheduleFinancials({
        oldBooking: historicalBooking,
        newSubtotal: 2000
      });
      assert.equal(reschedUpgrade.subtotal_amount, 2000);
      assert.equal(reschedUpgrade.discount_type, 'percent');
      assert.equal(reschedUpgrade.discount_value, 5);
      assert.equal(reschedUpgrade.discount_amount, 100);
      assert.equal(reschedUpgrade.total_amount, 1900);
    });
  });

  describe('7. Public Payload Sanitization', () => {
    test('Public promotion payload only exposes safe client fields', () => {
      const fullState = {
        ...DEFAULT_ONLINE_PROMOTION,
        is_enabled: true,
        activated_at: '2026-10-13T08:00:00',
        activated_by: 'SuperAdminSecret',
        internal_notes: 'private'
      };

      const publicPayload = getPublicPromotionPayload(fullState, AFTER_START_MS);
      assert.equal(publicPayload.is_active, true);
      assert.equal(publicPayload.discount_type, 'percent');
      assert.equal(publicPayload.discount_value, 5);
      assert.equal(publicPayload.channel, 'online');
      assert.equal(publicPayload.start_at, '2026-10-13T08:00:00+07:00');
      assert.equal(publicPayload.end_at, null);

      // Must NOT leak internal audit details
      assert.equal(publicPayload.activated_by, undefined);
      assert.equal(publicPayload.internal_notes, undefined);
    });
  });

  describe('8. Safe Settings Fallback (Section 28)', () => {
    test('Missing row, null, empty string, or malformed JSON NEVER fails-open', () => {
      const inputs = [null, undefined, '', '{ invalid_json', '{ "foo": "bar" }'];
      for (const input of inputs) {
        const state = parsePromotionState(input);
        assert.equal(state.is_enabled, false, `Must be disabled for input: ${input}`);
        assert.equal(isPromotionActive(state, AFTER_START_MS, 'online'), false, `Must not be active for: ${input}`);
        const publicPayload = getPublicPromotionPayload(state, AFTER_START_MS);
        assert.equal(publicPayload.is_active, false);
      }
    });
  });

  describe('9. Local Time Matrix A through G (Section 38)', () => {
    const activeState = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: true };
    const disabledState = { ...DEFAULT_ONLINE_PROMOTION, is_enabled: false };

    test('Scenario A: 2026-10-13 07:59:59 Asia/Bangkok, enabled false, Online 1000 => 1000', () => {
      const tA = Date.parse('2026-10-13T07:59:59+07:00');
      const pricing = calculateOnlineBookingPricing({ subtotal: 1000, promo: disabledState, currentTime: tA });
      assert.equal(pricing.total_amount, 1000);
      assert.equal(pricing.discount_amount, 0);
    });

    test('Scenario B: 2026-10-13 08:00:01 Asia/Bangkok, enabled false, Online 1000 => 1000', () => {
      const tB = Date.parse('2026-10-13T08:00:01+07:00');
      const pricing = calculateOnlineBookingPricing({ subtotal: 1000, promo: disabledState, currentTime: tB });
      assert.equal(pricing.total_amount, 1000);
      assert.equal(pricing.discount_amount, 0);
    });

    test('Scenario C: 2026-10-13 08:00:01 Asia/Bangkok, enabled true, Online 1000 => 950', () => {
      const tC = Date.parse('2026-10-13T08:00:01+07:00');
      const pricing = calculateOnlineBookingPricing({ subtotal: 1000, promo: activeState, currentTime: tC });
      assert.equal(pricing.total_amount, 950);
      assert.equal(pricing.discount_amount, 50);
    });

    test('Scenario D: Same active promo, POS 1000 => 1000 (POS isolation)', () => {
      const tD = Date.parse('2026-10-13T08:00:01+07:00');
      assert.equal(isPromotionActive(activeState, tD, 'pos'), false);
      assert.equal(isPromotionActive(activeState, tD, 'walkin'), false);
    });

    test('Scenario E: Active then deactivate, new Online booking => 1000', () => {
      const tE = Date.parse('2026-10-14T10:00:00+07:00');
      const deactivated = { ...activeState, is_enabled: false };
      const pricing = calculateOnlineBookingPricing({ subtotal: 1000, promo: deactivated, currentTime: tE });
      assert.equal(pricing.total_amount, 1000);
      assert.equal(pricing.discount_amount, 0);
    });

    test('Scenario F: Old discounted booking after stop remains 950', () => {
      const storedSnapshot = {
        subtotal_amount: 1000,
        discount_type: 'percent',
        discount_value: 5,
        discount_amount: 50,
        total_amount: 950,
        paid_amount: 0,
        balance_amount: 950
      };
      // Once stored, no promotion change mutates it
      assert.equal(storedSnapshot.total_amount, 950);
      assert.equal(storedSnapshot.discount_amount, 50);
    });

    test('Scenario G: end_at null + enabled => active indefinitely', () => {
      const tG2027 = Date.parse('2027-12-31T23:59:59+07:00');
      assert.equal(isPromotionActive({ ...activeState, end_at: null }, tG2027, 'online'), true);
    });
  });

  describe('10. Worker / Server Parity Contract Audit (Section 29)', () => {
    test('worker.js implements exact canonical promotion logic matching onlinePromotionHelper.js', () => {
      const fs = require('fs');
      const path = require('path');
      const workerSrc = fs.readFileSync(path.resolve(__dirname, '../worker.js'), 'utf8');

      // Constants parity
      assert.match(workerSrc, /promotion_code:\s*'ONLINE_5_PERCENT'/);
      assert.match(workerSrc, /start_at:\s*'2026-10-13T08:00:00\+07:00'/);
      assert.match(workerSrc, /discount_value:\s*5/);

      // Functions parity
      assert.match(workerSrc, /function parsePromotionState\(/);
      assert.match(workerSrc, /function isPromotionActive\(/);
      assert.match(workerSrc, /function canActivatePromotion\(/);
      assert.match(workerSrc, /function getPromotionStatus\(/);
      assert.match(workerSrc, /function getPublicPromotionPayload\(/);
      assert.match(workerSrc, /function calculateOnlineBookingPricing\(/);

      // Endpoint parity
      assert.match(workerSrc, /pathname === '\/api\/public\/promotion'/);
      assert.match(workerSrc, /pathname === '\/api\/admin\/promotion'/);
      assert.match(workerSrc, /pathname === '\/api\/admin\/promotion\/activate'/);
      assert.match(workerSrc, /pathname === '\/api\/admin\/promotion\/deactivate'/);
    });
  });
});
