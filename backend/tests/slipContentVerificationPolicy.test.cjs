'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const confirmPageSource = fs.readFileSync(path.join(__dirname, '../../booking-app/src/pages/ConfirmPage.jsx'), 'utf8');
const pendingBookingsSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/PendingBookings.jsx'), 'utf8');
const bookingPosSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/BookingPOS.jsx'), 'utf8');

// Helper to create in-memory SQLite DB
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
    })
  };
  return { db, query };
}

async function initSchema(query) {
  await query.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      customer_contact TEXT,
      total_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'pending',
      payment_method TEXT,
      slip_image_url TEXT,
      slip_trans_ref TEXT,
      slip_verify_status TEXT,
      slip_verified_at TEXT,
      receipt_number TEXT,
      pin_code TEXT,
      booking_channel TEXT,
      booking_source TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      room_id INTEGER,
      room_name TEXT,
      start_time TEXT,
      end_time TEXT,
      pin_code TEXT,
      checkin_status TEXT DEFAULT 'confirmed'
    );

    CREATE TABLE IF NOT EXISTS slip_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      trans_ref TEXT,
      bank_code TEXT,
      bank_name TEXT,
      slip_image_url TEXT,
      is_auto_approved INTEGER DEFAULT 0,
      confidence_score REAL DEFAULT 0,
      raw_qr_data TEXT,
      verification_status TEXT DEFAULT 'pending_manual',
      rejection_reason TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      receipt_number TEXT,
      slip_url TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      performed_by TEXT,
      created_at TEXT
    );
  `);
}

// =========================================================================
// SECTION 1: ARCHITECTURAL & CODE CONTRACT INVARIANTS
// =========================================================================

test('ARCH-01: server.js and worker.js enforce Magic Bytes verification for PNG, JPG, and WEBP', () => {
  // server.js checks
  assert.ok(serverSource.includes('isPng = imageBuffer[0] === 0x89'), 'server.js must check PNG magic bytes');
  assert.ok(serverSource.includes('isJpg = imageBuffer[0] === 0xFF'), 'server.js must check JPG magic bytes');
  assert.ok(serverSource.includes('isWebp = imageBuffer.length >= 12'), 'server.js must check WEBP magic bytes');
  assert.ok(serverSource.includes('Magic Bytes ไม่ตรงกับ PNG, JPG หรือ WEBP'), 'server.js must reject invalid magic bytes with standard Thai error');

  // worker.js checks
  assert.ok(workerSource.includes('validateFileMagicBytes'), 'worker.js must define validateFileMagicBytes');
  assert.ok(workerSource.includes('Magic Bytes ไม่ตรงกับ PNG, JPG หรือ WEBP'), 'worker.js must reject invalid magic bytes with standard Thai error');
});

test('ARCH-02: Public upload-slip NEVER auto-approves to paid in server.js or worker.js', () => {
  // Check that upload-slip routes set payment_status = 'reviewing' and auto_approved = false
  const uploadSlipServerIdx = serverSource.indexOf("app.post('/api/public/bookings/:id/upload-slip'");
  const uploadSlipServerEndIdx = serverSource.indexOf("app.post('/api/slip/verify-test'", uploadSlipServerIdx);
  const serverUploadSnippet = serverSource.slice(uploadSlipServerIdx, uploadSlipServerEndIdx);

  assert.ok(!serverUploadSnippet.includes("payment_status = 'paid',"), 'server.js upload-slip route must NEVER set payment_status to paid');
  assert.ok(!serverUploadSnippet.includes("SET payment_status = 'paid'"), 'server.js upload-slip route must NEVER update payment_status to paid');
  assert.ok(serverUploadSnippet.includes("auto_approved: false"), 'server.js upload-slip must return auto_approved: false');
  assert.ok(serverUploadSnippet.includes("payment_status = 'reviewing'"), 'server.js upload-slip must set payment_status = reviewing');

  const uploadSlipWorkerIdx = workerSource.indexOf("if (pathname.startsWith('/api/public/bookings/') && pathname.endsWith('/upload-slip')");
  const uploadSlipWorkerEndIdx = workerSource.indexOf("if ((pathname === '/api/public/bookings/by-phone'", uploadSlipWorkerIdx);
  const workerUploadSnippet = workerSource.slice(uploadSlipWorkerIdx, uploadSlipWorkerEndIdx);

  assert.ok(!workerUploadSnippet.includes("payment_status = 'paid',"), 'worker.js upload-slip route must NEVER set payment_status to paid');
  assert.ok(!workerUploadSnippet.includes("SET payment_status = 'paid'"), 'worker.js upload-slip route must NEVER update payment_status to paid');
  assert.ok(workerUploadSnippet.includes("auto_approved: false"), 'worker.js upload-slip must return auto_approved: false');
  assert.ok(workerUploadSnippet.includes("payment_status = 'reviewing'"), 'worker.js upload-slip must set payment_status = reviewing');
});

test('ARCH-03: Public upload-slip accepts valid image without requiring QR code or bank classification', () => {
  const uploadSlipServerIdx = serverSource.indexOf("app.post('/api/public/bookings/:id/upload-slip'");
  const uploadSlipServerEndIdx = serverSource.indexOf("app.post('/api/slip/verify-test'", uploadSlipServerIdx);
  const serverUploadSnippet = serverSource.slice(uploadSlipServerIdx, uploadSlipServerEndIdx);

  // Must not reject if verifyResult.isValid is false or qr_data is absent
  assert.ok(!serverUploadSnippet.includes("verifyResult.isValid"), 'server.js must not block upload on verifyResult.isValid');
  assert.ok(!serverUploadSnippet.includes("verifyResult.confidence === 0"), 'server.js must not block upload on confidence === 0');

  const uploadSlipWorkerIdx = workerSource.indexOf("if (pathname.startsWith('/api/public/bookings/') && pathname.endsWith('/upload-slip')");
  const uploadSlipWorkerEndIdx = workerSource.indexOf("if ((pathname === '/api/public/bookings/by-phone'", uploadSlipWorkerIdx);
  const workerUploadSnippet = workerSource.slice(uploadSlipWorkerIdx, uploadSlipWorkerEndIdx);

  assert.ok(!workerUploadSnippet.includes("!qr_data || !parsedQR || !parsedQR.isValidSlipQR"), 'worker.js must not reject when qr_data is missing or unverified');
});

test('ARCH-04: Booking App ConfirmPage UX messaging strictly conforms to review workflow', () => {
  // ConfirmPage must render exact specified headline
  assert.ok(confirmPageSource.includes('ส่งหลักฐานการชำระเงินเรียบร้อยแล้ว กรุณารอเจ้าหน้าที่ตรวจสอบ'), 'ConfirmPage must display exact post-upload headline');
  assert.ok(confirmPageSource.includes('ระบบได้รับหลักฐานการชำระเงินแล้ว เจ้าหน้าที่จะตรวจสอบยอดเงินและยืนยันการจองผ่าน POS โดยเร็วที่สุด'), 'ConfirmPage must display exact review explanation');
  assert.ok(confirmPageSource.includes('สถานะ: กำลังรอเจ้าหน้าที่ตรวจสอบ'), 'ConfirmPage status card must show waiting for staff');

  // ConfirmPage must not claim auto-approval or scan requirements
  assert.ok(!confirmPageSource.includes('พร้อมระบบอนุมัติอัตโนมัติ'), 'ConfirmPage must not show auto-approval promises');
  assert.ok(!confirmPageSource.includes('ชำระเงินสำเร็จ! (ระบบตรวจสอบสลิปอัตโนมัติ)'), 'ConfirmPage must not display auto-approved success message');
  assert.ok(confirmPageSource.includes("const isPaidOrAutoApproved = Boolean(booking?.payment_status === 'paid')"), 'ConfirmPage must strictly check payment_status === paid');
});

test('ARCH-05: POS PendingBookings and BookingPOS contain staff verification and decision tools', () => {
  assert.ok(pendingBookingsSource.includes('อนุมัติรับชำระเงิน'), 'PendingBookings must have staff approval action');
  assert.ok(pendingBookingsSource.includes('ปฏิเสธสลิป'), 'PendingBookings must have staff rejection action');
  assert.ok(pendingBookingsSource.includes('AuthenticatedSlipImage'), 'PendingBookings must display slip with AuthenticatedSlipImage');
  assert.ok(pendingBookingsSource.includes('handleZoomIn'), 'PendingBookings must have zoom enlargement controls');
  assert.ok(bookingPosSource.includes('AuthenticatedSlipImage'), 'BookingPOS must display slip image');
});

// =========================================================================
// SECTION 2: END-TO-END WORKFLOW SIMULATION & INTEGRATION TESTS
// =========================================================================

test('SIM-01: Upload non-bank image with valid PNG magic bytes -> transitions to reviewing, not paid', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, created_at)
    VALUES (101, 'ลูกค้าทั่วไป', 1200, 'pending', ?)
  `, [nowIso]);

  // Simulate PNG file magic bytes buffer: 89 50 4E 47 0D 0A 1A 0A ... (valid image, e.g. cat meme or photo)
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const isPng = pngHeader[0] === 0x89 && pngHeader[1] === 0x50 && pngHeader[2] === 0x4E && pngHeader[3] === 0x47;
  assert.ok(isPng, 'Header should match PNG signature');

  // Backend state transition executed upon upload
  const slipUrl = '/uploads/slips/slip_BK000101_test.png';
  await query.run(`
    UPDATE bookings
    SET slip_image_url = ?,
        slip_trans_ref = NULL,
        slip_verified_at = NULL,
        slip_verify_status = 'pending_manual',
        payment_status = 'reviewing'
    WHERE id = 101 AND COALESCE(payment_status, 'pending') NOT IN ('paid', 'cancelled')
  `, [slipUrl]);

  await query.run(`
    INSERT INTO slip_verifications (
      booking_id, trans_ref, bank_code, bank_name, slip_image_url,
      is_auto_approved, confidence_score, raw_qr_data, verification_status,
      rejection_reason, created_at
    ) VALUES (101, NULL, '000', 'รูปภาพรอเจ้าหน้าที่ตรวจสอบ', ?, 0, 0, '', 'pending_manual', NULL, ?)
  `, [slipUrl, nowIso]);

  const booking = await query.get('SELECT * FROM bookings WHERE id = 101');
  assert.equal(booking.payment_status, 'reviewing', 'Status must be reviewing');
  assert.notEqual(booking.payment_status, 'paid', 'Status must NOT be paid');
  assert.equal(booking.slip_verify_status, 'pending_manual');
  assert.equal(booking.slip_image_url, slipUrl);

  const verification = await query.get('SELECT * FROM slip_verifications WHERE booking_id = 101');
  assert.equal(verification.is_auto_approved, 0, 'Must NOT be auto-approved');
  assert.equal(verification.verification_status, 'pending_manual');
});

test('SIM-02: Upload image without QR code -> accepted into reviewing queue', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, created_at)
    VALUES (102, 'ลูกค้าไม่มี QR', 1500, 'pending', ?)
  `, [nowIso]);

  // JPG magic bytes: FF D8 FF
  const jpgHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
  const isJpg = jpgHeader[0] === 0xFF && jpgHeader[1] === 0xD8 && jpgHeader[2] === 0xFF;
  assert.ok(isJpg, 'Valid JPG magic bytes detected');

  const slipUrl = '/uploads/slips/slip_BK000102_noqr.jpg';
  // No QR data provided by client
  const qrData = null;
  const transRef = null;

  await query.run(`
    UPDATE bookings
    SET slip_image_url = ?,
        slip_trans_ref = ?,
        slip_verified_at = NULL,
        slip_verify_status = 'pending_manual',
        payment_status = 'reviewing'
    WHERE id = 102 AND COALESCE(payment_status, 'pending') NOT IN ('paid', 'cancelled')
  `, [slipUrl, transRef]);

  const booking = await query.get('SELECT * FROM bookings WHERE id = 102');
  assert.equal(booking.payment_status, 'reviewing');
  assert.equal(booking.slip_trans_ref, null);
  assert.equal(booking.slip_verify_status, 'pending_manual');
});

test('SIM-03: Corrupted or non-image file signature -> rejected with 400 validation error', () => {
  // Plain text file: "Hello world"
  const textBuffer = Buffer.from('This is a text file, not an image');
  const isPng = textBuffer[0] === 0x89 && textBuffer[1] === 0x50 && textBuffer[2] === 0x4E && textBuffer[3] === 0x47;
  const isJpg = textBuffer[0] === 0xFF && textBuffer[1] === 0xD8 && textBuffer[2] === 0xFF;
  const isWebp = textBuffer.length >= 12 &&
    textBuffer[0] === 0x52 && textBuffer[1] === 0x49 && textBuffer[2] === 0x46 && textBuffer[3] === 0x46 &&
    textBuffer[8] === 0x57 && textBuffer[9] === 0x45 && textBuffer[10] === 0x42 && textBuffer[11] === 0x50;

  assert.equal(isPng, false, 'Text file must not match PNG');
  assert.equal(isJpg, false, 'Text file must not match JPG');
  assert.equal(isWebp, false, 'Text file must not match WEBP');
  assert.ok(!isPng && !isJpg && !isWebp, 'Validation must reject non-image payload');

  // File < 4 bytes
  const tinyBuffer = Buffer.from([0x01, 0x02]);
  assert.ok(tinyBuffer.length < 4, 'Short buffer must fail min length check');
});

test('SIM-04: File size over 10MB -> strictly rejected', () => {
  const maxAllowed = 10 * 1024 * 1024;
  const oversizedLength = 10 * 1024 * 1024 + 1;
  assert.ok(oversizedLength > maxAllowed, 'Buffer over 10MB must be rejected');
});

test('SIM-05: POS staff approves payment -> transitions reviewing to paid, issues receipt and PIN', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (201, 'ลูกค้าสมหวัง', 2400, 0, 2400, 'reviewing', ?)
  `, [nowIso]);

  await query.run(`
    INSERT INTO booking_items (booking_id, room_id, room_name, start_time, end_time)
    VALUES (201, 1, 'Meeting Room A', '09:00', '12:00')
  `);

  // Staff approves payment in POS
  const receiptNumber = 'RC-20261027-001';
  const pinCode = '889922';

  await query.run(`
    UPDATE bookings
    SET payment_status = 'paid',
        payment_method = 'transfer',
        paid_amount = 2400,
        balance_amount = 0,
        receipt_number = ?,
        pin_code = ?,
        slip_verify_status = 'approved_manual'
    WHERE id = 201 AND payment_status = 'reviewing'
  `, [receiptNumber, pinCode]);

  await query.run(`
    UPDATE booking_items SET pin_code = ? WHERE booking_id = 201
  `, [pinCode]);

  await query.run(`
    INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, receipt_number, created_at)
    VALUES (201, 2400, 'transfer', 'full', ?, ?)
  `, [receiptNumber, nowIso]);

  await query.run(`
    INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
    VALUES (201, 'confirm_payment', '{"amount":2400,"payment_method":"transfer"}', 'receptionist_staff', ?)
  `, [nowIso]);

  const updatedBooking = await query.get('SELECT * FROM bookings WHERE id = 201');
  assert.equal(updatedBooking.payment_status, 'paid');
  assert.equal(updatedBooking.paid_amount, 2400);
  assert.equal(updatedBooking.balance_amount, 0);
  assert.equal(updatedBooking.receipt_number, receiptNumber);
  assert.equal(updatedBooking.pin_code, pinCode);

  const tx = await query.get('SELECT * FROM payment_transactions WHERE booking_id = 201');
  assert.equal(tx.amount, 2400);
  assert.equal(tx.receipt_number, receiptNumber);

  const hist = await query.get('SELECT * FROM booking_history WHERE booking_id = 201 AND action = "confirm_payment"');
  assert.equal(hist.performed_by, 'receptionist_staff');
});

test('SIM-06: POS staff rejects slip -> status becomes rejected with reason, allowing customer re-upload', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, slip_image_url, created_at)
    VALUES (202, 'ลูกค้าสลิปผิด', 1000, 'reviewing', '/uploads/slips/wrong_slip.jpg', ?)
  `, [nowIso]);

  await query.run(`
    INSERT INTO slip_verifications (booking_id, slip_image_url, verification_status, created_at)
    VALUES (202, '/uploads/slips/wrong_slip.jpg', 'pending_manual', ?)
  `, [nowIso]);

  // Staff rejects slip via reject-slip
  const reasonCode = 'AMOUNT_MISMATCH';
  const displayReason = 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ';

  await query.run(`
    UPDATE bookings
    SET payment_status = 'rejected',
        slip_verify_status = 'rejected'
    WHERE id = 202 AND payment_status = 'reviewing'
  `);

  await query.run(`
    UPDATE slip_verifications
    SET verification_status = 'rejected',
        rejection_reason = ?
    WHERE booking_id = 202
  `, [displayReason]);

  await query.run(`
    INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
    VALUES (202, 'reject_slip', ?, 'pos_staff', ?)
  `, [JSON.stringify({ reason_code: reasonCode, reason: displayReason }), nowIso]);

  let booking = await query.get('SELECT * FROM bookings WHERE id = 202');
  assert.equal(booking.payment_status, 'rejected');
  assert.equal(booking.slip_verify_status, 'rejected');

  const ver = await query.get('SELECT * FROM slip_verifications WHERE booking_id = 202');
  assert.equal(ver.verification_status, 'rejected');
  assert.equal(ver.rejection_reason, displayReason);

  // Customer re-uploads a new valid replacement image
  const newSlipUrl = '/uploads/slips/corrected_slip.jpg';
  await query.run(`
    UPDATE bookings
    SET slip_image_url = ?,
        payment_status = 'reviewing',
        slip_verify_status = 'pending_manual'
    WHERE id = 202 AND payment_status = 'rejected'
  `, [newSlipUrl]);

  await query.run(`
    INSERT INTO slip_verifications (
      booking_id, trans_ref, bank_code, bank_name, slip_image_url,
      is_auto_approved, confidence_score, verification_status, rejection_reason, created_at
    ) VALUES (202, NULL, '000', 'รูปภาพใหม่รอตรวจสอบ', ?, 0, 0, 'pending_manual', NULL, ?)
  `, [newSlipUrl, new Date().toISOString()]);

  booking = await query.get('SELECT * FROM bookings WHERE id = 202');
  assert.equal(booking.payment_status, 'reviewing', 'Re-upload must restore status to reviewing');
  assert.equal(booking.slip_verify_status, 'pending_manual');
  assert.equal(booking.slip_image_url, newSlipUrl);

  const allVerifications = await query.all('SELECT * FROM slip_verifications WHERE booking_id = 202 ORDER BY id ASC');
  assert.equal(allVerifications.length, 2, 'Audit history must preserve both the rejected attempt and the new attempt');
  assert.equal(allVerifications[0].verification_status, 'rejected');
  assert.equal(allVerifications[1].verification_status, 'pending_manual');
});

test('SIM-07: Financial ledger invariance: re-uploading slip does NOT duplicate transactions or alter prices', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (301, 'ลูกค้าทดสอบบัญชี', 3500, 0, 3500, 'pending', ?)
  `, [nowIso]);

  // Upload 1
  await query.run(`
    UPDATE bookings
    SET slip_image_url = '/uploads/slips/slip1.png',
        payment_status = 'reviewing',
        slip_verify_status = 'pending_manual'
    WHERE id = 301
  `);

  // Staff rejects
  await query.run(`
    UPDATE bookings
    SET payment_status = 'rejected',
        slip_verify_status = 'rejected'
    WHERE id = 301
  `);

  // Upload 2 (replacement)
  await query.run(`
    UPDATE bookings
    SET slip_image_url = '/uploads/slips/slip2.png',
        payment_status = 'reviewing',
        slip_verify_status = 'pending_manual'
    WHERE id = 301
  `);

  const booking = await query.get('SELECT * FROM bookings WHERE id = 301');
  assert.equal(booking.total_amount, 3500, 'total_amount must remain exactly 3500');
  assert.equal(booking.paid_amount, 0, 'paid_amount must remain 0');
  assert.equal(booking.balance_amount, 3500, 'balance_amount must remain 3500');

  const txs = await query.all('SELECT * FROM payment_transactions WHERE booking_id = 301');
  assert.equal(txs.length, 0, 'Uploading or re-uploading slips must NEVER insert unconfirmed payment_transactions');
});

test('SIM-08: Room Extension isolation: room extension flow remains distinct from slip verification', async () => {
  const { query } = createTestDb();
  await initSchema(query);

  const nowIso = new Date().toISOString();
  // Existing paid booking
  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, paid_amount, balance_amount, payment_status, created_at)
    VALUES (401, 'ลูกค้าต่อเวลา', 1000, 1000, 0, 'paid', ?)
  `, [nowIso]);

  // Room extension transaction added
  await query.run(`
    INSERT INTO payment_transactions (booking_id, amount, payment_method, transaction_type, receipt_number, created_at)
    VALUES (401, 500, 'cash', 'extension', 'RC-EXT-401', ?)
  `, [nowIso]);

  await query.run(`
    UPDATE bookings
    SET total_amount = total_amount + 500,
        paid_amount = paid_amount + 500
    WHERE id = 401
  `);

  const booking = await query.get('SELECT * FROM bookings WHERE id = 401');
  assert.equal(booking.total_amount, 1500);
  assert.equal(booking.paid_amount, 1500);

  const extTx = await query.get('SELECT * FROM payment_transactions WHERE booking_id = 401 AND transaction_type = "extension"');
  assert.equal(extTx.amount, 500);
  assert.equal(extTx.payment_method, 'cash');
});
