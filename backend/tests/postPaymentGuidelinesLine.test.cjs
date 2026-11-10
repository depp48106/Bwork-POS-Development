const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync: Database } = require('node:sqlite');

// High-fidelity D1 mock for Worker
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
      description TEXT,
      pin_code TEXT
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number TEXT,
      booking_source TEXT DEFAULT 'online',
      payment_status TEXT DEFAULT 'pending',
      checkin_status TEXT DEFAULT 'pending',
      cancellation_reason TEXT,
      total_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      contact TEXT,
      customer_name TEXT DEFAULT 'Test Customer',
      line_user_id TEXT,
      line_user_id_verified INTEGER DEFAULT 0,
      qr_token TEXT,
      pin_code TEXT,
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
      price REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      pin_code TEXT,
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

    CREATE TABLE IF NOT EXISTS line_notification_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      notification_type TEXT NOT NULL DEFAULT 'booking_confirmation',
      status TEXT NOT NULL DEFAULT 'processing',
      claim_token TEXT NOT NULL,
      retry_key TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      http_status INTEGER,
      error_message TEXT,
      accepted_request_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(booking_id, notification_type)
    );

    CREATE TABLE IF NOT EXISTS booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      performed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS slip_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      trans_ref TEXT,
      verification_status TEXT,
      rejection_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO rooms (id, name, capacity, pin_code) VALUES
      (11, 'ห้องประชุม 201 (Pluto)', 6, '1234'),
      (4, 'ห้องประชุม 301 (Mars)', 8, '5678'),
      (5, 'ห้องประชุม 302 (Earth)', 8, '5679'),
      (10, 'Jupiter Auditorium (300)', 50, '9999'),
      (13, 'Co-working zone (Desk 1)', 1, NULL);

    INSERT OR REPLACE INTO settings (key, value) VALUES
      ('guidelines_enforcement_enabled', 'true'),
      ('guidelines_enforcement_cutover_at', '2026-11-09T00:00:00.000Z'),
      ('line_guidelines_dispatch_enabled', 'true'),
      ('payment_window_minutes', '15'),
      ('line_channel_access_token', 'mock_token');
  `);
}

let workerModule = null;
async function getWorker() {
  if (workerModule) return workerModule;
  const devDir = path.resolve(__dirname, '..');
  const workerPath = path.join(devDir, 'worker.js');
  const tempMjs = path.join(devDir, `worker.postpay.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.mjs`);
  fs.copyFileSync(workerPath, tempMjs);
  try {
    const fileUrl = 'file:///' + tempMjs.replace(/\\/g, '/');
    workerModule = await import(fileUrl);
  } finally {
    try { fs.unlinkSync(tempMjs); } catch (_) {}
  }
  return workerModule;
}

// ---------------------------------------------------------------------------
// TEST 1: /acknowledge-rules saves acknowledgement and calls LINE 0 times
// ---------------------------------------------------------------------------
test('SCENARIO 1: /acknowledge-rules saves acknowledgement and calls LINE 0 times (status: skipped_decoupled_to_confirmation)', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token, total_amount, payment_status)
           VALUES (1, 'BK-000001', 'U_TEST_USER_1', 1, '0812345678', 'tok_1', 800, 'pending')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (1, 11, 800, 800)`);

  const req = new Request('http://localhost/api/public/bookings/1/acknowledge-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Booking-Token': 'tok_1' },
    body: JSON.stringify({
      rule_set: 'meeting_room_201_306',
      rule_version: 'v1',
      contact: '0812345678'
    })
  });

  const res = await worker.default.fetch(req, env, { waitUntil() {} });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.equal(data.acknowledged, true);
  assert.equal(data.rule_set, 'meeting_room_201_306');
  assert.equal(data.line_notification.status, 'skipped_decoupled_to_confirmation');

  // Verify DB: acknowledgement recorded in both tables
  const ackRow = db.prepare('SELECT * FROM room_guidelines_acknowledgements WHERE booking_id = 1').get();
  assert.ok(ackRow);
  assert.equal(ackRow.rule_set, 'meeting_room_201_306');

  const bRow = db.prepare('SELECT guidelines_acknowledged_at, guidelines_rule_set FROM bookings WHERE id = 1').get();
  assert.ok(bRow.guidelines_acknowledged_at);
  assert.equal(bRow.guidelines_rule_set, 'meeting_room_201_306');

  // Crucial: 0 rows in line_guidelines_dispatches prior to payment
  const dispatchRows = db.prepare('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?').all('U_TEST_USER_1');
  assert.equal(dispatchRows.length, 0);

  db.close();
});

// ---------------------------------------------------------------------------
// TEST 2: Only paid in full (payment_status === 'paid') attaches guidelines link
// ---------------------------------------------------------------------------
test('SCENARIO 2: Post-payment confirmation attaches guidelines ONLY when paid in full', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // Case A: Unpaid booking (payment_status: 'pending') -> Skipped, 0 LINE calls, no guidelines
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, qr_token, total_amount, paid_amount, balance_amount, payment_status)
           VALUES (10, 'BK-000010', 'U_TEST_USER_2', 1, '0812345678', 'tok_10', 800, 0, 800, 'pending')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (10, 11, 800, 800)`);

  const pendingResult = await worker.triggerLineBookingConfirmation(env, 10);
  assert.equal(pendingResult.success, false);
  assert.equal(pendingResult.status, 'skipped');
  assert.equal(pendingResult.reason, 'payment_status_not_paid');

  let dispatches = db.prepare('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?').all('U_TEST_USER_2');
  assert.equal(dispatches.length, 0);

  // Case B: Partial deposit (balance remaining) -> Skipped, 0 LINE calls
  db.exec(`UPDATE bookings SET payment_status = 'paid', paid_amount = 400, balance_amount = 400 WHERE id = 10`);
  const partialResult = await worker.triggerLineBookingConfirmation(env, 10);
  assert.equal(partialResult.success, false);
  assert.equal(partialResult.status, 'skipped');
  assert.equal(partialResult.reason, 'balance_remaining');

  dispatches = db.prepare('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?').all('U_TEST_USER_2');
  assert.equal(dispatches.length, 0);

  // Case C: Paid in full (payment_status: 'paid', balance: 0) -> Guidelines attached!
  db.exec(`UPDATE bookings SET paid_amount = 800, balance_amount = 0 WHERE id = 10`);
  const paidResult = await worker.triggerLineBookingConfirmation(env, 10);
  assert.equal(paidResult.success, true);
  assert.equal(paidResult.status, 'sent');

  // Verify line_guidelines_dispatches recorded
  dispatches = db.prepare('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?').all('U_TEST_USER_2');
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].rule_set, 'meeting_room_201_306');
  assert.equal(dispatches[0].status, 'sent');

  // Verify booking history audit trail recorded guidelines_attached: true
  const hist = db.prepare("SELECT details FROM booking_history WHERE booking_id = 10 AND action = 'line_confirmation_notified'").get();
  assert.ok(hist);
  const histData = JSON.parse(hist.details);
  assert.equal(histData.guidelines_attached, true);

  db.close();
});

// ---------------------------------------------------------------------------
// TEST 3: Room 201 & 301-306 use same rule set; Jupiter Auditorium uses distinct set
// ---------------------------------------------------------------------------
test('SCENARIO 3: Room 201 & 301-306 share meeting_room_201_306; Jupiter uses jupiter_auditorium', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  const lineUser = 'U_MULTI_ROOM_USER';

  // 1. Book Room 201 (meeting_room_201_306) and pay in full
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, total_amount, paid_amount, balance_amount, payment_status)
           VALUES (20, 'BK-000020', '${lineUser}', 1, '0812345678', 800, 800, 0, 'paid')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (20, 11)`); // Room 201 (id 11)

  const res201 = await worker.triggerLineBookingConfirmation(env, 20);
  assert.equal(res201.success, true);

  const hist201 = db.prepare("SELECT details FROM booking_history WHERE booking_id = 20 AND action = 'line_confirmation_notified'").get();
  assert.equal(JSON.parse(hist201.details).guidelines_attached, true);

  // 2. Same user books Room 301 (also meeting_room_201_306) -> duplicate suppressed!
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, total_amount, paid_amount, balance_amount, payment_status)
           VALUES (21, 'BK-000021', '${lineUser}', 1, '0812345678', 1200, 1200, 0, 'paid')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (21, 4)`); // Room 301

  const res301 = await worker.triggerLineBookingConfirmation(env, 21);
  assert.equal(res301.success, true);

  const hist301 = db.prepare("SELECT details FROM booking_history WHERE booking_id = 21 AND action = 'line_confirmation_notified'").get();
  // Suppressed because user already received meeting_room_201_306
  assert.equal(JSON.parse(hist301.details).guidelines_attached, false);

  // 3. Same user books Jupiter Auditorium (jupiter_auditorium) -> separate set, guidelines ATTACHED!
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, total_amount, paid_amount, balance_amount, payment_status)
           VALUES (22, 'BK-000022', '${lineUser}', 1, '0812345678', 5000, 5000, 0, 'paid')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (22, 10)`); // Jupiter Auditorium (id 10)

  const resJupiter = await worker.triggerLineBookingConfirmation(env, 22);
  assert.equal(resJupiter.success, true);

  const histJupiter = db.prepare("SELECT details FROM booking_history WHERE booking_id = 22 AND action = 'line_confirmation_notified'").get();
  assert.equal(JSON.parse(histJupiter.details).guidelines_attached, true);

  // Verify dispatches table has exactly 2 rows for this user (one meeting_room_201_306, one jupiter_auditorium)
  const userDispatches = db.prepare('SELECT rule_set, status FROM line_guidelines_dispatches WHERE line_user_id = ? ORDER BY id').all(lineUser);
  assert.equal(userDispatches.length, 2);
  assert.equal(userDispatches[0].rule_set, 'meeting_room_201_306');
  assert.equal(userDispatches[1].rule_set, 'jupiter_auditorium');

  db.close();
});

// ---------------------------------------------------------------------------
// TEST 4: Unverified LINE account or disabled toggle must NOT attach guidelines link
// ---------------------------------------------------------------------------
test('SCENARIO 4: Unverified LINE account or disabled toggle suppresses guidelines attachment', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  // Case A: Unverified LINE user (line_user_id_verified: 0)
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, total_amount, paid_amount, balance_amount, payment_status)
           VALUES (30, 'BK-000030', 'U_UNVERIFIED_USER', 0, '0812345678', 800, 800, 0, 'paid')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (30, 11)`);

  const resUnverified = await worker.triggerLineBookingConfirmation(env, 30);
  assert.equal(resUnverified.success, true);

  const histUnverified = db.prepare("SELECT details FROM booking_history WHERE booking_id = 30 AND action = 'line_confirmation_notified'").get();
  assert.equal(JSON.parse(histUnverified.details).guidelines_attached, false);

  const unverifiedDispatches = db.prepare('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?').all('U_UNVERIFIED_USER');
  assert.equal(unverifiedDispatches.length, 0);

  // Case B: Verified user, but toggle disabled (line_guidelines_dispatch_enabled = 'false')
  db.exec(`UPDATE settings SET value = 'false' WHERE key = 'line_guidelines_dispatch_enabled'`);

  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, total_amount, paid_amount, balance_amount, payment_status)
           VALUES (31, 'BK-000031', 'U_VERIFIED_USER_TOGGLE_OFF', 1, '0812345678', 800, 800, 0, 'paid')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (31, 11)`);

  const resToggleOff = await worker.triggerLineBookingConfirmation(env, 31);
  assert.equal(resToggleOff.success, true);

  const histToggleOff = db.prepare("SELECT details FROM booking_history WHERE booking_id = 31 AND action = 'line_confirmation_notified'").get();
  assert.equal(JSON.parse(histToggleOff.details).guidelines_attached, false);

  const toggleOffDispatches = db.prepare('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?').all('U_VERIFIED_USER_TOGGLE_OFF');
  assert.equal(toggleOffDispatches.length, 0);

  db.close();
});

// ---------------------------------------------------------------------------
// TEST 5: Atomic claim deduplication across concurrent executions
// ---------------------------------------------------------------------------
test('SCENARIO 5: Atomic claim prevents duplicate guidelines attachment on concurrent confirmations', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const env = {
    DB: createD1Mock(db),
    LINE_CHANNEL_ACCESS_TOKEN: 'mock_token',
    STAGING_MOCK_LINE_API: 'true'
  };

  const lineUser = 'U_CONCURRENT_USER';

  // Two different bookings for same LINE user, paid simultaneously
  db.exec(`INSERT INTO bookings (id, receipt_number, line_user_id, line_user_id_verified, contact, total_amount, paid_amount, balance_amount, payment_status)
           VALUES (40, 'BK-000040', '${lineUser}', 1, '0812345678', 800, 800, 0, 'paid'),
                  (41, 'BK-000041', '${lineUser}', 1, '0812345678', 800, 800, 0, 'paid')`);
  db.exec(`INSERT INTO booking_items (booking_id, room_id) VALUES (40, 11), (41, 4)`);

  // Run confirmations concurrently
  const [res1, res2] = await Promise.all([
    worker.triggerLineBookingConfirmation(env, 40),
    worker.triggerLineBookingConfirmation(env, 41)
  ]);

  assert.equal(res1.success, true);
  assert.equal(res2.success, true);

  // Read history details for both bookings
  const hist1 = db.prepare("SELECT details FROM booking_history WHERE booking_id = 40 AND action = 'line_confirmation_notified'").get();
  const hist2 = db.prepare("SELECT details FROM booking_history WHERE booking_id = 41 AND action = 'line_confirmation_notified'").get();

  const attached1 = JSON.parse(hist1.details).guidelines_attached;
  const attached2 = JSON.parse(hist2.details).guidelines_attached;

  // Exactly ONE of them must have attached the flyer, the other must be false
  assert.equal(Number(attached1) + Number(attached2), 1, 'Exactly one concurrent confirmation attached guidelines');

  // Database must have exactly 1 dispatch record for this rule_set
  const dispatches = db.prepare('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?').all(lineUser);
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].status, 'sent');

  db.close();
});

// ---------------------------------------------------------------------------
// TEST 6: Express Server (server.js) sendLineNotification post-payment verification
// ---------------------------------------------------------------------------
test('SCENARIO 6: Express Server (server.js) sendLineNotification verifies all 5 policy rules', async () => {
  const tempDbPath = path.resolve(__dirname, 'temp_postpay_server.sqlite');
  if (fs.existsSync(tempDbPath)) {
    try { fs.unlinkSync(tempDbPath); } catch (_) {}
  }

  process.env.DB_PATH = tempDbPath;
  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'test';
  process.env.STAGING_MOCK_LINE_API = 'true';

  const { initDatabase, dbQuery } = require('../database.js');
  await initDatabase();

  const { sendLineNotification } = require('../server.js');

  try {
    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('line_guidelines_dispatch_enabled', 'true')");
    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('line_channel_access_token', 'mock_token')");

    // Retrieve a seeded meeting room (e.g. Room 301)
    const roomRow = await dbQuery.get("SELECT id, name FROM rooms WHERE name LIKE '%301%' LIMIT 1");
    const targetRoomId = roomRow ? roomRow.id : 4;

    // Case 1: Unpaid booking -> skipped
    const b1 = await dbQuery.run(`
      INSERT INTO bookings (customer_name, receipt_number, line_user_id, line_user_id_verified, contact, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('Test Customer 1', 'BK-S001', 'U_SRV_POSTPAY_1', 1, '0812345678', 800, 0, 800, 'pending')
    `);
    const b1Id = b1.id || b1.lastID;
    await dbQuery.run(`INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, ?, 800, 800)`, [b1Id, targetRoomId]);

    const resUnpaid = await sendLineNotification(b1Id);
    assert.equal(resUnpaid.success, false);
    assert.equal(resUnpaid.status, 'skipped');
    assert.equal(resUnpaid.reason, 'payment_status_not_paid');

    // Case 2: Full payment -> attaches guidelines flyer
    await dbQuery.run(`UPDATE bookings SET payment_status = 'paid', paid_amount = 800, balance_amount = 0 WHERE id = ?`, [b1Id]);
    const resPaid = await sendLineNotification(b1Id);
    assert.equal(resPaid.success, true);
    assert.equal(resPaid.guidelinesAttached, true);
    assert.equal(resPaid.guidelinesUrl, 'https://bwork-booking.pages.dev/rules/room301-306.png');

    const dispatches = await dbQuery.all('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?', ['U_SRV_POSTPAY_1']);
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].rule_set, 'meeting_room_201_306');

    // Case 3: Repeat booking for same user in same group (Room 301) -> duplicate suppressed
    const b2 = await dbQuery.run(`
      INSERT INTO bookings (customer_name, receipt_number, line_user_id, line_user_id_verified, contact, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('Test Customer 2', 'BK-S002', 'U_SRV_POSTPAY_1', 1, '0812345678', 1200, 1200, 0, 'paid')
    `);
    const b2Id = b2.id || b2.lastID;
    await dbQuery.run(`INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, ?, 1200, 1200)`, [b2Id, targetRoomId]);

    const resRepeat = await sendLineNotification(b2Id);
    assert.equal(resRepeat.success, true);
    assert.equal(resRepeat.guidelinesAttached, false); // Suppressed!

    // Case 4: Unverified user -> guidelines flyer NOT attached
    const b3 = await dbQuery.run(`
      INSERT INTO bookings (customer_name, receipt_number, line_user_id, line_user_id_verified, contact, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('Test Customer 3', 'BK-S003', 'U_SRV_UNVERIFIED', 0, '0812345678', 800, 800, 0, 'paid')
    `);
    const b3Id = b3.id || b3.lastID;
    await dbQuery.run(`INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, ?, 800, 800)`, [b3Id, targetRoomId]);

    const resUnver = await sendLineNotification(b3Id);
    assert.equal(resUnver.success, true);
    assert.equal(resUnver.guidelinesAttached, false);
  } finally {
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch (_) {}
    }
  }
});
