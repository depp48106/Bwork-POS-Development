'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sqlite3 = require('sqlite3');

// 1. Extract cancelExpiredBookings directly from backend/worker.js Source of Truth
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const startIdx = workerSource.indexOf('async function cancelExpiredBookings(env, options = {})');
const endIdx = workerSource.indexOf('const BACKUP_TABLES = [', startIdx);
assert.ok(startIdx > 0 && endIdx > startIdx, 'Failed to locate cancelExpiredBookings in worker.js');
const fnCode = workerSource.slice(startIdx, endIdx).trim();

const cancelExpiredBookings = vm.runInNewContext(
  `(${fnCode})`,
  { console, Date, Number, parseInt, isNaN }
);

// 2. In-memory SQLite Database Helper simulating Cloudflare D1
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

// 3. Schema Initialization
async function initSchema(query) {
  await query.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      department TEXT,
      contact TEXT,
      total_amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      payment_method TEXT,
      receipt_number TEXT,
      pin_code TEXT,
      booking_source TEXT DEFAULT 'online',
      slip_image_url TEXT,
      checkin_status TEXT DEFAULT 'pending',
      cancellation_reason TEXT,
      created_at TEXT
    );

    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      room_id INTEGER,
      checkin_status TEXT DEFAULT 'pending'
    );
  `);
}

// =========================================================================
// TEST SUITE: 20 Test Cases for Production Auto-Cancel
// =========================================================================

test('TC1: pending + expired -> cancelled', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000; // Reference epoch
  const createdAt = new Date(baseTime - 16 * 60 * 1000).toISOString(); // 16 mins ago

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (1, 'Customer 1', 300, 'pending', 'online', ?)
  `, [createdAt]);
  await query.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (1, 101)`);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 1);

  const b = await query.get("SELECT * FROM bookings WHERE id = 1");
  assert.equal(b.payment_status, 'cancelled');
  assert.equal(b.checkin_status, 'cancelled');
  assert.equal(b.cancellation_reason, 'ไม่ได้ทำการชำระเงินภายในเวลาที่กำหนด (15 นาที)');

  const item = await query.get("SELECT * FROM booking_items WHERE booking_id = 1");
  assert.equal(item.checkin_status, 'cancelled');
});

test('TC2: pending + not expired -> unchanged', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 10 * 60 * 1000).toISOString(); // 10 mins ago (5 mins left)

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (2, 'Customer 2', 300, 'pending', 'online', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 2");
  assert.equal(b.payment_status, 'pending');
});

test('TC3: reviewing + expired -> unchanged (NEVER cancel reviewing)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 30 * 60 * 1000).toISOString(); // 30 mins ago

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, slip_image_url, created_at)
    VALUES (3, 'Customer 3', 300, 'reviewing', 'online', 'https://r2.bwork.co/slip3.jpg', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 3");
  assert.equal(b.payment_status, 'reviewing');
});

test('TC4: paid + expired -> unchanged', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 60 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (4, 'Customer 4', 300, 'paid', 'online', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 4");
  assert.equal(b.payment_status, 'paid');
});

test('TC5: internal_free -> unchanged', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 45 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (5, 'Internal User', 0, 'internal_free', 'pos', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 5");
  assert.equal(b.payment_status, 'internal_free');
});

test('TC6: already cancelled -> unchanged', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 30 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, cancellation_reason, created_at)
    VALUES (6, 'Customer 6', 300, 'cancelled', 'online', 'User self-cancelled', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 6");
  assert.equal(b.payment_status, 'cancelled');
  assert.equal(b.cancellation_reason, 'User self-cancelled');
});

test('TC7: simultaneous staff approve vs cron -> changes = 0, paid survives', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 16 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (7, 'Customer 7', 300, 'pending', 'online', ?)
  `, [createdAt]);

  // Intercept the candidate loop: staff approves right before the UPDATE statement
  const originalPrepare = env.DB.prepare;
  env.DB.prepare = function (sql) {
    if (sql.includes('UPDATE bookings')) {
      // Simulate staff marking booking as paid concurrently
      query.run("UPDATE bookings SET payment_status = 'paid' WHERE id = 7");
    }
    return originalPrepare.call(env.DB, sql);
  };

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 7");
  assert.equal(b.payment_status, 'paid'); // Paid survived, never overwritten!
});

test('TC8: slip upload before cron -> changes = 0, reviewing survives', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 16 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (8, 'Customer 8', 300, 'pending', 'online', ?)
  `, [createdAt]);

  const originalPrepare = env.DB.prepare;
  env.DB.prepare = function (sql) {
    if (sql.includes('UPDATE bookings')) {
      // Simulate customer completing slip upload concurrently
      query.run("UPDATE bookings SET payment_status = 'reviewing', slip_image_url = 'https://r2/slip8.jpg' WHERE id = 8");
    }
    return originalPrepare.call(env.DB, sql);
  };

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 8");
  assert.equal(b.payment_status, 'reviewing');
  assert.equal(b.slip_image_url, 'https://r2/slip8.jpg');
});

test('TC9: repeated cron execution -> idempotent, second run changes = 0', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 20 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (9, 'Customer 9', 300, 'pending', 'online', ?)
  `, [createdAt]);

  const firstRun = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(firstRun.cancelled, 1);

  // Second run immediately after
  const secondRun = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(secondRun.cancelled, 0);
  assert.equal(secondRun.scanned, 0);
});

test('TC10: UTC normal timestamp (Z suffix)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const nowMs = Date.parse("2026-09-03T10:20:00.000Z");
  const createdAt = "2026-09-03T10:00:00.000Z"; // 20 mins ago in UTC

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (10, 'Customer 10', 300, 'pending', 'online', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs });
  assert.equal(res.cancelled, 1);
});

test('TC11: GMT+7 equivalent ISO timestamp (+07:00 offset)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  // 17:20 Bangkok = 10:20 UTC
  const nowMs = Date.parse("2026-09-03T17:20:00.000+07:00");
  // 17:00 Bangkok = 10:00 UTC (20 mins prior)
  const createdAt = "2026-09-03T17:00:00.000+07:00";

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (11, 'Customer 11', 300, 'pending', 'online', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs });
  assert.equal(res.cancelled, 1);
});

test('TC12: Bangkok midnight boundary (23:55 Bangkok to 00:15 next day)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  // 23:55 Bangkok on Sept 3 = 16:55 UTC Sept 3
  const createdAt = "2026-09-03T16:55:00.000Z";
  // 00:15 Bangkok on Sept 4 = 17:15 UTC Sept 3 (20 mins after created)
  const nowMs = Date.parse("2026-09-03T17:15:00.000Z");

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (12, 'Midnight Customer', 300, 'pending', 'online', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs });
  assert.equal(res.cancelled, 1);
});

test('TC13: NULL payment_status -> NEVER AUTO-CANCEL', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 30 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (13, 'Legacy NULL status', 300, NULL, 'online', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 13");
  assert.equal(b.payment_status, null);
});

test('TC14: pending POS/walk-in -> NEVER AUTO-CANCEL', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 40 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (14, 'Walk-in Customer', 300, 'pending', 'pos', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 14");
  assert.equal(b.payment_status, 'pending');
});

test('TC15: pending with slip_image_url -> NEVER AUTO-CANCEL', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 25 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, slip_image_url, created_at)
    VALUES (15, 'Pending with Slip', 300, 'pending', 'online', 'https://r2/slip15.jpg', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 15");
  assert.equal(b.payment_status, 'pending');
});

test('TC16: malformed created_at -> NEVER AUTO-CANCEL (skipped safely)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (16, 'Corrupt Timestamp', 300, 'pending', 'online', 'not-a-valid-date-string')
  `);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);
  assert.equal(res.skipped, 1);

  const b = await query.get("SELECT * FROM bookings WHERE id = 16");
  assert.equal(b.payment_status, 'pending'); // Preserved, not destroyed
});

test('TC17: future created_at -> NEVER AUTO-CANCEL', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const futureCreatedAt = new Date(baseTime + 5 * 60 * 1000).toISOString(); // 5 mins in future

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (17, 'Future Booking', 300, 'pending', 'online', ?)
  `, [futureCreatedAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 0);

  const b = await query.get("SELECT * FROM bookings WHERE id = 17");
  assert.equal(b.payment_status, 'pending');
});

test('TC18: exact deadline boundary (nowMs === deadlineMs) -> AUTO-CANCEL', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 15 * 60 * 1000).toISOString(); // exactly 15 mins ago

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (18, 'Exact Boundary Customer', 300, 'pending', 'online', ?)
  `, [createdAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 1);

  const b = await query.get("SELECT * FROM bookings WHERE id = 18");
  assert.equal(b.payment_status, 'cancelled');
});

test('TC19: settings table unavailable -> safe fallback 15 minutes', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  // Do NOT insert payment_window_minutes into settings

  const baseTime = 1756890000000;
  const createdAtExpired = new Date(baseTime - 16 * 60 * 1000).toISOString(); // 16 mins ago
  const createdAtActive = new Date(baseTime - 14 * 60 * 1000).toISOString(); // 14 mins ago

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (191, 'Expired Fallback', 300, 'pending', 'online', ?),
           (192, 'Active Fallback', 300, 'pending', 'online', ?)
  `, [createdAtExpired, createdAtActive]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 1);

  const b191 = await query.get("SELECT * FROM bookings WHERE id = 191");
  assert.equal(b191.payment_status, 'cancelled');

  const b192 = await query.get("SELECT * FROM bookings WHERE id = 192");
  assert.equal(b192.payment_status, 'pending');
});

test('TC20: secondary booking_items update failure does not revert cancelled booking', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const createdAt = new Date(baseTime - 20 * 60 * 1000).toISOString();

  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at)
    VALUES (20, 'Customer 20', 300, 'pending', 'online', ?)
  `, [createdAt]);

  // Make booking_items throw error on update
  const originalPrepare = env.DB.prepare;
  env.DB.prepare = function (sql) {
    if (sql.includes('UPDATE booking_items')) {
      return {
        bind() {
          return {
            run: async () => {
              throw new Error('Synthetic booking_items constraint error');
            }
          };
        }
      };
    }
    return originalPrepare.call(env.DB, sql);
  };

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 1);

  const b = await query.get("SELECT * FROM bookings WHERE id = 20");
  assert.equal(b.payment_status, 'cancelled'); // Booking cancellation stands (authoritative)
});
