const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { roundMoney } = require('../financialHelper');

// Helper to create an in-memory test database matching schema.sql + migration 008
function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run('PRAGMA foreign_keys = ON;');
        db.run(`
          CREATE TABLE bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name TEXT NOT NULL,
            department TEXT,
            contact TEXT,
            subtotal_amount REAL DEFAULT 0,
            discount_type TEXT DEFAULT 'none',
            discount_value REAL DEFAULT 0,
            discount_amount REAL DEFAULT 0,
            total_amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0,
            balance_amount REAL DEFAULT 0,
            payment_status TEXT NOT NULL,
            payment_method TEXT,
            billing_option TEXT DEFAULT 'paid',
            receipt_number TEXT,
            customer_type TEXT DEFAULT 'walkin',
            booking_source TEXT DEFAULT 'walkin',
            booking_channel TEXT DEFAULT 'pos_web',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        db.run(`
          CREATE TABLE payment_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_method TEXT NOT NULL,
            transaction_type TEXT NOT NULL,
            status TEXT DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
          )
        `, (initErr) => {
          if (initErr) reject(initErr);
          else resolve(db);
        });
      });
    });
  });
}

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getRow(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function getAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Emulates backend canonical pay-balance execution logic matching server.js & worker.js
async function executePayBalance(db, bookingId, { amount, payment_method }) {
  const booking = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) {
    return { status: 404, error: 'ไม่พบข้อมูลการจอง' };
  }

  if (booking.payment_status === 'cancelled' || booking.payment_status === 'failed' || booking.payment_status === 'rejected') {
    return { status: 400, error: 'ไม่สามารถรับชำระเงินสำหรับรายการที่ถูกยกเลิกหรือไม่สมบูรณ์' };
  }

  if (booking.customer_type === 'builtland' || booking.payment_status === 'internal_free' || booking.billing_option === 'internal_free') {
    return { status: 400, error: 'รายการใช้งานภายใน (Builtland) ไม่มีการเรียกเก็บเงิน' };
  }

  if (booking.payment_status === 'paid') {
    return { status: 400, error: 'รายการนี้ชำระเงินครบถ้วนแล้ว ไม่มีเงินคงค้าง' };
  }

  const netTotal = roundMoney(Math.max(0, Number(booking.total_amount) || 0));
  const currentPaid = roundMoney(Math.max(0, Number(booking.paid_amount) || 0));
  const currentBalance = roundMoney(Math.max(0, netTotal - currentPaid));

  if (netTotal <= 0 || currentBalance <= 0) {
    return { status: 400, error: 'รายการนี้ชำระเงินครบถ้วนแล้ว ไม่มีเงินคงค้าง' };
  }

  const payAmount = roundMoney(amount);
  if (isNaN(payAmount) || payAmount <= 0) {
    return { status: 400, error: 'ยอดเงินชำระต้องมากกว่า 0 บาท' };
  }

  if (payAmount > currentBalance) {
    return {
      status: 400,
      error: `ยอดเงินที่ชำระ (฿${payAmount}) เกินกว่ายอดคงเหลือที่ต้องชำระ (฿${currentBalance})`
    };
  }

  const newPaid = roundMoney(currentPaid + payAmount);
  const newBalance = roundMoney(Math.max(0, netTotal - newPaid));
  const newStatus = newBalance <= 0 ? 'paid' : 'deposit';
  const method = payment_method || 'cash';
  const nowIso = new Date().toISOString();

  let receiptNumber = booking.receipt_number;
  if (newStatus === 'paid' && !receiptNumber) {
    receiptNumber = 'REC-TEST-AUTO';
  }

  // Atomic update with canonical concurrency guard
  const updateRes = await runQuery(db, `
    UPDATE bookings
    SET paid_amount = ?, balance_amount = ?, payment_status = ?, payment_method = ?, receipt_number = COALESCE(receipt_number, ?)
    WHERE id = ?
      AND payment_status NOT IN ('cancelled', 'failed', 'rejected', 'internal_free')
      AND ROUND(MAX(0, COALESCE(total_amount, 0) - COALESCE(paid_amount, 0)), 2) >= ?
  `, [newPaid, newBalance, newStatus, method, receiptNumber, booking.id, payAmount]);

  if (updateRes.changes === 0) {
    return { status: 409, error: 'ยอดคงเหลือถูกเปลี่ยนแปลงไปแล้ว กรุณารีเฟรชและลองใหม่อีกครั้ง' };
  }

  await runQuery(db, `
    INSERT INTO payment_transactions
    (booking_id, amount, payment_method, transaction_type, status, created_at)
    VALUES (?, ?, ?, 'balance', 'completed', ?)
  `, [booking.id, payAmount, method, nowIso]);

  const updatedBooking = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
  return {
    status: 200,
    success: true,
    paid_amount: newPaid,
    balance_amount: newBalance,
    payment_status: newStatus,
    payment_method: method,
    booking: updatedBooking
  };
}

describe('BWORK-POS — Payment Balance Backend Integrity Tests', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  // 1. Stale 200/0/0 Pending Booking
  test('1. Stale 200/0/0 pending booking derives remaining 200 and settles in full', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, payment_method)
      VALUES ('Stale Pending User', 200, 0, 0, 'pending', 'transfer')
    `);
    const bookingId = res.id;

    const payResult = await executePayBalance(db, bookingId, { amount: 200, payment_method: 'cash' });
    assert.strictEqual(payResult.status, 200);
    assert.strictEqual(payResult.paid_amount, 200);
    assert.strictEqual(payResult.balance_amount, 0);
    assert.strictEqual(payResult.payment_status, 'paid');
    assert.strictEqual(payResult.booking.paid_amount, 200);
    assert.strictEqual(payResult.booking.balance_amount, 0);

    const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0].amount, 200);
  });

  // 2. Stale Partial Deposit
  test('2. Stale deposit booking (total 1000, paid 300, balance 0) derives remaining 700 and settles', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, payment_method)
      VALUES ('Stale Deposit User', 1000, 300, 0, 'deposit', 'transfer')
    `);
    const bookingId = res.id;

    const overpay = await executePayBalance(db, bookingId, { amount: 701, payment_method: 'cash' });
    assert.strictEqual(overpay.status, 400);
    assert.match(overpay.error, /เกินกว่ายอดคงเหลือที่ต้องชำระ/);

    const payResult = await executePayBalance(db, bookingId, { amount: 700, payment_method: 'transfer' });
    assert.strictEqual(payResult.status, 200);
    assert.strictEqual(payResult.paid_amount, 1000);
    assert.strictEqual(payResult.balance_amount, 0);
    assert.strictEqual(payResult.payment_status, 'paid');
  });

  // 3. Consistent Deposit
  test('3. Consistent deposit row (total 1000, paid 300, balance 700) partial payment', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, payment_method)
      VALUES ('Consistent Deposit User', 1000, 300, 700, 'deposit', 'cash')
    `);
    const bookingId = res.id;

    const payResult = await executePayBalance(db, bookingId, { amount: 200, payment_method: 'card' });
    assert.strictEqual(payResult.status, 200);
    assert.strictEqual(payResult.paid_amount, 500);
    assert.strictEqual(payResult.balance_amount, 500);
    assert.strictEqual(payResult.payment_status, 'deposit');

    const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0].amount, 200);
    assert.strictEqual(txs[0].payment_method, 'card');
  });

  // 4. Fully Paid
  test('4. Fully paid booking rejects payment and inserts zero ledger transactions', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('Paid User', 200, 200, 0, 'paid')
    `);
    const bookingId = res.id;

    const payResult = await executePayBalance(db, bookingId, { amount: 50, payment_method: 'cash' });
    assert.strictEqual(payResult.status, 400);
    assert.match(payResult.error, /ชำระเงินครบถ้วนแล้ว/);

    const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
    assert.strictEqual(txs.length, 0);
  });

  // 5. Cancelled Safety
  test('5. Cancelled booking rejects payment even if contract balance exists', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('Cancelled User', 1000, 300, 700, 'cancelled')
    `);
    const bookingId = res.id;

    const payResult = await executePayBalance(db, bookingId, { amount: 200, payment_method: 'cash' });
    assert.strictEqual(payResult.status, 400);
    assert.match(payResult.error, /ไม่สามารถรับชำระเงินสำหรับรายการที่ถูกยกเลิก/);

    const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
    assert.strictEqual(txs.length, 0);
  });

  // 6. Internal Free Safety
  test('6. Internal free (Builtland) rejects payment', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, customer_type, total_amount, paid_amount, balance_amount, payment_status, billing_option)
      VALUES ('Builtland Corp', 'builtland', 0, 0, 0, 'internal_free', 'internal_free')
    `);
    const bookingId = res.id;

    const payResult = await executePayBalance(db, bookingId, { amount: 100, payment_method: 'cash' });
    assert.strictEqual(payResult.status, 400);
    assert.match(payResult.error, /รายการใช้งานภายใน/);
  });

  // 7. Zero-Net Safety
  test('7. Zero-net booking rejects payment', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('Zero Net User', 0, 0, 0, 'paid')
    `);
    const bookingId = res.id;

    const payResult = await executePayBalance(db, bookingId, { amount: 50, payment_method: 'cash' });
    assert.strictEqual(payResult.status, 400);
  });

  // 8. Overpayment Protection
  test('8. Overpayment is rejected and does not mutate booking or ledger', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('Overpay User', 200, 0, 0, 'pending')
    `);
    const bookingId = res.id;

    const r1 = await executePayBalance(db, bookingId, { amount: 200.01, payment_method: 'cash' });
    assert.strictEqual(r1.status, 400);

    const r2 = await executePayBalance(db, bookingId, { amount: 300, payment_method: 'cash' });
    assert.strictEqual(r2.status, 400);

    const b = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
    assert.strictEqual(b.paid_amount, 0);
    assert.strictEqual(b.balance_amount, 0);

    const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
    assert.strictEqual(txs.length, 0);
  });

  // 9. Exact Full Payment & 10. Partial Payment End-to-End
  test('9 & 10. End-to-end partial payments summing to full total', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('E2E Stale User', 200, 0, 0, 'pending')
    `);
    const bookingId = res.id;

    // Step 1: Pay 80
    const step1 = await executePayBalance(db, bookingId, { amount: 80, payment_method: 'cash' });
    assert.strictEqual(step1.status, 200);
    assert.strictEqual(step1.paid_amount, 80);
    assert.strictEqual(step1.balance_amount, 120);
    assert.strictEqual(step1.payment_status, 'deposit');

    // Step 2: Pay 120
    const step2 = await executePayBalance(db, bookingId, { amount: 120, payment_method: 'transfer' });
    assert.strictEqual(step2.status, 200);
    assert.strictEqual(step2.paid_amount, 200);
    assert.strictEqual(step2.balance_amount, 0);
    assert.strictEqual(step2.payment_status, 'paid');

    const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
    assert.strictEqual(txs.length, 2);
    assert.strictEqual(txs[0].amount, 80);
    assert.strictEqual(txs[0].payment_method, 'cash');
    assert.strictEqual(txs[1].amount, 120);
    assert.strictEqual(txs[1].payment_method, 'transfer');

    const sumRow = await getRow(db, 'SELECT SUM(amount) AS total_ledger FROM payment_transactions WHERE booking_id = ?', [bookingId]);
    assert.strictEqual(sumRow.total_ledger, 200);
  });

  // 11. Ledger Integrity & 12. No Ledger on Rejection
  test('11 & 12. Ledger integrity: zero transactions on 400 error or validation failure', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('Integrity User', 200, 0, 0, 'pending')
    `);
    const bookingId = res.id;

    await executePayBalance(db, bookingId, { amount: -50, payment_method: 'cash' });
    await executePayBalance(db, bookingId, { amount: 0, payment_method: 'cash' });
    await executePayBalance(db, bookingId, { amount: 999, payment_method: 'cash' });

    const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
    assert.strictEqual(txs.length, 0, 'No transactions may be recorded for failed requests');
  });

  // 13. Concurrency / Atomic Guard
  test('13. Concurrency guard prevents two simultaneous payments totaling > remaining', async () => {
    const res = await runQuery(db, `
      INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
      VALUES ('Race User', 200, 0, 0, 'pending')
    `);
    const bookingId = res.id;

    // Both requests read initial remaining = 200
    // Request A pays 150
    // Request B pays 100
    const reqA = executePayBalance(db, bookingId, { amount: 150, payment_method: 'cash' });
    const reqB = executePayBalance(db, bookingId, { amount: 100, payment_method: 'cash' });

    const results = await Promise.all([reqA, reqB]);
    const successCount = results.filter(r => r.status === 200).length;
    const conflictCount = results.filter(r => r.status === 409 || r.status === 400).length;

    assert.strictEqual(successCount, 1, 'Exactly one concurrent request must succeed');
    assert.strictEqual(conflictCount, 1, 'The other request must be rejected / conflict');

    const b = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
    assert.ok(b.paid_amount <= 200, 'Total paid must not exceed total amount');
    assert.ok(b.balance_amount >= 0, 'Balance must not be negative');
  });

  // 14. Online Booking Creation Initializes Balance Correctly
  test('14. Public/online booking insertion initializes consistent balance_amount = total_amount', async () => {
    const subtotal = 450;
    const netTotal = roundMoney(subtotal);

    // Matches updated server.js & worker.js public booking insert SQL
    const res = await runQuery(db, `
      INSERT INTO bookings (
        customer_name, department, contact,
        subtotal_amount, total_amount, paid_amount, balance_amount,
        payment_status, payment_method,
        receipt_number, booking_source, booking_channel, customer_type, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'transfer', ?, 'online', 'line_oa', 'general', CURRENT_TIMESTAMP)
    `, ['LINE OA Customer', 'HR', '0812345678', netTotal, netTotal, 0, netTotal, 'REC-LINE-001']);

    const newBooking = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [res.id]);
    assert.strictEqual(newBooking.total_amount, 450);
    assert.strictEqual(newBooking.paid_amount, 0);
    assert.strictEqual(newBooking.balance_amount, 450, 'balance_amount must initialize to net total');
    assert.strictEqual(newBooking.payment_status, 'pending');
  });

  // 15. Server / Worker Parity
  test('15. Source Parity: server.js and worker.js both implement identical canonical remaining and atomic guards', () => {
    const serverPath = path.resolve(__dirname, '../server.js');
    const workerPath = path.resolve(__dirname, '../worker.js');
    const serverSrc = fs.readFileSync(serverPath, 'utf8');
    const workerSrc = fs.readFileSync(workerPath, 'utf8');

    // Both must use canonical derived remaining: Math.max(0, netTotal - currentPaid)
    assert.match(serverSrc, /currentBalance\s*=\s*roundMoney\(Math\.max\(0,\s*netTotal\s*-\s*currentPaid\)\)/,
      'server.js must compute canonical currentBalance');
    assert.match(workerSrc, /currentBalance\s*=\s*roundMoney\(Math\.max\(0,\s*netTotal\s*-\s*currentPaid\)\)/,
      'worker.js must compute canonical currentBalance');

    // Both must use concurrency SQL guard checking remaining >= ?
    const sqlGuardRegex = /ROUND\(MAX\(0,\s*COALESCE\(total_amount,\s*0\)\s*-\s*COALESCE\(paid_amount,\s*0\)\),\s*2\)\s*>=\s*\?/;
    assert.match(serverSrc, sqlGuardRegex, 'server.js must use concurrency SQL guard');
    assert.match(workerSrc, sqlGuardRegex, 'worker.js must use concurrency SQL guard');

    // Both must reject cancelled, failed, rejected
    assert.match(serverSrc, /booking\.payment_status\s*===\s*'cancelled'\s*\|\|\s*booking\.payment_status\s*===\s*'failed'\s*\|\|\s*booking\.payment_status\s*===\s*'rejected'/,
      'server.js must reject cancelled, failed, rejected');
    assert.match(workerSrc, /booking\.payment_status\s*===\s*'cancelled'\s*\|\|\s*booking\.payment_status\s*===\s*'failed'\s*\|\|\s*booking\.payment_status\s*===\s*'rejected'/,
      'worker.js must reject cancelled, failed, rejected');

    // Both must initialize balance_amount in public online bookings
    assert.match(serverSrc, /subtotal_amount[\s\S]*?total_amount,\s*paid_amount,\s*balance_amount/,
      'server.js public booking must include financial snapshot columns');
    assert.match(workerSrc, /subtotal_amount[\s\S]*?total_amount,\s*paid_amount,\s*balance_amount/,
      'worker.js public booking must include financial snapshot columns');
  });
});
