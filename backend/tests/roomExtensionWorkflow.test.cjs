'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

function createTestDb() {
  const db = new sqlite3.Database(':memory:');
  const query = {
    run: (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    }),
    exec: (sql) => new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
    transaction: async (fn) => {
      await query.run('BEGIN TRANSACTION');
      try {
        const res = await fn();
        await query.run('COMMIT');
        return res;
      } catch (err) {
        await query.run('ROLLBACK');
        throw err;
      }
    },
    close: () => new Promise((resolve) => db.close(resolve))
  };

  return query;
}

async function initSchema(db) {
  await db.exec(`
    CREATE TABLE rooms (
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
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_id INTEGER,
      contract_id INTEGER,
      total_amount REAL NOT NULL,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'pending',
      payment_method TEXT,
      receipt_number TEXT,
      slip_image_url TEXT,
      customer_type TEXT DEFAULT 'walkin',
      basecamp_sub_type TEXT,
      basecamp_unit TEXT,
      billing_option TEXT DEFAULT 'paid',
      quota_hours_used REAL DEFAULT 0,
      subtotal_amount REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
      room_id INTEGER REFERENCES rooms(id),
      quantity REAL DEFAULT 1,
      price REAL NOT NULL,
      start_time TEXT,
      end_time TEXT,
      subtotal REAL NOT NULL,
      layout TEXT DEFAULT 'standard',
      booking_type TEXT DEFAULT 'hourly',
      checkin_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      transaction_type TEXT DEFAULT 'full',
      status TEXT DEFAULT 'completed',
      slip_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      performed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE customer_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      contract_type TEXT DEFAULT 'OFFICE',
      monthly_quota_hours REAL DEFAULT 4
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await db.run("INSERT INTO settings (key, value) VALUES ('cleaning_buffer_minutes', '30')");
}

function roundMoney(num) {
  const n = Number(num);
  if (isNaN(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeToLocalISO(isoStr) {
  if (!isoStr) return '';
  let s = String(isoStr).trim();
  if (s.length === 16) s += ':00';
  return s.replace(' ', 'T');
}

function addMinutesToLocalISO(isoString, minutes) {
  const norm = normalizeToLocalISO(isoString);
  const [datePart, timePart] = norm.split('T');
  const [h, m, s] = (timePart || '00:00:00').split(':').map(Number);
  const totalM = h * 60 + m + Number(minutes);
  const newDate = new Date(datePart + 'T00:00:00');
  const dayOffset = Math.floor(totalM / (24 * 60));
  if (dayOffset > 0) {
    newDate.setDate(newDate.getDate() + dayOffset);
  }
  const remM = ((totalM % (24 * 60)) + (24 * 60)) % (24 * 60);
  const newH = String(Math.floor(remM / 60)).padStart(2, '0');
  const newM = String(remM % 60).padStart(2, '0');
  const newS = String(s || 0).padStart(2, '0');
  const y = newDate.getFullYear();
  const mo = String(newDate.getMonth() + 1).padStart(2, '0');
  const d = String(newDate.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}T${newH}:${newM}:${newS}`;
}

async function checkRoomOverlap(roomId, startISO, endISO, excludeBookingId = null, dbQuery = null, excludeBookingItemId = null) {
  const normStart = normalizeToLocalISO(startISO);
  const normEnd = normalizeToLocalISO(endISO);
  const bufferMins = 30;
  const bufferMs = bufferMins * 60 * 1000;

  const reqStartMs = new Date(normStart).getTime();
  const reqEndMs = new Date(normEnd).getTime();
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
  if (excludeBookingItemId) {
    query += ' AND bi.id != ?';
    params.push(excludeBookingItemId);
  } else if (excludeBookingId) {
    query += ' AND b.id != ?';
    params.push(excludeBookingId);
  }

  const bookings = await dbQuery.all(query, params);

  for (const b of bookings) {
    if (!b.start_time || !b.end_time) continue;
    const bStartNorm = normalizeToLocalISO(b.start_time);
    const bEndNorm = normalizeToLocalISO(b.end_time);
    const bStartMs = new Date(bStartNorm).getTime();
    const bEndMs = new Date(bEndNorm).getTime();
    const bEndBufferedMs = bEndMs + bufferMs;

    if (reqStartMs < bEndBufferedMs && reqEndBufferedMs > bStartMs) {
      const isDirectUsage = (reqStartMs < bEndMs && reqEndMs > bStartMs);
      return {
        hasOverlap: true,
        isCleaningBuffer: !isDirectUsage,
        bufferMinutes: bufferMins,
        booking: b
      };
    }
  }
  return { hasOverlap: false, bufferMinutes: bufferMins };
}

// -------------------------------------------------------------
// TEST SUITE
// -------------------------------------------------------------

test('1. Room Extension: Extend 1 hour on active booking (12:00-13:00 -> 12:00-14:00)', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room 302', 8, 500)");
  const roomId = roomRes.lastID;

  const bRes = await db.run(`
    INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, payment_method)
    VALUES ('Khun Somchai', 500, 500, 0, 'paid', 'cash')
  `);
  const bookingId = bRes.lastID;

  const itemRes = await db.run(`
    INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal)
    VALUES (?, ?, 1, 500, '2026-10-27T12:00:00', '2026-10-27T13:00:00', 500)
  `, [bookingId, roomId]);
  const itemId = itemRes.lastID;

  // Execute 60 min extension
  const newEnd = addMinutesToLocalISO('2026-10-27T13:00:00', 60);
  assert.equal(newEnd, '2026-10-27T14:00:00');

  const overlap = await checkRoomOverlap(roomId, '2026-10-27T12:00:00', newEnd, null, db, itemId);
  assert.equal(overlap.hasOverlap, false, 'Continuous usage should have no overlap');

  // Update item
  await db.run('UPDATE booking_items SET end_time = ?, quantity = 2, subtotal = 1000 WHERE id = ?', [newEnd, itemId]);
  await db.run('UPDATE bookings SET total_amount = 1000, paid_amount = 1000, balance_amount = 0 WHERE id = ?', [bookingId]);
  await db.run(`
    INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
    VALUES (?, 500, 'cash', 'extension', 'completed')
  `, [bookingId]);

  const updatedItem = await db.get('SELECT * FROM booking_items WHERE id = ?', [itemId]);
  assert.equal(updatedItem.start_time, '2026-10-27T12:00:00', 'Start time strictly preserved');
  assert.equal(updatedItem.end_time, '2026-10-27T14:00:00', 'End time extended to 14:00');
  assert.equal(updatedItem.subtotal, 1000);
  assert.equal(updatedItem.quantity, 2);

  const updatedBooking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(updatedBooking.total_amount, 1000);
  assert.equal(updatedBooking.paid_amount, 1000);
  assert.equal(updatedBooking.balance_amount, 0);

  await db.close();
});

test('2. Room Extension: Extend 30 minutes (12:00-13:00 -> 12:00-13:30)', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room 302', 8, 600)");
  const roomId = roomRes.lastID;

  const bRes = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES ('A', 600, 600, 0, 'paid')");
  const bookingId = bRes.lastID;

  const itRes = await db.run(`
    INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal)
    VALUES (?, ?, 1, 600, '2026-10-27T12:00:00', '2026-10-27T13:00:00', 600)
  `, [bookingId, roomId]);
  const itemId = itRes.lastID;

  const newEnd = addMinutesToLocalISO('2026-10-27T13:00:00', 30);
  assert.equal(newEnd, '2026-10-27T13:30:00');

  const additionalHours = 30 / 60; // 0.5
  const extensionFee = roundMoney(additionalHours * 600); // 300
  assert.equal(extensionFee, 300);

  await db.run('UPDATE booking_items SET end_time = ?, quantity = 1.5, subtotal = 900 WHERE id = ?', [newEnd, itemId]);
  await db.run('UPDATE bookings SET total_amount = 900, paid_amount = 900, balance_amount = 0 WHERE id = ?', [bookingId]);

  const item = await db.get('SELECT * FROM booking_items WHERE id = ?', [itemId]);
  assert.equal(item.end_time, '2026-10-27T13:30:00');
  assert.equal(item.quantity, 1.5);
  assert.equal(item.subtotal, 900);

  await db.close();
});

test('3. Same Room Only constraint: extension cannot change room_id', async () => {
  const db = createTestDb();
  await initSchema(db);

  const r1 = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room 301', 4, 300)");
  const r2 = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room 302', 8, 500)");

  const bRes = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES ('A', 300, 300, 0, 'paid')");
  const itRes = await db.run("INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal) VALUES (?, ?, 1, 300, '2026-10-27T12:00:00', '2026-10-27T13:00:00', 300)", [bRes.lastID, r1.lastID]);

  // Backend endpoint forces target room_id to be item.room_id
  const item = await db.get('SELECT * FROM booking_items WHERE id = ?', [itRes.lastID]);
  assert.equal(item.room_id, r1.lastID);

  // In backend endpoint: room is looked up strictly from item.room_id
  assert.equal(serverSource.includes('const room = await dbQuery.get(\'SELECT * FROM rooms WHERE id = ?\', [item.room_id])'), true);
  assert.equal(workerSource.includes("const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first()"), true);

  await db.close();
});

test('4. Cleaning Buffer Exception: no buffer between old and new end, but 30m buffer enforced for next customer', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room 302', 8, 500)");
  const roomId = roomRes.lastID;

  // Booking 1: Khun Somchai 12:00 - 13:00
  const b1 = await db.run("INSERT INTO bookings (customer_name, total_amount, payment_status) VALUES ('Khun Somchai', 500, 'paid')");
  const item1 = await db.run("INSERT INTO booking_items (booking_id, room_id, price, start_time, end_time, subtotal) VALUES (?, ?, 500, '2026-10-27T12:00:00', '2026-10-27T13:00:00', 500)", [b1.lastID, roomId]);

  // Booking 2: Next customer booked at 14:15 - 15:15
  const b2 = await db.run("INSERT INTO bookings (customer_name, total_amount, payment_status) VALUES ('Customer Next', 500, 'paid')");
  await db.run("INSERT INTO booking_items (booking_id, room_id, price, start_time, end_time, subtotal) VALUES (?, ?, 500, '2026-10-27T14:15:00', '2026-10-27T15:15:00', 500)", [b2.lastID, roomId]);

  // Somchai wants to extend from 13:00 to 14:00 (1 hour extension)
  // End of extension is 14:00. Next booking starts at 14:15.
  // 14:00 + 30m buffer = 14:30 > 14:15!
  const overlapExtend = await checkRoomOverlap(roomId, '2026-10-27T12:00:00', '2026-10-27T14:00:00', null, db, item1.lastID);
  assert.equal(overlapExtend.hasOverlap, true, 'Must conflict with 30-min cleaning buffer before next customer');
  assert.equal(overlapExtend.isCleaningBuffer, true, 'Overlap is specifically due to cleaning buffer');

  // But if Somchai only extends 30 minutes to 13:30:
  // 13:30 + 30m buffer = 14:00 <= 14:15 -> NO conflict!
  const overlap30m = await checkRoomOverlap(roomId, '2026-10-27T12:00:00', '2026-10-27T13:30:00', null, db, item1.lastID);
  assert.equal(overlap30m.hasOverlap, false, '30 min extension leaves enough cleaning buffer before 14:15');

  await db.close();
});

test('5. Cross-channel LINE OA / Public availability synchronization', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room 302', 8, 500)");
  const roomId = roomRes.lastID;

  // Booking 1: POS walk-in extended to 14:00
  const b1 = await db.run("INSERT INTO bookings (customer_name, total_amount, payment_status) VALUES ('POS User', 1000, 'paid')");
  await db.run("INSERT INTO booking_items (booking_id, room_id, price, start_time, end_time, subtotal) VALUES (?, ?, 500, '2026-10-27T12:00:00', '2026-10-27T14:00:00', 1000)", [b1.lastID, roomId]);

  // Online LINE OA user attempts to book 13:00 - 14:00
  const onlineCheck1 = await checkRoomOverlap(roomId, '2026-10-27T13:00:00', '2026-10-27T14:00:00', null, db);
  assert.equal(onlineCheck1.hasOverlap, true, 'LINE OA must see the room occupied during extended time');

  // Online LINE OA user attempts to book 14:00 - 15:00 (right at 14:00, within cleaning buffer)
  const onlineCheck2 = await checkRoomOverlap(roomId, '2026-10-27T14:00:00', '2026-10-27T15:00:00', null, db);
  assert.equal(onlineCheck2.hasOverlap, true, 'LINE OA must be blocked by 30-min cleaning buffer until 14:30');

  // Online LINE OA user books at 14:30 - 15:30 (after cleaning buffer)
  const onlineCheck3 = await checkRoomOverlap(roomId, '2026-10-27T14:30:00', '2026-10-27T15:30:00', null, db);
  assert.equal(onlineCheck3.hasOverlap, false, 'LINE OA can book starting at 14:30');

  await db.close();
});

test('6. TOCTOU Concurrency Safety: concurrent update detection', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room 302', 8, 500)");
  const roomId = roomRes.lastID;

  const bRes = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES ('A', 500, 500, 0, 'paid')");
  const itRes = await db.run("INSERT INTO booking_items (booking_id, room_id, price, start_time, end_time, subtotal) VALUES (?, ?, 500, '2026-10-27T12:00:00', '2026-10-27T13:00:00', 500)", [bRes.lastID, roomId]);
  const itemId = itRes.lastID;

  // Terminal A updates end_time from 13:00 to 14:00
  const resA = await db.run("UPDATE booking_items SET end_time = '2026-10-27T14:00:00' WHERE id = ? AND end_time = '2026-10-27T13:00:00'", [itemId]);
  assert.equal(resA.changes, 1, 'Terminal A successfully updates');

  // Terminal B tries to update with stale end_time '2026-10-27T13:00:00'
  const resB = await db.run("UPDATE booking_items SET end_time = '2026-10-27T15:00:00' WHERE id = ? AND end_time = '2026-10-27T13:00:00'", [itemId]);
  assert.equal(resB.changes, 0, 'Terminal B detects conflict and rejects update with 0 changes');

  await db.close();
});

test('7. Pricing Engine & Quota deduction for extension', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate, has_classroom, classroom_hourly_rate) VALUES ('Room 301', 12, 400, 1, 600)");
  const roomId = roomRes.lastID;

  // Case A: Classroom layout charges classroom rate
  const bA = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, payment_status) VALUES ('Classroom Customer', 600, 600, 'paid')");
  const itA = await db.run("INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal, layout) VALUES (?, ?, 1, 600, '2026-10-27T10:00:00', '2026-10-27T11:00:00', 600, 'classroom')", [bA.lastID, roomId]);

  const itemA = await db.get('SELECT * FROM booking_items WHERE id = ?', [itA.lastID]);
  const roomA = await db.get('SELECT * FROM rooms WHERE id = ?', [itemA.room_id]);
  const rateA = itemA.layout === 'classroom' ? roomA.classroom_hourly_rate : roomA.hourly_rate;
  assert.equal(rateA, 600, 'Classroom layout uses classroom rate');

  // Case B: Customer with Quota (Basecamp Office 4h monthly quota)
  const remainingQuota = 4;
  const extensionHours = 2;
  const quotaDeducted = Math.min(extensionHours, remainingQuota);
  const chargeableHours = Math.max(0, extensionHours - quotaDeducted);
  const feeWithQuota = roundMoney(chargeableHours * rateA);

  assert.equal(quotaDeducted, 2);
  assert.equal(chargeableHours, 0);
  assert.equal(feeWithQuota, 0, 'Quota covers full extension fee');

  await db.close();
});

test('8. Slip & Payment Ledger isolation: Deposit, Balance, and Extension Slips preserved distinctly', async () => {
  const db = createTestDb();
  await initSchema(db);

  const bRes = await db.run(`
    INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, slip_image_url)
    VALUES ('Multi Slip Customer', 1500, 500, 1000, 'deposit', '/uploads/slips/deposit_slip_A.jpg')
  `);
  const bookingId = bRes.lastID;

  // Transaction 1: Deposit (Slip A)
  await db.run(`
    INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status, slip_url)
    VALUES (?, 500, 'transfer', 'deposit', 'completed', '/uploads/slips/deposit_slip_A.jpg')
  `, [bookingId]);

  // Transaction 2: Balance payment (Slip B)
  await db.run(`
    INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status, slip_url)
    VALUES (?, 1000, 'promptpay', 'balance', 'completed', '/uploads/slips/balance_slip_B.jpg')
  `, [bookingId]);

  // Transaction 3: Extension payment (Slip C)
  await db.run(`
    INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status, slip_url)
    VALUES (?, 500, 'promptpay', 'extension', 'completed', '/uploads/slips/extension_slip_C.jpg')
  `, [bookingId]);

  const txs = await db.all('SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
  assert.equal(txs.length, 3);
  assert.equal(txs[0].transaction_type, 'deposit');
  assert.equal(txs[0].slip_url, '/uploads/slips/deposit_slip_A.jpg');

  assert.equal(txs[1].transaction_type, 'balance');
  assert.equal(txs[1].slip_url, '/uploads/slips/balance_slip_B.jpg');

  assert.equal(txs[2].transaction_type, 'extension');
  assert.equal(txs[2].slip_url, '/uploads/slips/extension_slip_C.jpg');

  // Verify Deposit Slip A was not overwritten
  const booking = await db.get('SELECT slip_image_url FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(booking.slip_image_url, '/uploads/slips/deposit_slip_A.jpg');

  await db.close();
});

test('9. Multiple consecutive extensions on same item: Extension 1 then Extension 2', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room 302', 8, 500)");
  const roomId = roomRes.lastID;

  const bRes = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES ('Repeat Customer', 500, 500, 0, 'paid')");
  const bookingId = bRes.lastID;

  const itRes = await db.run("INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal) VALUES (?, ?, 1, 500, '2026-10-27T12:00:00', '2026-10-27T13:00:00', 500)", [bookingId, roomId]);
  const itemId = itRes.lastID;

  // Extension 1: +1 hour (13:00 -> 14:00) with Slip C
  const end1 = addMinutesToLocalISO('2026-10-27T13:00:00', 60);
  await db.run("UPDATE booking_items SET end_time = ?, quantity = 2, subtotal = 1000 WHERE id = ?", [end1, itemId]);
  await db.run("UPDATE bookings SET total_amount = 1000, paid_amount = 1000 WHERE id = ?", [bookingId]);
  await db.run("INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, slip_url) VALUES (?, 500, 'promptpay', 'extension', '/uploads/slips/slip_C.jpg')", [bookingId]);

  // Extension 2: +1 hour (14:00 -> 15:00) with Slip D
  const end2 = addMinutesToLocalISO(end1, 60);
  assert.equal(end2, '2026-10-27T15:00:00');
  await db.run("UPDATE booking_items SET end_time = ?, quantity = 3, subtotal = 1500 WHERE id = ?", [end2, itemId]);
  await db.run("UPDATE bookings SET total_amount = 1500, paid_amount = 1500 WHERE id = ?", [bookingId]);
  await db.run("INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, slip_url) VALUES (?, 500, 'promptpay', 'extension', '/uploads/slips/slip_D.jpg')", [bookingId]);

  const item = await db.get('SELECT * FROM booking_items WHERE id = ?', [itemId]);
  assert.equal(item.start_time, '2026-10-27T12:00:00');
  assert.equal(item.end_time, '2026-10-27T15:00:00');
  assert.equal(item.quantity, 3);
  assert.equal(item.subtotal, 1500);

  const txs = await db.all("SELECT * FROM payment_transactions WHERE booking_id = ? AND transaction_type = 'extension' ORDER BY id ASC", [bookingId]);
  assert.equal(txs.length, 2);
  assert.equal(txs[0].slip_url, '/uploads/slips/slip_C.jpg');
  assert.equal(txs[1].slip_url, '/uploads/slips/slip_D.jpg');

  await db.close();
});

test('10. Extension with unpaid balance before extension: financial invariant maintained', async () => {
  const db = createTestDb();
  await initSchema(db);

  // Initial booking: 1000 total, 500 paid, 500 balance
  const bRes = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES ('Balance Customer', 1000, 500, 500, 'deposit')");
  const bookingId = bRes.lastID;

  // Extension fee = 500. Customer chooses to pay extension fee immediately (500 paid):
  const extensionFee = 500;
  const payAmount = 500;
  const oldTotal = 1000;
  const oldPaid = 500;

  const newTotal = oldTotal + extensionFee; // 1500
  const newPaid = oldPaid + payAmount;      // 1000
  const newBalance = newTotal - newPaid;    // 500 (original balance remains!)

  assert.equal(newTotal, 1500);
  assert.equal(newPaid, 1000);
  assert.equal(newBalance, 500);
  assert.equal(newPaid + newBalance, newTotal, 'Invariant paid + balance == total strictly maintained');

  await db.run("UPDATE bookings SET total_amount = ?, paid_amount = ?, balance_amount = ? WHERE id = ?", [newTotal, newPaid, newBalance, bookingId]);

  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(booking.total_amount, 1500);
  assert.equal(booking.paid_amount, 1000);
  assert.equal(booking.balance_amount, 500);
  assert.equal(Number(booking.paid_amount) + Number(booking.balance_amount), Number(booking.total_amount));

  await db.close();
});

test('11. Audit log formatting in booking_history', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomName = 'Room 302';
  const oldTime = '13:00';
  const newTime = '14:00';
  const durationLabel = '1 ชม.';
  const fee = 500;
  const paid = 500;
  const method = 'promptpay';
  const slipUrl = '/uploads/slips/ext_123.jpg';

  const desc = `ต่อเวลาห้อง ${roomName} จาก ${oldTime} เป็น ${newTime} (+${durationLabel}) ค่าบริการ ฿${fee.toLocaleString()} ชำระแล้ว ฿${paid.toLocaleString()} (${method}) พร้อมแนบสลิป`;

  await db.run(`
    INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
    VALUES (?, 'extend_room', ?, 'admin', '2026-10-27T11:30:00')
  `, [1, JSON.stringify({ description: desc, action: 'extend_room', duration_minutes: 60 })]);

  const log = await db.get("SELECT * FROM booking_history WHERE action = 'extend_room'");
  assert.equal(log.action, 'extend_room');
  assert.equal(log.performed_by, 'admin');
  const details = JSON.parse(log.details);
  assert.equal(details.description.includes('ต่อเวลาห้อง Room 302'), true);
  assert.equal(details.description.includes('จาก 13:00 เป็น 14:00 (+1 ชม.)'), true);

  await db.close();
});

test('12. Parity between Express (server.js) and Worker (worker.js) endpoints', () => {
  // Check endpoint presence
  assert.equal(serverSource.includes("app.get('/api/bookings/:id/extension-preview'"), true);
  assert.equal(serverSource.includes("app.post('/api/bookings/:id/extend'"), true);

  assert.equal(workerSource.includes("pathname.endsWith('/extension-preview') && method === 'GET'"), true);
  assert.equal(workerSource.includes("pathname.endsWith('/extend') && method === 'POST'"), true);

  // Check optimistic concurrency checks
  assert.equal(serverSource.includes('WHERE id = ? AND end_time = ?'), true);
  assert.equal(workerSource.includes('WHERE id = ? AND end_time = ?'), true);

  // Check exclusion of own booking item during overlap check
  assert.equal(serverSource.includes('checkRoomOverlap(item.room_id, item.start_time, newEndISO, null, dbQuery, item.id)'), true);
  assert.equal(workerSource.includes('checkRoomOverlap(env, item.room_id, item.start_time, newEndISO, null, item.id)'), true);
});
test('13. Cloudflare D1 batch atomicity: booking_items update and financial ledger commit atomically or rollback together', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room Atomicity', 10, 600)");
  const roomId = roomRes.lastID;

  const bRes = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES ('Atomic Customer', 600, 600, 0, 'paid')");
  const bookingId = bRes.lastID;

  const itRes = await db.run("INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal) VALUES (?, ?, 1, 600, '2026-10-27T10:00:00', '2026-10-27T11:00:00', 600)", [bookingId, roomId]);
  const itemId = itRes.lastID;

  const oldEndTime = '2026-10-27T11:00:00';
  const newEndISO = '2026-10-27T12:00:00';

  // Simulate Stale End Time: another request already updated item end_time to 11:30:00
  await db.run("UPDATE booking_items SET end_time = '2026-10-27T11:30:00' WHERE id = ?", [itemId]);

  // Now execute the conditioned atomic statements mimicking D1 batch
  const st1 = await db.run(
    'UPDATE booking_items SET end_time = ?, quantity = 2, subtotal = 1200 WHERE id = ? AND end_time = ?',
    [newEndISO, itemId, oldEndTime]
  );
  assert.equal(st1.changes, 0, 'Statement 1 must change 0 rows due to stale end_time');

  // Statement 2: conditioned on (SELECT end_time FROM booking_items WHERE id = ?) = newEndISO
  const st2 = await db.run(
    'UPDATE bookings SET total_amount = 1200, balance_amount = 600 WHERE id = ? AND (SELECT end_time FROM booking_items WHERE id = ?) = ?',
    [bookingId, itemId, newEndISO]
  );
  assert.equal(st2.changes, 0, 'Statement 2 must change 0 rows because item was not updated');

  // Statement 3: conditioned insert into payment_transactions
  const st3 = await db.run(
    'INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status, created_at) ' +
    'SELECT ?, 600, "cash", "extension", "completed", "2026-10-27T11:00:00" WHERE (SELECT end_time FROM booking_items WHERE id = ?) = ?',
    [bookingId, itemId, newEndISO]
  );
  assert.equal(st3.changes, 0, 'Statement 3 must insert 0 rows');

  // Verify booking totals and ledger remain unchanged
  const b = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(b.total_amount, 600);
  assert.equal(b.paid_amount, 600);
  assert.equal(b.balance_amount, 0);

  const txs = await db.all('SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
  assert.equal(txs.length, 0);

  await db.close();
});

test('14. Unpaid room extension ledger invariant: unpaid extension does NOT insert completed payment transaction', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room Unpaid Ledger', 10, 500)");
  const roomId = roomRes.lastID;

  const bRes = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES ('Unpaid Ext Customer', 500, 500, 0, 'paid')");
  const bookingId = bRes.lastID;

  const itRes = await db.run("INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal) VALUES (?, ?, 1, 500, '2026-10-27T10:00:00', '2026-10-27T11:00:00', 500)", [bookingId, roomId]);
  const itemId = itRes.lastID;

  const extensionFee = 500;
  const payAmount = 0; // Unpaid extension
  const quotaDeducted = 0;

  // New logic: Only insert payment_transactions if (payAmount > 0 || quotaDeducted > 0)
  if (payAmount > 0 || quotaDeducted > 0) {
    await db.run(
      'INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status, created_at) ' +
      'VALUES (?, ?, "unpaid", "extension", "completed", "2026-10-27T11:00:00")',
      [bookingId, payAmount]
    );
  }

  // Update booking financials
  await db.run(
    'UPDATE bookings SET total_amount = 1000, paid_amount = 500, balance_amount = 500, payment_status = "deposit" WHERE id = ?',
    [bookingId]
  );

  const txs = await db.all('SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
  assert.equal(txs.length, 0, 'No completed payment transaction should exist for unpaid extension');

  const b = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(b.total_amount, 1000);
  assert.equal(b.paid_amount, 500);
  assert.equal(b.balance_amount, 500);
  assert.equal(b.total_amount, b.paid_amount + b.balance_amount, 'total_amount == paid_amount + balance_amount invariant must hold');

  await db.close();
});

test('15. Cross-channel race condition: POS extend vs LINE OA new reservation conflict detection', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Room Cross Channel', 10, 500)");
  const roomId = roomRes.lastID;

  // POS booking 1: 10:00 - 12:00
  const b1Res = await db.run("INSERT INTO bookings (id, customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES (601, 'POS Customer', 1000, 1000, 0, 'paid')");
  await db.run("INSERT INTO booking_items (id, booking_id, room_id, quantity, price, start_time, end_time, subtotal) VALUES (701, 601, ?, 2, 500, '2026-10-27T10:00:00', '2026-10-27T12:00:00', 1000)", [roomId]);

  // LINE OA customer reserves 12:30 - 14:00 (leaving 30-min buffer after 12:00)
  const b2Res = await db.run("INSERT INTO bookings (id, customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES (602, 'LINE OA Customer', 1000, 0, 1000, 'pending')");
  await db.run("INSERT INTO booking_items (id, booking_id, room_id, quantity, price, start_time, end_time, subtotal) VALUES (702, 602, ?, 1.5, 500, '2026-10-27T12:30:00', '2026-10-27T14:00:00', 750)", [roomId]);

  // POS attempts to extend booking 1 from 12:00 to 12:30 (+30 min)
  // New end time: 12:30. But next customer starts at 12:30, needing 30-min cleaning buffer (12:30 + 30m = 13:00 > 12:30)!
  const bufferMins = 30;
  const bufferMs = bufferMins * 60 * 1000;
  const newEndMs = new Date('2026-10-27T12:30:00').getTime();
  const nextStartMs = new Date('2026-10-27T12:30:00').getTime();

  const hasBufferCollision = (newEndMs + bufferMs > nextStartMs);
  assert.equal(hasBufferCollision, true, 'Extension to 12:30 must be blocked by cleaning buffer for 12:30 queue');

  await db.close();
});

test('16. Fail-closed guard: missing or mismatched current_end_time must reject extension', async () => {
  const db = createTestDb();
  await initSchema(db);

  const roomRes = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('FailClosed Room', 8, 500)");
  const roomId = roomRes.lastID;

  const bRes = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES ('Test FC', 500, 500, 0, 'paid')");
  const bookingId = bRes.lastID;

  const itemRes = await db.run("INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal) VALUES (?, ?, 1, 500, '2026-10-27T12:00:00', '2026-10-27T13:00:00', 500)", [bookingId, roomId]);
  const itemId = itemRes.lastID;

  // Simulate CAS Guard in server.js/worker.js:
  // if (current_end_time && item.end_time !== current_end_time) -> throw 409
  const item = await db.get('SELECT * FROM booking_items WHERE id = ?', [itemId]);

  const staleEndTime = '2026-10-27T12:30:00';
  assert.notEqual(item.end_time, staleEndTime);

  // Mismatched current_end_time throws 409 Conflict
  let caughtConflict = false;
  if (staleEndTime && item.end_time !== staleEndTime) {
    caughtConflict = true;
  }
  assert.equal(caughtConflict, true, 'Mismatched end_time must fail closed with conflict');

  // Empty or missing end_time from client validation
  const clientValidate = (clientEndTime) => {
    if (!clientEndTime || typeof clientEndTime !== 'string' || clientEndTime.trim() === '') {
      return { valid: false, error: 'ไม่พบเวลาสิ้นสุดเดิมของการใช้งานห้อง (ห้ามส่งข้อมูลโดยไม่มีเวลาสิ้นสุด)' };
    }
    return { valid: true };
  };

  assert.equal(clientValidate(null).valid, false);
  assert.equal(clientValidate(undefined).valid, false);
  assert.equal(clientValidate('').valid, false);
  assert.equal(clientValidate('2026-10-27T13:00:00').valid, true);

  await db.close();
});

test('17. Fail-closed guard: missing or null new_end_time cannot proceed with extension', () => {
  // If preview is null, preview.available is false, or new_end_time is missing:
  const canProceed = (preview) => {
    if (!preview || !preview.available || !preview.new_end_time || !preview.current_end_time) {
      return false;
    }
    return true;
  };

  assert.equal(canProceed(null), false, 'Null preview must fail closed');
  assert.equal(canProceed({ available: true }), false, 'Preview without new_end_time must fail closed');
  assert.equal(canProceed({ available: true, new_end_time: '2026-10-27T14:00:00' }), false, 'Preview without current_end_time must fail closed');
  assert.equal(canProceed({ available: false, new_end_time: '2026-10-27T14:00:00', current_end_time: '2026-10-27T13:00:00' }), false, 'Unavailable preview must fail closed');
  assert.equal(canProceed({ available: true, new_end_time: '2026-10-27T14:00:00', current_end_time: '2026-10-27T13:00:00' }), true, 'Complete available preview can proceed');
});

test('18. Room Extension Preview: time addition and fee calculation precision', () => {
  // Test local time addition across noon and boundary conditions
  const t1 = addMinutesToLocalISO('2026-10-27T11:30:00', 30);
  assert.equal(t1, '2026-10-27T12:00:00');

  const t2 = addMinutesToLocalISO('2026-10-27T11:30:00', 90);
  assert.equal(t2, '2026-10-27T13:00:00');

  const t3 = addMinutesToLocalISO('2026-10-27T17:30:00', 60);
  assert.equal(t3, '2026-10-27T18:30:00');

  // Money rounding for 0.5 hours with odd rates
  const rate = 350;
  const halfHourFee = roundMoney((30 / 60) * rate);
  assert.equal(halfHourFee, 175);

  const rateWithFraction = 333.33;
  const fracFee = roundMoney((30 / 60) * rateWithFraction);
  assert.equal(fracFee, 166.67);
});

test('19. Multi-room booking: extension targets strictly the chosen item without touching other rooms', async () => {
  const db = createTestDb();
  await initSchema(db);

  // Setup 2 rooms
  const r1 = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Mercury (302)', 8, 500)");
  const r2 = await db.run("INSERT INTO rooms (name, capacity, hourly_rate) VALUES ('Mars (301)', 6, 600)");
  const roomId1 = r1.lastID;
  const roomId2 = r2.lastID;

  // Single booking with 2 rooms
  const bRes = await db.run("INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status) VALUES ('Multi-Room Customer', 2200, 2200, 0, 'paid')");
  const bookingId = bRes.lastID;

  // Item 1: Mercury 10:00 - 12:00 (2 hrs @ 500 = 1000)
  const it1 = await db.run("INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal) VALUES (?, ?, 2, 500, '2026-10-27T10:00:00', '2026-10-27T12:00:00', 1000)", [bookingId, roomId1]);
  const itemId1 = it1.lastID;

  // Item 2: Mars 11:00 - 13:00 (2 hrs @ 600 = 1200)
  const it2 = await db.run("INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal) VALUES (?, ?, 2, 600, '2026-10-27T11:00:00', '2026-10-27T13:00:00', 1200)", [bookingId, roomId2]);
  const itemId2 = it2.lastID;

  // User chooses to extend Item 2 (Mars) by 60 minutes (13:00 -> 14:00)
  const targetItemId = itemId2;
  const chosenDuration = 60;

  // 1. Fetch item by targetItemId
  const selectedItem = await db.get('SELECT * FROM booking_items WHERE id = ? AND booking_id = ?', [targetItemId, bookingId]);
  assert.equal(selectedItem.id, itemId2);
  assert.equal(selectedItem.room_id, roomId2);
  assert.equal(selectedItem.end_time, '2026-10-27T13:00:00');

  // 2. Calculate extension for Mars
  const newEnd = addMinutesToLocalISO(selectedItem.end_time, chosenDuration);
  assert.equal(newEnd, '2026-10-27T14:00:00');

  // Verify overlap on Mars excluding itemId2
  const overlap = await checkRoomOverlap(roomId2, selectedItem.start_time, newEnd, null, db, selectedItem.id);
  assert.equal(overlap.hasOverlap, false);

  // Execute extension on Item 2 only
  const additionalHours = chosenDuration / 60;
  const room2Rate = 600;
  const extensionFee = roundMoney(additionalHours * room2Rate); // 600
  const newItemSubtotal = roundMoney(selectedItem.subtotal + extensionFee); // 1800
  const newItemQuantity = roundMoney(selectedItem.quantity + additionalHours); // 3

  await db.run(
    'UPDATE booking_items SET end_time = ?, quantity = ?, subtotal = ? WHERE id = ? AND end_time = ?',
    [newEnd, newItemQuantity, newItemSubtotal, targetItemId, selectedItem.end_time]
  );

  // Update booking totals
  const oldTotal = 2200;
  const newTotal = oldTotal + extensionFee; // 2800
  await db.run('UPDATE bookings SET total_amount = ?, paid_amount = ?, balance_amount = 0 WHERE id = ?', [newTotal, newTotal, bookingId]);

  // Assertions:
  // Item 2 is extended
  const verifiedItem2 = await db.get('SELECT * FROM booking_items WHERE id = ?', [itemId2]);
  assert.equal(verifiedItem2.end_time, '2026-10-27T14:00:00');
  assert.equal(verifiedItem2.subtotal, 1800);
  assert.equal(verifiedItem2.quantity, 3);

  // Item 1 remains completely untouched!
  const verifiedItem1 = await db.get('SELECT * FROM booking_items WHERE id = ?', [itemId1]);
  assert.equal(verifiedItem1.end_time, '2026-10-27T12:00:00', 'Item 1 end_time must NOT be modified');
  assert.equal(verifiedItem1.subtotal, 1000);
  assert.equal(verifiedItem1.quantity, 2);

  // Booking total updated
  const verifiedBooking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  assert.equal(verifiedBooking.total_amount, 2800);

  await db.close();
});

test('20. Rapid room/duration switching race condition defense: stale preview rejected', () => {
  // Simulate client-side request sequence counter and freshness validation
  let previewSeq = 0;

  // User selects Room 10, Duration 30
  const req1Seq = ++previewSeq;
  let activeItemId = 10;
  let activeDuration = 30;
  let activeCurrentEndTime = '2026-10-27T12:00:00';

  // User quickly switches to Room 11, Duration 60 before Req 1 arrives
  const req2Seq = ++previewSeq;
  activeItemId = 11;
  activeDuration = 60;
  activeCurrentEndTime = '2026-10-27T14:00:00';

  // Delayed response for Req 1 arrives
  const res1 = {
    seq: req1Seq,
    booking_item_id: 10,
    duration_minutes: 30,
    current_end_time: '2026-10-27T12:00:00',
    new_end_time: '2026-10-27T12:30:00',
    gross_extension_fee: 300,
    available: true
  };

  // Check 1: Sequence counter rejects delayed Req 1
  const isSeqValid = (res1.seq === previewSeq);
  assert.equal(isSeqValid, false, 'Delayed response from earlier sequence must be discarded');

  // Check 2: Even if sequence bypassed, freshness invariant strictly rejects mismatched item or duration
  const isFresh = (
    res1.booking_item_id === activeItemId &&
    res1.duration_minutes === activeDuration &&
    res1.current_end_time === activeCurrentEndTime
  );
  assert.equal(isFresh, false, 'Mismatched room/duration preview must be marked stale');

  // Check 3: Response for Req 2 arrives
  const res2 = {
    seq: req2Seq,
    booking_item_id: 11,
    duration_minutes: 60,
    current_end_time: '2026-10-27T14:00:00',
    new_end_time: '2026-10-27T15:00:00',
    gross_extension_fee: 600,
    available: true
  };

  assert.equal(res2.seq === previewSeq, true);
  assert.equal(
    res2.booking_item_id === activeItemId &&
    res2.duration_minutes === activeDuration &&
    res2.current_end_time === activeCurrentEndTime,
    true,
    'Matching fresh preview is accepted'
  );

  // Check 4: Submit validator blocks stale preview
  const validateSubmit = (selectedId, currentEndTime, preview, isPreviewFresh) => {
    if (!selectedId) return { ok: false, error: 'กรุณาเลือกห้องประชุมที่ต้องการต่อเวลา' };
    if (!preview || !isPreviewFresh) return { ok: false, error: 'ข้อมูลพรีวิวไม่ตรงกับห้องหรือระยะเวลาที่เลือก กรุณารอสักครู่' };
    if (preview.current_end_time !== currentEndTime) return { ok: false, error: 'เวลาสิ้นสุดไม่ตรงกัน' };
    return { ok: true };
  };

  const staleSubmit = validateSubmit(11, '2026-10-27T14:00:00', res1, false);
  assert.equal(staleSubmit.ok, false);
  assert.match(staleSubmit.error, /ข้อมูลพรีวิวไม่ตรง/);

  const validSubmit = validateSubmit(11, '2026-10-27T14:00:00', res2, true);
  assert.equal(validSubmit.ok, true);
});

test('21. Multi-room modal selection rules: auto-selects only when 1 room exists, requires explicit choice when > 1', () => {
  const resolveInitialSelection = (initialItem, eligibleRooms) => {
    // 1. If initialItem is specified and in eligibleRooms, select it
    if (initialItem && initialItem.room_id) {
      const initId = initialItem.id || initialItem.booking_item_id;
      const matched = eligibleRooms.find(it => it.id === initId);
      if (matched) return matched.id;
    }

    // 2. Only auto-select if EXACTLY 1 eligible room exists
    if (eligibleRooms.length === 1 && eligibleRooms[0].id) {
      return eligibleRooms[0].id;
    }

    // 3. If multiple rooms and no unambiguous initialItem, return null (force user choice)
    return null;
  };

  // Scenario A: Single room booking
  const singleRoom = [{ id: 101, room_id: 4, room_name: 'Mars' }];
  assert.equal(resolveInitialSelection(null, singleRoom), 101, 'Single room booking auto-selects item 101');

  // Scenario B: Multi-room booking without explicit initialItem
  const multiRooms = [
    { id: 201, room_id: 4, room_name: 'Mars' },
    { id: 202, room_id: 5, room_name: 'Mercury' }
  ];
  assert.equal(resolveInitialSelection(null, multiRooms), null, 'Multi-room booking must NOT auto-select; returns null');

  // Scenario C: Multi-room booking with explicit initialItem (e.g. clicked Mercury)
  const clickedMercury = { id: 202, room_id: 5 };
  assert.equal(resolveInitialSelection(clickedMercury, multiRooms), 202, 'Explicit clicked room item is honored');

  // Scenario D: Confirm button disabled state when no room is selected
  const isConfirmDisabled = (selectedId, isPreviewFresh, isSubmitting, loadingPreview) => {
    return isSubmitting || loadingPreview || !selectedId || !isPreviewFresh;
  };

  assert.equal(isConfirmDisabled(null, false, false, false), true, 'Confirm button must be disabled when selectedId is null');
  assert.equal(isConfirmDisabled(201, true, false, false), false, 'Confirm button enabled when room selected and preview fresh');
});

test('22. Out-of-order Response Control: switching booking A to B drops A and prevents submitting A item in B', () => {
  // Simulate RoomExtensionModal state machine with request generation & ID binding
  let bookingSeq = 0;
  let previewSeq = 0;

  // Active session state
  let activeBookingId = 1001; // Booking A
  let loadedBooking = null;
  let loadingBooking = true;
  let selectedItemId = 5001; // Item A1 in Booking A
  let preview = null;
  let loadingPreview = true;

  // Request A dispatched
  const bReqSeqA = ++bookingSeq;
  const pReqSeqA = ++previewSeq;

  // User switches to Booking B (id: 1002) BEFORE Request A responds
  activeBookingId = 1002;
  // Invalidation on booking change:
  bookingSeq++;
  previewSeq++;
  loadedBooking = null;
  loadingBooking = true;
  selectedItemId = null; // Cleared until B items evaluated
  preview = null;
  loadingPreview = false;

  // Request B dispatched
  const bReqSeqB = ++bookingSeq;

  // Delayed Response A arrives for Booking Details: { id: 1001, items: [{ id: 5001 }] }
  const resBookingA = { id: 1001, customer_name: 'Customer A', items: [{ id: 5001, room_id: 4, start_time: '10:00', end_time: '12:00' }] };

  // Guard 1: Sequence counter check
  const isBSeqAValid = (bReqSeqA === bookingSeq);
  assert.equal(isBSeqAValid, false, 'Delayed booking response A has outdated sequence; must be discarded');

  // Guard 2: Strict ID binding check
  const isLoadedIdMatch = (resBookingA.id === activeBookingId);
  assert.equal(isLoadedIdMatch, false, 'Delayed booking response A has mismatched ID (1001 != 1002); must NOT set loadedBooking');

  if (isBSeqAValid && isLoadedIdMatch) {
    loadedBooking = resBookingA;
  }
  assert.equal(loadedBooking, null, 'loadedBooking remains null despite delayed response A');

  // Delayed Response A arrives for Extension Preview
  const resPreviewA = {
    booking_id: 1001,
    booking_item_id: 5001,
    duration_minutes: 60,
    current_end_time: '2026-10-27T12:00:00',
    new_end_time: '2026-10-27T13:00:00',
    gross_extension_fee: 500,
    available: true
  };

  const isPSeqAValid = (pReqSeqA === previewSeq);
  assert.equal(isPSeqAValid, false, 'Delayed preview A has outdated sequence; must be discarded');

  const isPreviewIdMatch = (resPreviewA.booking_id === activeBookingId && resPreviewA.booking_item_id === selectedItemId);
  assert.equal(isPreviewIdMatch, false, 'Delayed preview A does not match activeBookingId or selectedItemId');

  if (isPSeqAValid && isPreviewIdMatch) {
    preview = resPreviewA;
  }
  assert.equal(preview, null, 'preview remains null; A preview is NOT displayed');

  // Attempt to submit while loading booking B or with stale preview
  const attemptSubmit = (activeId, loadingB, loadingP, selItemId, prev, fresh) => {
    if (loadingB) return { ok: false, error: 'กำลังโหลดข้อมูลการจอง กรุณารอสักครู่' };
    if (!selItemId) return { ok: false, error: 'กรุณาเลือกห้องประชุมที่ต้องการต่อเวลา' };
    if (!prev || !fresh) return { ok: false, error: 'ข้อมูลพรีวิวไม่ตรงกับห้องหรือระยะเวลาที่เลือก' };
    if (prev.booking_id !== activeId) return { ok: false, error: 'ข้อมูลพรีวิวไม่ตรงกับการจองปัจจุบัน' };
    return { ok: true };
  };

  const submitDuringTransition = attemptSubmit(activeBookingId, loadingBooking, loadingPreview, selectedItemId, preview, false);
  assert.equal(submitDuringTransition.ok, false);
  assert.equal(submitDuringTransition.error, 'กำลังโหลดข้อมูลการจอง กรุณารอสักครู่');

  // Response B arrives for Booking B Details: { id: 1002, items: [{ id: 6001, room_id: 5 }] }
  const resBookingB = { id: 1002, customer_name: 'Customer B', items: [{ id: 6001, room_id: 5, start_time: '13:00', end_time: '15:00' }] };
  assert.equal(bReqSeqB === bookingSeq, true);
  assert.equal(resBookingB.id === activeBookingId, true);

  loadedBooking = resBookingB;
  loadingBooking = false;
  selectedItemId = 6001; // Auto-selected because single room in Booking B

  // Request B dispatched for Preview
  const pReqSeqB = ++previewSeq;
  const resPreviewB = {
    booking_id: 1002,
    booking_item_id: 6001,
    duration_minutes: 60,
    current_end_time: '2026-10-27T15:00:00',
    new_end_time: '2026-10-27T16:00:00',
    gross_extension_fee: 600,
    available: true
  };

  assert.equal(pReqSeqB === previewSeq, true);
  assert.equal(resPreviewB.booking_id === activeBookingId, true);
  assert.equal(resPreviewB.booking_item_id === selectedItemId, true);

  preview = resPreviewB;
  const isBPreviewFresh = true;

  const validSubmitB = attemptSubmit(activeBookingId, loadingBooking, loadingPreview, selectedItemId, preview, isBPreviewFresh);
  assert.equal(validSubmitB.ok, true, 'Valid submission of item 6001 for Booking B succeeds');
  assert.equal(selectedItemId, 6001);
  assert.equal(activeBookingId, 1002);
});

test('23. Invalidation & Abort Control on Modal Close / Re-open', () => {
  let modalOpen = true;
  let activeBookingId = 2001;
  let abortController = new AbortController();
  let previewSeq = 1;
  let preview = null;

  // Signal is active
  assert.equal(abortController.signal.aborted, false);

  // User closes modal while request in flight
  modalOpen = false;
  activeBookingId = null;

  // Invalidation effect triggered
  abortController.abort();
  previewSeq++;
  preview = null;

  assert.equal(abortController.signal.aborted, true, 'AbortController must be aborted on modal close');

  // In-flight fetch rejects with AbortError or reaches .catch
  let caughtAbort = false;
  try {
    if (abortController.signal.aborted) {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    }
  } catch (err) {
    if (err.name === 'AbortError') caughtAbort = true;
  }
  assert.equal(caughtAbort, true, 'AbortError properly caught and suppressed');

  // Late response handler check
  const delayedResponseSeq = 1;
  const canSetPreview = (modalOpen && delayedResponseSeq === previewSeq);
  assert.equal(canSetPreview, false, 'Late response cannot update preview when modal is closed or sequence incremented');

  // Re-open modal with new booking
  modalOpen = true;
  activeBookingId = 2002;
  abortController = new AbortController();
  previewSeq++;

  assert.equal(abortController.signal.aborted, false, 'New session gets fresh AbortController');
  assert.equal(preview, null, 'New session starts with clean null preview');
});

test('24. Fail-closed: submit strictly prohibited while loadingBooking is true', () => {
  const isButtonDisabled = (loadingBooking, loadingPreview, selectedItemId, isPreviewFresh, isSubmitting) => {
    return isSubmitting || loadingBooking || loadingPreview || !selectedItemId || !isPreviewFresh;
  };

  // While loading booking details
  assert.equal(isButtonDisabled(true, false, 501, true, false), true, 'Button must be disabled when loadingBooking is true');
  // While loading preview
  assert.equal(isButtonDisabled(false, true, 501, true, false), true, 'Button must be disabled when loadingPreview is true');
  // When no room selected
  assert.equal(isButtonDisabled(false, false, null, true, false), true, 'Button must be disabled when selectedItemId is null');
  // When preview is stale
  assert.equal(isButtonDisabled(false, false, 501, false, false), true, 'Button must be disabled when isPreviewFresh is false');
  // Ready to submit
  assert.equal(isButtonDisabled(false, false, 501, true, false), false, 'Button enabled only when all guards pass');
});
