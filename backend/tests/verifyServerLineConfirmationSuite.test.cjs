/**
 * BWORK-POS — EXPRESS SERVER PARITY TEST SUITE
 * Verifies that backend/server.js sendLineNotification implements
 * identical idempotency, eligibility gates, and audit trails as worker.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

test('Express Server LINE Confirmation Parity Suite', async (t) => {
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

  const db = new DatabaseSync(':memory:');
  const fixtureSql = fs.readFileSync(path.join(__dirname, '..', 'staging_fixtures.sql'), 'utf8');
  db.exec(fixtureSql);

  const dbQuery = {
    async get(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.get(...params) || null;
    },
    async all(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    },
    async run(sql, params = []) {
      const stmt = db.prepare(sql);
      const res = stmt.run(...params);
      return { changes: res.changes, lastID: Number(res.lastInsertRowid) };
    }
  };

  // Extract sendLineNotification from server.js
  const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const extractFn = new Function(
    'dbQuery',
    'roundMoney',
    'roomUsesDoorPin',
    'generateUniquePinCode',
    'buildLineConfirmationFlex',
    'fetch',
    'console',
    'process',
    `
    ${serverCode.match(/function maskLineUserId[\s\S]*?async function sendLineNotification\(bookingId\) {[\s\S]*?\n}/)[0]}
    return { maskLineUserId, logSafeNotificationDiagnostic, sendLineNotification };
    `
  );

  const { sendLineNotification } = extractFn(
    dbQuery,
    (val) => Math.round((Number(val) || 0) * 100) / 100,
    () => false,
    async () => '1234',
    () => ({ type: 'flex', altText: 'ยืนยัน', contents: { type: 'bubble' } }),
    globalThis.fetch,
    console,
    { env: { ENVIRONMENT: 'production', LINE_CHANNEL_ACCESS_TOKEN: 'token_srv_123' } }
  );

  db.exec(`
    INSERT OR REPLACE INTO settings (key, value) VALUES ('line_channel_access_token', 'token_srv_123');
    INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, pin_code) VALUES (1, 'Room 1', 4, 300, '1111');
  `);

  await t.test('1. Full payment triggers sendLineNotification and records booking_history', async () => {
    linePushCalls = [];
    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status, slip_image_url, slip_verify_status)
      VALUES (201, 'Khun ServerTest', 'Userver_201', 300, 300, 0, 'paid', 'https://r2/slip.jpg', 'approved_manual');
    `);

    const res = await sendLineNotification(201);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.line_pushed, true);
    assert.strictEqual(linePushCalls.length, 1);

    const hist = db.prepare("SELECT * FROM booking_history WHERE booking_id = 201 AND action = 'line_confirmation_notified'").get();
    assert.ok(hist, 'Server must record line_confirmation_notified in booking_history');
  });

  await t.test('2. Idempotency in server: duplicate sendLineNotification is skipped', async () => {
    linePushCalls = [];
    const res = await sendLineNotification(201);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'skipped');
    assert.strictEqual(res.reason, 'already_notified');
    assert.strictEqual(linePushCalls.length, 0, 'Must not push second time');
  });

  await t.test('3. Outstanding balance skips notification in server', async () => {
    linePushCalls = [];
    db.exec(`
      INSERT OR REPLACE INTO bookings (id, customer_name, line_user_id, total_amount, paid_amount, balance_amount, payment_status)
      VALUES (202, 'Khun BalanceTest', 'Userver_202', 600, 300, 300, 'paid');
    `);

    const res = await sendLineNotification(202);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'skipped');
    assert.strictEqual(res.reason, 'balance_remaining');
    assert.strictEqual(linePushCalls.length, 0);
  });
});
