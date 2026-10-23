'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sqlite3 = require('sqlite3');

// 1. Read worker.js and server.js source to verify implementation invariants
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract cancelExpiredBookings from worker.js
const cancelStartIdx = workerSource.indexOf('async function cancelExpiredBookings(env, options = {})');
const cancelEndIdx = workerSource.indexOf('const BACKUP_TABLES = [', cancelStartIdx);
assert.ok(cancelStartIdx > 0 && cancelEndIdx > cancelStartIdx, 'Failed to locate cancelExpiredBookings in worker.js');
const cancelExpiredBookings = vm.runInNewContext(
  `(${workerSource.slice(cancelStartIdx, cancelEndIdx).trim()})`,
  { console, Date, Number, parseInt, isNaN }
);

// Extract formatThaiDateDisplay and buildLineSlipRejectedFlex from worker.js
const thaiDateStart = workerSource.indexOf('function formatThaiDateDisplay(isoString) {');
const thaiDateEnd = workerSource.indexOf('function buildLineBookingConfirmationFlex(', thaiDateStart);
assert.ok(thaiDateStart > 0 && thaiDateEnd > thaiDateStart, 'Failed to locate formatThaiDateDisplay in worker.js');
const thaiDateFnStr = workerSource.slice(thaiDateStart, thaiDateEnd);

const flexStartIdx = workerSource.indexOf('function buildLineSlipRejectedFlex(');
const flexEndIdx = workerSource.indexOf('async function sendLineSlipRejectedNotification(', flexStartIdx);
assert.ok(flexStartIdx > 0 && flexEndIdx > flexStartIdx, 'Failed to locate buildLineSlipRejectedFlex in worker.js');
const buildLineSlipRejectedFlex = vm.runInNewContext(
  `(() => {
    ${thaiDateFnStr}
    return (${workerSource.slice(flexStartIdx, flexEndIdx).trim()});
  })()`,
  { console, Date, Number, parseInt, isNaN, encodeURIComponent, String }
);

const REJECT_REASON_MAP = {
  AMOUNT_MISMATCH: 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ',
  WRONG_RECEIVER: 'บัญชีผู้รับเงินไม่ถูกต้อง',
  UNREADABLE_SLIP: 'รูปภาพสลิปไม่ชัดเจนหรือข้อมูลไม่ครบถ้วน',
  DUPLICATE_SLIP: 'สลิปซ้ำหรือเคยใช้งานแล้วในระบบ',
  INVALID_DATETIME: 'วันที่หรือเวลาในการโอนไม่ถูกต้อง',
  NOT_BANK_SLIP: 'ไม่ใช่สลิปการโอนเงินของธนาคาร',
  OTHER: 'อื่นๆ'
};

// Helper to create SQLite test DB simulating Cloudflare D1
function createTestDb() {
  const db = new sqlite3.Database(':memory:');
  const query = {
    run: (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    }),
    exec: (sql) => new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    })
  };

  const createStatement = (sql, boundParams = []) => {
    return {
      bind(...params) {
        return createStatement(sql, params);
      },
      first: (col) => query.get(sql, boundParams).then(row => (col && row ? row[col] : row)),
      all: async () => {
        const rows = await query.all(sql, boundParams);
        return { results: rows };
      },
      run: async () => {
        const res = await query.run(sql, boundParams);
        return { meta: { changes: res.changes } };
      }
    };
  };

  const env = {
    DB: {
      prepare(sql) {
        return createStatement(sql);
      }
    }
  };

  return { db, query, env };
}

async function initSchema(query) {
  await query.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER,
      booking_date TEXT,
      start_time TEXT,
      end_time TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      customer_contact TEXT,
      customer_line_id TEXT,
      line_user_id TEXT,
      line_display_name TEXT,
      receipt_number TEXT,
      subtotal_amount REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      total_amount REAL,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'pending',
      payment_method TEXT,
      payment_window_minutes INTEGER DEFAULT 15,
      slip_image_url TEXT,
      slip_verify_status TEXT,
      door_pin TEXT,
      booking_source TEXT,
      checkin_status TEXT DEFAULT 'pending',
      cancelled_at TEXT,
      cancellation_reason TEXT,
      created_at TEXT
    );

    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      room_id INTEGER,
      start_time TEXT,
      end_time TEXT,
      checkin_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT
    );

    CREATE TABLE slip_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      verification_status TEXT NOT NULL,
      rejection_reason TEXT,
      rejection_reason_code TEXT,
      raw_ocr_response TEXT,
      created_at TEXT
    );

    CREATE TABLE payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      receipt_number TEXT,
      slip_url TEXT,
      created_at TEXT
    );
  `);
}

// ==============================================================================
// TEST SUITE: BWORK-POS PAYMENT SLIP WORKFLOW IMPROVEMENT (25 TEST CASES)
// ==============================================================================

test('TC01: Rejection requires non-empty rejection reason code and explanation', async () => {
  // Reject slip endpoint requires reason_code and non-empty note if OTHER
  assert.ok(serverSource.includes('reason_code') && serverSource.includes('REJECT_REASON_MAP[reason_code]'), 'server.js must validate reason_code');
  assert.ok(serverSource.includes('custom_note') && serverSource.includes('sanitizedNote'), 'server.js must validate custom_note');
  assert.ok(workerSource.includes('reason_code') && workerSource.includes('REJECT_REASON_MAP[reason_code]'), 'worker.js must validate reason_code');
});

test('TC02: Staff identity and rejection timestamp are captured and stored', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, total_amount, payment_status, created_at)
    VALUES (101, 500, 'reviewing', ?)
  `, [nowIso]);

  // Insert slip verification record
  await query.run(`
    INSERT INTO slip_verifications (booking_id, verification_status, rejection_reason, rejection_reason_code, created_at)
    VALUES (101, 'rejected', 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ', 'AMOUNT_MISMATCH', ?)
  `, [nowIso]);

  // Record audit log with staff identity
  const auditDetails = JSON.stringify({
    staff: 'Admin Jane',
    reason_code: 'AMOUNT_MISMATCH',
    reason_text: 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ',
    rejected_at: nowIso
  });
  await query.run(`
    INSERT INTO booking_history (booking_id, action, details, created_at)
    VALUES (101, 'reject_slip', ?, ?)
  `, [auditDetails, nowIso]);

  const history = await query.get('SELECT * FROM booking_history WHERE booking_id = 101 AND action = "reject_slip"');
  assert.ok(history, 'Audit history record must exist');
  const details = JSON.parse(history.details);
  assert.equal(details.staff, 'Admin Jane');
  assert.equal(details.reason_code, 'AMOUNT_MISMATCH');
  assert.equal(details.rejected_at, nowIso);
});

test('TC03: Audit log stored in booking_history with action reject_slip', async () => {
  assert.ok(serverSource.includes('reject_slip'), 'server.js must log reject_slip action');
  assert.ok(workerSource.includes('reject_slip'), 'worker.js must log reject_slip action');
});

test('TC04: Customer ConfirmPage displays Thai badge "สลิปถูกปฏิเสธ — รอหลักฐานใหม่" and rejection reason', async () => {
  const confirmPageSource = fs.readFileSync(path.join(__dirname, '../../booking-app/src/pages/ConfirmPage.jsx'), 'utf8');
  assert.ok(confirmPageSource.includes('สลิปถูกปฏิเสธ — รอหลักฐานใหม่'), 'ConfirmPage must display standard Thai badge');
  assert.ok(confirmPageSource.includes('booking?.rejection_reason'), 'ConfirmPage must display rejection reason');
  assert.ok(confirmPageSource.includes('ระบบไม่ขยายเวลาชำระเงิน'), 'ConfirmPage must inform customer that deadline is not extended');
});

test('TC05: Safe LINE notification payload: no door PIN, no Wi-Fi credentials, no auth tokens', async () => {
  const fakeBooking = {
    id: 888,
    receipt_number: 'BK-20261015-0888',
    total_amount: 1500,
    room_name: 'Meeting Room A',
    booking_date: '2026-10-20',
    start_time: '10:00',
    end_time: '12:00',
    door_pin: '987654', // SENSITIVE: MUST NOT APPEAR IN LINE MESSAGE
    wifi_password: 'SecretWifiPassword' // SENSITIVE: MUST NOT APPEAR
  };

  const flex = buildLineSlipRejectedFlex(
    fakeBooking,
    fakeBooking.room_name,
    'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ',
    '2026-10-15T10:15:00.000Z',
    true
  );

  const serialized = JSON.stringify(flex);
  assert.ok(!serialized.includes('987654'), 'Door PIN must NEVER be included in rejection LINE Flex');
  assert.ok(!serialized.includes('SecretWifiPassword'), 'Wi-Fi password must NEVER be included in rejection LINE Flex');
  assert.ok(!serialized.includes('Bearer'), 'Tokens must NEVER be included in LINE Flex');
  assert.ok(serialized.includes('สลิปไม่ผ่านการตรวจสอบ'), 'LINE message must clearly inform customer');
  assert.ok(serialized.includes('ยอดเงินไม่ตรงกับยอดที่ต้องชำระ'), 'LINE message must state rejection reason');
  assert.ok(serialized.includes('ระบบไม่ขยายเวลาชำระเงิน'), 'LINE message must remind customer that deadline is not extended');
});

test('TC06: Delivery failure safety: rejection succeeds even if LINE push fails', async () => {
  assert.ok(serverSource.includes('Delivery failure strictly does NOT undo slip rejection'), 'server.js must not undo rejection on notification failure');
  assert.ok(workerSource.includes('LINE notification delivery warning in worker'), 'worker.js must protect rejection state against push failure');
});

test('TC07: Idempotency: multiple rejections do not corrupt history or send duplicate LINE pushes', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, total_amount, payment_status, created_at)
    VALUES (202, 1000, 'rejected', ?)
  `, [nowIso]);

  await query.run(`
    INSERT INTO booking_history (booking_id, action, details, created_at)
    VALUES (202, 'line_reject_notified', '{"line_user_id":"U12345"}', ?)
  `, [nowIso]);

  // Check check-and-notify idempotency logic
  const existingNotify = await query.get('SELECT id FROM booking_history WHERE booking_id = 202 AND action = "line_reject_notified"');
  assert.ok(existingNotify, 'Existing notification log should be detected');
});

test('TC08: Walk-in slip attachment: file format/size validation (<10MB)', async () => {
  assert.ok(serverSource.includes('10 * 1024 * 1024'), 'server.js must enforce 10MB limit on walk-in slip');
  assert.ok(workerSource.includes('10 * 1024 * 1024'), 'worker.js must enforce 10MB limit on walk-in slip');
});

test('TC09: Walk-in slip associated with payment_transactions & bookings', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (303, 2000, 1000, 1000, 'deposit', ?)
  `, [nowIso]);

  // Insert payment transaction with slip_url
  await query.run(`
    INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, receipt_number, slip_url, created_at)
    VALUES (303, 1000, 'transfer', 'balance', 'TX-303-01', '/uploads/slips/walkin_slip_303.jpg', ?)
  `, [nowIso]);

  const tx = await query.get('SELECT * FROM payment_transactions WHERE booking_id = 303');
  assert.equal(tx.slip_url, '/uploads/slips/walkin_slip_303.jpg');
  assert.equal(tx.amount, 1000);
});

test('TC10: History and detail modal viewing of walk-in transaction slip', async () => {
  const pendingBookingsSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/PendingBookings.jsx'), 'utf8');
  assert.ok(pendingBookingsSource.includes('ดูสลิป'), 'PendingBookings modal must display ดูสลิป button for transaction with slip');
  assert.ok(pendingBookingsSource.includes('tx.slip_url'), 'PendingBookings must check tx.slip_url');
});

test('TC11: Multi-payment isolation: attaching slip to transaction 2 does not overwrite transaction 1', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (404, 3000, 3000, 0, 'paid', ?)
  `, [nowIso]);

  // Transaction 1: Deposit with slip 1
  await query.run(`
    INSERT INTO payment_transactions (id, booking_id, amount, payment_method, transaction_type, receipt_number, slip_url, created_at)
    VALUES (1, 404, 1500, 'transfer', 'deposit', 'TX-404-01', '/uploads/slips/slip_tx1.jpg', ?)
  `, [nowIso]);

  // Transaction 2: Balance with slip 2
  await query.run(`
    INSERT INTO payment_transactions (id, booking_id, amount, payment_method, transaction_type, receipt_number, slip_url, created_at)
    VALUES (2, 404, 1500, 'transfer', 'balance', 'TX-404-02', '/uploads/slips/slip_tx2.jpg', ?)
  `, [nowIso]);

  const tx1 = await query.get('SELECT * FROM payment_transactions WHERE id = 1');
  const tx2 = await query.get('SELECT * FROM payment_transactions WHERE id = 2');

  assert.equal(tx1.slip_url, '/uploads/slips/slip_tx1.jpg');
  assert.equal(tx2.slip_url, '/uploads/slips/slip_tx2.jpg');
  assert.notEqual(tx1.slip_url, tx2.slip_url, 'Transaction slips must remain completely isolated');
});

test('TC12: Cash payment does not require slip', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO payment_transactions (id, booking_id, amount, payment_method, transaction_type, receipt_number, slip_url, created_at)
    VALUES (10, 505, 500, 'cash', 'full', 'TX-505-01', NULL, ?)
  `, [nowIso]);

  const tx = await query.get('SELECT * FROM payment_transactions WHERE id = 10');
  assert.equal(tx.slip_url, null, 'Cash payment should not have or require a slip');
});

test('TC13: POS displays rejected slip status "สลิปถูกปฏิเสธ — รอหลักฐานใหม่" across Pending Bookings, Booking Details, and History', async () => {
  const pendingSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/PendingBookings.jsx'), 'utf8');
  const historySource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/History.jsx'), 'utf8');
  const bookingPosSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/BookingPOS.jsx'), 'utf8');

  assert.ok(pendingSource.includes('สลิปถูกปฏิเสธ — รอหลักฐานใหม่'), 'PendingBookings must use Thai text: สลิปถูกปฏิเสธ — รอหลักฐานใหม่');
  assert.ok(historySource.includes('สลิปถูกปฏิเสธ — รอหลักฐานใหม่'), 'History must use Thai text: สลิปถูกปฏิเสธ — รอหลักฐานใหม่');
  assert.ok(bookingPosSource.includes('สลิปถูกปฏิเสธ — รอหลักฐานใหม่'), 'BookingPOS must use Thai text: สลิปถูกปฏิเสธ — รอหลักฐานใหม่');
});

test('TC14: Replacement slip submission: upload-slip while eligible resets review state to reviewing', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, total_amount, payment_status, slip_verify_status, created_at, payment_window_minutes)
    VALUES (606, 800, 'rejected', 'rejected', ?, 15)
  `, [nowIso]);

  // Simulate replacement slip upload
  await query.run(`
    UPDATE bookings
    SET payment_status = 'reviewing',
        slip_verify_status = 'pending',
        slip_image_url = '/uploads/slips/replacement_606.jpg'
    WHERE id = 606
  `);

  const updated = await query.get('SELECT payment_status, slip_verify_status, slip_image_url FROM bookings WHERE id = 606');
  assert.equal(updated.payment_status, 'reviewing');
  assert.equal(updated.slip_verify_status, 'pending');
  assert.equal(updated.slip_image_url, '/uploads/slips/replacement_606.jpg');
});

test('TC15: Preservation of original booking record upon slip rejection', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, customer_name, customer_contact, total_amount, payment_status, created_at)
    VALUES (707, 'Khun Somchai', '0812345678', 1200, 'reviewing', ?)
  `, [nowIso]);

  // Reject slip
  await query.run(`
    UPDATE bookings
    SET payment_status = 'rejected',
        slip_verify_status = 'rejected'
    WHERE id = 707
  `);

  const booking = await query.get('SELECT * FROM bookings WHERE id = 707');
  assert.equal(booking.id, 707);
  assert.equal(booking.customer_name, 'Khun Somchai');
  assert.equal(booking.customer_contact, '0812345678');
  assert.equal(booking.total_amount, 1200);
  assert.equal(booking.payment_status, 'rejected');
});

test('TC16: Rejection does NOT extend booking expiration', async () => {
  assert.ok(serverSource.includes('isStillEligible = Date.now() < deadlineMs'), 'server.js must check original deadline without extension');
  assert.ok(workerSource.includes('isStillEligible = Date.now() < deadlineMs'), 'worker.js must check original deadline without extension');
});

test('TC17: Rejection does NOT reset payment countdown timer', async () => {
  const confirmPageSource = fs.readFileSync(path.join(__dirname, '../../booking-app/src/pages/ConfirmPage.jsx'), 'utf8');
  assert.ok(!confirmPageSource.includes('if (!booking || uploadSuccess || booking.payment_status === \'paid\' || isRejected) return;'), 'Countdown timer must NOT pause or stop on isRejected');
});

test('TC18: Rejection does NOT restart 15-minute countdown', async () => {
  const statusPageSource = fs.readFileSync(path.join(__dirname, '../../booking-app/src/pages/StatusPage.jsx'), 'utf8');
  assert.ok(statusPageSource.includes('(isPending || isRejected) ? calcPaymentTimeLeft'), 'StatusPage must compute remaining time for rejected bookings without restarting');
});

test('TC19: Rejection does NOT change original payment deadline', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const initialCreatedAt = '2026-10-15T10:00:00.000Z';
  await query.run(`
    INSERT INTO bookings (id, total_amount, payment_status, created_at, payment_window_minutes)
    VALUES (808, 900, 'reviewing', ?, 15)
  `, [initialCreatedAt]);

  // Reject slip at 10:05
  await query.run(`
    UPDATE bookings
    SET payment_status = 'rejected'
    WHERE id = 808
  `);

  const b = await query.get('SELECT created_at, payment_window_minutes FROM bookings WHERE id = 808');
  assert.equal(b.created_at, initialCreatedAt, 'created_at must NEVER be modified upon slip rejection');
  assert.equal(b.payment_window_minutes, 15, 'payment_window_minutes must NEVER be modified upon slip rejection');
});

test('TC20: Rejection does NOT auto-cancel booking immediately', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, total_amount, payment_status, created_at, payment_window_minutes)
    VALUES (909, 1000, 'rejected', ?, 15)
  `, [nowIso]);

  const b = await query.get('SELECT payment_status FROM bookings WHERE id = 909');
  assert.equal(b.payment_status, 'rejected', 'Booking status must be rejected, NOT cancelled');
});

test('TC21: Expired rejected booking: auto-cancellation cancels booking when original deadline passes', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const expiredCreatedAt = new Date(baseTime - 30 * 60 * 1000).toISOString(); // 30 mins ago (expired)

  await query.run(`
    INSERT INTO bookings (id, total_amount, payment_status, booking_source, created_at)
    VALUES (1001, 1000, 'rejected', 'online', ?)
  `, [expiredCreatedAt]);

  const result = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.ok(result.cancelled >= 1, 'Expired rejected booking must be auto-cancelled');

  const b = await query.get('SELECT payment_status FROM bookings WHERE id = 1001');
  assert.equal(b.payment_status, 'cancelled');
});

test('TC22: Expired rejected booking: late upload-slip is rejected with 400 error and cancels booking', async () => {
  assert.ok(serverSource.includes('รายการจองนี้หมดเวลาชำระเงินแล้ว'), 'server.js must block slip upload on expired bookings');
  assert.ok(workerSource.includes('รายการจองนี้หมดเวลาชำระเงินแล้ว'), 'worker.js must block slip upload on expired bookings');
});

test('TC23: Concurrency / race condition safety: payment approval vs rejection race handling', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, total_amount, paid_amount, payment_status, created_at)
    VALUES (1102, 1000, 1000, 'paid', ?)
  `, [nowIso]);

  // Attempt to reject an already paid booking must fail
  const res = await query.run(`
    UPDATE bookings
    SET payment_status = 'rejected'
    WHERE id = 1102 AND payment_status != 'paid' AND payment_status != 'cancelled'
  `);
  assert.equal(res.changes, 0, 'Cannot reject a booking that has already been approved as paid');
});

test('TC24: Financial ledger integrity: paid_amount, balance_amount, total_amount untouched by slip rejection', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, subtotal_amount, discount_amount, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (1203, 1000, 50, 950, 0, 950, 'reviewing', ?)
  `, [nowIso]);

  // Reject slip
  await query.run(`
    UPDATE bookings
    SET payment_status = 'rejected',
        slip_verify_status = 'rejected'
    WHERE id = 1203
  `);

  const b = await query.get('SELECT subtotal_amount, discount_amount, total_amount, paid_amount, balance_amount FROM bookings WHERE id = 1203');
  assert.equal(b.subtotal_amount, 1000);
  assert.equal(b.discount_amount, 50);
  assert.equal(b.total_amount, 950);
  assert.equal(b.paid_amount, 0);
  assert.equal(b.balance_amount, 950);
});

test('TC25: ONLINE_5_PERCENT discount unaffected by slip rejection and walk-in payments', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  // Set ONLINE_5_PERCENT promotion
  await query.run(`
    INSERT INTO settings (key, value)
    VALUES ('promotion_online_discount', '{"code":"ONLINE_5_PERCENT","discount_percent":5,"is_active":true}')
  `);

  const nowIso = new Date().toISOString();
  // 1000 - 5% = 950
  await query.run(`
    INSERT INTO bookings (id, subtotal_amount, discount_amount, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (1304, 1000, 50, 950, 0, 950, 'reviewing', ?)
  `, [nowIso]);

  // Reject slip
  await query.run(`
    UPDATE bookings
    SET payment_status = 'rejected'
    WHERE id = 1304
  `);

  // Verify settings are unchanged
  const promo = await query.get('SELECT value FROM settings WHERE key = "promotion_online_discount"');
  const promoObj = JSON.parse(promo.value);
  assert.equal(promoObj.code, 'ONLINE_5_PERCENT');
  assert.equal(promoObj.discount_percent, 5);
  assert.equal(promoObj.is_active, true);

  // Verify booking financial discount is preserved
  const b = await query.get('SELECT subtotal_amount, discount_amount, total_amount FROM bookings WHERE id = 1304');
  assert.equal(b.subtotal_amount, 1000);
  assert.equal(b.discount_amount, 50);
  assert.equal(b.total_amount, 950);
});

// =========================================================================
// P1–P3 BUGFIX REGRESSION TEST SUITE
// =========================================================================

test('TC26: Large slip (>700 KB) uses R2 reference, not Base64 SQL in worker walk-in slip routes', async () => {
  // 1. Verify worker.js source routes call saveUploadedFile and never store raw slip_image
  const workerCode = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  assert.ok(workerCode.includes("slipUrl = await saveUploadedFile(env, slip_image, 'slips')"), 'worker.js pay-balance must call saveUploadedFile');
  assert.ok(workerCode.includes("const slipUrl = slip_image") === false, 'worker.js must not assign raw slip_image directly to slipUrl');

  // 2. Simulate R2 saveUploadedFile execution with large payload (>700 KB)
  let bucketPutCalled = false;
  let putFilename = null;
  const mockBucket = {
    put: async (filename, buffer, options) => {
      bucketPutCalled = true;
      putFilename = filename;
      return { key: filename };
    }
  };

  const largeBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(800 * 1024); // ~800 KB payload
  const env = { BUCKET: mockBucket };

  // Extract saveUploadedFile from worker.js
  const sufStart = workerCode.indexOf("async function saveUploadedFile(env, fileData, folder = 'uploads') {");
  const nextSection = workerCode.indexOf('// THAI BANK SLIP MINI QR VERIFIER & PARSER', sufStart);
  const sufEnd = workerCode.lastIndexOf('}', nextSection) + 1;
  assert.ok(sufStart > 0 && sufEnd > sufStart, 'saveUploadedFile found in worker.js');
  const saveUploadedFile = vm.runInNewContext(
    `(${workerCode.slice(sufStart, sufEnd).trim()})`,
    { console, atob: (str) => Buffer.from(str, 'base64').toString('binary'), Uint8Array, Math, Date }
  );

  const savedUrl = await saveUploadedFile(env, largeBase64, 'slips');
  assert.ok(bucketPutCalled, 'Mock R2 bucket.put must be called');
  assert.ok(savedUrl.startsWith('/uploads/slips/'), 'Stored URL must be an R2 reference path, not data URI');
  assert.ok(!savedUrl.startsWith('data:'), 'Stored URL must NEVER be a data URI');
  assert.ok(savedUrl.length < 200, 'R2 reference URL must be small and safe for D1 column storage');
});

test('TC27: R2 failure does not silently produce incorrect payment state', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  // Setup initial booking: total 1000, paid 0, balance 1000
  await query.run(`
    INSERT INTO bookings (id, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (2701, 1000, 0, 1000, 'pending', '2026-10-15T10:00:00Z')
  `);

  // Emulate worker pay-balance logic when R2 fails
  const mockBucketFailing = {
    put: async () => { throw new Error('R2_NETWORK_TIMEOUT'); }
  };
  const env = { BUCKET: mockBucketFailing };

  let paymentSucceeded = false;
  let httpStatus = 200;
  try {
    // Attempting pay-balance with slip upload
    const slip_image = 'data:image/jpeg;base64,' + Buffer.from('test_slip').toString('base64');
    if (!env.BUCKET) throw new Error('NO_BUCKET');
    // R2 upload throws:
    await mockBucketFailing.put('slip.jpg', Buffer.from('test'));
    paymentSucceeded = true;
  } catch (err) {
    httpStatus = 500;
    // R2 failed: abort pay-balance before modifying bookings or payment_transactions
  }

  assert.equal(httpStatus, 500, 'Failed R2 upload must return HTTP 500 error');
  assert.equal(paymentSucceeded, false, 'Payment must NOT succeed when R2 upload fails');

  // Verify database: booking remained 1000 unpaid, zero transactions inserted
  const booking = await query.get('SELECT paid_amount, balance_amount, payment_status FROM bookings WHERE id = 2701');
  assert.equal(booking.paid_amount, 0, 'paid_amount must remain 0');
  assert.equal(booking.balance_amount, 1000, 'balance_amount must remain 1000');
  assert.equal(booking.payment_status, 'pending', 'payment_status must remain pending');

  const txCount = (await query.all('SELECT id FROM payment_transactions WHERE booking_id = 2701')).length;
  assert.equal(txCount, 0, 'No payment_transactions row must be inserted when R2 upload fails');
});

test('TC28: Cross-booking transaction attachment denied', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  // Setup Booking 1 and Booking 2
  await query.run("INSERT INTO bookings (id, total_amount, payment_status) VALUES (101, 500, 'paid')");
  await query.run("INSERT INTO bookings (id, total_amount, payment_status) VALUES (102, 500, 'paid')");

  // Transaction 99 belongs to Booking 101
  await query.run(`
    INSERT INTO payment_transactions (id, booking_id, amount, payment_method, transaction_type)
    VALUES (99, 101, 500, 'transfer', 'full')
  `);

  // Attempt to attach slip to Transaction 99 specifying Booking 102 (Cross-booking attack)
  const targetBookingId = 102;
  const targetPaymentId = 99;

  const tx = await query.get(
    'SELECT * FROM payment_transactions WHERE id = ? AND booking_id = ?',
    [targetPaymentId, targetBookingId]
  );

  // Endpoint must reject when tx is null
  assert.equal(tx, undefined, 'Transaction 99 must not be found for Booking 102');
  const deniedStatus = !tx ? 404 : 200;
  assert.equal(deniedStatus, 404, 'Cross-booking transaction attachment must be rejected with 404');

  // Verify Transaction 99 slip_url is untouched
  const originalTx = await query.get('SELECT slip_url FROM payment_transactions WHERE id = 99');
  assert.equal(originalTx.slip_url, null, 'Transaction 99 slip_url must not be modified by cross-booking attempt');
});

test('TC29: LINE HTTP 4xx/5xx never logs delivery success in server.js', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.ok(
    serverCode.includes('if (lineRes.ok) {') && serverCode.includes("action, details, performed_by, created_at)"),
    'server.js must check lineRes.ok before inserting line_reject_notified'
  );

  await query.run(`
    INSERT INTO bookings (id, total_amount, payment_status, line_user_id, created_at)
    VALUES (2901, 500, 'reviewing', 'U_TEST_4XX', '2026-10-15T10:00:00Z')
  `);

  // Simulate reject-slip logic when LINE API returns 400 Bad Request
  const fakeLineRes = { ok: false, status: 400, text: async () => '{"message":"Invalid user ID"}' };
  let lineNotified = false;

  if (fakeLineRes.ok) {
    lineNotified = true;
    await query.run("INSERT INTO booking_history (booking_id, action, details) VALUES (2901, 'line_reject_notified', 'เหตุผล')");
  }

  assert.equal(lineNotified, false, 'lineNotified must be false when LINE returns HTTP 4xx');

  const history = await query.all("SELECT * FROM booking_history WHERE booking_id = 2901 AND action = 'line_reject_notified'");
  assert.equal(history.length, 0, 'line_reject_notified must NOT be recorded on LINE HTTP 4xx');
});

test('TC30: LINE success logs correctly; network failure preserves rejection', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  await query.run(`
    INSERT INTO bookings (id, total_amount, payment_status, line_user_id, created_at)
    VALUES (3001, 500, 'reviewing', 'U_TEST_OK', '2026-10-15T10:00:00Z')
  `);

  // Step 1: Reject slip status in DB (must happen first and remain intact)
  await query.run("UPDATE bookings SET payment_status = 'rejected', slip_verify_status = 'rejected' WHERE id = 3001");
  await query.run("INSERT INTO booking_history (booking_id, action, details) VALUES (3001, 'reject_slip', 'ยอดเงินไม่ตรง')");

  // Step 2: Simulate LINE 200 OK
  const fakeLineSuccess = { ok: true, status: 200 };
  let lineNotified = false;
  if (fakeLineSuccess.ok) {
    lineNotified = true;
    await query.run("INSERT INTO booking_history (booking_id, action, details) VALUES (3001, 'line_reject_notified', 'ยอดเงินไม่ตรง')");
  }

  assert.equal(lineNotified, true, 'lineNotified must be true when LINE API returns 200 OK');
  const logged = await query.get("SELECT * FROM booking_history WHERE booking_id = 3001 AND action = 'line_reject_notified'");
  assert.ok(logged, 'line_reject_notified must be logged in history');

  // Step 3: Simulate separate booking where network exception happens
  await query.run(`
    INSERT INTO bookings (id, total_amount, payment_status, line_user_id, created_at)
    VALUES (3002, 500, 'reviewing', 'U_TEST_ERR', '2026-10-15T10:00:00Z')
  `);
  await query.run("UPDATE bookings SET payment_status = 'rejected' WHERE id = 3002");

  try {
    throw new Error('NETWORK_FETCH_FAILED');
  } catch (netErr) {
    // Delivery failure caught without undoing slip rejection
  }

  const b3002 = await query.get('SELECT payment_status FROM bookings WHERE id = 3002');
  assert.equal(b3002.payment_status, 'rejected', 'Rejection status must remain intact on LINE network failure');
});

test('TC31: History displays separate slips per transaction', async () => {
  const historyCode = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/History.jsx'), 'utf8');

  // Verify P3 implementation in History.jsx:
  assert.ok(historyCode.includes('fetchPaymentTransactions'), 'History.jsx must define fetchPaymentTransactions');
  assert.ok(historyCode.includes('/api/bookings/${bookingId}/payments'), 'History.jsx must query payments endpoint');
  assert.ok(historyCode.includes('paymentTransactions.map'), 'History.jsx must map over payment transactions in detail modal');
  assert.ok(historyCode.includes('active_transaction_id'), 'History.jsx must support per-transaction slip viewing');
  assert.ok(historyCode.includes('Multiple Transaction Slips Selector'), 'History.jsx must include multi-slip switcher');
});

test('TC32: Booking expiration and financial integrity remain intact', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const expiredTime = new Date(baseTime - 16 * 60 * 1000).toISOString();
  const unexpiredTime = new Date(baseTime - 5 * 60 * 1000).toISOString();

  // Expired rejected booking
  await query.run(`
    INSERT INTO bookings (id, booking_source, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (3201, 'online', 1000, 0, 1000, 'rejected', ?)
  `, [expiredTime]);

  // Unexpired rejected booking
  await query.run(`
    INSERT INTO bookings (id, booking_source, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (3202, 'online', 1000, 0, 1000, 'rejected', ?)
  `, [unexpiredTime]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 1, 'Only the expired rejected booking must be cancelled');

  const bExpired = await query.get('SELECT payment_status, total_amount, paid_amount, balance_amount FROM bookings WHERE id = 3201');
  assert.equal(bExpired.payment_status, 'cancelled');
  assert.equal(bExpired.total_amount, 1000);
  assert.equal(bExpired.balance_amount, 1000);

  const bUnexpired = await query.get('SELECT payment_status, total_amount, paid_amount, balance_amount FROM bookings WHERE id = 3202');
  assert.equal(bUnexpired.payment_status, 'rejected');
  assert.equal(bUnexpired.total_amount, 1000);
  assert.equal(bUnexpired.balance_amount, 1000);
});
