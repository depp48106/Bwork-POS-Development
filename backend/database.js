const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dbFilename = 'database.sqlite';
const dbPath = path.join(__dirname, dbFilename);
const db = new sqlite3.Database(dbPath, (err) => {
  if (!err) {
    db.run("PRAGMA foreign_keys = ON;");
  }
});

// Helper function to hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Wrap sqlite3 queries in promises
const dbQuery = {
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  },
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  exec(sql) {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};

// Initialize database schema and seed data
async function initDatabase() {
  console.log('Initializing SQLite database...');

  // Create tables
  await dbQuery.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      hourly_rate REAL NOT NULL,
      daily_rate REAL DEFAULT 0,
      half_day_rate REAL DEFAULT 0,
      has_classroom INTEGER DEFAULT 0,
      classroom_hourly_rate REAL DEFAULT 0,
      classroom_daily_rate REAL DEFAULT 0,
      classroom_capacity INTEGER DEFAULT 0,
      description TEXT,
      status TEXT DEFAULT 'active',
      image_url TEXT,
      category TEXT DEFAULT 'Meeting Room',
      pin_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      department TEXT,
      contact TEXT,
      total_amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      payment_method TEXT,
      pin_code TEXT,
      qr_token TEXT,
      line_user_id TEXT,
      checkin_status TEXT DEFAULT 'pending',
      checkin_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
      room_id INTEGER REFERENCES rooms(id),
      service_id INTEGER REFERENCES services(id),
      quantity INTEGER DEFAULT 1,
      price REAL NOT NULL,
      start_time TEXT,
      end_time TEXT,
      subtotal REAL NOT NULL,
      layout TEXT DEFAULT 'standard',
      booking_type TEXT DEFAULT 'hourly',
      pin_code TEXT,
      checkin_status TEXT DEFAULT 'pending',
      checkin_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      permissions TEXT,
      fullname TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      permissions TEXT NOT NULL,
      is_system INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      department TEXT,
      contact TEXT,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'draft',
      valid_until TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quotation_id INTEGER REFERENCES quotations(id) ON DELETE CASCADE,
      room_id INTEGER REFERENCES rooms(id),
      service_id INTEGER REFERENCES services(id),
      quantity INTEGER DEFAULT 1,
      price REAL NOT NULL,
      start_time TEXT,
      end_time TEXT,
      subtotal REAL NOT NULL,
      layout TEXT DEFAULT 'standard',
      booking_type TEXT DEFAULT 'hourly'
    );
  `);

  // Migration: Add permissions column to users if not exists
  try {
    await dbQuery.run('ALTER TABLE users ADD COLUMN permissions TEXT');
    console.log('Migration: Added permissions column to users table.');
  } catch (e) {}

  // Migration: Add fullname column to users if not exists
  try {
    await dbQuery.run('ALTER TABLE users ADD COLUMN fullname TEXT');
    console.log('Migration: Added fullname column to users table.');
  } catch (e) {}

  // Migration: Add image_url column to rooms if not exists
  try {
    await dbQuery.run('ALTER TABLE rooms ADD COLUMN image_url TEXT');
    console.log('Migration: Added image_url column to rooms table.');
  } catch (e) {}

  // Migration: Add image_url column to services if not exists
  try {
    await dbQuery.run('ALTER TABLE services ADD COLUMN image_url TEXT');
    console.log('Migration: Added image_url column to services table.');
  } catch (e) {}

  // Migration: Add category column to rooms if not exists
  try {
    await dbQuery.run("ALTER TABLE rooms ADD COLUMN category TEXT DEFAULT 'Meeting Room'");
    console.log('Migration: Added category column to rooms table.');
  } catch (e) {}

  // Migration: Add pin_code column to rooms if not exists
  try {
    await dbQuery.run("ALTER TABLE rooms ADD COLUMN pin_code TEXT");
    console.log('Migration: Added pin_code column to rooms table.');
  } catch (e) {}

  // Update existing users who have null permissions or fullnames
  try {
    await dbQuery.run("UPDATE users SET permissions = 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation,admin-dooraccess' WHERE role = 'admin'");
    await dbQuery.run("UPDATE users SET permissions = 'pos,pending,layout,history,quotations' WHERE role = 'staff'");
    await dbQuery.run("UPDATE users SET fullname = 'ผู้ดูแลระบบหลัก' WHERE username = 'admin' AND (fullname IS NULL OR fullname = '')");
    await dbQuery.run("UPDATE users SET fullname = 'พนักงานต้อนรับประจำกะ' WHERE username = 'staff' AND (fullname IS NULL OR fullname = '')");
  } catch (e) {}

  // Migration: Add PIN Code and LINE OA columns to bookings & booking_items
  try {
    await dbQuery.run('ALTER TABLE bookings ADD COLUMN pin_code TEXT');
  } catch (e) {}
  try {
    await dbQuery.run('ALTER TABLE bookings ADD COLUMN qr_token TEXT');
  } catch (e) {}
  try {
    await dbQuery.run('ALTER TABLE bookings ADD COLUMN line_user_id TEXT');
  } catch (e) {}
  try {
    await dbQuery.run("ALTER TABLE bookings ADD COLUMN checkin_status TEXT DEFAULT 'pending'");
  } catch (e) {}
  try {
    await dbQuery.run('ALTER TABLE bookings ADD COLUMN checkin_at DATETIME');
  } catch (e) {}

  try {
    await dbQuery.run('ALTER TABLE booking_items ADD COLUMN pin_code TEXT');
  } catch (e) {}
  try {
    await dbQuery.run("ALTER TABLE booking_items ADD COLUMN checkin_status TEXT DEFAULT 'pending'");
  } catch (e) {}
  try {
    await dbQuery.run('ALTER TABLE booking_items ADD COLUMN checkin_at DATETIME');
  } catch (e) {}

  // Migration: Add daily_rate column if not exists
  try {
    await dbQuery.run('ALTER TABLE rooms ADD COLUMN daily_rate REAL DEFAULT 0');
    console.log('Migration: Added daily_rate column to rooms table.');
  } catch (e) {}

  // Migration: Add classroom columns if not exists
  try {
    await dbQuery.run('ALTER TABLE rooms ADD COLUMN has_classroom INTEGER DEFAULT 0');
    await dbQuery.run('ALTER TABLE rooms ADD COLUMN classroom_hourly_rate REAL DEFAULT 0');
    await dbQuery.run('ALTER TABLE rooms ADD COLUMN classroom_daily_rate REAL DEFAULT 0');
    await dbQuery.run('ALTER TABLE rooms ADD COLUMN classroom_capacity INTEGER DEFAULT 0');
    console.log('Migration: Added classroom layout columns to rooms table.');
  } catch (e) {}

  // Migration: Add layout column to booking_items if not exists
  try {
    await dbQuery.run("ALTER TABLE booking_items ADD COLUMN layout TEXT DEFAULT 'standard'");
    console.log('Migration: Added layout column to booking_items table.');
  } catch (e) {}

  // Migration: Add booking_type column to booking_items if not exists
  try {
    await dbQuery.run("ALTER TABLE booking_items ADD COLUMN booking_type TEXT DEFAULT 'hourly'");
    console.log('Migration: Added booking_type column to booking_items table.');
  } catch (e) {}

  // Migration: Add half_day_rate column to rooms if not exists
  try {
    await dbQuery.run("ALTER TABLE rooms ADD COLUMN half_day_rate REAL DEFAULT 0");
    console.log('Migration: Added half_day_rate column to rooms table.');
  } catch (e) {}

  // Migration: Add quotation metadata columns if not exists
  try {
    await dbQuery.run("ALTER TABLE quotations ADD COLUMN seller_name TEXT");
    await dbQuery.run("ALTER TABLE quotations ADD COLUMN job_name TEXT");
    await dbQuery.run("ALTER TABLE quotations ADD COLUMN customer_address TEXT");
    await dbQuery.run("ALTER TABLE quotations ADD COLUMN quotation_no TEXT");
  } catch (e) {}

  try {
    await dbQuery.run("ALTER TABLE quotation_items ADD COLUMN discount REAL DEFAULT 0");
    await dbQuery.run("ALTER TABLE quotation_items ADD COLUMN item_date TEXT");
    await dbQuery.run("ALTER TABLE quotation_items ADD COLUMN discount_type TEXT DEFAULT 'amount'");
  } catch (e) {}

  // Migration: Add booking type flag columns to rooms if not exists
  try {
    await dbQuery.run('ALTER TABLE rooms ADD COLUMN has_hourly INTEGER DEFAULT 1');
    await dbQuery.run('ALTER TABLE rooms ADD COLUMN has_halfday INTEGER DEFAULT 0');
    await dbQuery.run('ALTER TABLE rooms ADD COLUMN has_daily INTEGER DEFAULT 0');
    // Backfill: set flags based on existing rate values
    await dbQuery.run("UPDATE rooms SET has_hourly = 1 WHERE hourly_rate > 0");
    await dbQuery.run("UPDATE rooms SET has_halfday = 1 WHERE half_day_rate > 0");
    await dbQuery.run("UPDATE rooms SET has_daily = 1 WHERE daily_rate > 0");
    console.log('Migration: Added has_hourly/has_halfday/has_daily columns to rooms table.');
  } catch (e) {}

  // Migration: Add receipt_number column to bookings if not exists
  try {
    await dbQuery.run('ALTER TABLE bookings ADD COLUMN receipt_number TEXT');
    console.log('Migration: Added receipt_number column to bookings table.');
  } catch (e) {}

  // Migration: Add approved_at column to quotations if not exists
  try {
    await dbQuery.run('ALTER TABLE quotations ADD COLUMN approved_at TEXT');
    console.log('Migration: Added approved_at column to quotations table.');
  } catch (e) {}

  // Seed default rooms if empty
  const roomCount = await dbQuery.get('SELECT COUNT(*) as count FROM rooms');
  if (roomCount.count === 0) {
    await dbQuery.run('INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, description) VALUES (?, ?, ?, ?, ?)', [
      'ห้องประชุมใหญ่ A (Grand Boardroom)', 20, 500.0, 4000.0, 'ห้องประชุมขนาดใหญ่พร้อมอุปกรณ์เครื่องเสียงครบครัน'
    ]);
    await dbQuery.run('INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, description) VALUES (?, ?, ?, ?, ?)', [
      'ห้องประชุมกลาง B (Standard Room)', 10, 300.0, 2400.0, 'ห้องประชุมขนาดกลาง เหมาะสำหรับทีมงาน 8-10 คน'
    ]);
    await dbQuery.run('INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, description) VALUES (?, ?, ?, ?, ?)', [
      'ห้องประชุมเล็ก C (Mini Meeting Room)', 5, 150.0, 1200.0, 'ห้องประชุมย่อยส่วนตัว เหมาะสำหรับการคุยงานเร่งด่วน'
    ]);
  }

  // Ensure "ห้องประชุม Jupiter (300)" exists
  const jupiterRoom = await dbQuery.get("SELECT COUNT(*) as count FROM rooms WHERE name LIKE '%300%'");
  if (jupiterRoom.count === 0) {
    await dbQuery.run("INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, half_day_rate, description) VALUES (?, ?, ?, ?, ?, ?)", [
      'ห้องประชุม Jupiter (300)', 30, 800.0, 6400.0, 6000.0, 'ห้องประชุมใหญ่โถงอเนกประสงค์'
    ]);
  } else {
    // Update existing Jupiter Room to ensure half_day_rate is set
    await dbQuery.run("UPDATE rooms SET half_day_rate = 6000.0 WHERE name LIKE '%300%'");
  }

  // Ensure Room 301 exists with standard and classroom layout pricing
  const room301 = await dbQuery.get("SELECT COUNT(*) as count FROM rooms WHERE name LIKE '%301%'");
  if (room301.count === 0) {
    await dbQuery.run(
      `INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, description) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['ห้องประชุม 301', 8, 400.0, 4000.0, 1, 700.0, 5000.0, 12, 'ห้องประชุมส่วนตัวปรับสลับจัดห้องแบบ classroom ได้']
    );
    console.log('Seed: Added ห้องประชุม 301 with classroom settings.');
  } else {
    // Update existing room 301 to ensure classroom is enabled
    await dbQuery.run(
      `UPDATE rooms 
       SET has_classroom = 1, classroom_hourly_rate = 700.0, classroom_daily_rate = 5000.0, classroom_capacity = 12 
       WHERE name LIKE '%301%'`
    );
    console.log('Seed: Updated existing Room 301 with classroom settings.');
  }

  // Seed default services if empty
  const serviceCount = await dbQuery.get('SELECT COUNT(*) as count FROM services');
  if (serviceCount.count === 0) {
    await dbQuery.run('INSERT INTO services (name, price, category) VALUES (?, ?, ?)', [
      'กาแฟ & ชา ของว่าง (Catering Box)', 50.0, 'catering'
    ]);
    await dbQuery.run('INSERT INTO services (name, price, category) VALUES (?, ?, ?)', [
      'เครื่องดื่มน้ำสมุนไพร & น้ำดื่ม (Herb Drinks)', 30.0, 'catering'
    ]);
    await dbQuery.run('INSERT INTO services (name, price, category) VALUES (?, ?, ?)', [
      'เครื่องโปรเจคเตอร์ 4K (Projector Rental)', 100.0, 'equipment'
    ]);
    await dbQuery.run('INSERT INTO services (name, price, category) VALUES (?, ?, ?)', [
      'เจ้าหน้าที่เทคนิคประจำห้องประชุม (IT Technical Support)', 200.0, 'staff'
    ]);
  }

  // Seed default settings if empty
  const settingsCount = await dbQuery.get('SELECT COUNT(*) as count FROM settings');
  if (settingsCount.count === 0) {
    await dbQuery.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['company_name', 'บริษัท ดีพมายด์ โซลูชั่น จำกัด']);
    await dbQuery.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['receipt_header', 'ใบเสร็จรับเงิน / ใบรับจองบริการ']);
    await dbQuery.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['receipt_footer', 'ขอบคุณที่ใช้บริการห้องประชุมของเรา']);
    
    // Default backup path: inside users home folder under OneDrive if available, or a folder on C: drive
    const defaultBackupPath = path.join(process.env.USERPROFILE || 'C:', 'OneDrive', 'POS_Backups');
    await dbQuery.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['onedrive_path', defaultBackupPath]);
  }

  // Seed default settings for quotations if not exists
  try {
    const checkTerms = await dbQuery.get("SELECT value FROM settings WHERE key = 'quotation_terms'");
    if (!checkTerms) {
      await dbQuery.run("INSERT INTO settings (key, value) VALUES ('quotation_terms', '- ชำระมัดจำ 50% เพื่อจองคิวการใช้งาน\n- ส่วนที่เหลือชำระ ณ วันเข้าใช้งานบริการ\n- อัตราค่าบริการนี้รวมภาษีมูลค่าเพิ่มแล้ว')");
    }
    const checkSigner = await dbQuery.get("SELECT value FROM settings WHERE key = 'quotation_signer'");
    if (!checkSigner) {
      await dbQuery.run("INSERT INTO settings (key, value) VALUES ('quotation_signer', 'ผู้ดูแลระบบ')");
    }
    const checkValidDays = await dbQuery.get("SELECT value FROM settings WHERE key = 'quotation_valid_days'");
    if (!checkValidDays) {
      await dbQuery.run("INSERT INTO settings (key, value) VALUES ('quotation_valid_days', '7')");
    }
  } catch (e) {}

  // Seed default roles if empty
  const roleCount = await dbQuery.get('SELECT COUNT(*) as count FROM roles');
  if (roleCount.count === 0) {
    await dbQuery.run("INSERT INTO roles (name, label, permissions, is_system) VALUES (?, ?, ?, 1)", [
      'admin', 'ผู้ดูแลระบบ (Admin)', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation'
    ]);
    await dbQuery.run("INSERT INTO roles (name, label, permissions, is_system) VALUES (?, ?, ?, 1)", [
      'staff', 'พนักงานต้อนรับ (Reception)', 'pos,pending,layout,history,quotations'
    ]);
  }

  // Seed default users if empty
  const userCount = await dbQuery.get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    // default user: admin / admin123
    await dbQuery.run('INSERT INTO users (username, password_hash, role, permissions, fullname) VALUES (?, ?, ?, ?, ?)', [
      'admin', hashPassword('admin123'), 'admin', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation', 'ผู้ดูแลระบบหลัก'
    ]);
    await dbQuery.run('INSERT INTO users (username, password_hash, role, permissions, fullname) VALUES (?, ?, ?, ?, ?)', [
      'staff', hashPassword('staff123'), 'staff', 'pos,pending,layout,history,quotations', 'พนักงานต้อนรับประจำกะ'
    ]);
  }

  console.log('Database initialized successfully.');
}

module.exports = {
  db,
  dbQuery,
  initDatabase,
  hashPassword
};
