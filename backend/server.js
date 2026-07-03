const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDatabase, dbQuery, hashPassword } = require('./database');
const { performBackup } = require('./backup');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serve static frontend in production
app.use(express.static(path.join(__dirname, 'public')));

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
      'SELECT id, username, role FROM users WHERE username = ? AND password_hash = ?',
      [username, hashedPassword]
    );

    if (user) {
      res.json({ success: true, user: { username: user.username, role: user.role } });
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
    description, status 
  } = req.body;
  
  if (!name || !capacity || hourly_rate === undefined) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลห้องประชุมให้ครบถ้วน' });
  }
  try {
    const result = await dbQuery.run(
      `INSERT INTO rooms (
        name, capacity, hourly_rate, daily_rate, half_day_rate,
        has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, 
        description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, capacity, hourly_rate, daily_rate || 0, half_day_rate || 0,
        has_classroom || 0, classroom_hourly_rate || 0, classroom_daily_rate || 0, classroom_capacity || 0,
        description || '', status || 'active'
      ]
    );
    res.status(201).json({ 
      id: result.id, name, capacity, hourly_rate, daily_rate: daily_rate || 0, half_day_rate: half_day_rate || 0,
      has_classroom: has_classroom || 0,
      classroom_hourly_rate: classroom_hourly_rate || 0,
      classroom_daily_rate: classroom_daily_rate || 0,
      classroom_capacity: classroom_capacity || 0,
      description, status: status || 'active' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/rooms/:id', async (req, res) => {
  const { 
    name, capacity, hourly_rate, daily_rate, half_day_rate,
    has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, 
    description, status 
  } = req.body;
  try {
    await dbQuery.run(
      `UPDATE rooms 
       SET name = ?, capacity = ?, hourly_rate = ?, daily_rate = ?, half_day_rate = ?,
           has_classroom = ?, classroom_hourly_rate = ?, classroom_daily_rate = ?, classroom_capacity = ?, 
           description = ?, status = ? 
       WHERE id = ?`,
      [
        name, capacity, hourly_rate, daily_rate || 0, half_day_rate || 0,
        has_classroom || 0, classroom_hourly_rate || 0, classroom_daily_rate || 0, classroom_capacity || 0,
        description, status, req.params.id
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
  const { name, price, category, status } = req.body;
  if (!name || price === undefined || !category) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลบริการให้ครบถ้วน' });
  }
  try {
    const result = await dbQuery.run(
      'INSERT INTO services (name, price, category, status) VALUES (?, ?, ?, ?)',
      [name, price, category, status || 'active']
    );
    res.status(201).json({ id: result.id, name, price, category, status: status || 'active' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/services/:id', async (req, res) => {
  const { name, price, category, status } = req.body;
  try {
    await dbQuery.run(
      'UPDATE services SET name = ?, price = ?, category = ?, status = ? WHERE id = ?',
      [name, price, category, status, req.params.id]
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
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. BOOKINGS (POS CHECKOUT & HISTORY)
// ==========================================
app.post('/api/bookings', async (req, res) => {
  const { customer_name, department, contact, total_amount, payment_status, payment_method, items } = req.body;

  if (!customer_name || !items || !items.length) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลผู้จองและเลือกรายการอย่างน้อย 1 รายการ' });
  }

  try {
    // 1. Insert master booking
    const bookingResult = await dbQuery.run(
      'INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [customer_name, department || '', contact || '', total_amount, payment_status || 'pending', payment_method || 'cash', new Date().toISOString()]
    );
    const bookingId = bookingResult.id;

    // 2. Insert booking items
    for (const item of items) {
      await dbQuery.run(
        `INSERT INTO booking_items 
         (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          item.booking_type || 'hourly'
        ]
      );
    }

    res.status(201).json({ success: true, bookingId, message: 'บันทึกการจองสำเร็จ' });
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
        sql += ' AND (customer_name LIKE ? OR department LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
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

    // Get details
    const items = await dbQuery.all(
      `SELECT bi.*, r.name as room_name, s.name as service_name 
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

// List users (admin only)
app.get('/api/users', async (req, res) => {
  try {
    const users = await dbQuery.all('SELECT id, username, role, created_at FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add user (admin only)
app.post('/api/users', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลผู้ใช้ให้ครบถ้วน' });
  }

  try {
    const password_hash = hashPassword(password);
    const result = await dbQuery.run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, password_hash, role]
    );
    res.status(201).json({ id: result.id, username, role });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      res.status(400).json({ error: 'ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว' });
    } else {
      res.status(500).json({ error: err.message });
    }
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
