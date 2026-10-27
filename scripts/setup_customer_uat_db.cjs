/**
 * BWORK-POS | CUSTOMER, SHOP & CONTRACT UAT DATABASE INITIALIZER
 * Creates isolated database_customer_uat.sqlite with all migrations 001-011 applied.
 */

const sqlite3 = require('../backend/node_modules/sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { runMigrations } = require('../backend/migrator');

const DB_PATH = path.join(__dirname, '../backend/database_customer_uat.sqlite');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

async function setup() {
  if (fs.existsSync(DB_PATH)) {
    try { fs.unlinkSync(DB_PATH); } catch (_) {}
    try { fs.unlinkSync(DB_PATH + '-journal'); } catch (_) {}
    try { fs.unlinkSync(DB_PATH + '-wal'); } catch (_) {}
    try { fs.unlinkSync(DB_PATH + '-shm'); } catch (_) {}
    console.log('Removed old database_customer_uat.sqlite');
  }

  const db = new sqlite3.Database(DB_PATH);
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

  console.log('Running all migrations on database_customer_uat.sqlite...');
  await runMigrations(dbQuery);

  // Seed default admin and staff users
  await dbQuery.run(
    'INSERT INTO users (username, password_hash, role, permissions, fullname) VALUES (?, ?, ?, ?, ?)',
    [
      'admin',
      hashPassword('admin123'),
      'admin',
      'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation,customers',
      'ผู้ดูแลระบบหลัก'
    ]
  );

  await dbQuery.run(
    'INSERT INTO users (username, password_hash, role, permissions, fullname) VALUES (?, ?, ?, ?, ?)',
    [
      'staff',
      hashPassword('staff123'),
      'staff',
      'pos,pending,layout,history,quotations,customers',
      'พนักงานต้อนรับประจำกะ'
    ]
  );

  // Seed rooms
  await dbQuery.run(`
    INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, category, status)
    VALUES (1, 'ห้องประชุมเล็ก 101', 4, 300.0, 2000.0, 'Meeting Room', 'active')
  `);
  await dbQuery.run(`
    INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, category, status)
    VALUES (2, 'ห้องประชุมกลาง 201', 8, 500.0, 3500.0, 'Meeting Room', 'active')
  `);
  await dbQuery.run(`
    INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, category, status)
    VALUES (3, 'ห้องประชุมใหญ่ 301', 20, 900.0, 6000.0, 'Meeting Room', 'active')
  `);

  // Seed settings
  await dbQuery.run(`
    INSERT INTO settings (key, value)
    VALUES ('promotion_online_discount', '{"code":"ONLINE_5_PERCENT","discount_percent":5,"active":true}')
  `);

  console.log('Seeded database_customer_uat.sqlite successfully.');
  db.close();
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
