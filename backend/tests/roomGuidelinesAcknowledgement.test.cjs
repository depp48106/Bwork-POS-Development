/**
 * backend/tests/roomGuidelinesAcknowledgement.test.cjs
 *
 * Comprehensive Automated Test Suite for Room Guidelines Acknowledgement Pre-Payment Gate:
 * 1. Policy resolution & Summary Points matching exact flyers
 * 2. Feature toggle evaluation & helper tests (isGuidelinesEnforcedForBooking)
 * 3. First-time meeting room acknowledgement & LINE dispatch
 * 4. Repeat booking across rooms in same group (Room 201 -> Room 302) suppresses duplicate LINE dispatch
 * 5. Distinct room group dispatch (Jupiter Auditorium)
 * 6. Version bump re-dispatch (v2)
 * 7. Server state exposure on page refresh (GET /api/public/bookings/:id)
 * 8. Double-submit / repeat acknowledgement idempotency
 * 9. Atomic claim preventing duplicate LINE sends on concurrent confirmation in two tabs
 * 10. Mismatched client rule_set / rule_version rejected with HTTP 400
 * 11. Feature toggle OFF allows slip upload; Feature toggle ON rejects unacknowledged booking
 * 12. Backward compatibility for legacy pending bookings before cutover
 * 13. Exempt unmapped rooms (Co-working zone)
 * 14. Decoupled web payment unlock when customer has no LINE or LINE is slow / fails
 * 15. SERVER-E2E: Direct integration test against server.js routes and database.js migrations
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
  isGuidelinesEnforcedForBooking,
  isBoundLineUserId,
  isServerConfirmedLineBinding,
  buildLineGuidelinesMessage
} = require('../../shared/roomGuidelinesPolicy.mjs');

// ========================================================
// 1. UNIT TESTS: POLICY RESOLUTION & SUMMARY POINTS
// ========================================================

test('POLICY-01: Resolves Room 201 and 301-306 to meeting_room_201_306 group with exact flyer rules', () => {
  const ids = [4, 5, 6, 7, 8, 9, 11];
  for (const id of ids) {
    const res = resolveRoomGuidelines(id, `Room ${id}`);
    assert.strictEqual(res.required, true);
    assert.strictEqual(res.rule_set, 'meeting_room_201_306');
    assert.strictEqual(res.rule_version, 'v1');
    assert.strictEqual(res.summary_points.length, 4);
    assert.ok(res.summary_points[0].includes('การใช้ห้องเกินเวลา'));
    assert.ok(res.summary_points[1].includes('อาหารและเครื่องดื่ม'));
    assert.ok(res.summary_points[1].includes('ไม่อนุญาตให้นำอาหารเข้ามารับประทานในห้องประชุม ยกเว้นเครื่องดื่มและเบเกอรี่'));
    assert.ok(res.summary_points[2].includes('การรักษาความสะอาด'));
    assert.ok(res.summary_points[3].includes('ความเสียหายและทรัพย์สิน'));
  }

  // Also matches by name pattern
  const byName201 = resolveRoomGuidelines(99, 'ห้อง 201 ชั้น 2');
  assert.strictEqual(byName201.required, true);
  assert.strictEqual(byName201.rule_set, 'meeting_room_201_306');

  const byName305 = resolveRoomGuidelines(99, 'ห้องประชุม 305');
  assert.strictEqual(byName305.required, true);
  assert.strictEqual(byName305.rule_set, 'meeting_room_201_306');
});

test('POLICY-02: Resolves Jupiter Auditorium to jupiter_auditorium group with exact flyer rules', () => {
  const res10 = resolveRoomGuidelines(10, 'Jupiter Room');
  assert.strictEqual(res10.required, true);
  assert.strictEqual(res10.rule_set, 'jupiter_auditorium');
  assert.strictEqual(res10.rule_version, 'v1');
  assert.strictEqual(res10.summary_points.length, 4);
  assert.ok(res10.summary_points[0].includes('การใช้ห้องเกินเวลา'));
  assert.ok(res10.summary_points[1].includes('อาหารและเครื่องดื่ม'));
  assert.ok(res10.summary_points[1].includes('ยกเว้นเครื่องดื่มและเบรกที่จัดเตรียมไว้'));
  assert.ok(res10.summary_points[2].includes('การรักษาความสะอาด'));
  assert.ok(res10.summary_points[3].includes('ความเสียหายและทรัพย์สิน'));

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

test('POLICY-05: isGuidelinesEnforcedForBooking evaluates toggle, cutover, and room exemption correctly', () => {
  const meetingPolicy = resolveRoomGuidelines(5, 'Room 301');
  const exemptPolicy = resolveRoomGuidelines(13, 'Co-working');

  // 1. Toggle disabled -> not enforced
  assert.strictEqual(isGuidelinesEnforcedForBooking({ guidelinesPolicy: meetingPolicy, enforcementSetting: 'false' }), false);
  assert.strictEqual(isGuidelinesEnforcedForBooking({ guidelinesPolicy: meetingPolicy, enforcementSetting: false }), false);

  // 2. Exempt room -> never enforced even if toggle enabled
  assert.strictEqual(isGuidelinesEnforcedForBooking({ guidelinesPolicy: exemptPolicy, enforcementSetting: 'true' }), false);

  // 3. Toggle enabled -> new booking is enforced
  assert.strictEqual(isGuidelinesEnforcedForBooking({ guidelinesPolicy: meetingPolicy, enforcementSetting: 'true' }), true);

  // 4. Cutover check: booking created prior to cutover date is exempt
  const cutover = '2026-11-09T00:00:00Z';
  const legacyCreated = '2026-11-08T23:59:59Z';
  const newCreated = '2026-11-09T01:00:00Z';

  assert.strictEqual(isGuidelinesEnforcedForBooking({
    guidelinesPolicy: meetingPolicy,
    enforcementSetting: 'true',
    cutoverAt: cutover,
    bookingCreatedAt: legacyCreated
  }), false);

  assert.strictEqual(isGuidelinesEnforcedForBooking({
    guidelinesPolicy: meetingPolicy,
    enforcementSetting: 'true',
    cutoverAt: cutover,
    bookingCreatedAt: newCreated
  }), true);
});

test('POLICY-06: isBoundLineUserId validates bound LINE accounts', () => {
  assert.strictEqual(isBoundLineUserId('U1234567890abcdef1234567890abcdef'), true);
  assert.strictEqual(isBoundLineUserId('U_SRV_LINE_1'), true);
  assert.strictEqual(isBoundLineUserId(''), false);
  assert.strictEqual(isBoundLineUserId(null), false);
  assert.strictEqual(isBoundLineUserId('invalid_id'), false);
  assert.strictEqual(isBoundLineUserId('U123'), false); // too short
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
      capacity INTEGER
    )
  `);

  await testDb.run(`
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      contact TEXT,
      total_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'pending',
      slip_image_url TEXT,
      qr_token TEXT,
      line_user_id TEXT,
      line_user_id_verified INTEGER DEFAULT 0,
      booking_source TEXT DEFAULT 'online',
      guidelines_acknowledged_at DATETIME,
      guidelines_rule_set TEXT,
      guidelines_rule_version TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await testDb.run(`
    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      room_id INTEGER REFERENCES rooms(id),
      price REAL,
      subtotal REAL
    )
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
    )
  `);

  await testDb.run(`
    CREATE TABLE line_guidelines_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_user_id TEXT NOT NULL,
      rule_set TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      first_booking_id INTEGER REFERENCES bookings(id),
      status TEXT NOT NULL DEFAULT 'claimed',
      error_message TEXT,
      dispatched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(line_user_id, rule_set, rule_version)
    )
  `);

  await testDb.run(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Default server setting: disabled during release prep
  await testDb.run("INSERT INTO settings (key, value) VALUES ('guidelines_enforcement_enabled', 'false')");
  await testDb.run("INSERT INTO settings (key, value) VALUES ('guidelines_enforcement_cutover_at', '2026-11-09T00:00:00.000Z')");
  await testDb.run("INSERT INTO settings (key, value) VALUES ('line_guidelines_dispatch_enabled', 'true')");
  await testDb.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  // Seed sample rooms
  await testDb.run("INSERT INTO rooms (id, name, capacity) VALUES (4, 'ห้องประชุม 301 (Mars)', 8)");
  await testDb.run("INSERT INTO rooms (id, name, capacity) VALUES (5, 'ห้องประชุม 302 (Mercury)', 8)");
  await testDb.run("INSERT INTO rooms (id, name, capacity) VALUES (10, 'Jupiter Auditorium (300)', 40)");
  await testDb.run("INSERT INTO rooms (id, name, capacity) VALUES (11, 'ห้องประชุม 201 (Pluto)', 12)");
  await testDb.run("INSERT INTO rooms (id, name, capacity) VALUES (13, 'เหมาโซน Co-working', 50)");
}

function createHarness(testDb, mockLineDispatcher = null) {
  const app = express();
  app.use(express.json());

  const hasAccess = (req, booking) => {
    const token = req.get('x-booking-token') || req.query.access_token || req.body?.access_token;
    const contact = req.get('x-booking-contact') || req.query.contact || req.body?.contact;
    if (token && booking.qr_token && token === booking.qr_token) return true;
    if (contact && booking.contact && contact.replace(/\D/g, '') === booking.contact.replace(/\D/g, '')) return true;
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

      const settingEnforce = await testDb.get("SELECT value FROM settings WHERE key = 'guidelines_enforcement_enabled'");
      const settingCutover = await testDb.get("SELECT value FROM settings WHERE key = 'guidelines_enforcement_cutover_at'");

      const guidelinesEnforced = isGuidelinesEnforcedForBooking({
        guidelinesPolicy,
        enforcementSetting: settingEnforce?.value,
        cutoverAt: settingCutover?.value,
        bookingCreatedAt: booking.created_at
      });

      return res.json({
        id: booking.id,
        customer_name: booking.customer_name,
        contact: booking.contact,
        total_amount: booking.total_amount,
        payment_status: booking.payment_status,
        guidelines_enforcement_enabled: settingEnforce?.value === 'true',
        guidelines_enforced: guidelinesEnforced,
        guidelines_acknowledged: Boolean(booking.guidelines_acknowledged_at),
        guidelines_acknowledged_at: booking.guidelines_acknowledged_at || null,
        guidelines_required: Boolean(guidelinesPolicy.required),
        guidelines_rule_set: booking.guidelines_rule_set || guidelinesPolicy.rule_set,
        guidelines_rule_version: booking.guidelines_rule_version || guidelinesPolicy.rule_version,
        room: items[0] ? { id: items[0].room_id, name: items[0].room_name } : null
      });
    } catch (e) {
      console.error('[Harness Error in acknowledge-rules]:', e);
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

      // Strict validation: rule_set & rule_version must be provided and match current room policy
      const clientRuleSet = req.body?.rule_set;
      const clientRuleVersion = req.body?.rule_version;
      if (!clientRuleSet || !clientRuleVersion) {
        return res.status(400).json({ error: 'กรุณาระบุรหัสชุดข้อปฏิบัติ (rule_set) และเวอร์ชัน (rule_version) ให้ครบถ้วน' });
      }
      if (clientRuleSet !== guidelinesConfig.rule_set || clientRuleVersion !== guidelinesConfig.rule_version) {
        return res.status(400).json({ error: 'รหัสชุดข้อปฏิบัติหรือเวอร์ชันไม่ถูกต้องหรือไม่ตรงกับห้องที่จอง' });
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

      // Update bookings immediately so web unlock is persisted
      await testDb.run(
        `UPDATE bookings
         SET guidelines_acknowledged_at = COALESCE(guidelines_acknowledged_at, CURRENT_TIMESTAMP),
             guidelines_rule_set = ?,
             guidelines_rule_version = ?
         WHERE id = ?`,
        [guidelinesConfig.rule_set, guidelinesConfig.rule_version, booking.id]
      );

      const updated = await testDb.get('SELECT guidelines_acknowledged_at FROM bookings WHERE id = ?', [booking.id]);

      // Atomic Claim & LINE Dispatch with Server Confirmation & Feature Toggle
      const rawLineId = typeof booking.line_user_id === 'string' ? booking.line_user_id.trim() : '';
      const isBound = isBoundLineUserId(rawLineId);
      const isLineConfirmed = isServerConfirmedLineBinding({
        lineUserId: rawLineId,
        isVerified: booking.line_user_id_verified,
        verifiedTokenUserId: (req.headers['x-line-id-token'] && req.headers['x-line-id-token'].includes('valid.token.') ? req.headers['x-line-id-token'].split('valid.token.')[1] : null)
      });

      const lineToggleSetting = await testDb.get("SELECT value FROM settings WHERE key = 'line_guidelines_dispatch_enabled'");
      const isFeatureEnabled = (lineToggleSetting && (lineToggleSetting.value === 'true' || lineToggleSetting.value === '1')) && (process.env.DISABLE_LIVE_LINE !== 'true');
      const isFeatureDisabled = !isFeatureEnabled;

      let lineNotification = null;

      if (!isBound) {
        lineNotification = { status: 'skipped_no_line', deduplicated: false };
      } else if (!isLineConfirmed) {
        lineNotification = { status: 'skipped_unverified_line', deduplicated: false };
      } else if (isFeatureDisabled) {
        lineNotification = { status: 'skipped_feature_disabled', deduplicated: false };
      } else {
        let claimWon = false;
        try {
          await testDb.run(
            `INSERT INTO line_guidelines_dispatches (line_user_id, rule_set, rule_version, first_booking_id, status, dispatched_at)
             VALUES (?, ?, ?, ?, 'claimed', CURRENT_TIMESTAMP)`,
            [rawLineId, guidelinesConfig.rule_set, guidelinesConfig.rule_version, booking.id]
          );
          claimWon = true;
        } catch (e) {
          claimWon = false;
        }

        if (!claimWon) {
          const existing = await testDb.get(
            'SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ? AND rule_set = ? AND rule_version = ?',
            [rawLineId, guidelinesConfig.rule_set, guidelinesConfig.rule_version]
          );
          if (existing?.status === 'sent' || existing?.status === 'claimed') {
            lineNotification = { status: 'already_sent', deduplicated: true };
          } else {
            lineNotification = { status: existing?.status || 'unknown', deduplicated: true };
          }
        } else {
          // Claim won! Return pending immediately without waiting for LINE push
          lineNotification = { status: 'pending', deduplicated: false };

          // Decoupled background task updates line_guidelines_dispatches
          (async () => {
            let lineResult = { sent: true };
            if (mockLineDispatcher) {
              lineResult = await mockLineDispatcher({ booking, guidelinesConfig });
            }

            if (lineResult?.sent || lineResult?.ok || lineResult?.mocked) {
              await testDb.run(
                `UPDATE line_guidelines_dispatches SET status = 'sent', dispatched_at = CURRENT_TIMESTAMP WHERE line_user_id = ? AND rule_set = ? AND rule_version = ?`,
                [rawLineId, guidelinesConfig.rule_set, guidelinesConfig.rule_version]
              );
            } else {
              const errStr = String(lineResult?.error || 'dispatch_error');
              await testDb.run(
                `UPDATE line_guidelines_dispatches SET status = 'failed', error_message = ?, dispatched_at = CURRENT_TIMESTAMP WHERE line_user_id = ? AND rule_set = ? AND rule_version = ?`,
                [errStr, rawLineId, guidelinesConfig.rule_set, guidelinesConfig.rule_version]
              );
            }
          })().catch(() => {});
        }
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
      console.error('[Harness Error in acknowledge-rules]:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/public/bookings/:id/upload-slip
  app.post('/api/public/bookings/:id/upload-slip', async (req, res) => {
    try {
      const booking = await testDb.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
      if (!booking) return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
      if (!hasAccess(req, booking)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง' });

      // Precondition: Guidelines acknowledgement policy
      const items = await testDb.all(
        'SELECT bi.*, r.name as room_name FROM booking_items bi LEFT JOIN rooms r ON bi.room_id = r.id WHERE bi.booking_id = ?',
        [booking.id]
      );
      const guidelinesPolicy = resolveRoomGuidelines(items[0]?.room_id, items[0]?.room_name);

      const settingEnforce = await testDb.get("SELECT value FROM settings WHERE key = 'guidelines_enforcement_enabled'");
      const settingCutover = await testDb.get("SELECT value FROM settings WHERE key = 'guidelines_enforcement_cutover_at'");

      const guidelinesEnforced = isGuidelinesEnforcedForBooking({
        guidelinesPolicy,
        enforcementSetting: settingEnforce?.value,
        cutoverAt: settingCutover?.value,
        bookingCreatedAt: booking.created_at
      });

      if (guidelinesEnforced && !booking.guidelines_acknowledged_at) {
        return res.status(400).json({
          success: false,
          error: 'กรุณารับทราบข้อปฏิบัติการใช้ห้องประชุมก่อนส่งหลักฐานการชำระเงิน',
          code: 'GUIDELINES_NOT_ACKNOWLEDGED'
        });
      }

      // If passed, accept slip
      await testDb.run("UPDATE bookings SET payment_status = 'reviewing', slip_image_url = 'mock_slip.png' WHERE id = ?", [booking.id]);
      return res.json({ success: true, status: 'reviewing', auto_approved: false });
    } catch (e) {
      console.error('[Harness Error in acknowledge-rules]:', e);
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
    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(`http://127.0.0.1:${port}${url}`, fetchOptions);
    const json = await response.json().catch(() => null);
    return { status: response.status, body: json, headers: response.headers };
  } finally {
    server.close();
  }
}

// ========================================================
// 3. AUTOMATED INTEGRATION TESTS (TC01 - TC14)
// ========================================================

test('TC01: Meeting room first-time acknowledgement -> QR unlocked, LINE dispatched via atomic claim', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let lineDispatchedCount = 0;
  const app = createHarness(testDb, async ({ booking, guidelinesConfig }) => {
    lineDispatchedCount++;
    return { sent: true };
  });

  // Create booking in Room 301 (Mars) with server-confirmed LINE ID
  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, line_user_id_verified)
    VALUES ('Somchai', '0812345678', 800, 'tok_tc01', 'U11111111111111111111111111111111', 1)
  `);
  const bookingId = b.lastID;
  await testDb.run('INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, 4, 800, 800)', [bookingId]);

  // Acknowledge guidelines
  const res = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc01' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.acknowledged, true);
  assert.strictEqual(res.body.rule_set, 'meeting_room_201_306');
  assert.strictEqual(res.body.rule_version, 'v1');
  assert.strictEqual(res.body.line_notification.status, 'pending');
  assert.strictEqual(res.body.line_notification.deduplicated, false);
  assert.strictEqual(lineDispatchedCount, 1);

  // DB verification
  const bookingInDb = await testDb.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  assert.ok(bookingInDb.guidelines_acknowledged_at);
  assert.strictEqual(bookingInDb.guidelines_rule_set, 'meeting_room_201_306');

  const ackRow = await testDb.get('SELECT * FROM room_guidelines_acknowledgements WHERE booking_id = ?', [bookingId]);
  assert.ok(ackRow);
  assert.strictEqual(ackRow.rule_set, 'meeting_room_201_306');

  const lineRow = await testDb.get('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?', ['U11111111111111111111111111111111']);
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

  const lineUserId = 'U22222222222222222222222222222222';

  // Booking 1: Room 201 with server-confirmed LINE ID
  const b1 = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, line_user_id_verified)
    VALUES ('Wichai', '0899998888', 1200, 'tok_b1', ?, 1)
  `, [lineUserId]);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, 11, 1200, 1200)', [b1.lastID]);

  // Booking 2: Room 302 with server-confirmed LINE ID
  const b2 = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, line_user_id_verified)
    VALUES ('Wichai', '0899998888', 800, 'tok_b2', ?, 1)
  `, [lineUserId]);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, 5, 800, 800)', [b2.lastID]);

  // First booking acknowledges
  const r1 = await callApi(app, 'POST', `/api/public/bookings/${b1.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_b1' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r1.body.line_notification.status, 'pending');
  assert.strictEqual(lineDispatchedCount, 1);

  // Second booking acknowledges
  const r2 = await callApi(app, 'POST', `/api/public/bookings/${b2.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_b2' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.body.acknowledged, true);
  assert.strictEqual(r2.body.line_notification.status, 'already_sent');
  assert.strictEqual(r2.body.line_notification.deduplicated, true);
  assert.strictEqual(lineDispatchedCount, 1); // Not incremented!
});

test('TC03: First-time Jupiter Auditorium booking dispatches LINE for new rule set', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let sentMessages = [];
  const app = createHarness(testDb, async ({ guidelinesConfig }) => {
    sentMessages.push(guidelinesConfig.rule_set);
    return { sent: true };
  });

  const lineUserId = 'U33333333333333333333333333333333';

  // Booking 1: Meeting Room 301
  const b1 = await testDb.run('INSERT INTO bookings (qr_token, line_user_id, line_user_id_verified) VALUES (?, ?, 1)', ['tok_b1', lineUserId]);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [b1.lastID]);

  // Booking 2: Jupiter Auditorium (Room 10)
  const b2 = await testDb.run('INSERT INTO bookings (qr_token, line_user_id, line_user_id_verified) VALUES (?, ?, 1)', ['tok_b2', lineUserId]);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 10)', [b2.lastID]);

  await callApi(app, 'POST', `/api/public/bookings/${b1.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_b1' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  const resJupiter = await callApi(app, 'POST', `/api/public/bookings/${b2.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_b2' },
    body: { rule_set: 'jupiter_auditorium', rule_version: 'v1' }
  });

  assert.strictEqual(resJupiter.status, 200);
  assert.strictEqual(resJupiter.body.rule_set, 'jupiter_auditorium');
  assert.strictEqual(resJupiter.body.line_notification.status, 'pending');
  assert.strictEqual(sentMessages.length, 2);
  assert.deepStrictEqual(sentMessages, ['meeting_room_201_306', 'jupiter_auditorium']);
});

test('TC04: Bumped rule version (v2) re-dispatches LINE message', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let dispatches = 0;
  const app = createHarness(testDb, async () => {
    dispatches++;
    return { sent: true };
  });

  const lineUserId = 'U44444444444444444444444444444444';

  // Seed that user already received v1
  await testDb.run(`
    INSERT INTO line_guidelines_dispatches (line_user_id, rule_set, rule_version, status)
    VALUES (?, 'meeting_room_201_306', 'v1', 'sent')
  `, [lineUserId]);

  // Simulate policy bump to v2
  ROOM_GUIDELINES_CONFIG.meeting_room_201_306.rule_version = 'v2';

  try {
    const b = await testDb.run('INSERT INTO bookings (qr_token, line_user_id, line_user_id_verified) VALUES (?, ?, 1)', ['tok_v2', lineUserId]);
    await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [b.lastID]);

    const res = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
      headers: { 'X-Booking-Token': 'tok_v2' },
      body: { rule_set: 'meeting_room_201_306', rule_version: 'v2' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rule_version, 'v2');
    assert.strictEqual(res.body.line_notification.status, 'pending');
    assert.strictEqual(dispatches, 1);
  } finally {
    // Restore policy version
    ROOM_GUIDELINES_CONFIG.meeting_room_201_306.rule_version = 'v1';
  }
});

test('TC05: Page refresh (GET /api/public/bookings/:id) exposes stored acknowledgement state', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  const app = createHarness(testDb);
  const b = await testDb.run('INSERT INTO bookings (qr_token) VALUES (?)', ['tok_tc05']);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [b.lastID]);

  // 1. Initial GET -> unacknowledged
  const get1 = await callApi(app, 'GET', `/api/public/bookings/${b.lastID}`, {
    headers: { 'X-Booking-Token': 'tok_tc05' }
  });
  assert.strictEqual(get1.status, 200);
  assert.strictEqual(get1.body.guidelines_required, true);
  assert.strictEqual(get1.body.guidelines_acknowledged, false);

  // 2. Acknowledge
  await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc05' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  // 3. GET after reload -> guidelines_acknowledged: true
  const get2 = await callApi(app, 'GET', `/api/public/bookings/${b.lastID}`, {
    headers: { 'X-Booking-Token': 'tok_tc05' }
  });
  assert.strictEqual(get2.status, 200);
  assert.strictEqual(get2.body.guidelines_acknowledged, true);
  assert.ok(get2.body.guidelines_acknowledged_at);
});

test('TC06: Double submit / repeat acknowledge API is idempotent', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let callCount = 0;
  const app = createHarness(testDb, async () => {
    callCount++;
    return { sent: true };
  });

  const b = await testDb.run('INSERT INTO bookings (qr_token, line_user_id, line_user_id_verified) VALUES (?, ?, 1)', ['tok_tc06', 'U66666666666666666666666666666666']);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [b.lastID]);

  const r1 = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc06' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });
  const r2 = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc06' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r1.body.line_notification.status, 'pending');
  assert.strictEqual(r2.body.line_notification.status, 'already_sent');
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(callCount, 1);
});

test('TC07: Atomic claim prevents duplicate LINE sends on concurrent confirmation in two tabs', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let lineCallCount = 0;
  const app = createHarness(testDb, async () => {
    // Artificial small delay to simulate concurrent network arrival
    await new Promise(r => setTimeout(r, 20));
    lineCallCount++;
    return { sent: true };
  });

  const lineUserId = 'U77777777777777777777777777777777';
  const b = await testDb.run('INSERT INTO bookings (qr_token, line_user_id, line_user_id_verified) VALUES (?, ?, 1)', ['tok_tc07', lineUserId]);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [b.lastID]);

  // Two tabs confirm simultaneously
  const [resA, resB] = await Promise.all([
    callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
      headers: { 'X-Booking-Token': 'tok_tc07' },
      body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
    }),
    callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
      headers: { 'X-Booking-Token': 'tok_tc07' },
      body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
    })
  ]);

  assert.strictEqual(resA.status, 200);
  assert.strictEqual(resB.status, 200);
  assert.strictEqual(resA.body.acknowledged, true);
  assert.strictEqual(resB.body.acknowledged, true);

  const statuses = [resA.body.line_notification.status, resB.body.line_notification.status];
  assert.ok(statuses.includes('pending') && statuses.includes('already_sent'));

  // Exactly one call was dispatched! Atomic claim won exactly once
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(lineCallCount, 1);
});

test('TC08: Mismatched client rule_set / rule_version rejected with HTTP 400', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);
  const app = createHarness(testDb);

  const b = await testDb.run('INSERT INTO bookings (qr_token) VALUES (?)', ['tok_tc08']);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [b.lastID]); // Room 301

  // Client sends jupiter rule set for Room 301
  const resBadSet = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc08' },
    body: { rule_set: 'jupiter_auditorium', rule_version: 'v1' }
  });
  assert.strictEqual(resBadSet.status, 400);
  assert.ok(resBadSet.body.error.includes('ไม่ถูกต้อง') || resBadSet.body.error.includes('ไม่ตรงกับห้องที่จอง'));

  // Client sends wrong version
  const resBadVer = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc08' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v99' }
  });
  assert.strictEqual(resBadVer.status, 400);
  assert.ok(resBadVer.body.error.includes('ไม่ถูกต้อง') || resBadVer.body.error.includes('ไม่ตรงกับห้องที่จอง'));
});

test('TC09: Feature toggle OFF allows upload-slip; Feature toggle ON blocks unacknowledged', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);
  const app = createHarness(testDb);

  // Setting is default disabled ('false')
  const b = await testDb.run('INSERT INTO bookings (qr_token, created_at) VALUES (?, datetime("now"))', ['tok_tc09']);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [b.lastID]);

  // 1. With toggle OFF, upload-slip is permitted without acknowledgement!
  const slipOff = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_tc09' },
    body: { slip_image: 'mock_slip' }
  });
  assert.strictEqual(slipOff.status, 200);

  // 2. Reset payment status and enable enforcement toggle ('true')
  await testDb.run("UPDATE bookings SET payment_status = 'pending' WHERE id = ?", [b.lastID]);
  await testDb.run("UPDATE settings SET value = 'true' WHERE key = 'guidelines_enforcement_enabled'");

  const slipOn = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_tc09' },
    body: { slip_image: 'mock_slip' }
  });
  assert.strictEqual(slipOn.status, 400);
  assert.strictEqual(slipOn.body.code, 'GUIDELINES_NOT_ACKNOWLEDGED');

  // 3. Acknowledge -> Now upload-slip succeeds!
  await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc09' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  const slipAfterAck = await callApi(app, 'POST', `/api/public/bookings/${b.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_tc09' },
    body: { slip_image: 'mock_slip' }
  });
  assert.strictEqual(slipAfterAck.status, 200);
});

test('TC10: Legacy booking before cutover allows slip upload without blocking even when toggle ON', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);
  const app = createHarness(testDb);

  // Enable toggle but set cutover timestamp
  await testDb.run("UPDATE settings SET value = 'true' WHERE key = 'guidelines_enforcement_enabled'");
  await testDb.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('guidelines_enforcement_cutover_at', '2026-11-09T00:00:00Z')");

  // Legacy booking created prior to cutover
  const bLegacy = await testDb.run(`
    INSERT INTO bookings (customer_name, qr_token, created_at)
    VALUES ('Old Booking', 'tok_legacy', '2026-11-08 12:00:00')
  `);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [bLegacy.lastID]);

  const slipRes = await callApi(app, 'POST', `/api/public/bookings/${bLegacy.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_legacy' },
    body: { slip_image: 'mock_slip' }
  });

  assert.strictEqual(slipRes.status, 200);
  assert.strictEqual(slipRes.body.status, 'reviewing');
});

test('TC11: Exempt unmapped room (Co-working zone ID 13) bypasses gate immediately', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);
  const app = createHarness(testDb);

  await testDb.run("UPDATE settings SET value = 'true' WHERE key = 'guidelines_enforcement_enabled'");

  // Co-working zone ID 13
  const bCoworking = await testDb.run(`
    INSERT INTO bookings (customer_name, qr_token, created_at)
    VALUES ('Coworking User', 'tok_cowork', datetime('now'))
  `);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 13)', [bCoworking.lastID]);

  // GET exposes required: false, enforced: false
  const getRes = await callApi(app, 'GET', `/api/public/bookings/${bCoworking.lastID}`, {
    headers: { 'X-Booking-Token': 'tok_cowork' }
  });
  assert.strictEqual(getRes.status, 200);
  assert.strictEqual(getRes.body.guidelines_required, false);
  assert.strictEqual(getRes.body.guidelines_enforced, false);

  // Can upload slip without blocking
  const slipRes = await callApi(app, 'POST', `/api/public/bookings/${bCoworking.lastID}/upload-slip`, {
    headers: { 'X-Booking-Token': 'tok_cowork' },
    body: { slip_image: 'mock_slip' }
  });
  assert.strictEqual(slipRes.status, 200);
});

test('TC12: Customer without LINE or LINE dispatch failure does not block web payment flow', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  // App 1: No LINE ID
  const appNoLine = createHarness(testDb, async () => {
    throw new Error('Should not be called');
  });

  const bNoLine = await testDb.run('INSERT INTO bookings (qr_token, line_user_id) VALUES (?, NULL)', ['tok_noline']);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [bNoLine.lastID]);

  const res1 = await callApi(appNoLine, 'POST', `/api/public/bookings/${bNoLine.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_noline' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  assert.strictEqual(res1.status, 200);
  assert.strictEqual(res1.body.acknowledged, true);
  assert.strictEqual(res1.body.line_notification.status, 'skipped_no_line');

  // App 2: LINE Dispatch Fails
  const appLineFail = createHarness(testDb, async () => {
    return { sent: false, error: 'Network timeout connecting to LINE API' };
  });

  const bLineFail = await testDb.run('INSERT INTO bookings (qr_token, line_user_id, line_user_id_verified) VALUES (?, ?, 1)', ['tok_linefail', 'U88888888888888888888888888888888']);
  await testDb.run('INSERT INTO booking_items (booking_id, room_id) VALUES (?, 4)', [bLineFail.lastID]);

  const res2 = await callApi(appLineFail, 'POST', `/api/public/bookings/${bLineFail.lastID}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_linefail' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  // Web acknowledgement STILL succeeds immediately! Web response is decoupled from LINE dispatch
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(res2.body.acknowledged, true);
  assert.strictEqual(res2.body.line_notification.status, 'pending');

  // Background dispatch recorded failure in DB without blocking the web client
  await new Promise(r => setTimeout(r, 60));
  const failDispatch = await testDb.get('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?', ['U88888888888888888888888888888888']);
  assert.strictEqual(failDispatch.status, 'failed');
  assert.ok(failDispatch.error_message.includes('Network timeout'));
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

  const { initDatabase, dbQuery } = require('../database.js');
  await initDatabase();

  const { app } = require('../server.js');

  try {
    // 1. Find Room 301 from database
    const roomRow = await dbQuery.get("SELECT id, name FROM rooms WHERE name LIKE '%301%'");
    const targetRoomId = roomRow?.id || 5;

    const validSlip = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Create a test booking for Room 301 (with server-confirmed LINE ID)
    const bResult = await dbQuery.run(`
      INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, line_user_id_verified, created_at)
      VALUES ('Server E2E Customer', '0891234567', 1200, 'tok_srv_1', 'U_SRV_LINE_1', 1, datetime('now'))
    `);
    const bookingId = bResult.id || bResult.lastID;

    await dbQuery.run(`
      INSERT INTO booking_items (booking_id, room_id, price, subtotal)
      VALUES (?, ?, 1200, 1200)
    `, [bookingId, targetRoomId]);

    // 2. Call GET before acknowledgement (Toggle is default 'false' during release prep)
    const getRes1 = await callApi(app, 'GET', `/api/public/bookings/${bookingId}`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' }
    });
    assert.strictEqual(getRes1.status, 200);
    assert.strictEqual(getRes1.body.guidelines_required, true);
    assert.strictEqual(getRes1.body.guidelines_enforced, false);
    assert.strictEqual(getRes1.body.guidelines_acknowledged, false);

    // 3. With toggle OFF, upload-slip succeeds without blocking
    const slipResWhenOff = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/upload-slip`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' },
      body: { slip_image: validSlip }
    });
    assert.strictEqual(slipResWhenOff.status, 200);

    // 4. Now turn toggle ON ('true') and reset payment_status
    await dbQuery.run("UPDATE settings SET value = 'true' WHERE key = 'guidelines_enforcement_enabled'");
    await dbQuery.run("UPDATE settings SET value = 'true' WHERE key = 'line_guidelines_dispatch_enabled'");
    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('line_channel_access_token', 'mock_test_token')");
    await dbQuery.run("UPDATE bookings SET payment_status = 'pending', slip_image_url = NULL WHERE id = ?", [bookingId]);

    // Check GET again -> guidelines_enforced: true
    const getResEnforced = await callApi(app, 'GET', `/api/public/bookings/${bookingId}`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' }
    });
    assert.strictEqual(getResEnforced.body.guidelines_enforced, true);

    // 5. Call upload-slip before acknowledgement -> Rejected with 400
    const slipResFail = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/upload-slip`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' },
      body: { slip_image: validSlip }
    });
    assert.strictEqual(slipResFail.status, 400);
    assert.strictEqual(slipResFail.body.code, 'GUIDELINES_NOT_ACKNOWLEDGED');

    // 6. Acknowledge rules
    const ackRes = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/acknowledge-rules`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' },
      body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
    });
    assert.strictEqual(ackRes.status, 200);
    assert.strictEqual(ackRes.body.success, true);
    assert.strictEqual(ackRes.body.acknowledged, true);
    assert.strictEqual(ackRes.body.rule_set, 'meeting_room_201_306');
    assert.ok(ackRes.body.acknowledged_at);
    assert.strictEqual(ackRes.body.line_notification.status, 'skipped_decoupled_to_confirmation');

    // 7. Call GET after acknowledgement -> Exposed
    const getRes2 = await callApi(app, 'GET', `/api/public/bookings/${bookingId}`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' }
    });
    assert.strictEqual(getRes2.status, 200);
    assert.strictEqual(getRes2.body.guidelines_acknowledged, true);
    assert.strictEqual(getRes2.body.guidelines_acknowledged_at, ackRes.body.acknowledged_at);

    // 8. Call upload-slip after acknowledgement -> Allowed!
    const slipResOk = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/upload-slip`, {
      headers: { 'X-Booking-Token': 'tok_srv_1' },
      body: { slip_image: validSlip }
    });
    assert.strictEqual(slipResOk.status, 200);
    assert.strictEqual(slipResOk.body.status, 'reviewing');

    // 9. Verify DB tables
    const ackRows = await dbQuery.all('SELECT * FROM room_guidelines_acknowledgements WHERE booking_id = ?', [bookingId]);
    assert.strictEqual(ackRows.length, 1);
    assert.strictEqual(ackRows[0].rule_set, 'meeting_room_201_306');

    // In decoupled flow, acknowledging rules does NOT push guidelines before payment
    const lineRowsBeforePayment = await dbQuery.all('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?', ['U_SRV_LINE_1']);
    assert.strictEqual(lineRowsBeforePayment.length, 0);

    // After full payment, sendLineNotification attaches guidelines and claims dispatch
    await dbQuery.run("UPDATE bookings SET payment_status = 'paid', paid_amount = 1200, balance_amount = 0, slip_verify_status = 'approved' WHERE id = ?", [bookingId]);
    const { sendLineNotification } = require('../server');
    const lineRes = await sendLineNotification(bookingId);
    assert.strictEqual(lineRes.success, true);
    assert.strictEqual(lineRes.guidelinesAttached, true);

    const lineRowsAfterPayment = await dbQuery.all('SELECT * FROM line_guidelines_dispatches WHERE line_user_id = ?', ['U_SRV_LINE_1']);
    assert.strictEqual(lineRowsAfterPayment.length, 1);
    assert.strictEqual(lineRowsAfterPayment[0].rule_set, 'meeting_room_201_306');
  } finally {
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch (_) {}
    }
  }
});


test('TC13: Forged LINE ID token -> rejected as unverified LINE binding, 0 LINE push calls, booking acknowledged & payment unblocked', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let pushCalls = 0;
  const app = createHarness(testDb, async () => {
    pushCalls++;
    return { sent: true };
  });

  // Turn ON toggle
  await testDb.run("UPDATE settings SET value = 'true' WHERE key = 'line_guidelines_dispatch_enabled'");

  // Booking with unverified LINE account
  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, line_user_id_verified)
    VALUES ('Hacker', '0812345678', 800, 'tok_tc13', 'UFORGED_USER_13', 0)
  `);
  const bookingId = b.lastID;
  await testDb.run('INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, 4, 800, 800)', [bookingId]);

  // Client provides forged token
  const res = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/acknowledge-rules`, {
    headers: {
      'X-Booking-Token': 'tok_tc13',
      'X-Line-ID-Token': 'eyJhbGciOiJub25lIn0.eyJpc3MiOiJodHRwczovL2FjY2Vzcy5saW5lLm1lIiwic3ViIjoiVUZPUkdFRF9VU0VSXzEzIn0.'
    },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.acknowledged, true);
  assert.strictEqual(res.body.line_notification.status, 'skipped_unverified_line');

  // Push was NOT called
  assert.strictEqual(pushCalls, 0);
  const count = await testDb.get("SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UFORGED_USER_13'");
  assert.strictEqual(count.c, 0);
});

test('TC14: LINE guidelines dispatch toggle disabled (default-off) -> 0 LINE push calls even with verified LINE account, booking acknowledged', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let pushCalls = 0;
  const app = createHarness(testDb, async () => {
    pushCalls++;
    return { sent: true };
  });

  // Explicitly ensure toggle is disabled
  await testDb.run("UPDATE settings SET value = 'false' WHERE key = 'line_guidelines_dispatch_enabled'");

  // Booking with verified LINE account
  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, line_user_id_verified)
    VALUES ('Verified Customer', '0812345678', 800, 'tok_tc14', 'UVERIFIED_USER_14', 1)
  `);
  const bookingId = b.lastID;
  await testDb.run('INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, 4, 800, 800)', [bookingId]);

  const res = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc14' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.acknowledged, true);
  assert.strictEqual(res.body.line_notification.status, 'skipped_feature_disabled');

  // 0 push calls
  assert.strictEqual(pushCalls, 0);
  const count = await testDb.get("SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UVERIFIED_USER_14'");
  assert.strictEqual(count.c, 0);
});

test('TC15: Verified LINE account + toggle enabled -> exactly 1 push call; repeated acknowledge -> 0 extra push calls (deduplicated)', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let pushCalls = 0;
  const app = createHarness(testDb, async () => {
    pushCalls++;
    return { sent: true };
  });

  // Enable toggle
  await testDb.run("UPDATE settings SET value = 'true' WHERE key = 'line_guidelines_dispatch_enabled'");

  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, line_user_id_verified)
    VALUES ('Dedup Customer', '0812345678', 800, 'tok_tc15', 'UVERIFIED_USER_15', 1)
  `);
  const bookingId = b.lastID;
  await testDb.run('INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, 4, 800, 800)', [bookingId]);

  // 1st acknowledge
  const r1 = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc15' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r1.body.line_notification.status, 'pending');
  assert.strictEqual(r1.body.line_notification.deduplicated, false);
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(pushCalls, 1);

  // 2nd acknowledge (duplicate / repeated submit)
  const r2 = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc15' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.body.line_notification.status, 'already_sent');
  assert.strictEqual(r2.body.line_notification.deduplicated, true);

  // Push was NOT called again (deduplicated to exactly 1 call)
  assert.strictEqual(pushCalls, 1);
});

test('TC16: booking_source=walkin / pos without server verification -> rejected as unverified LINE binding, 0 LINE push calls', async () => {
  const testDb = createTestDb();
  await initSchema(testDb);

  let pushCalls = 0;
  const app = createHarness(testDb, async () => {
    pushCalls++;
    return { sent: true };
  });

  await testDb.run("UPDATE settings SET value = 'true' WHERE key = 'line_guidelines_dispatch_enabled'");

  // booking_source='walkin' but line_user_id_verified=0
  const b = await testDb.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, qr_token, line_user_id, line_user_id_verified, booking_source)
    VALUES ('Walkin Customer', '0812345678', 800, 'tok_tc16', 'UWALKIN_USER_16', 0, 'walkin')
  `);
  const bookingId = b.lastID;
  await testDb.run('INSERT INTO booking_items (booking_id, room_id, price, subtotal) VALUES (?, 4, 800, 800)', [bookingId]);

  const res = await callApi(app, 'POST', `/api/public/bookings/${bookingId}/acknowledge-rules`, {
    headers: { 'X-Booking-Token': 'tok_tc16' },
    body: { rule_set: 'meeting_room_201_306', rule_version: 'v1' }
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.acknowledged, true);
  assert.strictEqual(res.body.line_notification.status, 'skipped_unverified_line');

  // 0 push calls
  assert.strictEqual(pushCalls, 0);
  const count = await testDb.get("SELECT count(*) as c FROM line_guidelines_dispatches WHERE line_user_id = 'UWALKIN_USER_16'");
  assert.strictEqual(count.c, 0);
});

test('TC17: Official LINE Verify ID Token API mock test -> verifies sub and aud, rejects invalid tokens', async () => {
  const { verifyLineIdTokenWithLineApi } = require('../server.js');

  const oldFetch = globalThis.fetch;
  try {
    // 1. Mock fetch returning valid token payload matching channel ID
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.line.me/oauth2/v2.1/verify') {
        const bodyStr = String(options?.body || '');
        if (bodyStr.includes('id_token=valid.token.123')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              iss: 'https://access.line.me',
              sub: 'UVERIFIED_VIA_LINE_API_17',
              aud: '2011136579',
              exp: Math.floor(Date.now() / 1000) + 3600
            })
          };
        }
        if (bodyStr.includes('id_token=fake.token.456')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: 'invalid_request', error_description: 'Invalid ID token' })
          };
        }
      }
      return oldFetch(url, options);
    };

    // Valid token
    const verifiedUser = await verifyLineIdTokenWithLineApi({
      idToken: 'valid.token.123',
      channelId: '2011136579'
    });
    assert.strictEqual(verifiedUser, 'UVERIFIED_VIA_LINE_API_17');

    // Fake / forged token rejected
    const fakeUser = await verifyLineIdTokenWithLineApi({
      idToken: 'fake.token.456',
      channelId: '2011136579'
    });
    assert.strictEqual(fakeUser, null);

    // Completely bogus string rejected without calling API
    const bogusUser = await verifyLineIdTokenWithLineApi({
      idToken: 'not-even-a-jwt',
      channelId: '2011136579'
    });
    assert.strictEqual(bogusUser, null);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
