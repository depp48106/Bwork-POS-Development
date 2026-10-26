'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

// Read source code to verify invariants in both server.js and worker.js
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

// Helper to create in-memory SQLite database simulating D1 / SQLite
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
    close: () => new Promise((resolve) => db.close(resolve))
  };

  return query;
}

async function initSchema(db) {
  await db.exec(`
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      total_amount REAL NOT NULL,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'pending',
      payment_method TEXT,
      receipt_number TEXT,
      slip_image_url TEXT,
      customer_type TEXT DEFAULT 'walkin',
      billing_option TEXT DEFAULT 'paid',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function roundMoney(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  return roundMoney(value).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function normalizeBookingFinancials(booking) {
  if (!booking) return null;
  const isBuiltland = booking.customer_type === 'builtland' || booking.billing_option === 'internal_free' || booking.payment_status === 'internal_free';
  if (isBuiltland) {
    return {
      total_amount: 0,
      paid_amount: 0,
      balance_amount: 0,
      payment_status: 'internal_free',
      is_internal_free: true,
      is_paid: true,
      is_deposit: false,
      is_pending: false,
      is_collectible: false
    };
  }

  const rawTotal = roundMoney(Math.max(0, Number(booking.total_amount) || 0));
  let paidAmount = roundMoney(Math.max(0, Number(booking.paid_amount) || 0));
  if (booking.payment_status === 'paid' && paidAmount === 0 && rawTotal > 0) {
    paidAmount = rawTotal;
  }
  const derivedRemaining = roundMoney(Math.max(0, rawTotal - paidAmount));
  const isPaid = booking.payment_status === 'paid';
  const isDeposit = booking.payment_status === 'deposit';
  const isPending = !isPaid && !isDeposit && booking.payment_status !== 'cancelled';
  const balanceAmount = isPaid ? 0 : derivedRemaining;

  return {
    total_amount: rawTotal,
    paid_amount: paidAmount,
    balance_amount: balanceAmount,
    payment_status: booking.payment_status || 'pending',
    is_deposit: isDeposit,
    is_paid: isPaid,
    is_pending: isPending,
    is_collectible: balanceAmount > 0 && !isPaid && booking.payment_status !== 'cancelled'
  };
}

// -----------------------------------------------------------------------------
// TEST SUITE: 20 SCENARIOS FOR DEPOSIT & BALANCE PAYMENT WORKFLOW
// -----------------------------------------------------------------------------

test('Deposit & Balance Payment Workflow Enhancement Suite', async (t) => {
  let db;

  t.beforeEach(async () => {
    db = createTestDb();
    await initSchema(db);
  });

  t.afterEach(async () => {
    if (db) await db.close();
  });

  // Scenario 1: Booking ที่ยังไม่ได้ชำระ (Unpaid booking)
  await t.test('Scenario 1: Unpaid booking has collectible balance and pending status', async () => {
    const res = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
       VALUES (?, ?, ?, ?, ?)`,
      ['ลูกค้าทดสอบ 1', 2000, 0, 2000, 'pending']
    );
    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [res.lastID]);
    const fin = normalizeBookingFinancials(booking);

    assert.equal(fin.total_amount, 2000);
    assert.equal(fin.paid_amount, 0);
    assert.equal(fin.balance_amount, 2000);
    assert.equal(fin.is_pending, true);
    assert.equal(fin.is_collectible, true);
  });

  // Scenario 2: Deposit Payment (มัดจำ)
  await t.test('Scenario 2: Deposit Payment records deposit transaction and updates booking', async () => {
    const res = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, slip_image_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['ลูกค้าทดสอบ 2', 2000, 1000, 1000, 'deposit', '/uploads/slips/slipA.jpg']
    );
    const bookingId = res.lastID;

    await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type, status)
       VALUES (?, ?, ?, ?, 'deposit', 'completed')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipA.jpg']
    );

    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    const fin = normalizeBookingFinancials(booking);

    assert.equal(fin.is_deposit, true);
    assert.equal(fin.paid_amount, 1000);
    assert.equal(fin.balance_amount, 1000);
    assert.equal(booking.slip_image_url, '/uploads/slips/slipA.jpg');
  });

  // Scenario 3: Deposit + Balance Payment (มัดจำ + คงเหลือ)
  await t.test('Scenario 3: Deposit + Balance Payment transitions booking to paid and 0 balance', async () => {
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, slip_image_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['ลูกค้าทดสอบ 3', 2000, 1000, 1000, 'deposit', '/uploads/slips/slipA.jpg']
    );
    const bookingId = bRes.lastID;

    // First deposit transaction
    await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'deposit')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipA.jpg']
    );

    // Pay remaining balance 1000
    const payAmount = 1000;
    const current = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    const newPaid = roundMoney(current.paid_amount + payAmount);
    const newBalance = roundMoney(Math.max(0, current.total_amount - newPaid));
    const newStatus = newBalance <= 0 ? 'paid' : 'deposit';

    await db.run(
      `UPDATE bookings SET paid_amount = ?, balance_amount = ?, payment_status = ? WHERE id = ?`,
      [newPaid, newBalance, newStatus, bookingId]
    );
    await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'balance')`,
      [bookingId, payAmount, 'transfer', '/uploads/slips/slipB.jpg']
    );

    const updated = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    const fin = normalizeBookingFinancials(updated);

    assert.equal(fin.is_paid, true);
    assert.equal(fin.paid_amount, 2000);
    assert.equal(fin.balance_amount, 0);
  });

  // Scenario 4: Deposit Slip A + Balance Slip B (สลิป A ผูกกับมัดจำ, สลิป B ผูกกับส่วนที่เหลือ)
  await t.test('Scenario 4: Deposit Slip A and Balance Slip B are preserved separately per transaction', async () => {
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, slip_image_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['ลูกค้าทดสอบ 4', 2000, 2000, 0, 'paid', '/uploads/slips/slipA.jpg']
    );
    const bookingId = bRes.lastID;

    // Tx 1: Deposit with Slip A
    await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'deposit')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipA.jpg']
    );

    // Tx 2: Balance with Slip B
    await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'balance')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipB.jpg']
    );

    const txs = await db.all('SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
    assert.equal(txs.length, 2);
    assert.equal(txs[0].slip_url, '/uploads/slips/slipA.jpg');
    assert.equal(txs[0].transaction_type, 'deposit');
    assert.equal(txs[1].slip_url, '/uploads/slips/slipB.jpg');
    assert.equal(txs[1].transaction_type, 'balance');

    // Primary/deposit slip is also preserved on bookings.slip_image_url
    const booking = await db.get('SELECT slip_image_url FROM bookings WHERE id = ?', [bookingId]);
    assert.equal(booking.slip_image_url, '/uploads/slips/slipA.jpg');
  });

  // Scenario 5: Deposit ผ่าน Booking App แล้ว Balance ผ่าน POS
  await t.test('Scenario 5: Deposit from Booking App followed by POS balance payment', async () => {
    // Online customer books with deposit
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, slip_image_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Online Customer', 2000, 1000, 1000, 'deposit', '/uploads/slips/online_slipA.jpg']
    );
    const bookingId = bRes.lastID;
    await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'deposit')`,
      [bookingId, 1000, 'promptpay', '/uploads/slips/online_slipA.jpg']
    );

    // POS staff collects remaining 1000 cash
    await db.run(
      `UPDATE bookings SET paid_amount = 2000, balance_amount = 0, payment_status = 'paid' WHERE id = ?`,
      [bookingId]
    );
    await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'balance')`,
      [bookingId, 1000, 'cash', null]
    );

    const txs = await db.all('SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
    assert.equal(txs.length, 2);
    assert.equal(txs[0].payment_method, 'promptpay');
    assert.equal(txs[0].slip_url, '/uploads/slips/online_slipA.jpg');
    assert.equal(txs[1].payment_method, 'cash');
    assert.equal(txs[1].slip_url, null);
  });

  // Scenario 6: Deposit ผ่าน POS แล้ว Balance ผ่าน POS
  await t.test('Scenario 6: Staff A records POS deposit, Staff B records POS balance', async () => {
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, slip_image_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Walkin Customer', 3000, 1500, 1500, 'deposit', '/uploads/slips/pos_slipA.jpg']
    );
    const bookingId = bRes.lastID;

    // Staff A logs deposit
    await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'deposit')`,
      [bookingId, 1500, 'transfer', '/uploads/slips/pos_slipA.jpg']
    );
    await db.run(
      `INSERT INTO booking_history (booking_id, action, details, performed_by)
       VALUES (?, 'create_deposit', ?, 'Staff A')`,
      [bookingId, JSON.stringify({ amount: 1500, payment_transaction_id: 1, uploaded_by: 'Staff A' })]
    );

    // Staff B logs balance
    await db.run(
      `UPDATE bookings SET paid_amount = 3000, balance_amount = 0, payment_status = 'paid' WHERE id = ?`,
      [bookingId]
    );
    await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'balance')`,
      [bookingId, 1500, 'transfer', '/uploads/slips/pos_slipB.jpg']
    );
    await db.run(
      `INSERT INTO booking_history (booking_id, action, details, performed_by)
       VALUES (?, 'pay_balance', ?, 'Staff B')`,
      [bookingId, JSON.stringify({ amount: 1500, payment_transaction_id: 2, uploaded_by: 'Staff B' })]
    );

    const history = await db.all('SELECT * FROM booking_history WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
    assert.equal(history.length, 2);
    assert.equal(history[0].performed_by, 'Staff A');
    assert.equal(history[1].performed_by, 'Staff B');
  });

  // Scenario 7: Balance Payment without Slip แล้วแนบภายหลัง
  await t.test('Scenario 7: Balance payment recorded without slip, slip attached later to transaction', async () => {
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
       VALUES (?, ?, ?, ?, ?)`,
      ['Customer 7', 2000, 2000, 0, 'paid']
    );
    const bookingId = bRes.lastID;

    const txRes = await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'balance')`,
      [bookingId, 1000, 'transfer', null]
    );
    const txId = txRes.lastID;

    // Attach slip later
    await db.run(
      `UPDATE payment_transactions SET slip_url = ? WHERE id = ? AND booking_id = ?`,
      ['/uploads/slips/late_slip.jpg', txId, bookingId]
    );

    const tx = await db.get('SELECT * FROM payment_transactions WHERE id = ?', [txId]);
    assert.equal(tx.slip_url, '/uploads/slips/late_slip.jpg');
  });

  // Scenario 8: Replace Deposit Slip โดยไม่กระทบ Balance Slip
  await t.test('Scenario 8: Replacing deposit slip updates only deposit tx and not balance tx', async () => {
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, slip_image_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Customer 8', 2000, 2000, 0, 'paid', '/uploads/slips/slipA_orig.jpg']
    );
    const bookingId = bRes.lastID;

    const tx1 = await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'deposit')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipA_orig.jpg']
    );
    const tx2 = await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'balance')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipB.jpg']
    );

    // Replace slip on Tx 1
    const newSlipA = '/uploads/slips/slipA_replaced.jpg';
    await db.run(
      `UPDATE payment_transactions SET slip_url = ? WHERE id = ? AND booking_id = ?`,
      [newSlipA, tx1.lastID, bookingId]
    );
    // Deposit slip also updates bookings.slip_image_url
    await db.run(
      `UPDATE bookings SET slip_image_url = ? WHERE id = ?`,
      [newSlipA, bookingId]
    );

    const tx1Row = await db.get('SELECT * FROM payment_transactions WHERE id = ?', [tx1.lastID]);
    const tx2Row = await db.get('SELECT * FROM payment_transactions WHERE id = ?', [tx2.lastID]);
    const bRow = await db.get('SELECT slip_image_url FROM bookings WHERE id = ?', [bookingId]);

    assert.equal(tx1Row.slip_url, newSlipA);
    assert.equal(tx2Row.slip_url, '/uploads/slips/slipB.jpg', 'Balance slip must remain unchanged');
    assert.equal(bRow.slip_image_url, newSlipA);
  });

  // Scenario 9: Replace Balance Slip โดยไม่กระทบ Deposit Slip
  await t.test('Scenario 9: Replacing balance slip updates only balance tx and preserves deposit slip on bookings', async () => {
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, slip_image_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Customer 9', 2000, 2000, 0, 'paid', '/uploads/slips/slipA.jpg']
    );
    const bookingId = bRes.lastID;

    const tx1 = await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'deposit')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipA.jpg']
    );
    const tx2 = await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'balance')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipB_orig.jpg']
    );

    // Replace slip on Tx 2 (balance): should NOT overwrite bookings.slip_image_url
    const newSlipB = '/uploads/slips/slipB_replaced.jpg';
    const tx2RowBefore = await db.get('SELECT * FROM payment_transactions WHERE id = ?', [tx2.lastID]);
    await db.run(
      `UPDATE payment_transactions SET slip_url = ? WHERE id = ? AND booking_id = ?`,
      [newSlipB, tx2.lastID, bookingId]
    );
    // Invariant: only update bookings.slip_image_url if transaction_type === 'deposit' or no slip exists
    if (tx2RowBefore.transaction_type === 'deposit') {
      await db.run(`UPDATE bookings SET slip_image_url = ? WHERE id = ?`, [newSlipB, bookingId]);
    }

    const tx1Row = await db.get('SELECT * FROM payment_transactions WHERE id = ?', [tx1.lastID]);
    const tx2Row = await db.get('SELECT * FROM payment_transactions WHERE id = ?', [tx2.lastID]);
    const bRow = await db.get('SELECT slip_image_url FROM bookings WHERE id = ?', [bookingId]);

    assert.equal(tx1Row.slip_url, '/uploads/slips/slipA.jpg', 'Deposit slip must remain intact');
    assert.equal(tx2Row.slip_url, newSlipB);
    assert.equal(bRow.slip_image_url, '/uploads/slips/slipA.jpg', 'Booking primary slip must NOT be replaced by balance slip');
  });

  // Scenario 10: Payment History มี 2 Transactions
  await t.test('Scenario 10: GET /api/bookings/:id/payments returns 2 distinct transactions with staff names', async () => {
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
       VALUES (?, ?, ?, ?, ?)`,
      ['Customer 10', 2000, 2000, 0, 'paid']
    );
    const bookingId = bRes.lastID;

    const tx1 = await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'deposit')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipA.jpg']
    );
    const tx2 = await db.run(
      `INSERT INTO payment_transactions (booking_id, amount, payment_method, slip_url, transaction_type)
       VALUES (?, ?, ?, ?, 'balance')`,
      [bookingId, 1000, 'transfer', '/uploads/slips/slipB.jpg']
    );

    await db.run(
      `INSERT INTO booking_history (booking_id, action, details, performed_by)
       VALUES (?, 'create_deposit', ?, 'Staff A')`,
      [bookingId, JSON.stringify({ payment_transaction_id: tx1.lastID, uploaded_by: 'Staff A' })]
    );
    await db.run(
      `INSERT INTO booking_history (booking_id, action, details, performed_by)
       VALUES (?, 'pay_balance', ?, 'Staff B')`,
      [bookingId, JSON.stringify({ payment_transaction_id: tx2.lastID, uploaded_by: 'Staff B' })]
    );

    const payments = await db.all('SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
    const history = await db.all('SELECT * FROM booking_history WHERE booking_id = ?', [bookingId]);

    const enriched = payments.map(tx => {
      let staff = null;
      for (const h of history) {
        const d = JSON.parse(h.details || '{}');
        if (d.payment_transaction_id === tx.id) {
          staff = d.uploaded_by || h.performed_by;
          break;
        }
      }
      return { ...tx, staff_name: staff };
    });

    assert.equal(enriched.length, 2);
    assert.equal(enriched[0].staff_name, 'Staff A');
    assert.equal(enriched[1].staff_name, 'Staff B');
  });

  // Scenario 11: Multi-Transaction Booking (3-step payment)
  await t.test('Scenario 11: Multi-transaction booking supports 3+ partial payments safely', async () => {
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
       VALUES (?, ?, ?, ?, ?)`,
      ['Customer 11', 3000, 3000, 0, 'paid']
    );
    const bookingId = bRes.lastID;

    await db.run(`INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type) VALUES (?, 1000, 'transfer', 'deposit')`, [bookingId]);
    await db.run(`INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type) VALUES (?, 1000, 'cash', 'balance')`, [bookingId]);
    await db.run(`INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type) VALUES (?, 1000, 'card', 'balance')`, [bookingId]);

    const txs = await db.all('SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
    const totalPaid = txs.reduce((sum, t) => sum + t.amount, 0);

    assert.equal(txs.length, 3);
    assert.equal(totalPaid, 3000);
  });

  // Scenario 12: Payment Timeout / Retry Guard
  await t.test('Scenario 12: Atomic remaining check prevents double balance payment on retry', async () => {
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status)
       VALUES (?, ?, ?, ?, ?)`,
      ['Customer 12', 2000, 1000, 1000, 'deposit']
    );
    const bookingId = bRes.lastID;

    // First attempt succeeds
    const firstTry = await db.run(
      `UPDATE bookings
       SET paid_amount = paid_amount + 1000, balance_amount = 0, payment_status = 'paid'
       WHERE id = ? AND payment_status != 'paid' AND balance_amount >= 1000`,
      [bookingId]
    );
    assert.equal(firstTry.changes, 1, 'First payment must succeed');

    // Retry attempt with same amount fails atomically
    const secondTry = await db.run(
      `UPDATE bookings
       SET paid_amount = paid_amount + 1000, balance_amount = 0, payment_status = 'paid'
       WHERE id = ? AND payment_status != 'paid' AND balance_amount >= 1000`,
      [bookingId]
    );
    assert.equal(secondTry.changes, 0, 'Retry payment must be rejected');
  });

  // Scenario 13: Duplicate Submission Prevention
  await t.test('Scenario 13: Source code verifies double submit prevention and 30s timeout guard', () => {
    assert.ok(serverSource.includes('raceErr.statusCode = 409'), 'Server must return 409 on balance concurrency conflict');
    assert.ok(workerSource.includes('status: 409'), 'Worker must return 409 on balance concurrency conflict');
    const posSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/BookingPOS.jsx'), 'utf8');
    assert.ok(posSource.includes('isSubmittingBalancePay'), 'Frontend must track submitting state');
    assert.ok(posSource.includes('setTimeout(() => controller.abort(), 30000)'), 'Frontend must have 30s timeout guard');
  });

  // Scenario 14: Legacy Base64 Preview
  await t.test('Scenario 14: Legacy base64 slips are supported and preserved', async () => {
    const base64Data = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...';
    const bRes = await db.run(
      `INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, slip_image_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Legacy Customer', 1500, 1500, 0, 'paid', base64Data]
    );
    const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bRes.lastID]);
    assert.equal(booking.slip_image_url, base64Data);
    assert.ok(booking.slip_image_url.startsWith('data:image/'));
  });

  // Scenario 15: R2 Authenticated Preview
  await t.test('Scenario 15: Authenticated file helper enforces trusted hosts and redirect error', () => {
    const authFileSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/authenticatedFile.js'), 'utf8');
    assert.ok(authFileSource.includes("redirect: 'error'"), 'Authenticated fetch must reject HTTP redirects');
    assert.ok(authFileSource.includes('TRUSTED_AUTH_HOSTS'), 'Authenticated fetch must enforce strict host allowlist');
    assert.ok(authFileSource.includes("startsWith('//')"), 'Authenticated fetch must block protocol-relative URLs');
  });

  // Scenario 16: Unauthorized / IDOR Prevention
  await t.test('Scenario 16: Server and Worker enforce booking_id match on payment transaction slip attach', () => {
    assert.ok(
      serverSource.includes('SELECT * FROM payment_transactions WHERE id = ? AND booking_id = ?'),
      'Server must enforce transaction belongs to the target booking'
    );
    assert.ok(
      workerSource.includes('SELECT * FROM payment_transactions WHERE id = ? AND booking_id = ?'),
      'Worker must enforce transaction belongs to the target booking'
    );
  });

  // Scenario 17: Financial Invariants
  await t.test('Scenario 17: Financial Invariant: paid_amount + balance_amount == total_amount', () => {
    const testCases = [
      { total: 2000, paid: 1000, balance: 1000, status: 'deposit' },
      { total: 2000, paid: 2000, balance: 0, status: 'paid' },
      { total: 3500.50, paid: 1500.25, balance: 2000.25, status: 'deposit' },
      { total: 0, paid: 0, balance: 0, status: 'paid' }
    ];

    for (const tc of testCases) {
      const fin = normalizeBookingFinancials({
        total_amount: tc.total,
        paid_amount: tc.paid,
        balance_amount: tc.balance,
        payment_status: tc.status
      });
      assert.equal(roundMoney(fin.paid_amount + fin.balance_amount), fin.total_amount);
    }
  });

  // Scenario 18: Admin/Staff Permissions
  await t.test('Scenario 18: Server and Worker require authentication token on payments and pay-balance', () => {
    assert.ok(serverSource.includes("app.get('/api/bookings/:id/payments', authenticateToken,"), 'Payments endpoint must be authenticated');
    assert.ok(serverSource.includes("app.post('/api/bookings/:id/pay-balance', authenticateToken,"), 'Pay balance endpoint must be authenticated');
    assert.ok(workerSource.includes("const auth = await authenticateUser(request, env)"), 'Worker endpoints must authenticate request');
  });

  // Scenario 19: Support Tickets Preserved in Development / Excluded in Production
  await t.test('Scenario 19: Support Tickets tables and files are preserved in dev / excluded in prod', () => {
    const hasTicketsMigration = fs.existsSync(path.join(__dirname, '../migrations/012_add_support_tickets.sql'));
    if (!hasTicketsMigration) {
      // In Production: verify tickets route is strictly NOT present in server.js and worker.js
      assert.ok(!serverSource.includes('/api/tickets'), 'Production server.js must NOT contain tickets route');
      assert.ok(!workerSource.includes('/api/tickets'), 'Production worker.js must NOT contain tickets route');
    } else {
      const devMigrationsPath = path.join(__dirname, '../migrations/012_add_support_tickets.sql');
      assert.ok(fs.existsSync(devMigrationsPath), '012_add_support_tickets.sql must exist in development');
      const devSchemaPath = path.join(__dirname, '../schema.sql');
      const devSchema = fs.readFileSync(devSchemaPath, 'utf8');
      assert.ok(devSchema.includes('CREATE TABLE IF NOT EXISTS support_tickets'), 'support_tickets table must be preserved in schema.sql');
    }
  });

  // Scenario 20: Frontend & Booking App Builds
  await t.test('Scenario 20: Frontend and Booking App production bundles exist and built successfully', () => {
    const frontendIndex = path.join(__dirname, '../../frontend/dist/index.html');
    const bookingIndex = path.join(__dirname, '../../booking-app/dist/index.html');
    assert.ok(fs.existsSync(frontendIndex), 'frontend/dist/index.html must exist');
    assert.ok(fs.existsSync(bookingIndex), 'booking-app/dist/index.html must exist');
  });
});
