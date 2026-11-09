/**
 * backend/tests/workerRoomGuidelinesGate.test.cjs
 *
 * Automated verification of room guidelines acknowledgement gate on Cloudflare Worker (backend/worker.js).
 * Uses better-sqlite3 as an in-memory D1 mock and tests fetch() handlers against Worker routes:
 * 1. Book Room 201 then Room 302 in same tab -> acknowledge both, LINE dispatched once.
 * 2. Concurrently confirm in two tabs -> atomic claim ensures LINE sent once.
 * 3. Book Jupiter Auditorium first time -> see Jupiter flyer, send Jupiter LINE separately.
 * 4. Refresh after acknowledgement -> see QR continuously; new booking starts locked.
 * 5. Old unpaid bookings and Co-working room can upload slip normally without blocking.
 * 6. New booking not yet acknowledged (when enforcement enabled) -> rejected on slip upload.
 * 7. LINE slow or fails -> customer still sees QR after acknowledgement.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const devDir = path.resolve(__dirname, '../..');
const workerPath = path.join(devDir, 'backend/worker.js');

function createD1Mock(db) {
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) {
          this._params = args;
          return this;
        },
        async first() {
          try {
            const stmt = db.prepare(this._sql);
            return stmt.get(...this._params) || null;
          } catch (e) {
            return null;
          }
        },
        async all() {
          try {
            const stmt = db.prepare(this._sql);
            const results = stmt.all(...this._params);
            return { results: results || [] };
          } catch (e) {
            return { results: [] };
          }
        },
        async run() {
          try {
            const stmt = db.prepare(this._sql);
            const info = stmt.run(...this._params);
            return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
          } catch (e) {
            return { success: false, error: e.message };
          }
        }
      };
    }
  };
}

function setupTestDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      capacity INTEGER,
      image_url TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_code TEXT,
      receipt_number TEXT,
      payment_status TEXT DEFAULT 'pending',
      checkin_status TEXT DEFAULT 'pending',
      cancellation_reason TEXT,
      total_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      contact TEXT,
      customer_name TEXT,
      line_user_id TEXT,
      qr_token TEXT,
      slip_image_url TEXT,
      slip_trans_ref TEXT,
      slip_verified_at DATETIME,
      slip_verify_status TEXT,
      guidelines_acknowledged_at DATETIME,
      guidelines_rule_set TEXT,
      guidelines_rule_version TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      room_id INTEGER REFERENCES rooms(id),
      start_time TEXT,
      end_time TEXT,
      checkin_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS room_guidelines_acknowledgements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      room_id INTEGER REFERENCES rooms(id),
      rule_set TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      customer_contact TEXT,
      line_user_id TEXT,
      acknowledged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(booking_id, rule_set, rule_version)
    );

    CREATE TABLE IF NOT EXISTS line_guidelines_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_user_id TEXT NOT NULL,
      rule_set TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      first_booking_id INTEGER REFERENCES bookings(id),
      status TEXT NOT NULL DEFAULT 'sent',
      error_message TEXT,
      dispatched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(line_user_id, rule_set, rule_version)
    );

    CREATE TABLE IF NOT EXISTS slip_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      trans_ref TEXT,
      verification_status TEXT,
      rejection_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO rooms (id, name, capacity) VALUES
      (4, 'ห้องประชุม 301 (Mars)', 8),
      (5, 'ห้องประชุม 302 (Mercury)', 8),
      (10, 'Jupiter Auditorium (300)', 50),
      (13, 'Co-working zone (Desk 1)', 1);

    INSERT OR REPLACE INTO settings (key, value) VALUES
      ('guidelines_enforcement_enabled', 'false'),
      ('payment_window_minutes', '15'),
      ('line_channel_access_token', 'mock_token');
  `);
}

// Dynamically load Worker module
let workerModule = null;
async function getWorker() {
  if (workerModule) return workerModule;
  const tempMjs = path.join(devDir, 'backend/worker.temp.mjs');
  fs.copyFileSync(workerPath, tempMjs);
  try {
    const fileUrl = 'file:///' + tempMjs.replace(/\\/g, '/');
    workerModule = await import(fileUrl);
  } finally {
    try { fs.unlinkSync(tempMjs); } catch (_) {}
  }
  return workerModule;
}

test('WORKER-01: Book 201 then 302 in same tab -> acknowledge both, LINE dispatched once', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // 1. Create booking 1 (Room 301)
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, contact, qr_token) VALUES (1, 'BK-000001', 'U1234567890', '0812345678', 'tok_1')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (1, 4)`);

  // Acknowledge booking 1
  const req1 = new Request('http://localhost/api/public/bookings/1/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_1' },
    body: JSON.stringify({ contact: '0812345678' })
  });
  const res1 = await worker.default.fetch(req1, env);
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.acknowledged, true);
  assert.equal(body1.rule_set, 'meeting_room_201_306');
  assert.equal(body1.line_notification?.status, 'sent');

  // 2. Create booking 2 (Room 302) same LINE user
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, contact, qr_token) VALUES (2, 'BK-000002', 'U1234567890', '0812345678', 'tok_2')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (2, 5)`);

  // Acknowledge booking 2
  const req2 = new Request('http://localhost/api/public/bookings/2/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_2' },
    body: JSON.stringify({ contact: '0812345678' })
  });
  const res2 = await worker.default.fetch(req2, env);
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.acknowledged, true);
  assert.equal(body2.rule_set, 'meeting_room_201_306');
  assert.equal(body2.line_notification?.status, 'already_sent');
  assert.equal(body2.line_notification?.deduplicated, true);

  db.close();
});

test('WORKER-02: Concurrently confirm in two tabs -> atomic claim ensures LINE sent once', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, contact, qr_token) VALUES (10, 'BK-000010', 'UCONCURRENT99', '0812345678', 'tok_c')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (10, 4)`);

  const reqTab1 = new Request('http://localhost/api/public/bookings/10/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_c' },
    body: JSON.stringify({ contact: '0812345678' })
  });
  const reqTab2 = new Request('http://localhost/api/public/bookings/10/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_c' },
    body: JSON.stringify({ contact: '0812345678' })
  });

  const [res1, res2] = await Promise.all([
    worker.default.fetch(reqTab1, env),
    worker.default.fetch(reqTab2, env)
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  const body1 = await res1.json();
  const body2 = await res2.json();
  assert.equal(body1.acknowledged, true);
  assert.equal(body2.acknowledged, true);

  const statuses = [body1.line_notification?.status, body2.line_notification?.status];
  assert.ok(statuses.includes('sent') || statuses.includes('already_sent'));

  // DB must only have 1 dispatch record
  const count = db.prepare(`SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UCONCURRENT99'`).get();
  assert.equal(count.c, 1);

  db.close();
});

test('WORKER-03: Book Jupiter Auditorium first time -> see Jupiter flyer, send Jupiter LINE separately', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // User already received meeting room rules earlier
  db.exec(`INSERT INTO line_guidelines_dispatches (line_user_id, rule_set, rule_version, status) VALUES ('UJUPITER0001', 'meeting_room_201_306', 'v1', 'sent')`);

  // Now books Jupiter
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, contact, qr_token) VALUES (20, 'BK-000020', 'UJUPITER0001', '0812345678', 'tok_j')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (20, 10)`);

  const req = new Request('http://localhost/api/public/bookings/20/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_j' },
    body: JSON.stringify({ contact: '0812345678' })
  });
  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.acknowledged, true);
  assert.equal(body.rule_set, 'jupiter_auditorium');
  assert.equal(body.line_notification?.status, 'sent');

  // Both dispatches now exist
  const dispatches = db.prepare(`SELECT rule_set FROM line_guidelines_dispatches WHERE line_user_id = 'UJUPITER0001' ORDER BY id ASC`).all();
  assert.deepEqual(dispatches.map(d => d.rule_set), ['meeting_room_201_306', 'jupiter_auditorium']);

  db.close();
});

test('WORKER-04: Refresh after acknowledgement -> see QR continuously; new booking starts locked', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // Acknowledged booking 30
  db.exec(`INSERT INTO bookings (id, receipt_number, guidelines_acknowledged_at, contact, qr_token) VALUES (30, 'BK-000030', datetime('now'), '0812345678', 'tok_ack')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (30, 4)`);

  const req1 = new Request('http://localhost/api/public/bookings/30', {
    headers: { 'X-Booking-Token': 'tok_ack' }
  });
  const res1 = await worker.default.fetch(req1, env);
  const body1 = await res1.json();
  assert.equal(body1.guidelines_acknowledged, true);

  // Fresh unacknowledged booking 31
  db.exec(`INSERT INTO bookings (id, receipt_number, contact, qr_token) VALUES (31, 'BK-000031', '0812345678', 'tok_fresh')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (31, 4)`);

  const req2 = new Request('http://localhost/api/public/bookings/31', {
    headers: { 'X-Booking-Token': 'tok_fresh' }
  });
  const res2 = await worker.default.fetch(req2, env);
  const body2 = await res2.json();
  assert.equal(body2.guidelines_acknowledged, false);

  db.close();
});

test('WORKER-05: Old unpaid bookings and Co-working room can upload slip normally without blocking', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // Turn ON enforcement toggle
  db.exec(`UPDATE settings SET value = 'true' WHERE key = 'guidelines_enforcement_enabled'`);

  // Case A: Legacy booking before cutover (deposit status so not expired)
  db.exec(`INSERT INTO bookings (id, receipt_number, created_at, contact, qr_token, payment_status, balance_amount, paid_amount) VALUES (40, 'BK-000040', '2026-11-01 10:00:00', '0812345678', 'tok_legacy', 'deposit', 500, 500)`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (40, 4)`);

  const reqA = new Request('http://localhost/api/public/bookings/40/upload-slip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_legacy' },
    body: JSON.stringify({ slip_image: 'data:image/jpeg;base64,mock' })
  });
  const resA = await worker.default.fetch(reqA, env);
  assert.notEqual(resA.status, 400); // not blocked by guidelines

  // Case B: Co-working Zone (ID 13) unmapped room
  db.exec(`INSERT INTO bookings (id, receipt_number, created_at, contact, qr_token, payment_status, balance_amount, paid_amount) VALUES (41, 'BK-000041', datetime('now'), '0812345678', 'tok_cowork', 'deposit', 500, 500)`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (41, 13)`);

  const reqB = new Request('http://localhost/api/public/bookings/41/upload-slip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_cowork' },
    body: JSON.stringify({ slip_image: 'data:image/jpeg;base64,mock' })
  });
  const resB = await worker.default.fetch(reqB, env);
  assert.notEqual(resB.status, 400); // not blocked by guidelines

  db.close();
});

test('WORKER-06: New booking not yet acknowledged (when enforcement enabled) -> rejected on slip upload', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // Turn ON enforcement
  db.exec(`UPDATE settings SET value = 'true' WHERE key = 'guidelines_enforcement_enabled'`);

  // New post-cutover booking without acknowledgement
  db.exec(`INSERT INTO bookings (id, receipt_number, created_at, contact, qr_token) VALUES (50, 'BK-000050', datetime('now'), '0812345678', 'tok_unack')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (50, 4)`);

  const req = new Request('http://localhost/api/public/bookings/50/upload-slip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_unack' },
    body: JSON.stringify({ slip_image: 'data:image/jpeg;base64,mock' })
  });
  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'GUIDELINES_NOT_ACKNOWLEDGED');

  db.close();
});

test('WORKER-07: LINE slow or fails -> customer still sees QR after acknowledgement', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'invalid_broken_token' // Causes LINE push error
  };

  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, contact, qr_token) VALUES (60, 'BK-000060', 'UFAIL999999', '0812345678', 'tok_fail')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (60, 4)`);

  const req = new Request('http://localhost/api/public/bookings/60/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_fail' },
    body: JSON.stringify({ contact: '0812345678' })
  });
  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.acknowledged, true); // Web flow still succeeds!
  assert.equal(body.line_notification?.status, 'failed');

  // Verify booking record was marked acknowledged
  const b = db.prepare('SELECT guidelines_acknowledged_at FROM bookings WHERE id = 60').get();
  assert.ok(b.guidelines_acknowledged_at);

  db.close();
});
