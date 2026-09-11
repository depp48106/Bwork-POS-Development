const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Load and evaluate worker.js in an isolated context
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const wrappedSource = workerSource.replace('export default {', 'const workerDefault = {') +
  '\nreturn { ...workerDefault, createToken, verifyToken, buildHourCreditVoucherFlex };';

const compileWorker = (customGlobals = {}) => {
  const globals = {
    URL,
    Response,
    Request,
    Headers,
    TextEncoder,
    Uint8Array,
    crypto: globalThis.crypto,
    console,
    isNaN,
    Number,
    parseInt,
    Date,
    btoa,
    atob,
    ...customGlobals
  };
  const fn = new Function(...Object.keys(globals), wrappedSource);
  return fn(...Object.values(globals));
};

// Create a D1-compatible mock backed by node:sqlite DatabaseSync
function createD1Mock(db) {
  return {
    prepare(sql) {
      return {
        _params: [],
        bind(...args) {
          const clone = Object.create(this);
          clone._params = args;
          return clone;
        },
        async first() {
          const stmt = db.prepare(sql);
          return stmt.get(...this._params) || null;
        },
        async all() {
          const stmt = db.prepare(sql);
          return { results: stmt.all(...this._params) };
        },
        async run() {
          const stmt = db.prepare(sql);
          const info = stmt.run(...this._params);
          return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        }
      };
    }
  };
}

function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');

  // Apply migrations 001 - 004
  for (let i = 1; i <= 4; i++) {
    const file = path.join(__dirname, `../migrations/00${i}${
      i === 1 ? '_core_schema.sql' :
      i === 2 ? '_add_booking_channel.sql' :
      i === 3 ? '_slip_unique_index.sql' :
      '_add_builtland_pin_to_rooms.sql'
    }`);
    const sql = fs.readFileSync(file, 'utf8');
    db.exec(sql);
  }

  // Apply migration 005 (stripping explicit BEGIN / COMMIT for D1 compatibility)
  const file005 = path.join(__dirname, '../migrations/005_room_hour_credits.sql');
  let sql005 = fs.readFileSync(file005, 'utf8');
  sql005 = sql005.replace('BEGIN IMMEDIATE;', '').replace('COMMIT;', '');
  db.exec(sql005);

  // Insert settings
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('cleaning_buffer_minutes', '30');");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('line_channel_access_token', 'test-line-token-12345');");

  // Insert test room
  db.exec("INSERT INTO rooms (id, name, capacity, hourly_rate, status, pin_code) VALUES (1, 'Meeting Room A', 6, 250, 'active', '1234');");
  db.exec("INSERT INTO rooms (id, name, capacity, hourly_rate, status, pin_code) VALUES (2, 'Meeting Room B', 10, 400, 'active', '5678');");
  db.exec("INSERT INTO rooms (id, name, capacity, hourly_rate, status, pin_code, has_hourly) VALUES (3, 'Meeting Room Same Rate', 8, 250, 'active', '3333', 1);");
  db.exec("INSERT INTO rooms (id, name, capacity, hourly_rate, status, pin_code, has_hourly) VALUES (4, 'Meeting Room Lower Rate', 8, 200, 'active', '4444', 1);");
  db.exec("INSERT INTO rooms (id, name, capacity, hourly_rate, status, pin_code, has_hourly) VALUES (5, 'Meeting Room Higher Rate', 8, 300, 'active', '5555', 1);");
  db.exec("INSERT INTO rooms (id, name, capacity, hourly_rate, status, pin_code, has_hourly) VALUES (6, 'Inactive Same Rate', 8, 250, 'inactive', '6666', 1);");
  db.exec("INSERT INTO rooms (id, name, capacity, hourly_rate, status, pin_code, has_hourly) VALUES (7, 'Non-hourly Same Rate', 8, 250, 'active', '7777', 0);");

  // Insert admin staff user
  db.exec("INSERT INTO users (id, username, password_hash, role, permissions) VALUES (1, 'admin', 'hash', 'admin', 'pos,admin');");
  db.exec("INSERT INTO users (id, username, password_hash, role, permissions) VALUES (2, 'staff_no_pos', 'hash', 'staff', 'reports');");

  return db;
}

test('Worker Hour Credits - Full Parity & D1 Concurrency Test Suite', async (t) => {
  const db = setupTestDb();
  let lineCalls = [];
  let lineShouldFail = false;

  const mockFetch = async (url, options) => {
    if (url.startsWith('https://api.line.me/')) {
      lineCalls.push({ url, options, body: JSON.parse(options.body) });
      if (lineShouldFail) {
        return new Response(JSON.stringify({ message: 'Internal server error from LINE' }), { status: 500 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return globalThis.fetch(url, options);
  };

  const worker = compileWorker({ fetch: mockFetch });
  const adminToken = await worker.createToken({ id: 1, username: 'admin', role: 'admin', permissions: 'pos' });
  const noPosToken = await worker.createToken({ id: 2, username: 'staff_no_pos', role: 'staff', permissions: 'reports' });

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'test-line-token-12345'
  };

  const authHeader = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  // Helper to send request to worker
  async function callWorker(pathname, method = 'GET', body = null, headers = authHeader) {
    const reqHeaders = new Headers(headers);
    const req = new Request(`https://pos.bwork.invalid${pathname}`, {
      method,
      headers: reqHeaders,
      body: body ? JSON.stringify(body) : null
    });
    const res = await worker.fetch(req, env);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, headers: res.headers, data: json };
  }

  // 1. Create a safe Source Booking A (paid hourly room booking for 4 hours = 240 mins)
  const now = Date.now();
  const startTomorrow = new Date(now + 24 * 3600000).toISOString().slice(0, 10) + 'T10:00:00';
  const endTomorrow = new Date(now + 24 * 3600000).toISOString().slice(0, 10) + 'T14:00:00';

  db.exec(`INSERT INTO bookings (id, customer_name, contact, line_user_id, total_amount, payment_status, payment_method, billing_option, receipt_number, pin_code, booking_source, customer_type, checkin_status, created_at)
    VALUES (101, 'สมชาย สุขใจ', '0812345678', 'U9876543210fedcba', 1000, 'paid', 'promptpay', 'hourly', 'BK-2609001', '9999', 'online', 'online', 'pending', '2026-09-10T10:00:00');`);
  db.exec(`INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, booking_type, layout, pin_code, checkin_status)
    VALUES (201, 101, 1, 4, 250, 1000, '${startTomorrow}', '${endTomorrow}', 'hourly', 'standard', '9999', 'pending');`);

  let createdCreditId = null;

  await t.test('1. Auth check: Staff without pos permission is rejected with 403', async () => {
    const res = await callWorker('/api/hour-credits', 'GET', null, { Authorization: `Bearer ${noPosToken}` });
    assert.strictEqual(res.status, 403);
    assert.match(res.data.error, /ไม่มีสิทธิ์เข้าถึง/);
  });

  await t.test('2. Query source booking: GET /api/hour-credits/source/:ref', async () => {
    const res = await callWorker('/api/hour-credits/source/BK-2609001');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.id, 101);
    assert.strictEqual(res.data.customer_name, 'สมชาย สุขใจ');
    assert.strictEqual(res.data.items.length, 1);
    assert.strictEqual(res.data.items[0].id, 201);
    assert.strictEqual(res.data.items[0].existing_credit_id, null);
  });

  await t.test('3. Grant hour credit: POST /api/hour-credits (240 minutes)', async () => {
    const res = await callWorker('/api/hour-credits', 'POST', {
      source_booking_id: 101,
      source_item_id: 201,
      minutes: 240,
      reason: 'ลูกค้าขอเลื่อนวันใช้งานเนื่องจากติดธุระด่วน',
      idempotency_key: 'grant-key-101-201-initial'
    });

    assert.strictEqual(res.status, 200);
    assert.match(res.data.credit_id, /^HC-\d{6}-\d{4}$/);
    assert.strictEqual(res.data.entry_type, 'grant');
    assert.strictEqual(res.data.minutes_delta, 240);
    createdCreditId = res.data.credit_id;

    // Verify no LINE push was sent automatically during grant
    assert.strictEqual(lineCalls.length, 0, 'Grant must NEVER auto-send LINE push');
  });

  await t.test('4. Inspect credit detail: GET /api/hour-credits/:creditId', async () => {
    const res = await callWorker(`/api/hour-credits/${createdCreditId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.credit_id, createdCreditId);
    assert.strictEqual(res.data.customer_name, 'สมชาย สุขใจ');
    assert.strictEqual(res.data.customer_phone, '0812345678');
    assert.strictEqual(res.data.has_line, true);
    assert.strictEqual(res.data.line_user_id, undefined, 'Private line_user_id must be stripped from response');
    assert.strictEqual(res.data.original_granted_minutes, 240);
    assert.strictEqual(res.data.redeemed_minutes, 0);
    assert.strictEqual(res.data.remaining_minutes, 240);
    assert.strictEqual(res.data.status, 'available');
    assert.strictEqual(res.data.history.length, 1);
    assert.strictEqual(res.data.history[0].entry_type, 'grant');
  });

  await t.test('5. Duplicate grant rejection: same source item cannot be granted again', async () => {
    const res = await callWorker('/api/hour-credits', 'POST', {
      source_booking_id: 101,
      source_item_id: 201,
      minutes: 240,
      reason: 'พยายาม grant ซ้ำ',
      idempotency_key: 'grant-key-different-attempt-2'
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.data.error, /already has credit|Credit constraint conflict/);
  });

  await t.test('6. Grant validation: minutes > source duration rejected with 409', async () => {
    // Create another hourly booking with 1 hour duration
    db.exec(`INSERT INTO bookings (id, customer_name, contact, total_amount, payment_status, payment_method, billing_option, receipt_number, created_at)
      VALUES (102, 'ลูกค้า B', '0822222222', 250, 'paid', 'promptpay', 'hourly', 'BK-2609002', '2026-09-10T11:00:00');`);
    db.exec(`INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, booking_type, checkin_status)
      VALUES (202, 102, 1, 1, 250, 250, '${startTomorrow}', '${new Date(Date.parse(startTomorrow + '+07:00') + 3600000).toISOString().slice(0, 19)}', 'hourly', 'pending');`);

    const res = await callWorker('/api/hour-credits', 'POST', {
      source_booking_id: 102,
      source_item_id: 202,
      minutes: 120, // 2 hours requested for a 1 hour booking
      reason: 'ขอเกินเวลาเดิม',
      idempotency_key: 'grant-key-exceed-duration'
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.data.error, /Grant exceeds original duration/);
  });

  await t.test('7. Grant idempotency: exact replay returns cached response', async () => {
    const res = await callWorker('/api/hour-credits', 'POST', {
      source_booking_id: 101,
      source_item_id: 201,
      minutes: 240,
      reason: 'ลูกค้าขอเลื่อนวันใช้งานเนื่องจากติดธุระด่วน',
      idempotency_key: 'grant-key-101-201-initial'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.credit_id, createdCreditId);
    assert.strictEqual(res.data.entry_type, 'grant');
  });

  await t.test('8. Grant idempotency: same key with mismatched payload rejected with 409', async () => {
    const res = await callWorker('/api/hour-credits', 'POST', {
      source_booking_id: 101,
      source_item_id: 201,
      minutes: 120, // changed payload
      reason: 'payload เปลี่ยน',
      idempotency_key: 'grant-key-101-201-initial'
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.data.error, /Idempotency key already used with a different request/);
  });

  let redeemBookingId = null;
  let redeemItemId = null;
  let redeemEntryId = null;
  const futureRedeemStart = new Date(now + 48 * 3600000).toISOString().slice(0, 10) + 'T13:00:00';
  const futureRedeemEnd = new Date(now + 48 * 3600000).toISOString().slice(0, 10) + 'T15:00:00';

  await t.test('8A. Eligible-room endpoint returns active hourly rooms at exact source rate', async () => {
    const res = await callWorker(`/api/hour-credits/${createdCreditId}/eligible-rooms`);
    assert.strictEqual(res.status, 200);
    assert.deepEqual(res.data.map(room => room.id).sort((a,b)=>a-b), [1, 3]);
  });

  await t.test('8AA. Legacy long-ID credit is searchable and can redeem into another same-rate room', async () => {
    const legacyId = 'HC-b5a8ebd4-7aed-40f1-9183-6055379514ff';
    db.prepare(`INSERT INTO room_hour_credits
      (credit_id, source_booking_id, source_item_id, customer_name, customer_phone, room_id, created_by, created_at)
      VALUES (?, 102, 202, 'Legacy customer', '0822222222', 1, 1, '2026-01-01T10:00:00')`).run(legacyId);
    db.prepare(`INSERT INTO room_hour_credit_entries
      (credit_id, entry_type, minutes_delta, reason, created_by, created_at, idempotency_key, request_fingerprint)
      VALUES (?, 'grant', 60, 'Legacy grant', 1, '2026-01-01T10:00:00', 'legacy-worker-grant', 'legacy-worker-fingerprint')`).run(legacyId);
    const rooms = await callWorker(`/api/hour-credits/${legacyId}/eligible-rooms`);
    assert.strictEqual(rooms.status, 200);
    assert.deepEqual(rooms.data.map(room => room.id).sort((a,b)=>a-b), [1, 3]);
    const search = await callWorker(`/api/hour-credits?search=${encodeURIComponent(legacyId)}`);
    assert.strictEqual(search.data[0].credit_id, legacyId);
    const legacyDate = new Date(now + 120 * 3600000).toISOString().slice(0, 10);
    const redeemed = await callWorker(`/api/hour-credits/${legacyId}/redeem`, 'POST', {
      room_id: 3,
      minutes: 60,
      start_time: legacyDate + 'T09:00:00',
      end_time: legacyDate + 'T10:00:00',
      reason: 'Legacy flexible-room test',
      idempotency_key: 'legacy-worker-redeem'
    });
    assert.strictEqual(redeemed.status, 200);
    assert.strictEqual(db.prepare('SELECT room_id FROM booking_items WHERE id = ?').get(redeemed.data.booking_item_id).room_id, 3);
    assert.strictEqual(db.prepare('SELECT room_id FROM room_hour_credits WHERE credit_id = ?').get(legacyId).room_id, 1);
  });

  await t.test('8B. Worker independently rejects different-rate/inactive/non-hourly rooms without deduction', async () => {
    const bookingCount = db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;
    for (const roomId of [2, 4, 5, 6, 7]) {
      const res = await callWorker(`/api/hour-credits/${createdCreditId}/redeem`, 'POST', {
        room_id: roomId,
        minutes: 60,
        start_time: futureRedeemStart,
        end_time: futureRedeemStart.slice(0, 11) + '14:00:00',
        reason: 'ทดสอบกฎอัตราห้อง',
        idempotency_key: `redeem-invalid-room-${roomId}`
      });
      assert.strictEqual(res.status, 409);
      assert.match(res.data.error, /อัตราค่าบริการ|unavailable/i);
    }
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, bookingCount);
    const detail = await callWorker(`/api/hour-credits/${createdCreditId}`);
    assert.strictEqual(detail.data.remaining_minutes, 240);
  });

  await t.test('9. Redeem credit (Booking B): POST /api/hour-credits/:creditId/redeem (120 minutes)', async () => {
    const res = await callWorker(`/api/hour-credits/${createdCreditId}/redeem`, 'POST', {
      room_id: 3,
      minutes: 120,
      start_time: futureRedeemStart,
      end_time: futureRedeemEnd,
      reason: 'ลูกค้ามาใช้สิทธิ์ 2 ชั่วโมง',
      idempotency_key: 'redeem-key-001'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.credit_id, createdCreditId);
    assert.strictEqual(res.data.entry_type, 'redeem');
    assert.strictEqual(res.data.minutes_delta, -120);
    assert.ok(res.data.booking_id > 0);
    assert.ok(res.data.booking_item_id > 0);
    redeemBookingId = res.data.booking_id;
    redeemItemId = res.data.booking_item_id;
    redeemEntryId = res.data.entry_id;

    // Verify Booking B properties in SQLite
    const bRow = db.prepare('SELECT * FROM bookings WHERE id = ?').get(redeemBookingId);
    assert.strictEqual(bRow.payment_status, 'paid');
    assert.strictEqual(bRow.payment_method, 'hour_credit');
    assert.strictEqual(bRow.billing_option, 'hour_credit');
    assert.strictEqual(bRow.total_amount, 0);

    const itemRow = db.prepare('SELECT * FROM booking_items WHERE id = ?').get(redeemItemId);
    assert.strictEqual(itemRow.price, 0);
    assert.strictEqual(itemRow.subtotal, 0);
    assert.strictEqual(itemRow.start_time, futureRedeemStart);
    assert.strictEqual(itemRow.end_time, futureRedeemEnd);
    assert.strictEqual(itemRow.room_id, 3);

    // Verify detail remaining balance is now 120
    const detailRes = await callWorker(`/api/hour-credits/${createdCreditId}`);
    assert.strictEqual(detailRes.data.remaining_minutes, 120);
    assert.strictEqual(detailRes.data.status, 'partially_used');

    // Verify no LINE push was sent automatically during redeem
    assert.strictEqual(lineCalls.length, 0, 'Redeem must NEVER auto-send LINE push');
  });

  await t.test('10. Over-redeem rejection: cannot redeem more than remaining balance', async () => {
    const bookingsCountBefore = db.prepare('SELECT COUNT(*) AS c FROM bookings').get().c;
    const res = await callWorker(`/api/hour-credits/${createdCreditId}/redeem`, 'POST', {
      room_id: 3,
      minutes: 180, // remaining is only 120
      start_time: new Date(now + 72 * 3600000).toISOString().slice(0, 10) + 'T10:00:00',
      end_time: new Date(now + 72 * 3600000).toISOString().slice(0, 10) + 'T13:00:00',
      reason: 'พยายามใช้เกินยอดคงเหลือ',
      idempotency_key: 'redeem-key-overspend'
    });

    assert.strictEqual(res.status, 409);
    assert.match(res.data.error, /Insufficient credit/);

    // Verify no orphan booking was left behind
    const bookingsCountAfter = db.prepare('SELECT COUNT(*) AS c FROM bookings').get().c;
    assert.strictEqual(bookingsCountAfter, bookingsCountBefore, 'No orphan booking must be created on over-redeem');
  });

  await t.test('11. Overlap failure: conflict slot rejected without deducting credit', async () => {
    // Attempt to book overlapping with futureRedeemStart..futureRedeemEnd on Room 1
    const conflictStart = new Date(now + 48 * 3600000).toISOString().slice(0, 10) + 'T14:00:00';
    const conflictEnd = new Date(now + 48 * 3600000).toISOString().slice(0, 10) + 'T16:00:00';

    const res = await callWorker(`/api/hour-credits/${createdCreditId}/redeem`, 'POST', {
      room_id: 3,
      minutes: 120,
      start_time: conflictStart,
      end_time: conflictEnd,
      reason: 'ชนกับเวลาที่จองไว้แล้ว',
      idempotency_key: 'redeem-key-overlap'
    });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.data.error, 'ช่วงเวลานี้มีการจองแล้ว กรุณาเลือกเวลาอื่น');

    const bufferRes = await callWorker(`/api/hour-credits/${createdCreditId}/redeem`, 'POST', {
      room_id: 3,
      minutes: 60,
      start_time: futureRedeemStart.slice(0, 11) + '15:15:00',
      end_time: futureRedeemStart.slice(0, 11) + '16:15:00',
      reason: 'ชนเวลาทำความสะอาด',
      idempotency_key: 'redeem-key-cleaning-buffer'
    });
    assert.strictEqual(bufferRes.status, 409);
    assert.strictEqual(bufferRes.data.error, 'ช่วงเวลานี้มีการจองแล้ว กรุณาเลือกเวลาอื่น');

    const blocked = await callWorker(`/api/hour-credits/${createdCreditId}/blocked-ranges?room_id=3&date=${futureRedeemStart.slice(0,10)}`);
    assert.strictEqual(blocked.status, 200);
    assert.strictEqual(blocked.data.cleaning_buffer_minutes, 30);
    assert.strictEqual(blocked.data.ranges.length, 1);

    // Verify remaining minutes still 120
    const detailRes = await callWorker(`/api/hour-credits/${createdCreditId}`);
    assert.strictEqual(detailRes.data.remaining_minutes, 120);
  });

  await t.test('12. D1 Concurrency & Trigger defense: trigger hour_credit_no_negative prevents balance < 0', async () => {
    // Direct test of trigger: an insert that brings SUM(minutes_delta) < 0 must be aborted by SQLite
    assert.throws(() => {
      db.exec(`INSERT INTO room_hour_credit_entries
        (credit_id, entry_type, minutes_delta, booking_item_id, reverses_entry_id, reason, created_by, created_at, idempotency_key, request_fingerprint)
        VALUES ('${createdCreditId}', 'redeem', -999, 201, NULL, 'test trigger', 1, '2026-09-10T12:00:00', 'trigger-test-key', 'fp')`);
    }, /hour credit insufficient balance/);

    // Test append-only ledger triggers: entries cannot be updated or deleted
    assert.throws(() => {
      db.exec("DELETE FROM room_hour_credit_entries;");
    }, /hour credit ledger is append only/);

    assert.throws(() => {
      db.exec("UPDATE room_hour_credit_entries SET minutes_delta = 10;");
    }, /hour credit ledger is append only/);
  });

  await t.test('13. Mutation Guard: generic mutations on Booking B blocked', async () => {
    // Test update booking on Booking B
    const updateRes = await callWorker(`/api/bookings/${redeemBookingId}`, 'PUT', { customer_name: 'Hacked' });
    assert.strictEqual(updateRes.status, 409);
    assert.match(updateRes.data.error, /Use hour-credit reversal; generic booking mutations are disabled/);

    // Test cancel booking on Booking B
    const cancelRes = await callWorker(`/api/bookings/${redeemBookingId}/cancel`, 'POST', { reason: 'generic cancel' });
    assert.strictEqual(cancelRes.status, 409);
    assert.match(cancelRes.data.error, /Use hour-credit reversal; generic booking mutations are disabled/);

    // Test delete booking on Booking B
    const deleteRes = await callWorker(`/api/bookings/${redeemBookingId}`, 'DELETE');
    assert.strictEqual(deleteRes.status, 409);
    assert.match(deleteRes.data.error, /Use hour-credit reversal; generic booking mutations are disabled/);
  });

  await t.test('14. Mutation Guard: DELETE on Source Booking A blocked', async () => {
    const deleteRes = await callWorker('/api/bookings/101', 'DELETE');
    assert.strictEqual(deleteRes.status, 409);
    assert.match(deleteRes.data.error, /Source booking is linked to hour credit/);

    // Direct SQLite trigger test: trigger hour_credit_booking_no_delete must also abort
    assert.throws(() => {
      db.exec('DELETE FROM bookings WHERE id = 101;');
    }, /booking linked to hour credit cannot be deleted/);
  });

  await t.test('15. Mutation Guard: /api/admin/clear-history blocked when credits exist', async () => {
    const res = await callWorker('/api/admin/clear-history', 'POST', { confirm: true });
    assert.strictEqual(res.status, 409);
    assert.match(res.data.error, /History contains hour credit; clearing is disabled/);
  });

  await t.test('16. Reversal once: POST /api/hour-credits/:creditId/reversals', async () => {
    const res = await callWorker(`/api/hour-credits/${createdCreditId}/reversals`, 'POST', {
      entry_id: redeemEntryId,
      reason: 'ลูกค้ายกเลิกการจองล่วงหน้า ขอคืนชั่วโมง',
      idempotency_key: 'reverse-key-001'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.credit_id, createdCreditId);
    assert.strictEqual(res.data.entry_type, 'reversal');
    assert.strictEqual(res.data.minutes_delta, 120);

    // Verify Booking B is cancelled in DB
    const bRow = db.prepare('SELECT * FROM bookings WHERE id = ?').get(redeemBookingId);
    assert.strictEqual(bRow.payment_status, 'cancelled');
    assert.strictEqual(bRow.checkin_status, 'cancelled');
    assert.strictEqual(bRow.cancellation_reason, 'ลูกค้ายกเลิกการจองล่วงหน้า ขอคืนชั่วโมง');

    // Verify remaining balance restored to 240
    const detailRes = await callWorker(`/api/hour-credits/${createdCreditId}`);
    assert.strictEqual(detailRes.data.remaining_minutes, 240);
    assert.strictEqual(detailRes.data.status, 'available');

    // Verify no LINE push was sent automatically during reversal
    assert.strictEqual(lineCalls.length, 0, 'Reversal must NEVER auto-send LINE push');
  });

  await t.test('17. Duplicate reversal rejection: cannot reverse the same redeem entry twice', async () => {
    const res = await callWorker(`/api/hour-credits/${createdCreditId}/reversals`, 'POST', {
      entry_id: redeemEntryId,
      reason: 'พยายามยกเลิกซ้ำ',
      idempotency_key: 'reverse-key-attempt-2'
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.data.error, /Redeem already reversed/);
  });

  await t.test('18. Post-start reversal rejection: cannot reverse booking whose start_time is in the past', async () => {
    // Redeem a slot that starts in the future first
    const nearFutureStart = new Date(now + 24 * 3600000).toISOString().slice(0, 10) + 'T16:00:00';
    const nearFutureEnd = new Date(now + 24 * 3600000).toISOString().slice(0, 10) + 'T17:00:00';
    const redeemRes = await callWorker(`/api/hour-credits/${createdCreditId}/redeem`, 'POST', {
      minutes: 60,
      start_time: nearFutureStart,
      end_time: nearFutureEnd,
      reason: 'จอง 1 ชั่วโมงสำหรับเทสต์เวลาผ่าน',
      idempotency_key: 'redeem-past-test-key'
    });
    assert.strictEqual(redeemRes.status, 200);

    // Simulate start_time passing into the past in the database
    db.exec(`UPDATE booking_items SET start_time = '2020-01-01T10:00:00' WHERE id = ${redeemRes.data.booking_item_id};`);

    // Attempt to reverse
    const revRes = await callWorker(`/api/hour-credits/${createdCreditId}/reversals`, 'POST', {
      entry_id: redeemRes.data.entry_id,
      reason: 'ขอคืนหลังเวลาเริ่มแล้ว',
      idempotency_key: 'reverse-past-key'
    });
    assert.strictEqual(revRes.status, 409);
    assert.match(revRes.data.error, /Reversal allowed only before booking start/);
  });

  await t.test('19. Manual LINE voucher: client cannot specify recipient', async () => {
    const res = await callWorker(`/api/hour-credits/${createdCreditId}/send-line`, 'POST', {
      to: 'UattackerSpecifiedId'
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.data.error, /Client cannot specify LINE recipient/);

    const res2 = await callWorker(`/api/hour-credits/${createdCreditId}/send-line`, 'POST', {
      line_user_id: 'UattackerSpecifiedId'
    });
    assert.strictEqual(res2.status, 400);
    assert.match(res2.data.error, /Client cannot specify LINE recipient/);
  });

  await t.test('20. Manual LINE voucher: successful push with correct data and no PII', async () => {
    lineCalls = [];
    const res = await callWorker(`/api/hour-credits/${createdCreditId}/send-line`, 'POST', {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);

    assert.strictEqual(lineCalls.length, 1);
    const call = lineCalls[0];
    assert.strictEqual(call.body.to, 'U9876543210fedcba', 'Must use recipient snapshot from DB');

    const msg = call.body.messages[0];
    assert.strictEqual(msg.type, 'flex');
    assert.strictEqual(msg.altText.includes(createdCreditId), true);
    assert.strictEqual(msg.contents.header.contents[1].text, 'ใบยืนยันชั่วโมงคงเหลือ');

    const bodyStr = JSON.stringify(msg.contents.body);
    assert.ok(bodyStr.includes(createdCreditId), 'Must include credit ID');
    assert.ok(bodyStr.includes('Meeting Room A'), 'Must include room name');
    assert.ok(bodyStr.includes('ชั่วโมงคงเหลือ'), 'Must include balance title');
    assert.ok(bodyStr.includes('3 ชั่วโมง 0 นาที'), 'Must show remaining balance 180 mins');
    assert.ok(bodyStr.includes('ยอดในระบบเป็นข้อมูลอ้างอิงสูงสุด เอกสารนี้แสดงยอด ณ เวลาที่ส่ง'), 'Must include disclaimer');

    // Strictly verify NO PII, PIN, phone, or tokens in message
    assert.ok(!bodyStr.includes('0812345678'), 'Phone number must NOT be in Flex');
    assert.ok(!bodyStr.includes('9999'), 'PIN code must NOT be in Flex');
    assert.ok(!bodyStr.includes('token'), 'Tokens must NOT be in Flex');
    assert.ok(!bodyStr.includes('slip'), 'Slip info must NOT be in Flex');
  });

  await t.test('21. Manual LINE voucher: error isolation does not affect ledger or booking', async () => {
    lineCalls = [];
    lineShouldFail = true;

    const entriesCountBefore = db.prepare('SELECT COUNT(*) AS c FROM room_hour_credit_entries').get().c;
    const res = await callWorker(`/api/hour-credits/${createdCreditId}/send-line`, 'POST', {});
    assert.strictEqual(res.status, 502);
    assert.match(res.data.error, /LINE API ตอบกลับผิดพลาด|ส่งข้อความไม่สำเร็จ/);

    const entriesCountAfter = db.prepare('SELECT COUNT(*) AS c FROM room_hour_credit_entries').get().c;
    assert.strictEqual(entriesCountAfter, entriesCountBefore, 'LINE failure must not alter ledger entries');

    lineShouldFail = false;
  });

  await t.test('22. Search hour credits: GET /api/hour-credits?search=', async () => {
    // Search by Credit ID
    const searchRes = await callWorker(`/api/hour-credits?search=${createdCreditId.slice(0, 10)}`);
    assert.strictEqual(searchRes.status, 200);
    assert.ok(searchRes.data.length >= 1);
    assert.strictEqual(searchRes.data[0].credit_id, createdCreditId);

    // Search by phone
    const phoneRes = await callWorker('/api/hour-credits?search=0812345678');
    assert.strictEqual(phoneRes.status, 200);
    assert.ok(phoneRes.data.length >= 1);
    assert.strictEqual(phoneRes.data[0].customer_phone, '0812345678');
  });
});
