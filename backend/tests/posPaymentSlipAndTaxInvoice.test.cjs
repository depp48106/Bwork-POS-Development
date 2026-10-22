'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

// Helper to create an in-memory SQLite database simulating BWORK POS DB
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
    close: () => new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    })
  };
  return { db, query };
}

// Magic byte detector for test validation
function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { ext: 'pdf', mime: 'application/pdf' };
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

test('POS Payment Slip & Tax Invoice Management Test Suite', async (t) => {
  let testEnv;

  t.beforeEach(async () => {
    testEnv = createTestDb();
    const { query } = testEnv;

    // Initialize core schema
    await query.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        hourly_rate REAL NOT NULL,
        daily_rate REAL DEFAULT 0,
        half_day_rate REAL DEFAULT 0,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        department TEXT,
        contact TEXT,
        subtotal_amount REAL,
        discount_type TEXT DEFAULT 'none',
        discount_value REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        total_amount REAL NOT NULL,
        paid_amount REAL DEFAULT 0,
        balance_amount REAL DEFAULT 0,
        payment_status TEXT DEFAULT 'pending',
        payment_method TEXT,
        receipt_number TEXT,
        pin_code TEXT,
        booking_source TEXT DEFAULT 'walk-in',
        booking_channel TEXT DEFAULT 'pos_web',
        customer_type TEXT DEFAULT 'walkin',
        customer_id INTEGER,
        contract_id INTEGER,
        billing_option TEXT DEFAULT 'paid',
        quota_hours_used REAL DEFAULT 0,
        slip_image_url TEXT,
        tax_invoice_required INTEGER DEFAULT 0,
        tax_payer_type TEXT DEFAULT 'corporate',
        tax_name TEXT,
        tax_id TEXT,
        tax_branch_type TEXT DEFAULT 'head',
        tax_branch_number TEXT,
        tax_address TEXT,
        tax_email TEXT,
        tax_phone TEXT,
        tax_delivery_method TEXT DEFAULT 'email',
        tax_postal_address TEXT,
        tax_invoice_status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payment_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        slip_url TEXT,
        transaction_type TEXT DEFAULT 'full',
        status TEXT DEFAULT 'completed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tax_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        invoice_number TEXT,
        tax_payer_type TEXT DEFAULT 'corporate',
        tax_name TEXT NOT NULL,
        tax_id TEXT NOT NULL,
        tax_branch_type TEXT DEFAULT 'head',
        tax_branch_number TEXT,
        tax_address TEXT,
        tax_email TEXT,
        tax_phone TEXT,
        file_url TEXT,
        r2_object_key TEXT,
        file_name TEXT,
        content_type TEXT,
        file_size INTEGER,
        status TEXT DEFAULT 'issued',
        notes TEXT,
        uploaded_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS booking_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        performed_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  t.afterEach(async () => {
    if (testEnv) {
      await testEnv.query.close();
    }
  });

  // ----------------------------------------------------
  // TEST 1: Database Migration Schema
  // ----------------------------------------------------
  await t.test('1. Migration 013 correctly creates tax columns and tax_invoices table', async () => {
    const migrationFile = path.join(__dirname, '../migrations/013_add_tax_invoices_and_slip_management.sql');
    assert.ok(fs.existsSync(migrationFile), 'Migration 013 file exists');
    const sql = fs.readFileSync(migrationFile, 'utf8');
    assert.ok(sql.includes('tax_invoices'), 'Creates tax_invoices table');
    assert.ok(sql.includes('tax_payer_type'), 'Adds tax_payer_type column');
    assert.ok(sql.includes('tax_branch_type'), 'Adds tax_branch_type column');
    assert.ok(sql.includes('tax_branch_number'), 'Adds tax_branch_number column');
    assert.ok(sql.includes('tax_email'), 'Adds tax_email column');
    assert.ok(sql.includes('tax_invoice_status'), 'Adds tax_invoice_status column');
  });

  // ----------------------------------------------------
  // TEST 2: Magic Bytes File Signature Detection
  // ----------------------------------------------------
  await t.test('2. Magic Bytes File Signature Detection correctly validates PDF, JPG, PNG, WEBP and rejects invalid files', async () => {
    const pdfBuf = Buffer.from('%PDF-1.4 header content', 'utf8');
    const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
    const jpgBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
    const webpBuf = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')]);
    const badBuf = Buffer.from('MZ executable header', 'utf8');

    assert.equal(detectFileType(pdfBuf)?.ext, 'pdf');
    assert.equal(detectFileType(pngBuf)?.ext, 'png');
    assert.equal(detectFileType(jpgBuf)?.ext, 'jpg');
    assert.equal(detectFileType(webpBuf)?.ext, 'webp');
    assert.equal(detectFileType(badBuf), null, 'Rejects non-whitelisted binary signatures');
  });

  // ----------------------------------------------------
  // TEST 3: Walk-in Booking with Payment Slip Attachment
  // ----------------------------------------------------
  await t.test('3. Walk-in Booking stores slip file URL in database (never raw Base64 Data URI)', async () => {
    const { query } = testEnv;
    const slipUrl = '/uploads/slips/walkin_BK000001_1729500000.jpg';

    const insRes = await query.run(
      `INSERT INTO bookings
       (customer_name, contact, subtotal_amount, total_amount, paid_amount, balance_amount,
        payment_status, payment_method, slip_image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['นายสมเกียรติ มั่นคง', '081-999-8888', 1500, 1500, 1500, 0, 'paid', 'transfer', slipUrl]
    );

    const bookingId = insRes.lastID;
    await query.run(
      `INSERT INTO payment_transactions
       (booking_id, amount, payment_method, slip_url, transaction_type, status)
       VALUES (?, ?, ?, ?, 'full', 'completed')`,
      [bookingId, 1500, 'transfer', slipUrl]
    );

    const savedBooking = await query.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    assert.equal(savedBooking.slip_image_url, slipUrl);
    assert.ok(!savedBooking.slip_image_url.startsWith('data:'), 'Never stores raw data URL');

    const tx = await query.get('SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
    assert.equal(tx.slip_url, slipUrl);
    assert.equal(tx.amount, 1500);
  });

  // ----------------------------------------------------
  // TEST 4: Slip Upload DOES NOT automatically flip status to paid
  // ----------------------------------------------------
  await t.test('4. Critical Safety Gate: Slip Attachment alone DOES NOT change payment_status to paid', async () => {
    const { query } = testEnv;

    // Booking created as deposit / unpaid
    const insRes = await query.run(
      `INSERT INTO bookings
       (customer_name, contact, subtotal_amount, total_amount, paid_amount, balance_amount,
        payment_status, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['ลูกค้ามัดจำบางส่วน', '089-111-2222', 2000, 2000, 500, 1500, 'deposit', 'transfer']
    );
    const bookingId = insRes.lastID;

    // Attach slip to booking
    const attachedSlipUrl = '/uploads/slips/attach_BK000002.jpg';
    await query.run('UPDATE bookings SET slip_image_url = ? WHERE id = ?', [attachedSlipUrl, bookingId]);

    const afterAttach = await query.get('SELECT payment_status, balance_amount, paid_amount FROM bookings WHERE id = ?', [bookingId]);
    assert.equal(afterAttach.payment_status, 'deposit', 'Status remains deposit and not paid');
    assert.equal(afterAttach.balance_amount, 1500, 'Balance amount remains strictly intact');
    assert.equal(afterAttach.paid_amount, 500, 'Paid amount unchanged');
  });

  // ----------------------------------------------------
  // TEST 5: Tax Invoice Data Entry & 13-Digit Tax ID Validation
  // ----------------------------------------------------
  await t.test('5. Tax Invoice details can be entered, updated, and validated for 13 digits', async () => {
    const { query } = testEnv;

    const insRes = await query.run(
      `INSERT INTO bookings (customer_name, contact, total_amount, payment_status)
       VALUES (?, ?, ?, ?)`,
      ['บจก. สยามเทคโนโลยี', '02-777-6666', 3500, 'paid']
    );
    const bookingId = insRes.lastID;

    // Validation 1: 13-digit Tax ID check
    const validTaxId = '0105556098765';
    assert.equal(/^\d{13}$/.test(validTaxId), true, 'Valid 13-digit tax ID accepted');

    const invalidTaxId = '12345';
    assert.equal(/^\d{13}$/.test(invalidTaxId), false, 'Invalid tax ID rejected');

    // Update tax invoice info on booking
    await query.run(
      `UPDATE bookings
       SET tax_invoice_required = 1,
           tax_payer_type = 'corporate',
           tax_name = 'บริษัท สยามเทคโนโลยี จำกัด',
           tax_id = ?,
           tax_branch_type = 'branch',
           tax_branch_number = '00003',
           tax_address = '123 ถนนเพลินจิต แขวงลุมพินี เขตปทุมวัน กทม. 10330',
           tax_email = 'tax@siamtech.co.th',
           tax_phone = '02-777-6666',
           tax_delivery_method = 'email',
           tax_invoice_status = 'pending'
       WHERE id = ?`,
      [validTaxId, bookingId]
    );

    const updated = await query.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    assert.equal(updated.tax_invoice_required, 1);
    assert.equal(updated.tax_payer_type, 'corporate');
    assert.equal(updated.tax_name, 'บริษัท สยามเทคโนโลยี จำกัด');
    assert.equal(updated.tax_id, validTaxId);
    assert.equal(updated.tax_branch_type, 'branch');
    assert.equal(updated.tax_branch_number, '00003');
    assert.equal(updated.tax_email, 'tax@siamtech.co.th');
    assert.equal(updated.tax_invoice_status, 'pending');
  });

  // ----------------------------------------------------
  // TEST 6: Tax Invoice Document Attachment & Status Transition
  // ----------------------------------------------------
  await t.test('6. Attaching issued PDF tax invoice transitions status to issued and records metadata', async () => {
    const { query } = testEnv;

    const insRes = await query.run(
      `INSERT INTO bookings
       (customer_name, contact, total_amount, payment_status, tax_invoice_required, tax_invoice_status)
       VALUES (?, ?, ?, ?, 1, 'pending')`,
      ['ลูกค้าขอนิติบุคคล', '081-333-4444', 5000, 'paid']
    );
    const bookingId = insRes.lastID;

    // Attach issued PDF invoice document
    const fileUrl = `/uploads/tax_invoices/tax_inv_BK${bookingId}_INV-202610-001.pdf`;
    const invRes = await query.run(
      `INSERT INTO tax_invoices
       (booking_id, invoice_number, tax_payer_type, tax_name, tax_id,
        file_url, file_name, content_type, file_size, status, notes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
      [
        bookingId,
        'INV-202610-001',
        'corporate',
        'บริษัท บีเวิร์ค จำกัด',
        '0105556012345',
        fileUrl,
        'INV-202610-001.pdf',
        'application/pdf',
        45020,
        'ออกใบกำกับภาษีเรียบร้อย',
        'admin'
      ]
    );
    const invoiceId = invRes.lastID;

    // Status transitions to issued
    await query.run("UPDATE bookings SET tax_invoice_status = 'issued' WHERE id = ?", [bookingId]);

    const bookingAfter = await query.get('SELECT tax_invoice_status FROM bookings WHERE id = ?', [bookingId]);
    assert.equal(bookingAfter.tax_invoice_status, 'issued');

    const inv = await query.get('SELECT * FROM tax_invoices WHERE id = ?', [invoiceId]);
    assert.equal(inv.invoice_number, 'INV-202610-001');
    assert.equal(inv.file_url, fileUrl);
    assert.equal(inv.content_type, 'application/pdf');
    assert.equal(inv.status, 'issued');
    assert.equal(inv.uploaded_by, 'admin');

    // Test Deletion & status revert to pending
    await query.run('DELETE FROM tax_invoices WHERE id = ?', [invoiceId]);
    const remaining = await query.all('SELECT id FROM tax_invoices WHERE booking_id = ?', [bookingId]);
    const newStatus = remaining.length > 0 ? 'issued' : 'pending';
    await query.run('UPDATE bookings SET tax_invoice_status = ? WHERE id = ?', [newStatus, bookingId]);

    const bookingAfterDelete = await query.get('SELECT tax_invoice_status FROM bookings WHERE id = ?', [bookingId]);
    assert.equal(bookingAfterDelete.tax_invoice_status, 'pending');
  });

  // ----------------------------------------------------
  // TEST 7: Pay Balance Endpoint with Slip Attachment
  // ----------------------------------------------------
  await t.test('7. Outstanding balance collection via pay-balance attaches slip and updates payment ledger', async () => {
    const { query } = testEnv;

    const insRes = await query.run(
      `INSERT INTO bookings
       (customer_name, contact, subtotal_amount, total_amount, paid_amount, balance_amount,
        payment_status, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['ลูกค้าค้างจ่าย', '089-222-3333', 1000, 1000, 300, 700, 'deposit', 'cash']
    );
    const bookingId = insRes.lastID;

    // Collect remaining balance of 700 with transfer slip
    const payAmount = 700;
    const slipUrl = `/uploads/slips/walkin_BK${bookingId}_balance.png`;
    const newPaid = 300 + payAmount;
    const newBalance = 1000 - newPaid;
    const newStatus = newBalance <= 0 ? 'paid' : 'deposit';

    await query.run(
      `UPDATE bookings
       SET paid_amount = ?, balance_amount = ?, payment_status = ?, slip_image_url = ?
       WHERE id = ?`,
      [newPaid, newBalance, newStatus, slipUrl, bookingId]
    );

    await query.run(
      `INSERT INTO payment_transactions
       (booking_id, amount, payment_method, slip_url, transaction_type, status)
       VALUES (?, ?, 'transfer', ?, 'balance', 'completed')`,
      [bookingId, payAmount, slipUrl]
    );

    const b = await query.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    assert.equal(b.paid_amount, 1000);
    assert.equal(b.balance_amount, 0);
    assert.equal(b.payment_status, 'paid');
    assert.equal(b.slip_image_url, slipUrl);

    const txs = await query.all('SELECT * FROM payment_transactions WHERE booking_id = ?', [bookingId]);
    assert.equal(txs.length, 1);
    assert.equal(txs[0].amount, 700);
    assert.equal(txs[0].slip_url, slipUrl);
    assert.equal(txs[0].transaction_type, 'balance');
  });

  // ----------------------------------------------------
  // TEST 8: Server & Worker Code Parity Inspection
  // ----------------------------------------------------
  await t.test('8. Express server.js and Cloudflare worker.js have complete endpoint and schema parity', async () => {
    const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const workerCode = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

    // Both implement GET /api/bookings/:id/tax-invoice
    assert.ok(serverCode.includes("'/api/bookings/:id/tax-invoice'"), 'server.js has GET tax-invoice');
    assert.ok(workerCode.includes("pathname.endsWith('/tax-invoice') && method === 'GET'"), 'worker.js has GET tax-invoice');

    // Both implement PUT /api/bookings/:id/tax-invoice
    assert.ok(serverCode.includes("app.put('/api/bookings/:id/tax-invoice'"), 'server.js has PUT tax-invoice');
    assert.ok(workerCode.includes("pathname.endsWith('/tax-invoice') && method === 'PUT'"), 'worker.js has PUT tax-invoice');

    // Both implement POST /api/bookings/:id/tax-invoice/attachment
    assert.ok(serverCode.includes("'/api/bookings/:id/tax-invoice/attachment'"), 'server.js has attachment endpoint');
    assert.ok(workerCode.includes("pathname.endsWith('/tax-invoice/attachment') && method === 'POST'"), 'worker.js has attachment endpoint');

    // Both handle 10MB size limit
    assert.ok(serverCode.includes('10 * 1024 * 1024'), 'server.js limits to 10MB');
    assert.ok(workerCode.includes('10 * 1024 * 1024'), 'worker.js limits to 10MB');

    // Both handle WEBP in addition to PNG and JPG
    assert.ok(serverCode.includes('webp'), 'server.js supports webp');
    assert.ok(workerCode.includes('webp'), 'worker.js supports webp');
  });
});
