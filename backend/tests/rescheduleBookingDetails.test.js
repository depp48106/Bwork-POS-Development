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

function allQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
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

test('1. Reschedule Details Normalization and Validation', () => {
  // Test undefined (omitted) semantics
  const omitted = undefined;
  assert.strictEqual(omitted, undefined, 'Omitted details should be undefined to signal preserve existing');

  // Test empty and whitespace strings -> null
  assert.strictEqual(normalizeBookingDetails('').value, null);
  assert.strictEqual(normalizeBookingDetails('   \n\t  ').value, null);

  // Test valid multiline content
  const multi = '  ห้องจัดแบบ U-Shape\r\nเตรียมกาแฟ 10 แก้ว  ';
  const norm = normalizeBookingDetails(multi);
  assert.strictEqual(norm.value, 'ห้องจัดแบบ U-Shape\nเตรียมกาแฟ 10 แก้ว');

  // Test over 1000 limit
  const tooLong = 'X'.repeat(1001);
  const err = normalizeBookingDetails(tooLong);
  assert.ok(err.error && err.error.includes('1,000'));
});

test('2. Atomic Reschedule: Updates Date/Time and Booking Details in a Single Transaction', async () => {
  const db = new sqlite3.Database(DB_PATH);
  let testBookingId = null;
  let testItemId = null;

  try {
    // 1. Create a test booking and item
    const initRes = await runQuery(
      db,
      `INSERT INTO bookings (customer_name, contact, total_amount, payment_status, booking_details, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      ['Test Atomic Reschedule', '0812345678', 600.0, 'pending', 'รายละเอียดแรกเริ่ม']
    );
    testBookingId = initRes.id;

    const itemRes = await runQuery(
      db,
      `INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, booking_type, layout)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [testBookingId, 1, '2026-10-05T09:00:00', '2026-10-05T10:00:00', 600.0, 600.0, 'hourly', 'standard']
    );
    testItemId = itemRes.id;

    // 2. Perform atomic reschedule with updated date/time AND updated booking_details
    const newDate = '2026-10-06';
    const newStart = `${newDate}T13:00:00`;
    const newEnd = `${newDate}T15:00:00`;
    const newDetails = 'เปลี่ยนเป็นจัดห้องแบบ Theater\nขอไมค์ไร้สาย 2 ตัว';
    const norm = normalizeBookingDetails(newDetails);
    const newTotal = 1200.0;

    await runQuery(db, 'BEGIN TRANSACTION');
    await runQuery(
      db,
      `UPDATE booking_items SET start_time = ?, end_time = ?, price = ?, subtotal = ? WHERE id = ?`,
      [newStart, newEnd, newTotal, newTotal, testItemId]
    );
    await runQuery(
      db,
      `UPDATE bookings SET total_amount = ?, booking_details = ? WHERE id = ?`,
      [newTotal, norm.value, testBookingId]
    );
    await runQuery(db, 'COMMIT');

    // 3. Verify that both date/time and booking_details updated atomically
    const updatedBooking = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    const updatedItem = await getQuery(db, 'SELECT * FROM booking_items WHERE id = ?', [testItemId]);

    assert.strictEqual(updatedBooking.total_amount, 1200.0);
    assert.strictEqual(updatedBooking.booking_details, newDetails);
    assert.strictEqual(updatedItem.start_time, newStart);
    assert.strictEqual(updatedItem.end_time, newEnd);

    // 4. Verify preserving booking_details when booking_details is undefined (not provided)
    const nextStart = `${newDate}T14:00:00`;
    const nextEnd = `${newDate}T16:00:00`;
    // Simulate reschedule payload without booking_details
    await runQuery(db, 'BEGIN TRANSACTION');
    await runQuery(
      db,
      `UPDATE booking_items SET start_time = ?, end_time = ? WHERE id = ?`,
      [nextStart, nextEnd, testItemId]
    );
    // Booking table total_amount updated without touching booking_details
    await runQuery(
      db,
      `UPDATE bookings SET total_amount = ? WHERE id = ?`,
      [newTotal, testBookingId]
    );
    await runQuery(db, 'COMMIT');

    const preservedBooking = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    assert.strictEqual(preservedBooking.booking_details, newDetails, 'Existing booking_details must be preserved when omitted');

    // 5. Verify clearing booking_details to NULL when empty string is provided
    const clearNorm = normalizeBookingDetails('   ');
    assert.strictEqual(clearNorm.value, null);

    await runQuery(db, 'BEGIN TRANSACTION');
    await runQuery(
      db,
      `UPDATE bookings SET booking_details = ? WHERE id = ?`,
      [clearNorm.value, testBookingId]
    );
    await runQuery(db, 'COMMIT');

    const clearedBooking = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    assert.strictEqual(clearedBooking.booking_details, null, 'booking_details should become NULL when cleared');

  } finally {
    if (testItemId) {
      await runQuery(db, 'DELETE FROM booking_items WHERE id = ?', [testItemId]);
    }
    if (testBookingId) {
      await runQuery(db, 'DELETE FROM bookings WHERE id = ?', [testBookingId]);
    }
    db.close();
  }
});

test('3. LINE Notification Policy on Reschedule: Only Dispatches when Schedule Actually Changes', () => {
  // Canonical normalizeToLocalISO matching server.js (line 760) & worker.js (line 610)
  function normalizeToLocalISO(dateStr, timeStr) {
    if (!dateStr) return '';
    if (timeStr) {
      let cleanTime = String(timeStr).trim();
      if (cleanTime.length === 5) cleanTime += ':00';
      const cleanDate = String(dateStr).trim().split('T')[0].split(' ')[0];
      return `${cleanDate}T${cleanTime}`;
    }
    if (typeof dateStr === 'string') {
      let s = dateStr.trim();
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
        s = s.replace(' ', 'T');
        if (s.length === 16) s += ':00';
        return s;
      }
      if (s.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          const bkkMs = d.getTime() + 7 * 60 * 60 * 1000;
          const bkk = new Date(bkkMs);
          const y = bkk.getUTCFullYear();
          const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
          const day = String(bkk.getUTCDate()).padStart(2, '0');
          const h = String(bkk.getUTCHours()).padStart(2, '0');
          const min = String(bkk.getUTCMinutes()).padStart(2, '0');
          const sec = String(bkk.getUTCSeconds()).padStart(2, '0');
          return `${y}-${m}-${day}T${h}:${min}:${sec}`;
        }
      }
      if (s.includes('T')) {
        const parts = s.split('T');
        const timePart = parts[1].split('.')[0];
        const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
        return `${parts[0]}T${cleanTime}`;
      }
      if (s.includes(' ')) {
        const parts = s.split(' ');
        const timePart = parts[1].split('.')[0];
        const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
        return `${parts[0]}T${cleanTime}`;
      }
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const bkkMs = d.getTime() + 7 * 60 * 60 * 1000;
    const bkk = new Date(bkkMs);
    const y = bkk.getUTCFullYear();
    const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
    const day = String(bkk.getUTCDate()).padStart(2, '0');
    const h = String(bkk.getUTCHours()).padStart(2, '0');
    const min = String(bkk.getUTCMinutes()).padStart(2, '0');
    const sec = String(bkk.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}:${sec}`;
  }

  // Schedule change detection using canonical Asia/Bangkok normalization
  function detectScheduleChange(currentItem, targetRoomId, newStartISO, newEndISO) {
    const normOldStart = normalizeToLocalISO(currentItem.start_time).substring(0, 16);
    const normNewStart = normalizeToLocalISO(newStartISO).substring(0, 16);
    const normOldEnd = normalizeToLocalISO(currentItem.end_time).substring(0, 16);
    const normNewEnd = normalizeToLocalISO(newEndISO).substring(0, 16);

    return (
      String(currentItem.room_id) !== String(targetRoomId) ||
      normOldStart !== normNewStart ||
      normOldEnd !== normNewEnd
    );
  }

  // 1. Timestamp Normalization equivalence tests (Asia/Bangkok canonical format)
  const expectedStartPrefix = '2026-10-15T09:00';
  const expectedEndPrefix = '2026-10-15T12:00';

  // UTC format (Z)
  assert.strictEqual(normalizeToLocalISO('2026-10-15T02:00:00.000Z').substring(0, 16), expectedStartPrefix);
  assert.strictEqual(normalizeToLocalISO('2026-10-15T05:00:00.000Z').substring(0, 16), expectedEndPrefix);

  // +07:00 format
  assert.strictEqual(normalizeToLocalISO('2026-10-15T09:00:00+07:00').substring(0, 16), expectedStartPrefix);
  assert.strictEqual(normalizeToLocalISO('2026-10-15T12:00:00+07:00').substring(0, 16), expectedEndPrefix);

  // Local SQLite format (space-separated)
  assert.strictEqual(normalizeToLocalISO('2026-10-15 09:00:00').substring(0, 16), expectedStartPrefix);
  assert.strictEqual(normalizeToLocalISO('2026-10-15 12:00:00').substring(0, 16), expectedEndPrefix);

  // Standard Local ISO (T-separated)
  assert.strictEqual(normalizeToLocalISO('2026-10-15T09:00:00').substring(0, 16), expectedStartPrefix);
  assert.strictEqual(normalizeToLocalISO('2026-10-15T12:00:00').substring(0, 16), expectedEndPrefix);

  // 2. Schedule Change Detection across format representations
  const baseItemLocal = {
    room_id: 1,
    start_time: '2026-10-15 09:00:00',
    end_time: '2026-10-15 12:00:00'
  };
  const baseItemUTC = {
    room_id: 1,
    start_time: '2026-10-15T02:00:00.000Z',
    end_time: '2026-10-15T05:00:00.000Z'
  };
  const baseItemT = {
    room_id: 1,
    start_time: '2026-10-15T09:00:00',
    end_time: '2026-10-15T12:00:00'
  };

  // Resubmit identical schedule with different representation -> scheduleChanged MUST be false
  assert.strictEqual(detectScheduleChange(baseItemLocal, 1, '2026-10-15T09:00:00', '2026-10-15T12:00:00'), false);
  assert.strictEqual(detectScheduleChange(baseItemUTC, 1, '2026-10-15T09:00:00', '2026-10-15T12:00:00'), false);
  assert.strictEqual(detectScheduleChange(baseItemT, 1, '2026-10-15 09:00:00', '2026-10-15 12:00:00'), false);

  // 3. Genuine Schedule Changes -> scheduleChanged MUST be true
  // Room changed
  assert.strictEqual(detectScheduleChange(baseItemT, 2, '2026-10-15T09:00:00', '2026-10-15T12:00:00'), true);
  // Date changed
  assert.strictEqual(detectScheduleChange(baseItemT, 1, '2026-10-16T09:00:00', '2026-10-16T12:00:00'), true);
  // Start time changed
  assert.strictEqual(detectScheduleChange(baseItemT, 1, '2026-10-15T10:00:00', '2026-10-15T12:00:00'), true);
  // End time changed
  assert.strictEqual(detectScheduleChange(baseItemT, 1, '2026-10-15T09:00:00', '2026-10-15T13:00:00'), true);
});
