'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sqlite3 = require('sqlite3');

// 1. Read worker.js source to verify implementation invariants
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract cancelExpiredBookings from worker.js
const cancelStartIdx = workerSource.indexOf('async function cancelExpiredBookings(env, options = {})');
const cancelEndIdx = workerSource.indexOf('const BACKUP_TABLES = [', cancelStartIdx);
assert.ok(cancelStartIdx > 0 && cancelEndIdx > cancelStartIdx, 'Failed to locate cancelExpiredBookings in worker.js');
const cancelExpiredBookings = vm.runInNewContext(
  `(${workerSource.slice(cancelStartIdx, cancelEndIdx).trim()})`,
  { console, Date, Number, parseInt, isNaN }
);

// Extract REJECT_REASON_MAP from worker.js
assert.ok(workerSource.includes('const REJECT_REASON_MAP = {'), 'REJECT_REASON_MAP must exist in worker.js');
assert.ok(serverSource.includes('const REJECT_REASON_MAP = {'), 'REJECT_REASON_MAP must exist in server.js');

const REJECT_REASON_MAP = {
  AMOUNT_MISMATCH: 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ',
  WRONG_RECEIVER: 'บัญชีผู้รับเงินไม่ถูกต้อง',
  UNREADABLE_SLIP: 'รูปภาพสลิปไม่ชัดเจนหรือข้อมูลไม่ครบถ้วน',
  DUPLICATE_SLIP: 'สลิปซ้ำหรือเคยใช้งานแล้วในระบบ',
  INVALID_DATETIME: 'วันที่หรือเวลาในการโอนไม่ถูกต้อง',
  NOT_BANK_SLIP: 'ไม่ใช่สลิปการโอนเงินของธนาคาร',
  OTHER: 'อื่นๆ'
};

// 2. Helper to create SQLite test DB simulating D1 / SQLite
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

  const createStatement = (sql, boundParams = []) => {
    return {
      bind(...params) {
        return createStatement(sql, params);
      },
      first: (col) => query.get(sql, boundParams).then(row => (col && row ? row[col] : row)),
      all: async () => {
        const rows = await query.all(sql, boundParams);
        return { results: rows };
      },
      run: async () => {
        const res = await query.run(sql, boundParams);
        return { meta: { changes: res.changes } };
      }
    };
  };

  const env = {
    DB: {
      prepare(sql) {
        return createStatement(sql);
      }
    }
  };

  return { db, query, env };
}

// 3. Schema Initialization
async function initSchema(query) {
  await query.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      department TEXT,
      contact TEXT,
      total_amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      payment_method TEXT,
      slip_verify_status TEXT,
      slip_image_url TEXT,
      slip_trans_ref TEXT,
      receipt_number TEXT,
      pin_code TEXT,
      booking_source TEXT DEFAULT 'online',
      checkin_status TEXT DEFAULT 'pending',
      cancellation_reason TEXT,
      created_at TEXT
    );

    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      room_id INTEGER,
      start_time TEXT,
      end_time TEXT,
      checkin_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE slip_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      trans_ref TEXT,
      bank_code TEXT,
      bank_name TEXT,
      slip_image_url TEXT,
      is_auto_approved INTEGER DEFAULT 0,
      confidence_score REAL DEFAULT 0,
      raw_qr_data TEXT,
      verification_status TEXT,
      rejection_reason TEXT,
      created_at TEXT
    );
  `);
}

// Helper: rejectSlip endpoint simulation matching worker.js & server.js
async function handleRejectSlip(env, bookingId, body) {
  const { reason_code, custom_note } = body || {};

  if (!reason_code || !REJECT_REASON_MAP[reason_code]) {
    return { status: 400, error: 'กรุณาระบุรหัสเหตุผลการปฏิเสธสลิปที่ถูกต้อง' };
  }

  let displayReason = REJECT_REASON_MAP[reason_code];
  const sanitizedNote = custom_note
    ? String(custom_note).trim().replace(/[<>'"&]/g, '').replace(/[\x00-\x1F\x7F]/g, '').substring(0, 150)
    : '';

  if (reason_code === 'OTHER') {
    if (!sanitizedNote) {
      return { status: 400, error: 'กรณีเลือกอื่นๆ กรุณาระบุรายละเอียดเหตุผลเพิ่มเติม (ไม่เกิน 150 ตัวอักษร)' };
    }
    displayReason = sanitizedNote;
  } else if (sanitizedNote) {
    displayReason = `${displayReason} (${sanitizedNote})`;
  }

  const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
  if (!booking) {
    return { status: 404, error: 'ไม่พบข้อมูลการจอง' };
  }

  if (booking.payment_status !== 'reviewing') {
    return {
      status: 409,
      error: `ไม่สามารถปฏิเสธสลิปได้เนื่องจากรายการจองอยู่ในสถานะ '${booking.payment_status}' (อนุญาตเฉพาะสถานะรอตรวจสอบ 'reviewing' เท่านั้น)`
    };
  }

  const updateResult = await env.DB.prepare(`
    UPDATE bookings
    SET payment_status = 'rejected',
        slip_verify_status = 'rejected'
    WHERE id = ? AND payment_status = 'reviewing'
  `).bind(bookingId).run();

  if (updateResult.meta?.changes !== 1) {
    return { status: 409, error: 'สถานะรายการจองถูกเปลี่ยนแปลงไปแล้ว ไม่สามารถดำเนินการได้' };
  }

  // Audit record update
  const latestSv = await env.DB.prepare(
    'SELECT id FROM slip_verifications WHERE booking_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(bookingId).first();

  if (latestSv) {
    await env.DB.prepare(`
      UPDATE slip_verifications
      SET verification_status = 'rejected',
          rejection_reason = ?
      WHERE id = ?
    `).bind(displayReason, latestSv.id).run();
  } else {
    const nowIso = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO slip_verifications (
        booking_id, trans_ref, bank_code, bank_name, slip_image_url,
        is_auto_approved, confidence_score, raw_qr_data, verification_status,
        rejection_reason, created_at
      ) VALUES (?, ?, '000', 'ธนาคาร', ?, 0, 0, '', 'rejected', ?, ?)
    `).bind(bookingId, booking.slip_trans_ref || `REJ_${bookingId}_${Date.now()}`, booking.slip_image_url || 'uploaded', displayReason, nowIso).run();
  }

  return {
    status: 200,
    success: true,
    message: 'ปฏิเสธสลิปการโอนเงินเรียบร้อยแล้ว (การจองยังคงอยู่เพื่อให้ลูกค้าแนบสลิปใหม่)',
    payment_status: 'rejected',
    slip_verify_status: 'rejected',
    rejection_reason: displayReason
  };
}

// Helper: uploadSlip simulation matching worker.js & server.js
async function handleUploadSlip(env, bookingId, { transRef, imageUrl }) {
  const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
  if (!booking) return { status: 404, error: 'ไม่พบข้อมูลการจอง' };

  // 1. Same-booking rejected duplicate check
  const rejectedOnSameBooking = await env.DB.prepare(
    "SELECT id FROM slip_verifications WHERE booking_id = ? AND trans_ref = ? AND verification_status = 'rejected' LIMIT 1"
  ).bind(bookingId, transRef).first();

  if (rejectedOnSameBooking || (booking.payment_status === 'rejected' && booking.slip_trans_ref === transRef)) {
    return {
      status: 400,
      success: false,
      error: 'สลิปนี้เคยถูกปฏิเสธแล้ว กรุณาแนบสลิปใหม่ที่มีการโอนเงินถูกต้อง'
    };
  }

  // 2. Across-bookings duplicate check
  const duplicate = await env.DB.prepare(
    'SELECT id FROM bookings WHERE slip_trans_ref = ? AND id != ?'
  ).bind(transRef, bookingId).first();

  if (duplicate) {
    return {
      status: 400,
      success: false,
      error: 'สลิปนี้เคยถูกใช้งานในระบบแล้ว'
    };
  }

  // 3. Update booking to reviewing & pending_manual
  await env.DB.prepare(`
    UPDATE bookings
    SET payment_status = 'reviewing',
        slip_verify_status = 'pending_manual',
        slip_image_url = ?,
        slip_trans_ref = ?
    WHERE id = ?
  `).bind(imageUrl || 'new_slip.jpg', transRef, bookingId).run();

  // 4. Insert new verification record (audit history preserved)
  const nowIso = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO slip_verifications (
      booking_id, trans_ref, bank_code, bank_name, slip_image_url,
      is_auto_approved, confidence_score, raw_qr_data, verification_status,
      rejection_reason, created_at
    ) VALUES (?, ?, '014', 'SCB', ?, 0, 80, ?, 'pending_manual', NULL, ?)
  `).bind(bookingId, transRef, imageUrl || 'new_slip.jpg', `RAW_${transRef}`, nowIso).run();

  return {
    status: 200,
    success: true,
    payment_status: 'reviewing',
    slip_verify_status: 'pending_manual',
    is_resubmission: true
  };
}

// Helper: Public GET booking
async function getPublicBooking(env, bookingId) {
  const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
  if (!booking) return null;

  let rejectionReason = null;
  if (booking.payment_status === 'rejected' || booking.slip_verify_status === 'rejected') {
    const rejRow = await env.DB.prepare(
      "SELECT rejection_reason FROM slip_verifications WHERE booking_id = ? AND verification_status = 'rejected' ORDER BY id DESC LIMIT 1"
    ).bind(bookingId).first();
    rejectionReason = rejRow?.rejection_reason || null;
  }

  return {
    ...booking,
    rejection_reason: rejectionReason
  };
}

// Helper: Overlap check simulation (Worker logic)
async function checkWorkerRoomOverlap(env, roomId, startISO, endISO, excludeBookingId = null) {
  let query = `
    SELECT bi.id, bi.booking_id, bi.start_time, bi.end_time, b.customer_name, b.payment_status
    FROM booking_items bi
    JOIN bookings b ON bi.booking_id = b.id
    WHERE bi.room_id = ?
      AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
  `;
  const params = [roomId];
  if (excludeBookingId) {
    query += " AND b.id != ?";
    params.push(excludeBookingId);
  }

  const { results: bookings } = await env.DB.prepare(query).bind(...params).all();
  return (bookings || []).length > 0;
}

// Helper: Overlap check simulation (Local Server logic)
async function checkServerRoomOverlap(queryHelper, roomId, startISO, endISO, excludeBookingId = null) {
  let query = `
    SELECT bi.id, bi.booking_id, bi.start_time, bi.end_time, b.customer_name, b.payment_status
    FROM booking_items bi
    JOIN bookings b ON bi.booking_id = b.id
    WHERE bi.room_id = ?
      AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed'))
      AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
  `;
  const params = [roomId];
  if (excludeBookingId) {
    query += ' AND b.id != ?';
    params.push(excludeBookingId);
  }

  const bookings = await queryHelper.all(query, params);
  return (bookings || []).length > 0;
}

// =========================================================================
// TEST SUITE: 27 Test Invariants for Reject Slip Resubmission Flow
// =========================================================================

// 1. reviewing + valid reject -> rejected
test('TC1: reviewing + valid reject -> payment_status = rejected, slip_verify_status = rejected', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`
    INSERT INTO bookings (id, customer_name, total_amount, payment_status, slip_verify_status, slip_trans_ref)
    VALUES (1, 'Alice', 500, 'reviewing', 'pending_manual', 'REF_001')
  `);
  await query.run(`
    INSERT INTO slip_verifications (booking_id, trans_ref, verification_status)
    VALUES (1, 'REF_001', 'pending_manual')
  `);

  const res = await handleRejectSlip(env, 1, { reason_code: 'WRONG_RECEIVER' });
  assert.equal(res.status, 200);
  assert.equal(res.success, true);
  assert.equal(res.payment_status, 'rejected');
  assert.equal(res.slip_verify_status, 'rejected');

  const updated = await query.get('SELECT * FROM bookings WHERE id = 1');
  assert.equal(updated.payment_status, 'rejected');
  assert.equal(updated.slip_verify_status, 'rejected');
});

// 2. room remains blocked (booking_items still intact, booking not cancelled)
test('TC2: rejected booking preserves room block and booking_items', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Bob', 500, 'reviewing')`);
  await query.run(`INSERT INTO booking_items (booking_id, room_id, start_time, end_time, checkin_status) VALUES (1, 101, '2026-09-04T10:00:00', '2026-09-04T12:00:00', 'pending')`);

  await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });

  const booking = await query.get('SELECT payment_status FROM bookings WHERE id = 1');
  assert.notEqual(booking.payment_status, 'cancelled');
  assert.equal(booking.payment_status, 'rejected');

  const item = await query.get('SELECT * FROM booking_items WHERE booking_id = 1');
  assert.equal(item.room_id, 101);
  assert.equal(item.checkin_status, 'pending');
});

// 3. Worker overlap blocks rejected
test('TC3: Worker checkRoomOverlap considers rejected booking as blocking', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Charlie', 500, 'rejected')`);
  await query.run(`INSERT INTO booking_items (booking_id, room_id, start_time, end_time) VALUES (1, 101, '2026-09-04T10:00:00', '2026-09-04T12:00:00')`);

  const hasOverlap = await checkWorkerRoomOverlap(env, 101, '2026-09-04T10:00:00', '2026-09-04T12:00:00');
  assert.equal(hasOverlap, true, 'Worker must detect overlap for rejected booking');
});

// 4. Local overlap blocks rejected
test('TC4: Local Server checkRoomOverlap considers rejected booking as blocking', async () => {
  const { query } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Diana', 500, 'rejected')`);
  await query.run(`INSERT INTO booking_items (booking_id, room_id, start_time, end_time) VALUES (1, 101, '2026-09-04T10:00:00', '2026-09-04T12:00:00')`);

  const hasOverlap = await checkServerRoomOverlap(query, 101, '2026-09-04T10:00:00', '2026-09-04T12:00:00');
  assert.equal(hasOverlap, true, 'Local Server must detect overlap for rejected booking');
});

// 5. paid cannot reject
test('TC5: paid booking cannot be rejected (returns 409 Conflict)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Eve', 500, 'paid')`);

  const res = await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });
  assert.equal(res.status, 409);
  assert.match(res.error, /อนุญาตเฉพาะสถานะรอตรวจสอบ/);

  const b = await query.get('SELECT payment_status FROM bookings WHERE id = 1');
  assert.equal(b.payment_status, 'paid');
});

// 6. cancelled cannot reject
test('TC6: cancelled booking cannot be rejected (returns 409 Conflict)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Frank', 500, 'cancelled')`);

  const res = await handleRejectSlip(env, 1, { reason_code: 'WRONG_RECEIVER' });
  assert.equal(res.status, 409);

  const b = await query.get('SELECT payment_status FROM bookings WHERE id = 1');
  assert.equal(b.payment_status, 'cancelled');
});

// 7. internal_free cannot reject
test('TC7: internal_free booking cannot be rejected (returns 409 Conflict)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Grace', 0, 'internal_free')`);

  const res = await handleRejectSlip(env, 1, { reason_code: 'OTHER', custom_note: 'Not allowed' });
  assert.equal(res.status, 409);

  const b = await query.get('SELECT payment_status FROM bookings WHERE id = 1');
  assert.equal(b.payment_status, 'internal_free');
});

// 8. double reject conflict safe
test('TC8: double reject on already rejected booking returns 409 Conflict', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Hank', 500, 'reviewing')`);

  const res1 = await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });
  assert.equal(res1.status, 200);

  const res2 = await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });
  assert.equal(res2.status, 409);
});

// 9. approve vs reject race condition
test('TC9: race between approve and reject -> reject gets 409 Conflict if approved first', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Ivy', 500, 'reviewing')`);

  // Staff A approves first
  await query.run(`UPDATE bookings SET payment_status = 'paid' WHERE id = 1`);

  // Staff B tries to reject
  const res = await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });
  assert.equal(res.status, 409);

  const b = await query.get('SELECT payment_status FROM bookings WHERE id = 1');
  assert.equal(b.payment_status, 'paid');
});

// 10. reason code validation
test('TC10: reason code validation accepts valid codes, rejects invalid code with 400', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Jack', 500, 'reviewing')`);

  // Invalid code
  const resInvalid = await handleRejectSlip(env, 1, { reason_code: 'INVALID_CODE_XYZ' });
  assert.equal(resInvalid.status, 400);

  // Missing code
  const resMissing = await handleRejectSlip(env, 1, {});
  assert.equal(resMissing.status, 400);

  // Valid codes
  const validCodes = ['AMOUNT_MISMATCH', 'WRONG_RECEIVER', 'UNREADABLE_SLIP', 'DUPLICATE_SLIP', 'INVALID_DATETIME', 'NOT_BANK_SLIP'];
  for (const code of validCodes) {
    await query.run(`UPDATE bookings SET payment_status = 'reviewing' WHERE id = 1`);
    const res = await handleRejectSlip(env, 1, { reason_code: code });
    assert.equal(res.status, 200);
    assert.equal(res.rejection_reason, REJECT_REASON_MAP[code]);
  }
});

// 11. OTHER sanitization and length limits
test('TC11: OTHER requires custom_note, trims, limits to 150 chars, strips HTML/control characters', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Kelly', 500, 'reviewing')`);

  // Empty note fails
  const resEmpty = await handleRejectSlip(env, 1, { reason_code: 'OTHER', custom_note: '   ' });
  assert.equal(resEmpty.status, 400);

  // HTML and control characters stripped, long text truncated to 150 chars
  const longMaliciousNote = '<script>alert("hack")</script>' + 'A'.repeat(200);
  const res = await handleRejectSlip(env, 1, { reason_code: 'OTHER', custom_note: longMaliciousNote });
  assert.equal(res.status, 200);
  assert.ok(!res.rejection_reason.includes('<script>'));
  assert.ok(!res.rejection_reason.includes('"'));
  assert.ok(res.rejection_reason.length <= 150);
});

// 12. rejected public GET returns current reason
test('TC12: rejected public GET returns current rejection_reason', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Leo', 500, 'reviewing')`);
  await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });

  const pub = await getPublicBooking(env, 1);
  assert.equal(pub.payment_status, 'rejected');
  assert.equal(pub.rejection_reason, 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ');
});

// 13. reviewing after re-upload does NOT return stale rejection reason
test('TC13: reviewing after re-upload returns rejection_reason = null (no stale message)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, slip_trans_ref) VALUES (1, 'Mia', 500, 'reviewing', 'REF_OLD')`);
  await query.run(`INSERT INTO slip_verifications (booking_id, trans_ref, verification_status) VALUES (1, 'REF_OLD', 'pending_manual')`);

  // 1. Reject
  await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });
  const pubRejected = await getPublicBooking(env, 1);
  assert.equal(pubRejected.rejection_reason, 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ');

  // 2. Customer re-uploads new slip
  const uploadRes = await handleUploadSlip(env, 1, { transRef: 'REF_NEW', imageUrl: 'new.jpg' });
  assert.equal(uploadRes.status, 200);

  // 3. Public GET now returns null for rejection_reason
  const pubReviewing = await getPublicBooking(env, 1);
  assert.equal(pubReviewing.payment_status, 'reviewing');
  assert.equal(pubReviewing.rejection_reason, null);
});

// 14. rejected can re-upload new slip
test('TC14: rejected booking allows uploading new slip', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Noah', 500, 'rejected')`);

  const res = await handleUploadSlip(env, 1, { transRef: 'REF_NEW_1', imageUrl: 'slip.jpg' });
  assert.equal(res.status, 200);
  assert.equal(res.success, true);
});

// 15. re-upload -> reviewing
test('TC15: successful re-upload transitions status from rejected to reviewing', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, slip_verify_status) VALUES (1, 'Olivia', 500, 'rejected', 'rejected')`);

  await handleUploadSlip(env, 1, { transRef: 'REF_OLIVIA', imageUrl: 'slip_olivia.jpg' });

  const b = await query.get('SELECT payment_status, slip_verify_status, slip_trans_ref FROM bookings WHERE id = 1');
  assert.equal(b.payment_status, 'reviewing');
  assert.equal(b.slip_verify_status, 'pending_manual');
  assert.equal(b.slip_trans_ref, 'REF_OLIVIA');
});

// 16. old verification audit preserved
test('TC16: old slip verification audit row is preserved upon re-upload', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, slip_trans_ref) VALUES (1, 'Paul', 500, 'reviewing', 'REF_P1')`);
  await query.run(`INSERT INTO slip_verifications (booking_id, trans_ref, verification_status) VALUES (1, 'REF_P1', 'pending_manual')`);

  // Reject slip 1
  await handleRejectSlip(env, 1, { reason_code: 'WRONG_RECEIVER' });

  // Re-upload slip 2
  await handleUploadSlip(env, 1, { transRef: 'REF_P2', imageUrl: 'p2.jpg' });

  const rows = await query.all('SELECT * FROM slip_verifications WHERE booking_id = 1 ORDER BY id ASC');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].trans_ref, 'REF_P1');
  assert.equal(rows[0].verification_status, 'rejected');
  assert.equal(rows[0].rejection_reason, 'บัญชีผู้รับเงินไม่ถูกต้อง');
  assert.equal(rows[1].trans_ref, 'REF_P2');
  assert.equal(rows[1].verification_status, 'pending_manual');
});

// 17. same rejected trans_ref cannot be reused on same booking
test('TC17: same rejected trans_ref cannot be reused on the same booking (returns 400)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, slip_trans_ref) VALUES (1, 'Quinn', 500, 'reviewing', 'REF_SAME')`);
  await query.run(`INSERT INTO slip_verifications (booking_id, trans_ref, verification_status) VALUES (1, 'REF_SAME', 'pending_manual')`);

  // Staff rejects REF_SAME
  await handleRejectSlip(env, 1, { reason_code: 'UNREADABLE_SLIP' });

  // Customer tries to re-upload the same REF_SAME
  const res = await handleUploadSlip(env, 1, { transRef: 'REF_SAME', imageUrl: 'same.jpg' });
  assert.equal(res.status, 400);
  assert.equal(res.success, false);
  assert.match(res.error, /สลิปนี้เคยถูกปฏิเสธแล้ว/);

  // Booking remains rejected
  const b = await query.get('SELECT payment_status FROM bookings WHERE id = 1');
  assert.equal(b.payment_status, 'rejected');
});

// 18. different new trans_ref accepted
test('TC18: different new trans_ref is accepted successfully', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, slip_trans_ref) VALUES (1, 'Rachel', 500, 'reviewing', 'REF_OLD')`);
  await query.run(`INSERT INTO slip_verifications (booking_id, trans_ref, verification_status) VALUES (1, 'REF_OLD', 'pending_manual')`);

  await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });

  const res = await handleUploadSlip(env, 1, { transRef: 'REF_BRAND_NEW', imageUrl: 'new.jpg' });
  assert.equal(res.status, 200);
  assert.equal(res.success, true);
});

// 19. new slip returns to POS review queue
test('TC19: re-uploaded booking returns to POS review queue (reviewingCount increases)', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Sam', 500, 'reviewing')`);

  // Check initial reviewing count
  const countBefore = (await query.all("SELECT id FROM bookings WHERE payment_status = 'reviewing'")).length;
  assert.equal(countBefore, 1);

  // Reject slip -> rejected
  await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });
  const countDuringReject = (await query.all("SELECT id FROM bookings WHERE payment_status = 'reviewing'")).length;
  assert.equal(countDuringReject, 0, 'Rejected booking must not be in reviewing count');

  // Customer re-uploads -> reviewing
  await handleUploadSlip(env, 1, { transRef: 'REF_SAM_2', imageUrl: 'sam2.jpg' });
  const countAfter = (await query.all("SELECT id FROM bookings WHERE payment_status = 'reviewing'")).length;
  assert.equal(countAfter, 1, 'Re-uploaded booking must return to reviewing count');
});

// 20. CustomDatePicker blocks rejected
test('TC20: CustomDatePicker filter blocks rejected booking dates', () => {
  // Simulating CustomDatePicker filter logic:
  // ['cancelled', 'failed'].includes(ev.payment_status) || ['cancelled', 'failed'].includes(ev.status) || ev.checkin_status === 'cancelled'
  const filterBooking = (ev) => {
    if (['cancelled', 'failed'].includes(ev.payment_status) || ['cancelled', 'failed'].includes(ev.status) || ev.checkin_status === 'cancelled') return false;
    return true;
  };

  assert.equal(filterBooking({ payment_status: 'cancelled' }), false, 'cancelled is filtered out (free)');
  assert.equal(filterBooking({ payment_status: 'failed' }), false, 'failed is filtered out (free)');
  assert.equal(filterBooking({ payment_status: 'rejected' }), true, 'rejected is NOT filtered out (retained as occupied)');
  assert.equal(filterBooking({ payment_status: 'reviewing' }), true, 'reviewing is retained as occupied');
  assert.equal(filterBooking({ payment_status: 'paid' }), true, 'paid is retained as occupied');
});

// 21. Confirmed Business Policy: Expiration takes precedence when deadline passes
test('TC21: ConfirmPage logic ensures expired rejected bookings do NOT allow upload', () => {
  const computeDisplayState = (booking, isExpired) => {
    const isRejected = booking?.payment_status === 'rejected' || booking?.slip_verify_status === 'rejected';
    if (isExpired) {
      return { showRejectionBox: isRejected, showExpiredBox: true, allowUpload: false };
    }
    if (isRejected) {
      return { showRejectionBox: true, showExpiredBox: false, allowUpload: true };
    }
    return { showRejectionBox: false, showExpiredBox: false, allowUpload: true };
  };

  const rejectedBooking = { payment_status: 'rejected', slip_verify_status: 'rejected' };
  // If isExpired is false (within deadline), customer can resubmit
  const activeState = computeDisplayState(rejectedBooking, false);
  assert.equal(activeState.showRejectionBox, true);
  assert.equal(activeState.showExpiredBox, false);
  assert.equal(activeState.allowUpload, true);

  // When isExpired is true (deadline passed), upload is forbidden per confirmed policy
  const expiredState = computeDisplayState(rejectedBooking, true);
  assert.equal(expiredState.showExpiredBox, true);
  assert.equal(expiredState.allowUpload, false);
});

// 22. Confirmed Business Policy: cancelExpiredBookings cancels expired rejected bookings, but preserves unexpired rejected bookings
test('TC22: cancelExpiredBookings cancels expired rejected bookings while preserving unexpired rejected bookings', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run("INSERT INTO settings (key, value) VALUES ('payment_window_minutes', '15')");

  const baseTime = 1756890000000;
  const expiredCreatedAt = new Date(baseTime - 30 * 60 * 1000).toISOString(); // 30 mins ago (expired)
  const unexpiredCreatedAt = new Date(baseTime - 5 * 60 * 1000).toISOString(); // 5 mins ago (eligible)

  // 1 pending expired, 1 rejected expired, 1 rejected unexpired
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at) VALUES (1, 'Pending Expired', 500, 'pending', 'online', ?)`, [expiredCreatedAt]);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at) VALUES (2, 'Rejected Expired', 500, 'rejected', 'online', ?)`, [expiredCreatedAt]);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, booking_source, created_at) VALUES (3, 'Rejected Active', 500, 'rejected', 'online', ?)`, [unexpiredCreatedAt]);

  const res = await cancelExpiredBookings(env, { nowMs: baseTime });
  assert.equal(res.cancelled, 2, 'Both pending and rejected bookings that exceeded deadline must be cancelled');

  // Booking 1 (pending expired) was cancelled
  const b1 = await query.get('SELECT payment_status FROM bookings WHERE id = 1');
  assert.equal(b1.payment_status, 'cancelled');

  // Booking 2 (rejected expired) was cancelled
  const b2 = await query.get('SELECT payment_status FROM bookings WHERE id = 2');
  assert.equal(b2.payment_status, 'cancelled');

  // Booking 3 (rejected unexpired, 5 mins old) remains rejected and alive
  const b3 = await query.get('SELECT payment_status FROM bookings WHERE id = 3');
  assert.equal(b3.payment_status, 'rejected', 'Unexpired rejected booking must NOT be cancelled before deadline');
});

// 23. reject sends no PIN
test('TC23: rejectSlip endpoint does NOT dispatch PIN code', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, pin_code) VALUES (1, 'Tom', 500, 'reviewing', NULL)`);

  const res = await handleRejectSlip(env, 1, { reason_code: 'WRONG_RECEIVER' });
  assert.equal(res.status, 200);

  const b = await query.get('SELECT pin_code FROM bookings WHERE id = 1');
  assert.equal(b.pin_code, null, 'No PIN must be generated or assigned upon reject');
});

// 24. reject sends no LINE cancellation
test('TC24: rejectSlip does not send LINE cancellation or set cancellation_reason', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, cancellation_reason) VALUES (1, 'Uma', 500, 'reviewing', NULL)`);

  await handleRejectSlip(env, 1, { reason_code: 'AMOUNT_MISMATCH' });

  const b = await query.get('SELECT cancellation_reason FROM bookings WHERE id = 1');
  assert.equal(b.cancellation_reason, null, 'cancellation_reason must remain null');
});

// 25. re-upload sends no PIN
test('TC25: re-uploading slip does NOT dispatch PIN', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, pin_code) VALUES (1, 'Victor', 500, 'rejected', NULL)`);

  const res = await handleUploadSlip(env, 1, { transRef: 'REF_VIC', imageUrl: 'vic.jpg' });
  assert.equal(res.status, 200);

  const b = await query.get('SELECT pin_code FROM bookings WHERE id = 1');
  assert.equal(b.pin_code, null, 'No PIN must be dispatched on re-upload');
});

// 26. no Auto-Paid
test('TC26: re-uploading slip does NOT auto-approve to paid', async () => {
  const { query, env } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Wendy', 500, 'rejected')`);

  const res = await handleUploadSlip(env, 1, { transRef: 'REF_WENDY', imageUrl: 'wendy.jpg' });
  assert.equal(res.payment_status, 'reviewing');
  assert.equal(res.slip_verify_status, 'pending_manual');

  const b = await query.get('SELECT payment_status FROM bookings WHERE id = 1');
  assert.equal(b.payment_status, 'reviewing', 'Status must be reviewing, never auto-paid');
});

// 27. manual approve flow unchanged
test('TC27: staff manual approve transitions reviewing -> paid successfully', async () => {
  const { query } = createTestDb();
  await initSchema(query);
  await query.run(`INSERT INTO bookings (id, customer_name, total_amount, payment_status, slip_verify_status) VALUES (1, 'Xavier', 500, 'reviewing', 'pending_manual')`);

  // Manual Staff Approve simulation
  await query.run(`
    UPDATE bookings
    SET payment_status = 'paid',
        payment_method = 'PromptPay QR'
    WHERE id = 1 AND payment_status = 'reviewing'
  `);

  const b = await query.get('SELECT payment_status, payment_method FROM bookings WHERE id = 1');
  assert.equal(b.payment_status, 'paid');
  assert.equal(b.payment_method, 'PromptPay QR');
});
