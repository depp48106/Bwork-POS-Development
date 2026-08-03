const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDatabase, dbQuery, hashPassword } = require('./database');
const { performBackup } = require('./backup');

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
      `SELECT u.id, u.username, u.role, r.permissions, u.fullname 
       FROM users u 
       LEFT JOIN roles r ON u.role = r.name 
       WHERE u.username = ? AND u.password_hash = ?`,
      [username, hashedPassword]
    );

    if (user) {
      res.json({ success: true, user: { username: user.username, role: user.role, permissions: user.permissions, fullname: user.fullname } });
    } else {
      res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาดของระบบ: ' + err.message });
  }
});

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
    has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, 
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
        has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, 
        description, status, image_url,
        has_hourly, has_halfday, has_daily, pin_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, capacity, hourly_rate, daily_rate || 0, half_day_rate || 0,
        has_classroom || 0, classroom_hourly_rate || 0, classroom_daily_rate || 0, classroom_capacity || 0,
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
    has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, 
    description, status, image_url,
    has_hourly, has_halfday, has_daily, pin_code
  } = req.body;
  try {
    await dbQuery.run(
      `UPDATE rooms 
       SET name = ?, capacity = ?, hourly_rate = ?, daily_rate = ?, half_day_rate = ?,
           has_classroom = ?, classroom_hourly_rate = ?, classroom_daily_rate = ?, classroom_capacity = ?, 
           description = ?, status = ?, image_url = ?,
           has_hourly = ?, has_halfday = ?, has_daily = ?, pin_code = ?
       WHERE id = ?`,
      [
        name, capacity, hourly_rate, daily_rate || 0, half_day_rate || 0,
        has_classroom || 0, classroom_hourly_rate || 0, classroom_daily_rate || 0, classroom_capacity || 0,
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
      return res.status(400).json({ error: 'ไม่สามารถลบห้องประชุมนี้ได้ เนื่องจากมีประวัติการจองอยู่ในระบบ แนะนำให้เปลี่ยนสถานะคลังสินค้าเป็น "ปิดใช้งานชั่วคราว" แทน' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rooms/:id/bookings', async (req, res) => {
  try {
    const bookings = await dbQuery.all(
      `SELECT bi.start_time, bi.end_time, b.customer_name, b.contact, b.payment_status, b.payment_method, b.id as booking_id
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
      return res.status(400).json({ error: 'ไม่สามารถลบรายการนี้ได้ เนื่องจากมีประวัติการจองหรือใช้บริการอยู่ในระบบ แนะนำให้เปลี่ยนสถานะคลังสินค้าเป็น "ปิดใช้งานชั่วคราว" แทน' });
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
    const referenced = await dbQuery.get(
      `SELECT (
        SELECT COUNT(*) FROM booking_items bi
        JOIN services s ON bi.service_id = s.id
        WHERE s.category = ?
       ) + (
        SELECT COUNT(*) FROM booking_items bi
        JOIN rooms r ON bi.room_id = r.id
        WHERE r.category = ?
       ) as count`,
      [name, name]
    );
    if (referenced.count > 0) {
      return res.status(400).json({ error: 'ไม่สามารถลบหมวดหมู่นี้ได้ เนื่องจากมีสินค้าในหมวดหมู่นี้ถูกใช้งานในประวัติการจองแล้ว แนะนำให้เปลี่ยนสถานะสินค้าเป็นปิดใช้งานชั่วคราวแทน' });
    }
    await dbQuery.run('DELETE FROM services WHERE category = ?', [name]);
    await dbQuery.run('DELETE FROM rooms WHERE category = ?', [name]);
    res.json({ message: 'ลบหมวดหมู่และรายการในหมวดหมู่สำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================================
// 4. BOOKINGS (POS CHECKOUT & HISTORY)
// ==========================================
// Helper to generate a daily-resetting receipt number in the format REC-YYYYMMDD-XXXX
async function generateReceiptNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`; // e.g. "20260717"

  // Query the last receipt number generated today
  const lastBooking = await dbQuery.get(
    `SELECT receipt_number FROM bookings 
     WHERE date(created_at, 'localtime') = date('now', 'localtime')
     AND receipt_number LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [`REC-${dateStr}-%`]
  );

  let sequence = 1;
  if (lastBooking && lastBooking.receipt_number) {
    const parts = lastBooking.receipt_number.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) {
      sequence = lastSeq + 1;
    }
  }

  return `REC-${dateStr}-${String(sequence).padStart(4, '0')}`;
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

app.post('/api/bookings', async (req, res) => {
  const { customer_name, department, contact, total_amount, payment_status, payment_method, items, line_user_id } = req.body;

  if (!customer_name || !items || !items.length) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลผู้จองและเลือกรายการอย่างน้อย 1 รายการ' });
  }

  try {
    const receiptNumber = await generateReceiptNumber();
    const roomItem = items.find(it => !!it.room_id);
    let pinCode = null;

    if (roomItem) {
      // Check if room has a fixed PIN code configured
      const roomDb = await dbQuery.get('SELECT pin_code FROM rooms WHERE id = ?', [roomItem.room_id]);
      if (roomDb && roomDb.pin_code && roomDb.pin_code.trim()) {
        pinCode = roomDb.pin_code.trim();
      } else {
        pinCode = await generateUniquePinCode();
      }
    }

    // 1. Insert master booking
    const bookingResult = await dbQuery.run(
      'INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, line_user_id, checkin_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [customer_name, department || '', contact || '', total_amount, payment_status || 'pending', payment_method || 'cash', receiptNumber, pinCode, line_user_id || null, 'pending', new Date().toISOString()]
    );
    const bookingId = bookingResult.id;

    // 2. Insert booking items
    for (const item of items) {
      await dbQuery.run(
        `INSERT INTO booking_items 
         (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, pin_code, checkin_status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          item.room_id || null,
          item.service_id || null,
          item.quantity || 1,
          item.price,
          item.start_time || null,
          item.end_time || null,
          item.subtotal,
          item.layout || 'standard',
          item.booking_type || 'hourly',
          item.room_id ? pinCode : null,
          'pending'
        ]
      );
    }

    res.status(201).json({ 
      success: true, 
      bookingId, 
      receiptNumber,
      pinCode,
      message: 'บันทึกการจองสำเร็จ' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bookings', async (req, res) => {
    const { start_date, end_date, search, payment_status } = req.query;
    try {
      let sql = 'SELECT * FROM bookings WHERE 1=1';
      const params = [];

      if (start_date) {
        sql += ' AND datetime(created_at) >= datetime(?)';
        params.push(start_date + ' 00:00:00');
      }
      if (end_date) {
        sql += ' AND datetime(created_at) <= datetime(?)';
        params.push(end_date + ' 23:59:59');
      }
      if (search) {
        sql += ' AND (customer_name LIKE ? OR department LIKE ? OR receipt_number LIKE ? OR CAST(id AS TEXT) LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (payment_status) {
        sql += ' AND payment_status = ?';
        params.push(payment_status);
      }

    sql += ' ORDER BY created_at DESC';

    const bookings = await dbQuery.all(sql, params);
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
              r.name as room_name,
              b.id as booking_id, b.customer_name, b.payment_status
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

// Get upcoming booking alerts (with customizable warning time)
app.get('/api/bookings/upcoming-alerts', async (req, res) => {
  try {
    const settingRow = await dbQuery.get('SELECT value FROM settings WHERE key = ?', ['room_alert_minutes']);
    const alertMinutes = settingRow && settingRow.value ? parseInt(settingRow.value, 10) : 15;

    const now = new Date();
    const futureLimit = new Date(now.getTime() + alertMinutes * 60 * 1000);
    const nowISO = now.toISOString();
    const futureISO = futureLimit.toISOString();

    const alerts = await dbQuery.all(
      `SELECT bi.start_time, bi.end_time, bi.room_id, bi.layout, bi.booking_type,
              r.name as room_name,
              b.id as booking_id, b.customer_name, b.payment_status
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.id
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE bi.room_id IS NOT NULL
         AND bi.start_time >= ?
         AND bi.start_time <= ?
       ORDER BY bi.start_time ASC`,
      [nowISO, futureISO]
    );
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if room has an overlapping booking during the requested time range
app.get('/api/bookings/check-overlap', async (req, res) => {
  const { room_id, start_time, end_time } = req.query;
  if (!room_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'กรุณาระบุข้อมูลห้องและเวลาเริ่มต้น/สิ้นสุดเพื่อตรวจสอบ' });
  }

  try {
    const overlap = await dbQuery.get(
      `SELECT b.id, b.customer_name, bi.start_time, bi.end_time
       FROM booking_items bi
       JOIN bookings b ON bi.booking_id = b.id
       WHERE bi.room_id = ?
         AND bi.start_time < ?
         AND bi.end_time > ?`,
      [room_id, end_time, start_time]
    );

    res.json({
      overlap: !!overlap,
      booking: overlap ? {
        id: overlap.id,
        customer_name: overlap.customer_name,
        start_time: overlap.start_time,
        end_time: overlap.end_time
      } : null
    });
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
      `SELECT bi.*, r.name as room_name, r.description as room_description, s.name as service_name 
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
  try {
    // Cascade delete is handled by database.js setup (ON DELETE CASCADE)
    await dbQuery.run('DELETE FROM bookings WHERE id = ?', [req.params.id]);
    res.json({ message: 'ลบ/ยกเลิกรายการจองสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update payment status (e.g. from pending to paid)
app.patch('/api/bookings/:id/payment', async (req, res) => {
  const { payment_status, payment_method } = req.body;
  try {
    await dbQuery.run(
      'UPDATE bookings SET payment_status = ?, payment_method = ? WHERE id = ?',
      [payment_status, payment_method, req.params.id]
    );
    res.json({ success: true, message: 'อัปเดตสถานะชำระเงินสำเร็จ' });
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

    res.json({ success: true, bookingId, message: 'แปลงเป็นรายการจองสำเร็จ' });
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

// Manual backup trigger
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
        `SELECT b.id as booking_id, b.customer_name, b.department, bi.start_time, bi.end_time, b.payment_status
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
      SELECT u.id, u.username, u.role, r.permissions, u.fullname, u.created_at, r.label as role_label 
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
  const { username, password, role, fullname } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลผู้ใช้ให้ครบถ้วน' });
  }

  try {
    const password_hash = hashPassword(password);
    const result = await dbQuery.run(
      'INSERT INTO users (username, password_hash, role, fullname) VALUES (?, ?, ?, ?)',
      [username, password_hash, role, fullname || 'พนักงาน Bwork']
    );
    res.status(201).json({ id: result.id, username, role, fullname: fullname || 'พนักงาน Bwork' });
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
  const { username, role, fullname } = req.body;
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
      'UPDATE users SET username = ?, role = ?, fullname = ? WHERE id = ?',
      [targetUsername, targetRole, fullname, req.params.id]
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

// Auto-run backup daily at midnight (local time)
// Since this is a local desktop app that may close, we also check & trigger backup when app starts or when users log in.
// We can use a simple daily timer check interval in Node.js
let lastBackupDate = '';
setInterval(async () => {
  const todayStr = new Date().toLocaleDateString();
  if (lastBackupDate !== todayStr) {
    // Run backup
    console.log('Automated Daily Backup started...');
    const result = await performBackup();
    if (result.success) {
      lastBackupDate = todayStr;
    }
  }
}, 60 * 60 * 1000); // Check every hour

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
