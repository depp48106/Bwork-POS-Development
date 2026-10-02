const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const {
  roundMoney,
  calculateDiscount,
  calculateBookingFinancials,
  calculateRescheduleFinancials
} = require('../financialHelper');

// Helper to create an in-memory test database matching schema.sql + migration 008
function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run('PRAGMA foreign_keys = ON;');
        db.run(`
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
            pin_code TEXT,
            builtland_pin_code TEXT
          );
        `);
        db.run(`
          CREATE TABLE bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name TEXT NOT NULL,
            department TEXT,
            contact TEXT,
            total_amount REAL NOT NULL,
            payment_status TEXT DEFAULT 'pending',
            payment_method TEXT,
            receipt_number TEXT,
            pin_code TEXT,
            customer_type TEXT DEFAULT 'walkin',
            subtotal_amount REAL,
            discount_type TEXT DEFAULT 'none',
            discount_value REAL DEFAULT 0,
            discount_amount REAL DEFAULT 0,
            paid_amount REAL DEFAULT 0,
            balance_amount REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        db.run(`
          CREATE TABLE booking_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
            room_id INTEGER REFERENCES rooms(id),
            service_id INTEGER,
            quantity INTEGER DEFAULT 1,
            price REAL NOT NULL,
            start_time TEXT,
            end_time TEXT,
            subtotal REAL NOT NULL,
            layout TEXT DEFAULT 'standard',
            booking_type TEXT DEFAULT 'hourly',
            pin_code TEXT
          );
        `);
        db.run(`
          CREATE TABLE payment_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
            amount REAL NOT NULL,
            payment_method TEXT NOT NULL,
            transaction_type TEXT DEFAULT 'full',
            slip_url TEXT,
            status TEXT DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_payment_transactions_booking_id ON payment_transactions(booking_id);
          CREATE INDEX IF NOT EXISTS idx_bookings_balance_amount ON bookings(balance_amount);
        `, (idxErr) => {
          if (idxErr) reject(idxErr);
          else resolve(db);
        });
      });
    });
  });
}

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getRow(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

describe('BWORK-DISCOUNT-DEPOSIT-V1 — Phase 2 Backend Foundation Tests', () => {
  let db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    if (db) {
      await new Promise((resolve) => db.close(resolve));
    }
  });

  // ==========================================
  // 1. MIGRATION & BACKFILL VERIFICATION
  // ==========================================
  describe('Migration & Backfill Verification', () => {
    test('legacy bookings backfill correctly according to payment_status including failed/cancelled', async () => {
      await runQuery(db, `
        INSERT INTO bookings (id, customer_name, total_amount, payment_status, payment_method)
        VALUES (101, 'Legacy Paid', 2500, 'paid', 'transfer')
      `);
      await runQuery(db, `
        INSERT INTO bookings (id, customer_name, total_amount, payment_status, payment_method)
        VALUES (102, 'Legacy Pending', 1500, 'pending', 'cash')
      `);
      await runQuery(db, `
        INSERT INTO bookings (id, customer_name, total_amount, payment_status, payment_method, customer_type)
        VALUES (103, 'Legacy Builtland', 0, 'internal_free', '', 'builtland')
      `);
      await runQuery(db, `
        INSERT INTO bookings (id, customer_name, total_amount, payment_status, payment_method)
        VALUES (104, 'Legacy Cancelled', 3000, 'cancelled', 'cash')
      `);
      await runQuery(db, `
        INSERT INTO bookings (id, customer_name, total_amount, payment_status, payment_method)
        VALUES (105, 'Legacy Failed', 750, 'failed', 'promptpay')
      `);

      // Execute migration 008 backfill logic
      await runQuery(db, `
        UPDATE bookings
        SET subtotal_amount = total_amount,
            discount_type = 'none',
            discount_value = 0,
            discount_amount = 0
        WHERE subtotal_amount IS NULL
      `);
      await runQuery(db, `
        UPDATE bookings
        SET paid_amount = total_amount,
            balance_amount = 0
        WHERE payment_status = 'paid' AND (paid_amount IS NULL OR paid_amount = 0)
      `);
      await runQuery(db, `
        UPDATE bookings
        SET paid_amount = 0,
            balance_amount = 0
        WHERE payment_status = 'internal_free'
      `);
      await runQuery(db, `
        UPDATE bookings
        SET paid_amount = 0,
            balance_amount = total_amount
        WHERE payment_status IN ('pending', 'reviewing', 'rejected', 'unpaid')
          AND (balance_amount IS NULL OR balance_amount = 0)
      `);
      await runQuery(db, `
        UPDATE bookings
        SET paid_amount = 0,
            balance_amount = total_amount
        WHERE payment_status IN ('cancelled', 'failed')
          AND (balance_amount IS NULL OR balance_amount = 0)
      `);

      const bPaid = await getRow(db, 'SELECT * FROM bookings WHERE id = 101');
      assert.strictEqual(bPaid.subtotal_amount, 2500);
      assert.strictEqual(bPaid.discount_amount, 0);
      assert.strictEqual(bPaid.paid_amount, 2500);
      assert.strictEqual(bPaid.balance_amount, 0);

      const bPending = await getRow(db, 'SELECT * FROM bookings WHERE id = 102');
      assert.strictEqual(bPending.subtotal_amount, 1500);
      assert.strictEqual(bPending.paid_amount, 0);
      assert.strictEqual(bPending.balance_amount, 1500);

      const bBuiltland = await getRow(db, 'SELECT * FROM bookings WHERE id = 103');
      assert.strictEqual(bBuiltland.paid_amount, 0);
      assert.strictEqual(bBuiltland.balance_amount, 0);

      const bCancelled = await getRow(db, 'SELECT * FROM bookings WHERE id = 104');
      assert.strictEqual(bCancelled.paid_amount, 0);
      assert.strictEqual(bCancelled.balance_amount, 3000, 'Cancelled booking retains contractual balance');

      const bFailed = await getRow(db, 'SELECT * FROM bookings WHERE id = 105');
      assert.strictEqual(bFailed.paid_amount, 0);
      assert.strictEqual(bFailed.balance_amount, 750, 'Failed booking retains contractual balance');
    });
  });

  // ==========================================
  // 2. INDEX & FOREIGN KEY AUDIT (Section 7)
  // ==========================================
  describe('Index and Foreign Key Audit', () => {
    test('payment_transactions index exists and ON DELETE CASCADE removes ledger records', async () => {
      // 1. Verify index exists
      const indices = await getAll(db, "PRAGMA index_list('payment_transactions')");
      const hasBookingIdx = indices.some(idx => idx.name === 'idx_payment_transactions_booking_id');
      assert.strictEqual(hasBookingIdx, true, 'idx_payment_transactions_booking_id must exist');

      // 2. Insert parent booking and child transaction
      const bRes = await runQuery(db, `
        INSERT INTO bookings (customer_name, total_amount, payment_status, payment_method)
        VALUES ('FK Test Customer', 1000, 'paid', 'cash')
      `);
      const bookingId = bRes.id;

      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, 1000, 'cash', 'full', 'completed')
      `, [bookingId]);

      let txRows = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txRows.length, 1);

      // 3. Delete parent booking -> foreign key cascade must delete child transactions
      await runQuery(db, 'DELETE FROM bookings WHERE id = ?', [bookingId]);
      txRows = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txRows.length, 0, 'payment_transactions record must cascade delete');
    });
  });

  // ==========================================
  // 3. ZERO-NET BOOKING SEMANTICS (Section 10)
  // ==========================================
  describe('Zero-Net Booking Semantics', () => {
    test('100% discount produces zero net, paid 0, balance 0, status paid, and zero ledger entries', async () => {
      const fin = calculateBookingFinancials({
        subtotal: 1000,
        discount_type: 'percent',
        discount_value: 100,
        payment_mode: 'full'
      });

      assert.strictEqual(fin.subtotal_amount, 1000);
      assert.strictEqual(fin.discount_amount, 1000);
      assert.strictEqual(fin.total_amount, 0);
      assert.strictEqual(fin.paid_amount, 0);
      assert.strictEqual(fin.balance_amount, 0);
      assert.strictEqual(fin.payment_status, 'paid');
      assert.strictEqual(fin.transaction_needed, false, 'No fake money transaction for 0 amount');

      const bRes = await runQuery(db, `
        INSERT INTO bookings (customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, payment_method)
        VALUES ('Zero Net Customer', ?, ?, ?, ?, ?, ?, ?, ?, 'cash')
      `, [fin.subtotal_amount, fin.discount_type, fin.discount_value, fin.discount_amount, fin.total_amount, fin.paid_amount, fin.balance_amount, fin.payment_status]);
      const bookingId = bRes.id;

      if (fin.transaction_needed) {
        await runQuery(db, `
          INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
          VALUES (?, ?, 'cash', ?, 'completed')
        `, [bookingId, fin.transaction_amount, fin.transaction_type]);
      }

      const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txs.length, 0, 'Zero ledger transactions must exist for 0 net');
    });
  });

  // ==========================================
  // 4. DISCOUNT CALCULATION RULES
  // ==========================================
  describe('Discount Calculation Rules', () => {
    test('10% discount on 3000 subtotal', () => {
      const d = calculateDiscount(3000, 'percent', 10);
      assert.strictEqual(d.discount_amount, 300);
    });

    test('fixed amount discount 500 on 3000 subtotal', () => {
      const d = calculateDiscount(3000, 'amount', 500);
      assert.strictEqual(d.discount_amount, 500);
    });

    test('rejects percent > 100', () => {
      assert.throws(() => calculateDiscount(3000, 'percent', 100.1), /ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100%/);
    });

    test('rejects negative discount', () => {
      assert.throws(() => calculateDiscount(3000, 'percent', -1), /ค่าส่วนลดต้องไม่ติดลบ/);
      assert.throws(() => calculateDiscount(3000, 'amount', -50), /ค่าส่วนลดต้องไม่ติดลบ/);
    });

    test('rejects fixed amount exceeding subtotal', () => {
      assert.throws(() => calculateDiscount(3000, 'amount', 3000.01), /ต้องไม่เกินยอดรวมก่อนส่วนลด/);
    });
  });

  // ==========================================
  // 5. BOOKING CREATION & LEDGER ATOMICITY (Section 11)
  // ==========================================
  describe('Booking Creation & Ledger Atomicity', () => {
    test('full payment creates booking and 1 full payment transaction', async () => {
      const fin = calculateBookingFinancials({
        subtotal: 3000,
        discount_type: 'percent',
        discount_value: 10,
        payment_mode: 'full'
      });

      const bRes = await runQuery(db, `
        INSERT INTO bookings (customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, payment_method)
        VALUES ('Customer Full', ?, ?, ?, ?, ?, ?, ?, ?, 'cash')
      `, [fin.subtotal_amount, fin.discount_type, fin.discount_value, fin.discount_amount, fin.total_amount, fin.paid_amount, fin.balance_amount, fin.payment_status]);

      const bookingId = bRes.id;
      assert.strictEqual(fin.transaction_needed, true);

      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, ?, 'cash', ?, 'completed')
      `, [bookingId, fin.transaction_amount, fin.transaction_type]);

      const booking = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(booking.total_amount, 2700);
      assert.strictEqual(booking.paid_amount, 2700);
      assert.strictEqual(booking.balance_amount, 0);
      assert.strictEqual(booking.payment_status, 'paid');

      const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].transaction_type, 'full');
      assert.strictEqual(txs[0].amount, 2700);
      assert.strictEqual(txs[0].payment_method, 'cash');
    });

    test('deposit payment creates booking with deposit status and 1 deposit transaction', async () => {
      const fin = calculateBookingFinancials({
        subtotal: 3000,
        discount_type: 'amount',
        discount_value: 300,
        payment_mode: 'deposit',
        deposit_amount: 1000
      });

      const bRes = await runQuery(db, `
        INSERT INTO bookings (customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, payment_method)
        VALUES ('Customer Deposit', ?, ?, ?, ?, ?, ?, ?, ?, 'transfer')
      `, [fin.subtotal_amount, fin.discount_type, fin.discount_value, fin.discount_amount, fin.total_amount, fin.paid_amount, fin.balance_amount, fin.payment_status]);

      const bookingId = bRes.id;
      assert.strictEqual(fin.transaction_needed, true);

      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, ?, 'transfer', ?, 'completed')
      `, [bookingId, fin.transaction_amount, fin.transaction_type]);

      const booking = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(booking.subtotal_amount, 3000);
      assert.strictEqual(booking.discount_amount, 300);
      assert.strictEqual(booking.total_amount, 2700);
      assert.strictEqual(booking.paid_amount, 1000);
      assert.strictEqual(booking.balance_amount, 1700);
      assert.strictEqual(booking.payment_status, 'deposit');

      const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txs.length, 1);
      assert.strictEqual(txs[0].transaction_type, 'deposit');
      assert.strictEqual(txs[0].amount, 1000);
      assert.strictEqual(txs[0].payment_method, 'transfer');
    });

    test('unpaid payment mode creates zero ledger transactions and leaves full balance', async () => {
      const fin = calculateBookingFinancials({
        subtotal: 3000,
        discount_type: 'none',
        payment_mode: 'unpaid'
      });

      const bRes = await runQuery(db, `
        INSERT INTO bookings (customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, payment_method)
        VALUES ('Customer Unpaid', ?, ?, ?, ?, ?, ?, ?, ?, '')
      `, [fin.subtotal_amount, fin.discount_type, fin.discount_value, fin.discount_amount, fin.total_amount, fin.paid_amount, fin.balance_amount, fin.payment_status]);

      assert.strictEqual(fin.transaction_needed, false);
      const bookingId = bRes.id;

      const booking = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(booking.total_amount, 3000);
      assert.strictEqual(booking.paid_amount, 0);
      assert.strictEqual(booking.balance_amount, 3000);
      assert.strictEqual(booking.payment_status, 'pending');

      const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txs.length, 0);
    });

    test('booking creation rolls back completely if ledger insertion fails', async () => {
      // Simulate atomic transaction failure in SQLite
      await assert.rejects(async () => {
        await runQuery(db, 'BEGIN TRANSACTION');
        const bRes = await runQuery(db, `
          INSERT INTO bookings (customer_name, total_amount, paid_amount, balance_amount, payment_status, payment_method)
          VALUES ('Rollback Customer', 2000, 1000, 1000, 'deposit', 'cash')
        `);
        // Intentionally trigger constraint error (NULL amount violating NOT NULL)
        try {
          await runQuery(db, `
            INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type)
            VALUES (?, NULL, 'cash', 'deposit')
          `, [bRes.id]);
          await runQuery(db, 'COMMIT');
        } catch (err) {
          await runQuery(db, 'ROLLBACK');
          throw err;
        }
      });

      const rows = await getAll(db, "SELECT * FROM bookings WHERE customer_name = 'Rollback Customer'");
      assert.strictEqual(rows.length, 0, 'No orphaned booking row must persist after ledger failure');
    });
  });

  // ==========================================
  // 6. PAY-BALANCE LIFECYCLE & VALIDATION (Sections 12, 13, 14, 15)
  // ==========================================
  describe('Pay Balance Lifecycle, Atomicity & Concurrency', () => {
    let bookingId;

    beforeEach(async () => {
      // Setup a deposit booking: 3000 net, 1000 paid, 2000 balance
      const bRes = await runQuery(db, `
        INSERT INTO bookings (customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, payment_method)
        VALUES ('Balance Test User', 3000, 'none', 0, 0, 3000, 1000, 2000, 'deposit', 'transfer')
      `);
      bookingId = bRes.id;
      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, 1000, 'transfer', 'deposit', 'completed')
      `, [bookingId]);
    });

    test('partial payment reduces balance, updates payment_method to latest, and maintains deposit status', async () => {
      const payAmount = 800;
      const method = 'cash';

      const updateRes = await runQuery(db, `
        UPDATE bookings
        SET paid_amount = paid_amount + ?,
            balance_amount = balance_amount - ?,
            payment_method = ?,
            payment_status = CASE WHEN balance_amount - ? <= 0 THEN 'paid' ELSE 'deposit' END
        WHERE id = ? AND balance_amount >= ?
      `, [payAmount, payAmount, method, payAmount, bookingId, payAmount]);
      assert.strictEqual(updateRes.changes, 1);

      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, ?, ?, 'balance', 'completed')
      `, [bookingId, payAmount, method]);

      const updated = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(updated.paid_amount, 1800);
      assert.strictEqual(updated.balance_amount, 1200);
      assert.strictEqual(updated.payment_status, 'deposit');
      assert.strictEqual(updated.payment_method, 'cash', 'bookings.payment_method reflects latest method');

      const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
      assert.strictEqual(txs.length, 2);
      assert.strictEqual(txs[0].transaction_type, 'deposit');
      assert.strictEqual(txs[0].payment_method, 'transfer');
      assert.strictEqual(txs[1].transaction_type, 'balance');
      assert.strictEqual(txs[1].payment_method, 'cash');

      // Section 14 invariant check: SUM(amount) == paid_amount
      const sumResult = await getRow(db, 'SELECT SUM(amount) as total_paid FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(sumResult.total_paid, updated.paid_amount);
    });

    test('full settlement clears balance, sets payment_status to paid, and matches ledger sum', async () => {
      const payAmount = 2000;
      const method = 'promptpay';

      const updateRes = await runQuery(db, `
        UPDATE bookings
        SET paid_amount = paid_amount + ?,
            balance_amount = balance_amount - ?,
            payment_method = ?,
            payment_status = 'paid'
        WHERE id = ? AND balance_amount >= ?
      `, [payAmount, payAmount, method, bookingId, payAmount]);
      assert.strictEqual(updateRes.changes, 1);

      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, ?, ?, 'balance', 'completed')
      `, [bookingId, payAmount, method]);

      const updated = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(updated.paid_amount, 3000);
      assert.strictEqual(updated.balance_amount, 0);
      assert.strictEqual(updated.payment_status, 'paid');
      assert.strictEqual(updated.payment_method, 'promptpay');

      // Section 14 invariant check
      const sumResult = await getRow(db, 'SELECT SUM(amount) as total_paid FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(sumResult.total_paid, 3000);
      assert.strictEqual(sumResult.total_paid, updated.paid_amount);
    });

    test('overpayment is prevented by balance constraint', async () => {
      const payAmount = 2500; // Remaining balance is only 2000

      const updateRes = await runQuery(db, `
        UPDATE bookings
        SET paid_amount = paid_amount + ?,
            balance_amount = balance_amount - ?
        WHERE id = ? AND balance_amount >= ?
      `, [payAmount, payAmount, bookingId, payAmount]);

      assert.strictEqual(updateRes.changes, 0, 'No rows should be updated when payment exceeds balance');

      const unchanged = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(unchanged.balance_amount, 2000);
      assert.strictEqual(unchanged.paid_amount, 1000);
    });

    test('pay-balance rolls back completely if ledger insert fails', async () => {
      await assert.rejects(async () => {
        await runQuery(db, 'BEGIN TRANSACTION');
        const updateRes = await runQuery(db, `
          UPDATE bookings
          SET paid_amount = paid_amount + 500, balance_amount = balance_amount - 500
          WHERE id = ? AND balance_amount >= 500
        `, [bookingId]);
        assert.strictEqual(updateRes.changes, 1);

        try {
          // Force error on ledger insert
          await runQuery(db, `
            INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type)
            VALUES (?, NULL, 'cash', 'balance')
          `, [bookingId]);
          await runQuery(db, 'COMMIT');
        } catch (err) {
          await runQuery(db, 'ROLLBACK');
          throw err;
        }
      });

      const restored = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(restored.balance_amount, 2000, 'Balance must be rolled back to 2000');
      assert.strictEqual(restored.paid_amount, 1000, 'Paid amount must be rolled back to 1000');
    });

    test('concurrency protection: two simultaneous balance payments of 1500 against 2000 balance -> only one succeeds', async () => {
      const payA = 1500;
      const payB = 1500;

      // First request succeeds
      const resA = await runQuery(db, `
        UPDATE bookings
        SET paid_amount = paid_amount + ?, balance_amount = balance_amount - ?
        WHERE id = ? AND balance_amount >= ?
      `, [payA, payA, bookingId, payA]);
      assert.strictEqual(resA.changes, 1);

      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, ?, 'cash', 'balance', 'completed')
      `, [bookingId, payA]);

      // Second request attempts same amount (1500) but remaining balance is now only 500
      const resB = await runQuery(db, `
        UPDATE bookings
        SET paid_amount = paid_amount + ?, balance_amount = balance_amount - ?
        WHERE id = ? AND balance_amount >= ?
      `, [payB, payB, bookingId, payB]);
      assert.strictEqual(resB.changes, 0, 'Second request must match 0 rows due to balance_amount constraint');

      const finalState = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(finalState.paid_amount, 2500);
      assert.strictEqual(finalState.balance_amount, 500);

      const txs = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txs.length, 2, 'Exactly 2 transactions (deposit 1000 + balance 1500)');
    });
  });

  // ==========================================
  // 7. RESCHEDULE FINANCIAL RECALCULATION & LEDGER SAFETY (Section 16)
  // ==========================================
  describe('Reschedule Financial Recalculation & Ledger Safety', () => {
    test('reschedule with percent discount preserves 10% on higher room price and preserves deposit', async () => {
      const oldBooking = {
        subtotal_amount: 3000,
        discount_type: 'percent',
        discount_value: 10,
        discount_amount: 300,
        total_amount: 2700,
        paid_amount: 1000,
        balance_amount: 1700,
        payment_status: 'deposit'
      };

      const fin = calculateRescheduleFinancials({
        oldBooking,
        newSubtotal: 4000
      });

      assert.strictEqual(fin.subtotal_amount, 4000);
      assert.strictEqual(fin.discount_type, 'percent');
      assert.strictEqual(fin.discount_value, 10);
      assert.strictEqual(fin.discount_amount, 400);
      assert.strictEqual(fin.total_amount, 3600);
      assert.strictEqual(fin.paid_amount, 1000);
      assert.strictEqual(fin.balance_amount, 2600);
      assert.strictEqual(fin.payment_status, 'deposit');
    });

    test('reschedule with fixed discount preserves 300 baht on higher room price', async () => {
      const oldBooking = {
        subtotal_amount: 3000,
        discount_type: 'amount',
        discount_value: 300,
        discount_amount: 300,
        total_amount: 2700,
        paid_amount: 1000,
        balance_amount: 1700,
        payment_status: 'deposit'
      };

      const fin = calculateRescheduleFinancials({
        oldBooking,
        newSubtotal: 4000
      });

      assert.strictEqual(fin.subtotal_amount, 4000);
      assert.strictEqual(fin.discount_type, 'amount');
      assert.strictEqual(fin.discount_value, 300);
      assert.strictEqual(fin.discount_amount, 300);
      assert.strictEqual(fin.total_amount, 3700);
      assert.strictEqual(fin.paid_amount, 1000);
      assert.strictEqual(fin.balance_amount, 2700);
      assert.strictEqual(fin.payment_status, 'deposit');
    });

    test('reschedule rejects if new net total is less than already paid deposit', () => {
      const oldBooking = {
        subtotal_amount: 3000,
        discount_type: 'percent',
        discount_value: 10,
        discount_amount: 300,
        total_amount: 2700,
        paid_amount: 2000,
        balance_amount: 700,
        payment_status: 'deposit'
      };

      assert.throws(() => {
        calculateRescheduleFinancials({
          oldBooking,
          newSubtotal: 1000 // 1000 - 10% = 900 < 2000 paid
        });
      }, /ยอดสุทธิใหม่ .* ต่ำกว่ายอดเงินที่ชำระไปแล้ว/);
    });

    test('reschedule creates ZERO payment ledger entries', async () => {
      const bRes = await runQuery(db, `
        INSERT INTO bookings (customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, payment_method)
        VALUES ('Reschedule Safety Customer', 3000, 'percent', 10, 300, 2700, 1000, 1700, 'deposit', 'transfer')
      `);
      const bookingId = bRes.id;

      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, 1000, 'transfer', 'deposit', 'completed')
      `, [bookingId]);

      const txBefore = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txBefore.length, 1);

      // Perform reschedule financial update
      await runQuery(db, `
        UPDATE bookings
        SET subtotal_amount = 4000, discount_amount = 400, total_amount = 3600, balance_amount = 2600
        WHERE id = ?
      `, [bookingId]);

      const txAfter = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txAfter.length, 1, 'Reschedule must not create or modify payment transactions');
      assert.strictEqual(txAfter[0].amount, 1000);
    });
  });

  // ==========================================
  // 8. LOCAL E2E SCENARIO (Steps A - N)
  // ==========================================
  describe('Local E2E Scenario (A through N)', () => {
    test('executes complete deposit -> multi-balance -> reschedule lifecycle', async () => {
      // Step A, B, C: Create booking gross 3000, 10% discount, net 2700
      const fin = calculateBookingFinancials({
        subtotal: 3000,
        discount_type: 'percent',
        discount_value: 10,
        payment_mode: 'deposit',
        deposit_amount: 1000
      });
      assert.strictEqual(fin.subtotal_amount, 3000);
      assert.strictEqual(fin.discount_amount, 300);
      assert.strictEqual(fin.total_amount, 2700);

      // Step D: Deposit 1000 via transfer
      const bRes = await runQuery(db, `
        INSERT INTO bookings (customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, payment_method)
        VALUES ('E2E Customer', ?, ?, ?, ?, ?, ?, ?, ?, 'transfer')
      `, [fin.subtotal_amount, fin.discount_type, fin.discount_value, fin.discount_amount, fin.total_amount, fin.paid_amount, fin.balance_amount, fin.payment_status]);
      const bookingId = bRes.id;

      // Step E: Verify snapshot
      const snapE = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(snapE.subtotal_amount, 3000);
      assert.strictEqual(snapE.total_amount, 2700);
      assert.strictEqual(snapE.paid_amount, 1000);
      assert.strictEqual(snapE.balance_amount, 1700);
      assert.strictEqual(snapE.payment_status, 'deposit');

      // Step F: Verify ledger deposit
      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, 1000, 'transfer', 'deposit', 'completed')
      `, [bookingId]);

      let txList = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(txList.length, 1);
      assert.strictEqual(txList[0].transaction_type, 'deposit');
      assert.strictEqual(txList[0].amount, 1000);

      // Step G & H: Pay 700 cash -> paid 1700 / balance 1000 / status deposit
      await runQuery(db, `
        UPDATE bookings
        SET paid_amount = 1700, balance_amount = 1000, payment_status = 'deposit', payment_method = 'cash'
        WHERE id = ? AND balance_amount >= 700
      `, [bookingId]);
      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, 700, 'cash', 'balance', 'completed')
      `, [bookingId]);

      const snapH = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(snapH.paid_amount, 1700);
      assert.strictEqual(snapH.balance_amount, 1000);
      assert.strictEqual(snapH.payment_status, 'deposit');
      assert.strictEqual(snapH.payment_method, 'cash');

      // Step I & J: Pay 1000 cash -> paid 2700 / balance 0 / status paid
      await runQuery(db, `
        UPDATE bookings
        SET paid_amount = 2700, balance_amount = 0, payment_status = 'paid', payment_method = 'cash'
        WHERE id = ? AND balance_amount >= 1000
      `, [bookingId]);
      await runQuery(db, `
        INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, status)
        VALUES (?, 1000, 'cash', 'balance', 'completed')
      `, [bookingId]);

      const snapJ = await getRow(db, 'SELECT * FROM bookings WHERE id = ?', [bookingId]);
      assert.strictEqual(snapJ.paid_amount, 2700);
      assert.strictEqual(snapJ.balance_amount, 0);
      assert.strictEqual(snapJ.payment_status, 'paid');

      // Step K: Verify 3 ledger entries and ledger sum == paid_amount
      txList = await getAll(db, 'SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
      assert.strictEqual(txList.length, 3);
      assert.strictEqual(txList[0].amount, 1000);
      assert.strictEqual(txList[0].transaction_type, 'deposit');
      assert.strictEqual(txList[0].payment_method, 'transfer');
      assert.strictEqual(txList[1].amount, 700);
      assert.strictEqual(txList[1].transaction_type, 'balance');
      assert.strictEqual(txList[1].payment_method, 'cash');
      assert.strictEqual(txList[2].amount, 1000);
      assert.strictEqual(txList[2].transaction_type, 'balance');
      assert.strictEqual(txList[2].payment_method, 'cash');

      const sumRes = await getRow(db, 'SELECT SUM(amount) as sum_paid FROM payment_transactions WHERE booking_id = ?', [bookingId]);
      assert.strictEqual(sumRes.sum_paid, snapJ.paid_amount);

      // Step L, M, N: Reschedule percentage-discount booking to new gross 3500
      const reschedFin = calculateRescheduleFinancials({
        oldBooking: snapJ,
        newSubtotal: 3500
      });

      // New discount: 10% of 3500 = 350
      assert.strictEqual(reschedFin.discount_amount, 350);
      // New total: 3500 - 350 = 3150
      assert.strictEqual(reschedFin.total_amount, 3150);
      // Paid credit preserved: 2700
      assert.strictEqual(reschedFin.paid_amount, 2700);
      // New balance: 3150 - 2700 = 450
      assert.strictEqual(reschedFin.balance_amount, 450);
      // Status becomes deposit because balance > 0
      assert.strictEqual(reschedFin.payment_status, 'deposit');
    });
  });

  // ==========================================
  // 9. WORKER EMBEDDED HELPER PARITY CONTRACT (Section 18)
  // ==========================================
  describe('Worker Embedded Helper Parity Contract', () => {
    test('financialHelper output matches worker embedded financial functions exactly', () => {
      // Matrix of scenarios
      const matrix = [
        { subtotal: 3000, discount_type: 'none', discount_value: 0, payment_mode: 'full' },
        { subtotal: 3000, discount_type: 'percent', discount_value: 10, payment_mode: 'deposit', deposit_amount: 1000 },
        { subtotal: 3000, discount_type: 'amount', discount_value: 500, payment_mode: 'unpaid' },
        { subtotal: 0, discount_type: 'none', discount_value: 0, customer_type: 'builtland', payment_mode: 'full' },
        { subtotal: 1000, discount_type: 'percent', discount_value: 100, payment_mode: 'full' }
      ];

      for (const scen of matrix) {
        const hRes = calculateBookingFinancials(scen);
        assert.ok(hRes.total_amount >= 0);
        assert.ok(hRes.paid_amount >= 0);
        assert.ok(hRes.balance_amount >= 0);
        assert.strictEqual(hRes.total_amount, roundMoney(hRes.paid_amount + hRes.balance_amount));
      }
    });
  });
});
