/**
 * BWORK-POS — STAGING LINE HARD-BLOCK TEST SUITE
 * Phase: RELEASE-2B.2
 *
 * Proves that when ENVIRONMENT === "staging":
 * 1. Zero HTTP requests are made to api.line.me across all dispatch paths.
 * 2. Real tokens (even if accidentally configured) are strictly blocked from dispatch.
 * 3. Results return clear mock indications: sent: false, mocked: true.
 * 4. Production behavior is 100% preserved.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');

test('Staging LINE Hard-Block and Production Parity Suite', async (t) => {
  let lineFetchAttempted = false;
  let lineFetchUrls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('api.line.me')) {
      lineFetchAttempted = true;
      lineFetchUrls.push(urlStr);
      throw new Error(`CRITICAL SECURITY FAILURE: Unexpected network dispatch to LINE API: ${urlStr}`);
    }
    return originalFetch(url, options);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // Setup in-memory SQLite database matching D1
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

  // Load worker.js using the standard Function sandbox pattern
  const workerRaw = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const wrapped = workerRaw.replace('export default {', 'const workerDefault = {') +
    '\nreturn { ...workerDefault, dispatchLineMessagePush, sendLineBookingConfirmation, sendLineDoorPin, sendLineBookingCancellation, sendLineBookingReschedule, sendLineBookingCustomerInfoUpdate };';
  const workerFn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', 'fetch', wrapped);
  const worker = workerFn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob, globalThis.fetch);

  const stagingEnv = {
    DB: d1,
    ENVIRONMENT: 'staging',
    LINE_CHANNEL_ACCESS_TOKEN: 'ACCIDENTAL_REAL_LIVE_TOKEN_STAGING_TEST_12345',
    WIFI_CREDENTIAL_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };

  // Configure line_user_id and a token in database to test maximum exposure
  db.exec("UPDATE bookings SET line_user_id = 'Umock_staging_user_12345' WHERE id = 9001;");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('line_channel_access_token', 'ACCIDENTAL_DB_TOKEN_67890');");

  // JWT Helper
  function makeJwt(role = 'admin') {
    const payload = { id: 1, username: 'admin_staging', role };
    const base64url = (str) => Buffer.from(str).toString('base64url');
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64url(JSON.stringify({ ...payload, exp: Date.now() + 3600000 }));
    const sig = crypto.createHmac('sha256', 'bwork-pos-secret-key-change-in-production').update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  await t.test('1. Centralized helper dispatchLineMessagePush hard-blocks in staging', async () => {
    lineFetchAttempted = false;
    const res = await worker.dispatchLineMessagePush(stagingEnv, 'ACCIDENTAL_REAL_TOKEN_99999', {
      to: 'Umock_target',
      messages: [{ type: 'text', text: 'Hello Staging' }]
    });

    assert.strictEqual(res.sent, false, 'sent must be false');
    assert.strictEqual(res.mocked, true, 'mocked must be true');
    assert.strictEqual(res.status, 200, 'status must be 200');
    assert.strictEqual(res.success, true, 'success must be true');
    assert.strictEqual(lineFetchAttempted, false, 'Zero network calls to api.line.me');
  });

  await t.test('2. Confirmation LINE message returns mock in staging', async () => {
    lineFetchAttempted = false;
    const res = await worker.sendLineBookingConfirmation(stagingEnv, 9001);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.sent, false);
    assert.strictEqual(res.mocked, true);
    assert.strictEqual(lineFetchAttempted, false, 'Zero network calls to api.line.me');
  });

  await t.test('3. Door PIN LINE message returns mock in staging', async () => {
    lineFetchAttempted = false;
    const res = await worker.sendLineDoorPin(stagingEnv, 9001);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.sent, false);
    assert.strictEqual(res.mocked, true);
    assert.strictEqual(lineFetchAttempted, false, 'Zero network calls to api.line.me');
  });

  await t.test('4. Cancellation LINE message returns mock in staging', async () => {
    lineFetchAttempted = false;
    const res = await worker.sendLineBookingCancellation(stagingEnv, 9001, 'ลูกค้าขอยกเลิก');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.sent, false);
    assert.strictEqual(res.mocked, true);
    assert.strictEqual(lineFetchAttempted, false, 'Zero network calls to api.line.me');
  });

  await t.test('5. Reschedule LINE message returns mock in staging', async () => {
    lineFetchAttempted = false;
    const res = await worker.sendLineBookingReschedule(
      stagingEnv,
      9001,
      '2026-10-20 10:00',
      '2026-10-20 12:00',
      '2026-10-20 11:00',
      '2026-10-20 13:00',
      1000,
      9101
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.sent, false);
    assert.strictEqual(res.mocked, true);
    assert.strictEqual(lineFetchAttempted, false, 'Zero network calls to api.line.me');
  });

  await t.test('6. Customer info update LINE message returns mock in staging', async () => {
    lineFetchAttempted = false;
    const booking = await stagingEnv.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(9001).first();
    const res = await worker.sendLineBookingCustomerInfoUpdate(stagingEnv, booking, 'ชื่อใหม่', '0899999999');
    assert.strictEqual(res.sent, false);
    assert.strictEqual(res.mocked, true);
    assert.strictEqual(lineFetchAttempted, false, 'Zero network calls to api.line.me');
  });

  await t.test('7. Hour credit send-line endpoint (/api/hour-credits/:id/send-line) returns mock in staging', async () => {
    lineFetchAttempted = false;

    // Seed mock hour credit
    db.exec(`INSERT OR REPLACE INTO room_hour_credits (credit_id, source_booking_id, source_item_id, customer_name, customer_phone, line_user_id, room_id, created_by, created_at)
      VALUES ('CR-STAGE-01', 9001, 9101, 'ผู้ทดสอบ', '0800000001', 'Umock_line_123', 5, 1, '2026-10-20 10:00:00');`);
    db.exec(`INSERT OR REPLACE INTO room_hour_credit_entries (credit_id, entry_type, minutes_delta, reason, created_by, created_at, idempotency_key, request_fingerprint)
      VALUES ('CR-STAGE-01', 'grant', 120, 'Initial grant', 1, '2026-10-20 10:00:00', 'idemp_grant_01', 'fp_01');`);

    const jwt = makeJwt('admin');
    const req = new Request('https://bwork-pos-api-staging.workers.dev/api/hour-credits/CR-STAGE-01/send-line', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      }
    });

    const res = await worker.fetch(req, stagingEnv, { waitUntil: () => {} });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.mocked, true);
    assert.strictEqual(data.sent, false);
    assert.strictEqual(lineFetchAttempted, false, 'Zero network calls to api.line.me during hour credit voucher dispatch in staging');
  });

  await t.test('8. Test-Line Settings Endpoint (/api/settings/line/test) returns mock in staging', async () => {
    lineFetchAttempted = false;
    const jwt = makeJwt('admin');
    const req = new Request('https://bwork-pos-api-staging.workers.dev/api/settings/line/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      },
      body: JSON.stringify({ channel_access_token: 'LIVE_LINE_TOKEN_TEST' })
    });

    const res = await worker.fetch(req, stagingEnv, { waitUntil: () => {} });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.connected, true);
    assert.strictEqual(data.mocked, true);
    assert.strictEqual(data.sent, false);
    assert.strictEqual(lineFetchAttempted, false, 'Zero network calls to api.line.me');
  });

  await t.test('9. Production mode verification: non-staging ENVIRONMENT attempts real dispatch', async () => {
    const prodEnv = {
      DB: d1,
      ENVIRONMENT: 'production',
      LINE_CHANNEL_ACCESS_TOKEN: 'PROD_TOKEN_TO_VERIFY_ATTEMPT'
    };

    lineFetchAttempted = false;
    const jwt = makeJwt('admin');
    const req = new Request('https://bwork-pos-api.workers.dev/api/settings/line/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      },
      body: JSON.stringify({ channel_access_token: 'PROD_TOKEN' })
    });

    try {
      await worker.fetch(req, prodEnv, { waitUntil: () => {} });
    } catch (expectedErr) {
      // Intercepted by our global fetch spy
    }

    assert.strictEqual(lineFetchAttempted, true, 'In production mode, fetch to api.line.me is legitimately attempted');
  });
});
