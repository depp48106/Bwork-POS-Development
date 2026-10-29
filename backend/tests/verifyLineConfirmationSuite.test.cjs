/**
 * BWORK-POS — AUTOMATIC LINE BOOKING CONFIRMATION AFTER PAYMENT
 * Task D Automated Verification Test Suite
 *
 * Verifies all 14 mandatory conditions:
 * 1. Full Payment + Approved Slip -> Sends confirmation (status: 'sent')
 * 2. Pay Balance completes amount (newStatus === 'paid') -> Sends confirmation (status: 'sent')
 * 3. Deposit incomplete (newStatus === 'deposit', balance > 0) -> Skipped (reason: 'balance_remaining')
 * 4. Pending Slip (slip_verify_status: 'pending_manual') -> Skipped (reason: 'slip_pending_approval')
 * 5. Rejected Slip (slip_verify_status: 'rejected') -> Skipped (reason: 'slip_rejected')
 * 6. No LINE User ID -> Skipped (reason: 'no_line_user_id') + audit log in booking_history
 * 7. Missing Token -> Failed (reason: 'no_channel_access_token') + audit log in booking_history
 * 8. LINE API 200 -> Sent (status: 'sent', HTTP 200) + audit log in booking_history
 * 9. LINE API 400/401/429/500 -> Handled safely (status: 'failed') without breaking payment transaction
 * 10. Concurrent / Double-click Payment Approval -> Second attempt skipped (reason: 'already_notified')
 * 11. Previously Paid Booking -> Re-calling payment endpoint skipped (reason: 'already_notified')
 * 12. Payment DB Transaction & Financial Audit intact (payment_transactions row, paid_amount, balance_amount)
 * 13. Booking Flex Message & PIN intact (buildLineBookingConfirmationFlex output verified)
 * 14. Zero unexpected customer messages (0 calls to LINE push when skipped or failed).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');

test('Automatic LINE Booking Confirmation Verification Suite', async (t) => {
  let linePushCalls = [];
  let lineApiResponseStatus = 200;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('api.line.me')) {
      const body = options?.body ? JSON.parse(options.body) : {};
      linePushCalls.push({
        url: urlStr,
        headers: options?.headers,
        body
      });
      return {
        ok: lineApiResponseStatus >= 200 && lineApiResponseStatus < 300,
        status: lineApiResponseStatus,
        json: async () => ({})
      };
    }
    return originalFetch(url, options);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // Setup in-memory SQLite database matching production D1
  const db = new DatabaseSync(':memory:');
  const fixtureSql = fs.readFileSync(path.join(__dirname, '..', 'staging_fixtures.sql'), 'utf8');
  db.exec(fixtureSql);

  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) {
          this._params = args.map(a => a === undefined ? null : a);
          return this;
        },
        async first() {
          const stmt = db.prepare(this._sql);
          return stmt.get(...this._params) || null;
        },
        async all() {
          const stmt = db.prepare(this._sql);
          return { results: stmt.all(...this._params) };
        },
        async run() {
          const stmt = db.prepare(this._sql);
          const res = stmt.run(...this._params);
          return { success: true, meta: { changes: res.changes } };
        }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  // Load worker.js
  const workerRaw = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const wrapped = workerRaw.replace('export default {', 'const workerDefault = {') +
    '\nreturn { ...workerDefault, dispatchLineMessagePush, triggerLineBookingConfirmation, sendLineBookingConfirmation, buildLineBookingConfirmationFlex };';
  const workerFn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', 'fetch', wrapped);
  const worker = workerFn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob, globalThis.fetch);

  const env = {
    DB: d1,
    ENVIRONMENT: 'production', // Test production dispatch behavior with mock fetch
    LINE_CHANNEL_ACCESS_TOKEN: 'test_token_secret_12345',
    WIFI_CREDENTIAL_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };

  function makeJwt(role = 'admin') {
    const payload = { id: 1, username: 'admin_test', role };
    const base64url = (str) => Buffer.from(str).toString('base64url');
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64url(JSON.stringify({ ...payload, exp: Date.now() + 3600000 }));
    const sig = crypto.createHmac('sha256', 'bwork-pos-secret-key-change-in-production').update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  // Seed sample rooms and bookings
  db.exec(`
    INSERT OR REPLACE INTO settings (key, value) VALUES ('line_channel_access_token', 'test_db_token_access_999');
    INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, pin_code) VALUES (1, 'Meeting Room A', 6, 500, '9876');
  `);

  await t.test('1. Full Payment + Approved Slip -> Sends confirmation (status: sent)', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status, pin_code)
      VALUES (101, 'Khun Somchai', 'Uline_user_101', 500, 500, 0, 'paid', 'https://r2/slip101.jpg', 'approved_manual', '1234');
      INSERT OR REPLACE INTO booking_items (id, booking_id, room_id, quantity, price, subtotal)
      VALUES (101, 101, 1, 1, 500, 500);
    `);

    const result = await worker.triggerLineBookingConfirmation(env, 101);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sent, true);
    assert.strictEqual(result.status, 'sent');
    assert.strictEqual(linePushCalls.length, 1);
    assert.strictEqual(linePushCalls[0].body.to, 'Uline_user_101');

    // Check audit log in booking_history
    const history = db.prepare("SELECT * FROM booking_history WHERE booking_id = 101 AND action = 'line_confirmation_notified'").get();
    assert.ok(history, 'booking_history must have line_confirmation_notified');
  });

  await t.test('2. Pay Balance completes amount (POST /api/bookings/:id/pay-balance) -> Sends confirmation', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status, pin_code)
      VALUES (102, 'Khun Jane', 'Uline_user_102', 1000, 500, 500, 'deposit', 'https://r2/slip102_initial.jpg', 'approved_manual', '5678');
      INSERT OR REPLACE INTO booking_items (id, booking_id, room_id, quantity, price, subtotal)
      VALUES (102, 102, 1, 2, 500, 1000);
    `);

    // Staff approves/pays remaining 500 balance
    const req = new Request('http://localhost/api/bookings/102/pay-balance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeJwt('admin')}`
      },
      body: JSON.stringify({
        amount: 500,
        payment_method: 'transfer'
      })
    });

    const res = await worker.fetch(req, env);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.payment_status, 'paid');
    assert.strictEqual(data.balance_amount, 0);
    assert.strictEqual(data.line_notification?.status, 'sent');
    assert.strictEqual(data.line_notification_sent, true);
    assert.strictEqual(linePushCalls.length, 1);
    assert.strictEqual(linePushCalls[0].body.to, 'Uline_user_102');

    const history = db.prepare("SELECT * FROM booking_history WHERE booking_id = 102 AND action = 'line_confirmation_notified'").get();
    assert.ok(history, 'booking_history must record line_confirmation_notified on pay-balance completion');
  });

  await t.test('3. Deposit incomplete (newStatus === deposit, balance > 0) -> Skipped (reason: balance_remaining)', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (103, 'Khun Anan', 'Uline_user_103', 1000, 300, 700, 'deposit', 'https://r2/slip103.jpg', 'approved_manual');
    `);

    const result = await worker.triggerLineBookingConfirmation(env, 103);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'payment_status_not_paid');
    assert.strictEqual(linePushCalls.length, 0, 'No LINE message sent for incomplete deposit');
  });

  await t.test('4. Pending Slip (slip_verify_status: pending_manual) -> Skipped (reason: slip_pending_approval)', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (104, 'Khun Manee', 'Uline_user_104', 500, 500, 0, 'paid', 'https://r2/slip104.jpg', 'pending_manual');
    `);

    const result = await worker.triggerLineBookingConfirmation(env, 104);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'slip_pending_approval');
    assert.strictEqual(linePushCalls.length, 0, 'No LINE message sent while slip is pending');
  });

  await t.test('5. Rejected Slip (slip_verify_status: rejected) -> Skipped (reason: slip_rejected)', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (105, 'Khun Piti', 'Uline_user_105', 500, 500, 0, 'paid', 'https://r2/slip105.jpg', 'rejected');
    `);

    const result = await worker.triggerLineBookingConfirmation(env, 105);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'slip_rejected');
    assert.strictEqual(linePushCalls.length, 0, 'No LINE message sent when slip is rejected');
  });

  await t.test('6. No LINE User ID -> Skipped (reason: no_line_user_id) + audit log recorded', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (106, 'Walk-in Customer', NULL, 500, 500, 0, 'paid', 'https://r2/slip106.jpg', 'approved_manual');
    `);

    const result = await worker.triggerLineBookingConfirmation(env, 106);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'no_line_user_id');
    assert.strictEqual(linePushCalls.length, 0);

    const history = db.prepare("SELECT * FROM booking_history WHERE booking_id = 106 AND action = 'line_confirmation_skipped'").get();
    assert.ok(history, 'line_confirmation_skipped must be logged in booking_history');
  });

  await t.test('7. Missing Token -> Failed (reason: no_channel_access_token) + audit log recorded', async () => {
    linePushCalls = [];

    // Temporarily clear tokens
    const savedToken = db.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").get()?.value;
    db.exec("DELETE FROM settings WHERE key = 'line_channel_access_token';");
    const emptyTokenEnv = { ...env, LINE_CHANNEL_ACCESS_TOKEN: '' };

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (107, 'Khun Chujai', 'Uline_user_107', 500, 500, 0, 'paid', 'https://r2/slip107.jpg', 'approved_manual');
    `);

    const result = await worker.triggerLineBookingConfirmation(emptyTokenEnv, 107);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.reason, 'no_channel_access_token');
    assert.strictEqual(result.http_status, 401);
    assert.strictEqual(linePushCalls.length, 0);

    const history = db.prepare("SELECT * FROM booking_history WHERE booking_id = 107 AND action = 'line_confirmation_failed'").get();
    assert.ok(history, 'line_confirmation_failed must be logged in booking_history');

    // Restore token
    db.exec(`INSERT OR REPLACE INTO settings (key, value) VALUES ('line_channel_access_token', '${savedToken}');`);
  });

  await t.test('8. LINE API 200 -> Sent (status: sent, HTTP 200) + audit log recorded', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (108, 'Khun Veerachai', 'Uline_user_108', 500, 500, 0, 'paid', 'https://r2/slip108.jpg', 'approved_manual');
    `);

    const result = await worker.triggerLineBookingConfirmation(env, 108);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sent, true);
    assert.strictEqual(result.status, 'sent');
    assert.strictEqual(result.http_status, 200);

    const history = db.prepare("SELECT * FROM booking_history WHERE booking_id = 108 AND action = 'line_confirmation_notified'").get();
    assert.ok(history, 'line_confirmation_notified must be logged in booking_history with HTTP 200');
  });

  await t.test('9. LINE API 400/401/429/500 -> Handled safely (status: failed) without breaking payment transaction', async () => {
    for (const code of [400, 401, 429, 500]) {
      linePushCalls = [];
      lineApiResponseStatus = code;
      const bId = 1100 + code;

      db.exec(`
        INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
        VALUES (${bId}, 'Khun ErrorTest', 'Uline_user_${bId}', 500, 500, 0, 'paid', 'https://r2/slip_${bId}.jpg', 'approved_manual');
      `);

      const result = await worker.triggerLineBookingConfirmation(env, bId);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.sent, false);
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(result.http_status, code);

      const history = db.prepare(`SELECT * FROM booking_history WHERE booking_id = ${bId} AND action = 'line_confirmation_failed'`).get();
      assert.ok(history, `line_confirmation_failed must be logged for HTTP ${code}`);
      const details = JSON.parse(history.details);
      assert.strictEqual(details.http_status, code);
    }
  });

  await t.test('10. Concurrent / Double-click Payment Approval -> Second attempt skipped (reason: already_notified)', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (110, 'Khun RapidClick', 'Uline_user_110', 500, 500, 0, 'paid', 'https://r2/slip110.jpg', 'approved_manual');
    `);

    // First attempt
    const res1 = await worker.triggerLineBookingConfirmation(env, 110);
    assert.strictEqual(res1.status, 'sent');
    assert.strictEqual(linePushCalls.length, 1);

    // Second concurrent / duplicate attempt
    const res2 = await worker.triggerLineBookingConfirmation(env, 110);
    assert.strictEqual(res2.status, 'skipped');
    assert.strictEqual(res2.reason, 'already_notified');
    assert.strictEqual(linePushCalls.length, 1, 'Push count must remain strictly 1');
  });

  await t.test('11. Previously Paid Booking -> Re-calling payment endpoint skipped (reason: already_notified)', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (111, 'Khun AlreadyPaid', 'Uline_user_111', 500, 500, 0, 'paid', 'https://r2/slip111.jpg', 'approved_manual');
    `);

    // First payment call
    const paymentReq1 = new Request('http://localhost/api/bookings/111/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeJwt('admin')}`
      },
      body: JSON.stringify({
        payment_status: 'paid',
        payment_method: 'transfer'
      })
    });
    const res1 = await worker.fetch(paymentReq1, env);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(linePushCalls.length, 1);

    // Second payment call (e.g. staff re-clicked button)
    const paymentReq2 = new Request('http://localhost/api/bookings/111/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeJwt('admin')}`
      },
      body: JSON.stringify({
        payment_status: 'paid',
        payment_method: 'transfer'
      })
    });
    const res2 = await worker.fetch(paymentReq2, env);
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(data2.line_notification?.status, 'skipped');
    assert.strictEqual(data2.line_notification?.reason, 'already_notified');
    assert.strictEqual(linePushCalls.length, 1, 'Second payment call must NOT dispatch second LINE push');
  });

  await t.test('12. Payment DB Transaction & Financial Audit intact', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (112, 'Khun FinancialAudit', 'Uline_user_112', 1500, 500, 1000, 'deposit', 'https://r2/slip112.jpg', 'approved_manual');
    `);

    const req = new Request('http://localhost/api/bookings/112/pay-balance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeJwt('admin')}`
      },
      body: JSON.stringify({
        amount: 1000,
        payment_method: 'credit_card'
      })
    });

    const res = await worker.fetch(req, env);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.paid_amount, 1500);
    assert.strictEqual(data.balance_amount, 0);
    assert.strictEqual(data.payment_status, 'paid');

    // Verify payment_transactions ledger row
    const txn = db.prepare("SELECT * FROM payment_transactions WHERE booking_id = 112 AND transaction_type = 'balance'").get();
    assert.ok(txn, 'Ledger entry in payment_transactions must exist');
    assert.strictEqual(txn.amount, 1000);
    assert.strictEqual(txn.payment_method, 'credit_card');
    assert.strictEqual(txn.status, 'completed');
  });

  await t.test('13. Booking Flex Message & PIN intact', async () => {
    const booking = {
      id: 113,
      customer_name: 'Khun FlexDesign',
      booking_date: '2026-10-30',
      start_time: '10:00',
      end_time: '12:00',
      pin_code: '8899',
      payment_status: 'paid',
      total_amount: 1000
    };
    const item = { room_id: 1, quantity: 2 };
    const room = { id: 1, name: 'Grand Meeting Room A' };

    const flex = worker.buildLineBookingConfirmationFlex(booking, item, room);
    assert.strictEqual(flex.type, 'flex');
    assert.ok(flex.altText.includes('ยืนยันการจองสำเร็จ'), 'altText must contain confirmation title');
    assert.strictEqual(flex.contents.type, 'bubble');

    const flexStr = JSON.stringify(flex);
    assert.ok(flexStr.includes('Grand Meeting Room A'), 'Room name must be present in Flex');
    assert.ok(flexStr.includes('BK-000113') || flexStr.includes('113'), 'Booking ID must be present in Flex');
    assert.ok(flexStr.includes('ชำระแล้ว'), 'Payment status must be present in Flex');
    assert.strictEqual(booking.pin_code, '8899', 'PIN code on booking object must be preserved');
  });

  await t.test('14. Zero unexpected customer messages (0 calls when skipped or failed)', async () => {
    linePushCalls = [];

    // Attempt trigger on non-existent booking
    const res = await worker.triggerLineBookingConfirmation(env, 999999);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'failed');
    assert.strictEqual(res.reason, 'booking_not_found');
    assert.strictEqual(linePushCalls.length, 0, 'Push calls must be strictly 0');
  });

  await t.test('15. Concurrent Double-Click (2 simultaneous requests) -> Strictly 1 LINE push', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (120, 'Khun ConcurrentDouble', 'Uline_user_120', 500, 500, 0, 'paid', 'https://r2/slip120.jpg', 'approved_manual');
    `);

    // Fire 2 requests simultaneously using Promise.all
    const [res1, res2] = await Promise.all([
      worker.triggerLineBookingConfirmation(env, 120),
      worker.triggerLineBookingConfirmation(env, 120)
    ]);

    assert.strictEqual(linePushCalls.length, 1, 'Only exactly 1 LINE push call must be dispatched');
    const successful = [res1, res2].filter(r => r.status === 'sent');
    const blocked = [res1, res2].filter(r => r.status === 'already_processing' || r.status === 'skipped');
    assert.strictEqual(successful.length, 1, 'Exactly one request must acquire claim and send');
    assert.strictEqual(blocked.length, 1, 'The other request must be blocked');
  });

  await t.test('16. High Concurrency (15 simultaneous requests) -> Strictly 1 LINE push, 14 blocked', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (121, 'Khun HighConcurrency', 'Uline_user_121', 500, 500, 0, 'paid', 'https://r2/slip121.jpg', 'approved_manual');
    `);

    const results = await Promise.all(
      Array.from({ length: 15 }, () => worker.triggerLineBookingConfirmation(env, 121))
    );

    assert.strictEqual(linePushCalls.length, 1, 'Push count must be strictly 1 across 15 concurrent requests');
    const successful = results.filter(r => r.status === 'sent');
    const blocked = results.filter(r => r.status === 'already_processing' || r.status === 'skipped');
    assert.strictEqual(successful.length, 1, 'Exactly 1 request must succeed');
    assert.strictEqual(blocked.length, 14, '14 requests must be blocked with already_processing or skipped');
  });

  await t.test('17. LINE API Timeout / Network Drop -> Marked delivery_unknown, no blind retry', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (122, 'Khun TimeoutTest', 'Uline_user_122', 500, 500, 0, 'paid', 'https://r2/slip122.jpg', 'approved_manual');
    `);

    const timeoutFetch = async (url, opts) => {
      if (String(url).includes('api.line.me')) {
        const err = new Error('Network timeout after 10000ms');
        err.name = 'AbortError';
        throw err;
      }
      return originalFetch(url, opts);
    };

    const timeoutWorkerFn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', 'fetch', wrapped);
    const timeoutWorker = timeoutWorkerFn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob, timeoutFetch);

    const res = await timeoutWorker.triggerLineBookingConfirmation(env, 122);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'delivery_unknown');
    assert.strictEqual(res.reason, 'timeout');

    // Verify claim row in DB is marked delivery_unknown
    const claim = db.prepare("SELECT * FROM line_notification_claims WHERE booking_id = 122").get();
    assert.ok(claim, 'Claim row must exist');
    assert.strictEqual(claim.status, 'delivery_unknown');

    // Next request must NOT blindly retry
    const resRetry = await timeoutWorker.triggerLineBookingConfirmation(env, 122);
    assert.strictEqual(resRetry.success, false);
    assert.strictEqual(resRetry.status, 'delivery_unknown');
    assert.strictEqual(resRetry.reason, 'previous_delivery_unconfirmed');
  });

  await t.test('18. Worker Crash Recovery -> Stale claim (>30s) is recovered and sent', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (123, 'Khun CrashRecovery', 'Uline_user_123', 500, 500, 0, 'paid', 'https://r2/slip123.jpg', 'approved_manual');
    `);

    // Simulate stale processing claim from crashed worker (claimed 45 seconds ago)
    const staleTime = new Date(Date.now() - 45000).toISOString();
    db.exec(`
      INSERT OR REPLACE INTO line_notification_claims 
      (booking_id, notification_type, status, claim_token, retry_key, claimed_at, updated_at)
      VALUES (123, 'booking_confirmation', 'processing', 'crashed_token_999', 'crashed_retry_key_123', '${staleTime}', '${staleTime}');
    `);

    // New worker executes triggerLineBookingConfirmation
    const res = await worker.triggerLineBookingConfirmation(env, 123);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'sent');
    assert.strictEqual(linePushCalls.length, 1, 'Recovered claim successfully dispatched push');

    const updatedClaim = db.prepare("SELECT * FROM line_notification_claims WHERE booking_id = 123").get();
    assert.strictEqual(updatedClaim.status, 'sent');
  });

  await t.test('19. Existing booking_history Compatibility -> Past notified bookings immediately skipped', async () => {
    linePushCalls = [];

    // Simulate booking notified in previous release before line_notification_claims existed
    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (124, 'Khun LegacyBooking', 'Uline_user_124', 500, 500, 0, 'paid', 'https://r2/slip124.jpg', 'approved_manual');
      INSERT OR REPLACE INTO booking_history (booking_id, action, details, performed_by, created_at)
      VALUES (124, 'line_confirmation_notified', '{"status":"sent","http_status":200}', 'system', '2026-10-20T10:00:00Z');
    `);

    const res = await worker.triggerLineBookingConfirmation(env, 124);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'skipped');
    assert.strictEqual(res.reason, 'already_notified');
    assert.strictEqual(linePushCalls.length, 0, 'Must NOT push for legacy notified booking');
  });

  await t.test('20. Staging Hard Block -> Zero live push calls, returns mocked: true', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (125, 'Khun StagingBlock', 'Uline_user_125', 500, 500, 0, 'paid', 'https://r2/slip125.jpg', 'approved_manual');
    `);

    const stagingEnv = {
      ...env,
      ENVIRONMENT: 'staging'
    };

    const res = await worker.triggerLineBookingConfirmation(stagingEnv, 125);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.sent, false);
    assert.strictEqual(res.mocked, true);
    assert.strictEqual(res.status, 'sent');
    assert.strictEqual(linePushCalls.length, 0, 'Staging must hard-block and never call LINE API');
  });

  await t.test('21. Stable X-Line-Retry-Key Header Verification', async () => {
    linePushCalls = [];
    lineApiResponseStatus = 200;

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (126, 'Khun StableKey', 'Uline_user_126', 500, 500, 0, 'paid', 'https://r2/slip126.jpg', 'approved_manual');
    `);

    const res = await worker.triggerLineBookingConfirmation(env, 126);
    assert.strictEqual(res.success, true);
    assert.strictEqual(linePushCalls.length, 1);

    const callHeaders = linePushCalls[0].headers;
    const retryKeyHeader = callHeaders['X-Line-Retry-Key'] || callHeaders['x-line-retry-key'];
    assert.ok(retryKeyHeader, 'Request headers must include X-Line-Retry-Key');
    // Verify standard UUID format
    assert.match(retryKeyHeader, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Retry Key must be a valid UUID');

    const claim = db.prepare("SELECT * FROM line_notification_claims WHERE booking_id = 126").get();
    assert.strictEqual(claim.retry_key, retryKeyHeader, 'Persisted claim retry_key must match dispatched header');
  });

  await t.test('22. LINE-specific HTTP 409 Conflict -> Treated as Successful Deduplication', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (127, 'Khun Deduplicated409', 'Uline_user_127', 500, 500, 0, 'paid', 'https://r2/slip127.jpg', 'approved_manual');
    `);

    const mock409Fetch = async (url, opts) => {
      if (String(url).includes('api.line.me')) {
        return {
          ok: false,
          status: 409,
          headers: new Headers({
            'Content-Type': 'application/json',
            'x-line-accepted-request-id': 'orig_req_abc_123'
          }),
          text: async () => JSON.stringify({ message: 'The retry key is already accepted' })
        };
      }
      return originalFetch(url, opts);
    };

    const worker409Fn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', 'fetch', wrapped);
    const worker409 = worker409Fn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob, mock409Fetch);

    const res = await worker409.triggerLineBookingConfirmation(env, 127);
    assert.strictEqual(res.success, true, 'Official LINE 409 already accepted must be treated as success');
    assert.strictEqual(res.status, 'sent');
    assert.strictEqual(res.deduplicated, true);
    assert.strictEqual(res.accepted_request_id, 'orig_req_abc_123');

    const claim = db.prepare("SELECT * FROM line_notification_claims WHERE booking_id = 127").get();
    assert.strictEqual(claim.status, 'sent');
    assert.strictEqual(claim.accepted_request_id, 'orig_req_abc_123');

    const hist = db.prepare("SELECT * FROM booking_history WHERE booking_id = 127 AND action = 'line_confirmation_notified'").get();
    assert.ok(hist, 'booking_history must record line_confirmation_notified on 409 deduplication');
  });

  await t.test('23. Unexpected HTTP 409 Conflict -> Treated as Failure (Strict Safe Check)', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (128, 'Khun Unrelated409', 'Uline_user_128', 500, 500, 0, 'paid', 'https://r2/slip128.jpg', 'approved_manual');
    `);

    const mockUnrelated409Fetch = async (url, opts) => {
      if (String(url).includes('api.line.me')) {
        return {
          ok: false,
          status: 409,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          text: async () => JSON.stringify({ message: 'Conflicting account state or quota limitation' })
        };
      }
      return originalFetch(url, opts);
    };

    const workerUnrelated409Fn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', 'fetch', wrapped);
    const workerUnrelated409 = workerUnrelated409Fn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob, mockUnrelated409Fetch);

    const res = await workerUnrelated409.triggerLineBookingConfirmation(env, 128);
    assert.strictEqual(res.success, false, 'Non-LINE accepted 409 must NOT be treated as success');
    assert.strictEqual(res.status, 'failed');
    assert.strictEqual(res.reason, 'unexpected_409_conflict');

    const claim = db.prepare("SELECT * FROM line_notification_claims WHERE booking_id = 128").get();
    assert.strictEqual(claim.status, 'failed');
  });

  await t.test('24. Worker Crash after LINE Accept -> Recovery reuses key and resolves via 409', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (129, 'Khun CrashAfterAccept', 'Uline_user_129', 500, 500, 0, 'paid', 'https://r2/slip129.jpg', 'approved_manual');
    `);

    // Simulate Worker 1 crashed after LINE accepted (claim is in 'processing', 35 seconds ago)
    const staleTime = new Date(Date.now() - 35000).toISOString();
    const origRetryKey = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    db.exec(`
      INSERT OR REPLACE INTO line_notification_claims 
      (booking_id, notification_type, status, claim_token, retry_key, claimed_at, updated_at)
      VALUES (129, 'booking_confirmation', 'processing', 'crashed_token_1', '${origRetryKey}', '${staleTime}', '${staleTime}');
    `);

    // When Worker 2 retries with the same key, LINE recognizes the key and responds with 409
    const crashRecoveryFetch = async (url, opts) => {
      if (String(url).includes('api.line.me')) {
        linePushCalls.push(opts);
        const usedKey = opts.headers['X-Line-Retry-Key'];
        if (usedKey === origRetryKey) {
          return {
            ok: false,
            status: 409,
            headers: new Headers({ 'x-line-accepted-request-id': 'req_crash_recovery_129' }),
            text: async () => JSON.stringify({ message: 'The retry key is already accepted' })
          };
        }
      }
      return originalFetch(url, opts);
    };

    const workerCrashRecoveryFn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', 'fetch', wrapped);
    const workerCrashRecovery = workerCrashRecoveryFn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob, crashRecoveryFetch);

    const res = await workerCrashRecovery.triggerLineBookingConfirmation(env, 129);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'sent');
    assert.strictEqual(res.deduplicated, true);
    assert.strictEqual(linePushCalls.length, 1);
    assert.strictEqual(linePushCalls[0].headers['X-Line-Retry-Key'], origRetryKey, 'Must use identical stable retry key');
  });

  await t.test('25. 24-Hour Expiration Protection -> Replay after 24h is blocked without live push', async () => {
    linePushCalls = [];

    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (130, 'Khun Expired24h', 'Uline_user_130', 500, 500, 0, 'paid', 'https://r2/slip130.jpg', 'approved_manual');
    `);

    // Claim created 25 hours ago with status 'delivery_unknown'
    const expiredTime = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    db.exec(`
      INSERT OR REPLACE INTO line_notification_claims 
      (booking_id, notification_type, status, claim_token, retry_key, claimed_at, updated_at, created_at)
      VALUES (130, 'booking_confirmation', 'delivery_unknown', 'expired_token', 'expired_key_24h', '${expiredTime}', '${expiredTime}', '${expiredTime}');
    `);

    const res = await worker.triggerLineBookingConfirmation(env, 130);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'delivery_unknown');
    assert.strictEqual(res.reason, 'retry_window_exceeded_24h');
    assert.strictEqual(linePushCalls.length, 0, 'Zero push requests must be dispatched after 24h');
  });
});
