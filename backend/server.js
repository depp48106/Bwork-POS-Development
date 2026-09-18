const express = require('express');
const { verifySlip, commitVerifiedSlip, decodeMiniQR } = require('./slipVerifier');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { initDatabase, dbQuery, dbPath, hashPassword, verifyPassword } = require('./database');
const { performBackup } = require('./backup');
const {
  generateDatabaseDumpSql,
  getOneDriveAuthUrl,
  exchangeOneDriveCode,
  refreshOneDriveAccessToken,
  uploadSqlToOneDrive
} = require('./onedrive');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = 8 * 60 * 60 * 1000; // 8 hours

if (!process.env.JWT_SECRET) {
  console.warn('[Security] JWT_SECRET is not configured. Using a temporary secret; sessions will reset when the server restarts.');
}

// Simple JWT implementation using crypto (no external dependency needed)
function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + JWT_EXPIRY })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  try {
    const [header, body, signature] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (signature !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Authentication middleware
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ (Token not provided)' });
  }
  const tokenUser = verifyToken(token);
  if (!tokenUser) {
    return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
  try {
    const user = await dbQuery.get(
      `SELECT u.id, u.username, u.role, COALESCE(u.permissions, r.permissions, '') AS permissions, u.fullname
       FROM users u
       LEFT JOIN roles r ON u.role = r.name
       WHERE u.id = ?`,
      [tokenUser.id]
    );
    if (!user) {
      return res.status(401).json({ error: 'ไม่พบผู้ใช้นี้ในระบบ กรุณาเข้าสู่ระบบใหม่' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถตรวจสอบสิทธิ์ผู้ใช้ได้' });
  }
}

function requireAnyPermission(...requiredPermissions) {
  return (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.username === 'admin')) {
      return next();
    }
    const permissions = new Set(String(req.user?.permissions || '').split(',').map(p => p.trim()).filter(Boolean));
    if (requiredPermissions.some(permission => permissions.has(permission))) {
      return next();
    }
    return res.status(403).json({ error: 'ไม่มีสิทธิ์ดำเนินการนี้' });
  };
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static frontend in production
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Initialize database before starting server
initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
});

// ==========================================
// 1. AUTHENTICATION ENDPOINTS
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }

  try {
    const user = await dbQuery.get(
      `SELECT u.id, u.username, u.password_hash, u.role, COALESCE(u.permissions, r.permissions, '') as permissions, u.fullname
       FROM users u
       LEFT JOIN roles r ON u.role = r.name
       WHERE u.username = ?`,
      [username]
    );

    if (user && verifyPassword(password, user.password_hash)) {
      if (!user.password_hash.startsWith('scrypt$')) {
        await dbQuery.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), user.id]);
      }
      const token = createToken({ id: user.id, username: user.username, role: user.role, permissions: user.permissions, fullname: user.fullname });
      res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role, permissions: user.permissions, fullname: user.fullname } });
    } else {
      res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาดของระบบ: ' + err.message });
  }
});

// Quick Cashier Login with PIN Code (Supports Scrypt-hashed PINs with auto-upgrade)
app.post('/api/auth/login-pin', async (req, res) => {
  const { pin_code } = req.body;
  if (!pin_code) {
    return res.status(400).json({ error: 'กรุณากรอกรหัส PIN 4-6 หลัก' });
  }

  try {
    const inputPin = String(pin_code).trim();
    const users = await dbQuery.all(
      `SELECT u.id, u.username, u.role, COALESCE(u.permissions, r.permissions, '') as permissions, u.fullname, u.pin_code
       FROM users u
       LEFT JOIN roles r ON u.role = r.name
       WHERE u.pin_code IS NOT NULL AND u.pin_code != ''`
    );

    let matchedUser = null;
    for (const u of users) {
      if (u.pin_code.startsWith('scrypt$') || u.pin_code.length === 64) {
        if (verifyPassword(inputPin, u.pin_code)) {
          matchedUser = u;
          break;
        }
      } else if (u.pin_code === inputPin) {
        matchedUser = u;
        // Auto-upgrade plain PIN to secure Scrypt hash
        await dbQuery.run('UPDATE users SET pin_code = ? WHERE id = ?', [hashPassword(inputPin), u.id]);
        break;
      }
    }

    if (matchedUser) {
      const token = createToken({ id: matchedUser.id, username: matchedUser.username, role: matchedUser.role, permissions: matchedUser.permissions, fullname: matchedUser.fullname });
      res.json({ success: true, token, user: { id: matchedUser.id, username: matchedUser.username, role: matchedUser.role, permissions: matchedUser.permissions, fullname: matchedUser.fullname } });
    } else {
      res.status(401).json({ error: 'รหัส PIN ไม่ถูกต้อง หรือยังไม่ได้ตั้งค่า PIN ให้ผู้ใช้นี้' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify current session & get fresh user profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await dbQuery.get(
      `SELECT u.id, u.username, u.role, COALESCE(u.permissions, r.permissions, '') as permissions, u.fullname
       FROM users u
       LEFT JOIN roles r ON u.role = r.name
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (!user) {
      return res.status(401).json({ error: 'ไม่พบข้อมูลผู้ใช้นี้ในระบบ' });
    }

    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, permissions: user.permissions, fullname: user.fullname } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Silent Token Refresh / Sliding Session endpoint
app.post('/api/auth/refresh', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const newToken = createToken({
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      fullname: user.fullname
    });
    res.json({
      success: true,
      token: newToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: user.permissions,
        fullname: user.fullname
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถต่ออายุเซสชันได้: ' + err.message });
  }
});

// Apply authentication to all non-public API routes
app.use('/api/rooms', authenticateToken);
app.use('/api/services', authenticateToken);
app.use('/api/categories', authenticateToken);
app.use('/api/bookings', authenticateToken, requireAnyPermission('pos', 'pending', 'layout', 'history'));
app.use('/api/users', authenticateToken, requireAnyPermission('admin-management', 'admin-users'));
app.use('/api/roles', authenticateToken, requireAnyPermission('admin-management', 'admin-users'));
app.use('/api/settings', authenticateToken);
app.use('/api/dashboard', authenticateToken, requireAnyPermission('dashboard'));
app.use('/api/quotations', authenticateToken, requireAnyPermission('quotations'));
app.use('/api/upload', authenticateToken, requireAnyPermission('manage', 'admin-management', 'admin-system', 'admin-quotation'));
app.use('/api/backup', authenticateToken, requireAnyPermission('admin-management', 'admin-backup'));
app.use('/api/admin', authenticateToken, requireAnyPermission('admin-management', 'admin-backup'));
app.use('/api/basecamp', authenticateToken, requireAnyPermission('pos', 'manage'));
const { createHourCreditService } = require('./hourCredits/service');
const { creditRouter, creditMutationGuard } = require('./hourCredits/routes');
const hourCredits = createHourCreditService({ filename: dbPath, overlap: checkRoomOverlap, receipt: generateReceiptNumber, pin: generateUniquePinCode });
app.use('/api/hour-credits', authenticateToken, requireAnyPermission('pos'), creditRouter(hourCredits));
app.use('/api/bookings', creditMutationGuard(dbQuery));
app.use('/api/admin/clear-history', creditMutationGuard(dbQuery, true));

// ==========================================
// 2. ROOMS ENDPOINTS
// ==========================================
app.get('/api/rooms', async (req, res) => {
  try {
    const status = req.query.status;
    let sql = 'SELECT * FROM rooms';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    const rooms = await dbQuery.all(sql, params);
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rooms', requireAnyPermission('manage'), async (req, res) => {
  const {
    name, capacity, hourly_rate, daily_rate, half_day_rate,
    has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url,
    description, status, image_url,
    has_hourly, has_halfday, has_daily, pin_code, builtland_pin_code
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อห้องประชุม' });
  }
  try {
    const result = await dbQuery.run(
      `INSERT INTO rooms (
        name, capacity, hourly_rate, daily_rate, half_day_rate,
        has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url,
        description, status, image_url,
        has_hourly, has_halfday, has_daily, pin_code, builtland_pin_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, capacity, hourly_rate, daily_rate || 0, half_day_rate || 0,
        has_classroom || 0, classroom_hourly_rate || 0, classroom_daily_rate || 0, classroom_capacity || 0, classroom_image_url || null,
        description || '', status || 'active', image_url || null,
        has_hourly !== undefined ? has_hourly : 1, has_halfday || 0, has_daily || 0, pin_code || null, builtland_pin_code || null
      ]
    );
    res.status(201).json({
      id: result.id, name, capacity, hourly_rate, daily_rate: daily_rate || 0, half_day_rate: half_day_rate || 0,
      has_classroom: has_classroom || 0,
      classroom_hourly_rate: classroom_hourly_rate || 0,
      classroom_daily_rate: classroom_daily_rate || 0,
      classroom_capacity: classroom_capacity || 0,
      classroom_image_url: classroom_image_url || null,
      description, status: status || 'active', image_url: image_url || null,
      has_hourly: has_hourly !== undefined ? has_hourly : 1, has_halfday: has_halfday || 0, has_daily: has_daily || 0,
      pin_code: pin_code || null,
      builtland_pin_code: builtland_pin_code || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/rooms/:id', requireAnyPermission('manage'), async (req, res) => {
  const {
    name, capacity, hourly_rate, daily_rate, half_day_rate,
    has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url,
    description, status, image_url,
    has_hourly, has_halfday, has_daily, pin_code, builtland_pin_code
  } = req.body;
  try {
    await dbQuery.run(
      `UPDATE rooms
       SET name = ?, capacity = ?, hourly_rate = ?, daily_rate = ?, half_day_rate = ?,
           has_classroom = ?, classroom_hourly_rate = ?, classroom_daily_rate = ?, classroom_capacity = ?, classroom_image_url = ?,
           description = ?, status = ?, image_url = ?,
           has_hourly = ?, has_halfday = ?, has_daily = ?, pin_code = ?, builtland_pin_code = ?
       WHERE id = ?`,
      [
        name, capacity, hourly_rate, daily_rate || 0, half_day_rate || 0,
        has_classroom || 0, classroom_hourly_rate || 0, classroom_daily_rate || 0, classroom_capacity || 0, classroom_image_url || null,
        description, status, image_url,
        has_hourly !== undefined ? has_hourly : 1, has_halfday || 0, has_daily || 0, pin_code || null, builtland_pin_code || null,
        req.params.id
      ]
    );
    res.json({ message: 'แก้ไขข้อมูลห้องประชุมสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rooms/:id', requireAnyPermission('manage'), async (req, res) => {
  try {
    await dbQuery.run('DELETE FROM rooms WHERE id = ?', [req.params.id]);
    res.json({ message: 'ลบห้องประชุมสำเร็จ' });
  } catch (err) {
    if (err.message && err.message.includes('FOREIGN KEY')) {
      return res.status(400).json({ error: 'ไม่สามารถลบห้องประชุมนี้ได้ เนื่องจากมีประวัติการจองอยู่ในระบบ แนะนำให้เปลี่ยนสถานะห้องประชุมเป็น "ปิดใช้งานชั่วคราว" แทน' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rooms/:id/bookings', async (req, res) => {
  try {
    const bookings = await dbQuery.all(
      `SELECT bi.start_time, bi.end_time, b.customer_name, b.contact, b.payment_status, b.payment_method, b.booking_source, b.receipt_number, b.id as booking_id
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.id
       WHERE bi.room_id = ?
         AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed'))
         AND (b.checkin_status IS NULL OR b.checkin_status != 'cancelled')
         AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
       ORDER BY bi.start_time ASC`,
      [req.params.id]
    );
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. SERVICES ENDPOINTS
// ==========================================
app.get('/api/services', async (req, res) => {
  try {
    const status = req.query.status;
    let sql = 'SELECT * FROM services';
    const params = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    const services = await dbQuery.all(sql, params);
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services', requireAnyPermission('manage'), async (req, res) => {
  const { name, price, category, status, image_url } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลชื่อบริการและประเภทหมวดหมู่' });
  }
  try {
    const result = await dbQuery.run(
      'INSERT INTO services (name, price, category, status, image_url) VALUES (?, ?, ?, ?, ?)',
      [name, price, category, status || 'active', image_url || null]
    );
    res.status(201).json({ id: result.id, name, price, category, status: status || 'active', image_url: image_url || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/services/:id', requireAnyPermission('manage'), async (req, res) => {
  const { name, price, category, status, image_url } = req.body;
  try {
    await dbQuery.run(
      'UPDATE services SET name = ?, price = ?, category = ?, status = ?, image_url = ? WHERE id = ?',
      [name, price, category, status, image_url, req.params.id]
    );
    res.json({ message: 'แก้ไขข้อมูลบริการสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/services/:id', requireAnyPermission('manage'), async (req, res) => {
  try {
    await dbQuery.run('DELETE FROM services WHERE id = ?', [req.params.id]);
    res.json({ message: 'ลบบริการสำเร็จ' });
  } catch (err) {
    if (err.message && err.message.includes('FOREIGN KEY')) {
      return res.status(400).json({ error: 'ไม่สามารถลบรายการนี้ได้ เนื่องจากมีประวัติการจองหรือใช้บริการอยู่ในระบบ แนะนำให้เปลี่ยนสถานะบริการเป็น "ปิดใช้งานชั่วคราว" แทน' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3.5. CATEGORIES ENDPOINTS
// ==========================================
app.put('/api/categories', requireAnyPermission('manage'), async (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) return res.status(400).json({ error: 'กรุณาระบุชื่อเก่าและชื่อใหม่' });
  try {
    await dbQuery.run('UPDATE services SET category = ? WHERE category = ?', [newName, oldName]);
    await dbQuery.run('UPDATE rooms SET category = ? WHERE category = ?', [newName, oldName]);
    res.json({ message: 'แก้ไขชื่อหมวดหมู่สำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:name', requireAnyPermission('manage'), async (req, res) => {
  const { name } = req.params;
  try {
    // Check if any rooms or services still exist in this category
    const roomCount = await dbQuery.get('SELECT COUNT(*) as count FROM rooms WHERE category = ?', [name]);
    const serviceCount = await dbQuery.get('SELECT COUNT(*) as count FROM services WHERE category = ?', [name]);

    if ((roomCount && roomCount.count > 0) || (serviceCount && serviceCount.count > 0)) {
      const totalItems = (roomCount?.count || 0) + (serviceCount?.count || 0);
      return res.status(400).json({
        error: `ไม่สามารถลบหมวดหมู่นี้ได้ เนื่องจากยังมีห้อง/บริการอยู่ ${totalItems} รายการ กรุณาย้ายหรือลบรายการเหล่านี้ก่อน`
      });
    }

    res.json({ message: 'ลบหมวดหมู่สำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// 4. BOOKINGS (POS CHECKOUT & HISTORY)
// ==========================================
async function generateReceiptNumber(query = dbQuery) {
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bkkDate = new Date(Date.now() + bangkokOffsetMs);
  const yy = String(bkkDate.getUTCFullYear()).slice(-2);
  const mm = String(bkkDate.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `BK-${yy}${mm}`;

  const lastBooking = await query.get(
    `SELECT receipt_number FROM bookings
     WHERE receipt_number LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let sequence = 1;
  if (lastBooking && lastBooking.receipt_number) {
    const rawSeq = lastBooking.receipt_number.replace(prefix, '').replace(/^-/, '');
    const lastSeq = parseInt(rawSeq, 10);
    if (!isNaN(lastSeq)) {
      sequence = lastSeq + 1;
    }
  }

  return `${prefix}${String(sequence).padStart(3, '0')}`;
}

// Helper function to generate 6-digit PIN Code
async function generateUniquePinCode(query = dbQuery) {
  let pin = Math.floor(100000 + Math.random() * 900000).toString();
  // Ensure uniqueness among active bookings
  let existing = await query.get('SELECT id FROM bookings WHERE pin_code = ? AND checkin_status != "expired"', [pin]);
  let tries = 0;
  while (existing && tries < 10) {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
    existing = await query.get('SELECT id FROM bookings WHERE pin_code = ? AND checkin_status != "expired"', [pin]);
    tries++;
  }
  return pin;
}

// Stable Jupiter room IDs (ID 10: Jupiter (300), ID 12: Jupiter (300) & Co-Working)
const JUPITER_ROOM_IDS = [10, 12];

/**
 * Returns whether a room physically uses/requires a door lock PIN.
 * Jupiter (300) does NOT have a door keypad or PIN lock mechanism.
 * Primary rule: Check stable Jupiter room IDs (10, 12).
 * Defensive fallback: Check if room name includes 'jupiter' (case-insensitive).
 */
function roomUsesDoorPin(roomOrId) {
  if (!roomOrId) return false;
  if (typeof roomOrId === 'number') {
    return !JUPITER_ROOM_IDS.includes(roomOrId);
  }
  if (typeof roomOrId === 'string' && /^\d+$/.test(roomOrId.trim())) {
    const parsedId = parseInt(roomOrId.trim(), 10);
    return !JUPITER_ROOM_IDS.includes(parsedId);
  }
  if (typeof roomOrId === 'object') {
    const rId = Number(roomOrId.id || roomOrId.room_id);
    if (rId && JUPITER_ROOM_IDS.includes(rId)) {
      return false;
    }
    const name = String(roomOrId.name || roomOrId.room_name || '').trim();
    if (name && /jupiter/i.test(name)) {
      return false;
    }
    if (roomOrId.pin_code && String(roomOrId.pin_code).trim() && String(roomOrId.pin_code).trim() !== '-') {
      return true;
    }
    if (roomOrId.builtland_pin_code && String(roomOrId.builtland_pin_code).trim()) {
      return true;
    }
  }
  return true;
}

// Helper: Get Bangkok Local ISO string (YYYY-MM-DDTHH:mm:ss)
function getBangkokLocalISO(d = new Date()) {
  const now = (d instanceof Date) ? d : new Date(d);
  const bkkMs = now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60 * 1000;
  const bkk = new Date(bkkMs);
  const y = bkk.getFullYear();
  const m = String(bkk.getMonth() + 1).padStart(2, '0');
  const day = String(bkk.getDate()).padStart(2, '0');
  const h = String(bkk.getHours()).padStart(2, '0');
  const min = String(bkk.getMinutes()).padStart(2, '0');
  const sec = String(bkk.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}:${sec}`;
}

// Helper: Normalize any timestamp to consistent Local ISO format YYYY-MM-DDTHH:mm:00
function normalizeToLocalISO(dateStr, timeStr) {
  if (!dateStr) return '';
  if (timeStr) {
    let cleanTime = String(timeStr).trim();
    if (cleanTime.length === 5) cleanTime += ':00';
    const cleanDate = String(dateStr).trim().split('T')[0].split(' ')[0];
    return `${cleanDate}T${cleanTime}`;
  }
  if (typeof dateStr === 'string') {
    let s = dateStr.trim();
    // YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD HH:MM:SS format without timezone
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      s = s.replace(' ', 'T');
      if (s.length === 16) s += ':00';
      return s;
    }
    // Has timezone offset (e.g. Z or +07:00)
    if (s.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const bkkMs = d.getTime() + 7 * 60 * 60 * 1000;
        const bkk = new Date(bkkMs);
        const y = bkk.getUTCFullYear();
        const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
        const day = String(bkk.getUTCDate()).padStart(2, '0');
        const h = String(bkk.getUTCHours()).padStart(2, '0');
        const min = String(bkk.getUTCMinutes()).padStart(2, '0');
        const sec = String(bkk.getUTCSeconds()).padStart(2, '0');
        return `${y}-${m}-${day}T${h}:${min}:${sec}`;
      }
    }
    if (s.includes('T')) {
      const parts = s.split('T');
      const timePart = parts[1].split('.')[0];
      const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
      return `${parts[0]}T${cleanTime}`;
    }
    if (s.includes(' ')) {
      const parts = s.split(' ');
      const timePart = parts[1].split('.')[0];
      const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
      return `${parts[0]}T${cleanTime}`;
    }
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const bkkMs = d.getTime() + 7 * 60 * 60 * 1000;
  const bkk = new Date(bkkMs);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bkk.getUTCDate()).padStart(2, '0');
  const h = String(bkk.getUTCHours()).padStart(2, '0');
  const min = String(bkk.getUTCMinutes()).padStart(2, '0');
  const sec = String(bkk.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}:${sec}`;
}

// Helper: Get cleaning buffer minutes from settings (defaults to 30 mins)
async function getCleaningBufferMinutes(query = dbQuery) {
  try {
    const row = await query.get("SELECT value FROM settings WHERE key = 'cleaning_buffer_minutes'");
    if (row && row.value !== undefined && row.value !== null && !isNaN(row.value)) {
      return Math.max(0, parseInt(row.value, 10));
    }
  } catch (e) {}
  return 30;
}

// Helper: Check if a room has overlapping bookings or conflicts with cleaning buffer (cross-system safe)
async function checkRoomOverlap(roomId, startISO, endISO, excludeBookingId = null, creditQuery = dbQuery) {
  const normStart = normalizeToLocalISO(startISO);
  const normEnd = normalizeToLocalISO(endISO);
  const bufferMins = await getCleaningBufferMinutes(creditQuery);
  const bufferMs = bufferMins * 60 * 1000;

  const reqStartMs = new Date(normStart.replace(' ', 'T')).getTime();
  const reqEndMs = new Date(normEnd.replace(' ', 'T')).getTime();
  const reqEndBufferedMs = reqEndMs + bufferMs;

  let query = `
    SELECT bi.id, bi.booking_id, bi.start_time, bi.end_time, b.customer_name, b.payment_status
    FROM booking_items bi
    JOIN bookings b ON bi.booking_id = b.id
    WHERE bi.room_id = ?
      AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed'))
      AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
  `;
  const params = [roomId];
  if (excludeBookingId) {
    query += ' AND b.id != ?';
    params.push(excludeBookingId);
  }

  const bookings = await creditQuery.all(query, params);

  for (const b of bookings) {
    if (!b.start_time || !b.end_time) continue;
    const bStartNorm = normalizeToLocalISO(b.start_time);
    const bEndNorm = normalizeToLocalISO(b.end_time);
    const bStartMs = new Date(bStartNorm.replace(' ', 'T')).getTime();
    const bEndMs = new Date(bEndNorm.replace(' ', 'T')).getTime();
    const bEndBufferedMs = bEndMs + bufferMs;

    const [bEndDate, bEndTime] = bEndNorm.split('T');
    const [bEndH, bEndM] = (bEndTime || '00:00').substring(0, 5).split(':').map(Number);
    const totalBufferedMins = bEndH * 60 + bEndM + bufferMins;
    const bufH = Math.floor(totalBufferedMins / 60) % 24;
    const bufM = totalBufferedMins % 60;
    const bufHHMM = `${String(bufH).padStart(2, '0')}:${String(bufM).padStart(2, '0')}`;
    const endBufferedISO = `${bEndDate}T${bufHHMM}:00`;

    // Overlap condition taking 30-min cleaning buffer into account:
    // (Requested Start < Existing End + Buffer) AND (Requested End + Buffer > Existing Start)
    if (reqStartMs < bEndBufferedMs && reqEndBufferedMs > bStartMs) {
      // Determine if overlap is with actual customer usage or with the cleaning buffer
      const isDirectUsage = (reqStartMs < bEndMs && reqEndMs > bStartMs);
      return {
        hasOverlap: true,
        isCleaningBuffer: !isDirectUsage,
        bufferMinutes: bufferMins,
        booking: {
          ...b,
          start_time: bStartNorm,
          end_time: bEndNorm,
          end_buffered_time: endBufferedISO
        }
      };
    }
  }
  return { hasOverlap: false, bufferMinutes: bufferMins };
}

function formatOverlapErrorMessage(roomName, overlapResult) {
  const b = (overlapResult && overlapResult.booking) || {};
  const sTime = b.start_time && b.start_time.includes('T') ? b.start_time.split('T')[1].substring(0, 5) : (b.start_time || '');
  const eTime = b.end_time && b.end_time.includes('T') ? b.end_time.split('T')[1].substring(0, 5) : (b.end_time || '');
  const nextAvail = b.end_buffered_time && b.end_buffered_time.includes('T') ? b.end_buffered_time.split('T')[1].substring(0, 5) : eTime;

  const customer = b.customer_name ? `คุณ ${b.customer_name}` : 'ลูกค้า';
  const nameLabel = roomName ? `ห้อง "${roomName}"` : 'ห้องนี้';

  if (overlapResult.isCleaningBuffer) {
    return `${nameLabel} อยู่ในช่วงเวลาทำความสะอาด (${overlapResult.bufferMinutes || 30} นาที) ต่อจากคิว${customer} (ใช้งานถึง ${eTime} น.) สามารถจองได้ตั้งแต่เวลา ${nextAvail} น. เป็นต้นไป`;
  }
  return `${nameLabel} ไม่ว่างในช่วงเวลาดังกล่าว (มีผู้ใช้งาน: ${customer} ช่วงเวลา ${sTime} - ${eTime} น.)`;
}

app.post('/api/bookings', async (req, res) => {
  const {
    customer_name, department, contact, total_amount, payment_status, payment_method,
    items, line_user_id, guest_count,
    customer_type = 'walkin',
    basecamp_sub_type = null,
    basecamp_unit = null,
    internal_department = null,
    billing_option = 'paid'
  } = req.body;

  if (!customer_name || !items || !items.length) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลผู้จองและเลือกรายการอย่างน้อย 1 รายการ' });
  }

  try {
    const result = await dbQuery.transaction(async () => {
      // Check overlap for all room items BEFORE inserting anything
      for (const item of items) {
        if (item.room_id && item.start_time && item.end_time) {
          // Normalize timestamps to consistent Local ISO format
          const normStart = normalizeToLocalISO(item.start_time);
          const normEnd = normalizeToLocalISO(item.end_time);

          // Validate time order
          if (normEnd <= normStart) {
            const err = new Error(`เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น (${normStart} - ${normEnd})`);
            err.statusCode = 400;
            throw err;
          }

          const overlapResult = await checkRoomOverlap(item.room_id, normStart, normEnd);
          if (overlapResult.hasOverlap) {
            const roomObj = await dbQuery.get('SELECT name FROM rooms WHERE id = ?', [item.room_id]);
            const roomName = roomObj ? roomObj.name : `ID: ${item.room_id}`;
            const err = new Error(formatOverlapErrorMessage(roomName, overlapResult));
            err.statusCode = 409;
            throw err;
          }
        }
      }

      // Server-side price recalculation for verification
      let serverTotal = 0;
      for (const item of items) {
        if (item.room_id) {
          const room = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [item.room_id]);
          if (room) {
            let itemPrice = room.hourly_rate;
            const bType = item.booking_type || 'hourly';
            const bLayout = item.layout || 'standard';
            if (bType === 'daily') {
              itemPrice = bLayout === 'classroom' ? (room.classroom_daily_rate || room.daily_rate) : room.daily_rate;
            } else if (bType === 'halfday') {
              itemPrice = room.half_day_rate;
            } else {
              itemPrice = bLayout === 'classroom' ? (room.classroom_hourly_rate || room.hourly_rate) : room.hourly_rate;
            }
            const qty = item.quantity || 1;
            item.price = itemPrice;
            item.subtotal = Math.round(itemPrice * qty * 100) / 100;
            serverTotal += item.subtotal;
          }
        } else if (item.service_id) {
          const service = await dbQuery.get('SELECT * FROM services WHERE id = ?', [item.service_id]);
          if (service) {
            const qty = item.quantity || 1;
            item.price = service.price;
            item.subtotal = Math.round(service.price * qty * 100) / 100;
            serverTotal += item.subtotal;
          }
        }
      }
      let totalBookingHours = 0;
      for (const item of items) {
        if (item.room_id && item.start_time && item.end_time) {
          const s = new Date(item.start_time);
          const e = new Date(item.end_time);
          const diffHours = Math.max(0, (e.getTime() - s.getTime()) / (1000 * 60 * 60));
          totalBookingHours += diffHours;
        } else if (item.quantity) {
          totalBookingHours += item.quantity;
        }
      }

      let verifiedTotal = Math.round(serverTotal * 100) / 100;
      let quotaHoursUsed = 0;
      let effectiveBillingOption = billing_option || 'paid';

      if (customer_type === 'basecamp') {
        const maxQuota = basecamp_sub_type === 'office' ? 4 : 2;
        const firstItemDate = items[0]?.start_time || getBangkokLocalISO(new Date());
        const dObj = new Date(firstItemDate);
        const targetMonthStr = `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}`;

        const quotaRow = await dbQuery.get(
          `SELECT COALESCE(SUM(b.quota_hours_used), 0) AS used_hours
           FROM bookings b
           WHERE b.customer_type = 'basecamp'
             AND b.basecamp_sub_type = ?
             AND b.basecamp_unit = ?
             AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
             AND (
               EXISTS (
                 SELECT 1 FROM booking_items bi
                 WHERE bi.booking_id = b.id
                   AND strftime('%Y-%m', bi.start_time) = ?
               )
               OR (
                 NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id)
                 AND strftime('%Y-%m', b.created_at) = ?
               )
             )`,
          [basecamp_sub_type, basecamp_unit, targetMonthStr, targetMonthStr]
        );
        const usedQuota = quotaRow ? Number(quotaRow.used_hours) : 0;
        const remainingQuota = Math.max(0, maxQuota - usedQuota);

        quotaHoursUsed = Math.min(totalBookingHours, remainingQuota);
        const chargeableHours = Math.max(0, totalBookingHours - quotaHoursUsed);

        if (totalBookingHours > 0) {
          verifiedTotal = Math.round((chargeableHours / totalBookingHours) * serverTotal * 100) / 100;
        } else {
          verifiedTotal = 0;
        }

        if (quotaHoursUsed > 0 && verifiedTotal === 0) {
          effectiveBillingOption = 'quota';
        } else if (quotaHoursUsed > 0 && verifiedTotal > 0) {
          effectiveBillingOption = 'quota_partial';
        } else {
          effectiveBillingOption = 'standard';
        }
      } else if (customer_type === 'builtland') {
        verifiedTotal = 0;
        quotaHoursUsed = 0;
        effectiveBillingOption = 'internal_free';
      }

      const receiptNumber = await generateReceiptNumber();
      const roomItem = items.find(it => !!it.room_id);
      let pinCode = null;

      if (roomItem) {
        const roomDb = await dbQuery.get('SELECT id, name, pin_code, builtland_pin_code FROM rooms WHERE id = ?', [roomItem.room_id]);
        if (!roomUsesDoorPin(roomDb || roomItem.room_id)) {
          pinCode = null;
        } else if (customer_type === 'builtland') {
          if (roomDb && roomDb.builtland_pin_code && roomDb.builtland_pin_code.trim()) {
            pinCode = roomDb.builtland_pin_code.trim();
          } else if (roomDb && roomDb.pin_code && roomDb.pin_code.trim()) {
            pinCode = roomDb.pin_code.trim();
          } else {
            pinCode = await generateUniquePinCode();
          }
        } else {
          // General / Walk-in / Basecamp: Customer Access Code only
          if (roomDb && roomDb.pin_code && roomDb.pin_code.trim()) {
            pinCode = roomDb.pin_code.trim();
          } else {
            pinCode = await generateUniquePinCode();
          }
        }
      }

      // Extract optional guest count for Walk-in
      const effectiveGuestCount = (guest_count !== undefined && guest_count !== null && guest_count !== '')
        ? parseInt(guest_count, 10)
        : (items.find(it => it.guest_count)?.guest_count ? parseInt(items.find(it => it.guest_count).guest_count, 10) : null);

      // Determine effective payment status
      const effectivePaymentStatus = customer_type === 'builtland'
        ? 'internal_free'
        : (verifiedTotal === 0 ? 'paid' : (payment_status || 'pending'));

      // Insert master booking (with optional customer categorization fields and quota_hours_used)
      const bookingResult = await dbQuery.run(
        `INSERT INTO bookings
         (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, line_user_id, guest_count, checkin_status, booking_source, booking_channel, customer_type, basecamp_sub_type, basecamp_unit, internal_department, billing_option, quota_hours_used, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer_name,
          department || internal_department || '',
          contact || '',
          verifiedTotal,
          effectivePaymentStatus,
          payment_method || 'cash',
          receiptNumber,
          pinCode,
          line_user_id || null,
          effectiveGuestCount,
          'pending',
          'walk-in',
          req.body.booking_channel || 'pos_web',
          customer_type || 'walkin',
          basecamp_sub_type || null,
          basecamp_unit || null,
          internal_department || null,
          effectiveBillingOption,
          quotaHoursUsed,
          getBangkokLocalISO(new Date())
        ]
      );
      const bookingId = bookingResult.id;

      // Insert booking items with normalized timestamps & guest_count
      for (const item of items) {
        const normStart = (item.room_id && item.start_time) ? normalizeToLocalISO(item.start_time) : null;
        const normEnd = (item.room_id && item.end_time) ? normalizeToLocalISO(item.end_time) : null;
        const itemGuestCount = item.guest_count ? parseInt(item.guest_count, 10) : effectiveGuestCount;

        let itemPin = pinCode;
        if (item.room_id && item.room_id !== roomItem?.room_id) {
          const thisRoom = await dbQuery.get('SELECT id, name, pin_code, builtland_pin_code FROM rooms WHERE id = ?', [item.room_id]);
          if (!roomUsesDoorPin(thisRoom || item.room_id)) {
            itemPin = null;
          } else if (customer_type === 'builtland') {
            itemPin = (thisRoom?.builtland_pin_code?.trim()) || (thisRoom?.pin_code?.trim()) || (await generateUniquePinCode());
          } else {
            itemPin = (thisRoom?.pin_code?.trim()) || (await generateUniquePinCode());
          }
        }

        await dbQuery.run(
          `INSERT INTO booking_items
           (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, guest_count, pin_code, checkin_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bookingId,
            item.room_id || null,
            item.service_id || null,
            item.quantity || 1,
            item.price || 0,
            normStart,
            normEnd,
            item.subtotal || 0,
            item.layout || 'standard',
            item.booking_type || 'hourly',
            itemGuestCount,
            itemPin,
            'pending'
          ]
        );
      }

      const savedBooking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
      const savedItems = await dbQuery.all(`
        SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.category as service_category
        FROM booking_items bi
        LEFT JOIN rooms r ON bi.room_id = r.id
        LEFT JOIN services s ON bi.service_id = s.id
        WHERE bi.booking_id = ?
      `, [bookingId]);

      return {
        bookingId,
        receiptNumber,
        pinCode,
        savedBooking,
        savedItems
      };
    });

    res.status(201).json({
      success: true,
      bookingId: result.bookingId,
      booking_id: result.bookingId,
      id: result.bookingId,
      receiptNumber: result.receiptNumber,
      receipt_number: result.receiptNumber,
      booking_code: result.receiptNumber,
      bookingCode: result.receiptNumber,
      pinCode: result.pinCode,
      pin_code: result.pinCode,
      ...(result.savedBooking || {}),
      items: result.savedItems || [],
      message: 'บันทึกการจองสำเร็จ'
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Query Basecamp Monthly Quota Status (Office: 4 hrs/month, Hotdesk: 2 hrs/month)

// 1. Get Basecamp Quota Overview for all Floor 4 units in a given month
app.get('/api/basecamp/quota/overview', async (req, res) => {
  const { month, year } = req.query;
  try {
    const officeUnits = ['401', '402', '403', '404', '405', '406', '407', '408', '409', '410', '411', '412', '413', '414'];
    const hotdeskUnits = ['419', '420', '421', '422', '427', '428', '429', '430'];

    const now = new Date();
    const targetMonth = month ? String(month).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0');
    const targetYear = year ? String(year) : String(now.getFullYear());
    const targetMonthStr = `${targetYear}-${targetMonth}`;

    const rows = await dbQuery.all(
      `SELECT b.basecamp_sub_type, b.basecamp_unit, COALESCE(SUM(b.quota_hours_used), 0) as used_hours, COUNT(DISTINCT b.id) as booking_count
       FROM bookings b
       WHERE b.customer_type = 'basecamp'
         AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
         AND (
           EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id AND strftime('%Y-%m', bi.start_time) = ?)
           OR (NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id) AND strftime('%Y-%m', b.created_at) = ?)
         )
       GROUP BY b.basecamp_sub_type, b.basecamp_unit`,
      [targetMonthStr, targetMonthStr]
    );

    const usageMap = {};
    (rows || []).forEach(r => {
      const key = `${r.basecamp_sub_type}_${r.basecamp_unit}`;
      usageMap[key] = {
        used_hours: Number(r.used_hours),
        booking_count: Number(r.booking_count)
      };
    });

    const units = [];
    officeUnits.forEach(u => {
      const usage = usageMap[`office_${u}`] || { used_hours: 0, booking_count: 0 };
      units.push({
        unit: u,
        sub_type: 'office',
        label: `Office ${u}`,
        max_quota: 4,
        used_quota: usage.used_hours,
        remaining_quota: Math.max(0, 4 - usage.used_hours),
        booking_count: usage.booking_count
      });
    });

    hotdeskUnits.forEach(u => {
      const usage = usageMap[`hotdesk_${u}`] || { used_hours: 0, booking_count: 0 };
      units.push({
        unit: u,
        sub_type: 'hotdesk',
        label: `Hotdesk ${u}`,
        max_quota: 2,
        used_quota: usage.used_hours,
        remaining_quota: Math.max(0, 2 - usage.used_hours),
        booking_count: usage.booking_count
      });
    });

    res.json({
      success: true,
      target_month: targetMonthStr,
      units
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Detailed Booking History for a specific Basecamp unit in a month
app.get('/api/basecamp/quota/history', async (req, res) => {
  const { sub_type = 'office', unit = '401', month, year } = req.query;
  try {
    const now = new Date();
    const targetMonth = month ? String(month).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0');
    const targetYear = year ? String(year) : String(now.getFullYear());
    const targetMonthStr = `${targetYear}-${targetMonth}`;

    const bookings = await dbQuery.all(
      `SELECT b.id, b.receipt_number, b.customer_name, b.created_at, b.quota_hours_used,
              bi.start_time, bi.end_time, r.name as room_name
       FROM bookings b
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE b.customer_type = 'basecamp'
         AND b.basecamp_sub_type = ?
         AND b.basecamp_unit = ?
         AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
         AND (
           strftime('%Y-%m', bi.start_time) = ?
           OR (bi.start_time IS NULL AND strftime('%Y-%m', b.created_at) = ?)
         )
       ORDER BY bi.start_time DESC, b.id DESC`,
      [sub_type, unit, targetMonthStr, targetMonthStr]
    );

    res.json({
      success: true,
      sub_type,
      unit,
      target_month: targetMonthStr,
      bookings: bookings || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/basecamp/quota', async (req, res) => {
  const { sub_type = 'office', unit = '401', month, year } = req.query;
  try {
    const maxQuota = sub_type === 'office' ? 4 : 2;
    const now = new Date();
    const targetMonth = month ? String(month).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0');
    const targetYear = year ? String(year) : String(now.getFullYear());
    const targetMonthStr = `${targetYear}-${targetMonth}`;

    const quotaRow = await dbQuery.get(
      `SELECT COALESCE(SUM(b.quota_hours_used), 0) as used_hours
       FROM bookings b
       WHERE b.customer_type = 'basecamp'
         AND b.basecamp_sub_type = ?
         AND b.basecamp_unit = ?
         AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
         AND (
           EXISTS (
             SELECT 1 FROM booking_items bi
             WHERE bi.booking_id = b.id
               AND strftime('%Y-%m', bi.start_time) = ?
           )
           OR (
             NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id)
             AND strftime('%Y-%m', b.created_at) = ?
           )
         )`,
      [sub_type, unit, targetMonthStr, targetMonthStr]
    );

    const usedQuota = quotaRow ? Number(quotaRow.used_hours) : 0;
    const remainingQuota = Math.max(0, maxQuota - usedQuota);

    res.json({
      sub_type,
      unit,
      target_month: targetMonthStr,
      max_quota: maxQuota,
      used_quota: usedQuota,
      remaining_quota: remainingQuota
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bookings', async (req, res) => {
  const { start_date, end_date, search, payment_status, customer_type, booking_channel } = req.query;
  try {
    let sql = `
      SELECT DISTINCT b.*
      FROM bookings b
      LEFT JOIN booking_items bi ON b.id = bi.booking_id
      LEFT JOIN rooms r ON bi.room_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (start_date) {
      sql += ' AND (datetime(b.created_at) >= datetime(?) OR bi.start_time >= ? OR b.booking_date >= ?)';
      params.push(start_date + ' 00:00:00', start_date, start_date);
    }
    if (end_date) {
      sql += ' AND (datetime(b.created_at) <= datetime(?) OR bi.start_time <= ? OR b.booking_date <= ?)';
      params.push(end_date + ' 23:59:59', end_date + ' 23:59:59', end_date);
    }
    if (search) {
      const q = `%${search}%`;
      sql += ` AND (
        b.customer_name LIKE ? OR
        b.contact LIKE ? OR
        b.department LIKE ? OR
        b.receipt_number LIKE ? OR
        CAST(b.id AS TEXT) LIKE ? OR
        b.pin_code LIKE ? OR
        r.name LIKE ? OR
        r.category LIKE ? OR
        b.basecamp_unit LIKE ? OR
        b.internal_department LIKE ?
      )`;
      params.push(q, q, q, q, q, q, q, q, q, q);
    }
    if (payment_status) {
      if (payment_status === 'pending' || payment_status === 'unpaid') {
        sql += " AND (b.payment_status = 'pending' OR b.payment_status = 'reviewing' OR b.payment_status = 'unpaid' OR b.payment_status IS NULL)";
      } else if (payment_status !== 'all') {
        sql += ' AND b.payment_status = ?';
        params.push(payment_status);
      }
    }
    if (booking_channel && booking_channel !== 'all') {
      sql += ' AND b.booking_channel = ?';
      params.push(booking_channel);
    }
    if (customer_type && customer_type !== 'all') {
      if (customer_type === 'online' || customer_type === 'line_oa') {
        sql += " AND (b.booking_channel = 'line_oa' OR b.booking_source = 'online' OR b.customer_type = 'general' OR b.customer_type = 'online')";
      } else if (customer_type === 'walkin') {
        sql += " AND (b.customer_type = 'walkin' OR (b.customer_type IS NULL AND (b.booking_source != 'online' OR b.booking_source IS NULL)))";
      } else {
        sql += ' AND b.customer_type = ?';
        params.push(customer_type);
      }
    }

    sql += ' ORDER BY b.created_at DESC';

    const bookings = await dbQuery.all(sql, params);

    // Fetch all booking items with room info for the retrieved bookings
    if (bookings.length > 0) {
      const bookingIds = bookings.map(b => b.id);
      const placeholders = bookingIds.map(() => '?').join(',');
      const items = await dbQuery.all(
        `SELECT bi.*, r.name as room_name, r.category as room_category, r.capacity as room_capacity
         FROM booking_items bi
         LEFT JOIN rooms r ON bi.room_id = r.id
         WHERE bi.booking_id IN (${placeholders})
         ORDER BY bi.id ASC`,
        bookingIds
      );

      const itemsByBookingId = {};
      items.forEach(it => {
        if (!itemsByBookingId[it.booking_id]) itemsByBookingId[it.booking_id] = [];
        itemsByBookingId[it.booking_id].push(it);
      });

      // Fetch latest slip verification details if available
      const slipRows = await dbQuery.all(
        `SELECT booking_id, slip_image_url, trans_ref, verification_status, amount, bank_name, created_at as slip_verified_at
         FROM slip_verifications
         WHERE booking_id IN (${placeholders})
         ORDER BY id DESC`,
        bookingIds
      );
      const slipByBookingId = {};
      slipRows.forEach(s => {
        if (!slipByBookingId[s.booking_id]) slipByBookingId[s.booking_id] = s;
      });

      bookings.forEach(b => {
        const s = slipByBookingId[b.id];
        if (s) {
          if (!b.slip_image_url) b.slip_image_url = s.slip_image_url;
          if (!b.slip_trans_ref) b.slip_trans_ref = s.trans_ref;
          if (!b.slip_verify_status) b.slip_verify_status = s.verification_status;
        }
        b.items = itemsByBookingId[b.id] || [];
        if (b.items.length > 0) {
          const first = b.items[0];
          b.start_time = first.start_time;
          b.end_time = first.end_time;
          b.room_name = first.room_name;
          b.room_id = first.room_id;
        }
      });
    }

    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get booking items with room info for calendar display
app.get('/api/bookings/calendar', async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) {
    return res.status(400).json({ error: 'กรุณาระบุ month และ year' });
  }
  try {
    const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`;
    const nextMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
    const nextYear = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
    const endOfMonth = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`;

    const items = await dbQuery.all(
      `SELECT bi.start_time, bi.end_time, bi.room_id, bi.subtotal, bi.price, bi.quantity, bi.layout, bi.booking_type,
              bi.guest_count as item_guest_count,
              r.name as room_name,
              b.id as booking_id, b.customer_name, b.payment_status, b.booking_source, b.department, b.contact, b.guest_count,
              b.customer_type, b.basecamp_sub_type, b.basecamp_unit, b.internal_department, b.billing_option
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.id
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE bi.room_id IS NOT NULL
         AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
         AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
         AND bi.start_time >= ?
         AND bi.start_time < ?
       ORDER BY bi.start_time ASC`,
      [startOfMonth, endOfMonth]
    );
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get upcoming booking alerts (with incoming online bookings, today bookings, and customizable warning time)
app.get('/api/bookings/upcoming-alerts', async (req, res) => {
  try {
    const settingRow = await dbQuery.get('SELECT value FROM settings WHERE key = ?', ['room_alert_minutes']);
    const alertMinutes = settingRow && settingRow.value ? parseInt(settingRow.value, 10) : 15;

    const now = new Date();
    const futureLimit = new Date(now.getTime() + alertMinutes * 60 * 1000);
    const nowISO = normalizeToLocalISO(now);
    const futureISO = normalizeToLocalISO(futureLimit);

    const todayStr = normalizeToLocalISO(now).split('T')[0];
    const todayStart = `${todayStr}T00:00:00`;
    const todayEnd = `${todayStr}T23:59:59`;

    // 1. Upcoming alerts (starting soon)
    const upcoming = await dbQuery.all(
      `SELECT bi.start_time, bi.end_time, bi.room_id, bi.layout, bi.booking_type,
              r.name as room_name,
              b.id as booking_id, b.customer_name, b.payment_status
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.id
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE bi.room_id IS NOT NULL
         AND bi.start_time >= ?
         AND bi.start_time <= ?
         AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
         AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
       ORDER BY bi.start_time ASC`,
      [nowISO, futureISO]
    );

    // 2. Incoming online bookings (Pending or Reviewing slip)
    const incomingBookings = await dbQuery.all(
      `SELECT b.id as booking_id, b.customer_name, b.payment_status, b.total_amount, b.booking_source, b.created_at,
              b.slip_image_url,
              bi.start_time, bi.end_time, r.name as room_name
       FROM bookings b
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE b.payment_status IN ('pending', 'reviewing')
       ORDER BY b.id DESC
       LIMIT 30`
    );

    // 3. Today's bookings
    const todayBookings = await dbQuery.all(
      `SELECT bi.start_time, bi.end_time, bi.room_id, bi.layout, bi.booking_type,
              r.name as room_name,
              b.id as booking_id, b.customer_name, b.payment_status, b.total_amount, b.contact
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.id
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE bi.start_time >= ? AND bi.start_time <= ?
         AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
         AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
       ORDER BY bi.start_time ASC`,
      [todayStart, todayEnd]
    );

    const pendingRow = await dbQuery.get("SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'pending'");
    const reviewingRow = await dbQuery.get("SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'reviewing'");

    res.json({
      upcoming,
      incomingBookings,
      todayBookings,
      pendingCount: pendingRow ? pendingRow.count : 0,
      reviewingCount: reviewingRow ? reviewingRow.count : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if room has an overlapping booking during the requested time range
app.get('/api/bookings/check-overlap', async (req, res) => {
  const { room_id, start_time, end_time, exclude_booking_id } = req.query;
  if (!room_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'กรุณาระบุข้อมูลห้องและเวลาเริ่มต้น/สิ้นสุดเพื่อตรวจสอบ' });
  }

  try {
    const overlapResult = await checkRoomOverlap(room_id, start_time, end_time, exclude_booking_id);
    if (overlapResult.hasOverlap) {
      res.json({
        overlap: true,
        is_cleaning_buffer: overlapResult.isCleaningBuffer,
        buffer_minutes: overlapResult.bufferMinutes,
        booking: {
          id: overlapResult.booking.booking_id || overlapResult.booking.id,
          customer_name: overlapResult.booking.customer_name,
          start_time: overlapResult.booking.start_time,
          end_time: overlapResult.booking.end_time,
          end_buffered_time: overlapResult.booking.end_buffered_time
        }
      });
    } else {
      res.json({
        overlap: false,
        buffer_minutes: overlapResult.bufferMinutes,
        booking: null
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bookings/:id', async (req, res) => {
  try {
    const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!booking) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลการจองนี้' });
    }

    const items = await dbQuery.all(
      `SELECT bi.*, r.name as room_name, r.description as room_description, s.name as service_name, s.category as service_category
       FROM booking_items bi
       LEFT JOIN rooms r ON bi.room_id = r.id
       LEFT JOIN services s ON bi.service_id = s.id
       WHERE bi.booking_id = ?`,
      [req.params.id]
    );

    const slipVerification = await dbQuery.get(
      'SELECT * FROM slip_verifications WHERE booking_id = ? ORDER BY id DESC LIMIT 1',
      [booking.id]
    );
    if (slipVerification) {
      if (!booking.slip_image_url) booking.slip_image_url = slipVerification.slip_image_url;
      if (!booking.slip_trans_ref) booking.slip_trans_ref = slipVerification.trans_ref;
      if (!booking.slip_verify_status) booking.slip_verify_status = slipVerification.verification_status;
    }

    res.json({ ...booking, slip_verification: slipVerification || null, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Find booking by ID or receipt_number
    const booking = await dbQuery.get(
      'SELECT id FROM bookings WHERE id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)',
      [id, id, id]
    );

    if (!booking) {
      return res.status(404).json({ error: 'ไม่พบรายการจองที่ต้องการลบ' });
    }

    const realId = booking.id;
    // Explicitly delete booking_items first, then master booking
    await dbQuery.run('DELETE FROM booking_items WHERE booking_id = ?', [realId]);
    await dbQuery.run('DELETE FROM bookings WHERE id = ?', [realId]);

    res.json({ success: true, message: 'ลบ/ยกเลิกรายการจองสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel Booking (Soft cancel: updates payment_status to 'cancelled', checkin_status to 'cancelled', records cancellation_reason, and notifies LINE OA)
const handleCancelBooking = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  const cancelReason = (reason && String(reason).trim()) || 'ลูกค้าแจ้งขอยกเลิกการจอง';

  try {
    const booking = await dbQuery.get(
      `SELECT b.*, bi.room_id, r.name as room_name, bi.start_time, bi.end_time
       FROM bookings b
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE b.id = ? OR b.receipt_number = ? OR UPPER(b.receipt_number) = UPPER(?)`,
      [id, id, id]
    );

    if (!booking) {
      return res.status(404).json({ success: false, error: 'ไม่พบรายการจองที่ต้องการยกเลิก' });
    }

    const realId = booking.id;

    await dbQuery.run(`
      UPDATE bookings
      SET payment_status = 'cancelled',
          checkin_status = 'cancelled',
          cancellation_reason = ?
      WHERE id = ?
    `, [cancelReason, realId]);

    await dbQuery.run(`
      UPDATE booking_items
      SET checkin_status = 'cancelled'
      WHERE booking_id = ?
    `, [realId]);

    // Push LINE Cancellation Notification if customer has line_user_id
    if (booking.line_user_id) {
      try {
        const tokenSetting = await dbQuery.get("SELECT value FROM settings WHERE key = 'line_channel_access_token'");
        const channelAccessToken = tokenSetting?.value;
        if (channelAccessToken) {
          const flexCancel = buildLineBookingCancelledFlex(booking, booking.room_name, cancelReason);
          await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${channelAccessToken}`
            },
            body: JSON.stringify({
              to: booking.line_user_id,
              messages: [flexCancel]
            })
          });
        }
      } catch (lineErr) {
        console.warn('[Manual-Cancel] LINE notification warning:', lineErr.message);
      }
    }

    res.json({
      success: true,
      message: 'ยกเลิกการจองเรียบร้อยแล้ว',
      booking_id: realId,
      cancellation_reason: cancelReason
    });
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการยกเลิกการจอง: ' + err.message });
  }
};

app.post('/api/bookings/:id/cancel', handleCancelBooking);
app.put('/api/bookings/:id/cancel', handleCancelBooking);

// Reason code mapping for slip rejection
const REJECT_REASON_MAP = {
  AMOUNT_MISMATCH: 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ',
  WRONG_RECEIVER: 'บัญชีผู้รับเงินไม่ถูกต้อง',
  UNREADABLE_SLIP: 'รูปภาพสลิปไม่ชัดเจนหรือข้อมูลไม่ครบถ้วน',
  DUPLICATE_SLIP: 'สลิปซ้ำหรือเคยใช้งานแล้วในระบบ',
  INVALID_DATETIME: 'วันที่หรือเวลาในการโอนไม่ถูกต้อง',
  NOT_BANK_SLIP: 'ไม่ใช่สลิปการโอนเงินของธนาคาร',
  OTHER: 'อื่นๆ'
};

// Dedicated Reject Slip endpoint (Staff rejects slip, preserves booking & room block)
app.post('/api/bookings/:id/reject-slip', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { reason_code, custom_note } = req.body || {};

  // Reason code validation
  if (!reason_code || !REJECT_REASON_MAP[reason_code]) {
    return res.status(400).json({ error: 'กรุณาระบุรหัสเหตุผลการปฏิเสธสลิปที่ถูกต้อง' });
  }

  let displayReason = REJECT_REASON_MAP[reason_code];
  const sanitizedNote = custom_note
    ? String(custom_note).trim().replace(/[<>'"&]/g, '').replace(/[\x00-\x1F\x7F]/g, '').substring(0, 150)
    : '';

  if (reason_code === 'OTHER') {
    if (!sanitizedNote) {
      return res.status(400).json({ error: 'กรณีเลือกอื่นๆ กรุณาระบุรายละเอียดเหตุผลเพิ่มเติม (ไม่เกิน 150 ตัวอักษร)' });
    }
    displayReason = sanitizedNote;
  } else if (sanitizedNote) {
    displayReason = `${displayReason} (${sanitizedNote})`;
  }

  try {
    const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!booking) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
    }

    // Precondition: current payment_status must be 'reviewing' only
    if (booking.payment_status !== 'reviewing') {
      return res.status(409).json({
        error: `ไม่สามารถปฏิเสธสลิปได้เนื่องจากรายการจองอยู่ในสถานะ '${booking.payment_status}' (อนุญาตเฉพาะสถานะรอตรวจสอบ 'reviewing' เท่านั้น)`
      });
    }

    // Atomic conditional update
    const updateResult = await dbQuery.run(
      `UPDATE bookings
       SET payment_status = 'rejected',
           slip_verify_status = 'rejected'
       WHERE id = ? AND payment_status = 'reviewing'`,
      [id]
    );

    if (!updateResult || updateResult.changes !== 1) {
      return res.status(409).json({ error: 'สถานะรายการจองถูกเปลี่ยนแปลงไปแล้ว ไม่สามารถดำเนินการได้' });
    }

    // Audit: Update latest slip_verifications row for this booking
    try {
      const latestSv = await dbQuery.get(
        'SELECT id FROM slip_verifications WHERE booking_id = ? ORDER BY id DESC LIMIT 1',
        [id]
      );
      if (latestSv) {
        await dbQuery.run(
          "UPDATE slip_verifications SET verification_status = 'rejected', rejection_reason = ? WHERE id = ?",
          [displayReason, latestSv.id]
        );
      } else {
        await dbQuery.run(
          `INSERT INTO slip_verifications (
            booking_id, trans_ref, bank_code, bank_name, slip_image_url,
            is_auto_approved, confidence_score, raw_qr_data, verification_status,
            rejection_reason, created_at
          ) VALUES (?, ?, '000', 'ธนาคาร', ?, 0, 0, '', 'rejected', ?, datetime('now', 'localtime'))`,
          [id, booking.slip_trans_ref || `REJ_${id}_${Date.now()}`, booking.slip_image_url || 'uploaded', displayReason]
        );
      }
    } catch (svErr) {
      console.error('Audit update error on slip rejection:', svErr);
    }

    res.json({
      success: true,
      message: 'ปฏิเสธสลิปการโอนเงินเรียบร้อยแล้ว (การจองยังคงอยู่เพื่อให้ลูกค้าแนบสลิปใหม่)',
      payment_status: 'rejected',
      slip_verify_status: 'rejected',
      rejection_reason: displayReason
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



function formatThaiDateDisplay(isoString) {
  if (!isoString) return '-';
  try {
    const cleanStr = String(isoString).replace(' ', 'T');
    const [datePart] = cleanStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    if (!y || !m || !d) return String(isoString);
    const months = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiYear = y + 543;
    return `${d} ${months[m - 1]} ${thaiYear}`;
  } catch (e) {
    return String(isoString);
  }
}

function formatRescheduleTimeDisplay(startTime, endTime) {
  if (!startTime) return '-';
  try {
    const sStr = String(startTime).replace(' ', 'T');
    const dateStr = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = endTime ? String(endTime).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    const timeStr = (sTime && eTime) ? `${sTime} - ${eTime} น.` : (sTime ? `${sTime} น.` : '');
    return timeStr ? `${dateStr} (${timeStr})` : dateStr;
  } catch (e) {
    return String(startTime);
  }
}

// Helper to build LINE OA Flex Message for booking confirmation
function buildLineConfirmationFlex(booking, item, room) {
  const customerName = booking?.customer_name || 'ลูกค้าคนพิเศษ';
  const roomName = room?.name || 'ห้องประชุม B-WORK';
  const receiptNo = booking?.receipt_number || `BK-${String(booking?.id || 0).padStart(6, '0')}`;

  let dateDisplay = '-';
  let timeDisplay = '-';
  if (item?.start_time) {
    const sStr = String(item.start_time).replace(' ', 'T');
    dateDisplay = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = item?.end_time ? String(item.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = (sTime && eTime) ? `${sTime} - ${eTime} น.` : (sTime ? `${sTime} น.` : '-');
  } else if (booking?.date) {
    dateDisplay = formatThaiDateDisplay(booking.date);
    if (booking?.start_time) {
      timeDisplay = `${booking.start_time} - ${booking.end_time || ''} น.`.trim();
    }
  }

  return {
    type: 'flex',
    altText: `ยืนยันการจองสำเร็จ - ${roomName} - ${receiptNo}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-confirmation-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'ยืนยันการจอง',
            size: 'xl',
            weight: 'bold',
            color: '#0f172a'
          },
          {
            type: 'text',
            text: 'การจองห้องประชุมของคุณเสร็จสมบูรณ์',
            size: 'xs',
            color: '#64748b',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'รหัสการจอง', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: receiptNo, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ชื่อลูกค้า', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: customerName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ห้องประชุม', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: roomName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'วันที่ใช้งาน', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: dateDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'เวลา', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: timeDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            paddingAll: '14px',
            backgroundColor: '#ecfdf5',
            cornerRadius: '10px',
            borderWidth: '1px',
            borderColor: '#a7f3d0',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'สถานะการชำระเงิน', size: 'xs', color: '#065f46', flex: 3 },
                  { type: 'text', text: 'ชำระแล้ว', size: 'xs', weight: 'bold', color: '#059669', align: 'end', flex: 2 }
                ]
              },
              {
                type: 'text',
                text: 'สามารถรับรหัสเข้าห้องเมื่อถึงเวลาใช้งาน หรือติดต่อเคาน์เตอร์ประชาสัมพันธ์',
                size: 'xxs',
                color: '#047857',
                wrap: true,
                margin: 'sm'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: 'ดูรายละเอียดการจอง',
              uri: 'https://bwork-booking.pages.dev/status'
            },
            style: 'primary',
            color: '#065f46',
            height: 'md'
          }
        ]
      }
    }
  };
}

// Helper to trigger LINE OA notification
async function sendLineNotification(bookingId) {
  try {
    const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (!booking) return null;

    const item = await dbQuery.get('SELECT * FROM booking_items WHERE booking_id = ? AND room_id IS NOT NULL LIMIT 1', [bookingId]);
    const room = item ? await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [item.room_id]) : null;

    // Always ensure PIN matches the assigned room if the room has a PIN configured
    let pinCode = null;
    if (roomUsesDoorPin(room || item?.room_id)) {
      pinCode = (room && room.pin_code && room.pin_code.trim()) ? room.pin_code.trim() : booking.pin_code;
      if (!pinCode || !pinCode.trim()) {
        pinCode = await generateUniquePinCode();
      }
      await dbQuery.run('UPDATE bookings SET pin_code = ? WHERE id = ?', [pinCode, bookingId]);
      if (item) {
        await dbQuery.run('UPDATE booking_items SET pin_code = ? WHERE id = ?', [pinCode, item.id]);
      }
      booking.pin_code = pinCode;
    }

    const flexCard = buildLineConfirmationFlex(booking, item, room);

    // Check if LINE Channel Access Token is configured in DB settings
    const tokenSetting = await dbQuery.get('SELECT value FROM settings WHERE key = ?', ['line_channel_access_token']);
    const channelAccessToken = tokenSetting?.value;

    let linePushed = false;
    if (channelAccessToken && booking.line_user_id) {
      try {
        const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${channelAccessToken}`
          },
          body: JSON.stringify({
            to: booking.line_user_id,
            messages: [flexCard]
          })
        });
        linePushed = lineRes.ok;
      } catch (pushErr) {
        console.warn('LINE push notification error:', pushErr.message);
      }
    }

    return {
      success: true,
      pin_code: pinCode,
      line_pushed: linePushed,
      flexCard,
      booking
    };
  } catch (err) {
    console.error('Error generating LINE notification:', err);
    return null;
  }
}

// Update payment status (e.g. from pending/reviewing to paid) and trigger LINE OA notification
app.patch('/api/bookings/:id/payment', async (req, res) => {
  const { payment_status, payment_method } = req.body;
  try {
    await dbQuery.run(
      'UPDATE bookings SET payment_status = ?, payment_method = ? WHERE id = ?',
      [payment_status, payment_method, req.params.id]
    );

    let lineData = null;
    if (payment_status === 'paid') {
      lineData = await sendLineNotification(req.params.id);
    }

    res.json({
      success: true,
      message: 'อัปเดตสถานะชำระเงินสำเร็จ และส่งการแจ้งเตือนยืนยันการจองผ่าน LINE OA เรียบร้อยแล้ว',
      pin_code: lineData?.pin_code,
      line_notification_sent: lineData?.line_pushed || false,
      line_flex: lineData?.flexCard
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LINE OA Webhook endpoint
app.post('/api/line/webhook', async (req, res) => {
  try {
    const events = req.body?.events || [];
    res.status(200).json({ status: 'ok', events_count: events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


function buildLineBookingRescheduleFlex(booking, item, room, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal) {
  const roomName = room ? (room.room_number && !room.name.includes(`(${room.room_number})`) ? `${room.name} (${room.room_number})` : room.name) : (item?.room_name || 'ห้องประชุม B-WORK');
  const bookingCode = booking?.receipt_number || `#BK-${String(booking?.id || 0).padStart(6, '0')}`;
  const totalAmount = Number(newTotal !== undefined ? newTotal : (booking?.total_amount || 0));

  const oldTimeDisplay = formatRescheduleTimeDisplay(oldStartTime, oldEndTime);
  const newTimeDisplay = formatRescheduleTimeDisplay(newStartTime, newEndTime);

  return {
    type: 'flex',
    altText: `แจ้งเปลี่ยนแปลงการจอง ${roomName} - ${bookingCode}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-update-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'เปลี่ยนแปลงการจอง',
            size: 'xl',
            weight: 'bold',
            color: '#0f172a'
          },
          {
            type: 'text',
            text: 'รายละเอียดวันและเวลาใช้งานใหม่ของคุณ',
            size: 'xs',
            color: '#64748b',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'รหัสการจอง', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: bookingCode, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ห้องประชุม', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: roomName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '14px',
            backgroundColor: '#f8fafc',
            cornerRadius: '10px',
            borderWidth: '1px',
            borderColor: '#e2e8f0',
            contents: [
              { type: 'text', text: 'เดิม', size: 'xs', color: '#94a3b8', weight: 'bold' },
              { type: 'text', text: oldTimeDisplay, size: 'xs', color: '#94a3b8', decoration: 'line-through', margin: 'xs', wrap: true },
              { type: 'separator', margin: 'sm' },
              { type: 'text', text: 'ใหม่', size: 'xs', weight: 'bold', color: '#1e3a8a', margin: 'sm' },
              { type: 'text', text: newTimeDisplay, size: 'sm', weight: 'bold', color: '#1e3a8a', margin: 'xs', wrap: true },
              { type: 'separator', margin: 'sm' },
              {
                type: 'box',
                layout: 'baseline',
                margin: 'sm',
                contents: [
                  { type: 'text', text: 'ยอดชำระใหม่', size: 'xs', color: '#64748b', flex: 3 },
                  { type: 'text', text: `฿${totalAmount.toLocaleString()}`, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'text',
            text: 'กรุณารับรหัสเข้าห้องใหม่สำหรับช่วงเวลาที่เปลี่ยนแปลง',
            size: 'xxs',
            color: '#1e40af',
            margin: 'sm',
            align: 'center',
            wrap: true
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: 'ดูรายละเอียดการจอง',
              uri: 'https://bwork-booking.pages.dev/status'
            },
            style: 'primary',
            color: '#1e3a8a',
            height: 'md'
          }
        ]
      }
    }
  };
}

async function sendLineBookingRescheduleServer(bookingId, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal) {
  try {
    const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (!booking || !booking.line_user_id) return null;

    const item = await dbQuery.get('SELECT * FROM booking_items WHERE booking_id = ? AND room_id IS NOT NULL LIMIT 1', [bookingId]);
    const room = item?.room_id ? await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [item.room_id]) : null;

    const tokenSetting = await dbQuery.get("SELECT value FROM settings WHERE key = 'line_channel_access_token'");
    const channelAccessToken = tokenSetting?.value;
    if (!channelAccessToken) return null;

    const flexCard = buildLineBookingRescheduleFlex(booking, item, room, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal);

    const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: booking.line_user_id,
        messages: [flexCard]
      })
    });

    return { success: lineRes.ok, status: lineRes.status };
  } catch (err) {
    console.error('Error sending reschedule LINE notification:', err);
    return null;
  }
}

// Reschedule booking date/time and room endpoint
const handleReschedule = async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { date, start_time, end_time, booking_type, layout, total_amount, send_line, room_id } = req.body;

    if (!date || !start_time || !end_time) {
      return res.status(400).json({ error: 'กรุณาระบุ วันที่, เวลาเริ่มต้น และเวลาสิ้นสุด ให้ครบถ้วน' });
    }

    const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (!booking) return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });

    const currentItem = await dbQuery.get('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1', [bookingId]);
    if (!currentItem) return res.status(404).json({ error: 'ไม่พบรายการห้องในการจองนี้' });

    const targetRoomId = room_id || currentItem.room_id;
    const targetRoomObj = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [targetRoomId]);

    const cleanStart = start_time.length === 5 ? `${start_time}:00` : start_time;
    const cleanEnd = end_time.length === 5 ? `${end_time}:00` : end_time;
    const newStartISO = `${date}T${cleanStart}`;
    const newEndISO = `${date}T${cleanEnd}`;

    const overlapResult = await checkRoomOverlap(targetRoomId, newStartISO, newEndISO, bookingId);
    if (overlapResult && overlapResult.hasOverlap) {
      const targetRoomName = targetRoomObj ? targetRoomObj.name : `ID: ${targetRoomId}`;
      return res.status(400).json({ error: formatOverlapErrorMessage(targetRoomName, overlapResult) });
    }

    const oldStart = currentItem.start_time;
    const oldEnd = currentItem.end_time;

    // Synchronize PIN code with the target room based on customer_type
    let newPinCode = null;
    if (!roomUsesDoorPin(targetRoomObj || targetRoomId)) {
      newPinCode = null;
    } else if (booking.customer_type === 'builtland') {
      if (targetRoomObj && targetRoomObj.builtland_pin_code && targetRoomObj.builtland_pin_code.trim()) {
        newPinCode = targetRoomObj.builtland_pin_code.trim();
      } else if (targetRoomObj && targetRoomObj.pin_code && targetRoomObj.pin_code.trim()) {
        newPinCode = targetRoomObj.pin_code.trim();
      } else {
        newPinCode = booking.pin_code || await generateUniquePinCode();
      }
    } else {
      // General / Walk-in / Basecamp: Customer Access Code only
      if (targetRoomObj && targetRoomObj.pin_code && targetRoomObj.pin_code.trim()) {
        newPinCode = targetRoomObj.pin_code.trim();
      } else {
        newPinCode = booking.pin_code || await generateUniquePinCode();
      }
    }

    await dbQuery.run(
      `UPDATE booking_items SET room_id = ?, start_time = ?, end_time = ?, subtotal = ?, price = ?, booking_type = ?, layout = ?, pin_code = ? WHERE id = ?`,
      [
        targetRoomId,
        newStartISO,
        newEndISO,
        total_amount !== undefined ? total_amount : currentItem.subtotal,
        total_amount !== undefined ? total_amount : currentItem.price,
        booking_type || currentItem.booking_type || 'hourly',
        layout || currentItem.layout || 'standard',
        newPinCode,
        currentItem.id
      ]
    );

    if (total_amount !== undefined) {
      await dbQuery.run('UPDATE bookings SET pin_code = ?, total_amount = ? WHERE id = ?', [newPinCode, total_amount, bookingId]);
    } else {
      await dbQuery.run('UPDATE bookings SET pin_code = ? WHERE id = ?', [newPinCode, bookingId]);
    }
    booking.pin_code = newPinCode;

    let lineData = null;
    if (send_line !== false && booking.line_user_id) {
      lineData = await sendLineBookingRescheduleServer(bookingId, oldStart, oldEnd, newStartISO, newEndISO, total_amount);
    }

    res.json({
      success: true,
      message: 'เปลี่ยนแปลงข้อมูลการจองสำเร็จ' + (lineData?.success ? ' และส่งข้อความแจ้งเตือนผ่าน LINE OA เรียบร้อย' : ''),
      line_sent: lineData?.success || false,
      pin_code: newPinCode
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.put('/api/bookings/:id/reschedule', handleReschedule);
app.post('/api/bookings/:id/reschedule', handleReschedule);

// Public endpoint to get LINE OA confirmation card preview for a booking
app.get('/api/public/bookings/:id/line-notification', async (req, res) => {
  try {
    let bookingId = req.params.id;
    if (typeof bookingId === 'string' && bookingId.startsWith('BK-')) {
      const raw = bookingId.replace('BK-', '');
      if (raw.length <= 6 && !isNaN(raw)) {
        bookingId = parseInt(raw, 10);
      }
    }

    const result = await sendLineNotification(bookingId);
    if (!result) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
    }

    res.json({
      success: true,
      pin_code: result.pin_code,
      flexCard: result.flexCard,
      line_pushed: result.line_pushed,
      booking: result.booking
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4.4 DOOR ACCESS & LINE OA CHECK-IN API
// ==========================================

// Verify PIN Code from Door Access Tablet
app.post('/api/access/verify-pin', async (req, res) => {
  const { room_id, pin_code } = req.body;
  if (!pin_code) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกรหัส PIN 6 หลัก' });
  }

  try {
    const now = new Date();
    const nowISO = now.toISOString();

    // Query active room booking for this PIN code
    let sql = `
      SELECT bi.id as item_id, bi.start_time, bi.end_time, bi.checkin_status,
             b.id as booking_id, b.customer_name, b.payment_status, b.pin_code,
             r.id as room_id, r.name as room_name
      FROM booking_items bi
      JOIN bookings b ON bi.booking_id = b.id
      JOIN rooms r ON bi.room_id = r.id
      WHERE (b.pin_code = ? OR bi.pin_code = ?)
    `;
    const params = [pin_code.trim(), pin_code.trim()];

    if (room_id) {
      sql += ' AND bi.room_id = ?';
      params.push(room_id);
    }

    const bookingRow = await dbQuery.get(sql, params);

    if (!bookingRow) {
      return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลการจองด้วยรหัส PIN นี้' });
    }

    // Check payment status
    if (bookingRow.payment_status !== 'paid') {
      return res.status(400).json({ success: false, error: 'รายการจองนี้ยังไม่ได้ชำระเงิน กรุณาชำระเงินที่เคาน์เตอร์ก่อน' });
    }

    // Check time window (allow early check-in based on settings, default: 15 mins before start_time)
    const settingRow = await dbQuery.get('SELECT value FROM settings WHERE key = ?', ['early_checkin_minutes']);
    const earlyMins = settingRow && settingRow.value ? parseInt(settingRow.value, 10) : 15;

    const startTime = new Date(bookingRow.start_time);
    const endTime = new Date(bookingRow.end_time);
    const earlyCheckinTime = new Date(startTime.getTime() - earlyMins * 60 * 1000); // Dynamic early checkin

    if (now < earlyCheckinTime) {
      const timeStr = startTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      return res.status(400).json({
        success: false,
        error: `ยังไม่ถึงเวลาเข้าใช้งาน (สามารถเช็คอินได้ล่วงหน้า ${earlyMins} นาที ก่อนเวลา ${timeStr} น.)`
      });
    }

    if (now > endTime) {
      return res.status(400).json({ success: false, error: 'หมดเวลาการเข้าใช้งานห้องประชุมนี้แล้ว' });
    }

    // Mark as checked in
    const checkinTime = getBangkokLocalISO(new Date());
    await dbQuery.run('UPDATE bookings SET checkin_status = "checked_in", checkin_at = ? WHERE id = ?', [checkinTime, bookingRow.booking_id]);
    await dbQuery.run('UPDATE booking_items SET checkin_status = "checked_in", checkin_at = ? WHERE id = ?', [checkinTime, bookingRow.item_id]);

    res.json({
      success: true,
      message: 'อนุมัติการเข้าใช้งาน (Access Granted)',
      customer_name: bookingRow.customer_name,
      room_name: bookingRow.room_name,
      start_time: bookingRow.start_time,
      end_time: bookingRow.end_time
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดของระบบ: ' + err.message });
  }
});

// Check-in via LINE OA
app.post('/api/line/checkin', async (req, res) => {
  const { line_user_id, booking_id } = req.body;

  try {
    let bookingRow;
    if (booking_id) {
      bookingRow = await dbQuery.get(
        `SELECT b.*, bi.start_time, bi.end_time, r.name as room_name
         FROM bookings b
         JOIN booking_items bi ON b.id = bi.booking_id
         LEFT JOIN rooms r ON bi.room_id = r.id
         WHERE b.id = ?`,
        [booking_id]
      );
    } else if (line_user_id) {
      bookingRow = await dbQuery.get(
        `SELECT b.*, bi.start_time, bi.end_time, r.name as room_name
         FROM bookings b
         JOIN booking_items bi ON b.id = bi.booking_id
         LEFT JOIN rooms r ON bi.room_id = r.id
         WHERE b.line_user_id = ? AND b.checkin_status != 'expired'
         ORDER BY bi.start_time ASC LIMIT 1`,
        [line_user_id]
      );
    }

    if (!bookingRow) {
      return res.status(404).json({ success: false, error: 'ไม่พบรายการจองห้องประชุมของคุณในระบบ' });
    }

    if (bookingRow.payment_status !== 'paid') {
      return res.status(400).json({ success: false, error: 'รายการจองนี้ยังไม่ได้ชำระเงิน กรุณาชำระเงินที่เคาน์เตอร์ก่อนรับรหัสเข้าห้อง' });
    }

    const settingRow = await dbQuery.get('SELECT value FROM settings WHERE key = ?', ['early_checkin_minutes']);
    const earlyMins = settingRow && settingRow.value ? parseInt(settingRow.value, 10) : 15;

    const now = new Date();
    const startTime = new Date(bookingRow.start_time);
    const endTime = new Date(bookingRow.end_time);
    const earlyCheckinTime = new Date(startTime.getTime() - earlyMins * 60 * 1000);

    if (now < earlyCheckinTime) {
      const timeStr = startTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      return res.status(400).json({
        success: false,
        error: `ยังไม่ถึงเวลาเช็คอิน (สามารถกดรับรหัสผ่านได้ล่วงหน้า ${earlyMins} นาที ก่อนเวลา ${timeStr} น.)`
      });
    }

    if (now > endTime) {
      return res.status(400).json({ success: false, error: 'หมดเวลาจองใช้งานห้องประชุมนี้แล้ว' });
    }

    res.json({
      success: true,
      pin_code: bookingRow.pin_code,
      customer_name: bookingRow.customer_name,
      room_name: bookingRow.room_name,
      start_time: bookingRow.start_time,
      end_time: bookingRow.end_time,
      receipt_number: bookingRow.receipt_number
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4.5. QUOTATIONS API
// ==========================================
app.get('/api/quotations/next-number', async (req, res) => {
  try {
    const now = new Date();
    const year2 = String(now.getFullYear()).slice(-2);
    const month2 = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `QT-${year2}${month2}`;

    const rows = await dbQuery.all(
      "SELECT quotation_no FROM quotations WHERE quotation_no LIKE ? OR quotation_no LIKE ? OR quotation_no LIKE ? OR quotation_no LIKE ?",
      [`${prefix}%`, `QT-${year2}${month2}%`, `QT${year2}${month2}%`, `QT${now.getFullYear()}${month2}%`]
    );

    let maxSeq = 0;
    rows.forEach(r => {
      if (r.quotation_no) {
        const cleanNo = r.quotation_no.replace(`QT-${year2}${month2}-`, '').replace(`QT-${year2}${month2}`, '').replace(`QT${year2}${month2}`, '');
        const match = cleanNo.match(/(\d+)$/);
        if (match) {
          const seq = parseInt(match[1], 10);
          if (!isNaN(seq) && seq > maxSeq) {
            maxSeq = seq;
          }
        }
      }
    });

    const nextSeqStr = String(maxSeq + 1).padStart(3, '0');
    res.json({ quotation_no: `${prefix}${nextSeqStr}` });
  } catch (err) {
    console.error('Failed to generate next quotation number:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quotations', async (req, res) => {
  const {
    customer_name,
    department,
    contact,
    customer_phone,
    customer_tax_id,
    customer_address,
    seller_name,
    job_name,
    quotation_no,
    total_amount,
    overall_discount,
    overall_discount_percent,
    has_vat,
    wht_rate,
    valid_until,
    issue_date,
    items
  } = req.body;

  if (!customer_name || !items || !items.length) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลลูกค้าและเลือกรายการอย่างน้อย 1 รายการ' });
  }

  try {
    let finalQuotationNo = quotation_no;
    if (!finalQuotationNo || !finalQuotationNo.trim()) {
      const now = new Date();
      const year2 = String(now.getFullYear()).slice(-2);
      const month2 = String(now.getMonth() + 1).padStart(2, '0');
      const prefix = `QT-${year2}${month2}`;
      const rows = await dbQuery.all(
        "SELECT quotation_no FROM quotations WHERE quotation_no LIKE ? OR quotation_no LIKE ? OR quotation_no LIKE ?",
        [`${prefix}%`, `QT${year2}${month2}%`, `QT${now.getFullYear()}${month2}%`]
      );
      let maxSeq = 0;
      rows.forEach(r => {
        if (r.quotation_no) {
          const match = r.quotation_no.match(/(\d+)$/);
          if (match) {
            const seq = parseInt(match[1], 10);
            if (!isNaN(seq) && seq > maxSeq) {
              maxSeq = seq;
            }
          }
        }
      });
      finalQuotationNo = `${prefix}-${String(maxSeq + 1).padStart(4, '0')}`;
    }

    const result = await dbQuery.run(
      `INSERT INTO quotations
       (customer_name, department, contact, customer_phone, customer_tax_id, customer_address, seller_name, job_name, quotation_no, total_amount, overall_discount, overall_discount_percent, has_vat, wht_rate, status, valid_until, issue_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customer_name,
        department || '',
        contact || customer_phone || '',
        customer_phone || contact || '',
        customer_tax_id || '',
        customer_address || '',
        seller_name || '',
        job_name || '',
        finalQuotationNo,
        total_amount || 0,
        overall_discount || 0,
        overall_discount_percent || 0,
        has_vat !== undefined ? (has_vat ? 1 : 0) : 1,
        wht_rate || 0,
        'draft',
        valid_until || '',
        issue_date || ''
      ]
    );
    const quotationId = result.id;

    for (const item of items) {
      await dbQuery.run(
        `INSERT INTO quotation_items
         (quotation_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, discount, item_date, discount_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quotationId,
          item.room_id || null,
          item.service_id || null,
          item.quantity || 1,
          item.price,
          item.start_time || null,
          item.end_time || null,
          item.subtotal,
          item.layout || 'standard',
          item.booking_type || 'hourly',
          item.discount || 0,
          item.item_date || null,
          item.discount_type || 'amount'
        ]
      );
    }

    res.status(201).json({ success: true, quotationId, message: 'สร้างใบเสนอราคาสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/quotations', async (req, res) => {
  const { search, status } = req.query;
  try {
    let sql = 'SELECT * FROM quotations WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (customer_name LIKE ? OR department LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';
    const quotations = await dbQuery.all(sql, params);
    res.json(quotations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/quotations/:id', async (req, res) => {
  try {
    const quotation = await dbQuery.get('SELECT * FROM quotations WHERE id = ?', [req.params.id]);
    if (!quotation) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลใบเสนอราคานี้' });
    }

    const items = await dbQuery.all(
      `SELECT qi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name
       FROM quotation_items qi
       LEFT JOIN rooms r ON qi.room_id = r.id
       LEFT JOIN services s ON qi.service_id = s.id
       WHERE qi.quotation_id = ?`,
      [req.params.id]
    );

    res.json({ ...quotation, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/quotations/:id/status', async (req, res) => {
  const { status } = req.body;
  try {
    const approvedAt = status === 'accepted' ? getBangkokLocalISO(new Date()) : null;
    await dbQuery.run('UPDATE quotations SET status = ?, approved_at = ? WHERE id = ?', [status, approvedAt, req.params.id]);
    res.json({ success: true, message: 'อัปเดตสถานะสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/quotations/:id', async (req, res) => {
  const {
    customer_name,
    department,
    contact,
    customer_phone,
    customer_tax_id,
    customer_address,
    seller_name,
    job_name,
    quotation_no,
    total_amount,
    overall_discount,
    overall_discount_percent,
    has_vat,
    wht_rate,
    valid_until,
    issue_date,
    items
  } = req.body;
  const quotationId = req.params.id;

  if (!customer_name || !items || !items.length) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลลูกค้าและเลือกรายการอย่างน้อย 1 รายการ' });
  }

  try {
    await dbQuery.run(
      `UPDATE quotations SET
        customer_name = ?,
        department = ?,
        contact = ?,
        customer_phone = ?,
        customer_tax_id = ?,
        customer_address = ?,
        seller_name = ?,
        job_name = ?,
        quotation_no = ?,
        total_amount = ?,
        overall_discount = ?,
        overall_discount_percent = ?,
        has_vat = ?,
        wht_rate = ?,
        valid_until = ?,
        issue_date = ?
       WHERE id = ?`,
      [
        customer_name,
        department || '',
        contact || customer_phone || '',
        customer_phone || contact || '',
        customer_tax_id || '',
        customer_address || '',
        seller_name || '',
        job_name || '',
        quotation_no || '',
        total_amount || 0,
        overall_discount || 0,
        overall_discount_percent || 0,
        has_vat !== undefined ? (has_vat ? 1 : 0) : 1,
        wht_rate || 0,
        valid_until || '',
        issue_date || '',
        quotationId
      ]
    );

    await dbQuery.run('DELETE FROM quotation_items WHERE quotation_id = ?', [quotationId]);

    for (const item of items) {
      await dbQuery.run(
        `INSERT INTO quotation_items
         (quotation_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, discount, item_date, discount_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quotationId,
          item.room_id || null,
          item.service_id || null,
          item.quantity || 1,
          item.price,
          item.start_time || null,
          item.end_time || null,
          item.subtotal,
          item.layout || 'standard',
          item.booking_type || 'hourly',
          item.discount || 0,
          item.item_date || null,
          item.discount_type || 'amount'
        ]
      );
    }

    res.json({ success: true, message: 'อัปเดตใบเสนอราคาสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/quotations/:id', async (req, res) => {
  try {
    await dbQuery.run('DELETE FROM quotations WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'ลบใบเสนอราคาสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quotations/:id/convert', async (req, res) => {
  const { payment_status, payment_method } = req.body;
  try {
    const quotation = await dbQuery.get('SELECT * FROM quotations WHERE id = ?', [req.params.id]);
    if (!quotation) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลใบเสนอราคานี้' });
    }

    const items = await dbQuery.all('SELECT * FROM quotation_items WHERE quotation_id = ?', [req.params.id]);

    const result = await dbQuery.transaction(async () => {
      // Check room overlap before conversion
      for (const item of items) {
        if (item.room_id && item.start_time && item.end_time) {
          const normStart = normalizeToLocalISO(item.start_time);
          const normEnd = normalizeToLocalISO(item.end_time);
          const hasOverlap = await checkRoomOverlap(item.room_id, normStart, normEnd);
          if (hasOverlap && hasOverlap.hasOverlap) {
            const err = new Error('ไม่สามารถแปลงเป็นการจองได้ เนื่องจากห้องถูกจองในช่วงเวลาดังกล่าวแล้ว');
            err.statusCode = 409;
            throw err;
          }
        }
      }

      const receiptNumber = await generateReceiptNumber();

      // 1. Insert into bookings
      const bookingResult = await dbQuery.run(
        'INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [quotation.customer_name, quotation.department, quotation.contact, quotation.total_amount, payment_status || 'pending', payment_method || 'cash', receiptNumber, getBangkokLocalISO(new Date())]
      );
      const bookingId = bookingResult.id;

      // 2. Insert items
      for (const item of items) {
        const normStart = item.start_time ? normalizeToLocalISO(item.start_time) : null;
        const normEnd = item.end_time ? normalizeToLocalISO(item.end_time) : null;
        await dbQuery.run(
          `INSERT INTO booking_items
           (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bookingId,
            item.room_id,
            item.service_id,
            item.quantity,
            item.price,
            normStart,
            normEnd,
            item.subtotal,
            item.layout,
            item.booking_type
          ]
        );
      }

      // 3. Update quotation status to converted
      await dbQuery.run("UPDATE quotations SET status = 'accepted', approved_at = ? WHERE id = ?", [getBangkokLocalISO(new Date()), req.params.id]);

      return { bookingId, receiptNumber };
    });

    res.json({ success: true, bookingId: result.bookingId, receiptNumber: result.receiptNumber, message: 'แปลงเป็นรายการจองสำเร็จ' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ==========================================
// 5. DASHBOARD & ANALYTICS
// ==========================================
app.get('/api/dashboard/summary', async (req, res) => {
  const { start_date, end_date } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'กรุณาระบุช่วงเวลาวิเคราะห์' });
  }

  const start = start_date + ' 00:00:00';
  const end = end_date + ' 23:59:59';

  try {
    // 1. KPI Summaries
    const summary = await dbQuery.get(
      `SELECT
        SUM(total_amount) as total_revenue,
        COUNT(id) as total_bookings,
        COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as paid_bookings,
        COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_bookings
       FROM bookings
       WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)`,
      [start, end]
    );

    // 2. Sales Trend (Daily or Monthly depending on date range length)
    const trend = await dbQuery.all(
      `SELECT
        strftime('%Y-%m-%d', created_at) as date,
        SUM(total_amount) as revenue,
        COUNT(id) as bookings
       FROM bookings
       WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)
       GROUP BY date
       ORDER BY date ASC`,
      [start, end]
    );

    // 3. Room utilization/revenue
    const roomsRev = await dbQuery.all(
      `SELECT
        r.name,
        COUNT(bi.id) as booking_count,
        SUM(bi.subtotal) as total_revenue
       FROM booking_items bi
       JOIN rooms r ON bi.room_id = r.id
       JOIN bookings b ON bi.booking_id = b.id
       WHERE datetime(b.created_at) BETWEEN datetime(?) AND datetime(?)
       GROUP BY r.id
       ORDER BY total_revenue DESC`,
      [start, end]
    );

    // 4. Service popularity/revenue
    const servicesRev = await dbQuery.all(
      `SELECT
        s.name,
        SUM(bi.quantity) as total_quantity,
        SUM(bi.subtotal) as total_revenue
       FROM booking_items bi
       JOIN services s ON bi.service_id = s.id
       JOIN bookings b ON bi.booking_id = b.id
       WHERE datetime(b.created_at) BETWEEN datetime(?) AND datetime(?)
       GROUP BY s.id
       ORDER BY total_revenue DESC`,
      [start, end]
    );

    res.json({
      revenue: summary.total_revenue || 0,
      bookingsCount: summary.total_bookings || 0,
      paidCount: summary.paid_bookings || 0,
      pendingCount: summary.pending_bookings || 0,
      trend,
      popularRooms: roomsRev,
      popularServices: servicesRev
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. SETTINGS & BACKUP
// ==========================================
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await dbQuery.all('SELECT * FROM settings');
    const permissions = new Set(String(req.user?.permissions || '').split(',').map(p => p.trim()).filter(Boolean));
    const isAdmin = req.user?.role === 'admin' || req.user?.username === 'admin';
    const safeKeys = new Set([
      'company_name', 'company_address', 'company_tax_id', 'logo_image',
      'receipt_header', 'receipt_footer', 'room_alert_minutes', 'cleaning_buffer_minutes',
      'promptpay_id', 'payment_bank_name', 'payment_bank_account', 'payment_bank_account_name',
      'payment_window_minutes'
    ]);
    const settingsObj = {};
    settings.forEach(s => {
      const canRead = isAdmin
        || permissions.has('admin-management')
        || permissions.has('admin-system')
        || safeKeys.has(s.key)
        || (permissions.has('admin-quotation') && s.key.startsWith('quotation_'))
        || (permissions.has('admin-backup') && s.key.startsWith('onedrive_'));
      if (canRead) {
        if (s.key === 'line_channel_access_token') {
          settingsObj[s.key] = s.value ? '••••••••••••••••••••••••' : '';
          settingsObj.has_line_channel_access_token = !!(s.value && s.value.trim());
        } else if (s.key === 'line_channel_secret') {
          settingsObj[s.key] = s.value ? '••••••••••••••••' : '';
          settingsObj.has_line_channel_secret = !!(s.value && s.value.trim());
        } else {
          settingsObj[s.key] = s.value;
        }
      }
    });
    res.json(settingsObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', requireAnyPermission('admin-management', 'admin-system', 'admin-quotation', 'admin-backup'), async (req, res) => {
  const settings = req.body; // e.g. { company_name: '...', onedrive_path: '...' }
  try {
    const permissions = new Set(String(req.user?.permissions || '').split(',').map(p => p.trim()).filter(Boolean));
    const isAdmin = req.user?.role === 'admin' || req.user?.username === 'admin';
    let writableSettings = Object.entries(settings);
    if (!isAdmin && !permissions.has('admin-management') && !permissions.has('admin-system')) {
      writableSettings = writableSettings.filter(([key]) =>
        (permissions.has('admin-quotation') && key.startsWith('quotation_'))
        || (permissions.has('admin-backup') && key.startsWith('onedrive_'))
      );
    }
    if (writableSettings.length === 0) {
      return res.status(403).json({ error: 'ไม่มีการตั้งค่าที่ได้รับอนุญาตให้แก้ไข' });
    }
    for (const [key, value] of writableSettings) {
      // Guard against overwriting real secrets with mask string or empty string
      if ((key === 'line_channel_access_token' || key === 'line_channel_secret') && (
        !value ||
        String(value).trim() === '' ||
        String(value).includes('•') ||
        String(value).includes('****')
      )) {
        continue;
      }
      let valToSave = value;
      if (key === 'payment_window_minutes') {
        const parsed = parseInt(value, 10);
        valToSave = (isNaN(parsed) || parsed < 1) ? '15' : String(parsed);
      }
      await dbQuery.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, valToSave]
      );
    }
    res.json({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test LINE Messaging API Connection (Bot Info & Credentials Check)
app.post('/api/settings/line/test', requireAnyPermission('admin-management', 'admin-system'), async (req, res) => {
  try {
    const { channel_access_token, channel_secret, liff_id } = req.body || {};

    // Determine Token to use: passed in body (if user typed new unmasked token) or stored in DB
    let tokenToTest = channel_access_token;
    if (!tokenToTest || String(tokenToTest).includes('•') || String(tokenToTest).trim() === '') {
      const row = await dbQuery.get("SELECT value FROM settings WHERE key = 'line_channel_access_token'");
      tokenToTest = row?.value || '';
    }

    // Determine Secret status
    let secretStatus = 'not_configured';
    if (channel_secret && !String(channel_secret).includes('•') && String(channel_secret).trim() !== '') {
      secretStatus = 'configured';
    } else {
      const rowSec = await dbQuery.get("SELECT value FROM settings WHERE key = 'line_channel_secret'");
      if (rowSec?.value && rowSec.value.trim().length > 0) {
        secretStatus = 'configured';
      }
    }

    // Determine LIFF ID status
    let liffIdToCheck = liff_id;
    if (!liffIdToCheck || String(liffIdToCheck).trim() === '') {
      const rowLiff = await dbQuery.get("SELECT value FROM settings WHERE key = 'line_liff_id'");
      liffIdToCheck = rowLiff?.value || '';
    }
    let liffIdStatus = 'not_configured';
    if (liffIdToCheck && liffIdToCheck.trim()) {
      const liffRegex = /^\d{10}-[A-Za-z0-9_-]+$/;
      if (liffRegex.test(liffIdToCheck.trim())) {
        liffIdStatus = 'valid_format';
      } else {
        liffIdStatus = 'invalid_format';
      }
    }

    if (!tokenToTest || String(tokenToTest).trim() === '') {
      return res.json({
        success: false,
        connected: false,
        error: 'ยังไม่ได้ระบุหรือบันทึก LINE Channel Access Token ในระบบ',
        channelSecretStatus: secretStatus,
        liffIdStatus: liffIdStatus
      });
    }

    // Call LINE Official API to verify Bot Info
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const lineRes = await fetch('https://api.line.me/v2/bot/info', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokenToTest.trim()}`
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (lineRes.ok) {
      const botData = await lineRes.json();
      return res.json({
        success: true,
        connected: true,
        bot: {
          name: botData.displayName || 'LINE Official Account',
          basicId: botData.basicId || ''
        },
        channelSecretStatus: secretStatus,
        liffIdStatus: liffIdStatus,
        message: 'เชื่อมต่อกับ LINE Messaging API สำเร็จ'
      });
    } else {
      let errDetail = 'ไม่สามารถเชื่อมต่อกับ LINE API ได้';
      if (lineRes.status === 401) {
        errDetail = 'LINE Channel Access Token ไม่ถูกต้อง หรือหมดอายุแล้ว (401 Unauthorized)';
      } else if (lineRes.status === 403) {
        errDetail = 'LINE Channel Access Token ไม่มีสิทธิ์เข้าถึง (403 Forbidden)';
      } else {
        errDetail = `เกิดข้อผิดพลาดจาก LINE API (HTTP ${lineRes.status})`;
      }

      return res.json({
        success: false,
        connected: false,
        error: errDetail,
        channelSecretStatus: secretStatus,
        liffIdStatus: liffIdStatus
      });
    }
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return res.json({
      success: false,
      connected: false,
      error: isTimeout
        ? 'การเชื่อมต่อไปยัง LINE API หมดเวลา (Timeout 8 วินาที)'
        : `เกิดข้อผิดพลาดในการเชื่อมต่อ (${err.message})`,
      channelSecretStatus: 'unknown',
      liffIdStatus: 'unknown'
    });
  }
});

// Direct Full Database SQL Dump Download (Attachment)
app.get('/api/backup/download-sql', async (req, res) => {
  try {
    const sql = await generateDatabaseDumpSql(q => dbQuery.all(q));
    const now = new Date();
    const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `bwork_pos_backup_${dStr}.sql`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(sql);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore Full Database from SQL Dump
app.post('/api/backup/restore-sql', async (req, res) => {
  const { sqlContent } = req.body;
  if (!sqlContent || typeof sqlContent !== 'string' || !sqlContent.trim()) {
    return res.status(400).json({ error: 'ไม่พบเนื้อหาไฟล์ SQL สำหรับกู้คืน' });
  }

  try {
    await dbQuery.exec(sqlContent);
    res.json({
      success: true,
      message: 'กู้คืนฐานข้อมูลจากไฟล์ .sql สำเร็จเรียบร้อยแล้ว'
    });
  } catch (err) {
    res.status(500).json({ error: 'การกู้คืนล้มเหลว: ' + err.message });
  }
});

// OneDrive Connection Status
app.get('/api/backup/onedrive/status', async (req, res) => {
  try {
    const refTokenRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_refresh_token'");
    const emailRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_user_email'");
    const lastBackupRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_last_backup'");
    const lastFileRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_last_file'");
    const clientIdRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_client_id'");

    res.json({
      connected: !!(refTokenRow && refTokenRow.value),
      userEmail: emailRow ? emailRow.value : '',
      lastBackup: lastBackupRow ? lastBackupRow.value : null,
      lastFile: lastFileRow ? lastFileRow.value : '',
      clientId: clientIdRow ? clientIdRow.value : ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get OneDrive OAuth URL
app.get('/api/backup/onedrive/auth-url', async (req, res) => {
  try {
    const { redirect_uri } = req.query;
    const clientIdRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_client_id'");
    const authUrl = getOneDriveAuthUrl(clientIdRow?.value, redirect_uri || `${req.protocol}://${req.get('host')}/api/backup/onedrive/callback`);
    res.json({ authUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save / Connect OneDrive Token
app.post('/api/backup/onedrive/connect', async (req, res) => {
  const { code, redirect_uri, client_id, client_secret } = req.body;
  try {
    if (client_id) {
      await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_client_id', ?)", [client_id]);
    }
    if (client_secret) {
      await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_client_secret', ?)", [client_secret]);
    }

    const tokenData = await exchangeOneDriveCode(code, client_id, client_secret, redirect_uri);
    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_refresh_token', ?)", [tokenData.refresh_token]);
    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_user_email', ?)", [tokenData.user_email]);

    res.json({
      success: true,
      message: `เชื่อมต่อบัญชี OneDrive (${tokenData.user_email}) สำเร็จ`,
      userEmail: tokenData.user_email
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger Manual OneDrive Cloud Backup
app.post('/api/backup/onedrive/trigger', async (req, res) => {
  try {
    const refTokenRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_refresh_token'");
    if (!refTokenRow || !refTokenRow.value) {
      return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อบัญชี OneDrive กรุณากดเชื่อมต่อบัญชีก่อนทำการสำรองข้อมูล' });
    }
    const clientIdRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_client_id'");
    const clientSecretRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_client_secret'");

    const tokenData = await refreshOneDriveAccessToken(refTokenRow.value, clientIdRow?.value, clientSecretRow?.value);
    if (tokenData.refresh_token && tokenData.refresh_token !== refTokenRow.value) {
      await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_refresh_token', ?)", [tokenData.refresh_token]);
    }

    const sql = await generateDatabaseDumpSql(q => dbQuery.all(q));
    const now = new Date();
    const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `bwork_backup_${dStr}.sql`;

    const uploadRes = await uploadSqlToOneDrive(tokenData.access_token, fileName, sql, 'Bwork_POS_Backups');

    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_last_backup', ?)", [now.toISOString()]);
    await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_last_file', ?)", [fileName]);

    res.json({
      success: true,
      message: 'สำรองข้อมูลและอัปโหลดขึ้น OneDrive สำเร็จแล้ว',
      file: uploadRes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect OneDrive
app.post('/api/backup/onedrive/disconnect', async (req, res) => {
  try {
    await dbQuery.run("DELETE FROM settings WHERE key IN ('onedrive_refresh_token', 'onedrive_user_email', 'onedrive_last_backup', 'onedrive_last_file')");
    res.json({ success: true, message: 'ยกเลิกการเชื่อมต่อ OneDrive เรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy Local Manual backup trigger
app.post('/api/backup/trigger', async (req, res) => {
  const result = await performBackup();
  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

// Clear transaction and booking history (admin only)
app.post('/api/admin/clear-history', async (req, res) => {
  try {
    await dbQuery.run('DELETE FROM booking_items');
    await dbQuery.run('DELETE FROM bookings');
    await dbQuery.run('DELETE FROM quotation_items');
    await dbQuery.run('DELETE FROM quotations');
    await dbQuery.run("DELETE FROM sqlite_sequence WHERE name IN ('bookings', 'booking_items', 'quotations', 'quotation_items')");

    res.json({ success: true, message: 'ล้างประวัติการใช้งานและประวัติใบเสนอราคาทั้งหมดเรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// Fetch rooms with active occupancy details based on client local time
app.get('/api/rooms/occupancy', async (req, res) => {
  const { current_time } = req.query; // Client local time in ISO YYYY-MM-DDTHH:MM format
  if (!current_time) {
    return res.status(400).json({ error: 'กรุณาระบุเวลาปัจจุบันของเครื่องเพื่อตรวจสอบ' });
  }

  try {
    const currentTimeISO = (current_time ? normalizeToLocalISO(current_time) : getBangkokLocalISO(new Date())).replace(' ', 'T');
    const rooms = await dbQuery.all('SELECT * FROM rooms WHERE status = "active"');
    const roomsOccupancy = [];

    for (const room of rooms) {
      // Find if there is an active/valid booking overlapping with the current local time
      const activeBooking = await dbQuery.get(
        `SELECT bi.id as item_id, b.id as booking_id, b.customer_name, b.department, b.booking_source,
                bi.start_time, bi.end_time, b.payment_status, b.pin_code
         FROM booking_items bi
         JOIN bookings b ON bi.booking_id = b.id
         WHERE bi.room_id = ?
           AND replace(bi.start_time, ' ', 'T') <= ?
           AND replace(bi.end_time, ' ', 'T') > ?
           AND b.payment_status IN ('paid', 'internal_free', 'pending', 'reviewing', 'rejected', 'unpaid')
           AND b.payment_status != 'cancelled'
           AND (b.checkin_status IS NULL OR b.checkin_status != 'cancelled')
           AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
          ORDER BY
            CASE
             WHEN b.payment_status IN ('paid', 'internal_free') THEN 1
             WHEN b.payment_status = 'reviewing' THEN 2
             WHEN b.payment_status IN ('pending', 'unpaid') THEN 3
             WHEN b.payment_status = 'rejected' THEN 4
             ELSE 5
           END ASC,
           bi.id DESC
         LIMIT 1`,
        [room.id, currentTimeISO, currentTimeISO]
      );

      roomsOccupancy.push({
        ...room,
        isOccupied: !!activeBooking,
        is_occupied: !!activeBooking,
        currentBooking: activeBooking || null,
        current_booking: activeBooking || null
      });
    }

    res.json(roomsOccupancy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 8. USER MANAGEMENT & PASSWORD RESET
// ==========================================

// Change password for currently logged-in user
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    const user = await dbQuery.get(
      'SELECT id, password_hash FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user || !verifyPassword(oldPassword, user.password_hash)) {
      return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
    }

    const newHash = hashPassword(newPassword);
    await dbQuery.run(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newHash, user.id]
    );

    res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all roles (admin only)
app.get('/api/roles', async (req, res) => {
  try {
    const roles = await dbQuery.all('SELECT id, name, label, permissions, is_system FROM roles');
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new role (admin only)
app.post('/api/roles', async (req, res) => {
  const { name, label, permissions } = req.body;
  if (!name || !label || !permissions) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลบทบาทให้ครบถ้วน' });
  }

  // Clean role name to prevent spaces or special characters
  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!cleanName) {
    return res.status(400).json({ error: 'ชื่อรหัสบทบาทไม่ถูกต้อง (กรุณาใช้ภาษาอังกฤษตัวพิมพ์เล็กและตัวเลขเท่านั้น)' });
  }

  try {
    const existing = await dbQuery.get('SELECT id FROM roles WHERE name = ?', [cleanName]);
    if (existing) {
      return res.status(400).json({ error: 'รหัสบทบาทนี้มีอยู่ในระบบแล้ว' });
    }

    await dbQuery.run(
      'INSERT INTO roles (name, label, permissions, is_system) VALUES (?, ?, ?, 0)',
      [cleanName, label.trim(), permissions]
    );
    res.status(201).json({ success: true, name: cleanName, label: label.trim(), permissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update role details (admin only)
app.put('/api/roles/:id', async (req, res) => {
  const { label, permissions } = req.body;
  if (!label || !permissions) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    const role = await dbQuery.get('SELECT name, is_system FROM roles WHERE id = ?', [req.params.id]);
    if (!role) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลบทบาทนี้' });
    }


    await dbQuery.run(
      'UPDATE roles SET label = ?, permissions = ? WHERE id = ?',
      [label.trim(), permissions, req.params.id]
    );
    res.json({ success: true, message: 'บันทึกข้อมูลบทบาทสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete role (admin only)
app.delete('/api/roles/:id', async (req, res) => {
  try {
    const role = await dbQuery.get('SELECT name, is_system FROM roles WHERE id = ?', [req.params.id]);
    if (!role) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลบทบาทนี้' });
    }

    if (role.is_system === 1) {
      return res.status(400).json({ error: 'ไม่สามารถลบบทบาทพื้นฐานของระบบได้' });
    }

    // Check if any user is currently assigned to this role
    const assignedUser = await dbQuery.get('SELECT id FROM users WHERE role = ?', [role.name]);
    if (assignedUser) {
      return res.status(400).json({ error: 'ไม่สามารถลบบทบาทนี้ได้เนื่องจากยังมีผู้ใช้งานที่ใช้บทบาทนี้อยู่' });
    }

    await dbQuery.run('DELETE FROM roles WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'ลบบทบาทสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List users (admin only)
app.get('/api/users', async (req, res) => {
  try {
    const users = await dbQuery.all(`
      SELECT u.id, u.username, u.role, COALESCE(u.permissions, r.permissions, '') as permissions, u.fullname, u.pin_code, u.created_at, r.label as role_label
      FROM users u
      LEFT JOIN roles r ON u.role = r.name
    `);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add user (admin only)
app.post('/api/users', async (req, res) => {
  const { username, password, role, fullname, pin_code, permissions } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลผู้ใช้ให้ครบถ้วน' });
  }

  try {
    const password_hash = hashPassword(password);
    const pinHashed = pin_code && String(pin_code).trim() ? (String(pin_code).startsWith('scrypt$') ? pin_code : hashPassword(String(pin_code).trim())) : null;
    const result = await dbQuery.run(
      'INSERT INTO users (username, password_hash, role, fullname, pin_code, permissions) VALUES (?, ?, ?, ?, ?, ?)',
      [username, password_hash, role, fullname || 'พนักงาน Bwork', pinHashed, permissions || null]
    );
    res.status(201).json({ id: result.id, username, role, fullname: fullname || 'พนักงาน Bwork', pin_code });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      res.status(400).json({ error: 'ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Update user details (admin only)
app.put('/api/users/:id', async (req, res) => {
  const { username, role, fullname, pin_code, permissions } = req.body;
  try {
    const user = await dbQuery.get('SELECT username, pin_code FROM users WHERE id = ?', [req.params.id]);
    if (!user) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
    }

    let targetUsername = username;
    let targetRole = role;

    // Safety check: protect the main 'admin' account credentials & role integrity
    if (user.username === 'admin') {
      targetUsername = 'admin';
      targetRole = 'admin';
    }

    // Check unique username constraint if it has changed
    if (targetUsername !== user.username) {
      const existing = await dbQuery.get('SELECT id FROM users WHERE username = ?', [targetUsername]);
      if (existing) {
        return res.status(400).json({ error: 'ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว' });
      }
    }

    let finalPin = user.pin_code;
    if (pin_code !== undefined) {
      if (pin_code && String(pin_code).trim()) {
        finalPin = String(pin_code).startsWith('scrypt$') ? pin_code : hashPassword(String(pin_code).trim());
      } else {
        finalPin = null;
      }
    }

    await dbQuery.run(
      'UPDATE users SET username = ?, role = ?, fullname = ?, pin_code = ?, permissions = ? WHERE id = ?',
      [targetUsername, targetRole, fullname, finalPin, permissions !== undefined ? permissions : null, req.params.id]
    );

    res.json({ success: true, message: 'บันทึกข้อมูลผู้ใช้สำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user (admin only)
app.delete('/api/users/:id', async (req, res) => {
  try {
    const user = await dbQuery.get('SELECT username FROM users WHERE id = ?', [req.params.id]);
    if (user && user.username === 'admin') {
      return res.status(400).json({ error: 'ไม่สามารถลบผู้ใช้หลัก admin ได้' });
    }

    await dbQuery.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'ลบผู้ใช้สำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset password for a user (admin only)
app.post('/api/users/:id/reset-password', async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ error: 'กรุณาระบุรหัสผ่านใหม่' });
  }

  try {
    const password_hash = hashPassword(newPassword);
    await dbQuery.run(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [password_hash, req.params.id]
    );
    res.json({ message: 'รีเซ็ตรหัสผ่านสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-run backup daily at midnight / hourly check (local time & OneDrive cloud)
let lastBackupDate = '';
async function runDailyAutomatedBackup() {
  const todayStr = getBangkokLocalISO(new Date()).slice(0, 10);
  if (lastBackupDate === todayStr) return;

  console.log('Automated Daily Backup started...');
  try {
    // 1. Local backup
    await performBackup();

    // 2. OneDrive cloud backup if connected
    const refTokenRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_refresh_token'");
    if (refTokenRow && refTokenRow.value) {
      const clientIdRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_client_id'");
      const clientSecretRow = await dbQuery.get("SELECT value FROM settings WHERE key = 'onedrive_client_secret'");
      const tokenData = await refreshOneDriveAccessToken(refTokenRow.value, clientIdRow?.value, clientSecretRow?.value);
      if (tokenData.refresh_token && tokenData.refresh_token !== refTokenRow.value) {
        await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_refresh_token', ?)", [tokenData.refresh_token]);
      }
      const sql = await generateDatabaseDumpSql(q => dbQuery.all(q));
      const now = new Date();
      const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `bwork_backup_${dStr}.sql`;
      await uploadSqlToOneDrive(tokenData.access_token, fileName, sql, 'Bwork_POS_Backups');
      await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_last_backup', ?)", [now.toISOString()]);
      await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_last_file', ?)", [fileName]);
      console.log('Automated OneDrive Backup uploaded successfully:', fileName);
    }
    lastBackupDate = todayStr;
  } catch (err) {
    console.error('Daily automated backup failed:', err);
  }
}

setInterval(runDailyAutomatedBackup, 60 * 60 * 1000); // Check every hour


// Ensure uploads directory exists outside public folder (prevents deletion on frontend rebuilds)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Copy legacy uploads from public/uploads to new uploads folder if any exist
const legacyUploadsDir = path.join(__dirname, 'public', 'uploads');
if (fs.existsSync(legacyUploadsDir)) {
  try {
    const files = fs.readdirSync(legacyUploadsDir);
    files.forEach(file => {
      const srcPath = path.join(legacyUploadsDir, file);
      const destPath = path.join(uploadsDir, file);
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    });
    console.log('Legacy uploads synchronized successfully.');
  } catch (err) {
    console.error('Failed to sync legacy uploads:', err);
  }
}

// Upload base64 image (admin and staff)
app.post('/api/upload', async (req, res) => {
  const { imageName, base64Data } = req.body;
  if (!base64Data) {
    return res.status(400).json({ error: 'กรุณาส่งข้อมูลรูปภาพ' });
  }
  try {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'รูปแบบไฟล์รูปภาพไม่ถูกต้อง' });
    }

    const imageBuffer = Buffer.from(matches[2], 'base64');
    // Ensure size is within limits (max 3MB)
    if (imageBuffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({ error: 'ขนาดรูปภาพเกิน 3MB กรุณาอัปโหลดรูปที่มีขนาดเล็กลง' });
    }

    const fileExtension = matches[1].split('/')[1] || 'png';
    const fileName = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExtension}`;
    const filePath = path.join(uploadsDir, fileName);

    fs.writeFileSync(filePath, imageBuffer);
    res.json({ success: true, url: `/uploads/${fileName}` });
  } catch (err) {
    res.status(500).json({ error: 'ล้มเหลวในการบันทึกไฟล์รูปภาพ: ' + err.message });
  }
});

// ==========================================
// PUBLIC BOOKING API (Customer-facing, no auth required)
// ==========================================

// Helper to sort rooms numerically by room number extracted from name (e.g. 201, 202, 301, 306)
const sortRoomsByNumber = (roomList) => {
  return [...roomList].sort((a, b) => {
    const matchA = (a.name || '').match(/\d+/);
    const matchB = (b.name || '').match(/\d+/);
    const numA = matchA ? parseInt(matchA[0]) : 9999;
    const numB = matchB ? parseInt(matchB[0]) : 9999;
    if (numA !== numB) return numA - numB;
    return (a.name || '').localeCompare(b.name || '');
  });
};

function generateBookingAccessToken() {
  return crypto.randomBytes(32).toString('hex');
}

function normalizeContact(value) {
  return String(value || '').replace(/\D/g, '');
}

function safeEqualString(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left), 'utf8');
  const rightBuffer = Buffer.from(String(right), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasPublicBookingAccess(req, booking) {
  const suppliedToken = req.get('x-booking-token') || req.query.access_token || req.body?.access_token;
  const suppliedContact = req.get('x-booking-contact') || req.query.contact || req.body?.contact;
  const tokenMatches = booking.qr_token && safeEqualString(suppliedToken, booking.qr_token);
  const contactMatches = normalizeContact(suppliedContact).length >= 9
    && safeEqualString(normalizeContact(suppliedContact), normalizeContact(booking.contact));
  return Boolean(tokenMatches || contactMatches);
}

function sanitizePublicBooking(booking) {
  const {
    pin_code,
    qr_token,
    line_user_id,
    slip_trans_ref,
    slip_image_url,
    customer_email,
    tax_name,
    tax_address,
    tax_id,
    tax_phone,
    tax_delivery_method,
    tax_postal_address,
    internal_department,
    ...safeBooking
  } = booking || {};
  return { ...safeBooking, has_slip: Boolean(slip_image_url) };
}

function sanitizePublicBookingItem(item) {
  const { pin_code, ...safeItem } = item || {};
  return safeItem;
}

// Get all active rooms for public display
app.get('/api/public/rooms', async (req, res) => {
  try {
    const rooms = await dbQuery.all(
      `SELECT id, name, capacity, hourly_rate, daily_rate, half_day_rate,
              has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url,
              description, image_url, category, has_hourly, has_halfday, has_daily
       FROM rooms WHERE status = 'active'`
    );
    res.json(sortRoomsByNumber(rooms));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get daily room schedule matrix (shows booked intervals for a specific date)
app.get('/api/public/rooms/schedule', async (req, res) => {
  const { date } = req.query;
  const targetDate = date || getBangkokLocalISO(new Date()).split('T')[0];

  try {
    const rawRooms = await dbQuery.all(
      `SELECT id, name, capacity, hourly_rate, daily_rate, half_day_rate,
              has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url,
              description, image_url, category, has_hourly, has_halfday, has_daily
       FROM rooms WHERE status = 'active'`
    );
    const rooms = sortRoomsByNumber(rawRooms);
    const bufferMins = await getCleaningBufferMinutes();

    const startOfDay = `${targetDate}T00:00:00`;
    const endOfDay = `${targetDate}T23:59:59`;

    // Fetch all booking items for target date
    const bookingItems = await dbQuery.all(
      `SELECT bi.room_id, bi.start_time, bi.end_time, b.customer_name, b.payment_status
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.id
       WHERE bi.start_time >= ? AND bi.start_time <= ?
         AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
         AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')`,
      [startOfDay, endOfDay]
    );

    // Map bookings to each room
    const roomsWithSchedule = rooms.map(room => {
      const roomBookings = bookingItems
        .filter(bi => bi.room_id === room.id)
        .map(bi => ({
          start_time: bi.start_time ? bi.start_time.split('T')[1].substring(0, 5) : '00:00',
          end_time: bi.end_time ? bi.end_time.split('T')[1].substring(0, 5) : '23:59',
          status: bi.payment_status
        }));

      return {
        ...room,
        bookings: roomBookings
      };
    });

    res.json({
      date: targetDate,
      cleaning_buffer_minutes: bufferMins,
      rooms: roomsWithSchedule
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search available rooms by date/time/capacity
app.get('/api/public/rooms/available', async (req, res) => {
  const { date, start_time, end_time, guests } = req.query;
  if (!date || !start_time || !end_time) {
    return res.status(400).json({ error: 'กรุณาระบุวันที่ เวลาเริ่มต้น และเวลาสิ้นสุด' });
  }

  try {
    const bufferMins = await getCleaningBufferMinutes();
    const bufferMs = bufferMins * 60 * 1000;

    // Parse requested time to timestamps (handles ISO UTC / Local strings seamlessly)
    const reqStartMs = new Date(`${date}T${start_time}:00`).getTime();
    const reqEndMs = new Date(`${date}T${end_time}:00`).getTime();
    const reqEndBufferedMs = reqEndMs + bufferMs;
    const guestCount = parseInt(guests) || 1;

    // Get all active rooms with sufficient capacity
    const allRooms = await dbQuery.all(
      `SELECT id, name, capacity, hourly_rate, daily_rate, half_day_rate,
              has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity,
              description, image_url, category, has_hourly, has_halfday, has_daily
       FROM rooms
       WHERE status = 'active' AND (capacity >= ? OR classroom_capacity >= ?)`,
      [guestCount, guestCount]
    );

    // Check each room for overlapping bookings from both POS (walk-in/phone) and online web app
    const availableRooms = [];
    for (const room of allRooms) {
      const roomBookings = await dbQuery.all(
        `SELECT bi.start_time, bi.end_time, b.payment_status
         FROM booking_items bi
         JOIN bookings b ON bi.booking_id = b.id
         WHERE bi.room_id = ?
           AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
           AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')`,
        [room.id]
      );

      let isOverlapped = false;
      for (const b of roomBookings) {
        if (!b.start_time || !b.end_time) continue;

        // Convert to timestamp with normalized ISO
        const bStartNorm = normalizeToLocalISO(b.start_time);
        const bEndNorm = normalizeToLocalISO(b.end_time);
        const bStartMs = new Date(bStartNorm.replace(' ', 'T')).getTime();
        const bEndMs = new Date(bEndNorm.replace(' ', 'T')).getTime();

        if (isNaN(bStartMs) || isNaN(bEndMs)) continue;
        const bEndBufferedMs = bEndMs + bufferMs;

        // Overlap: bStartMs < reqEndBufferedMs AND bEndBufferedMs > reqStartMs
        if (bStartMs < reqEndBufferedMs && bEndBufferedMs > reqStartMs) {
          isOverlapped = true;
          break;
        }
      }

      if (!isOverlapped) {
        availableRooms.push(room);
      }
    }

    res.json(sortRoomsByNumber(availableRooms));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a public online booking
app.post('/api/public/bookings', async (req, res) => {
  const {
    customer_name, contact, email, department, note, room_id, booking_date,
    start_time, end_time, booking_type, layout, total_amount, line_user_id,
    tax_invoice_required, tax_name, tax_address, tax_id, tax_phone,
    tax_delivery_method, tax_postal_address, guest_count, guests
  } = req.body;

  if (!customer_name || !contact || !room_id || !booking_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน (ชื่อ, เบอร์โทร, ห้อง, วันที่, เวลา)' });
  }

  // Mandatory guest_count validation for online bookings
  const parsedGuests = parseInt(guest_count || guests, 10);
  if (isNaN(parsedGuests) || parsedGuests < 1) {
    return res.status(400).json({ error: 'กรุณาระบุจำนวนผู้เข้าใช้งาน (อย่างน้อย 1 ท่าน)' });
  }

  // Validate time order
  if (end_time <= start_time) {
    return res.status(400).json({ error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' });
  }

  // Validate not past date or past time based on real clock
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (booking_date < todayStr) {
    return res.status(400).json({ error: 'ไม่สามารถจองวันที่ผ่านมาแล้วได้' });
  }
  if (booking_date === todayStr) {
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const [sH, sM] = start_time.split(':').map(Number);
    if ((sH * 60 + sM) < currentMins) {
      return res.status(400).json({ error: 'ไม่สามารถจองเวลาย้อนหลังได้ กรุณาเลือกเวลาปัจจุบันเป็นต้นไป' });
    }
  }

  try {
    const result = await dbQuery.transaction(async () => {
      // Verify room exists and is active
      const room = await dbQuery.get('SELECT * FROM rooms WHERE id = ? AND status = ?', [room_id, 'active']);
      if (!room) {
        const err = new Error('ไม่พบห้องที่เลือก หรือห้องไม่พร้อมใช้งาน');
        err.statusCode = 404;
        throw err;
      }

      // Normalize timestamps
      const fullStart = normalizeToLocalISO(booking_date, start_time);
      const fullEnd = normalizeToLocalISO(booking_date, end_time);

      // Check for overlap (cross-system safe including 30-min cleaning buffer)
      const overlapResult = await checkRoomOverlap(room_id, fullStart, fullEnd);
      if (overlapResult.hasOverlap) {
        const err = new Error(formatOverlapErrorMessage(room.name, overlapResult));
        err.statusCode = 409;
        throw err;
      }

      // Calculate price
      let price = room.hourly_rate;
      let quantity = 1;
      const bType = booking_type || 'hourly';
      const bLayout = layout || 'standard';

      if (bType === 'daily') {
        price = bLayout === 'classroom' ? (room.classroom_daily_rate || room.daily_rate) : room.daily_rate;
        quantity = 1;
      } else if (bType === 'halfday') {
        price = room.half_day_rate;
        quantity = 1;
      } else {
        price = bLayout === 'classroom' ? (room.classroom_hourly_rate || room.hourly_rate) : room.hourly_rate;
        const startParts = start_time.split(':');
        const endParts = end_time.split(':');
        const startMinutes = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
        const endMinutes = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);
        quantity = Math.max(1, Math.ceil((endMinutes - startMinutes) / 60));
      }

      // The server, not the browser, is the source of truth for public pricing.
      const subtotal = Math.round(price * quantity * 100) / 100;

      const receiptNumber = await generateReceiptNumber();
      const accessToken = generateBookingAccessToken();

      let pinCode = null;
      if (!roomUsesDoorPin(room || room_id)) {
        pinCode = null;
      } else if (room.pin_code && room.pin_code.trim()) {
        pinCode = room.pin_code.trim();
      } else {
        pinCode = await generateUniquePinCode();
      }

      // Insert master booking (with mandatory guest_count, booking_channel = 'line_oa', customer_type = 'general')
      const bookingResult = await dbQuery.run(
        `INSERT INTO bookings (
          customer_name, department, contact, total_amount, payment_status, payment_method,
          receipt_number, pin_code, qr_token, booking_source, booking_channel, customer_type, customer_email, checkin_status, line_user_id,
          tax_invoice_required, tax_name, tax_address, tax_id, tax_phone, tax_delivery_method, tax_postal_address,
          guest_count,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer_name, department || note || '', contact, subtotal, 'pending', 'transfer',
          receiptNumber, pinCode, accessToken, 'online', 'line_oa', 'general', email || null, 'pending', line_user_id || null,
          tax_invoice_required ? 1 : 0, tax_name || null, tax_address || null, tax_id || null, tax_phone || null,
          tax_delivery_method || null, tax_postal_address || null,
          parsedGuests,
          getBangkokLocalISO(new Date())
        ]
      );
      const bookingId = bookingResult.id;

      // Insert booking item (with guest_count)
      await dbQuery.run(
        `INSERT INTO booking_items
         (booking_id, room_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, guest_count, pin_code, checkin_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bookingId, room_id, quantity, price, fullStart, fullEnd, subtotal, bLayout, bType, parsedGuests, pinCode, 'pending']
      );

      const bookingCode = `BK-${String(bookingId).padStart(6, '0')}`;

      return {
        bookingId,
        bookingCode,
        receiptNumber,
        accessToken,
        subtotal
      };
    });

    const pwSetting = await dbQuery.get("SELECT value FROM settings WHERE key = 'payment_window_minutes'");
    const paymentWindowMinutes = Math.max(1, parseInt(pwSetting?.value || '15', 10) || 15);

    res.status(201).json({
      success: true,
      bookingId: result.bookingId,
      bookingCode: result.bookingCode,
      receiptNumber: result.receiptNumber,
      accessToken: result.accessToken,
      access_token: result.accessToken,
      totalAmount: result.subtotal,
      paymentDeadline: new Date(Date.now() + paymentWindowMinutes * 60 * 1000).toISOString(),
      payment_window_minutes: paymentWindowMinutes,
      message: `จองห้องประชุมสำเร็จ! กรุณาชำระเงินและแนบสลิปภายใน ${paymentWindowMinutes} นาที`
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'เกิดข้อผิดพลาดในการบันทึกการจอง' });
  }
});

// Lookup Bookings By Phone Number (for Status Page)
app.get(['/api/public/bookings/by-phone', '/api/public/bookings/lookup'], async (req, res) => {
  const phone = req.query.phone || req.query.contact;
  const cleanPhone = normalizeContact(phone);
  if (cleanPhone.length < 9 || cleanPhone.length > 15) {
    return res.status(400).json({ error: 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง' });
  }

  try {
    const bookings = await dbQuery.all(
      `SELECT * FROM bookings
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(contact, '-', ''), ' ', ''), '+', ''), '(', ''), ')', '') = ?
       ORDER BY id DESC LIMIT 10`,
      [cleanPhone]
    );

    if (!bookings || !bookings.length) {
      return res.status(404).json({ error: 'ไม่พบรายการจองสำหรับเบอร์โทรศัพท์นี้ กรุณาตรวจสอบเบอร์อีกครั้ง' });
    }

    for (let b of bookings) {
      const items = await dbQuery.all(
        `SELECT bi.*, r.name as room_name, r.capacity, r.image_url, r.description
         FROM booking_items bi
         LEFT JOIN rooms r ON bi.room_id = r.id
         WHERE bi.booking_id = ?`,
        [b.id]
      );
      b.items = (items || []).map(sanitizePublicBookingItem);
      b.bookingCode = `BK-${String(b.id).padStart(6, '0')}`;
      if (items && items.length && items[0].room_name) {
        b.room_name = items[0].room_name;
        b.room = { id: items[0].room_id, name: items[0].room_name, capacity: items[0].capacity, image_url: items[0].image_url };
        b.raw_start_time = items[0].start_time;
        b.raw_end_time = items[0].end_time;
        b.start_time = items[0].start_time?.includes('T') ? items[0].start_time.split('T')[1].substring(0, 5) : items[0].start_time;
        b.end_time = items[0].end_time?.includes('T') ? items[0].end_time.split('T')[1].substring(0, 5) : items[0].end_time;
        b.usage_date = items[0].start_time?.includes('T') ? items[0].start_time.split('T')[0] : (b.booking_date || b.created_at?.split('T')[0] || b.created_at?.split(' ')[0]);
        b.created_date = b.created_at ? (b.created_at.includes('T') ? b.created_at.replace('T', ' ').substring(0, 19) : b.created_at) : '';
      }
      if (b.payment_status === 'rejected' || b.slip_verify_status === 'rejected') {
        const rejRow = await dbQuery.get(
          "SELECT rejection_reason FROM slip_verifications WHERE booking_id = ? AND verification_status = 'rejected' ORDER BY id DESC LIMIT 1",
          [b.id]
        );
        b.rejection_reason = rejRow?.rejection_reason || null;
      } else {
        b.rejection_reason = null;
      }
    }

    res.json({ success: true, bookings: bookings.map(sanitizePublicBooking) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer requests Door PIN via Web
app.post('/api/public/bookings/:id/request-pin', async (req, res) => {
  const { id } = req.params;
  let numericId = null;
  if (!isNaN(id)) {
    numericId = parseInt(id, 10);
  } else if (typeof id === 'string' && id.startsWith('BK-')) {
    const raw = id.replace('BK-', '');
    if (!isNaN(raw)) {
      numericId = parseInt(raw, 10);
    }
  }

  try {
    const booking = await dbQuery.get(
      'SELECT * FROM bookings WHERE id = ? OR id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)',
      [numericId, id, id, id]
    );
    if (!booking) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
    }

    if (!hasPublicBookingAccess(req, booking)) {
      return res.status(403).json({ error: 'กรุณายืนยันเบอร์โทรศัพท์หรือสิทธิ์เข้าถึงรายการจอง' });
    }

    if (booking.payment_status !== 'paid') {
      return res.status(400).json({ error: 'รายการจองนี้ยังไม่ได้รับการยืนยันชำระเงิน กรุณาติดต่อพนักงาน' });
    }

    const item = await dbQuery.get('SELECT * FROM booking_items WHERE booking_id = ? AND room_id IS NOT NULL ORDER BY id ASC LIMIT 1', [booking.id]);
    const room = item?.room_id ? await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [item.room_id]) : null;
    if (!roomUsesDoorPin(room || item?.room_id)) {
      return res.status(400).json({ error: 'ห้องนี้ไม่ใช้รหัสผ่านประตู' });
    }

    res.json({ success: true, pin_code: booking.pin_code, message: `รหัสผ่านเปิดประตูคือ ${booking.pin_code}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get booking status (public - requires contact for verification)
app.get('/api/public/bookings/:id', async (req, res) => {
  const { id } = req.params;

  let numericId = null;
  if (!isNaN(id)) {
    numericId = parseInt(id, 10);
  } else if (typeof id === 'string' && id.startsWith('BK-')) {
    const raw = id.replace('BK-', '');
    if (!isNaN(raw)) {
      numericId = parseInt(raw, 10);
    }
  }

  try {
    const booking = await dbQuery.get(
      'SELECT * FROM bookings WHERE id = ? OR id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)',
      [numericId, id, id, id]
    );

    if (!booking) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
    }
    if (!hasPublicBookingAccess(req, booking)) {
      return res.status(403).json({ error: 'กรุณายืนยันเบอร์โทรศัพท์หรือสิทธิ์เข้าถึงรายการจอง' });
    }

    // Get booking items with room info using integer booking.id
    const items = await dbQuery.all(
      `SELECT bi.*, r.name as room_name, r.capacity, r.image_url, r.description
       FROM booking_items bi
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE bi.booking_id = ?`,
      [booking.id]
    );

    const bookingCode = `BK-${String(booking.id).padStart(6, '0')}`;
    let roomInfo = null;
    if (items && items.length) {
      roomInfo = {
        id: items[0].room_id,
        name: items[0].room_name,
        capacity: items[0].capacity,
        image_url: items[0].image_url,
        description: items[0].description
      };
    }

    let rejectionReason = null;
    if (booking.payment_status === 'rejected' || booking.slip_verify_status === 'rejected') {
      const rejRow = await dbQuery.get(
        "SELECT rejection_reason FROM slip_verifications WHERE booking_id = ? AND verification_status = 'rejected' ORDER BY id DESC LIMIT 1",
        [booking.id]
      );
      rejectionReason = rejRow?.rejection_reason || null;
    }

    const pwSetting = await dbQuery.get("SELECT value FROM settings WHERE key = 'payment_window_minutes'");
    const paymentWindowMinutes = Math.max(1, parseInt(pwSetting?.value || '15', 10) || 15);

    res.json({
      ...sanitizePublicBooking(booking),
      rejection_reason: rejectionReason,
      bookingCode,
      items: (items || []).map(sanitizePublicBookingItem),
      room: roomInfo,
      start_time: items && items.length ? (items[0].start_time?.includes('T') ? items[0].start_time.split('T')[1].substring(0, 5) : items[0].start_time) : null,
      end_time: items && items.length ? (items[0].end_time?.includes('T') ? items[0].end_time.split('T')[1].substring(0, 5) : items[0].end_time) : null,
      booking_date: items && items.length ? (items[0].start_time?.includes('T') ? items[0].start_time.split('T')[0] : booking.created_at?.split('T')[0]) : null,
      paymentDeadline: new Date(new Date(booking.created_at).getTime() + paymentWindowMinutes * 60 * 1000).toISOString(),
      payment_window_minutes: paymentWindowMinutes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload payment slip for a booking with automated Smart Verification
app.post('/api/public/bookings/:id/upload-slip', async (req, res) => {
  const { id } = req.params;
  const { slip_image } = req.body;

  let numericId = null;
  if (!isNaN(id)) {
    numericId = parseInt(id, 10);
  } else if (typeof id === 'string' && id.startsWith('BK-')) {
    const raw = id.replace('BK-', '');
    if (!isNaN(raw)) {
      numericId = parseInt(raw, 10);
    }
  }

  if (!slip_image) {
    return res.status(400).json({ error: 'กรุณาอัปโหลดรูปสลิปการโอนเงิน' });
  }

  try {
    // Verify booking exists by ID or receipt_number
    const booking = await dbQuery.get(
      'SELECT * FROM bookings WHERE id = ? OR id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)',
      [numericId, id, id, id]
    );
    if (!booking) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
    }
    if (!hasPublicBookingAccess(req, booking)) {
      return res.status(403).json({ error: 'กรุณายืนยันเบอร์โทรศัพท์หรือสิทธิ์เข้าถึงรายการจอง' });
    }
    const targetBookingId = booking.id;

    if (booking.payment_status === 'paid') {
      return res.status(409).json({ success: false, auto_approved: false, error: 'รายการจองนี้ชำระเงินแล้ว ไม่สามารถแนบสลิปซ้ำได้' });
    }

    if (booking.payment_status === 'cancelled') {
      const pwSetting = await dbQuery.get("SELECT value FROM settings WHERE key = 'payment_window_minutes'");
      const paymentWindowMinutes = Math.max(1, parseInt(pwSetting?.value || '15', 10) || 15);
      return res.status(400).json({
        error: `รายการจองนี้ถูกยกเลิกแล้ว เนื่องจากเกินกำหนดเวลาชำระเงิน ${paymentWindowMinutes} นาที กรุณาทำรายการจองใหม่`
      });
    }

    // Save slip image
    const slipDir = path.join(__dirname, 'uploads', 'slips');
    if (!fs.existsSync(slipDir)) {
      fs.mkdirSync(slipDir, { recursive: true });
    }

    const matches = slip_image.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาอัปโหลดรูปภาพ (PNG, JPG)' });
    }

    const imageBuffer = Buffer.from(matches[3], 'base64');
    if (imageBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'ขนาดรูปภาพเกิน 10MB กรุณาอัปโหลดรูปที่มีขนาดเล็กลง' });
    }

    const ext = matches[2] === 'jpeg' ? 'jpg' : matches[2];
    const fileName = `slip_BK${String(targetBookingId).padStart(6, '0')}_${Date.now()}.${ext}`;
    const filePath = path.join(slipDir, fileName);
    fs.writeFileSync(filePath, imageBuffer);

    const slipUrl = `/uploads/slips/${fileName}`;

    // Run Local 5-Tier Automated Slip Verification
    const verifyResult = await verifySlip(imageBuffer, booking, dbQuery, req.body.qr_data);
    const nowIso = getBangkokLocalISO(new Date());

    // 1. REJECT IMMEDIATELY if NOT a valid bank slip (e.g. meme image, animal photo, payment QR, or no QR code)
    if (!verifyResult.isValid || verifyResult.confidence === 0) {
      // Clean up saved file if invalid
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }

      return res.status(400).json({
        success: false,
        auto_approved: false,
        error: verifyResult.reasons[0] || 'รูปภาพที่เลือกไม่ใช่สลิปโอนเงินของธนาคาร กรุณาแนบสลิปจริงที่มี Mini QR Code ชัดเจน'
      });
    }

    // 1B. Prevent customer from re-uploading the same rejected slip for this booking
    if (verifyResult.transRef) {
      const prevRejected = await dbQuery.get(
        "SELECT id FROM slip_verifications WHERE booking_id = ? AND trans_ref = ? AND verification_status = 'rejected' LIMIT 1",
        [targetBookingId, verifyResult.transRef]
      );
      if (prevRejected || (booking.payment_status === 'rejected' && booking.slip_trans_ref === verifyResult.transRef)) {
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) {}
        }
        return res.status(400).json({
          success: false,
          auto_approved: false,
          error: 'สลิปนี้เคยถูกปฏิเสธแล้ว กรุณาแนบสลิปใหม่ที่มีการโอนเงินถูกต้อง'
        });
      }
    }

    // Only the approved former target-correction class can enter local manual review.
    if (verifyResult.manualReviewRequired === true && !verifyResult.eligibleForAutoApproval &&
        verifyResult.details?.ocr?.receiverOcrUncertain === true) {
      try {
        await dbQuery.transaction(async () => {
          const current = await dbQuery.get('SELECT id, total_amount, payment_status FROM bookings WHERE id = ?', [targetBookingId]);
          if (!current || ['paid', 'cancelled'].includes(current.payment_status) ||
              Number(current.total_amount) !== verifyResult.expectedAmount) throw new Error('BOOKING_STATE_CHANGED');
          const existing = await dbQuery.get('SELECT booking_id FROM slip_verifications WHERE trans_ref = ? LIMIT 1', [verifyResult.transRef]);
          const paid = await dbQuery.get("SELECT id FROM bookings WHERE slip_trans_ref = ? AND payment_status = 'paid' LIMIT 1", [verifyResult.transRef]);
          if (existing || paid) throw new Error('DUPLICATE_SLIP');
          await dbQuery.run(
            "INSERT INTO slip_verifications (booking_id, trans_ref, bank_code, bank_name, amount, is_auto_approved, confidence_score, verification_status, rejection_reason, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending_manual', ?, ?)",
            [targetBookingId, verifyResult.transRef, verifyResult.bankCode, verifyResult.bankName,
              verifyResult.detectedAmount, verifyResult.confidence, 'receiver_ocr_uncertain', nowIso]
          );
          const update = await dbQuery.run(
            "UPDATE bookings SET slip_image_url = ?, slip_trans_ref = ?, slip_verified_at = NULL, slip_verify_status = 'pending_manual', payment_status = 'reviewing' WHERE id = ? AND total_amount = ? AND COALESCE(payment_status, 'pending') NOT IN ('paid', 'cancelled')",
            [slipUrl, verifyResult.transRef, targetBookingId, verifyResult.expectedAmount]
          );
          if (update?.changes !== 1) throw new Error('BOOKING_STATE_CHANGED');
        });
      } catch (error) {
        if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (_) {} }
        return res.status(/DUPLICATE|UNIQUE|BOOKING_STATE_CHANGED/.test(String(error.message)) ? 409 : 503)
          .json({ success: false, auto_approved: false, error: 'ไม่สามารถบันทึกสลิปเพื่อตรวจสอบได้ กรุณาตรวจสอบสถานะรายการแล้วลองใหม่' });
      }
      return res.json({ success: true, auto_approved: false, slipUrl, verifyResult,
        message: 'ข้อมูลชื่อผู้รับอ่านได้ไม่ชัดเจน กรุณารอเจ้าหน้าที่ตรวจสอบสลิป' });
    }

    // 2. AUTO-APPROVE if valid bank slip and all criteria pass
    if (verifyResult.eligibleForAutoApproval) {
      // Auto-approved! Generate receipt_number and pin_code if not present
      let receiptNumber = booking.receipt_number;
      if (!receiptNumber) {
        receiptNumber = await generateReceiptNumber();
      }

      let pinCode = booking.pin_code;
      if (!pinCode) {
        pinCode = await generateUniquePinCode();
      }

      await commitVerifiedSlip(verifyResult, booking, dbQuery, () => dbQuery.run(
        `UPDATE bookings
         SET slip_image_url = ?,
             payment_status = 'paid',
             payment_method = 'transfer',
             receipt_number = ?,
             pin_code = ?,
             slip_trans_ref = ?,
             slip_verified_at = ?,
             slip_verify_status = 'auto_approved'
         WHERE id = ? AND total_amount = ? AND COALESCE(payment_status, 'pending') NOT IN ('paid', 'cancelled')`,
        [slipUrl, receiptNumber, pinCode, verifyResult.transRef, nowIso, targetBookingId, verifyResult.expectedAmount]
      ));

      if (!verifyResult.autoApproved) {
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) {}
        }
        return res.status(verifyResult.errorCode === 'DUPLICATE_SLIP' ? 409 : 503).json({
          success: false,
          auto_approved: false,
          code: verifyResult.errorCode,
          error: verifyResult.reasons[0] || 'ระบบไม่สามารถบันทึกผลตรวจสอบสลิปได้'
        });
      }

      // Send LINE confirmation if customer has line_user_id
      if (booking.line_user_id) {
        try {
          const tokenSetting = await dbQuery.get('SELECT value FROM settings WHERE key = ?', ['line_channel_access_token']);
          if (tokenSetting && tokenSetting.value) {
            await sendLineNotification(targetBookingId);
          }
        } catch (lineErr) {
          console.warn('LINE notification warning:', lineErr.message);
        }
      }

      return res.json({
        success: true,
        auto_approved: true,
        slipUrl,
        receiptNumber,
        pinCode,
        verifyResult,
        message: 'สลิปถูกต้อง! ระบบอนุมัติการจองและออกใบเสร็จให้อัตโนมัติเรียบร้อยแล้ว'
      });
    } else {
      // Automatic-only flow: an inconclusive result is a failed verification,
      // never a successful upload waiting for manual staff review.
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
      return res.status(422).json({
        success: false,
        auto_approved: false,
        verifyResult,
        error: verifyResult.reasons[0] || 'ระบบยังไม่สามารถยืนยันชื่อบัญชีผู้รับและยอดเงินได้ กรุณาใช้สลิปต้นฉบับที่ชัดเจนแล้วอัปโหลดใหม่'
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// Live test slip verification API
app.post('/api/slip/verify-test', authenticateToken, requireAnyPermission('admin-management', 'admin-system'), async (req, res) => {
  const { slip_image, expected_amount } = req.body;
  if (!slip_image) {
    return res.status(400).json({ error: 'กรุณาส่งรูปสลิป (base64)' });
  }

  try {
    const matches = slip_image.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
    const imageBuffer = matches ? Buffer.from(matches[3], 'base64') : Buffer.from(slip_image, 'base64');

    const mockBooking = {
      id: 999999,
      total_amount: expected_amount ? parseFloat(expected_amount) : 0
    };

    const result = await verifySlip(imageBuffer, mockBooking, dbQuery, req.body.qr_data);
    res.json({
      success: true,
      result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get slip verification history for a booking
app.get('/api/bookings/:id/slip-verification', async (req, res) => {
  const { id } = req.params;
  try {
    const records = await dbQuery.all(
      'SELECT * FROM slip_verifications WHERE booking_id = ? ORDER BY id DESC',
      [id]
    );
    res.json(records || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get payment settings for public display
app.get('/api/public/settings/payment', async (req, res) => {
  try {
    const settings = await dbQuery.all('SELECT key, value FROM settings');
    const settingsMap = {};
    settings.forEach(s => { settingsMap[s.key] = s.value; });

    const windowMins = Math.max(1, parseInt(settingsMap.payment_window_minutes || '15', 10) || 15);
    const deadlineHours = Math.round((windowMins / 60) * 100) / 100;

    res.json({
      promptpay_id: settingsMap.promptpay_id || '0125554000401',
      bank_name: settingsMap.payment_bank_name || 'ธนาคารกรุงศรีอยุธยา (Krungsri)',
      bank_account: settingsMap.payment_bank_account || '329-1-38429-0',
      bank_account_name: settingsMap.payment_bank_account_name || 'บริษัท บิลท์ ฮาร์ท จำกัด',
      payment_deadline_hours: deadlineHours,
      payment_window_minutes: windowMins,
      cleaning_buffer_minutes: parseInt(settingsMap.cleaning_buffer_minutes || '30', 10),
      line_liff_id: settingsMap.line_liff_id || '2011136579-c1TeSWNs'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// END PUBLIC BOOKING API
// ==========================================

// Fallback to React app index.html
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Server is running. Frontend build is missing. Please run "npm run build" to compile frontend.');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running locally at http://localhost:${PORT}`);
  console.log(`Open your browser to start using the system.`);
});


// Build LINE Door PIN Flex message (Sent by staff when customer arrives at counter)
function buildLineDoorPinFlex(booking, item, room) {
  const roomName = room?.name || item?.room_name || 'ห้องประชุม B-WORK';
  // LINE OA must ALWAYS send Customer Access Code only
  const pinCode = (room && room.pin_code && room.pin_code.trim()) ? room.pin_code.trim() : (booking?.pin_code || '------');

  let dateDisplay = '-';
  let timeDisplay = '-';
  if (item?.start_time) {
    const sStr = String(item.start_time).replace(' ', 'T');
    dateDisplay = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = item?.end_time ? String(item.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = (sTime && eTime) ? `${sTime} - ${eTime} น.` : (sTime ? `${sTime} น.` : '-');
  } else if (booking?.created_at || booking?.date) {
    const sStr = String(booking.date || booking.created_at).replace(' ', 'T');
    dateDisplay = formatThaiDateDisplay(sStr);
    if (booking?.start_time) {
      timeDisplay = `${booking.start_time} - ${booking.end_time || ''} น.`.trim();
    }
  }

  return {
    type: 'flex',
    altText: `รหัสเข้าห้อง ${roomName}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-door-pin-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'รหัสเข้าห้อง',
            size: 'xl',
            weight: 'bold',
            color: '#0f172a'
          },
          {
            type: 'text',
            text: 'กดรหัสผ่านที่ประตูก่อนเข้าใช้งานห้องประชุม',
            size: 'xs',
            color: '#64748b',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ห้องประชุม', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: roomName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'วันที่ใช้งาน', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: dateDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'เวลา', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: timeDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            paddingAll: '16px',
            backgroundColor: '#f0f9ff',
            cornerRadius: '12px',
            borderWidth: '1px',
            borderColor: '#bae6fd',
            alignItems: 'center',
            contents: [
              { type: 'text', text: 'รหัสเข้าห้อง (PIN)', size: 'xs', weight: 'bold', color: '#0369a1', align: 'center' },
              { type: 'text', text: pinCode, size: '3xl', weight: 'bold', color: '#0f172a', align: 'center', margin: 'xs' },
              { type: 'text', text: 'กดรหัส 6 หลัก ตามด้วย #', size: 'xs', weight: 'bold', color: '#0f172a', align: 'center', margin: 'xs' },
              { type: 'text', text: 'รหัสนี้ใช้ได้เฉพาะในวันและเวลาที่จอง', size: 'xxs', color: '#64748b', align: 'center', margin: 'xs' }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: 'ดูรายละเอียดการจอง',
              uri: 'https://bwork-booking.pages.dev/status'
            },
            style: 'primary',
            color: '#0284c7',
            height: 'md'
          }
        ]
      }
    }
  };
}

// Staff endpoint: Send Door PIN to customer's LINE OA
app.post('/api/bookings/:id/send-pin', async (req, res) => {
  const { id } = req.params;
  try {
    const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!booking) return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });

    const item = await dbQuery.get('SELECT * FROM booking_items WHERE booking_id = ? AND room_id IS NOT NULL ORDER BY id ASC LIMIT 1', [id]);
    const room = item?.room_id ? await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [item.room_id]) : null;

    if (!roomUsesDoorPin(room || item?.room_id)) {
      return res.status(400).json({ error: 'ห้องนี้ไม่ใช้รหัสผ่านประตู' });
    }

    let pinCode = '';
    if (booking.customer_type === 'builtland') {
      pinCode = (room && room.builtland_pin_code && room.builtland_pin_code.trim())
        ? room.builtland_pin_code.trim()
        : ((room && room.pin_code && room.pin_code.trim()) ? room.pin_code.trim() : (booking.pin_code || await generateUniquePinCode()));
    } else {
      // General / Walk-in / Basecamp / Online: Customer PIN only
      pinCode = (room && room.pin_code && room.pin_code.trim()) ? room.pin_code.trim() : (booking.pin_code || await generateUniquePinCode());
    }

    await dbQuery.run('UPDATE bookings SET pin_code = ? WHERE id = ?', [pinCode, id]);
    if (item) {
      await dbQuery.run('UPDATE booking_items SET pin_code = ? WHERE id = ?', [pinCode, item.id]);
    }
    booking.pin_code = pinCode;

    let lineSent = false;
    if (booking.line_user_id) {
      const tokenSetting = await dbQuery.get("SELECT value FROM settings WHERE key = 'line_channel_access_token'");
      const channelAccessToken = tokenSetting?.value;
      if (channelAccessToken) {
        try {
          const flexMessage = buildLineDoorPinFlex(booking, item, room);
          const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${channelAccessToken}`
            },
            body: JSON.stringify({
              to: booking.line_user_id,
              messages: [flexMessage]
            })
          });
          lineSent = lineRes.ok;
        } catch (e) {
          console.warn('LINE Door PIN push error:', e.message);
        }
      }
    }

    res.json({
      success: true,
      pin_code: pinCode,
      line_sent: lineSent,
      message: lineSent ? 'ส่งรหัส PIN เข้า LINE OA ลูกค้าสำเร็จ' : 'สร้างรหัส PIN สำเร็จ (ลูกค้ารายนี้ไม่ได้เชื่อม LINE OA)'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Helper to build LINE OA Flex Message for Auto-Cancelled booking due to 15-min expiration
function buildLineBookingCancelledFlex(booking, roomNameOrItem, reasonOrRoom, itemOrReason) {
  let item = null;
  let roomName = '';
  let reason = '';

  if (roomNameOrItem && typeof roomNameOrItem === 'object') {
    item = roomNameOrItem;
    roomName = (reasonOrRoom && typeof reasonOrRoom === 'object') ? reasonOrRoom?.name : (typeof reasonOrRoom === 'string' ? reasonOrRoom : (booking?.room_name || 'ห้องประชุม B-WORK'));
    reason = (typeof itemOrReason === 'string') ? itemOrReason : '';
  } else {
    roomName = (typeof roomNameOrItem === 'string' && roomNameOrItem) ? roomNameOrItem : (booking?.room_name || 'ห้องประชุม B-WORK');
    reason = (typeof reasonOrRoom === 'string') ? reasonOrRoom : (typeof itemOrReason === 'string' ? itemOrReason : '');
    item = (itemOrReason && typeof itemOrReason === 'object') ? itemOrReason : null;
  }

  const bookingCode = booking?.receipt_number || `#BK-${String(booking?.id || 0).padStart(6, '0')}`;
  const cancelReason = reason || 'ไม่ได้ทำการชำระเงินภายในเวลาที่กำหนด (15 นาที)';

  let dateDisplay = '-';
  let timeDisplay = '-';
  const timeSource = item?.start_time ? item : booking;
  if (timeSource?.start_time) {
    const sStr = String(timeSource.start_time).replace(' ', 'T');
    dateDisplay = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = timeSource.end_time ? String(timeSource.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = (sTime && eTime) ? `${sTime} - ${eTime} น.` : (sTime ? `${sTime} น.` : '-');
  } else if (booking?.date) {
    dateDisplay = formatThaiDateDisplay(booking.date);
    if (booking?.start_time) {
      timeDisplay = `${booking.start_time} - ${booking.end_time || ''} น.`.trim();
    }
  }

  return {
    type: 'flex',
    altText: `แจ้งยกเลิกการจอง ${roomName} - ${bookingCode}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-cancel-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'ยกเลิกการจอง',
            size: 'xl',
            weight: 'bold',
            color: '#0f172a'
          },
          {
            type: 'text',
            text: 'รายการจองห้องประชุมถูกยกเลิกเรียบร้อย',
            size: 'xs',
            color: '#64748b',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'รหัสการจอง', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: bookingCode, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ห้องประชุม', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: roomName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'วันที่ใช้งาน', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: dateDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'เวลา', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: timeDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '14px',
            backgroundColor: '#fef2f2',
            cornerRadius: '10px',
            borderWidth: '1px',
            borderColor: '#fecaca',
            contents: [
              { type: 'text', text: 'เหตุผลในการยกเลิก', size: 'xs', weight: 'bold', color: '#991b1b' },
              { type: 'text', text: cancelReason, size: 'sm', weight: 'bold', color: '#991b1b', margin: 'xs', wrap: true }
            ]
          },
          {
            type: 'text',
            text: 'หากต้องการจองห้องประชุมใหม่ เรายินดีให้บริการเสมอ',
            size: 'xxs',
            color: '#64748b',
            margin: 'sm',
            align: 'center',
            wrap: true
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: 'จองห้องใหม่',
              uri: 'https://bwork-booking.pages.dev'
            },
            style: 'primary',
            color: '#991b1b',
            height: 'md'
          }
        ]
      }
    }
  };
}

// Background Worker: Automatically Cancel Expired Pending Bookings (based on payment_window_minutes) and Notify LINE OA
async function checkAndCancelExpiredBookings() {
  try {
    const pwSetting = await dbQuery.get("SELECT value FROM settings WHERE key = 'payment_window_minutes'");
    const paymentWindowMinutes = Math.max(1, parseInt(pwSetting?.value || '15', 10) || 15);
    const paymentWindowMs = paymentWindowMinutes * 60 * 1000;
    const cancelReasonMsg = `ไม่ได้ทำการชำระเงินภายในเวลาที่กำหนด (${paymentWindowMinutes} นาที)`;

    const pendingBookings = await dbQuery.all(`
      SELECT b.*, bi.room_id, r.name as room_name, bi.start_time, bi.end_time
      FROM bookings b
      LEFT JOIN booking_items bi ON bi.booking_id = b.id
      LEFT JOIN rooms r ON bi.room_id = r.id
      WHERE (b.payment_status = 'pending' OR b.payment_status = 'unpaid' OR b.payment_status IS NULL)
        AND (b.slip_image_url IS NULL OR b.slip_image_url = '')
        AND b.booking_source = 'online'
    `);

    const now = Date.now();

    for (const b of pendingBookings) {
      if (!b.created_at) continue;
      const cleanCreated = b.created_at.replace(' ', 'T');
      const createdAtTime = new Date(cleanCreated).getTime();
      if (isNaN(createdAtTime)) continue;

      if (now - createdAtTime >= paymentWindowMs) {
        console.log(`[Auto-Cancel] Booking #${b.id} (${b.receipt_number || b.id}) expired after ${paymentWindowMinutes} minutes. Cancelling...`);

        await dbQuery.run(`
          UPDATE bookings
          SET payment_status = 'cancelled',
              checkin_status = 'cancelled',
              cancellation_reason = ?
          WHERE id = ?
        `, [cancelReasonMsg, b.id]);

        await dbQuery.run(`
          UPDATE booking_items
          SET checkin_status = 'cancelled'
          WHERE booking_id = ?
        `, [b.id]);

        // Push LINE Cancellation Notification
        if (b.line_user_id) {
          try {
            const tokenSetting = await dbQuery.get("SELECT value FROM settings WHERE key = 'line_channel_access_token'");
            const channelAccessToken = tokenSetting?.value;
            if (channelAccessToken) {
              const flexCancel = buildLineBookingCancelledFlex(b, b.room_name, cancelReasonMsg);
              await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${channelAccessToken}`
                },
                body: JSON.stringify({
                  to: b.line_user_id,
                  messages: [flexCancel]
                })
              });
            }
          } catch (lineErr) {
            console.warn('[Auto-Cancel] LINE notification warning:', lineErr.message);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Auto-Cancel] Worker error:', err.message);
  }
}

// Start background cron worker (Runs every 30 seconds)
setInterval(checkAndCancelExpiredBookings, 30 * 1000);

const buildLineBookingConfirmationFlex = buildLineConfirmationFlex;
const buildLineBookingCancellationFlex = buildLineBookingCancelledFlex;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    app,
    buildLineConfirmationFlex,
    buildLineBookingConfirmationFlex,
    buildLineDoorPinFlex,
    buildLineBookingRescheduleFlex,
    buildLineBookingCancelledFlex,
    buildLineBookingCancellationFlex,
    formatThaiDateDisplay,
    formatRescheduleTimeDisplay
  };
}
