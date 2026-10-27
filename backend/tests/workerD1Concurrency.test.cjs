'use strict';

/**
 * workerD1Concurrency.test.cjs
 * Comprehensive Cloudflare D1 Cross-Channel Concurrency Safety Gate
 *
 * Verifies that the Atomic Conditional SQL Guard in Cloudflare Worker & D1
 * prevents cross-channel and cross-isolate race conditions without relying
 * on single-process in-memory mutexes.
 *
 * Scenarios Tested:
 * 1. Two Online Bookings (simultaneous race on identical slot)
 * 2. POS New Booking vs Online Booking (simultaneous cross-channel race)
 * 3. POS Room Extension vs Online Booking (simultaneous race on extension window)
 * 4. Cleaning Buffer Collision (30-min buffer boundary verification)
 * 5. Partial Failure Rollback (zero orphan booking shells or payment records on conflict)
 * 6. High-concurrency Stress Race (5 parallel requests for 1 slot -> exactly 1 winner)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Load and compile worker.js in an isolated context
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const wrappedSource = workerSource.replace('export default {', 'const workerDefault = {') +
  '\nreturn { ...workerDefault, createToken, verifyToken };';

function compileWorker(customGlobals = {}) {
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
}

function createD1Mock(db) {
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) {
          const clone = Object.create(this);
          clone._sql = this._sql;
          clone._params = args.map(a => a === undefined ? null : a);
          return clone;
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
          const info = stmt.run(...this._params);
          return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const info = stmt.run(...s._params);
          results.push({ success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } });
        }
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  };
}

function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF;');

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT,
      permissions TEXT,
      fullname TEXT
    );

    CREATE TABLE roles (
      name TEXT PRIMARY KEY,
      permissions TEXT
    );

    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY,
      name TEXT,
      capacity INTEGER,
      hourly_rate REAL,
      daily_rate REAL,
      half_day_rate REAL,
      classroom_hourly_rate REAL,
      classroom_daily_rate REAL,
      status TEXT DEFAULT 'active',
      pin_code TEXT,
      builtland_pin_code TEXT,
      description TEXT
    );

    CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      price REAL,
      category TEXT,
      image_url TEXT,
      description TEXT,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      department TEXT,
      contact TEXT,
      total_amount REAL,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      subtotal_amount REAL,
      discount_type TEXT,
      discount_value REAL,
      discount_amount REAL,
      payment_status TEXT,
      payment_method TEXT,
      receipt_number TEXT,
      pin_code TEXT,
      booking_source TEXT,
      booking_channel TEXT,
      customer_type TEXT DEFAULT 'general',
      basecamp_sub_type TEXT,
      basecamp_unit TEXT,
      customer_email TEXT,
      checkin_status TEXT,
      line_user_id TEXT,
      guest_count INTEGER,
      created_at TEXT,
      quota_hours_used REAL DEFAULT 0,
      tax_invoice_required INTEGER DEFAULT 0,
      tax_name TEXT,
      tax_address TEXT,
      tax_id TEXT,
      tax_phone TEXT,
      tax_delivery_method TEXT,
      tax_postal_address TEXT,
      slip_image_url TEXT,
      slip_trans_ref TEXT,
      slip_verify_status TEXT
    );

    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      room_id INTEGER,
      service_id INTEGER,
      quantity REAL DEFAULT 1,
      price REAL,
      start_time TEXT,
      end_time TEXT,
      subtotal REAL,
      layout TEXT DEFAULT 'standard',
      booking_type TEXT DEFAULT 'hourly',
      guest_count INTEGER,
      pin_code TEXT,
      checkin_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      amount REAL,
      payment_method TEXT,
      slip_url TEXT,
      transaction_type TEXT,
      status TEXT,
      created_at TEXT
    );

    CREATE TABLE booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      action TEXT,
      details TEXT,
      performed_by TEXT,
      created_at TEXT
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Base settings
  db.exec("INSERT INTO settings (key, value) VALUES ('cleaning_buffer_minutes', '30');");
  db.exec("INSERT INTO settings (key, value) VALUES ('online_promotion', '{\"enabled\":false}');");
  db.exec("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15');");

  // Users
  db.exec("INSERT INTO users (id, username, password_hash, role, permissions) VALUES (1, 'staff_a', 'hash', 'staff', 'pos,admin');");
  db.exec("INSERT INTO users (id, username, password_hash, role, permissions) VALUES (2, 'staff_b', 'hash', 'staff', 'pos,admin');");

  // Rooms
  db.exec("INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, status, pin_code) VALUES (302, 'Room 302 D1 Gate', 8, 500, 3000, 'active', '3302');");

  return db;
}

function createTestEnv(db) {
  const d1 = createD1Mock(db);
  const deletedKeys = [];
  return {
    env: {
      DB: d1,
      JWT_SECRET: 'bwork-pos-secret-key-change-in-production',
      BUCKET: {
        async put(key, body, opts) {
          return { key };
        },
        async delete(key) {
          deletedKeys.push(key);
          return true;
        }
      }
    },
    deletedKeys
  };
}

test('D1 Concurrency Gate - Test Suite', async (t) => {
  const db = setupTestDb();
  const { env } = createTestEnv(db);
  const worker = compileWorker();
  const staffToken = await worker.createToken({ id: 1, username: 'staff_a', role: 'staff' });

  function resetRoom302() {
    const items = db.prepare('SELECT booking_id FROM booking_items WHERE room_id = 302').all();
    for (const it of items) {
      db.prepare('DELETE FROM payment_transactions WHERE booking_id = ?').run(it.booking_id);
      db.prepare('DELETE FROM booking_history WHERE booking_id = ?').run(it.booking_id);
      db.prepare('DELETE FROM booking_items WHERE booking_id = ?').run(it.booking_id);
      db.prepare('DELETE FROM bookings WHERE id = ?').run(it.booking_id);
    }
  }

  await t.test('Scenario 1: Two Online Bookings simultaneously for the exact same room slot', async () => {
    resetRoom302();

    const payloadA = {
      customer_name: 'Online Customer A',
      contact: '0811111111',
      room_id: 302,
      booking_date: '2026-10-30',
      start_time: '14:00',
      end_time: '15:00',
      booking_type: 'hourly',
      guest_count: 2
    };

    const payloadB = {
      customer_name: 'Online Customer B',
      contact: '0822222222',
      room_id: 302,
      booking_date: '2026-10-30',
      start_time: '14:00',
      end_time: '15:00',
      booking_type: 'hourly',
      guest_count: 3
    };

    const reqA = new Request('http://localhost/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadA)
    });

    const reqB = new Request('http://localhost/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadB)
    });

    // Launch both requests in parallel across simulated isolates
    const [resA, resB] = await Promise.all([
      worker.fetch(reqA, env, {}),
      worker.fetch(reqB, env, {})
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [201, 409], 'Exactly one request must succeed (201) and one must be rejected with Conflict (409)');

    // Verify D1 database state: Exactly 1 booking item for Room 302
    const items = db.prepare('SELECT * FROM booking_items WHERE room_id = 302').all();
    assert.equal(items.length, 1, 'D1 must have exactly 1 booking_item for Room 302');

    // Verify no orphan booking shell in bookings table
    const bookings = db.prepare('SELECT * FROM bookings').all();
    assert.equal(bookings.length, 1, 'D1 must have exactly 1 booking record, no orphan shells');

    console.log('  [PASS] Scenario 1: Exactly 1 winner, 1 conflict, 0 orphan bookings');
  });

  await t.test('Scenario 2: POS New Booking vs Online Booking simultaneously (Cross-Channel Race)', async () => {
    resetRoom302();

    const onlinePayload = {
      customer_name: 'Online Line OA Customer',
      contact: '0833333333',
      room_id: 302,
      booking_date: '2026-10-30',
      start_time: '10:00',
      end_time: '11:00',
      booking_type: 'hourly',
      guest_count: 4
    };

    const posPayload = {
      customer_name: 'POS Walk-in Customer',
      contact: '0844444444',
      customer_type: 'walkin',
      payment_method: 'cash',
      payment_status: 'paid',
      total_amount: 500,
      paid_amount: 500,
      items: [
        {
          room_id: 302,
          start_time: '2026-10-30T10:00:00',
          end_time: '2026-10-30T11:00:00',
          price: 500,
          quantity: 1,
          subtotal: 500,
          booking_type: 'hourly',
          guest_count: 4
        }
      ]
    };

    const reqOnline = new Request('http://localhost/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(onlinePayload)
    });

    const reqPos = new Request('http://localhost/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify(posPayload)
    });

    const [resOnline, resPos] = await Promise.all([
      worker.fetch(reqOnline, env, {}),
      worker.fetch(reqPos, env, {})
    ]);

    const statuses = [resOnline.status, resPos.status].sort();
    assert.deepEqual(statuses, [201, 409], 'Exactly one channel must win (201) and the other must be rejected (409)');

    const items = db.prepare('SELECT * FROM booking_items WHERE room_id = 302').all();
    assert.equal(items.length, 1, 'Only 1 item committed to D1');

    const bookings = db.prepare('SELECT * FROM bookings').all();
    assert.equal(bookings.length, 1, 'Only 1 booking in D1, rejected channel cleanly rolled back');

    console.log('  [PASS] Scenario 2: Cross-channel race resolved atomically');
  });

  await t.test('Scenario 3: POS Room Extension vs Online Booking (Simultaneous Race on Extension Slot)', async () => {
    resetRoom302();

    // 1. Seed existing POS booking: 13:00 - 14:00
    const insBooking = db.prepare(`
      INSERT INTO bookings (customer_name, contact, total_amount, paid_amount, balance_amount, payment_status, payment_method, created_at)
      VALUES ('Staff Customer', '0855555555', 500, 500, 0, 'completed', 'cash', '2026-10-30T12:00:00')
    `).run();
    const bookingId = Number(insBooking.lastInsertRowid);

    const insItem = db.prepare(`
      INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal, booking_type)
      VALUES (?, 302, 1, 500, '2026-10-30T13:00:00', '2026-10-30T14:00:00', 500, 'hourly')
    `).run(bookingId);
    const itemId = Number(insItem.lastInsertRowid);

    // Concurrently:
    // A) POS extends Room 302 by 60 mins (new end: 15:00)
    // B) Online customer tries to book Room 302: 14:30 - 15:30
    const reqExtend = new Request(`http://localhost/api/bookings/${bookingId}/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        booking_item_id: itemId,
        duration_minutes: 60,
        amount_paid: 500,
        method: 'cash',
        current_end_time: '2026-10-30T14:00:00'
      })
    });

    const reqOnline = new Request('http://localhost/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Online Competing Customer',
        contact: '0866666666',
        room_id: 302,
        booking_date: '2026-10-30',
        start_time: '14:30',
        end_time: '15:30',
        booking_type: 'hourly',
        guest_count: 2
      })
    });

    const [resExtend, resOnline] = await Promise.all([
      worker.fetch(reqExtend, env, {}),
      worker.fetch(reqOnline, env, {})
    ]);

    const isOneSuccessOneConflict =
      (resExtend.status === 200 && resOnline.status === 409) ||
      (resExtend.status === 409 && resOnline.status === 201);
    assert.ok(isOneSuccessOneConflict, `One operation must succeed (200 or 201) and one must be rejected (409). Got ext=${resExtend.status}, online=${resOnline.status}`);

    // Verify integrity: no double booking in D1
    const items = db.prepare('SELECT * FROM booking_items WHERE room_id = 302').all();
    if (resExtend.status === 200) {
      assert.equal(items.length, 1, 'Only extended booking exists');
      assert.equal(items[0].end_time, '2026-10-30T15:00:00', 'Booking extended to 15:00');
    } else {
      assert.equal(resOnline.status, 201);
      assert.equal(items.length, 2);
    }

    console.log('  [PASS] Scenario 3: POS Extension vs Online race verified atomically');
  });

  await t.test('Scenario 4: Cleaning Buffer 30-min Boundary Collision', async () => {
    resetRoom302();

    // Booking 1: 14:00 - 15:00 (Cleaning buffer until 15:30)
    const req1 = new Request('http://localhost/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'First Customer',
        contact: '0877777777',
        room_id: 302,
        booking_date: '2026-10-30',
        start_time: '14:00',
        end_time: '15:00',
        booking_type: 'hourly',
        guest_count: 2
      })
    });

    const res1 = await worker.fetch(req1, env, {});
    assert.equal(res1.status, 201, 'Booking 1 created');

    // Attempt A: Booking starting inside buffer (15:15 - 16:15) -> MUST FAIL (409)
    const reqA = new Request('http://localhost/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Buffer Colliding Customer',
        contact: '0888888888',
        room_id: 302,
        booking_date: '2026-10-30',
        start_time: '15:15',
        end_time: '16:15',
        booking_type: 'hourly',
        guest_count: 2
      })
    });
    const resA = await worker.fetch(reqA, env, {});
    assert.equal(resA.status, 409, 'Booking colliding with 30m cleaning buffer must be rejected');

    // Attempt B: Booking starting exactly at buffer boundary (15:30 - 16:30) -> MUST SUCCEED (201)
    const reqB = new Request('http://localhost/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Post Buffer Customer',
        contact: '0899999999',
        room_id: 302,
        booking_date: '2026-10-30',
        start_time: '15:30',
        end_time: '16:30',
        booking_type: 'hourly',
        guest_count: 2
      })
    });
    const resB = await worker.fetch(reqB, env, {});
    assert.equal(resB.status, 201, 'Booking exactly at buffer boundary must succeed');

    console.log('  [PASS] Scenario 4: 30-min cleaning buffer boundary enforced');
  });

  await t.test('Scenario 5: Timeout / Partial Failure Rollback Cleanup', async () => {
    resetRoom302();

    // Seed existing booking: 14:00 - 15:00
    db.prepare(`
      INSERT INTO bookings (id, customer_name, contact, total_amount, paid_amount, balance_amount, payment_status, created_at)
      VALUES (999, 'Existing Block', '0800000000', 500, 500, 0, 'completed', '2026-10-30T10:00:00')
    `).run();
    db.prepare(`
      INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal)
      VALUES (999, 302, 1, 500, '2026-10-30T14:00:00', '2026-10-30T15:00:00', 500)
    `).run();

    // Now POS attempts to create a multi-item booking where Room 302 conflicts
    const posReq = new Request('http://localhost/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        customer_name: 'Failed Booking Walkin',
        contact: '0812345678',
        customer_type: 'walkin',
        payment_method: 'cash',
        payment_status: 'paid',
        total_amount: 500,
        paid_amount: 500,
        items: [
          {
            room_id: 302,
            start_time: '2026-10-30T14:00:00',
            end_time: '2026-10-30T15:00:00',
            price: 500,
            quantity: 1,
            subtotal: 500
          }
        ]
      })
    });

    const res = await worker.fetch(posReq, env, {});
    assert.equal(res.status, 409, 'Must return 409 Conflict');

    // Confirm total bookings in D1: ONLY id 999 remains. No partial shell!
    const allBookings = db.prepare('SELECT * FROM bookings').all();
    assert.equal(allBookings.length, 1, 'No orphan booking shell left behind');
    assert.equal(allBookings[0].id, 999);

    const allTx = db.prepare('SELECT * FROM payment_transactions').all();
    assert.equal(allTx.length, 0, 'No partial payment transaction created');

    console.log('  [PASS] Scenario 5: Full rollback on conflict confirmed');
  });

  await t.test('Scenario 6: High-Concurrency Stress Race (5 parallel requests for 1 slot)', async () => {
    resetRoom302();

    const makeReq = (i) => new Request('http://localhost/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: `Stress User ${i}`,
        contact: `081000000${i}`,
        room_id: 302,
        booking_date: '2026-10-30',
        start_time: '16:00',
        end_time: '17:00',
        booking_type: 'hourly',
        guest_count: 2
      })
    });

    const results = await Promise.all([
      worker.fetch(makeReq(1), env, {}),
      worker.fetch(makeReq(2), env, {}),
      worker.fetch(makeReq(3), env, {}),
      worker.fetch(makeReq(4), env, {}),
      worker.fetch(makeReq(5), env, {})
    ]);

    const statuses = results.map(r => r.status);
    const successCount = statuses.filter(s => s === 201).length;
    const conflictCount = statuses.filter(s => s === 409).length;

    assert.equal(successCount, 1, 'Exactly 1 request out of 5 must succeed (201)');
    assert.equal(conflictCount, 4, 'Exactly 4 requests out of 5 must be rejected (409)');

    const items = db.prepare('SELECT * FROM booking_items WHERE room_id = 302').all();
    assert.equal(items.length, 1, 'D1 must have exactly 1 item for the slot');

    const bookings = db.prepare('SELECT * FROM bookings').all();
    assert.equal(bookings.length, 1, 'D1 must have exactly 1 booking record');

    console.log(`  [PASS] Scenario 6: High-concurrency race (1 won, 4 rejected, 1 DB row)`);
  });
});
