const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const sqlite3 = require(path.join(__dirname, '../node_modules/sqlite3')).verbose();

const DB_PATH = path.join(__dirname, '../database_dev.sqlite');

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function normalizeBookingDetails(input) {
  if (input === undefined || input === null) return { value: null };
  if (typeof input !== 'string') {
    input = String(input);
  }
  const cleaned = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!cleaned) {
    return { value: null };
  }
  if (cleaned.length > 1000) {
    return { error: 'รายละเอียดเพิ่มเติมต้องมีความยาวไม่เกิน 1,000 ตัวอักษร' };
  }
  return { value: cleaned };
}

test('1. Normalization helper validates length, whitespace, CRLF, and empty value', () => {
  // CRLF conversion & trimming
  const multiline = '  line 1\r\nline 2\rline 3  ';
  const norm1 = normalizeBookingDetails(multiline);
  assert.strictEqual(norm1.value, 'line 1\nline 2\nline 3');

  // Empty string -> null
  assert.strictEqual(normalizeBookingDetails('').value, null);
  assert.strictEqual(normalizeBookingDetails('   \n  \t ').value, null);
  assert.strictEqual(normalizeBookingDetails(null).value, null);
  assert.strictEqual(normalizeBookingDetails(undefined).value, null);

  // Exact 1000 chars -> ok
  const chars1000 = 'A'.repeat(1000);
  assert.strictEqual(normalizeBookingDetails(chars1000).value.length, 1000);

  // 1001 chars -> error
  const chars1001 = 'A'.repeat(1001);
  const normErr = normalizeBookingDetails(chars1001);
  assert.ok(normErr.error && normErr.error.includes('1,000'));
});

test('2. Local End-to-End Test: Create, Read, Edit, Re-fetch, Clear, Verify NULL in local DB', async () => {
  const db = new sqlite3.Database(DB_PATH);

  let testBookingId = null;
  const initialDetails = 'ลูกค้าขอจัดห้องสำหรับวันเกิด\nขอเตรียมไมค์ 2 ตัว และเปิดห้องก่อนเวลา 30 นาที';
  const updatedDetails = 'ลูกค้าขอเปลี่ยนเป็นไมค์ลอย 3 ตัว พร้อมปลั๊กพ่วง 2 จุด';

  try {
    // 1. Create booking with booking_details
    const normCreate = normalizeBookingDetails(initialDetails);
    const insRes = await runQuery(
      db,
      `INSERT INTO bookings (customer_name, contact, total_amount, payment_status, payment_method, booking_details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      ['Test Customer E2E', '0899999999', 500.0, 'pending', 'cash', normCreate.value]
    );
    testBookingId = insRes.id;
    assert.ok(testBookingId > 0, 'Booking inserted with ID');

    // 2. Read booking back & 3. Confirm exact saved multiline value
    const row1 = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    assert.strictEqual(row1.booking_details, initialDetails, 'Details saved accurately with line breaks');

    // 4. Edit details & 5. Refresh/re-fetch
    const normEdit = normalizeBookingDetails(updatedDetails);
    await runQuery(db, 'UPDATE bookings SET booking_details = ? WHERE id = ?', [normEdit.value, testBookingId]);

    // 6. Confirm edit persisted
    const row2 = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    assert.strictEqual(row2.booking_details, updatedDetails, 'Details edit persisted');

    // 7. Clear details
    const normClear = normalizeBookingDetails('   ');
    assert.strictEqual(normClear.value, null, 'Normalized clear value is null');
    await runQuery(db, 'UPDATE bookings SET booking_details = ? WHERE id = ?', [normClear.value, testBookingId]);

    // 8. Confirm DB value becomes NULL
    const row3 = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    assert.strictEqual(row3.booking_details, null, 'Booking details in DB becomes NULL after clearing');

  } finally {
    // Clean up test booking
    if (testBookingId) {
      await runQuery(db, 'DELETE FROM bookings WHERE id = ?', [testBookingId]);
    }
    db.close();
  }
});
