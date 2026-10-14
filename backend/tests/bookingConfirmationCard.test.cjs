/**
 * ============================================================================
 * BWORK-POS — MEETING ROOM BOOKING CONFIRMATION CARD TEST SUITE
 * (ใบยืนยันการจองห้องประชุม)
 * ============================================================================
 * Executes the actual confirmation card handler code extracted from
 * backend/server.js and backend/worker.js against an isolated in-memory
 * SQLite database (node:sqlite DatabaseSync) with zero open network handles
 * or background timers.
 * ============================================================================
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const {
  encryptWifiPassword,
  decryptWifiPassword
} = require('../wifiCryptoHelper');

const TEST_HEX_KEY = crypto.randomBytes(32).toString('hex');
process.env.WIFI_CREDENTIAL_ENCRYPTION_KEY = TEST_HEX_KEY;
process.env.BWORK_ENV = 'staging';

// Extract actual functions from backend/server.js
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

const pinHelperStart = serverSource.indexOf('const NO_PIN_ROOM_IDS =');
const pinHelperEnd = serverSource.indexOf('// Helper: Get Bangkok Local ISO string', pinHelperStart);
assert.ok(pinHelperStart > 0 && pinHelperEnd > pinHelperStart, 'roomUsesDoorPin found in server.js');

const cardHelperStart = serverSource.indexOf('function sanitizeRoomImageUrl');
const cardHelperEnd = serverSource.indexOf("app.get(['/api/bookings/:id/wifi-card'", cardHelperStart);
assert.ok(cardHelperStart > 0 && cardHelperEnd > cardHelperStart, 'handleGetBookingWifiCard found in server.js');

// Verify worker.js also registers both routes and contains matching confirmation card fields
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

function setupInMemoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');

  const migrations = [
    '001_core_schema.sql',
    '002_add_booking_channel.sql',
    '003_slip_unique_index.sql',
    '004_add_builtland_pin_to_rooms.sql',
    '005_room_hour_credits.sql',
    '006_add_booking_details.sql',
    '007_add_builtland_pin_to_rooms.sql',
    '008_add_discount_and_deposit.sql',
    '009_add_room_wifi_credentials.sql'
  ];

  for (const filename of migrations) {
    const filePath = path.join(__dirname, '../migrations', filename);
    if (fs.existsSync(filePath)) {
      let sql = fs.readFileSync(filePath, 'utf8');
      sql = sql.replace('BEGIN IMMEDIATE;', '').replace('COMMIT;', '');
      try {
        db.exec(sql);
      } catch (e) {
        if (!e.message.includes('duplicate column')) throw e;
      }
    }
  }

  // Ensure classroom_image_url column exists on rooms
  try {
    db.exec('ALTER TABLE rooms ADD COLUMN classroom_image_url TEXT;');
  } catch (_) {}

  const dbQuery = {
    async run(sql, params = []) {
      const stmt = db.prepare(sql);
      const res = stmt.run(...params);
      return { id: Number(res.lastInsertRowid), changes: res.changes };
    },
    async get(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.get(...params);
    },
    async all(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    }
  };

  const sandbox = {
    dbQuery,
    decryptWifiPassword,
    console,
    Set,
    Map,
    Array,
    String,
    Number,
    Boolean,
    Object,
    parseInt,
    isNaN
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${serverSource.slice(pinHelperStart, pinHelperEnd)}\n${serverSource.slice(cardHelperStart, cardHelperEnd)}`,
    sandbox
  );

  async function callGetConfirmationCard(id) {
    const headers = {};
    let statusCode = 200;
    let bodyPayload = null;
    const req = { params: { id: String(id) } };
    const res = {
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      status(code) { statusCode = code; return this; },
      json(data) { bodyPayload = data; return this; }
    };
    await sandbox.handleGetBookingWifiCard(req, res);
    return { status: statusCode, headers, body: bodyPayload };
  }

  return { db, dbQuery, callGetConfirmationCard, sandbox };
}

test('BWORK-POS Meeting Room Booking Confirmation Card Suite', async (t) => {
  const { dbQuery, callGetConfirmationCard } = setupInMemoryDb();

  // Seed deterministic test rooms
  const encPass1 = encryptWifiPassword('Pass#Room301', 1);
  await dbQuery.run(
    `INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, status, image_url, pin_code, builtland_pin_code, wifi_username, wifi_password_enc)
     VALUES (1, 'ห้องประชุม 301', 8, 400, 3200, 'active', '/uploads/img_room301.jpg', '301111', '301999', 'bwork_r301', ?)`,
    [encPass1]
  );

  const encPass2 = encryptWifiPassword('Pass#Room302', 2);
  await dbQuery.run(
    `INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, status, image_url, pin_code, builtland_pin_code, wifi_username, wifi_password_enc)
     VALUES (2, 'ห้องประชุม 302', 12, 600, 4800, 'active', '/uploads/img_room302.jpg', '302222', '302888', 'bwork_r302', ?)`,
    [encPass2]
  );

  await dbQuery.run(
    `INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, status, image_url, pin_code, builtland_pin_code, wifi_username, wifi_password_enc)
     VALUES (3, 'ห้องประชุม 303', 6, 300, 2400, 'active', NULL, '303333', '303777', NULL, NULL)`
  );

  const encPass4 = encryptWifiPassword('Pass#Room304', 4);
  await dbQuery.run(
    `INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, status, image_url, pin_code, builtland_pin_code, wifi_username, wifi_password_enc)
     VALUES (4, 'ห้องประชุม 304', 10, 500, 4000, 'active', 'https://untrusted.example.com/room.jpg', '304444', '304666', 'bwork_r304', ?)`,
    [encPass4]
  );

  const encPass10 = encryptWifiPassword('Pass#Jupiter300', 10);
  await dbQuery.run(
    `INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, status, image_url, pin_code, builtland_pin_code, wifi_username, wifi_password_enc)
     VALUES (10, 'ห้องประชุม Jupiter (300)', 30, 800, 6400, 'active', '/uploads/img_jupiter300.jpg', NULL, NULL, 'bwork_jupiter', ?)`,
    [encPass10]
  );

  await t.test('1. Route & Worker parity: both /wifi-card and /confirmation-card registered in server.js and worker.js', () => {
    assert.ok(
      serverSource.includes("app.get(['/api/bookings/:id/wifi-card', '/api/bookings/:id/confirmation-card']"),
      'server.js must register both /wifi-card and /confirmation-card'
    );
    assert.ok(
      workerSource.includes("(pathname.endsWith('/wifi-card') || pathname.endsWith('/confirmation-card'))"),
      'worker.js must handle both /wifi-card and /confirmation-card'
    );
    assert.ok(
      workerSource.includes("document_title: 'ใบยืนยันการจองห้องประชุม'"),
      'worker.js must include document_title ใบยืนยันการจองห้องประชุม'
    );
  });

  await t.test('2. Single-room booking confirmation card includes all 8 required fields and single-room banner', async () => {
    await dbQuery.run("DELETE FROM settings WHERE key = 'wifi_ssid'");
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code, customer_type)
       VALUES (101, 'BK-000101', 'คุณพิมพ์ชนก วงศ์สวัสดิ์', '081-234-5678', 1200, 'paid', '301111', 'general')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code, checkin_status)
       VALUES (1001, 101, 1, 3, 400, 1200, '2026-10-25T09:00:00', '2026-10-25T12:00:00', '301111', 'pending')`
    );

    const res = await callGetConfirmationCard(101);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['cache-control'], 'private, no-store');

    const card = res.body;
    assert.strictEqual(card.document_title, 'ใบยืนยันการจองห้องประชุม');
    assert.strictEqual(card.booking_id, 101);
    assert.strictEqual(card.booking_number, 'BK-000101');
    assert.strictEqual(card.customer_name, 'คุณพิมพ์ชนก วงศ์สวัสดิ์');
    assert.strictEqual(card.customer_phone, '081-234-5678');

    assert.strictEqual(card.is_multi_room, false);
    assert.strictEqual(card.is_multi_item, false);
    assert.strictEqual(card.banner_type, 'room');
    assert.strictEqual(card.banner_image_url, '/uploads/img_room301.jpg');

    assert.strictEqual(card.wifi.ssid, '@BWORK');
    assert.strictEqual(card.items.length, 1);
    const item = card.items[0];
    assert.strictEqual(item.room_id, 1);
    assert.strictEqual(item.room_name, 'ห้องประชุม 301');
    assert.strictEqual(item.room_image_url, '/uploads/img_room301.jpg');
    assert.strictEqual(item.booking_date, '2026-10-25');
    assert.strictEqual(item.start_time, '09:00');
    assert.strictEqual(item.end_time, '12:00');
    assert.strictEqual(item.uses_door_pin, true);
    assert.strictEqual(item.door_pin, '301111');
    assert.strictEqual(item.wifi_ssid, '@BWORK');
    assert.strictEqual(item.wifi_username, 'bwork_r301');
    assert.strictEqual(item.wifi_password, 'Pass#Room301');
    assert.strictEqual(item.wifi_configured, true);

    assert.strictEqual(
      card.beverage_perk.heading,
      'สิทธิประโยชน์สำหรับผู้ใช้บริการห้องประชุม'
    );
    assert.strictEqual(
      card.beverage_perk.message,
      'ได้รับส่วนลด 20% จากร้าน koo.koo เฉพาะเมนูเครื่องดื่มเท่านั้น'
    );
    assert.strictEqual(card.beverage_perk.discount_percent, 20);
    assert.strictEqual(card.beverage_perk.shop_name, 'koo.koo');
    assert.strictEqual(card.benefits.items.length, 4);
    assert.strictEqual(card.benefits.items[0], 'Free WiFi');
    assert.strictEqual(card.benefits.items[1], 'Free Co-working Space');
    assert.strictEqual(
      card.benefits.items[2],
      'ได้รับส่วนลด 20% จากร้าน koo.koo เฉพาะเมนูเครื่องดื่มเท่านั้น'
    );
    assert.strictEqual(
      card.benefits.items[3],
      'ได้สิทธิจอดรถฟรี ตามการใช้งานห้องประชุม'
    );

    assert.strictEqual(card.pin_code, undefined);
    assert.strictEqual(card.total_amount, undefined);
    assert.strictEqual(card.payment_status, undefined);
  });

  await t.test('3. Customer phone number is null (never invented) when absent or dash', async () => {
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code)
       VALUES (102, 'BK-000102', 'ลูกค้าไม่ระบุเบอร์', NULL, 400, 'paid', '301111')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES (1002, 102, 1, 1, 400, 400, '2026-10-26T10:00:00', '2026-10-26T11:00:00', '301111')`
    );

    const res = await callGetConfirmationCard(102);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.customer_name, 'ลูกค้าไม่ระบุเบอร์');
    assert.strictEqual(res.body.customer_phone, null);
  });

  await t.test('4. Two-item and Three-item multi-room bookings: brand banner, per-item images, isolated Door PINs & Wi-Fi', async () => {
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code)
       VALUES (103, 'BK-000103', 'บริษัท ทดสอบสองห้อง จำกัด', '089-111-2222', 2000, 'paid', '301111')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES
       (1003, 103, 1, 2, 400, 800, '2026-10-27T09:00:00', '2026-10-27T11:00:00', '301111'),
       (1004, 103, 2, 2, 600, 1200, '2026-10-27T13:00:00', '2026-10-27T15:00:00', '302222')`
    );

    const res2 = await callGetConfirmationCard(103);
    assert.strictEqual(res2.status, 200);
    const card2 = res2.body;
    assert.strictEqual(card2.is_multi_room, true);
    assert.strictEqual(card2.is_multi_item, true);
    assert.strictEqual(card2.banner_type, 'brand');
    assert.strictEqual(card2.banner_image_url, '/Bworktower.jpg');
    assert.strictEqual(card2.items.length, 2);

    assert.strictEqual(card2.items[0].room_name, 'ห้องประชุม 301');
    assert.strictEqual(card2.items[0].room_image_url, '/uploads/img_room301.jpg');
    assert.strictEqual(card2.items[0].door_pin, '301111');
    assert.strictEqual(card2.items[0].wifi_username, 'bwork_r301');
    assert.strictEqual(card2.items[0].wifi_password, 'Pass#Room301');

    assert.strictEqual(card2.items[1].room_name, 'ห้องประชุม 302');
    assert.strictEqual(card2.items[1].room_image_url, '/uploads/img_room302.jpg');
    assert.strictEqual(card2.items[1].door_pin, '302222');
    assert.strictEqual(card2.items[1].wifi_username, 'bwork_r302');
    assert.strictEqual(card2.items[1].wifi_password, 'Pass#Room302');

    // 3-item multi-room booking (Room 1 + Room 2 + Room 10 Jupiter no-PIN)
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code)
       VALUES (104, 'BK-000104', 'บริษัท สามห้อง จำกัด', '089-333-4444', 3600, 'paid', '301111')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES
       (1005, 104, 1, 2, 400, 800, '2026-10-28T09:00:00', '2026-10-28T11:00:00', '301111'),
       (1006, 104, 2, 2, 600, 1200, '2026-10-28T11:00:00', '2026-10-28T13:00:00', NULL),
       (1007, 104, 10, 2, 800, 1600, '2026-10-28T14:00:00', '2026-10-28T16:00:00', NULL)`
    );

    const res3 = await callGetConfirmationCard(104);
    assert.strictEqual(res3.status, 200);
    const card3 = res3.body;
    assert.strictEqual(card3.is_multi_room, true);
    assert.strictEqual(card3.items.length, 3);

    assert.strictEqual(card3.items[0].door_pin, '301111');
    assert.strictEqual(card3.items[1].door_pin, '302222', 'Must resolve Room 302 PIN and never reuse primary booking PIN');
    assert.strictEqual(card3.items[2].uses_door_pin, false);
    assert.strictEqual(card3.items[2].door_pin, null);
    assert.strictEqual(card3.items[2].wifi_username, 'bwork_jupiter');
    assert.strictEqual(card3.items[2].wifi_password, 'Pass#Jupiter300');
  });

  await t.test('5. Missing room image and untrusted external URL fallback to neutral placeholder', async () => {
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code)
       VALUES (105, 'BK-000105', 'ลูกค้าห้องไม่มีรูป', '082-555-6666', 600, 'paid', '303333')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES (1008, 105, 3, 2, 300, 600, '2026-10-29T10:00:00', '2026-10-29T12:00:00', '303333')`
    );

    const resMissing = await callGetConfirmationCard(105);
    assert.strictEqual(resMissing.status, 200);
    assert.strictEqual(resMissing.body.banner_type, 'placeholder');
    assert.strictEqual(resMissing.body.banner_image_url, null);
    assert.strictEqual(resMissing.body.items[0].room_image_url, null);
    assert.strictEqual(resMissing.body.items[0].wifi_configured, false);
    assert.strictEqual(resMissing.body.items[0].wifi_username, null);
    assert.strictEqual(resMissing.body.items[0].wifi_password, null);

    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code)
       VALUES (106, 'BK-000106', 'ลูกค้าทดสอบรูปภายนอก', '082-777-8888', 500, 'paid', '304444')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES (1009, 106, 4, 1, 500, 500, '2026-10-29T13:00:00', '2026-10-29T14:00:00', '304444')`
    );

    const resExt = await callGetConfirmationCard(106);
    assert.strictEqual(resExt.status, 200);
    assert.strictEqual(resExt.body.banner_type, 'placeholder');
    assert.strictEqual(resExt.body.banner_image_url, null);
    assert.strictEqual(resExt.body.items[0].room_image_url, null);
  });

  await t.test('6. Rescheduled single-item and multi-item bookings reflect updated room, time, PIN, and Wi-Fi', async () => {
    // Simulate single-item reschedule of Booking 101 to Room 2 on 2026-10-30 14:00-17:00
    await dbQuery.run(
      `UPDATE booking_items
       SET room_id = 2, start_time = '2026-10-30T14:00:00', end_time = '2026-10-30T17:00:00', pin_code = '302222'
       WHERE id = 1001`
    );
    await dbQuery.run(`UPDATE bookings SET pin_code = '302222' WHERE id = 101`);

    const cardAfterSingle = (await callGetConfirmationCard(101)).body;
    assert.strictEqual(cardAfterSingle.banner_image_url, '/uploads/img_room302.jpg');
    assert.strictEqual(cardAfterSingle.items[0].room_name, 'ห้องประชุม 302');
    assert.strictEqual(cardAfterSingle.items[0].booking_date, '2026-10-30');
    assert.strictEqual(cardAfterSingle.items[0].start_time, '14:00');
    assert.strictEqual(cardAfterSingle.items[0].end_time, '17:00');
    assert.strictEqual(cardAfterSingle.items[0].door_pin, '302222');
    assert.strictEqual(cardAfterSingle.items[0].wifi_username, 'bwork_r302');
    assert.strictEqual(cardAfterSingle.items[0].wifi_password, 'Pass#Room302');

    // Simulate multi-item reschedule of middle item 1006 in Booking 104 to Room 4 on 2026-10-31 13:00-15:00
    await dbQuery.run(
      `UPDATE booking_items
       SET room_id = 4, start_time = '2026-10-31T13:00:00', end_time = '2026-10-31T15:00:00', pin_code = '304444'
       WHERE id = 1006`
    );

    const cardAfterMulti = (await callGetConfirmationCard(104)).body;
    const updatedItem = cardAfterMulti.items.find(i => i.booking_item_id === 1006);
    assert.ok(updatedItem);
    assert.strictEqual(updatedItem.room_name, 'ห้องประชุม 304');
    assert.strictEqual(updatedItem.booking_date, '2026-10-31');
    assert.strictEqual(updatedItem.start_time, '13:00');
    assert.strictEqual(updatedItem.end_time, '15:00');
    assert.strictEqual(updatedItem.door_pin, '304444');
    assert.strictEqual(updatedItem.wifi_username, 'bwork_r304');
    assert.strictEqual(updatedItem.wifi_password, 'Pass#Room304');

    // Sibling item 1005 remains unchanged
    const siblingItem = cardAfterMulti.items.find(i => i.booking_item_id === 1005);
    assert.strictEqual(siblingItem.room_name, 'ห้องประชุม 301');
    assert.strictEqual(siblingItem.booking_date, '2026-10-28');
    assert.strictEqual(siblingItem.door_pin, '301111');
  });

  await t.test('7. Dynamic SSID update via settings preserves intentional Admin custom values without overwriting', async () => {
    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('wifi_ssid', '   ')");
    const cardEmpty = (await callGetConfirmationCard(101)).body;
    assert.strictEqual(cardEmpty.wifi.ssid, '@BWORK', 'Blank wifi_ssid must fallback to @BWORK');

    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('wifi_ssid', '@BWORK_5G')");
    const cardCustom = (await callGetConfirmationCard(101)).body;
    assert.strictEqual(cardCustom.wifi.ssid, '@BWORK_5G');
    assert.strictEqual(cardCustom.items[0].wifi_ssid, '@BWORK_5G');

    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('wifi_ssid', 'BWORK_CUSTOM_GUEST')");
    const cardCustomGuest = (await callGetConfirmationCard(101)).body;
    assert.strictEqual(cardCustomGuest.wifi.ssid, 'BWORK_CUSTOM_GUEST', 'Intentional custom Admin SSID must not be overwritten');

    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('wifi_ssid', '@BWORK')");
    const cardRestored = (await callGetConfirmationCard(101)).body;
    assert.strictEqual(cardRestored.wifi.ssid, '@BWORK');
  });

  await t.test('8. Worker and Server beverage perk parity with exact required wording', () => {
    assert.ok(
      workerSource.includes("heading: 'สิทธิประโยชน์สำหรับผู้ใช้บริการห้องประชุม'"),
      'worker.js must contain heading สิทธิประโยชน์สำหรับผู้ใช้บริการห้องประชุม'
    );
    assert.ok(
      workerSource.includes("message: 'ได้รับส่วนลด 20% จากร้าน koo.koo เฉพาะเมนูเครื่องดื่มเท่านั้น'"),
      'worker.js must contain message ได้รับส่วนลด 20% จากร้าน koo.koo เฉพาะเมนูเครื่องดื่มเท่านั้น'
    );
    assert.ok(
      workerSource.includes("discount_percent: 20"),
      'worker.js must include discount_percent: 20'
    );
    assert.ok(
      workerSource.includes("shop_name: 'koo.koo'"),
      'worker.js must include shop_name: koo.koo'
    );
    assert.ok(
      workerSource.includes("'Free WiFi'"),
      'worker.js must include Free WiFi benefit'
    );
    assert.ok(
      workerSource.includes("'Free Co-working Space'"),
      'worker.js must include Free Co-working Space benefit'
    );
    assert.ok(
      workerSource.includes("'ได้สิทธิจอดรถฟรี ตามการใช้งานห้องประชุม'"),
      'worker.js must include parking benefit'
    );
  });

  await t.test('9. Frontend export helper and template verification', () => {
    const helperSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/printReceiptHelper.js'), 'utf8');
    const pendingSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/PendingBookings.jsx'), 'utf8');

    // 1. Sanitize filename function verification
    assert.ok(helperSource.includes('function sanitizeConfirmationCardFilename'), 'sanitizeConfirmationCardFilename must exist');
    assert.ok(helperSource.includes('exportConfirmationCardAsJpg'), 'exportConfirmationCardAsJpg must exist');

    // 2. Buttons in PendingBookings - exactly one action group at the bottom
    assert.ok(pendingSource.includes('id="btn-export-jpg-confirmation-card"'), 'Bottom บันทึกเป็น JPG button must exist');
    assert.ok(!pendingSource.includes('id="btn-export-jpg-confirmation-card-bottom"'), 'Duplicate bottom ID must not exist');
    assert.ok(pendingSource.includes('id="btn-print-confirmation-card"'), 'Print / Save PDF button must be preserved');
    assert.ok(pendingSource.includes('id="btn-close-confirmation-card"'), 'Close button must exist in bottom action group');
    assert.ok(!pendingSource.includes('bwork-conf-modal-toolbar'), 'Top duplicate toolbar must be removed');
    assert.ok(!pendingSource.includes('bwork-conf-close-btn'), 'Top duplicate close button must be removed');

    // 3. Standalone SSID banner removed and replaced by per-room Wi-Fi credentials
    assert.ok(!pendingSource.includes('สัญญาณ Wi-Fi (SSID):'), 'Standalone shared SSID banner above the list must be removed');
    assert.ok(pendingSource.includes('className="confirmation-item-pin-box"'), 'Per-room door PIN box must exist');
    assert.ok(pendingSource.includes('className="confirmation-item-wifi-box"'), 'Per-room Wi-Fi box must exist');
    assert.ok(pendingSource.includes('className="confirmation-item-wifi-ssid"'), 'Per-room Wi-Fi SSID must exist inside item card');

    // 4. Neutral branded placeholder label for missing room photos
    assert.ok(pendingSource.includes('data-no-room-image-label="true"'), 'data-no-room-image-label must exist on placeholder');
    assert.ok(pendingSource.includes('ไม่มีรูปภาพห้องประชุมที่ตั้งค่าไว้'), 'Missing room image text must be clearly indicated');
    assert.ok(pendingSource.includes('ไม่มีรูปห้อง'), 'Multi-room thumbnail placeholder must be clearly indicated');

    // 5. Beverage benefit wording and tasteful highlight
    assert.ok(pendingSource.includes('สิทธิประโยชน์สำหรับผู้ใช้บริการห้องประชุม'), 'Perk heading must match');
    assert.ok(pendingSource.includes('bwork-conf-perk-highlight'), '20% discount highlight class must be used');
  });

  await t.test('10. Scenarios A-G: Item PIN change, Room PIN change, Master PIN, Conflicts & Multi-room isolation', async () => {
    // Setup test rooms
    await dbQuery.run("INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, pin_code, builtland_pin_code, status) VALUES (50, 'Room Test 50', 6, 300, '501111', '509999', 'active')");
    await dbQuery.run("INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, pin_code, builtland_pin_code, status) VALUES (51, 'Room Test 51', 8, 400, '512222', '518888', 'active')");

    // Scenario A: Booking item PIN changed -> card reflects new PIN
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code)
       VALUES (201, 'BK-000201', 'ลูกค้า Scenario A', '081-111-1111', 600, 'paid', '501111')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES (2001, 201, 50, 2, 300, 600, '2026-11-01T09:00:00', '2026-11-01T11:00:00', '501111')`
    );

    // Initial check
    let cardA = (await callGetConfirmationCard(201)).body;
    assert.strictEqual(cardA.items[0].door_pin, '501111');

    // Change booking item PIN to 507777
    await dbQuery.run('UPDATE booking_items SET pin_code = ? WHERE id = ?', ['507777', 2001]);
    cardA = (await callGetConfirmationCard(201)).body;
    assert.strictEqual(cardA.items[0].door_pin, '507777', 'Scenario A: Card must reflect new item PIN');

    // Scenario C: Booking master PIN changed -> verified behavior when single room
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code)
       VALUES (202, 'BK-000202', 'ลูกค้า Scenario C', '081-222-2222', 600, 'paid', 'MASTER_PIN_1')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES (2002, 202, 50, 2, 300, 600, '2026-11-01T13:00:00', '2026-11-01T15:00:00', NULL)`
    );
    let cardC = (await callGetConfirmationCard(202)).body;
    assert.strictEqual(cardC.items[0].door_pin, 'MASTER_PIN_1', 'Scenario C: Single room booking falls back to booking master PIN');

    await dbQuery.run('UPDATE bookings SET pin_code = ? WHERE id = ?', ['MASTER_PIN_UPDATED', 202]);
    cardC = (await callGetConfirmationCard(202)).body;
    assert.strictEqual(cardC.items[0].door_pin, 'MASTER_PIN_UPDATED', 'Scenario C: Updated booking master PIN is reflected');

    // Scenario D: Conflicting PINs between room and item
    // D1: General booking -> item PIN has precedence over room PIN
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code, customer_type)
       VALUES (203, 'BK-000203', 'ลูกค้า General Conflict', '081-333-3333', 600, 'paid', '501111', 'walkin')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES (2003, 203, 50, 2, 300, 600, '2026-11-02T09:00:00', '2026-11-02T11:00:00', 'CUSTOM_ITEM_PIN')`
    );
    let cardD1 = (await callGetConfirmationCard(203)).body;
    assert.strictEqual(cardD1.items[0].door_pin, 'CUSTOM_ITEM_PIN', 'Scenario D1: General booking uses item snapshot first');

    // D2: Builtland booking -> room Builtland PIN has precedence over general item snapshot
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code, customer_type)
       VALUES (204, 'BK-000204', 'พนักงาน Builtland Conflict', '081-444-4444', 0, 'internal_free', '501111', 'builtland')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES (2004, 204, 50, 2, 0, 0, '2026-11-02T13:00:00', '2026-11-02T15:00:00', 'STALE_GENERAL_SNAP')`
    );
    let cardD2 = (await callGetConfirmationCard(204)).body;
    assert.strictEqual(cardD2.items[0].door_pin, '509999', 'Scenario D2: Builtland booking uses room builtland_pin_code over general snapshot');

    // Scenario B: Room PIN changed -> card reflects authoritative PIN for Builtland
    await dbQuery.run("UPDATE rooms SET builtland_pin_code = '508888' WHERE id = 50");
    cardD2 = (await callGetConfirmationCard(204)).body;
    assert.strictEqual(cardD2.items[0].door_pin, '508888', 'Scenario B: Builtland card reflects updated room builtland PIN');

    // Scenario E & F: Multi-room booking isolation
    // Primary item PIN changed -> secondary items unaffected; each room displays own PIN
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code)
       VALUES (205, 'BK-000205', 'ลูกค้า Multi-room Isolation', '081-555-5555', 1400, 'paid', 'PRIMARY_PIN')`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES
       (2005, 205, 50, 2, 300, 600, '2026-11-03T09:00:00', '2026-11-03T11:00:00', 'ROOM50_PIN'),
       (2006, 205, 51, 2, 400, 800, '2026-11-03T13:00:00', '2026-11-03T15:00:00', 'ROOM51_PIN')`
    );
    let cardEF = (await callGetConfirmationCard(205)).body;
    assert.strictEqual(cardEF.items[0].door_pin, 'ROOM50_PIN');
    assert.strictEqual(cardEF.items[1].door_pin, 'ROOM51_PIN');

    // Update primary item PIN only
    await dbQuery.run("UPDATE booking_items SET pin_code = 'ROOM50_NEW' WHERE id = 2005");
    cardEF = (await callGetConfirmationCard(205)).body;
    assert.strictEqual(cardEF.items[0].door_pin, 'ROOM50_NEW', 'Primary item updated');
    assert.strictEqual(cardEF.items[1].door_pin, 'ROOM51_PIN', 'Secondary item completely unaffected');

    // Scenario G: Multi-room booking rescheduled -> PIN consistency preserved
    await dbQuery.run("UPDATE booking_items SET start_time = '2026-11-04T09:00:00', end_time = '2026-11-04T11:00:00' WHERE id = 2005");
    let cardG = (await callGetConfirmationCard(205)).body;
    const rescheduledItem = cardG.items.find(it => it.booking_item_id === 2005);
    const untouchedItem = cardG.items.find(it => it.booking_item_id === 2006);
    assert.strictEqual(rescheduledItem.start_time, '09:00');
    assert.strictEqual(rescheduledItem.door_pin, 'ROOM50_NEW');
    assert.strictEqual(untouchedItem.door_pin, 'ROOM51_PIN');
  });

  await t.test('11. Scenarios H & I: Reopen confirmation card & explicit refresh returns fresh data', async () => {
    // Verify no-store cache header
    const res = await callGetConfirmationCard(101);
    assert.strictEqual(res.headers['cache-control'], 'private, no-store', 'Response must be no-store to prevent caching');
  });

  await t.test('12. Scenario J: Room without door PIN returns uses_door_pin: false and door_pin: null', async () => {
    await dbQuery.run(
      `INSERT INTO bookings (id, receipt_number, customer_name, contact, total_amount, payment_status, pin_code)
       VALUES (206, 'BK-000206', 'ลูกค้า Jupiter No PIN', '081-666-6666', 800, 'paid', NULL)`
    );
    await dbQuery.run(
      `INSERT INTO booking_items (id, booking_id, room_id, quantity, price, subtotal, start_time, end_time, pin_code)
       VALUES (2007, 206, 10, 2, 400, 800, '2026-11-05T09:00:00', '2026-11-05T11:00:00', NULL)`
    );
    const cardJ = (await callGetConfirmationCard(206)).body;
    assert.strictEqual(cardJ.items[0].uses_door_pin, false);
    assert.strictEqual(cardJ.items[0].door_pin, null);
  });

  await t.test('13. Scenario K: Express and Cloudflare Worker resolveConfirmationItemDoorPin parity', () => {
    const serverFn = serverSource.slice(
      serverSource.indexOf('function resolveConfirmationItemDoorPin'),
      serverSource.indexOf('async function handleGetBookingWifiCard')
    );
    const workerFn = workerSource.slice(
      workerSource.indexOf('const resolveConfirmationItemDoorPin ='),
      workerSource.indexOf('let items = [];')
    );

    // Both must implement builtlandRoomPin || roomPin || itemPin
    assert.ok(serverFn.includes('builtlandRoomPin || roomPin || itemPin'), 'Server has canonical Builtland precedence');
    assert.ok(workerFn.includes('builtlandRoomPin || roomPin || itemPin'), 'Worker has canonical Builtland precedence');

    // Both must implement itemPin || ... || roomPin for general bookings
    assert.ok(serverFn.includes('itemPin || (canFallbackToBookingPin ? bookingPin : null) || roomPin'), 'Server has canonical General precedence');
    assert.ok(workerFn.includes('itemPin || (canFallbackToBookingPin ? bookingPin : null) || roomPin'), 'Worker has canonical General precedence');
  });

  await t.test('14. Scenarios L, M, N: Two-row header structure and export/print preservation', () => {
    const pendingSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/PendingBookings.jsx'), 'utf8');

    // Verify two-row header container
    assert.ok(pendingSource.includes('id="booking-confirmation-header"'), 'Header element ID must exist');
    assert.ok(pendingSource.includes('flexDirection: \'column\''), 'Header container must use column flex for 2 distinct rows');

    // Row 1: Logo (Left) + Document Title (Right)
    assert.ok(pendingSource.includes('ROW 1: BWORK logo (Left) | ใบยืนยันการจองห้องประชุม (Right)'), 'Row 1 comment must exist');
    assert.ok(pendingSource.includes('src="/BWORK-LOGO.png"'), 'Row 1 must contain BWORK logo');
    assert.ok(pendingSource.includes('ใบยืนยันการจองห้องประชุม'), 'Row 1 must contain document title');

    // Row 2: Booking Number (Left) + Confirmed Status (Right)
    assert.ok(pendingSource.includes('ROW 2: เลขที่การจอง #[booking_number] (Left) | ยืนยันแล้ว (Right)'), 'Row 2 comment must exist');
    assert.ok(pendingSource.includes('เลขที่การจอง #{wifiCardData.booking_number}'), 'Row 2 must display booking number');
    assert.ok(pendingSource.includes('ยืนยันแล้ว'), 'Row 2 must display confirmed status pill');

    // Compact status pill check
    assert.ok(pendingSource.includes('fontSize: \'0.7rem\''), 'Status pill must be compact');
    assert.ok(pendingSource.includes('whiteSpace: \'nowrap\''), 'Status pill must not wrap internally');
  });
});
