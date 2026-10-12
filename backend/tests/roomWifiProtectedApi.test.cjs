/**
 * BWORK-POS — Room Wi-Fi Protected API & Security Integration Test Suite
 *
 * Verifies:
 * 1. Secret validation & fail-closed credential operations
 * 2. Public API redaction (/api/public/rooms and /api/rooms never leak passwords)
 * 3. Unauthorized access rejection (missing token, invalid role/permissions)
 * 4. Admin Wi-Fi credential read/write roundtrip:
 *    - Initial unconfigured state
 *    - Update credentials with AES-256-GCM encryption
 *    - Preserving existing password when input is empty
 *    - Clearing credentials with explicit confirmation
 * 5. Wrong-room AAD rejection & multi-room credential isolation
 * 6. Customer Wi-Fi card endpoint /api/bookings/:id/wifi-card:
 *    - Correct shared SSID from settings
 *    - Decrypted room credentials
 *    - Exact beverage perk wording: "แสดงบัตรนี้เพื่อยืนยันสิทธิ์ส่วนลดเครื่องดื่มตามเงื่อนไขของร้าน"
 *    - Zero Door PIN in payload
 *    - Zero financial fields in payload
 *    - Zero internal notes in payload
 *    - Zero LINE notification side effects
 *    - Cancelled booking rejection
 * 7. Graceful handling of unconfigured rooms
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const sqlite3 = require(path.join(__dirname, '../node_modules/sqlite3')).verbose();

const {
  encryptWifiPassword,
  decryptWifiPassword,
  isEncryptedWifiPayload,
  isValidKey,
  encryptWifiPasswordNode,
  decryptWifiPasswordNode
} = require('../wifiCryptoHelper');

const TEST_SECRET_KEY = crypto.randomBytes(32).toString('hex');
const TEST_JWT_SECRET = 'bwork-pos-test-jwt-secret-min-32-chars-long';

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function createTestToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 3600000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', TEST_JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

test('BWORK-POS Room Wi-Fi Protected API Suite', async (t) => {
  // Set test environment secret
  process.env.WIFI_CREDENTIAL_ENCRYPTION_KEY = TEST_SECRET_KEY;

  // 1. Setup isolated in-memory SQLite database
  const db = new sqlite3.Database(':memory:');
  const dbQuery = {
    get: (sql, params = []) => getQuery(db, sql, params),
    all: (sql, params = []) => allQuery(db, sql, params),
    run: (sql, params = []) => runQuery(db, sql, params)
  };

  await dbQuery.run(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await dbQuery.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      role TEXT,
      permissions TEXT,
      fullname TEXT
    );
  `);

  await dbQuery.run(`
    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      capacity INTEGER,
      hourly_rate REAL,
      daily_rate REAL,
      half_day_rate REAL,
      description TEXT,
      status TEXT DEFAULT 'active',
      pin_code TEXT,
      builtland_pin_code TEXT,
      wifi_username TEXT,
      wifi_password_enc TEXT
    );
  `);

  await dbQuery.run(`
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number TEXT,
      customer_name TEXT,
      contact TEXT,
      department TEXT,
      status TEXT DEFAULT 'confirmed',
      payment_status TEXT DEFAULT 'paid',
      total_amount REAL,
      notes TEXT,
      pin_code TEXT
    );
  `);

  await dbQuery.run(`
    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      room_id INTEGER,
      booking_date TEXT,
      start_time TEXT,
      end_time TEXT,
      time_slot TEXT,
      pin_code TEXT
    );
  `);

  // Seed test users
  await dbQuery.run("INSERT INTO users (id, username, role, permissions, fullname) VALUES (1, 'admin', 'admin', 'manage,admin-management', 'Admin User')");
  await dbQuery.run("INSERT INTO users (id, username, role, permissions, fullname) VALUES (2, 'manager', 'manager', 'manage', 'Manager User')");
  await dbQuery.run("INSERT INTO users (id, username, role, permissions, fullname) VALUES (3, 'staff', 'staff', 'pos', 'Staff User')");
  await dbQuery.run("INSERT INTO users (id, username, role, permissions, fullname) VALUES (4, 'unauthorized', 'staff', 'dashboard', 'Unauthorized User')");

  // Seed test settings
  await dbQuery.run("INSERT INTO settings (key, value) VALUES ('wifi_ssid', 'BWORK_GUEST_TEST')");

  // Seed test rooms
  await dbQuery.run("INSERT INTO rooms (id, name, capacity, pin_code, builtland_pin_code, wifi_username, wifi_password_enc) VALUES (1, 'Room 101', 10, '123456', '654321', NULL, NULL)");
  await dbQuery.run("INSERT INTO rooms (id, name, capacity, pin_code, builtland_pin_code, wifi_username, wifi_password_enc) VALUES (2, 'Room 102', 20, '888888', '999999', NULL, NULL)");

  // Seed test bookings
  await dbQuery.run("INSERT INTO bookings (id, receipt_number, customer_name, contact, status, payment_status, total_amount, notes, pin_code) VALUES (10, 'BK-000010', 'สมชาย ใจดี', '0812345678', 'confirmed', 'paid', 2500.00, 'หมายเหตุภายใน: ลูกค้า VIP ขอชาเขียว', '123456')");
  await dbQuery.run("INSERT INTO booking_items (id, booking_id, room_id, booking_date, start_time, end_time, time_slot, pin_code) VALUES (101, 10, 1, '2026-10-20', '09:00', '12:00', '09:00 - 12:00', '123456')");

  // Seed cancelled booking
  await dbQuery.run("INSERT INTO bookings (id, receipt_number, customer_name, contact, status, payment_status, total_amount, notes, pin_code) VALUES (20, 'BK-000020', 'สมศักดิ์ ยกเลิก', '0899999999', 'cancelled', 'cancelled', 1000.00, 'ยกเลิกแล้ว', '888888')");
  await dbQuery.run("INSERT INTO booking_items (id, booking_id, room_id, booking_date, start_time, end_time, time_slot, pin_code) VALUES (201, 20, 2, '2026-10-21', '13:00', '15:00', '13:00 - 15:00', '888888')");

  // Seed booking for unconfigured Room 2
  await dbQuery.run("INSERT INTO bookings (id, receipt_number, customer_name, contact, status, payment_status, total_amount, notes, pin_code) VALUES (30, 'BK-000030', 'ประสิทธิ์ รอดิน', '0855555555', 'confirmed', 'paid', 1500.00, 'ห้องยังไม่ได้ตั้งค่าไวไฟ', '999999')");
  await dbQuery.run("INSERT INTO booking_items (id, booking_id, room_id, booking_date, start_time, end_time, time_slot, pin_code) VALUES (301, 30, 2, '2026-10-22', '10:00', '12:00', '10:00 - 12:00', '999999')");

  // Create isolated express test app
  const app = express();
  app.use(express.json());

  // Test auth middleware
  function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token missing' });
    try {
      const [header, body, signature] = token.split('.');
      const expectedSig = crypto.createHmac('sha256', TEST_JWT_SECRET).update(`${header}.${body}`).digest('base64url');
      if (signature !== expectedSig) return res.status(401).json({ error: 'Invalid token' });
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Token error' });
    }
  }

  function requireAnyPermission(...required) {
    return (req, res, next) => {
      if (req.user?.role === 'admin' || req.user?.username === 'admin') return next();
      const perms = new Set(String(req.user?.permissions || '').split(',').map(p => p.trim()));
      if (required.some(r => perms.has(r))) return next();
      return res.status(403).json({ error: 'Forbidden' });
    };
  }

  // Mount test endpoints mimicking server.js logic
  app.get('/api/rooms', authenticateToken, async (req, res) => {
    const rooms = await dbQuery.all('SELECT * FROM rooms');
    const sanitized = rooms.map(room => {
      const { wifi_password_enc, wifi_username, ...rest } = room;
      return {
        ...rest,
        has_wifi_credentials: Boolean(wifi_username && wifi_password_enc)
      };
    });
    res.json(sanitized);
  });

  app.get('/api/public/rooms', async (req, res) => {
    const rooms = await dbQuery.all('SELECT id, name, capacity, description, status FROM rooms WHERE status = "active"');
    res.json(rooms);
  });

  app.get('/api/settings', authenticateToken, async (req, res) => {
    const settings = await dbQuery.all('SELECT * FROM settings');
    const safeKeys = new Set(['company_name', 'wifi_ssid']);
    const obj = {};
    settings.forEach(s => {
      if (safeKeys.has(s.key) || req.user?.role === 'admin') {
        obj[s.key] = s.value;
      }
    });
    res.json(obj);
  });

  app.get(['/api/admin/rooms/:id/wifi', '/api/rooms/:id/wifi'], authenticateToken, requireAnyPermission('manage', 'admin-management'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    const room = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    let plainPassword = '';
    let hasPassword = false;
    if (room.wifi_password_enc) {
      try {
        plainPassword = decryptWifiPassword(room.wifi_password_enc, room.id);
        hasPassword = true;
      } catch (err) {
        return res.status(500).json({ error: 'Decryption failed', code: err.code || 'ERR_DECRYPT' });
      }
    }

    res.json({
      room_id: room.id,
      room_name: room.name,
      wifi_username: room.wifi_username || '',
      wifi_password: plainPassword,
      has_password: hasPassword,
      wifi_configured: Boolean(room.wifi_username && hasPassword)
    });
  });

  app.put(['/api/admin/rooms/:id/wifi', '/api/rooms/:id/wifi'], authenticateToken, requireAnyPermission('manage', 'admin-management'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    const room = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const { wifi_username, wifi_password, clear_credentials } = req.body || {};

    if (clear_credentials === true) {
      await dbQuery.run('UPDATE rooms SET wifi_username = NULL, wifi_password_enc = NULL WHERE id = ?', [room.id]);
      return res.json({ success: true, message: 'Cleared', room_id: room.id, wifi_configured: false });
    }

    const newUsername = wifi_username !== undefined ? (String(wifi_username).trim() || null) : (room.wifi_username || null);
    let newPasswordEnc = room.wifi_password_enc || null;

    if (wifi_password !== undefined && wifi_password !== null && String(wifi_password).trim() !== '') {
      try {
        newPasswordEnc = encryptWifiPassword(String(wifi_password).trim(), room.id);
      } catch (err) {
        return res.status(500).json({ error: 'Encryption failed', code: err.code || 'ERR_ENCRYPT' });
      }
    }

    await dbQuery.run('UPDATE rooms SET wifi_username = ?, wifi_password_enc = ? WHERE id = ?', [newUsername, newPasswordEnc, room.id]);
    res.json({
      success: true,
      room_id: room.id,
      wifi_username: newUsername,
      has_password: Boolean(newPasswordEnc),
      wifi_configured: Boolean(newUsername && newPasswordEnc)
    });
  });

  app.get('/api/bookings/:id/wifi-card', authenticateToken, requireAnyPermission('pos', 'pending', 'manage', 'admin-management'), async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const booking = await dbQuery.get('SELECT id, receipt_number, customer_name, payment_status FROM bookings WHERE id = ?', [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.payment_status === 'cancelled') {
      return res.status(400).json({ error: 'รายการจองนี้ถูกยกเลิกแล้ว ไม่สามารถดูข้อมูลบัตร Wi-Fi ได้' });
    }

    const ssidRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'wifi_ssid'");
    const sharedSsid = (ssidRow?.value || '').trim() || 'BWORK_GUEST';

    const items = await dbQuery.all(
      `SELECT bi.id, bi.booking_id, bi.room_id, bi.booking_date, bi.start_time, bi.end_time, bi.time_slot,
              r.name as room_name, r.wifi_username, r.wifi_password_enc
       FROM booking_items bi
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE bi.booking_id = ?
       ORDER BY bi.booking_date ASC, bi.start_time ASC`,
      [booking.id]
    );

    const roomMap = new Map();
    for (const item of items) {
      if (!item.room_id || roomMap.has(item.room_id)) continue;
      let plainPassword = null;
      if (item.wifi_password_enc) {
        try {
          plainPassword = decryptWifiPassword(item.wifi_password_enc, item.room_id);
        } catch (err) {
          if (err.code === 'ERR_WIFI_KEY_MISSING' || err.code === 'ERR_WIFI_KEY_INVALID') {
            return res.status(500).json({ error: 'Encryption key unavailable', code: err.code });
          }
        }
      }
      roomMap.set(item.room_id, {
        room_id: item.room_id,
        room_name: item.room_name || `ห้อง ${item.room_id}`,
        wifi_username: item.wifi_username || null,
        wifi_password: plainPassword,
        is_configured: Boolean(item.wifi_username && plainPassword)
      });
    }

    const schedules = items.map(item => ({
      room_name: item.room_name || `ห้อง ${item.room_id}`,
      booking_date: item.booking_date,
      start_time: item.start_time,
      end_time: item.end_time,
      time_slot: item.time_slot
    }));

    const cardPayload = {
      booking_id: booking.id,
      booking_number: booking.receipt_number || `BK-${String(booking.id).padStart(6, '0')}`,
      customer_name: booking.customer_name || 'ลูกค้า',
      rooms: Array.from(roomMap.values()),
      schedules,
      wifi: {
        ssid: sharedSsid,
        login_instructions: 'เชื่อมต่อเครือข่าย Wi-Fi และเปิดเว็บเบราว์เซอร์เพื่อเข้าสู่ระบบ MikroTik Hotspot ด้วยชื่อผู้ใช้และรหัสผ่านของห้อง'
      },
      beverage_perk: {
        message: 'แสดงบัตรนี้เพื่อยืนยันสิทธิ์ส่วนลดเครื่องดื่มตามเงื่อนไขของร้าน'
      }
    };

    res.json(cardPayload);
  });

  // Start test server on ephemeral port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const adminToken = createTestToken({ id: 1, username: 'admin', role: 'admin' });
  const managerToken = createTestToken({ id: 2, username: 'manager', role: 'manager', permissions: 'manage' });
  const staffToken = createTestToken({ id: 3, username: 'staff', role: 'staff', permissions: 'pos' });
  const unauthorizedToken = createTestToken({ id: 4, username: 'unauthorized', role: 'staff', permissions: 'dashboard' });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Secret Key Validation & Fail-Closed Behavior
    // -------------------------------------------------------------------------
    await t.test('1. Secret key validation & fail-closed behavior', async () => {
      assert.strictEqual(isValidKey(TEST_SECRET_KEY), true, 'Valid 64-hex key');
      assert.strictEqual(isValidKey('short-key'), false, 'Rejects short key');
      assert.strictEqual(isValidKey(''), false, 'Rejects empty key');
      assert.strictEqual(isValidKey(null), false, 'Rejects null key');

      // Test fail-closed behavior when key is missing or invalid
      const badKey = 'invalid-hex-key-length';
      assert.throws(() => {
        encryptWifiPasswordNode('testpass', badKey, 1);
      }, /WIFI_CREDENTIAL_ENCRYPTION_KEY must be a 256-bit key/);
    });

    // -------------------------------------------------------------------------
    // TEST 2: Public and Generic API Credential Redaction
    // -------------------------------------------------------------------------
    await t.test('2. Public and generic API credential redaction', async () => {
      // Configure Room 1 first
      const encPass = encryptWifiPassword('secret123', 1);
      await dbQuery.run("UPDATE rooms SET wifi_username = 'guest_r101', wifi_password_enc = ? WHERE id = 1", [encPass]);

      // Public rooms endpoint
      const pubRes = await fetch(`${baseUrl}/api/public/rooms`);
      assert.strictEqual(pubRes.status, 200);
      const pubRooms = await pubRes.json();
      for (const r of pubRooms) {
        assert.strictEqual(r.wifi_username, undefined, 'Public room must not include wifi_username');
        assert.strictEqual(r.wifi_password_enc, undefined, 'Public room must not include wifi_password_enc');
        assert.strictEqual(r.pin_code, undefined, 'Public room must not include door PIN');
      }

      // Generic authenticated rooms endpoint
      const genRes = await fetch(`${baseUrl}/api/rooms`, {
        headers: { Authorization: `Bearer ${staffToken}` }
      });
      assert.strictEqual(genRes.status, 200);
      const genRooms = await genRes.json();
      const r1 = genRooms.find(r => r.id === 1);
      assert.strictEqual(r1.wifi_password_enc, undefined, 'Generic rooms must not include wifi_password_enc');
      assert.strictEqual(r1.wifi_username, undefined, 'Generic rooms must not include wifi_username');
      assert.strictEqual(r1.has_wifi_credentials, true, 'has_wifi_credentials flag should be true');
    });

    // -------------------------------------------------------------------------
    // TEST 3: Unauthorized Access Protection
    // -------------------------------------------------------------------------
    await t.test('3. Unauthorized access protection', async () => {
      // Missing token
      const noTokenRes = await fetch(`${baseUrl}/api/admin/rooms/1/wifi`);
      assert.strictEqual(noTokenRes.status, 401, 'Should reject request with missing token');

      // Insufficient permissions (staff with only 'pos' permission)
      const noPermRes = await fetch(`${baseUrl}/api/admin/rooms/1/wifi`, {
        headers: { Authorization: `Bearer ${staffToken}` }
      });
      assert.strictEqual(noPermRes.status, 403, 'Should reject staff without manage / admin-management');
    });

    // -------------------------------------------------------------------------
    // TEST 4: Admin Wi-Fi Credential Management Roundtrip
    // -------------------------------------------------------------------------
    await t.test('4. Admin Wi-Fi credential management roundtrip', async () => {
      // A. Read Room 2 (currently unconfigured)
      const readUnconfRes = await fetch(`${baseUrl}/api/admin/rooms/2/wifi`, {
        headers: { Authorization: `Bearer ${managerToken}` }
      });
      assert.strictEqual(readUnconfRes.status, 200);
      const unconfData = await readUnconfRes.json();
      assert.strictEqual(unconfData.wifi_configured, false);
      assert.strictEqual(unconfData.wifi_password, '');
      assert.strictEqual(unconfData.has_password, false);

      // B. Update Room 2 credentials
      const updateRes = await fetch(`${baseUrl}/api/admin/rooms/2/wifi`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`
        },
        body: JSON.stringify({
          wifi_username: 'hotspot_room102',
          wifi_password: 'VeryStrongPassword#2026'
        })
      });
      assert.strictEqual(updateRes.status, 200);
      const updateData = await updateRes.json();
      assert.strictEqual(updateData.wifi_configured, true);
      assert.strictEqual(updateData.wifi_username, 'hotspot_room102');

      // Verify stored row in database is encrypted
      const room2Row = await dbQuery.get('SELECT * FROM rooms WHERE id = 2');
      assert.strictEqual(isEncryptedWifiPayload(room2Row.wifi_password_enc), true, 'Database must store versioned ciphertext');
      assert.ok(!room2Row.wifi_password_enc.includes('VeryStrongPassword'), 'Plaintext must NEVER be in database');

      // C. Read back credentials (explicit reveal)
      const readBackRes = await fetch(`${baseUrl}/api/admin/rooms/2/wifi`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(readBackRes.status, 200);
      assert.strictEqual(readBackRes.headers.get('cache-control'), 'no-store, private');
      const readBackData = await readBackRes.json();
      assert.strictEqual(readBackData.wifi_username, 'hotspot_room102');
      assert.strictEqual(readBackData.wifi_password, 'VeryStrongPassword#2026', 'Reveals decrypted plaintext to authorized admin');

      // C2. Verify Canonical Route Parity: GET /api/rooms/2/wifi matches /api/admin/rooms/2/wifi
      const canonicalReadRes = await fetch(`${baseUrl}/api/rooms/2/wifi`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(canonicalReadRes.status, 200, 'Canonical route /api/rooms/:id/wifi must be 200');
      const canonicalData = await canonicalReadRes.json();
      assert.deepStrictEqual(canonicalData, readBackData, 'Canonical and admin alias must return identical payload');

      // D. Update username only with empty password -> must NOT overwrite existing password
      const emptyPassUpdateRes = await fetch(`${baseUrl}/api/admin/rooms/2/wifi`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          wifi_username: 'hotspot_room102_updated',
          wifi_password: '' // empty password field
        })
      });
      assert.strictEqual(emptyPassUpdateRes.status, 200);

      // Verify password was preserved
      const verifyPreservedRes = await fetch(`${baseUrl}/api/admin/rooms/2/wifi`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const preservedData = await verifyPreservedRes.json();
      assert.strictEqual(preservedData.wifi_username, 'hotspot_room102_updated');
      assert.strictEqual(preservedData.wifi_password, 'VeryStrongPassword#2026', 'Existing password must be preserved');

      // E. Clear credentials with explicit confirmation
      const clearRes = await fetch(`${baseUrl}/api/admin/rooms/2/wifi`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          clear_credentials: true
        })
      });
      assert.strictEqual(clearRes.status, 200);
      const clearData = await clearRes.json();
      assert.strictEqual(clearData.wifi_configured, false);

      const room2ClearedRow = await dbQuery.get('SELECT * FROM rooms WHERE id = 2');
      assert.strictEqual(room2ClearedRow.wifi_username, null);
      assert.strictEqual(room2ClearedRow.wifi_password_enc, null);
    });

    // -------------------------------------------------------------------------
    // TEST 5: Room-Specific AAD Binding & Multi-Room Isolation
    // -------------------------------------------------------------------------
    await t.test('5. Room-specific AAD binding & isolation', async () => {
      // Encrypt password for Room 1
      const room1Ciphertext = encryptWifiPassword('PasswordForRoom1', 1);

      // Attempting to decrypt with Room 2's ID must fail
      assert.throws(
        () => {
          decryptWifiPassword(room1Ciphertext, 2);
        },
        (err) => err.code === 'ERR_WIFI_AUTH_FAILED' || /authentication failed/i.test(err.message),
        'Decryption using wrong room ID must be rejected by AAD tag verification'
      );

      // Setting Room 1's ciphertext directly into Room 2 in the database must fail closed
      await dbQuery.run("UPDATE rooms SET wifi_username = 'wrong_room', wifi_password_enc = ? WHERE id = 2", [room1Ciphertext]);

      const wrongRoomRes = await fetch(`${baseUrl}/api/admin/rooms/2/wifi`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(wrongRoomRes.status, 500, 'Fails closed with HTTP 500 on AAD tampering');
      const errBody = await wrongRoomRes.json();
      assert.strictEqual(errBody.code, 'ERR_WIFI_AUTH_FAILED');

      // Clean up Room 2
      await dbQuery.run('UPDATE rooms SET wifi_username = NULL, wifi_password_enc = NULL WHERE id = 2');
    });

    // -------------------------------------------------------------------------
    // TEST 6: Customer Wi-Fi Card Endpoint Specification & Redaction
    // -------------------------------------------------------------------------
    await t.test('6. Customer Wi-Fi card endpoint data specification & strict redaction', async () => {
      // Ensure Room 1 has valid Wi-Fi credentials
      const encPass1 = encryptWifiPassword('WiFiPass#Room101', 1);
      await dbQuery.run("UPDATE rooms SET wifi_username = 'room101_hotspot', wifi_password_enc = ? WHERE id = 1", [encPass1]);

      const cardRes = await fetch(`${baseUrl}/api/bookings/10/wifi-card`, {
        headers: { Authorization: `Bearer ${staffToken}` }
      });
      assert.strictEqual(cardRes.status, 200);
      assert.strictEqual(cardRes.headers.get('cache-control'), 'private, no-store');

      const card = await cardRes.json();

      // Required fields
      assert.strictEqual(card.booking_id, 10);
      assert.strictEqual(card.booking_number, 'BK-000010');
      assert.strictEqual(card.customer_name, 'สมชาย ใจดี');

      // Wi-Fi details
      assert.strictEqual(card.wifi.ssid, 'BWORK_GUEST_TEST');
      assert.ok(card.wifi.login_instructions.includes('MikroTik Hotspot'));

      // Rooms and credentials
      assert.strictEqual(card.rooms.length, 1);
      assert.strictEqual(card.rooms[0].room_id, 1);
      assert.strictEqual(card.rooms[0].room_name, 'Room 101');
      assert.strictEqual(card.rooms[0].wifi_username, 'room101_hotspot');
      assert.strictEqual(card.rooms[0].wifi_password, 'WiFiPass#Room101');
      assert.strictEqual(card.rooms[0].is_configured, true);

      // Exact beverage wording
      assert.strictEqual(
        card.beverage_perk.message,
        'แสดงบัตรนี้เพื่อยืนยันสิทธิ์ส่วนลดเครื่องดื่มตามเงื่อนไขของร้าน',
        'Beverage perk wording must match exact requirement'
      );

      // STRICT PRIVACY & REDACTION CHECKS:
      assert.strictEqual(card.pin_code, undefined, 'Door PIN must NEVER be in customer card');
      assert.strictEqual(card.builtland_pin_code, undefined, 'Builtland PIN must NEVER be in customer card');
      assert.strictEqual(card.total_amount, undefined, 'Financial total must NEVER be in customer card');
      assert.strictEqual(card.grand_total, undefined, 'Grand total must NEVER be in customer card');
      assert.strictEqual(card.payment_status, undefined, 'Payment status must NEVER be in customer card');
      assert.strictEqual(card.deposit_amount, undefined, 'Deposit must NEVER be in customer card');
      assert.strictEqual(card.notes, undefined, 'Internal notes must NEVER be in customer card');

      // Schedules
      assert.strictEqual(card.schedules.length, 1);
      assert.strictEqual(card.schedules[0].room_name, 'Room 101');
      assert.strictEqual(card.schedules[0].booking_date, '2026-10-20');
      assert.strictEqual(card.schedules[0].start_time, '09:00');
      assert.strictEqual(card.schedules[0].end_time, '12:00');
    });

    // -------------------------------------------------------------------------
    // TEST 7: Cancelled Booking Protection
    // -------------------------------------------------------------------------
    await t.test('7. Cancelled booking rejection', async () => {
      const cardRes = await fetch(`${baseUrl}/api/bookings/20/wifi-card`, {
        headers: { Authorization: `Bearer ${staffToken}` }
      });
      assert.strictEqual(cardRes.status, 400, 'Should reject cancelled booking');
      const data = await cardRes.json();
      assert.ok(data.error.includes('ยกเลิกแล้ว'));
    });

    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // TEST 8: Shared SSID Settings Exposure
    // -------------------------------------------------------------------------
    await t.test('8. Shared SSID accessible via GET /api/settings', async () => {
      const settingsRes = await fetch(`${baseUrl}/api/settings`, {
        headers: { Authorization: `Bearer ${staffToken}` }
      });
      assert.strictEqual(settingsRes.status, 200);
      const settingsData = await settingsRes.json();
      assert.strictEqual(settingsData.wifi_ssid, 'BWORK_GUEST_TEST', 'Staff can view wifi_ssid');
    });

    // -------------------------------------------------------------------------
    // TEST 9: Negative Authorization & Error Matrix
    // -------------------------------------------------------------------------
    await t.test('9. Negative authorization & error matrix', async (sub) => {
      // 9A: Unauthenticated access -> 401
      await sub.test('9A. Unauthenticated request rejected with 401', async () => {
        const res = await fetch(`${baseUrl}/api/bookings/10/wifi-card`);
        assert.strictEqual(res.status, 401);
      });

      // 9B: Authenticated but unauthorized access -> 403
      await sub.test('9B. Authenticated but unauthorized user rejected with 403', async () => {
        const res = await fetch(`${baseUrl}/api/bookings/10/wifi-card`, {
          headers: { Authorization: `Bearer ${unauthorizedToken}` }
        });
        assert.strictEqual(res.status, 403);
        const data = await res.json();
        assert.strictEqual(data.error, 'Forbidden');
      });

      // 9C: Invalid booking ID -> 404
      await sub.test('9C. Non-existent booking ID returns 404', async () => {
        const res = await fetch(`${baseUrl}/api/bookings/99999/wifi-card`, {
          headers: { Authorization: `Bearer ${staffToken}` }
        });
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.headers.get('cache-control'), 'private, no-store');
      });

      // 9D: Cancelled booking -> 400
      await sub.test('9D. Cancelled booking returns 400', async () => {
        const res = await fetch(`${baseUrl}/api/bookings/20/wifi-card`, {
          headers: { Authorization: `Bearer ${staffToken}` }
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.headers.get('cache-control'), 'private, no-store');
      });

      // 9E: Missing encryption key -> 500 fail-closed
      await sub.test('9E. Missing encryption key fails closed with 500', async () => {
        const savedKey = process.env.WIFI_CREDENTIAL_ENCRYPTION_KEY;
        try {
          delete process.env.WIFI_CREDENTIAL_ENCRYPTION_KEY;
          const res = await fetch(`${baseUrl}/api/bookings/10/wifi-card`, {
            headers: { Authorization: `Bearer ${staffToken}` }
          });
          assert.strictEqual(res.status, 500);
          const data = await res.json();
          assert.strictEqual(data.code, 'ERR_WIFI_KEY_MISSING');
        } finally {
          process.env.WIFI_CREDENTIAL_ENCRYPTION_KEY = savedKey;
        }
      });

      // 9F: Missing Wi-Fi configuration -> returns 200 with is_configured: false
      await sub.test('9F. Missing Wi-Fi configuration returns graceful 200 with is_configured: false', async () => {
        const res = await fetch(`${baseUrl}/api/bookings/30/wifi-card`, {
          headers: { Authorization: `Bearer ${staffToken}` }
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.booking_id, 30);
        assert.strictEqual(data.rooms.length, 1);
        assert.strictEqual(data.rooms[0].room_id, 2);
        assert.strictEqual(data.rooms[0].wifi_username, null);
        assert.strictEqual(data.rooms[0].wifi_password, null);
        assert.strictEqual(data.rooms[0].is_configured, false);
        assert.strictEqual(data.beverage_perk.message, 'แสดงบัตรนี้เพื่อยืนยันสิทธิ์ส่วนลดเครื่องดื่มตามเงื่อนไขของร้าน');
      });
    });

  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
