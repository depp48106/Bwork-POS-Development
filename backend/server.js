const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDatabase, dbQuery, hashPassword } = require('./database');
const { performBackup } = require('./backup');
const { 
  generateDatabaseDumpSql, 
  getOneDriveAuthUrl, 
  exchangeOneDriveCode, 
  refreshOneDriveAccessToken, 
  uploadSqlToOneDrive 
} = require('./onedrive');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'bwork-pos-secret-key-change-in-production';
const JWT_EXPIRY = 8 * 60 * 60 * 1000; // 8 hours

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
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ (Token not provided)' });
  }
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
  req.user = user;
  next();
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
    const hashedPassword = hashPassword(password);
    const user = await dbQuery.get(
      `SELECT u.id, u.username, u.role, COALESCE(u.permissions, r.permissions, '') as permissions, u.fullname 
       FROM users u 
       LEFT JOIN roles r ON u.role = r.name 
       WHERE u.username = ? AND u.password_hash = ?`,
      [username, hashedPassword]
    );

    if (user) {
      const token = createToken({ id: user.id, username: user.username, role: user.role, permissions: user.permissions, fullname: user.fullname });
      res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role, permissions: user.permissions, fullname: user.fullname } });
    } else {
      res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาดของระบบ: ' + err.message });
  }
});

// Quick Cashier Login with PIN Code
app.post('/api/auth/login-pin', async (req, res) => {
  const { pin_code } = req.body;
  if (!pin_code) {
    return res.status(400).json({ error: 'กรุณากรอกรหัส PIN 4-6 หลัก' });
  }

  try {
    const user = await dbQuery.get(
      `SELECT u.id, u.username, u.role, COALESCE(u.permissions, r.permissions, '') as permissions, u.fullname 
       FROM users u 
       LEFT JOIN roles r ON u.role = r.name 
       WHERE u.pin_code = ?`,
      [pin_code.trim()]
    );

    if (user) {
      const token = createToken({ id: user.id, username: user.username, role: user.role, permissions: user.permissions, fullname: user.fullname });
      res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role, permissions: user.permissions, fullname: user.fullname } });
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

// Apply authentication to all non-public API routes
app.use('/api/rooms', authenticateToken);
app.use('/api/services', authenticateToken);
app.use('/api/categories', authenticateToken);
app.use('/api/bookings', authenticateToken);
app.use('/api/users', authenticateToken);
app.use('/api/roles', authenticateToken);
app.use('/api/settings', authenticateToken);
app.use('/api/dashboard', authenticateToken);
app.use('/api/quotations', authenticateToken);
app.use('/api/upload', authenticateToken);
app.use('/api/backup', authenticateToken);

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

app.post('/api/rooms', async (req, res) => {
  const { 
    name, capacity, hourly_rate, daily_rate, half_day_rate,
    has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url,
    description, status, image_url,
    has_hourly, has_halfday, has_daily, pin_code
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
        has_hourly, has_halfday, has_daily, pin_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, capacity, hourly_rate, daily_rate || 0, half_day_rate || 0,
        has_classroom || 0, classroom_hourly_rate || 0, classroom_daily_rate || 0, classroom_capacity || 0, classroom_image_url || null,
        description || '', status || 'active', image_url || null,
        has_hourly !== undefined ? has_hourly : 1, has_halfday || 0, has_daily || 0, pin_code || null
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
      pin_code: pin_code || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/rooms/:id', async (req, res) => {
  const { 
    name, capacity, hourly_rate, daily_rate, half_day_rate,
    has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url,
    description, status, image_url,
    has_hourly, has_halfday, has_daily, pin_code
  } = req.body;
  try {
    await dbQuery.run(
      `UPDATE rooms 
       SET name = ?, capacity = ?, hourly_rate = ?, daily_rate = ?, half_day_rate = ?,
           has_classroom = ?, classroom_hourly_rate = ?, classroom_daily_rate = ?, classroom_capacity = ?, classroom_image_url = ?,
           description = ?, status = ?, image_url = ?,
           has_hourly = ?, has_halfday = ?, has_daily = ?, pin_code = ?
       WHERE id = ?`,
      [
        name, capacity, hourly_rate, daily_rate || 0, half_day_rate || 0,
        has_classroom || 0, classroom_hourly_rate || 0, classroom_daily_rate || 0, classroom_capacity || 0, classroom_image_url || null,
        description, status, image_url,
        has_hourly !== undefined ? has_hourly : 1, has_halfday || 0, has_daily || 0, pin_code || null,
        req.params.id
      ]
    );
    res.json({ message: 'แก้ไขข้อมูลห้องประชุมสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rooms/:id', async (req, res) => {
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

app.post('/api/services', async (req, res) => {
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

app.put('/api/services/:id', async (req, res) => {
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

app.delete('/api/services/:id', async (req, res) => {
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
app.put('/api/categories', async (req, res) => {
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

app.delete('/api/categories/:name', async (req, res) => {
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
async function generateReceiptNumber() {
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bkkDate = new Date(Date.now() + bangkokOffsetMs);
  const yy = String(bkkDate.getUTCFullYear()).slice(-2);
  const mm = String(bkkDate.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `BK-${yy}${mm}`;

  const lastBooking = await dbQuery.get(
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
async function generateUniquePinCode() {
  let pin = Math.floor(100000 + Math.random() * 900000).toString();
  // Ensure uniqueness among active bookings
  let existing = await dbQuery.get('SELECT id FROM bookings WHERE pin_code = ? AND checkin_status != "expired"', [pin]);
  let tries = 0;
  while (existing && tries < 10) {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
    existing = await dbQuery.get('SELECT id FROM bookings WHERE pin_code = ? AND checkin_status != "expired"', [pin]);
    tries++;
  }
  return pin;
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
async function getCleaningBufferMinutes() {
  try {
    const row = await dbQuery.get("SELECT value FROM settings WHERE key = 'cleaning_buffer_minutes'");
    if (row && row.value !== undefined && row.value !== null && !isNaN(row.value)) {
      return Math.max(0, parseInt(row.value, 10));
    }
  } catch (e) {}
  return 30;
}

// Helper: Check if a room has overlapping bookings or conflicts with cleaning buffer (cross-system safe)
async function checkRoomOverlap(roomId, startISO, endISO, excludeBookingId = null) {
  const normStart = normalizeToLocalISO(startISO);
  const normEnd = normalizeToLocalISO(endISO);
  const bufferMins = await getCleaningBufferMinutes();
  const bufferMs = bufferMins * 60 * 1000;

  const reqStartMs = new Date(normStart.replace(' ', 'T')).getTime();
  const reqEndMs = new Date(normEnd.replace(' ', 'T')).getTime();
  const reqEndBufferedMs = reqEndMs + bufferMs;

  let query = `
    SELECT bi.id, bi.booking_id, bi.start_time, bi.end_time, b.customer_name, b.payment_status
    FROM booking_items bi
    JOIN bookings b ON bi.booking_id = b.id
    WHERE bi.room_id = ?
      AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
  `;
  const params = [roomId];
  if (excludeBookingId) {
    query += ' AND b.id != ?';
    params.push(excludeBookingId);
  }

  const bookings = await dbQuery.all(query, params);

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
  const { customer_name, department, contact, total_amount, payment_status, payment_method, items, line_user_id, guest_count } = req.body;

  if (!customer_name || !items || !items.length) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลผู้จองและเลือกรายการอย่างน้อย 1 รายการ' });
  }

  try {
    // Start exclusive transaction to prevent race conditions
    await dbQuery.run('BEGIN EXCLUSIVE TRANSACTION');

    try {
      // Check overlap for all room items BEFORE inserting anything
      for (const item of items) {
        if (item.room_id && item.start_time && item.end_time) {
          // Normalize timestamps to consistent Local ISO format
          const normStart = normalizeToLocalISO(item.start_time);
          const normEnd = normalizeToLocalISO(item.end_time);

          // Validate time order
          if (normEnd <= normStart) {
            await dbQuery.run('ROLLBACK');
            return res.status(400).json({ error: `เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น (${normStart} - ${normEnd})` });
          }

          const overlapResult = await checkRoomOverlap(item.room_id, normStart, normEnd);
          if (overlapResult.hasOverlap) {
            await dbQuery.run('ROLLBACK');
            const roomObj = await dbQuery.get('SELECT name FROM rooms WHERE id = ?', [item.room_id]);
            const roomName = roomObj ? roomObj.name : `ID: ${item.room_id}`;
            return res.status(409).json({ error: formatOverlapErrorMessage(roomName, overlapResult) });
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
      const verifiedTotal = Math.round(serverTotal * 100) / 100;

      const receiptNumber = await generateReceiptNumber();
      const roomItem = items.find(it => !!it.room_id);
      let pinCode = null;

      if (roomItem) {
        const roomDb = await dbQuery.get('SELECT pin_code FROM rooms WHERE id = ?', [roomItem.room_id]);
        if (roomDb && roomDb.pin_code && roomDb.pin_code.trim()) {
          pinCode = roomDb.pin_code.trim();
        } else {
          pinCode = await generateUniquePinCode();
        }
      }

      // Extract optional guest count for Walk-in
      const effectiveGuestCount = (guest_count !== undefined && guest_count !== null && guest_count !== '')
        ? parseInt(guest_count, 10)
        : (items.find(it => it.guest_count)?.guest_count ? parseInt(items.find(it => it.guest_count).guest_count, 10) : null);

      // Insert master booking (with optional guest_count)
      const bookingResult = await dbQuery.run(
        'INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, line_user_id, guest_count, checkin_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [customer_name, department || '', contact || '', verifiedTotal, payment_status || 'pending', payment_method || 'cash', receiptNumber, pinCode, line_user_id || null, effectiveGuestCount, 'pending', normalizeToLocalISO(new Date())]
      );
      const bookingId = bookingResult.id;

      // Insert booking items with normalized timestamps & guest_count
      for (const item of items) {
        const normStart = (item.room_id && item.start_time) ? normalizeToLocalISO(item.start_time) : null;
        const normEnd = (item.room_id && item.end_time) ? normalizeToLocalISO(item.end_time) : null;
        const itemGuestCount = item.guest_count ? parseInt(item.guest_count, 10) : effectiveGuestCount;

        await dbQuery.run(
          `INSERT INTO booking_items 
           (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, guest_count, pin_code, checkin_status) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bookingId,
            item.room_id || null,
            item.service_id || null,
            item.quantity || 1,
            item.price,
            normStart,
            normEnd,
            item.subtotal,
            item.layout || 'standard',
            item.booking_type || 'hourly',
            itemGuestCount,
            item.room_id ? pinCode : null,
            'pending'
          ]
        );
      }

      await dbQuery.run('COMMIT');

      const savedBooking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
      const savedItems = await dbQuery.all(`
        SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.description as service_description, s.category as service_category
        FROM booking_items bi
        LEFT JOIN rooms r ON bi.room_id = r.id
        LEFT JOIN services s ON bi.service_id = s.id
        WHERE bi.booking_id = ?
      `, [bookingId]);

      res.status(201).json({ 
        success: true, 
        bookingId,
        booking_id: bookingId,
        id: bookingId, 
        receiptNumber,
        receipt_number: receiptNumber,
        booking_code: receiptNumber,
        bookingCode: receiptNumber,
        pinCode,
        pin_code: pinCode,
        ...(savedBooking || {}),
        items: savedItems || [],
        message: 'บันทึกการจองสำเร็จ' 
      });
    } catch (innerErr) {
      await dbQuery.run('ROLLBACK').catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bookings', async (req, res) => {
  const { start_date, end_date, search, payment_status } = req.query;
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
        bi.room_name LIKE ?
      )`;
      params.push(q, q, q, q, q, q, q, q, q);
    }
    if (payment_status) {
      if (payment_status === 'pending' || payment_status === 'unpaid') {
        sql += " AND (b.payment_status = 'pending' OR b.payment_status = 'reviewing' OR b.payment_status = 'unpaid' OR b.payment_status IS NULL)";
      } else if (payment_status !== 'all') {
        sql += ' AND b.payment_status = ?';
        params.push(payment_status);
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

      bookings.forEach(b => {
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
              b.id as booking_id, b.customer_name, b.payment_status, b.booking_source, b.department, b.contact, b.guest_count
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.id
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE bi.room_id IS NOT NULL
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
    const nowISO = now.toISOString();
    const futureISO = futureLimit.toISOString();

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
         AND b.payment_status != 'cancelled'
       ORDER BY bi.start_time ASC`,
      [nowISO, futureISO]
    );

    // 2. Incoming online bookings (Pending or Reviewing slip)
    const incomingBookings = await dbQuery.all(
      `SELECT b.id as booking_id, b.customer_name, b.payment_status, b.total_amount, b.booking_source, b.created_at, b.slip_image_url,
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
         AND b.payment_status != 'cancelled'
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

    res.json({ ...booking, items });
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

// Helper to build LINE OA Flex Message for booking confirmation
function buildLineConfirmationFlex(booking, item, room) {
  const customerName = booking.customer_name || 'ลูกค้าคนพิเศษ';
  const roomName = room?.name || 'ห้องประชุม B-WORK';
  const pinCode = booking.pin_code || '------';
  const receiptNo = booking.receipt_number || `BK-${String(booking.id).padStart(6, '0')}`;
  
  let dateDisplay = '-';
  let timeDisplay = '-';
  if (item?.start_time) {
    const sStr = String(item.start_time).replace(' ', 'T');
    const sDate = new Date(sStr);
    dateDisplay = sDate.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = item.end_time ? String(item.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = `${sTime} - ${eTime} น.`;
  }

  return {
    type: 'flex',
    altText: `ยืนยันการจองห้องประชุม ${roomName} สำเร็จ (รหัสเข้าห้อง: ${pinCode})`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#10b981',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: 'B-WORK COWORKING & MEETING',
            weight: 'bold',
            color: '#ffffff',
            size: 'xs',
            letterSpacing: '1px'
          },
          {
            type: 'text',
            text: 'ยืนยันการจองสำเร็จ ✅',
            weight: 'bold',
            color: '#ffffff',
            size: 'xl',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ชื่อผู้จอง', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: customerName, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ห้องประชุม', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: roomName, size: 'sm', color: '#0284c7', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'วันที่ใช้งาน', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: dateDisplay, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'เวลา', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: timeDisplay, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'เลขที่ใบจอง', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: receiptNo, size: 'sm', color: '#0f172a', flex: 4, align: 'end' }
            ]
          },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '14px',
            backgroundColor: '#f0fdf4',
            cornerRadius: '12px',
            borderColor: '#86efac',
            borderWidth: '1px',
            contents: [
              {
                type: 'text',
                text: '🔑 รหัสผ่านปลดล็อกประตู (Door PIN)',
                size: 'xs',
                color: '#15803d',
                weight: 'bold',
                align: 'center'
              },
              {
                type: 'text',
                text: pinCode,
                size: 'xxl',
                color: '#166534',
                weight: 'bold',
                align: 'center',
                margin: 'xs'
              },
              {
                type: 'text',
                text: 'กดรหัส PIN 6 หลักที่หน้าจอแท็บเล็ตหน้าห้องเพื่อเข้าใช้งาน',
                size: 'xxs',
                color: '#16a34a',
                align: 'center',
                wrap: true,
                margin: 'xs'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'ขอบคุณที่ใช้บริการ B-WORK สอบถามเพิ่มเติม โทร 02-xxx-xxxx',
            size: 'xxs',
            color: '#94a3b8',
            align: 'center'
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

    // Ensure PIN code exists
    let pinCode = booking.pin_code;
    if (!pinCode || !pinCode.trim()) {
      pinCode = (room && room.pin_code && room.pin_code.trim()) ? room.pin_code.trim() : await generateUniquePinCode();
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
    const checkinTime = new Date().toISOString();
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

// Check-in via LINE OA (Within customizable mins before start time) -> Returns 6-digit PIN Code Flex Card
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
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const datePrefix = `QT${year}${month}`;

    const rows = await dbQuery.all(
      "SELECT quotation_no FROM quotations WHERE quotation_no LIKE ?",
      [`${datePrefix}%`]
    );

    let maxSeq = 0;
    rows.forEach(r => {
      if (r.quotation_no && r.quotation_no.startsWith(datePrefix)) {
        const seqStr = r.quotation_no.replace(datePrefix, '').trim();
        const seqNum = parseInt(seqStr, 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    });

    const nextSeqStr = String(maxSeq + 1).padStart(4, '0');
    res.json({ quotation_no: `${datePrefix}${nextSeqStr}` });
  } catch (err) {
    console.error('Failed to generate next quotation number:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quotations', async (req, res) => {
  const { customer_name, department, contact, total_amount, valid_until, items, seller_name, job_name, customer_address, quotation_no } = req.body;

  if (!customer_name || !items || !items.length) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลลูกค้าและเลือกรายการอย่างน้อย 1 รายการ' });
  }

  try {
    let finalQuotationNo = quotation_no;
    if (!finalQuotationNo || !finalQuotationNo.trim()) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const datePrefix = `QT${year}${month}`;
      const rows = await dbQuery.all(
        "SELECT quotation_no FROM quotations WHERE quotation_no LIKE ?",
        [`${datePrefix}%`]
      );
      let maxSeq = 0;
      rows.forEach(r => {
        if (r.quotation_no && r.quotation_no.startsWith(datePrefix)) {
          const seqStr = r.quotation_no.replace(datePrefix, '').trim();
          const seqNum = parseInt(seqStr, 10);
          if (!isNaN(seqNum) && seqNum > maxSeq) {
            maxSeq = seqNum;
          }
        }
      });
      finalQuotationNo = `${datePrefix}${String(maxSeq + 1).padStart(4, '0')}`;
    }

    const result = await dbQuery.run(
      'INSERT INTO quotations (customer_name, department, contact, total_amount, status, valid_until, seller_name, job_name, customer_address, quotation_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [customer_name, department || '', contact || '', total_amount, 'draft', valid_until || '', seller_name || '', job_name || '', customer_address || '', finalQuotationNo]
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
    const approvedAt = status === 'accepted' ? new Date().toISOString() : null;
    await dbQuery.run('UPDATE quotations SET status = ?, approved_at = ? WHERE id = ?', [status, approvedAt, req.params.id]);
    res.json({ success: true, message: 'อัปเดตสถานะสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/quotations/:id', async (req, res) => {
  const { customer_name, department, contact, total_amount, valid_until, items, seller_name, job_name, customer_address, quotation_no } = req.body;
  const quotationId = req.params.id;

  if (!customer_name || !items || !items.length) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลลูกค้าและเลือกรายการอย่างน้อย 1 รายการ' });
  }

  try {
    await dbQuery.run(
      'UPDATE quotations SET customer_name = ?, department = ?, contact = ?, total_amount = ?, valid_until = ?, seller_name = ?, job_name = ?, customer_address = ?, quotation_no = ? WHERE id = ?',
      [customer_name, department || '', contact || '', total_amount, valid_until || '', seller_name || '', job_name || '', customer_address || '', quotation_no || '', quotationId]
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

    // Check room overlap before conversion
    for (const item of items) {
      if (item.room_id && item.start_time && item.end_time) {
        const normStart = normalizeToLocalISO(item.start_time);
        const normEnd = normalizeToLocalISO(item.end_time);
        const hasOverlap = await checkRoomOverlap(item.room_id, normStart, normEnd);
        if (hasOverlap) {
          return res.status(409).json({ error: 'ไม่สามารถแปลงเป็นการจองได้ เนื่องจากห้องถูกจองในช่วงเวลาดังกล่าวแล้ว' });
        }
      }
    }

    await dbQuery.run('BEGIN EXCLUSIVE TRANSACTION');
    try {
      const receiptNumber = await generateReceiptNumber();

      // 1. Insert into bookings
      const bookingResult = await dbQuery.run(
        'INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [quotation.customer_name, quotation.department, quotation.contact, quotation.total_amount, payment_status || 'pending', payment_method || 'cash', receiptNumber, new Date().toISOString()]
      );
      const bookingId = bookingResult.id;

      // 2. Insert items
      for (const item of items) {
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
            item.start_time,
            item.end_time,
            item.subtotal,
            item.layout,
            item.booking_type
          ]
        );
      }

      // 3. Update quotation status to converted
      await dbQuery.run("UPDATE quotations SET status = 'accepted', approved_at = ? WHERE id = ?", [new Date().toISOString(), req.params.id]);

      await dbQuery.run('COMMIT');
      res.json({ success: true, bookingId, receiptNumber, message: 'แปลงเป็นรายการจองสำเร็จ' });
    } catch (innerErr) {
      await dbQuery.run('ROLLBACK').catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    res.json(settingsObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  const settings = req.body; // e.g. { company_name: '...', onedrive_path: '...' }
  try {
    for (const [key, value] of Object.entries(settings)) {
      await dbQuery.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]
      );
    }
    res.json({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const rooms = await dbQuery.all('SELECT * FROM rooms WHERE status = "active"');
    const roomsOccupancy = [];

    for (const room of rooms) {
      // Find if there is a booking overlapping with the current local time
      const activeBooking = await dbQuery.get(
        `SELECT b.id as booking_id, b.customer_name, b.department, b.booking_source, bi.start_time, bi.end_time, b.payment_status
         FROM booking_items bi
         JOIN bookings b ON bi.booking_id = b.id
         WHERE bi.room_id = ? 
           AND ? >= bi.start_time 
           AND ? <= bi.end_time`,
        [room.id, current_time, current_time]
      );

      roomsOccupancy.push({
        ...room,
        isOccupied: !!activeBooking,
        currentBooking: activeBooking || null
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
app.post('/api/auth/change-password', async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;
  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    const oldHash = hashPassword(oldPassword);
    const user = await dbQuery.get(
      'SELECT id FROM users WHERE username = ? AND password_hash = ?',
      [username, oldHash]
    );

    if (!user) {
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
    const result = await dbQuery.run(
      'INSERT INTO users (username, password_hash, role, fullname, pin_code, permissions) VALUES (?, ?, ?, ?, ?, ?)',
      [username, password_hash, role, fullname || 'พนักงาน Bwork', pin_code || null, permissions || null]
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
    const user = await dbQuery.get('SELECT username FROM users WHERE id = ?', [req.params.id]);
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

    await dbQuery.run(
      'UPDATE users SET username = ?, role = ?, fullname = ?, pin_code = ?, permissions = ? WHERE id = ?',
      [targetUsername, targetRole, fullname, pin_code !== undefined ? pin_code : user.pin_code, permissions !== undefined ? permissions : null, req.params.id]
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
  const todayStr = new Date().toISOString().slice(0, 10);
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
  const targetDate = date || new Date().toISOString().split('T')[0];

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
         AND b.payment_status != 'cancelled'`,
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
           AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')`,
        [room.id]
      );

      let isOverlapped = false;
      for (const b of roomBookings) {
        if (!b.start_time || !b.end_time) continue;
        
        // Convert to timestamp
        const bStartMs = new Date(b.start_time).getTime();
        const bEndMs = new Date(b.end_time).getTime();

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
    // Start exclusive transaction to prevent race conditions
    await dbQuery.run('BEGIN EXCLUSIVE TRANSACTION');

    try {
      // Verify room exists and is active
      const room = await dbQuery.get('SELECT * FROM rooms WHERE id = ? AND status = ?', [room_id, 'active']);
      if (!room) {
        await dbQuery.run('ROLLBACK');
        return res.status(404).json({ error: 'ไม่พบห้องที่เลือก หรือห้องไม่พร้อมใช้งาน' });
      }

      // Normalize timestamps
      const fullStart = normalizeToLocalISO(booking_date, start_time);
      const fullEnd = normalizeToLocalISO(booking_date, end_time);

      // Check for overlap (cross-system safe including 30-min cleaning buffer)
      const overlapResult = await checkRoomOverlap(room_id, fullStart, fullEnd);
      if (overlapResult.hasOverlap) {
        await dbQuery.run('ROLLBACK');
        return res.status(409).json({ error: formatOverlapErrorMessage(room.name, overlapResult) });
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

      const subtotal = total_amount || Math.round(price * quantity * 100) / 100;

      const receiptNumber = await generateReceiptNumber();

      let pinCode = null;
      if (room.pin_code && room.pin_code.trim()) {
        pinCode = room.pin_code.trim();
      } else {
        pinCode = await generateUniquePinCode();
      }

      // Insert master booking (with mandatory guest_count)
      const bookingResult = await dbQuery.run(
        `INSERT INTO bookings (
          customer_name, department, contact, total_amount, payment_status, payment_method, 
          receipt_number, pin_code, booking_source, customer_email, checkin_status, line_user_id,
          tax_invoice_required, tax_name, tax_address, tax_id, tax_phone, tax_delivery_method, tax_postal_address,
          guest_count,
          created_at
        ) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customer_name, department || note || '', contact, subtotal, 'pending', 'transfer', 
          receiptNumber, pinCode, 'online', email || null, 'pending', line_user_id || null,
          tax_invoice_required ? 1 : 0, tax_name || null, tax_address || null, tax_id || null, tax_phone || null,
          tax_delivery_method || null, tax_postal_address || null,
          parsedGuests,
          normalizeToLocalISO(new Date())
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

      await dbQuery.run('COMMIT');

      const bookingCode = `BK-${String(bookingId).padStart(6, '0')}`;

      res.status(201).json({
        success: true,
        bookingId,
        bookingCode,
        receiptNumber,
        totalAmount: subtotal,
        paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        message: 'จองห้องประชุมสำเร็จ! กรุณาชำระเงินภายใน 24 ชั่วโมง'
      });
    } catch (innerErr) {
      await dbQuery.run('ROLLBACK').catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// Lookup Bookings By Phone Number (for Status Page)
app.get(['/api/public/bookings/by-phone', '/api/public/bookings/lookup'], async (req, res) => {
  const phone = req.query.phone || req.query.contact;
  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกเบอร์โทรศัพท์' });
  }

  try {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const bookings = await dbQuery.all(
      `SELECT * FROM bookings 
       WHERE (REPLACE(REPLACE(REPLACE(contact, '-', ''), ' ', ''), '+', '') = ? 
          OR contact = ? 
          OR contact LIKE ?)
       ORDER BY id DESC LIMIT 10`,
      [cleanPhone, phone, `%${cleanPhone}%`]
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
      b.items = items || [];
      b.bookingCode = `BK-${String(b.id).padStart(6, '0')}`;
      if (items && items.length && items[0].room_name) {
        b.room_name = items[0].room_name;
        b.room = { id: items[0].room_id, name: items[0].room_name, capacity: items[0].capacity, image_url: items[0].image_url };
        b.start_time = items[0].start_time?.includes('T') ? items[0].start_time.split('T')[1].substring(0, 5) : items[0].start_time;
        b.end_time = items[0].end_time?.includes('T') ? items[0].end_time.split('T')[1].substring(0, 5) : items[0].end_time;
        b.booking_date = items[0].start_time?.includes('T') ? items[0].start_time.split('T')[0] : b.created_at?.split('T')[0];
      }
    }

    res.json({ success: true, bookings });
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

    if (booking.payment_status !== 'paid') {
      return res.status(400).json({ error: 'รายการจองนี้ยังไม่ได้รับการยืนยันชำระเงิน กรุณาติดต่อพนักงาน' });
    }

    res.json({ success: true, pin_code: booking.pin_code, message: `รหัสผ่านเปิดประตูคือ ${booking.pin_code}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get booking status (public - requires contact for verification)
app.get('/api/public/bookings/:id', async (req, res) => {
  const { id } = req.params;
  const { contact } = req.query;

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
    let booking;
    if (contact) {
      const cleanContact = String(contact).replace(/\D/g, '');
      booking = await dbQuery.get(
        `SELECT * FROM bookings 
         WHERE (id = ? OR id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)) 
           AND (REPLACE(REPLACE(REPLACE(contact, '-', ''), ' ', ''), '+', '') = ? OR contact = ?)`,
        [numericId, id, id, id, cleanContact, contact]
      );
    } else {
      booking = await dbQuery.get(
        'SELECT * FROM bookings WHERE id = ? OR id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)',
        [numericId, id, id, id]
      );
    }

    if (!booking) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง หรือเบอร์โทรศัพท์ไม่ถูกต้อง' });
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

    res.json({
      ...booking,
      bookingCode,
      items: items || [],
      room: roomInfo,
      start_time: items && items.length ? (items[0].start_time?.includes('T') ? items[0].start_time.split('T')[1].substring(0, 5) : items[0].start_time) : null,
      end_time: items && items.length ? (items[0].end_time?.includes('T') ? items[0].end_time.split('T')[1].substring(0, 5) : items[0].end_time) : null,
      booking_date: items && items.length ? (items[0].start_time?.includes('T') ? items[0].start_time.split('T')[0] : booking.created_at?.split('T')[0]) : null,
      paymentDeadline: new Date(new Date(booking.created_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload payment slip for a booking
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
    const targetBookingId = booking.id;

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

    // Update booking with slip URL and change status to 'reviewing'
    await dbQuery.run(
      'UPDATE bookings SET slip_image_url = ?, payment_status = ? WHERE id = ?',
      [slipUrl, 'reviewing', targetBookingId]
    );

    res.json({
      success: true,
      slipUrl,
      message: 'อัปโหลดสลิปสำเร็จ! กำลังตรวจสอบการชำระเงิน'
    });
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// Get payment settings for public display
app.get('/api/public/settings/payment', async (req, res) => {
  try {
    const settings = await dbQuery.all('SELECT key, value FROM settings');
    const settingsMap = {};
    settings.forEach(s => { settingsMap[s.key] = s.value; });

    res.json({
      promptpay_id: settingsMap.promptpay_id || '0125554000401',
      bank_name: settingsMap.payment_bank_name || 'ธนาคารกรุงศรีอยุธยา (Krungsri)',
      bank_account: settingsMap.payment_bank_account || '329-1-38429-0',
      bank_account_name: settingsMap.payment_bank_account_name || 'บริษัท บิลท์ ฮาร์ท จำกัด',
      payment_deadline_hours: parseInt(settingsMap.payment_deadline_hours || '24', 10),
      cleaning_buffer_minutes: parseInt(settingsMap.cleaning_buffer_minutes || '30', 10)
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
