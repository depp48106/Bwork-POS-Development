const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'backend', 'database_local_uat.sqlite');
const UPLOADS_DIR = path.join(__dirname, '..', 'backend', 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Generate simple mock 1x1 or small jpeg files for visual display in browser
const mockJpgBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const mockJpgBuffer = Buffer.from(mockJpgBase64, 'base64');

fs.writeFileSync(path.join(UPLOADS_DIR, 'mock_slip_501.jpg'), mockJpgBuffer);
fs.writeFileSync(path.join(UPLOADS_DIR, 'mock_slip_deposit_502.jpg'), mockJpgBuffer);
fs.writeFileSync(path.join(UPLOADS_DIR, 'mock_slip_balance_502.jpg'), mockJpgBuffer);
fs.writeFileSync(path.join(UPLOADS_DIR, 'mock_slip_503.jpg'), mockJpgBuffer);

console.log('Created mock slip images in backend/uploads/');

// Remove old test db if present
if (fs.existsSync(DB_FILE)) {
  fs.unlinkSync(DB_FILE);
  console.log('Removed old database_local_uat.sqlite');
}

// Set DB_PATH environment so database.js binds to database_local_uat.sqlite
process.env.DB_PATH = DB_FILE;
process.env.APP_ENV = 'development';

const { initDatabase, dbQuery, hashPassword } = require('../backend/database');

async function seed() {
  await initDatabase();

  await dbQuery.exec(`
    CREATE TABLE IF NOT EXISTS booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      performed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // Set line_channel_access_token setting for testing
  await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('line_channel_access_token', 'mock_token_for_uat_testing')");
  await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  // 1. Booking #501 for P1 (Reviewing Online Booking ready to reject)
  const time501 = new Date(now.getTime() - 3 * 60 * 1000).toISOString();
  await dbQuery.run(`
    INSERT INTO bookings (
      id, customer_name, customer_email, contact, line_user_id,
      total_amount, subtotal_amount, paid_amount, balance_amount,
      payment_status, slip_verify_status, booking_source,
      receipt_number, slip_image_url, created_at
    ) VALUES (
      501, 'คุณสมชาย ทดสอบ (UAT P1)', 'somchai.uat@example.com', '0812345678', 'U_mock_customer_uat_01',
      600.0, 600.0, 0.0, 600.0,
      'reviewing', 'reviewing', 'online',
      'BK-20261015-0501', '/uploads/mock_slip_501.jpg', ?
    )
  `, [time501]);

  await dbQuery.run(`
    INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, booking_type)
    VALUES (501, 1, '${dateStr}T14:00:00', '${dateStr}T16:00:00', 300.0, 600.0, 'hourly')
  `);

  // 2. Booking #502 for P2 (Walk-in deposit + balance payment with slips)
  const time502 = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  await dbQuery.run(`
    INSERT INTO bookings (
      id, customer_name, contact,
      total_amount, subtotal_amount, paid_amount, balance_amount,
      payment_status, payment_method, booking_source,
      receipt_number, created_at
    ) VALUES (
      502, 'คุณวิภา วอล์คอิน (UAT P2)', '0891112222',
      1000.0, 1000.0, 500.0, 500.0,
      'partial', 'transfer', 'walk-in',
      'BK-20261015-0502', ?
    )
  `, [time502]);

  await dbQuery.run(`
    INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, booking_type)
    VALUES (502, 2, '${dateStr}T10:00:00', '${dateStr}T12:00:00', 500.0, 1000.0, 'hourly')
  `);

  // Deposit transaction for #502
  await dbQuery.run(`
    INSERT INTO payment_transactions (
      id, booking_id, amount, payment_method, transaction_type,
      slip_url, status, created_at
    ) VALUES (
      801, 502, 500.0, 'transfer', 'deposit',
      '/uploads/mock_slip_deposit_502.jpg', 'completed', ?
    )
  `, [time502]);

  // 3. Booking #503 for P3 (Already rejected online booking)
  const time503 = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  await dbQuery.run(`
    INSERT INTO bookings (
      id, customer_name, contact, line_user_id,
      total_amount, subtotal_amount, paid_amount, balance_amount,
      payment_status, slip_verify_status, booking_source,
      receipt_number, slip_image_url, created_at
    ) VALUES (
      503, 'คุณปิยะ สลิปถูกปฏิเสธ (UAT P3)', '0898765432', 'U_mock_customer_uat_03',
      900.0, 900.0, 0.0, 900.0,
      'rejected', 'rejected', 'online',
      'BK-20261015-0503', '/uploads/mock_slip_503.jpg', ?
    )
  `, [time503]);

  await dbQuery.run(`
    INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, booking_type)
    VALUES (503, 1, '${dateStr}T17:00:00', '${dateStr}T20:00:00', 300.0, 900.0, 'hourly')
  `);

  await dbQuery.run(`
    INSERT INTO slip_verifications (
      booking_id, trans_ref, bank_code, bank_name, slip_image_url,
      verification_status, rejection_reason, created_at
    ) VALUES (
      503, 'REJ_503_MOCK', '004', 'ธนาคารกสิกรไทย', '/uploads/mock_slip_503.jpg',
      'rejected', 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ', ?
    )
  `, [time503]);

  await dbQuery.run(`
    INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
    VALUES (503, 'reject_slip', 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ', 'admin', ?)
  `, [time503]);

  await dbQuery.run(`
    INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
    VALUES (503, 'line_reject_notified', 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ', 'system', ?)
  `, [time503]);

  console.log('Seeded UAT test database successfully:');
  console.log('  - Booking #501 (P1 Reviewing -> Rejection testing)');
  console.log('  - Booking #502 (P2 Walk-in with transactions & slips)');
  console.log('  - Booking #503 (P3 Rejected slip status verification)');

  process.exit(0);
}

seed().catch(err => {
  console.error('Failed to setup UAT database:', err);
  process.exit(1);
});
