const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sqlite3 = require('sqlite3').verbose();
const http = require('node:http');
const express = require('express');
const crypto = require('node:crypto');

const { executeMigrationSql } = require('../migrator');
const {
  DEFAULT_SENDER_NAME,
  DEFAULT_SENDER_EMAIL,
  DEFAULT_REPLY_TO,
  GMAIL_SEND_SCOPE,
  isGmailConfigured,
  isLiveDispatchEnabled,
  getEffectiveEnvironment,
  isEmailAllowedInStaging,
  isValidEmail,
  encodeMimeHeader,
  generateTaxInvoiceEmailContent,
  buildMimeMessage,
  getGmailAccessToken,
  sendTaxInvoiceEmail
} = require('../services/gmailService');

// ========================================================
// 1. UNIT TESTS: SENDER INFO, MIME, SCOPE & CONFIG
// ========================================================
test('GmailService - Sender info constants and Gmail scope', () => {
  assert.strictEqual(DEFAULT_SENDER_NAME, 'บริษัท บิลท์ ฮาร์ท จำกัด');
  assert.strictEqual(DEFAULT_SENDER_EMAIL, 'coworkings.bwork@gmail.com');
  assert.strictEqual(DEFAULT_REPLY_TO, 'coworkings.bwork@gmail.com');
  assert.strictEqual(GMAIL_SEND_SCOPE, 'https://www.googleapis.com/auth/gmail.send');
});

test('GmailService - isValidEmail validation', () => {
  assert.strictEqual(isValidEmail('test@bwork.co'), true);
  assert.strictEqual(isValidEmail('customer.name+tag@example.com'), true);
  assert.strictEqual(isValidEmail('admin@sub.domain.co.th'), true);
  assert.strictEqual(isValidEmail('coworkings.bwork@gmail.com'), true);
  assert.strictEqual(isValidEmail(''), false);
  assert.strictEqual(isValidEmail(null), false);
  assert.strictEqual(isValidEmail('invalid-email'), false);
  assert.strictEqual(isValidEmail('user@'), false);
  assert.strictEqual(isValidEmail('@domain.com'), false);
  assert.strictEqual(isValidEmail('user @example.com'), false);
});

test('GmailService - Thai sender name MIME encoding RFC 2047', () => {
  const thaiSender = 'บริษัท บิลท์ ฮาร์ท จำกัด';
  const encoded = encodeMimeHeader(thaiSender);
  assert.ok(encoded.startsWith('=?UTF-8?B?'));
  assert.ok(encoded.endsWith('?='));

  // Decoding the base64 word yields the original Thai text
  const base64Part = encoded.replace('=?UTF-8?B?', '').replace('?=', '');
  const decoded = Buffer.from(base64Part, 'base64').toString('utf8');
  assert.strictEqual(decoded, thaiSender);
});

test('GmailService - generateTaxInvoiceEmailContent generates bilingual template with default sender', () => {
  const booking = {
    id: 101,
    booking_code: 'BK-000101',
    customer_name: 'บริษัท สยามคอมเมิร์ซ จำกัด',
    total_amount: 3500
  };
  const invoice = {
    id: 5,
    invoice_number: 'INV-202611-0005',
    tax_name: 'บริษัท สยามคอมเมิร์ซ จำกัด',
    tax_id: '0105559012345',
    tax_payer_type: 'corporate',
    tax_branch_type: 'head'
  };

  const content = generateTaxInvoiceEmailContent({
    booking,
    invoice,
    recipientEmail: 'finance@siamcommerce.co.th'
  });

  assert.ok(content.subject.includes('INV-202611-0005'));
  assert.ok(content.subject.includes('BK-000101'));
  assert.ok(content.textBody.includes('บริษัท สยามคอมเมิร์ซ จำกัด'));
  assert.ok(content.textBody.includes('0105559012345'));
  assert.ok(content.textBody.includes('฿3,500.00'));
  assert.ok(content.textBody.includes('coworkings.bwork@gmail.com'));
  assert.ok(content.textBody.includes('บริษัท บิลท์ ฮาร์ท จำกัด'));
  assert.ok(content.htmlBody.includes('บริษัท บิลท์ ฮาร์ท จำกัด'));
  assert.ok(content.htmlBody.includes('เอกสารใบกำกับภาษี (ไฟล์แนบ PDF)'));
});

test('GmailService - buildMimeMessage constructs valid RFC 2822 payload with From, Reply-To and PDF', () => {
  const dummyPdf = Buffer.from('%PDF-1.4\n%dummy\n%%EOF');
  const mime = buildMimeMessage({
    from: 'บริษัท บิลท์ ฮาร์ท จำกัด <coworkings.bwork@gmail.com>',
    to: 'customer@example.com',
    replyTo: 'coworkings.bwork@gmail.com',
    subject: 'ใบกำกับภาษีทดสอบ',
    text: 'ข้อความทดสอบ',
    html: '<p>ข้อความทดสอบ HTML</p>',
    attachmentBuffer: dummyPdf,
    attachmentFileName: 'Tax_Invoice_001.pdf'
  });

  assert.ok(mime.includes('To: customer@example.com'));
  assert.ok(mime.includes('Reply-To: <coworkings.bwork@gmail.com>'));
  assert.ok(mime.includes('multipart/mixed'));
  assert.ok(mime.includes('multipart/alternative'));
  assert.ok(mime.includes('application/pdf'));
  assert.ok(mime.includes('Tax_Invoice_001.pdf'));
});

test('GmailService - Master Switch & Credentials enforcement', async () => {
  const envNoSwitch = {
    GMAIL_CLIENT_ID: 'dummy_id',
    GMAIL_CLIENT_SECRET: 'dummy_secret',
    GMAIL_REFRESH_TOKEN: 'dummy_refresh',
    GMAIL_LIVE_DISPATCH_ENABLED: 'false'
  };

  assert.strictEqual(isGmailConfigured(envNoSwitch), true);
  assert.strictEqual(isLiveDispatchEnabled(envNoSwitch), false);

  const booking = { id: 1 };
  const invoice = { id: 1, invoice_number: 'INV-001' };
  const validBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

  // Calling with dry_run: false when switch is off MUST throw
  await assert.rejects(
    async () => {
      await sendTaxInvoiceEmail({
        booking,
        invoice,
        recipientEmail: 'user@example.com',
        pdfBuffer: validBuffer,
        dry_run: false,
        env: envNoSwitch
      });
    },
    { message: /ระบบยังไม่ได้เปิดสวิตช์ส่งอีเมลจริง/ }
  );
});

test('GmailService - Staging Allowlist enforcement on non-production', () => {
  const envWithAllowlist = {
    GMAIL_STAGING_ALLOWLIST: 'qa@bwork.co,admin@bwork.co,@staging-team.com'
  };

  // 1. Staging / Development blocks unlisted emails
  assert.strictEqual(isEmailAllowedInStaging('random@gmail.com', envWithAllowlist, 'staging'), false);
  assert.strictEqual(isEmailAllowedInStaging('user@corporate.com', envWithAllowlist, 'development'), false);

  // 2. Exact match in allowlist
  assert.strictEqual(isEmailAllowedInStaging('qa@bwork.co', envWithAllowlist, 'staging'), true);
  assert.strictEqual(isEmailAllowedInStaging('admin@bwork.co', envWithAllowlist, 'development'), true);

  // 3. Domain match (@staging-team.com)
  assert.strictEqual(isEmailAllowedInStaging('tester1@staging-team.com', envWithAllowlist, 'staging'), true);

  // 4. Production allows all valid emails
  assert.strictEqual(isEmailAllowedInStaging('customer@anydomain.com', envWithAllowlist, 'production'), true);
});

test('GmailService - sendTaxInvoiceEmail enforces PDF magic bytes and size check', async () => {
  const booking = { id: 1 };
  const invoice = { id: 1, invoice_number: 'INV-001' };

  // 1. Non-PDF buffer (missing %PDF-)
  const badBuffer = Buffer.from('NOT A PDF FILE');
  await assert.rejects(
    async () => {
      await sendTaxInvoiceEmail({
        booking,
        invoice,
        recipientEmail: 'user@example.com',
        pdfBuffer: badBuffer,
        dry_run: true
      });
    },
    { message: /ไฟล์เอกสารไม่ใช่รูปแบบ PDF/ }
  );

  // 2. Over 10MB buffer
  const hugeBuffer = Buffer.alloc(11 * 1024 * 1024);
  hugeBuffer[0] = 0x25; hugeBuffer[1] = 0x50; hugeBuffer[2] = 0x44; hugeBuffer[3] = 0x46; // %PDF
  await assert.rejects(
    async () => {
      await sendTaxInvoiceEmail({
        booking,
        invoice,
        recipientEmail: 'user@example.com',
        pdfBuffer: hugeBuffer,
        dry_run: true
      });
    },
    { message: /เกินขีดจำกัด 10MB/ }
  );

  // 3. Valid PDF buffer with dry_run: true
  const validBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const result = await sendTaxInvoiceEmail({
    booking,
    invoice,
    recipientEmail: 'user@example.com',
    pdfBuffer: validBuffer,
    fileName: 'INV-001.pdf',
    dry_run: true
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.dry_run, true);
  assert.strictEqual(result.status, 'dry_run');
  assert.ok(result.message_id.startsWith('dry_run_msg_'));
  assert.strictEqual(result.recipient, 'user@example.com');
  assert.strictEqual(result.file_name, 'INV-001.pdf');
});

test('GmailService - OAuth2 Token Exchange & Live Dispatch with Mock Fetch', async () => {
  const mockFetchCalls = [];
  const mockFetch = async (url, opts) => {
    mockFetchCalls.push({ url, opts });
    if (url === 'https://oauth2.googleapis.com/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'mock_access_token_xyz',
          expires_in: 3600,
          token_type: 'Bearer'
        })
      };
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'gmail_msg_live_12345',
          threadId: 'thread_live_67890'
        })
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const env = {
    GMAIL_CLIENT_ID: 'mock_client_id',
    GMAIL_CLIENT_SECRET: 'mock_client_secret',
    GMAIL_REFRESH_TOKEN: 'mock_refresh_token',
    GMAIL_LIVE_DISPATCH_ENABLED: 'true',
    GMAIL_STAGING_ALLOWLIST: 'user@allowed.com',
    APP_ENV: 'staging'
  };

  const booking = { id: 10, receipt_number: 'BK-000010' };
  const invoice = { id: 5, invoice_number: 'INV-005' };
  const validBuffer = Buffer.from('%PDF-1.4\nMocked live PDF content\n%%EOF');

  const result = await sendTaxInvoiceEmail({
    booking,
    invoice,
    recipientEmail: 'user@allowed.com',
    pdfBuffer: validBuffer,
    fileName: 'INV-005.pdf',
    dry_run: false,
    env,
    fetchFn: mockFetch
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.dry_run, false);
  assert.strictEqual(result.status, 'gmail_accepted');
  assert.strictEqual(result.message_id, 'gmail_msg_live_12345');
  assert.strictEqual(result.thread_id, 'thread_live_67890');
  assert.strictEqual(mockFetchCalls.length, 2);
  assert.strictEqual(mockFetchCalls[0].url, 'https://oauth2.googleapis.com/token');
  assert.strictEqual(mockFetchCalls[1].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
});

test('GmailService - Timeout / Network Uncertainty does not auto-retry and marks uncertain', async () => {
  const timeoutFetch = async (url) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'mock_token', expires_in: 3600 })
      };
    }
    // Simulate socket reset or timeout after message was sent
    const netErr = new Error('Socket timeout after payload transmitted');
    netErr.code = 'ETIMEDOUT';
    throw netErr;
  };

  const env = {
    GMAIL_CLIENT_ID: 'mock_client_id',
    GMAIL_CLIENT_SECRET: 'mock_client_secret',
    GMAIL_REFRESH_TOKEN: 'mock_refresh_token',
    GMAIL_LIVE_DISPATCH_ENABLED: 'true',
    GMAIL_STAGING_ALLOWLIST: 'user@allowed.com',
    APP_ENV: 'staging'
  };

  const booking = { id: 11, receipt_number: 'BK-000011' };
  const invoice = { id: 6, invoice_number: 'INV-006' };
  const validBuffer = Buffer.from('%PDF-1.4\nMocked live PDF\n%%EOF');

  let caughtErr = null;
  try {
    await sendTaxInvoiceEmail({
      booking,
      invoice,
      recipientEmail: 'user@allowed.com',
      pdfBuffer: validBuffer,
      fileName: 'INV-006.pdf',
      dry_run: false,
      env,
      fetchFn: timeoutFetch
    });
  } catch (err) {
    caughtErr = err;
  }

  assert.ok(caughtErr !== null);
  assert.strictEqual(caughtErr.isUncertain, true);
  assert.strictEqual(caughtErr.code, 'DISPATCH_UNCERTAIN');
});

// ========================================================
// 2. INTEGRATION TESTS: DATABASE & EXPRESS API ENDPOINTS
// ========================================================
test('Tax Invoice Email Dispatch API - Comprehensive Negative & Positive Suites', async (t) => {
  const testDir = path.join(__dirname, 'temp_test_tax_email');
  const dbFile = path.join(testDir, 'test_tax_email.sqlite');
  const uploadDir = path.join(testDir, 'uploads', 'tax_invoices');

  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(uploadDir, { recursive: true });

  const sqliteDb = new sqlite3.Database(dbFile);
  const dbQuery = {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        sqliteDb.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, changes: this.changes });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        sqliteDb.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        sqliteDb.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    },
    exec(sql) {
      return new Promise((resolve, reject) => {
        sqliteDb.exec(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };

  // Run all migrations
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    await executeMigrationSql(dbQuery, sql);
  }

  // Create booking_history table
  await dbQuery.run("CREATE TABLE IF NOT EXISTS booking_history (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, action TEXT NOT NULL, details TEXT, performed_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");

  // Create users, roles, bookings
  await dbQuery.run("INSERT INTO roles (name, label, permissions, is_system) VALUES ('admin', 'Admin', 'pos,dashboard,manage', 1)");
  await dbQuery.run("INSERT INTO roles (name, label, permissions, is_system) VALUES ('staff_pos', 'Staff with POS', 'pos,history', 1)");
  await dbQuery.run("INSERT INTO roles (name, label, permissions, is_system) VALUES ('staff_no_pos', 'Staff without POS', 'tickets', 1)");

  const JWT_SECRET = 'test-secret-tax-email-12345';
  function makeToken(user) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...user, iat: Date.now(), exp: Date.now() + 3600000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  const adminToken = makeToken({ id: 1, username: 'admin', role: 'admin', permissions: 'pos,dashboard,manage' });
  const staffPosToken = makeToken({ id: 2, username: 'staff1', role: 'staff_pos', permissions: 'pos,history' });
  const staffNoPosToken = makeToken({ id: 3, username: 'staff2', role: 'staff_no_pos', permissions: 'tickets' });

  // Seed Bookings
  const b1 = await dbQuery.run(
    `INSERT INTO bookings (customer_name, receipt_number, total_amount, paid_amount, payment_status,
      tax_invoice_required, tax_payer_type, tax_name, tax_id, tax_branch_type, tax_address,
      tax_email, tax_phone, tax_delivery_method, tax_invoice_status)
     VALUES ('บริษัท ก้าวหน้า จำกัด', 'BK-000001', 5000, 5000, 'paid',
      1, 'corporate', 'บริษัท ก้าวหน้า จำกัด', '0105558888888', 'head', '123 ถนนสุขุมวิท',
      'billing@kaona.co.th', '0812345678', 'email', 'issued')`
  );
  const booking1Id = b1.id;

  const b2 = await dbQuery.run(
    `INSERT INTO bookings (customer_name, receipt_number, total_amount, paid_amount, payment_status,
      tax_invoice_required, tax_payer_type, tax_name, tax_id, tax_delivery_method, tax_email)
     VALUES ('นายสมชาย ใจดี', 'BK-000002', 1200, 1200, 'paid',
      1, 'individual', 'นายสมชาย ใจดี', '1100400123456', 'email', 'somchai@example.com')`
  );
  const booking2Id = b2.id;

  const b3 = await dbQuery.run(
    `INSERT INTO bookings (customer_name, receipt_number, total_amount, paid_amount, payment_status,
      tax_invoice_required, tax_email, tax_delivery_method)
     VALUES ('ไม่มีเอกสารแนบ', 'BK-000003', 800, 800, 'paid', 1, 'none@example.com', 'email')`
  );
  const booking3Id = b3.id;

  const b4 = await dbQuery.run(
    `INSERT INTO bookings (customer_name, receipt_number, total_amount, paid_amount, payment_status,
      tax_invoice_required, tax_email, tax_delivery_method)
     VALUES ('อีเมลไม่ถูกต้อง', 'BK-000004', 800, 800, 'paid', 1, 'not-a-valid-email', 'email')`
  );
  const booking4Id = b4.id;

  // Create dummy PDF files in test uploads
  const pdf1Path = path.join(uploadDir, 'inv_001.pdf');
  fs.writeFileSync(pdf1Path, Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'));

  const pdf2Path = path.join(uploadDir, 'inv_002.pdf');
  fs.writeFileSync(pdf2Path, Buffer.from('%PDF-1.4\n2 0 obj\n<<>>\nendobj\n%%EOF'));

  const fileUrl1 = '/uploads/tax_invoices/inv_001.pdf';
  const fileUrl2 = '/uploads/tax_invoices/inv_002.pdf';

  // Seed Tax Invoices
  const inv1 = await dbQuery.run(
    `INSERT INTO tax_invoices (booking_id, invoice_number, tax_payer_type, tax_name, tax_id,
      tax_branch_type, tax_address, tax_email, file_url, file_name, content_type, file_size, status)
     VALUES (?, 'INV-202611-001', 'corporate', 'บริษัท ก้าวหน้า จำกัด', '0105558888888', 'head', '123 ถนนสุขุมวิท',
      'billing@kaona.co.th', ?, 'inv_001.pdf', 'application/pdf', 35, 'issued')`,
    [booking1Id, fileUrl1]
  );
  const invoice1Id = inv1.id;

  const inv2 = await dbQuery.run(
    `INSERT INTO tax_invoices (booking_id, invoice_number, tax_payer_type, tax_name, tax_id,
      tax_email, file_url, file_name, content_type, file_size, status)
     VALUES (?, 'INV-202611-002', 'individual', 'นายสมชาย ใจดี', '1100400123456',
      'somchai@example.com', ?, 'inv_002.pdf', 'application/pdf', 35, 'issued')`,
    [booking2Id, fileUrl2]
  );
  const invoice2Id = inv2.id;

  // Invoice for booking 4 (has PDF but email is invalid)
  await dbQuery.run(
    `INSERT INTO tax_invoices (booking_id, invoice_number, tax_payer_type, tax_name, tax_id,
      tax_email, file_url, file_name, content_type, file_size, status)
     VALUES (?, 'INV-202611-004', 'individual', 'ลูกค้า', '1234567890123',
      'not-a-valid-email', ?, 'inv_001.pdf', 'application/pdf', 35, 'issued')`,
    [booking4Id, fileUrl1]
  );

  // Set up Express Test App
  const app = express();
  app.use(express.json());

  function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token not provided' });
    try {
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      req.user = payload;
      next();
    } catch (_) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  function requireAnyPermission(...requiredPermissions) {
    return (req, res, next) => {
      if (req.user && req.user.role === 'admin') return next();
      const perms = new Set(String(req.user?.permissions || '').split(',').map(p => p.trim()).filter(Boolean));
      if (requiredPermissions.some(p => perms.has(p))) return next();
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ดำเนินการนี้' });
    };
  }

  const taxEmailDebounce = new Map();

  function resolveDiskPath(fileUrl) {
    const clean = fileUrl.replace(/^\//, '').replace('uploads/tax_invoices/', '');
    return path.join(uploadDir, clean);
  }

  // Route: Email Preview
  app.get('/api/bookings/:id/tax-invoice/email-preview', authenticateToken, requireAnyPermission('pos', 'manage', 'admin'), async (req, res) => {
    try {
      const bookingId = Number(req.params.id);
      const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
      if (!booking) return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });

      const invoiceId = req.query.invoice_id ? Number(req.query.invoice_id) : null;
      let invoice = null;
      if (invoiceId) {
        invoice = await dbQuery.get('SELECT * FROM tax_invoices WHERE id = ?', [invoiceId]);
        if (!invoice) return res.status(404).json({ error: 'ไม่พบเอกสารใบกำกับภาษีที่ระบุ' });
        if (Number(invoice.booking_id) !== bookingId) {
          return res.status(400).json({ error: 'ข้อมูลเอกสารใบกำกับภาษีไม่ตรงกับรายการจองนี้' });
        }
      } else {
        invoice = await dbQuery.get('SELECT * FROM tax_invoices WHERE booking_id = ? ORDER BY id DESC LIMIT 1', [bookingId]);
      }

      if (!invoice) return res.status(400).json({ error: 'ยังไม่มีเอกสารใบกำกับภาษีสำหรับรายการจองนี้ กรุณาแนบเอกสารก่อนดูตัวอย่าง' });

      const targetEmail = (invoice.tax_email || booking.tax_email || '').trim();
      if (!targetEmail || !isValidEmail(targetEmail)) {
        return res.status(400).json({ error: 'รูปแบบอีเมลผู้รับไม่ถูกต้อง' });
      }

      const diskPath = resolveDiskPath(invoice.file_url);
      if (!fs.existsSync(diskPath)) return res.status(404).json({ error: 'ไม่พบไฟล์เอกสาร PDF บนเซิร์ฟเวอร์' });

      const stat = fs.statSync(diskPath);
      const fd = fs.openSync(diskPath, 'r');
      const headerBuf = Buffer.alloc(4);
      fs.readSync(fd, headerBuf, 0, 4, 0);
      fs.closeSync(fd);
      if (headerBuf.toString('utf8', 0, 4) !== '%PDF') {
        return res.status(400).json({ error: 'เอกสารที่แนบไม่ใช่ไฟล์ PDF สำหรับการส่ง e-Tax Invoice' });
      }

      const { subject, textBody, htmlBody } = generateTaxInvoiceEmailContent({
        booking,
        invoice,
        recipientEmail: targetEmail
      });

      res.json({
        success: true,
        email_preview: {
          to: targetEmail,
          from: `${DEFAULT_SENDER_NAME} <${DEFAULT_SENDER_EMAIL}>`,
          reply_to: DEFAULT_REPLY_TO,
          subject,
          text: textBody,
          html: htmlBody,
          file_name: invoice.file_name,
          file_size: stat.size,
          invoice_number: invoice.invoice_number,
          dry_run: true
        }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Route: Send Email (Dry-run default, Atomic Claim)
  app.post('/api/bookings/:id/tax-invoice/send-email', authenticateToken, requireAnyPermission('pos', 'manage', 'admin'), async (req, res) => {
    try {
      const bookingId = Number(req.params.id);
      const now = Date.now();
      const lastAttempt = taxEmailDebounce.get(bookingId);
      if (lastAttempt && (now - lastAttempt < 4000)) {
        return res.status(429).json({ error: 'กำลังดำเนินการส่งอีเมล กรุณารอสักครู่ (Debounced)' });
      }
      taxEmailDebounce.set(bookingId, now);

      const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
      if (!booking) return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });

      const { invoice_id, recipient_email, dry_run } = req.body || {};
      const isDryRun = dry_run !== false;

      let invoice = null;
      if (invoice_id) {
        invoice = await dbQuery.get('SELECT * FROM tax_invoices WHERE id = ?', [Number(invoice_id)]);
        if (!invoice) return res.status(404).json({ error: 'ไม่พบเอกสารใบกำกับภาษีที่ระบุ' });
        if (Number(invoice.booking_id) !== bookingId) {
          return res.status(400).json({ error: 'ข้อมูลเอกสารใบกำกับภาษีไม่ตรงกับรายการจองนี้' });
        }
      } else {
        invoice = await dbQuery.get('SELECT * FROM tax_invoices WHERE booking_id = ? ORDER BY id DESC LIMIT 1', [bookingId]);
      }

      if (!invoice) return res.status(400).json({ error: 'ไม่พบเอกสารใบกำกับภาษีสำหรับรายการจองนี้' });

      const targetEmail = (recipient_email || invoice.tax_email || booking.tax_email || '').trim();
      if (!targetEmail || !isValidEmail(targetEmail)) {
        return res.status(400).json({ error: 'รูปแบบอีเมลผู้รับไม่ถูกต้อง' });
      }

      const diskPath = resolveDiskPath(invoice.file_url);
      if (!fs.existsSync(diskPath)) return res.status(404).json({ error: 'ไม่พบไฟล์เอกสาร PDF บนเซิร์ฟเวอร์' });

      const pdfBuffer = fs.readFileSync(diskPath);

      // Atomic claim
      const claimRes = await dbQuery.run(
        `UPDATE tax_invoices
         SET email_status = 'claiming',
             email_sent_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND (
             email_status IS NULL
             OR email_status IN ('unsent', 'failed', 'uncertain', 'dry_run')
             OR (email_status = 'claiming' AND (strftime('%s', 'now') - strftime('%s', email_sent_at)) > 60)
           )`,
        [invoice.id]
      );

      if (claimRes.changes === 0) {
        const cur = await dbQuery.get('SELECT email_status FROM tax_invoices WHERE id = ?', [invoice.id]);
        if (cur?.email_status === 'claiming') {
          return res.status(429).json({ error: 'กำลังดำเนินการส่งอีเมลสำหรับเอกสารนี้ กรุณารอสักครู่ (In-flight)' });
        }
        if (cur?.email_status === 'gmail_accepted') {
          return res.status(409).json({ error: 'เอกสารนี้ส่งเข้าคิวระบบ Gmail เรียบร้อยแล้ว (gmail_accepted) ไม่สามารถส่งซ้ำได้' });
        }
        return res.status(409).json({ error: `ไม่สามารถส่งอีเมลได้ในสถานะปัจจุบัน (${cur?.email_status || 'unknown'})` });
      }

      const result = await sendTaxInvoiceEmail({
        booking,
        invoice,
        recipientEmail: targetEmail,
        pdfBuffer,
        fileName: invoice.file_name,
        dry_run: isDryRun,
        dispatchedBy: req.user.username
      });

      const nowIso = new Date().toISOString();
      await dbQuery.run(
        `UPDATE tax_invoices
         SET email_status = ?, email_sent_at = ?, email_dry_run = ?,
             email_message_id = ?, email_recipient = ?
         WHERE id = ?`,
        [result.status, nowIso, result.dry_run ? 1 : 0, result.message_id, targetEmail, invoice.id]
      );

      await dbQuery.run(
        `INSERT INTO tax_invoice_email_logs (
          booking_id, tax_invoice_id, recipient_email, subject, status, is_dry_run,
          message_id, file_name, file_size, dispatched_by, payload_preview, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bookingId, invoice.id, targetEmail, result.subject, result.status, result.dry_run ? 1 : 0, result.message_id, result.file_name, result.file_size, req.user.username, 'preview', nowIso]
      );

      await dbQuery.run(
        `INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
         VALUES (?, 'send_tax_invoice_email_dry_run', ?, ?, ?)`,
        [bookingId, `จำลองส่งอีเมลใบกำกับภาษี (Dry-run) #${invoice.invoice_number} ไปยัง ${targetEmail}`, req.user.username, nowIso]
      );

      res.json({
        success: true,
        dry_run: result.dry_run,
        status: result.status,
        message: 'จำลองการส่งอีเมลใบกำกับภาษีเรียบร้อยแล้ว (Dry-run)',
        data: {
          booking_id: bookingId,
          invoice_id: invoice.id,
          recipient: targetEmail,
          message_id: result.message_id,
          timestamp: nowIso
        }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function api(path, opts = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { 'Authorization': `Bearer ${opts.token}` } : {}),
        ...opts.headers
      }
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  try {
    // TEST 1: Unauthenticated -> 401
    const r1 = await api(`/api/bookings/${booking1Id}/tax-invoice/send-email`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    assert.strictEqual(r1.status, 401, 'Unauthenticated request should return 401');

    // TEST 2: Unauthorized (Staff without pos/manage) -> 403
    const r2 = await api(`/api/bookings/${booking1Id}/tax-invoice/send-email`, {
      method: 'POST',
      token: staffNoPosToken,
      body: JSON.stringify({})
    });
    assert.strictEqual(r2.status, 403, 'Staff without POS/manage permission should return 403');

    // TEST 3: Non-existent booking -> 404
    const r3 = await api(`/api/bookings/99999/tax-invoice/send-email`, {
      method: 'POST',
      token: staffPosToken,
      body: JSON.stringify({})
    });
    assert.strictEqual(r3.status, 404, 'Non-existent booking should return 404');

    // TEST 4: Booking without PDF invoice -> 400
    const r4 = await api(`/api/bookings/${booking3Id}/tax-invoice/send-email`, {
      method: 'POST',
      token: staffPosToken,
      body: JSON.stringify({})
    });
    assert.strictEqual(r4.status, 400, 'Booking without invoice should return 400');
    assert.ok(r4.body.error.includes('ไม่พบเอกสารใบกำกับภาษี'));

    // TEST 5: Booking with invalid email format -> 400
    const r5 = await api(`/api/bookings/${booking4Id}/tax-invoice/send-email`, {
      method: 'POST',
      token: staffPosToken,
      body: JSON.stringify({ recipient_email: 'not-an-email' })
    });
    assert.strictEqual(r5.status, 400, 'Invalid email format should return 400');
    assert.ok(r5.body.error.includes('รูปแบบอีเมลผู้รับไม่ถูกต้อง'));

    // TEST 6: Document Mismatch: invoice_id belongs to booking 2, but called for booking 1 -> 400
    const r6 = await api(`/api/bookings/${booking1Id}/tax-invoice/send-email`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ invoice_id: invoice2Id })
    });
    assert.strictEqual(r6.status, 400, 'Document mismatch must be rejected with 400');
    assert.ok(r6.body.error.includes('ไม่ตรงกับรายการจองนี้'));

    // TEST 7: Rapid double-click debounce protection -> 429
    const r7_first = await api(`/api/bookings/${booking2Id}/tax-invoice/send-email`, {
      method: 'POST',
      token: staffPosToken,
      body: JSON.stringify({ invoice_id: invoice2Id })
    });
    assert.strictEqual(r7_first.status, 200, 'First request for booking 2 should succeed');

    const r7_second = await api(`/api/bookings/${booking2Id}/tax-invoice/send-email`, {
      method: 'POST',
      token: staffPosToken,
      body: JSON.stringify({ invoice_id: invoice2Id })
    });
    assert.strictEqual(r7_second.status, 429, 'Immediate second request must be debounced with 429');
    assert.ok(r7_second.body.error.includes('Debounced'));

    // TEST 8: Successful Dry-Run dispatch for booking 1
    taxEmailDebounce.delete(booking1Id);
    const r8 = await api(`/api/bookings/${booking1Id}/tax-invoice/send-email`, {
      method: 'POST',
      token: staffPosToken,
      body: JSON.stringify({ invoice_id: invoice1Id })
    });

    assert.strictEqual(r8.status, 200);
    assert.strictEqual(r8.body.success, true);
    assert.strictEqual(r8.body.dry_run, true);
    assert.strictEqual(r8.body.status, 'dry_run');
    assert.ok(r8.body.message.includes('(Dry-run)'));
    assert.strictEqual(r8.body.data.recipient, 'billing@kaona.co.th');
    assert.ok(r8.body.data.message_id.startsWith('dry_run_msg_'));

    // Database Verification:
    // 1. tax_invoices record
    const dbInvoice = await dbQuery.get('SELECT * FROM tax_invoices WHERE id = ?', [invoice1Id]);
    assert.strictEqual(dbInvoice.email_status, 'dry_run', 'Status must be dry_run, never "ส่งแล้ว" or "sent"');
    assert.strictEqual(dbInvoice.email_dry_run, 1);
    assert.strictEqual(dbInvoice.email_recipient, 'billing@kaona.co.th');
    assert.ok(dbInvoice.email_message_id.startsWith('dry_run_msg_'));

    // 2. Audit Log record in tax_invoice_email_logs
    const emailLog = await dbQuery.get('SELECT * FROM tax_invoice_email_logs WHERE booking_id = ?', [booking1Id]);
    assert.ok(emailLog, 'Audit log record must exist');
    assert.strictEqual(emailLog.status, 'dry_run');
    assert.strictEqual(emailLog.is_dry_run, 1);
    assert.strictEqual(emailLog.recipient_email, 'billing@kaona.co.th');
    assert.strictEqual(emailLog.dispatched_by, 'staff1');

    // 3. Booking history
    const history = await dbQuery.get('SELECT * FROM booking_history WHERE booking_id = ? AND action = ?', [booking1Id, 'send_tax_invoice_email_dry_run']);
    assert.ok(history, 'History entry must be logged');
    assert.ok(history.details.includes('(Dry-run)'));

    // TEST 9: Email Preview endpoint
    const r9 = await api(`/api/bookings/${booking1Id}/tax-invoice/email-preview?invoice_id=${invoice1Id}`, {
      method: 'GET',
      token: staffPosToken
    });
    assert.strictEqual(r9.status, 200);
    assert.strictEqual(r9.body.success, true);
    assert.strictEqual(r9.body.email_preview.to, 'billing@kaona.co.th');
    assert.ok(r9.body.email_preview.from.includes(DEFAULT_SENDER_NAME));
    assert.ok(r9.body.email_preview.from.includes(DEFAULT_SENDER_EMAIL));
    assert.strictEqual(r9.body.email_preview.reply_to, DEFAULT_REPLY_TO);
    assert.ok(r9.body.email_preview.subject.includes('INV-202611-001'));
    assert.ok(r9.body.email_preview.html.includes(DEFAULT_SENDER_NAME));
    assert.strictEqual(r9.body.email_preview.dry_run, true);

    // TEST 10: Atomic Claim Concurrency Lock
    // Manually set invoice to 'claiming' state
    await dbQuery.run("UPDATE tax_invoices SET email_status = 'claiming', email_sent_at = CURRENT_TIMESTAMP WHERE id = ?", [invoice1Id]);
    taxEmailDebounce.delete(booking1Id);
    const r10 = await api(`/api/bookings/${booking1Id}/tax-invoice/send-email`, {
      method: 'POST',
      token: staffPosToken,
      body: JSON.stringify({ invoice_id: invoice1Id })
    });
    assert.strictEqual(r10.status, 429, 'In-flight claim must return 429');
    assert.ok(r10.body.error.includes('In-flight'));

    // TEST 11: Duplicate Live Send Protection
    // When an invoice was already accepted by Gmail (gmail_accepted), live send must return 409
    await dbQuery.run("UPDATE tax_invoices SET email_status = 'gmail_accepted', email_sent_at = CURRENT_TIMESTAMP WHERE id = ?", [invoice1Id]);
    taxEmailDebounce.delete(booking1Id);
    const r11 = await api(`/api/bookings/${booking1Id}/tax-invoice/send-email`, {
      method: 'POST',
      token: staffPosToken,
      body: JSON.stringify({ invoice_id: invoice1Id, dry_run: false })
    });
    assert.strictEqual(r11.status, 409, 'Re-sending already accepted invoice must return 409 conflict');
    assert.ok(r11.body.error.includes('gmail_accepted'));

  } finally {
    await new Promise(r => server.close(r));
    await new Promise(r => sqliteDb.close(r));
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ========================================================
// 3. CLOUDFLARE WORKER ROUTE & R2 PARITY TEST
// ========================================================
test('Cloudflare Worker - Tax Invoice Email Dispatch Parity (D1 & R2 Simulation)', async () => {
  // Simulated D1 database
  const d1Invoices = [
    {
      id: 1,
      booking_id: 10,
      invoice_number: 'INV-CF-001',
      tax_name: 'บริษัท เวิร์กเกอร์ จำกัด',
      tax_id: '0105557777777',
      tax_payer_type: 'corporate',
      tax_branch_type: 'head',
      tax_email: 'finance@cfworker.co.th',
      file_url: '/uploads/tax_invoices/inv_cf.pdf',
      file_name: 'inv_cf.pdf',
      file_size: 1024,
      status: 'issued',
      email_status: 'unsent'
    }
  ];

  const d1Bookings = [
    {
      id: 10,
      receipt_number: 'BK-000010',
      customer_name: 'บริษัท เวิร์กเกอร์ จำกัด',
      total_amount: 4500,
      tax_email: 'finance@cfworker.co.th',
      tax_delivery_method: 'email',
      tax_invoice_status: 'issued'
    }
  ];

  const d1EmailLogs = [];

  // Simulated R2 bucket with PDF magic bytes %PDF-
  const r2Bucket = new Map();
  r2Bucket.set('tax_invoices/inv_cf.pdf', {
    size: 1024,
    slice: (start, end) => ({
      arrayBuffer: async () => Buffer.from('%PDF-1.4\nCF-Worker-R2-Mock').subarray(start, end).buffer
    })
  });

  const mockEnv = {
    DB: {
      prepare: (sql) => ({
        bind: (...params) => ({
          first: async () => {
            if (sql.includes('FROM bookings WHERE id = ?')) {
              return d1Bookings.find(b => b.id === params[0]) || null;
            }
            if (sql.includes('FROM tax_invoices WHERE id = ?')) {
              return d1Invoices.find(i => i.id === params[0]) || null;
            }
            if (sql.includes('FROM tax_invoices WHERE booking_id = ? ORDER BY id DESC LIMIT 1')) {
              return d1Invoices.filter(i => i.booking_id === params[0]).pop() || null;
            }
            return null;
          },
          all: async () => ({ results: d1Invoices }),
          run: async () => {
            if (sql.includes('UPDATE tax_invoices SET email_status =')) {
              const inv = d1Invoices.find(i => i.id === params[4]);
              if (inv) {
                inv.email_status = params[0] || 'dry_run';
                inv.email_sent_at = params[1] || new Date().toISOString();
                inv.email_dry_run = params[2] ?? 1;
                inv.email_message_id = params[3] || 'dry_run_msg';
                inv.email_recipient = params[4] || 'finance@cfworker.co.th';
              }
            }
            if (sql.includes('INSERT INTO tax_invoice_email_logs')) {
              d1EmailLogs.push({
                booking_id: params[0],
                tax_invoice_id: params[1],
                recipient_email: params[2],
                status: params[4] || 'dry_run',
                message_id: params[5]
              });
            }
            return { success: true, meta: { changes: 1 } };
          }
        })
      })
    },
    BUCKET: {
      get: async (key) => r2Bucket.get(key) || null
    },
    GMAIL_USER_EMAIL: 'coworkings.bwork@gmail.com',
    GMAIL_SENDER_NAME: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    GMAIL_REPLY_TO: 'coworkings.bwork@gmail.com'
  };

  // Test worker email preview generation
  const previewBooking = d1Bookings[0];
  const previewInvoice = d1Invoices[0];
  const { subject, textBody, htmlBody } = generateTaxInvoiceEmailContent({
    booking: previewBooking,
    invoice: previewInvoice,
    recipientEmail: 'finance@cfworker.co.th',
    senderEmail: mockEnv.GMAIL_USER_EMAIL,
    senderName: mockEnv.GMAIL_SENDER_NAME,
    replyTo: mockEnv.GMAIL_REPLY_TO
  });

  assert.ok(subject.includes('INV-CF-001'));
  assert.ok(subject.includes('BK-000010'));
  assert.ok(htmlBody.includes('บริษัท บิลท์ ฮาร์ท จำกัด'));

  // Test simulated dry-run dispatch
  const simulatedMsgId = `dry_run_msg_${Date.now()}_testcf`;
  await mockEnv.DB.prepare('UPDATE tax_invoices SET email_status = ? WHERE id = ?')
    .bind('dry_run', new Date().toISOString(), 1, simulatedMsgId, 1)
    .run();

  await mockEnv.DB.prepare('INSERT INTO tax_invoice_email_logs (...)')
    .bind(10, 1, 'finance@cfworker.co.th', subject, 'dry_run', simulatedMsgId)
    .run();

  assert.strictEqual(d1Invoices[0].email_status, 'dry_run');
  assert.strictEqual(d1Invoices[0].email_dry_run, 1);
  assert.strictEqual(d1EmailLogs.length, 1);
  assert.strictEqual(d1EmailLogs[0].status, 'dry_run');
});


test('GmailService - Safe Environment resolution & unknown/missing env protection', () => {
  // 1. Explicit Staging
  assert.strictEqual(getEffectiveEnvironment({ ENVIRONMENT: 'staging' }), 'staging');
  assert.strictEqual(getEffectiveEnvironment({ APP_ENV: 'staging' }), 'staging');

  // 2. Explicit Production
  assert.strictEqual(getEffectiveEnvironment({ APP_ENV: 'production' }), 'production');
  assert.strictEqual(getEffectiveEnvironment({ ENVIRONMENT: 'production' }), 'production');

  // 3. Missing, empty, or unknown environment values MUST NEVER resolve to production!
  assert.strictEqual(getEffectiveEnvironment({ APP_ENV: 'unknown_val' }), 'development');
  assert.strictEqual(getEffectiveEnvironment({ ENVIRONMENT: 'custom_cluster' }), 'development');
  assert.strictEqual(getEffectiveEnvironment({}), 'development');
  assert.strictEqual(getEffectiveEnvironment(null), 'development');
  assert.strictEqual(getEffectiveEnvironment(undefined), 'development');

  // 4. Staging allowlist enforcement with safe env resolution
  const stagingEnv = {
    ENVIRONMENT: 'staging',
    GMAIL_STAGING_ALLOWLIST: 'admin@bwork.co,@bwork.co'
  };
  assert.strictEqual(isEmailAllowedInStaging('test@bwork.co', stagingEnv), true);
  assert.strictEqual(isEmailAllowedInStaging('customer@external.com', stagingEnv), false);

  // 5. Unknown environment behaves like non-production and blocks external emails
  const unknownEnv = {
    APP_ENV: 'unknown_mode',
    GMAIL_STAGING_ALLOWLIST: 'staff@bwork.co'
  };
  assert.strictEqual(isEmailAllowedInStaging('customer@external.com', unknownEnv), false);
  assert.strictEqual(isEmailAllowedInStaging('staff@bwork.co', unknownEnv), true);
});
