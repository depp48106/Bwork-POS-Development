const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync: Database } = require('node:sqlite');

/**
 * High-fidelity D1 Mock backed by node:sqlite DatabaseSync for Cloudflare Worker runtime testing.
 */
function createD1Mock(db) {
  return {
    prepare(query) {
      return {
        bind(...params) {
          return {
            async first(col) {
              const stmt = db.prepare(query);
              const row = stmt.get(...params);
              if (!row) return null;
              if (col) return row[col];
              return row;
            },
            async all() {
              const stmt = db.prepare(query);
              const results = stmt.all(...params);
              return { results, success: true };
            },
            async run() {
              const stmt = db.prepare(query);
              const info = stmt.run(...params);
              return {
                success: true,
                meta: {
                  changes: info.changes,
                  last_row_id: Number(info.lastInsertRowid)
                }
              };
            }
          };
        },
        async first(col) {
          const stmt = db.prepare(query);
          const row = stmt.get();
          if (!row) return null;
          if (col) return row[col];
          return row;
        },
        async all() {
          const stmt = db.prepare(query);
          const results = stmt.all();
          return { results, success: true };
        },
        async run() {
          const stmt = db.prepare(query);
          const info = stmt.run();
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid)
            }
          };
        }
      };
    }
  };
}

function setupTestDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      capacity INTEGER,
      image_url TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY,
      receipt_number TEXT,
      booking_source TEXT DEFAULT 'online',
      payment_status TEXT DEFAULT 'pending',
      checkin_status TEXT DEFAULT 'pending',
      cancellation_reason TEXT,
      total_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      contact TEXT,
      customer_name TEXT,
      line_user_id TEXT,
      line_user_id_verified INTEGER DEFAULT 0,
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
      ('guidelines_enforcement_cutover_at', '2026-11-09T00:00:00.000Z'),
      ('line_guidelines_dispatch_enabled', 'true'),
      ('payment_window_minutes', '15'),
      ('line_channel_access_token', 'mock_token');
  `);
}

let workerModule = null;
async function getWorker() {
  const devDir = path.resolve(__dirname, '..');
  const workerPath = path.join(devDir, 'worker.js');
  const tempMjs = path.join(devDir, `worker.temp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.mjs`);
  fs.copyFileSync(workerPath, tempMjs);
  try {
    const fileUrl = 'file:///' + tempMjs.replace(/\\/g, '/');
    workerModule = await import(fileUrl);
  } finally {
    try { fs.unlinkSync(tempMjs); } catch (_) {}
  }
  return workerModule;
}

test('WORKER-01: Book 201 then 302 in same tab -> acknowledge both, LINE dispatched once via atomic claim', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  const bgTasks = [];
  const ctx = {
    waitUntil: (p) => { bgTasks.push(p); }
  };

  // 1. Create booking 1 (Room 301) with server-confirmed LINE ID
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (1, 'BK-000001', 'U1234567890', 1, '0812345678', 'tok_1')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (1, 4)`);

  // Acknowledge booking 1
  const req1 = new Request('http://localhost/api/public/bookings/1/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_1' },
    body: JSON.stringify({
      rule_set: 'meeting_room_201_306',
      rule_version: 'v1',
      contact: '0812345678'
    })
  });
  const res1 = await worker.default.fetch(req1, env, ctx);
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.acknowledged, true);
  assert.equal(body1.rule_set, 'meeting_room_201_306');
  assert.equal(body1.rule_version, 'v1');
  // Decoupled response returns pending immediately
  assert.equal(body1.line_notification?.status, 'pending');
  assert.equal(body1.line_notification?.deduplicated, false);

  // Wait for background waitUntil task to complete
  await Promise.all(bgTasks);

  // Verify DB dispatch row transitioned to 'sent'
  const row1 = db.prepare(`SELECT status FROM line_guidelines_dispatches WHERE line_user_id = 'U1234567890'`).get();
  assert.equal(row1.status, 'sent');

  // 2. Create booking 2 (Room 302) same LINE user
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (2, 'BK-000002', 'U1234567890', 1, '0812345678', 'tok_2')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (2, 5)`);

  // Acknowledge booking 2
  const req2 = new Request('http://localhost/api/public/bookings/2/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_2' },
    body: JSON.stringify({
      rule_set: 'meeting_room_201_306',
      rule_version: 'v1',
      contact: '0812345678'
    })
  });
  const res2 = await worker.default.fetch(req2, env, ctx);
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.acknowledged, true);
  assert.equal(body2.rule_set, 'meeting_room_201_306');
  assert.equal(body2.line_notification?.status, 'already_sent');
  assert.equal(body2.line_notification?.deduplicated, true);

  db.close();
});

test('WORKER-02: Concurrently confirm in two tabs -> atomic claim ensures LINE sent once, non-blocking response', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  const bgTasks = [];
  const ctx = {
    waitUntil: (p) => { bgTasks.push(p); }
  };

  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (10, 'BK-000010', 'UCONCURRENT99', 1, '0812345678', 'tok_c')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (10, 4)`);

  const reqTab1 = new Request('http://localhost/api/public/bookings/10/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_c' },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v1', contact: '0812345678' })
  });
  const reqTab2 = new Request('http://localhost/api/public/bookings/10/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_c' },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v1', contact: '0812345678' })
  });

  const [res1, res2] = await Promise.all([
    worker.default.fetch(reqTab1, env, ctx),
    worker.default.fetch(reqTab2, env, ctx)
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  const body1 = await res1.json();
  const body2 = await res2.json();
  assert.equal(body1.acknowledged, true);
  assert.equal(body2.acknowledged, true);

  const statuses = [body1.line_notification?.status, body2.line_notification?.status];
  assert.ok(statuses.includes('pending') && statuses.includes('already_sent'));

  await Promise.all(bgTasks);

  // DB must only have 1 dispatch record
  const count = db.prepare(`SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UCONCURRENT99'`).get();
  assert.equal(count.c, 1);

  db.close();
});

test('WORKER-03: Unverified floating client LINE ID and disabled feature -> exactly 0 LINE sends', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // Case A: Client supplied floating line_user_id without server confirmation
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (71, 'BK-000071', 'UFLOATING123', 0, '0812345678', 'tok_float')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (71, 4)`);

  const reqA = new Request('http://localhost/api/public/bookings/71/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_float' },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v1', contact: '0812345678' })
  });
  const resA = await worker.default.fetch(reqA, env);
  assert.equal(resA.status, 200);
  const bodyA = await resA.json();
  assert.equal(bodyA.acknowledged, true); // Customer can still proceed!
  assert.equal(bodyA.line_notification?.status, 'skipped_unverified_line');

  // Verify zero rows in dispatches
  const countA = db.prepare(`SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UFLOATING123'`).get();
  assert.equal(countA.c, 0);

  // Case B: Feature disabled in settings
  db.exec(`UPDATE settings SET value = 'false' WHERE key = 'line_guidelines_dispatch_enabled'`);
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (72, 'BK-000072', 'UVERIFIED999', 1, '0812345678', 'tok_disabled')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (72, 4)`);

  const reqB = new Request('http://localhost/api/public/bookings/72/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_disabled' },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v1', contact: '0812345678' })
  });
  const resB = await worker.default.fetch(reqB, env);
  assert.equal(resB.status, 200);
  const bodyB = await resB.json();
  assert.equal(bodyB.acknowledged, true);
  assert.equal(bodyB.line_notification?.status, 'skipped_feature_disabled');

  const countB = db.prepare(`SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UVERIFIED999'`).get();
  assert.equal(countB.c, 0);

  db.close();
});

test('WORKER-04: Strict validation: Missing, incomplete, or mismatched rule_set/rule_version rejected with HTTP 400', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token'
  };

  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (80, 'BK-000080', 'UTEST', 1, '0812345678', 'tok_strict')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (80, 4)`); // Room 301

  // 1. Missing rule_set
  const r1 = await worker.default.fetch(new Request('http://localhost/api/public/bookings/80/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_strict' },
    body: JSON.stringify({ rule_version: 'v1' })
  }), env);
  assert.equal(r1.status, 400);

  // 2. Missing rule_version
  const r2 = await worker.default.fetch(new Request('http://localhost/api/public/bookings/80/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_strict' },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306' })
  }), env);
  assert.equal(r2.status, 400);

  // 3. Mismatched rule_set (sent jupiter for room 301)
  const r3 = await worker.default.fetch(new Request('http://localhost/api/public/bookings/80/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_strict' },
    body: JSON.stringify({ rule_set: 'jupiter_auditorium', rule_version: 'v1' })
  }), env);
  assert.equal(r3.status, 400);

  // 4. Mismatched rule_version (sent v99)
  const r4 = await worker.default.fetch(new Request('http://localhost/api/public/bookings/80/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_strict' },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v99' })
  }), env);
  assert.equal(r4.status, 400);

  db.close();
});

test('WORKER-05: Book Jupiter Auditorium first time -> see Jupiter flyer, send Jupiter LINE separately', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  const bgTasks = [];
  const ctx = {
    waitUntil: (p) => { bgTasks.push(p); }
  };

  // User already received meeting room rules earlier
  db.exec(`INSERT INTO line_guidelines_dispatches (line_user_id, rule_set, rule_version, status) VALUES ('UJUPITER0001', 'meeting_room_201_306', 'v1', 'sent')`);

  // Now books Jupiter
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (20, 'BK-000020', 'UJUPITER0001', 1, '0812345678', 'tok_j')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (20, 10)`);

  const req = new Request('http://localhost/api/public/bookings/20/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_j' },
    body: JSON.stringify({ rule_set: 'jupiter_auditorium', rule_version: 'v1', contact: '0812345678' })
  });
  const res = await worker.default.fetch(req, env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.acknowledged, true);
  assert.equal(body.rule_set, 'jupiter_auditorium');
  assert.equal(body.line_notification?.status, 'pending');

  await Promise.all(bgTasks);

  // Both dispatches now exist in DB
  const dispatches = db.prepare(`SELECT rule_set, status FROM line_guidelines_dispatches WHERE line_user_id = 'UJUPITER0001' ORDER BY id ASC`).all();
  assert.deepEqual(dispatches.map(d => d.rule_set), ['meeting_room_201_306', 'jupiter_auditorium']);
  assert.deepEqual(dispatches.map(d => d.status), ['sent', 'sent']);

  db.close();
});

test('WORKER-06: Refresh after acknowledgement -> see QR continuously; new booking starts locked', async () => {
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

test('WORKER-07: Old unpaid bookings and Co-working room can upload slip normally without blocking', async () => {
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

test('WORKER-08: New post-cutover meeting room booking not yet acknowledged (when enforcement enabled) -> rejected on slip upload', async () => {
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

test('WORKER-09: Forged LINE ID token -> rejected as unverified LINE binding, 0 LINE push calls, booking acknowledged & payment unblocked', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // Enable guidelines LINE toggle
  db.exec(`UPDATE settings SET value = 'true' WHERE key = 'line_guidelines_dispatch_enabled'`);

  // Booking with unverified LINE account
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (91, 'BK-000091', 'UTARGET_USER_91', 0, '0812345678', 'tok_91')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (91, 4)`);

  // Client passes a forged / fake ID token
  const forgedToken = 'eyJhbGciOiJub25lIn0.eyJpc3MiOiJodHRwczovL2FjY2Vzcy5saW5lLm1lIiwic3ViIjoiVVRBUkdFVF9VU0VSXzkxIn0.';

  const req = new Request('http://localhost/api/public/bookings/91/acknowledge-rules', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Booking-Token': 'tok_91',
      'X-Line-ID-Token': forgedToken
    },
    body: JSON.stringify({
      rule_set: 'meeting_room_201_306',
      rule_version: 'v1',
      contact: '0812345678'
    })
  });

  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json();

  // Non-blocking: Customer successfully acknowledges rules and unlocks payment
  assert.equal(body.success, true);
  assert.equal(body.acknowledged, true);
  assert.equal(body.line_notification?.status, 'skipped_unverified_line');

  // Push was NOT dispatched (0 records in line_guidelines_dispatches)
  const count = db.prepare(`SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UTARGET_USER_91'`).get();
  assert.equal(count.c, 0);

  db.close();
});

test('WORKER-10: LINE dispatch disabled by default in settings -> 0 LINE push calls even with verified LINE account, booking acknowledged', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // Explicitly ensure default-off (false)
  db.exec(`UPDATE settings SET value = 'false' WHERE key = 'line_guidelines_dispatch_enabled'`);

  // Booking with server-verified LINE account
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (92, 'BK-000092', 'UVERIFIED_USER_92', 1, '0812345678', 'tok_92')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (92, 4)`);

  const req = new Request('http://localhost/api/public/bookings/92/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_92' },
    body: JSON.stringify({
      rule_set: 'meeting_room_201_306',
      rule_version: 'v1',
      contact: '0812345678'
    })
  });

  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.success, true);
  assert.equal(body.acknowledged, true);
  assert.equal(body.line_notification?.status, 'skipped_feature_disabled');

  // 0 push calls
  const count = db.prepare(`SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UVERIFIED_USER_92'`).get();
  assert.equal(count.c, 0);

  db.close();
});

test('WORKER-11: Verified account + dispatch toggle enabled -> exactly 1 push call; repeated acknowledge -> 0 extra push calls (deduplicated)', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const bgTasks = [];
  const ctx = { waitUntil: (p) => { bgTasks.push(p); } };

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // Turn ON toggle
  db.exec(`UPDATE settings SET value = 'true' WHERE key = 'line_guidelines_dispatch_enabled'`);

  // Booking with server-verified LINE account
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (93, 'BK-000093', 'UVERIFIED_DEDUP_93', 1, '0812345678', 'tok_93')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (93, 4)`);

  // 1st acknowledge
  const req1 = new Request('http://localhost/api/public/bookings/93/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_93' },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v1', contact: '0812345678' })
  });
  const res1 = await worker.default.fetch(req1, env, ctx);
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.line_notification?.status, 'pending');
  assert.equal(body1.line_notification?.deduplicated, false);

  await Promise.all(bgTasks);

  // Exactly 1 dispatch record in DB
  const dispatches1 = db.prepare(`SELECT count(*) as c, status FROM line_guidelines_dispatches WHERE line_user_id = 'UVERIFIED_DEDUP_93'`).get();
  assert.equal(dispatches1.c, 1);
  assert.equal(dispatches1.status, 'sent');

  // 2nd acknowledge (repeat / duplicate submit)
  const req2 = new Request('http://localhost/api/public/bookings/93/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_93' },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v1', contact: '0812345678' })
  });
  const res2 = await worker.default.fetch(req2, env, ctx);
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.line_notification?.status, 'already_sent');
  assert.equal(body2.line_notification?.deduplicated, true);

  // Still exactly 1 dispatch record in DB (0 extra push calls)
  const dispatches2 = db.prepare(`SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UVERIFIED_DEDUP_93'`).get();
  assert.equal(dispatches2.c, 1);

  db.close();
});

test('WORKER-12: booking_source=walkin / pos without server verification -> rejected as unverified LINE binding, 0 LINE push calls', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  db.exec(`UPDATE settings SET value = 'true' WHERE key = 'line_guidelines_dispatch_enabled'`);

  // booking_source='walkin' but line_user_id_verified=0
  db.exec(`INSERT INTO bookings (id, receipt_number, booking_source, line_user_id, line_user_id_verified, contact, qr_token) VALUES (94, 'BK-000094', 'walkin', 'UWALKIN_UNVERIFIED_94', 0, '0812345678', 'tok_94')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (94, 4)`);

  const req = new Request('http://localhost/api/public/bookings/94/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_94' },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v1', contact: '0812345678' })
  });

  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json();

  // booking_source is forbidden as verification proof: must be skipped_unverified_line
  assert.equal(body.success, true);
  assert.equal(body.acknowledged, true);
  assert.equal(body.line_notification?.status, 'skipped_unverified_line');

  // 0 push calls
  const count = db.prepare(`SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UWALKIN_UNVERIFIED_94'`).get();
  assert.equal(count.c, 0);

  db.close();
});

test('WORKER-13: LINE Verify ID Token API mocked -> verified token matching booking.line_user_id dispatches LINE push', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const bgTasks = [];
  const ctx = { waitUntil: (p) => { bgTasks.push(p); } };

  // Mock verify API via env.verifyLineIdToken
  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true',
    verifyLineIdToken: async (tokenString, audience) => {
      if (tokenString === 'valid.token.for.target') {
        return { userId: 'UVERIFIED_API_TARGET_95', name: 'API Verified Customer' };
      }
      if (tokenString === 'valid.token.for.other') {
        return { userId: 'UOTHER_USER_DIFFERENT', name: 'Other User' };
      }
      return null;
    }
  };

  db.exec(`UPDATE settings SET value = 'true' WHERE key = 'line_guidelines_dispatch_enabled'`);

  // Case A: Token verified for DIFFERENT user -> rejected, 0 push
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (95, 'BK-000095', 'UVERIFIED_API_TARGET_95', 0, '0812345678', 'tok_95')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (95, 4)`);

  const reqA = new Request('http://localhost/api/public/bookings/95/acknowledge-rules', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Booking-Token': 'tok_95',
      'X-Line-ID-Token': 'valid.token.for.other'
    },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v1', contact: '0812345678' })
  });
  const resA = await worker.default.fetch(reqA, env, ctx);
  assert.equal(resA.status, 200);
  const bodyA = await resA.json();
  assert.equal(bodyA.acknowledged, true);
  assert.equal(bodyA.line_notification?.status, 'skipped_unverified_line');

  // Case B: Token verified for MATCHING user -> approved, 1 push!
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token) VALUES (96, 'BK-000096', 'UVERIFIED_API_TARGET_95', 0, '0812345678', 'tok_96')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (96, 4)`);

  const reqB = new Request('http://localhost/api/public/bookings/96/acknowledge-rules', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Booking-Token': 'tok_96',
      'X-Line-ID-Token': 'valid.token.for.target'
    },
    body: JSON.stringify({ rule_set: 'meeting_room_201_306', rule_version: 'v1', contact: '0812345678' })
  });
  const resB = await worker.default.fetch(reqB, env, ctx);
  assert.equal(resB.status, 200);
  const bodyB = await resB.json();
  assert.equal(bodyB.acknowledged, true);
  assert.equal(bodyB.line_notification?.status, 'pending');

  await Promise.all(bgTasks);

  // Exactly 1 dispatch recorded in DB
  const count = db.prepare(`SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UVERIFIED_API_TARGET_95'`).get();
  assert.equal(count.c, 1);

  db.close();
});
