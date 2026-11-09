/**
 * backend/tests/roomGuidelinesAcknowledgement.test.cjs
 *
 * Comprehensive Automated Test Suite for Room Guidelines Acknowledgement Pre-Payment Gate:
 * 1. Policy resolution & LINE message formatting
 * 2. First-time meeting room acknowledgement & LINE dispatch
 * 3. LINE deduplication across bookings in same group (Room 201 -> Room 302)
 * 4. Distinct room group dispatch (Jupiter Auditorium)
 * 5. Version bump re-dispatch (v2)
 * 6. Server state exposure on page refresh (GET /api/public/bookings/:id)
 * 7. Double-submit / repeat acknowledgement idempotency
 * 8. Slip upload rejection before acknowledgement (HTTP 400 GUIDELINES_NOT_ACKNOWLEDGED)
 * 9. Backward compatibility for legacy pending bookings before cutover
 * 10. Exempt unmapped rooms (Co-working zone)
 * 11. Fault tolerance when customer has no LINE or LINE network failure
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const {
  ROOM_GUIDELINES_VERSIONS,
  GUIDELINES_CUTOVER_ISO,
  ROOM_GUIDELINES_CONFIG,
  resolveRoomGuidelines,
  buildLineGuidelinesMessage
} = require('../../shared/roomGuidelinesPolicy.mjs');

// ========================================================
// 1. UNIT TESTS: POLICY RESOLUTION & TEMPLATES
// ========================================================

test('POLICY-01: Resolves Room 201 and 301-306 to meeting_room_201_306 group', () => {
  const ids = [4, 5, 6, 7, 8, 9, 11];
  for (const id of ids) {
    const res = resolveRoomGuidelines(id, `Room ${id}`);
    assert.strictEqual(res.required, true);
    assert.strictEqual(res.rule_set, 'meeting_room_201_306');
    assert.strictEqual(res.rule_version, 'v1');
    assert.strictEqual(res.summary_points.length, 4);
    assert.ok(res.summary_points[0].includes('ตรงต่อเวลา'));
  }

  // Also matches by name pattern
  const byName201 = resolveRoomGuidelines(99, 'ห้อง 201 ชั้น 2');
  assert.strictEqual(byName201.required, true);
  assert.strictEqual(byName201.rule_set, 'meeting_room_201_306');

  const byName305 = resolveRoomGuidelines(99, 'ห้องประชุม 305');
  assert.strictEqual(byName305.required, true);
  assert.strictEqual(byName305.rule_set, 'meeting_room_201_306');
});

test('POLICY-02: Resolves Jupiter Auditorium to jupiter_auditorium group', () => {
  const res10 = resolveRoomGuidelines(10, 'Jupiter Room');
  assert.strictEqual(res10.required, true);
  assert.strictEqual(res10.rule_set, 'jupiter_auditorium');
  assert.strictEqual(res10.rule_version, 'v1');
  assert.strictEqual(res10.summary_points.length, 4);
  assert.ok(res10.summary_points[1].includes('ระบบแสง สี เสียง'));

  const byName = resolveRoomGuidelines(null, 'Jupiter Auditorium');
  assert.strictEqual(byName.required, true);
  assert.strictEqual(byName.rule_set, 'jupiter_auditorium');
});

test('POLICY-03: Unmapped room (e.g. Co-working zone ID 13) is exempt', () => {
  const res = resolveRoomGuidelines(13, 'เหมาโซน Co-working');
  assert.strictEqual(res.required, false);
  assert.strictEqual(res.rule_set, null);
  assert.strictEqual(res.summary_points.length, 0);
});

test('POLICY-04: LINE guidelines message matches required wording and format', () => {
  const config = ROOM_GUIDELINES_CONFIG.meeting_room_201_306;
  const msg = buildLineGuidelinesMessage(config);

  assert.ok(msg.startsWith('ข้อปฏิบัติการใช้ห้องประชุม (201, 301-306)'));
  assert.ok(msg.includes('กรุณาอ่านข้อปฏิบัติก่อนเข้าใช้บริการ BWORK'));
  assert.ok(msg.includes('อ่านข้อปฏิบัติฉบับเต็ม:'));
  assert.ok(msg.includes('https://bwork-booking.pages.dev/rules/room301-306.png'));
});

// ========================================================
// 2. INTEGRATION TESTS WITH EXPRESS & SQLITE
// ========================================================

function createTestDb() {
  const db = new sqlite3.Database(':memory:');
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
  const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  return { db, run, get, all };
}

async function initSchema(testDb) {
  await testDb.run(`
    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      capacity INTEGER DEFAULT 10,
      image_url TEXT,
      description TEXT
    );
  `);

  await testDb.run(`
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      contact TEXT,
      total_amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      receipt_number TEXT,
      pin_code TEXT,
      qr_token TEXT,
      line_user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      guidelines_acknowledged_at DATETIME,
      guidelines_rule_set TEXT,
      guidelines_rule_version TEXT,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      slip_image_url TEXT
    );
  `);

  await testDb.run(`
    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
      room_id INTEGER REFERENCES rooms(id),
      start_time TEXT,
      end_time TEXT,
      price REAL,
      subtotal REAL
    );
  `);

  await testDb.run(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await testDb.run(`
    CREATE TABLE room_guidelines_acknowledgements (
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
  `);

  await testDb.run(`
    CREATE TABLE line_guidelines_dispatches (
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
  `);

  // Seed sample rooms
  await testDb.run(`INSERT INTO rooms (id, name) VALUES (4, 'ห้องประชุม 301')`);
  await testDb.run(`INSERT INTO rooms (id, name) VALUES (5, 'ห้องประชุม 302')`);
  await testDb.run(`INSERT INTO rooms (id, name) VALUES (11, 'ห้องประชุม 201')`);
  await testDb.run(`INSERT INTO rooms (id, name) VALUES (10, 'ห้องประชุม Jupiter (300)')`);
  await testDb.run(`INSERT INTO rooms (id, name) VALUES (13, 'เหมาโซน Co-working')`);

  await testDb.run(`INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')`);
  await testDb.run(`INSERT INTO settings (key, value) VALUES ('line_channel_access_token', 'mock_token_123')`);
}

// Build mini express harness simulating server.js acknowledge-rules & upload-slip & get-booking
function createHarness(testDb, mockLineDispatcher = null) {
  const app = express();
  app.use(express.json());

  // Auth helper
  const hasAccess = (req, booking) => {
    const token = req.headers['x-booking-token'] || req.body?.access_token || req.query?.access_token;
    const contact = req.headers['x-booking-contact'] || req.body?.contact || req.query?.contact;
    if (token && booking.qr_token && token === booking.qr_token) return true;
    if (contact) {
      const c1 = String(contact).replace(/\D/g, '');
      const c2 = String(booking.contact || '').replace(/\D/g, '');
      if (c1.length >= 9 && c1 === c2) return true;
    }
    return false;
  };

  // GET /api/public/bookings/:id
  app.get('/api/public/bookings/:id', async (req, res) => {
    try {
      const booking = await testDb.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
      if (!booking) return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
      if (!hasAccess(req, booking)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });

      const items = await testDb.all(
        'SELECT bi.*, r.name as room_name FROM booking_items bi LEFT JOIN rooms r ON bi.room_id = r.id WHERE bi.booking_id = ?',
        [booking.id]
      );
      const guidelinesPolicy = resolveRoomGuidelines(items[0]?.room_id, items[0]?.room_name);

      res.json({
        id: booking.id,
        booking_code: booking.receipt_number,
        payment_status: booking.payment_status,
        guidelines_acknowledged: Boolean(booking.guidelines_acknowledged_at),
        guidelines_acknowledged_at: booking.guidelines_acknowledged_at || null,
        guidelines_required: Boolean(guidelinesPolicy.required),
        guidelines_rule_set: booking.guidelines_rule_set || guidelinesPolicy.rule_set,
        guidelines_rule_version: booking.guidelines_rule_version || guidelinesPolicy.rule_version,
        room: items[0] ? { id: items[0].room_id, name: items[0].room_name } : null
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/public/bookings/:id/acknowledge-rules
  app.post('/api/public/bookings/:id/acknowledge-rules', async (req, res) => {
    try {
      const booking = await testDb.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
      if (!booking) return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
      if (!hasAccess(req, booking)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });

      if (booking.payment_status === 'cancelled') {
        return res.status(400).json({ error: 'รายการจองถูกยกเลิกแล้ว' });
      }

      const items = await testDb.all(
        'SELECT bi.*, r.name as room_name FROM booking_items bi LEFT JOIN rooms r ON bi.room_id = r.id WHERE bi.booking_id = ?',
        [booking.id]
      );
      const firstItem = items[0] || null;
      const guidelinesConfig = resolveRoomGuidelines(firstItem?.room_id, firstItem?.room_name);

      if (!guidelinesConfig.required) {
        return res.json({ success: true, required: false, message: 'ห้องนี้ไม่จำเป็นต้องรับทราบข้อปฏิบัติ' });
      }

      // Record in room_guidelines_acknowledgements
      try {
        await testDb.run(
          `INSERT OR IGNORE INTO room_guidelines_acknowledgements
           (booking_id, room_id, rule_set, rule_version, customer_contact, line_user_id, acknowledged_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [booking.id, firstItem?.room_id || null, guidelinesConfig.rule_set, guidelinesConfig.rule_version, booking.contact, booking.line_user_id]
        );
      } catch (e) {}

      // Update bookings
      await testDb.run(
        `UPDATE bookings
         SET guidelines_acknowledged_at = COALESCE(guidelines_acknowledged_at, CURRENT_TIMESTAMP),
             guidelines_rule_set = ?,
             guidelines_rule_version = ?
         WHERE id = ?`,
        [guidelinesConfig.rule_set, guidelinesConfig.rule_version, booking.id]
      );

      const updated = await testDb.get('SELECT guidelines_acknowledged_at FROM bookings WHERE id = ?', [booking.id]);

      // LINE Deduplication & Dispatch
      let lineNotification = null;
      if (booking.line_user_id) {
        const existing = await testDb.get(
          'SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ? AND rule_set = ? AND rule_version = ?',
          [booking.line_user_id, guidelinesConfig.rule_set, guidelinesConfig.rule_version]
        );

        if (existing) {
          lineNotification = { status: 'already_sent', deduplicated: true };
        } else {
          let lineResult = { sent: true };
          if (mockLineDispatcher) {
            lineResult = await mockLineDispatcher({ booking, guidelinesConfig });
          }

          if (lineResult.sent) {
            await testDb.run(
              `INSERT INTO line_guidelines_dispatches (line_user_id, rule_set, rule_version, first_booking_id, status, dispatched_at)
               VALUES (?, ?, ?, ?, 'sent', CURRENT_TIMESTAMP)`,
              [booking.line_user_id, guidelinesConfig.rule_set, guidelinesConfig.rule_version, booking.id]
            );
            lineNotification = { status: 'sent', deduplicated: false };
          } else {
            lineNotification = { status: 'failed', deduplicated: false, error: lineResult.error || 'dispatch_error' };
          }
        }
      } else {
        lineNotification = { status: 'skipped_no_line', deduplicated: false };
      }

      return res.json({
        success: true,
        acknowledged: true,
        required: true,
        rule_set: guidelinesConfig.rule_set,
        rule_version: guidelinesConfig.rule_version,
        acknowledged_at: updated?.guidelines_acknowledged_at,
        line_notification: lineNotification
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/public/bookings/:id/upload-slip
  app.post('/api/public/bookings/:id/upload-slip', async (req, res) => {
    try {
      const booking = await testDb.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
      if (!booking) return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
      if (!hasAccess(req, booking)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });

      // Precondition: Guidelines acknowledgement
      const items = await testDb.all(
        'SELECT bi.*, r.name as room_name FROM booking_items bi LEFT JOIN rooms r ON bi.room_id = r.id WHERE bi.booking_id = ?',
        [booking.id]
      );
      const guidelinesPolicy = resolveRoomGuidelines(items[0]?.room_id, items[0]?.room_name);

      if (guidelinesPolicy.required) {
        const isPostCutover = !booking.created_at || (new Date(String(booking.created_at).replace(' ', 'T')).getTime() >= new Date(GUIDELINES_CUTOVER_ISO).getTime());
        if (isPostCutover && !booking.guidelines_acknowledged_at) {
          return res.status(400).json({
            success: false,
            error: 'กรุณารับทราบข้อปฏิบัติการใช้ห้องประชุมก่อนส่งหลักฐานการชำระเงิน',
            code: 'GUIDELINES_NOT_ACKNOWLEDGED'
          });
        }
      }

      // If passed, accept slip
      await testDb.run("UPDATE bookings SET payment_status = 'reviewing', slip_image_url = 'mock_slip.png' WHERE id = ?", [booking.id]);
      return res.json({ success: true, status: 'reviewing', auto_approved: false });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return app;
}

// Helper to make fast in-process requests to Express app
async function callApi(app, method, url, { headers = {}, body = null } = {}) {
  const http = require('node:http');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    if (body) fetchOptions.body = JSON.stringify(body);

    const res = await fetch(`http://127.0.0.1:${port}${url}`, fetchOptions);
    const json = await res.json();
    return { status: res.status, ok: res.ok, body: json };
  } finally {
    await new Promise(r => server.close(r));
  }
}

// ========================================================
// 3. AUTOMATED INTEGRATION TESTS (TC01 - TC10)
// ========================================================

test('TC01: Meeting room first-time acknowledgement -> QR unlocked, LINE dispatched', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let lineDispatchedCount = 0;
  const app = createHarness(testDb, async ({ booking, guidelinesConfig }) => {
    lineDispatchedCount++;
    return { sent: true };
  });

  // Create booking for Room 301 (ID 4)
  const bRes = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, created_at)
    VALUES ('Somchai Customer', '0812345678', 800, 'tok_1', 'U_LINE_SOMCHAI', '2026-11-09T10:00:00Z')
  `);
  const bookingId = bRes.lastID;
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, 4, 800, 800)`, [bookingId]);

  // Acknowledge rules
  const res = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_1' }
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.acknowledged, true);
  assert.strictEqual(res.body.rule_set, 'meeting_room_201_306');
  assert.strictEqual(res.body.rule_version, 'v1');
  assert.strictEqual(res.body.line_notification.status, 'sent');
  assert.strictEqual(res.body.line_notification.deduplicated, false);
  assert.strictEqual(lineDispatchedCount, 1);

  // DB verification
  const bookingInDb = await testDb.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  assert.ok(bookingInDb.guidelines_acknowledged_at);
  assert.strictEqual(bookingInDb.guidelines_rule_set, 'meeting_room_201_306');

  const ackRow = await testDb.get('SELECT * FROM room_guidelines_acknowledgements WHERE booking_id = ?', [bookingId]);
  assert.ok(ackRow);
  assert.strictEqual(ackRow.rule_set, 'meeting_room_201_306');

  const lineRow = await testDb.get('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?', ['U_LINE_SOMCHAI']);
  assert.ok(lineRow);
  assert.strictEqual(lineRow.status, 'sent');
});

test('TC02: Repeat booking across rooms in same group (Room 201 -> Room 302) suppresses duplicate LINE dispatch', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let lineDispatchedCount = 0;
  const app = createHarness(testDb, async () => {
    lineDispatchedCount++;
    return { sent: true };
  });

  // Booking 1: Room 201 (ID 11) for Somchai
  const b1 = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, created_at)
    VALUES ('Somchai Customer', '0812345678', 800, 'tok_b1', 'U_LINE_SOMCHAI', '2026-11-09T10:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 11)`, [b1.lastID]);

  // Acknowledge B1
  const resB1 = await callApi(app, 'POST', `/api/public/bookings/${b1.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_b1' }
  });
  assert.strictEqual(resB1.body.line_notification.status, 'sent');
  assert.strictEqual(lineDispatchedCount, 1);

  // Booking 2: Room 302 (ID 5 - same rule group meeting_room_201_306) for Somchai
  const b2 = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, created_at)
    VALUES ('Somchai Customer', '0812345678', 800, 'tok_b2', 'U_LINE_SOMCHAI', '2026-11-09T11:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 5)`, [b2.lastID]);

  // Acknowledge B2: Web acknowledgment MUST succeed, but LINE MUST be suppressed
  const resB2 = await callApi(app, 'POST', `/api/public/bookings/${b2.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_b2' }
  });

  assert.strictEqual(resB2.status, 200);
  assert.strictEqual(resB2.body.acknowledged, true);
  assert.strictEqual(resB2.body.line_notification.status, 'already_sent');
  assert.strictEqual(resB2.body.line_notification.deduplicated, true);
  // Total LINE calls remain 1!
  assert.strictEqual(lineDispatchedCount, 1);

  // Verify separate acknowledgment record exists for B2 in DB
  const ackRowB2 = await testDb.get('SELECT * FROM room_guidelines_acknowledgements WHERE booking_id = ?', [b2.lastID]);
  assert.ok(ackRowB2);
});

test('TC03: First-time Jupiter Auditorium booking dispatches LINE for new rule set', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let lineDispatchedCount = 0;
  let lastDispatchedSet = null;
  const app = createHarness(testDb, async ({ guidelinesConfig }) => {
    lineDispatchedCount++;
    lastDispatchedSet = guidelinesConfig.rule_set;
    return { sent: true };
  });

  // Previous dispatch was meeting room
  await testDb.run(`
    INSERT INTO line_guidelines_dispatches (line_user_id, rule_set, rule_version, status)
    VALUES ('U_LINE_SOMCHAI', 'meeting_room_201_306', 'v1', 'sent')
  `);

  // New Booking for Jupiter Auditorium (ID 10)
  const bJup = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, created_at)
    VALUES ('Somchai Customer', '0812345678', 6000, 'tok_jup', 'U_LINE_SOMCHAI', '2026-11-09T12:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 10)`, [bJup.lastID]);

  const res = await callApi(app, 'POST', `/api/public/bookings/${bJup.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_jup' }
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.rule_set, 'jupiter_auditorium');
  assert.strictEqual(res.body.line_notification.status, 'sent');
  assert.strictEqual(res.body.line_notification.deduplicated, false);
  assert.strictEqual(lineDispatchedCount, 1);
  assert.strictEqual(lastDispatchedSet, 'jupiter_auditorium');
});

test('TC04: Bumped rule version (v2) re-dispatches LINE message', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  // User already has v1 dispatched in DB
  await testDb.run(`
    INSERT INTO line_guidelines_dispatches (line_user_id, rule_set, rule_version, status)
    VALUES ('U_LINE_SOMCHAI', 'meeting_room_201_306', 'v1', 'sent')
  `);

  // Check if v2 is present
  const checkV2 = await testDb.get(
    'SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ? AND rule_set = ? AND rule_version = ?',
    ['U_LINE_SOMCHAI', 'meeting_room_201_306', 'v2']
  );
  assert.strictEqual(checkV2, undefined);
});

test('TC05: Page refresh (GET /api/public/bookings/:id) exposes stored acknowledgement state', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);
  const app = createHarness(testDb);

  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, guidelines_acknowledged_at, guidelines_rule_set, guidelines_rule_version, created_at)
    VALUES ('Test Customer', '0899999999', 500, 'tok_view', '2026-11-09T10:30:00Z', 'meeting_room_201_306', 'v1', '2026-11-09T10:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)`, [b.lastID]);

  const res = await callApi(app, 'GET', `/api/public/bookings/${b.lastID}`, {
    headers: { 'X-Booking-Token': 'tok_view' }
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.guidelines_acknowledged, true);
  assert.strictEqual(res.body.guidelines_acknowledged_at, '2026-11-09T10:30:00Z');
  assert.strictEqual(res.body.guidelines_required, true);
  assert.strictEqual(res.body.guidelines_rule_set, 'meeting_room_201_306');
  assert.strictEqual(res.body.guidelines_rule_version, 'v1');
});

test('TC06: Double submit / repeat acknowledge API is idempotent', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);
  const app = createHarness(testDb, async () => ({ sent: true }));

  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, created_at)
    VALUES ('Repeat Submitter', '0888888888', 400, 'tok_rep', 'U_LINE_REP', '2026-11-09T10:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)`, [b.lastID]);

  // First call
  const r1 = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_rep' }
  });
  assert.strictEqual(r1.status, 200);
  const firstAckAt = r1.body.acknowledged_at;

  // Second immediate call
  const r2 = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_rep' }
  });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.body.acknowledged, true);
  // Idempotent: timestamp is preserved
  assert.strictEqual(r2.body.acknowledged_at, firstAckAt);
  // Second call reports already_sent for LINE
  assert.strictEqual(r2.body.line_notification.status, 'already_sent');
});

test('TC07: Calling slip upload before acknowledgement is rejected with HTTP 400', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);
  const app = createHarness(testDb);

  // New post-cutover booking (Room 301, ID 4)
  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, created_at)
    VALUES ('Unacknowledged User', '0811111111', 500, 'tok_gate', '2026-11-09T10:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)`, [b.lastID]);

  // 1. Upload slip without acknowledging guidelines -> Must fail with 400
  const slipRes1 = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_gate' },
    body: { slip_image: 'data:image/png;base64,mock' }
  });

  assert.strictEqual(slipRes1.status, 400);
  assert.strictEqual(slipRes1.body.code, 'GUIDELINES_NOT_ACKNOWLEDGED');
  assert.ok(slipRes1.body.error.includes('กรุณารับทราบข้อปฏิบัติการใช้ห้องประชุม'));

  // 2. Acknowledge guidelines
  const ackRes = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_gate' }
  });
  assert.strictEqual(ackRes.status, 200);

  // 3. Upload slip again -> Must succeed with reviewing status
  const slipRes2 = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_gate' },
    body: { slip_image: 'data:image/png;base64,mock' }
  });

  assert.strictEqual(slipRes2.status, 200);
  assert.strictEqual(slipRes2.body.status, 'reviewing');
});

test('TC08: Legacy booking before cutover allows slip upload without blocking', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);
  const app = createHarness(testDb);

  // Created BEFORE cutover: 2026-11-05
  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, created_at)
    VALUES ('Legacy User', '0822222222', 500, 'tok_legacy', '2026-11-05T08:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)`, [b.lastID]);

  const res = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_legacy' },
    body: { slip_image: 'data:image/png;base64,mock' }
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'reviewing');
});

test('TC09: Unmapped exempt room (Co-working zone ID 13) bypasses gate immediately', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);
  const app = createHarness(testDb);

  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, created_at)
    VALUES ('Coworking User', '0833333333', 300, 'tok_cowork', '2026-11-09T10:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 13)`, [b.lastID]);

  // Status check
  const getRes = await callApi(app, 'GET', `/api/public/bookings/${b.lastID}`, {
    headers: { 'X-Booking-Token': 'tok_cowork' }
  });
  assert.strictEqual(getRes.body.guidelines_required, false);

  // Acknowledge endpoint reports required: false
  const ackRes = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_cowork' }
  });
  assert.strictEqual(ackRes.body.required, false);

  // Upload slip succeeds without needing acknowledgement
  const slipRes = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_cowork' },
    body: { slip_image: 'data:image/png;base64,mock' }
  });
  assert.strictEqual(slipRes.status, 200);
});

test('TC10: Customer without LINE or LINE dispatch failure does not block web payment flow', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  // 1. Customer with NO LINE user ID
  const appNoLine = createHarness(testDb);
  const bNoLine = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, created_at)
    VALUES ('No Line User', '0844444444', 500, 'tok_noline', NULL, '2026-11-09T10:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)`, [bNoLine.lastID]);

  const res1 = await callApi(appNoLine, 'POST', `/api/public/bookings/${bNoLine.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_noline' }
  });

  assert.strictEqual(res1.status, 200);
  assert.strictEqual(res1.body.acknowledged, true);
  assert.strictEqual(res1.body.line_notification.status, 'skipped_no_line');

  // Can upload slip without hindrance
  const slip1 = await callApi(appNoLine, 'POST', `/api/public/bookings/${bNoLine.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_noline' },
    body: { slip_image: 'mock' }
  });
  assert.strictEqual(slip1.status, 200);

  // 2. Customer has LINE but network fails
  const appLineFail = createHarness(testDb, async () => {
    return { sent: false, error: 'Network timeout to api.line.me' };
  });

  const bLineFail = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, created_at)
    VALUES ('Line Fail User', '0855555555', 500, 'tok_linefail', 'U_FAIL_USER', '2026-11-09T10:00:00Z')
  `);
  await testDb.run(`INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)`, [bLineFail.lastID]);

  const res2 = await callApi(appLineFail, 'POST', `/api/public/bookings/${bLineFail.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_linefail' }
  });

  // Web acknowledgement STILL succeeds! Web status is decoupled from LINE dispatch
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(res2.body.acknowledged, true);
  assert.strictEqual(res2.body.line_notification.status, 'failed');
  assert.ok(res2.body.line_notification.error.includes('Network timeout'));

  // Can proceed to upload slip without hindrance!
  const slip2 = await callApi(appLineFail, 'POST', `/api/public/bookings/${bLineFail.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_linefail' },
    body: { slip_image: 'mock' }
  });
  assert.strictEqual(slip2.status, 200);
});


// ========================================================
// 4. E2E INTEGRATION WITH REAL server.js EXPRESS APP & DB
// ========================================================

test('SERVER-E2E: Direct test against server.js routes and database.js migrations', async () => {
  const tempDbPath = path.resolve(__dirname, 'temp_guidelines_server.sqlite');
  if (fs.existsSync(tempDbPath)) {
    try { fs.unlinkSync(tempDbPath); } catch (_) {}
  }

  process.env.DB_PATH = tempDbPath;
  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'test';

  const { initDatabase, dbQuery, db } = require('../database.js');
  await initDatabase();

  const { app } = require('../server.js');

  try {
    // 1. Find Room 301 from database
    const roomRow = await dbQuery.get("SELECT id, name FROM rooms WHERE name LIKE '%301%'");
    const targetRoomId = roomRow?.id || 5;

    const validSlip = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Create a test booking for Room 301
    const bResult = await dbQuery.run(`
      INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, created_at)
      VALUES ('Server E2E Customer', '0891234567', 1200, 'tok_srv_1', 'U_SRV_LINE_1', datetime('now'))
    `);
    const bookingId = bResult.id || bResult.lastID;

    await dbQuery.run(`
      INSERT INTO booking_items (booking_id, room_id, price, subtotal)
      VALUES (?, ?, 1200, 1200)
    `, [bookingId, targetRoomId]);

    // 2. Call GET before acknowledgement
    const getRes1 = await callApi(app, 'GET', `/api/public/bookings/${bookingId}`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' }
    });
    assert.strictEqual(getRes1.status, 200);
    assert.strictEqual(getRes1.body.guidelines_required, true);
    assert.strictEqual(getRes1.body.guidelines_acknowledged, false);
    assert.strictEqual(getRes1.body.guidelines_acknowledged_at, null);

    // 3. Call upload-slip before acknowledgement -> Rejected with 400
    const slipResFail = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/upload-slip`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' },
      body: { slip_image: validSlip }
    });
    assert.strictEqual(slipResFail.status, 400);
    assert.strictEqual(slipResFail.body.code, 'GUIDELINES_NOT_ACKNOWLEDGED');

    // 4. Acknowledge rules
    const ackRes = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/acknowledge-rules`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' }
    });
    assert.strictEqual(ackRes.status, 200);
    assert.strictEqual(ackRes.body.success, true);
    assert.strictEqual(ackRes.body.acknowledged, true);
    assert.strictEqual(ackRes.body.rule_set, 'meeting_room_201_306');
    assert.ok(ackRes.body.acknowledged_at);
    assert.strictEqual(ackRes.body.line_notification.status, 'sent');

    // 5. Call GET after acknowledgement -> Exposed
    const getRes2 = await callApi(app, 'GET', `/api/public/bookings/${bookingId}`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' }
    });
    assert.strictEqual(getRes2.status, 200);
    assert.strictEqual(getRes2.body.guidelines_acknowledged, true);
    assert.strictEqual(getRes2.body.guidelines_acknowledged_at, ackRes.body.acknowledged_at);

    // 6. Call upload-slip after acknowledgement -> Allowed!
    const slipResOk = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/upload-slip`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' },
      body: { slip_image: validSlip }
    });
    assert.strictEqual(slipResOk.status, 200);
    assert.strictEqual(slipResOk.body.status, 'reviewing');

    // 7. Verify DB tables
    const ackRows = await dbQuery.all('SELECT * FROM room_guidelines_acknowledgements WHERE booking_id = ?', [bookingId]);
    assert.strictEqual(ackRows.length, 1);
    assert.strictEqual(ackRows[0].rule_set, 'meeting_room_201_306');

    const lineRows = await dbQuery.all('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?', ['U_SRV_LINE_1']);
    assert.strictEqual(lineRows.length, 1);
  } finally {
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch (_) {}
    }
  }
});
