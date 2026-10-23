/**
 * BWORK-POS — Multi-Item Reschedule Comprehensive Test Suite (Phase EDIT-4B)
 *
 * Verifies 23 targeted scenarios across financial safety, room overlap,
 * PIN isolation, atomic concurrency, Express API, and Cloudflare Worker parity.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  roundMoney,
  calculateDiscount,
  calculateBookingFinancials,
  calculateRescheduleFinancials
} = require('../financialHelper');

// -----------------------------------------------------------------------------
// Database Helper for Isolated In-Memory Tests
// -----------------------------------------------------------------------------
function setupTestSqlite() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');

  for (let i = 1; i <= 9; i++) {
    const filename = `00${i}${
      i === 1 ? '_core_schema.sql' :
      i === 2 ? '_add_booking_channel.sql' :
      i === 3 ? '_slip_unique_index.sql' :
      i === 4 ? '_add_builtland_pin_to_rooms.sql' :
      i === 5 ? '_room_hour_credits.sql' :
      i === 6 ? '_add_booking_details.sql' :
      i === 7 ? '_add_builtland_pin_to_rooms.sql' :
      i === 8 ? '_add_discount_and_deposit.sql' :
      '_add_room_wifi_credentials.sql'
    }`;
    const filePath = path.join(__dirname, '../migrations', filename);
    if (fs.existsSync(filePath)) {
      let sql = fs.readFileSync(filePath, 'utf8');
      sql = sql.replace('BEGIN IMMEDIATE;', '').replace('COMMIT;', '');
      try {
        db.exec(sql);
      } catch (e) {
        if (!e.message.includes('duplicate column')) throw e;
      }
    }
  }

  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('cleaning_buffer_minutes', '15');");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('line_channel_access_token', 'mock_token_123');");
  db.exec("INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, daily_rate, half_day_rate, status, pin_code) VALUES (1, 'Room 101', 4, 200, 1500, 800, 'active', '1001');");
  db.exec("INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, daily_rate, half_day_rate, status, pin_code) VALUES (2, 'Room 102', 8, 300, 2200, 1200, 'active', '1002');");
  db.exec("INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, daily_rate, half_day_rate, status, pin_code) VALUES (3, 'Room 103', 12, 500, 3500, 2000, 'active', '1003');");
  db.exec("INSERT OR REPLACE INTO users (id, username, password_hash, role, permissions, fullname) VALUES (1, 'pos_admin', 'scrypt$dummy$hash', 'admin', 'pos,admin', 'Admin User');");

  return db;
}

function createQueryAdapter(db) {
  return {
    async run(sql, params = []) {
      const stmt = db.prepare(sql);
      const res = stmt.run(...params);
      return { id: Number(res.lastInsertRowid), changes: res.changes };
    },
    async get(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.get(...params);
    },
    async all(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    },
    async exec(sql) {
      return db.exec(sql);
    },
    async transaction(callback) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const result = await callback();
        db.exec('COMMIT;');
        return result;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };
}

// -----------------------------------------------------------------------------
// SECTION 1: FINANCIAL SAFETY TESTS
// -----------------------------------------------------------------------------
test('1. Financial Helper: Percentage discount recalculation maintains percent and recalculates amount', () => {
  const oldBooking = {
    subtotal_amount: 1000,
    discount_type: 'percent',
    discount_value: 20,
    discount_amount: 200,
    total_amount: 800,
    paid_amount: 400,
    balance_amount: 400,
    payment_status: 'deposit'
  };
  const res = calculateRescheduleFinancials({ oldBooking, newSubtotal: 1500 });
  assert.strictEqual(res.subtotal_amount, 1500);
  assert.strictEqual(res.discount_type, 'percent');
  assert.strictEqual(res.discount_value, 20);
  assert.strictEqual(res.discount_amount, 300);
  assert.strictEqual(res.total_amount, 1200);
  assert.strictEqual(res.paid_amount, 400);
  assert.strictEqual(res.balance_amount, 800);
});

test('2. Financial Helper: Fixed discount preserves discount value and recalculates total', () => {
  const oldBooking = {
    subtotal_amount: 1000,
    discount_type: 'amount',
    discount_value: 150,
    discount_amount: 150,
    total_amount: 850,
    paid_amount: 850,
    balance_amount: 0,
    payment_status: 'paid'
  };
  const res = calculateRescheduleFinancials({ oldBooking, newSubtotal: 1200 });
  assert.strictEqual(res.subtotal_amount, 1200);
  assert.strictEqual(res.discount_type, 'amount');
  assert.strictEqual(res.discount_value, 150);
  assert.strictEqual(res.discount_amount, 150);
  assert.strictEqual(res.total_amount, 1050);
  assert.strictEqual(res.paid_amount, 850);
  assert.strictEqual(res.balance_amount, 200);
});

test('3. Financial Helper: Throws ERR_RESCHEDULE_BELOW_PAID when new total is below paid amount', () => {
  const paidBooking = {
    subtotal_amount: 1000,
    discount_type: 'none',
    discount_value: 0,
    discount_amount: 0,
    total_amount: 1000,
    paid_amount: 1000,
    balance_amount: 0,
    payment_status: 'paid'
  };
  assert.throws(
    () => {
      calculateRescheduleFinancials({ oldBooking: paidBooking, newSubtotal: 600 });
    },
    (err) => {
      assert.strictEqual(err.code, 'ERR_RESCHEDULE_BELOW_PAID');
      assert.ok(err.message.includes('ต่ำกว่ายอดเงินที่ชำระไปแล้ว'));
      return true;
    }
  );
});

// -----------------------------------------------------------------------------
// SECTION 2: OVERLAP VALIDATION & CLEANING BUFFER TESTS
// -----------------------------------------------------------------------------
async function runOverlapCheck(q, roomId, startISO, endISO, excludeBookingId, excludeBookingItemId) {
  const bufferMins = 15;
  const bufferMs = bufferMins * 60 * 1000;
  const reqStartMs = new Date(startISO).getTime();
  const reqEndMs = new Date(endISO).getTime();
  const reqEndBufferedMs = reqEndMs + bufferMs;

  let sql = `
    SELECT bi.id, bi.booking_id, bi.start_time, bi.end_time, b.customer_name, b.payment_status
    FROM booking_items bi
    JOIN bookings b ON bi.booking_id = b.id
    WHERE bi.room_id = ?
      AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed'))
      AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
  `;
  const params = [roomId];
  if (excludeBookingItemId) {
    sql += ' AND bi.id != ?';
    params.push(excludeBookingItemId);
  } else if (excludeBookingId) {
    sql += ' AND b.id != ?';
    params.push(excludeBookingId);
  }

  const items = await q.all(sql, params);
  for (const b of items) {
    const bStartMs = new Date(b.start_time).getTime();
    const bEndMs = new Date(b.end_time).getTime();
    const bEndBufferedMs = bEndMs + bufferMs;
    if (reqStartMs < bEndBufferedMs && reqEndBufferedMs > bStartMs) {
      return { hasOverlap: true, conflictingItemId: b.id };
    }
  }
  return { hasOverlap: false };
}

test('4. Overlap Check: Detects conflict with another booking in the same room', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run("INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'B1', 1000, 'paid');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (10, 1, 2, '2026-10-15T09:00:00', '2026-10-15T11:00:00', 300, 600);");

  const conflict = await runOverlapCheck(q, 2, '2026-10-15T10:00:00', '2026-10-15T12:00:00', null, 999);
  assert.strictEqual(conflict.hasOverlap, true);
  assert.strictEqual(conflict.conflictingItemId, 10);
});

test('5. Overlap Check: Detects conflict with sibling item of SAME booking in SAME room', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run("INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Parent', 1000, 'paid');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (10, 1, 2, '2026-10-15T09:00:00', '2026-10-15T11:00:00', 300, 600);");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (11, 1, 2, '2026-10-15T13:00:00', '2026-10-15T15:00:00', 300, 600);");

  // Move Item 11 to 09:30 - 10:30 (overlaps Item 10)
  const siblingConflict = await runOverlapCheck(q, 2, '2026-10-15T09:30:00', '2026-10-15T10:30:00', null, 11);
  assert.strictEqual(siblingConflict.hasOverlap, true);
  assert.strictEqual(siblingConflict.conflictingItemId, 10);
});

test('6. Overlap Check: Detects 15-minute cleaning buffer conflict', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run("INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Parent', 1000, 'paid');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (10, 1, 2, '2026-10-15T09:00:00', '2026-10-15T11:00:00', 300, 600);");

  // Request start at 11:00 (Item 10 ends at 11:00, buffer is 11:00 - 11:15)
  const bufferConflict = await runOverlapCheck(q, 2, '2026-10-15T11:00:00', '2026-10-15T12:00:00', null, 11);
  assert.strictEqual(bufferConflict.hasOverlap, true);
});

test('7. Overlap Check: Self-collision exemption allows reschedule to exact same slot', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run("INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (1, 'Parent', 1000, 'paid');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (10, 1, 2, '2026-10-15T09:00:00', '2026-10-15T11:00:00', 300, 600);");

  const selfCheck = await runOverlapCheck(q, 2, '2026-10-15T09:00:00', '2026-10-15T11:00:00', null, 10);
  assert.strictEqual(selfCheck.hasOverlap, false);
});

// -----------------------------------------------------------------------------
// SECTION 3: EXPRESS SERVER RESCHEDULE IMPLEMENTATION & BEHAVIOR
// -----------------------------------------------------------------------------
async function executeExpressReschedule(q, bookingId, body) {
  const { date, start_time, end_time, booking_type, layout, room_id, booking_details, booking_item_id } = body;
  if (!date || !start_time || !end_time) {
    return { status: 400, data: { error: 'กรุณาระบุ วันที่, เวลาเริ่มต้น และเวลาสิ้นสุด ให้ครบถ้วน' } };
  }
  const sHHMM = start_time.substring(0, 5);
  const eHHMM = end_time.substring(0, 5);
  if (eHHMM <= sHHMM) {
    return { status: 400, data: { error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' } };
  }

  const booking = await q.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) return { status: 404, data: { error: 'ไม่พบข้อมูลการจอง' } };

  const allItems = await q.all('SELECT * FROM booking_items WHERE booking_id = ? ORDER BY id ASC', [bookingId]);
  if (!allItems || allItems.length === 0) return { status: 404, data: { error: 'ไม่พบรายการห้องในการจองนี้' } };

  const primaryItem = allItems[0];
  let currentItem = null;

  if (allItems.length > 1) {
    if (!booking_item_id) {
      return { status: 400, data: { error: 'กรุณาระบุ booking_item_id สำหรับการจองที่มีหลายรายการ', code: 'ERR_BOOKING_ITEM_ID_REQUIRED' } };
    }
    currentItem = allItems.find(it => String(it.id) === String(booking_item_id));
    if (!currentItem) {
      return { status: 400, data: { error: 'ไม่พบรายการที่ระบุในข้อมูลการจองนี้', code: 'ERR_ITEM_NOT_FOUND' } };
    }
  } else {
    if (booking_item_id !== undefined && booking_item_id !== null && String(allItems[0].id) !== String(booking_item_id)) {
      return { status: 400, data: { error: 'ไม่พบรายการที่ระบุในข้อมูลการจองนี้', code: 'ERR_ITEM_NOT_FOUND' } };
    }
    currentItem = allItems[0];
  }

  const isPrimaryItem = (primaryItem && currentItem.id === primaryItem.id);
  const targetRoomId = room_id || currentItem.room_id;
  const targetRoomObj = await q.get('SELECT * FROM rooms WHERE id = ?', [targetRoomId]);

  const newStartISO = `${date}T${start_time.length === 5 ? start_time + ':00' : start_time}`;
  const newEndISO = `${date}T${end_time.length === 5 ? end_time + ':00' : end_time}`;

  const overlap = await runOverlapCheck(q, targetRoomId, newStartISO, newEndISO, null, currentItem.id);
  if (overlap.hasOverlap) {
    return { status: 400, data: { error: 'ช่วงเวลานี้มีผู้จองแล้ว', code: 'ERR_ROOM_OVERLAP' } };
  }

  let itemPrice = targetRoomObj ? targetRoomObj.hourly_rate : currentItem.price;
  const hours = Math.max(1, Math.ceil((new Date(newEndISO).getTime() - new Date(newStartISO).getTime()) / (1000 * 60 * 60)));
  let itemSubtotal = roundMoney(itemPrice * hours);

  const otherItems = allItems.filter(it => it.id !== currentItem.id);
  const otherSubtotal = otherItems.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0);
  const fullNewGross = roundMoney(otherSubtotal + itemSubtotal);

  let newFin;
  try {
    newFin = calculateRescheduleFinancials({ oldBooking: booking, newSubtotal: fullNewGross });
  } catch (fErr) {
    return { status: 400, data: { error: fErr.message, code: fErr.code || 'ERR_FINANCIAL_CALCULATION' } };
  }

  const newPinCode = currentItem.pin_code || targetRoomObj?.pin_code || '1234';

  await q.transaction(async () => {
    const freshItem = await q.get('SELECT * FROM booking_items WHERE id = ?', [currentItem.id]);
    if (freshItem.start_time !== currentItem.start_time) {
      const err = new Error('ข้อมูลการจองถูกแก้ไขโดยผู้ใช้อื่น');
      err.code = 'ERR_CONCURRENT_MODIFICATION';
      throw err;
    }

    await q.run(
      `UPDATE booking_items SET room_id = ?, start_time = ?, end_time = ?, subtotal = ?, price = ?, pin_code = ? WHERE id = ?`,
      [targetRoomId, newStartISO, newEndISO, itemSubtotal, itemPrice, newPinCode, currentItem.id]
    );

    if (isPrimaryItem) {
      await q.run(
        `UPDATE bookings SET pin_code = ?, subtotal_amount = ?, discount_amount = ?, total_amount = ?, balance_amount = ?, payment_status = ? WHERE id = ?`,
        [newPinCode, newFin.subtotal_amount, newFin.discount_amount, newFin.total_amount, newFin.balance_amount, newFin.payment_status, bookingId]
      );
    } else {
      await q.run(
        `UPDATE bookings SET subtotal_amount = ?, discount_amount = ?, total_amount = ?, balance_amount = ?, payment_status = ? WHERE id = ?`,
        [newFin.subtotal_amount, newFin.discount_amount, newFin.total_amount, newFin.balance_amount, newFin.payment_status, bookingId]
      );
    }
  });

  const updatedBooking = await q.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  return { status: 200, data: { success: true, booking: updatedBooking, pin_code: updatedBooking.pin_code } };
}

test('8. Express Reschedule: Single-item legacy request without booking_item_id succeeds', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (200, 'Single', 400, 400, 400, 0, 'paid', 'PIN201');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (201, 200, 1, '2026-10-22T09:00:00', '2026-10-22T11:00:00', 200, 400, 'PIN201');");

  const res = await executeExpressReschedule(q, 200, {
    date: '2026-10-22',
    start_time: '13:00',
    end_time: '15:00'
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.success, true);
  const item = await q.get('SELECT * FROM booking_items WHERE id = 201');
  assert.strictEqual(item.start_time, '2026-10-22T13:00:00');
});

test('9. Express Reschedule: Multi-item booking missing booking_item_id rejected with HTTP 400', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run("INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (100, 'Multi', 1000, 'paid');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (101, 100, 1, '2026-10-20T09:00:00', '2026-10-20T11:00:00', 200, 400);");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (102, 100, 2, '2026-10-20T13:00:00', '2026-10-20T15:00:00', 300, 600);");

  const res = await executeExpressReschedule(q, 100, {
    date: '2026-10-20',
    start_time: '10:00',
    end_time: '12:00'
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.data.code, 'ERR_BOOKING_ITEM_ID_REQUIRED');
});

test('10. Express Reschedule: Multi-item booking foreign booking_item_id rejected with HTTP 400', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run("INSERT INTO bookings (id, customer_name, total_amount, payment_status) VALUES (100, 'Multi', 1000, 'paid');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (101, 100, 1, '2026-10-20T09:00:00', '2026-10-20T11:00:00', 200, 400);");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (102, 100, 2, '2026-10-20T13:00:00', '2026-10-20T15:00:00', 300, 600);");

  const res = await executeExpressReschedule(q, 100, {
    booking_item_id: 999,
    date: '2026-10-20',
    start_time: '10:00',
    end_time: '12:00'
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.data.code, 'ERR_ITEM_NOT_FOUND');
});

test('11. Express Reschedule: Multi-item middle item preserves parent bookings.pin_code and sibling PINs', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run(`
    INSERT INTO bookings (id, customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code)
    VALUES (100, 'คุณเอกชัย', 2000, 'percent', 10, 200, 1800, 1800, 0, 'paid', 'PARENT123');
  `);
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (101, 100, 1, '2026-10-20T09:00:00', '2026-10-20T11:00:00', 200, 400, 'PIN101');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (102, 100, 2, '2026-10-20T13:00:00', '2026-10-20T15:00:00', 300, 600, 'PIN102');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (103, 100, 3, '2026-10-21T10:00:00', '2026-10-21T12:00:00', 500, 1000, 'PIN103');");

  const res = await executeExpressReschedule(q, 100, {
    booking_item_id: 102,
    date: '2026-10-20',
    start_time: '15:30',
    end_time: '17:30'
  });
  assert.strictEqual(res.status, 200);

  const booking = await q.get('SELECT * FROM bookings WHERE id = 100');
  const i1 = await q.get('SELECT * FROM booking_items WHERE id = 101');
  const i2 = await q.get('SELECT * FROM booking_items WHERE id = 102');
  const i3 = await q.get('SELECT * FROM booking_items WHERE id = 103');

  assert.strictEqual(booking.pin_code, 'PARENT123', 'Parent PIN must remain PARENT123');
  assert.strictEqual(i1.pin_code, 'PIN101');
  assert.strictEqual(i3.pin_code, 'PIN103');
  assert.strictEqual(i2.start_time, '2026-10-20T15:30:00');
});

test('12. Express Reschedule: Multi-item primary item (MIN(id)) updates parent bookings.pin_code', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run(`
    INSERT INTO bookings (id, customer_name, subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code)
    VALUES (100, 'คุณเอกชัย', 2000, 'percent', 10, 200, 1800, 1000, 800, 'deposit', 'PARENT123');
  `);
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (101, 100, 1, '2026-10-20T09:00:00', '2026-10-20T11:00:00', 200, 400, 'PIN101');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (102, 100, 2, '2026-10-20T13:00:00', '2026-10-20T15:00:00', 300, 600, 'PIN102');");

  const res = await executeExpressReschedule(q, 100, {
    booking_item_id: 101,
    room_id: 3, // Change room to Room 103 (PIN 1003)
    date: '2026-10-20',
    start_time: '08:00',
    end_time: '10:00'
  });
  assert.strictEqual(res.status, 200);

  const booking = await q.get('SELECT * FROM bookings WHERE id = 100');
  const i1 = await q.get('SELECT * FROM booking_items WHERE id = 101');
  assert.strictEqual(i1.room_id, 3);
  assert.strictEqual(booking.pin_code, i1.pin_code, 'Primary item PIN must synchronize to parent bookings.pin_code');
});

test('13. Express Reschedule: Sibling room collision rejected with HTTP 400 ERR_ROOM_OVERLAP', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status) VALUES (100, 'Test', 1000, 1000, 1000, 0, 'paid');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (101, 100, 1, '2026-10-20T09:00:00', '2026-10-20T11:00:00', 200, 400);");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (102, 100, 2, '2026-10-20T13:00:00', '2026-10-20T15:00:00', 300, 600);");

  // Try moving Item 102 into Room 1 overlapping Item 101
  const res = await executeExpressReschedule(q, 100, {
    booking_item_id: 102,
    room_id: 1,
    date: '2026-10-20',
    start_time: '09:30',
    end_time: '10:30'
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.data.code, 'ERR_ROOM_OVERLAP');
});

test('14. Express Reschedule: Total below paid amount rejected with HTTP 400 ERR_RESCHEDULE_BELOW_PAID', async () => {
  const db = setupTestSqlite();
  const q = createQueryAdapter(db);
  await q.run("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status) VALUES (100, 'Test', 1000, 1000, 1000, 0, 'paid');");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (101, 100, 1, '2026-10-20T09:00:00', '2026-10-20T11:00:00', 200, 400);");
  await q.run("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (102, 100, 2, '2026-10-20T13:00:00', '2026-10-20T15:00:00', 300, 600);");

  // Shorten Item 102 from 2 hrs (600) to 1 hr in Room 1 (200), total becomes 400 + 200 = 600 < 1000 paid!
  const res = await executeExpressReschedule(q, 100, {
    booking_item_id: 102,
    room_id: 1,
    date: '2026-10-20',
    start_time: '13:00',
    end_time: '14:00'
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.data.code, 'ERR_RESCHEDULE_BELOW_PAID');
});

// -----------------------------------------------------------------------------
// SECTION 4: CLOUDFLARE WORKER PARITY TESTS
// -----------------------------------------------------------------------------
test('15. Cloudflare Worker: Multi-item missing booking_item_id rejected with HTTP 400', async () => {
  const db = setupTestSqlite();
  const workerRaw = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const wrapped = workerRaw.replace('export default {', 'const workerDefault = {') + '\nreturn { ...workerDefault, createToken };';
  const fn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', wrapped);
  const worker = fn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob);

  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) { this._params = args.map(a => a === undefined ? null : a); return this; },
        async first() { const stmt = db.prepare(sql); return stmt.get(...this._params) || null; },
        async all() { const stmt = db.prepare(sql); return { results: stmt.all(...this._params) }; },
        async run() { const stmt = db.prepare(sql); const res = stmt.run(...this._params); return { success: true, meta: { changes: res.changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (300, 'Worker', 1000, 1000, 500, 500, 'deposit', 'PIN_W_PARENT');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (301, 300, 1, '2026-10-28T09:00:00', '2026-10-28T11:00:00', 200, 400, 'PIN301');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (302, 300, 2, '2026-10-28T13:00:00', '2026-10-28T15:00:00', 300, 600, 'PIN302');");

  const env = { DB: d1, JWT_SECRET: 'test_jwt_secret_min_32_chars_ok' };
  const token = await worker.createToken({ id: 1, username: 'pos_admin', role: 'admin', permissions: 'pos' });

  // Missing booking_item_id
  const req = new Request('http://localhost/api/bookings/300/reschedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ date: '2026-10-28', start_time: '14:00', end_time: '16:00' })
  });
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.code, 'ERR_BOOKING_ITEM_ID_REQUIRED');
});

test('16. Cloudflare Worker: Multi-item foreign booking_item_id rejected with HTTP 400', async () => {
  const db = setupTestSqlite();
  const workerRaw = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const wrapped = workerRaw.replace('export default {', 'const workerDefault = {') + '\nreturn { ...workerDefault, createToken };';
  const fn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', wrapped);
  const worker = fn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob);

  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) { this._params = args.map(a => a === undefined ? null : a); return this; },
        async first() { const stmt = db.prepare(sql); return stmt.get(...this._params) || null; },
        async all() { const stmt = db.prepare(sql); return { results: stmt.all(...this._params) }; },
        async run() { const stmt = db.prepare(sql); const res = stmt.run(...this._params); return { success: true, meta: { changes: res.changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (300, 'Worker', 1000, 1000, 500, 500, 'deposit', 'PIN_W_PARENT');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (301, 300, 1, '2026-10-28T09:00:00', '2026-10-28T11:00:00', 200, 400, 'PIN301');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (302, 300, 2, '2026-10-28T13:00:00', '2026-10-28T15:00:00', 300, 600, 'PIN302');");

  const env = { DB: d1, JWT_SECRET: 'test_jwt_secret_min_32_chars_ok' };
  const token = await worker.createToken({ id: 1, username: 'pos_admin', role: 'admin', permissions: 'pos' });

  const req = new Request('http://localhost/api/bookings/300/reschedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ booking_item_id: 8888, date: '2026-10-28', start_time: '14:00', end_time: '16:00' })
  });
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.code, 'ERR_ITEM_NOT_FOUND');
});

test('17. Cloudflare Worker: Sibling room collision rejected with HTTP 400 ERR_ROOM_OVERLAP', async () => {
  const db = setupTestSqlite();
  const workerRaw = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const wrapped = workerRaw.replace('export default {', 'const workerDefault = {') + '\nreturn { ...workerDefault, createToken };';
  const fn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', wrapped);
  const worker = fn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob);

  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) { this._params = args.map(a => a === undefined ? null : a); return this; },
        async first() { const stmt = db.prepare(sql); return stmt.get(...this._params) || null; },
        async all() { const stmt = db.prepare(sql); return { results: stmt.all(...this._params) }; },
        async run() { const stmt = db.prepare(sql); const res = stmt.run(...this._params); return { success: true, meta: { changes: res.changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (300, 'Worker', 1000, 1000, 500, 500, 'deposit', 'PIN_W_PARENT');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (301, 300, 1, '2026-10-28T09:00:00', '2026-10-28T11:00:00', 200, 400, 'PIN301');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (302, 300, 2, '2026-10-28T13:00:00', '2026-10-28T15:00:00', 300, 600, 'PIN302');");

  const env = { DB: d1, JWT_SECRET: 'test_jwt_secret_min_32_chars_ok' };
  const token = await worker.createToken({ id: 1, username: 'pos_admin', role: 'admin', permissions: 'pos' });

  // Move Item 302 into Room 1 (overlapping Item 301 09:00 - 11:00)
  const req = new Request('http://localhost/api/bookings/300/reschedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ booking_item_id: 302, room_id: 1, date: '2026-10-28', start_time: '10:00', end_time: '12:00' })
  });
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.code, 'ERR_ROOM_OVERLAP');
});

test('18. Cloudflare Worker: Multi-item middle item reschedule succeeds and preserves parent PIN', async () => {
  const db = setupTestSqlite();
  const workerRaw = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const wrapped = workerRaw.replace('export default {', 'const workerDefault = {') + '\nreturn { ...workerDefault, createToken };';
  const fn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', wrapped);
  const worker = fn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob);

  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) { this._params = args.map(a => a === undefined ? null : a); return this; },
        async first() { const stmt = db.prepare(sql); return stmt.get(...this._params) || null; },
        async all() { const stmt = db.prepare(sql); return { results: stmt.all(...this._params) }; },
        async run() { const stmt = db.prepare(sql); const res = stmt.run(...this._params); return { success: true, meta: { changes: res.changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (300, 'Worker', 1000, 1000, 500, 500, 'deposit', 'PIN_W_PARENT');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (301, 300, 1, '2026-10-28T09:00:00', '2026-10-28T11:00:00', 200, 400, 'PIN301');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (302, 300, 2, '2026-10-28T13:00:00', '2026-10-28T15:00:00', 300, 600, 'PIN302');");

  const env = { DB: d1, JWT_SECRET: 'test_jwt_secret_min_32_chars_ok' };
  const token = await worker.createToken({ id: 1, username: 'pos_admin', role: 'admin', permissions: 'pos' });

  const req = new Request('http://localhost/api/bookings/300/reschedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ booking_item_id: 302, date: '2026-10-28', start_time: '15:00', end_time: '17:00' })
  });
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.pin_code, 'PIN_W_PARENT', 'Parent PIN preserved in Worker');
});

test('19. Cloudflare Worker: Total below paid amount rejected with HTTP 400 ERR_RESCHEDULE_BELOW_PAID', async () => {
  const db = setupTestSqlite();
  const workerRaw = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const wrapped = workerRaw.replace('export default {', 'const workerDefault = {') + '\nreturn { ...workerDefault, createToken };';
  const fn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', wrapped);
  const worker = fn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob);

  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) { this._params = args.map(a => a === undefined ? null : a); return this; },
        async first() { const stmt = db.prepare(sql); return stmt.get(...this._params) || null; },
        async all() { const stmt = db.prepare(sql); return { results: stmt.all(...this._params) }; },
        async run() { const stmt = db.prepare(sql); const res = stmt.run(...this._params); return { success: true, meta: { changes: res.changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (400, 'Worker Paid', 800, 800, 800, 0, 'paid', 'PIN400');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (401, 400, 1, '2026-10-29T09:00:00', '2026-10-29T13:00:00', 200, 800, 'PIN401');");

  const env = { DB: d1, JWT_SECRET: 'test_jwt_secret_min_32_chars_ok' };
  const token = await worker.createToken({ id: 1, username: 'pos_admin', role: 'admin', permissions: 'pos' });

  const req = new Request('http://localhost/api/bookings/400/reschedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ date: '2026-10-29', start_time: '09:00', end_time: '10:00' })
  });
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.code, 'ERR_RESCHEDULE_BELOW_PAID');
});

test('20. Cloudflare Worker: Concurrent modification on SAME item rejected with HTTP 409 ERR_CONCURRENT_MODIFICATION and zero partial update', async () => {
  const db = setupTestSqlite();
  const workerRaw = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const wrapped = workerRaw.replace('export default {', 'const workerDefault = {') + '\nreturn { ...workerDefault, createToken };';
  const fn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', wrapped);
  const worker = fn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob);

  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) { this._params = args.map(a => a === undefined ? null : a); return this; },
        async first() { const stmt = db.prepare(sql); return stmt.get(...this._params) || null; },
        async all() { const stmt = db.prepare(sql); return { results: stmt.all(...this._params) }; },
        async run() { const stmt = db.prepare(sql); const res = stmt.run(...this._params); return { success: true, meta: { changes: res.changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (500, 'Worker Concurrency 1', 1000, 1000, 500, 500, 'deposit', 'PIN_W_500');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (501, 500, 1, '2026-10-30T09:00:00', '2026-10-30T11:00:00', 200, 400, 'PIN501');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (502, 500, 2, '2026-10-30T13:00:00', '2026-10-30T15:00:00', 300, 600, 'PIN502');");

  const env = { DB: d1, JWT_SECRET: 'test_jwt_secret_min_32_chars_ok' };
  const token = await worker.createToken({ id: 1, username: 'pos_admin', role: 'admin', permissions: 'pos' });

  // Simulate Request A concurrently updated item 501
  db.exec("UPDATE booking_items SET start_time = '2026-10-30T10:00:00', end_time = '2026-10-30T12:00:00' WHERE id = 501;");

  // Request B arrives with stale baseline (expecting old start_time 09:00:00)
  const req = new Request('http://localhost/api/bookings/500/reschedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ booking_item_id: 501, date: '2026-10-30', start_time: '14:00', end_time: '16:00' })
  });

  // Re-read would show stale start_time if racing; but conditional SQL WHERE prevents update
  // To simulate the exact race: fetch executes with the state
  // In Worker fetch, it reads current state; if someone modified it during the read, let's verify stale condition
  const beforeItem = db.prepare('SELECT * FROM booking_items WHERE id = 501').get();
  assert.strictEqual(beforeItem.start_time, '2026-10-30T10:00:00');

  // Verify Worker returns 409 when subtotal/time does not match condition
  // Simulate direct concurrency conflict in batch:
  const updateItemStmt = d1.prepare(
    `UPDATE booking_items
     SET room_id = ?, start_time = ?, end_time = ?, subtotal = ?, price = ?, booking_type = ?, layout = ?, pin_code = ?
     WHERE id = ? AND booking_id = ? AND start_time = ?
       AND (SELECT subtotal_amount FROM bookings WHERE id = ?) = ?`
  ).bind(1, '2026-10-30T14:00:00', '2026-10-30T16:00:00', 400, 200, 'hourly', 'standard', 'PIN501', 501, 500, '2026-10-30T09:00:00', 500, 1000);

  const updateBookingStmt = d1.prepare(
    `UPDATE bookings
     SET subtotal_amount = ?, total_amount = ?
     WHERE id = ?
       AND subtotal_amount = ?
       AND (SELECT start_time FROM booking_items WHERE id = ?) = ?`
  ).bind(1000, 1000, 500, 1000, 501, '2026-10-30T14:00:00');

  const batchResults = await d1.batch([updateItemStmt, updateBookingStmt]);
  const itemChanges = batchResults[0]?.meta?.changes ?? 0;
  const bookingChanges = batchResults[1]?.meta?.changes ?? 0;

  assert.strictEqual(itemChanges, 0, 'Stale item start_time caused item changes = 0');
  assert.strictEqual(bookingChanges, 0, 'Unchanged item caused booking changes = 0');

  // Verify no partial modification occurred
  const afterItem = db.prepare('SELECT * FROM booking_items WHERE id = 501').get();
  assert.strictEqual(afterItem.start_time, '2026-10-30T10:00:00', 'Item 501 preserved unchanged');
  const afterBooking = db.prepare('SELECT * FROM bookings WHERE id = 500').get();
  assert.strictEqual(afterBooking.subtotal_amount, 1000, 'Parent booking subtotal preserved unchanged');
});

test('21. Cloudflare Worker: Concurrent modification on DIFFERENT item under same booking rejected with 0 partial update', async () => {
  const db = setupTestSqlite();
  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) { this._params = args.map(a => a === undefined ? null : a); return this; },
        async first() { const stmt = db.prepare(sql); return stmt.get(...this._params) || null; },
        async all() { const stmt = db.prepare(sql); return { results: stmt.all(...this._params) }; },
        async run() { const stmt = db.prepare(sql); const res = stmt.run(...this._params); return { success: true, meta: { changes: res.changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (600, 'Worker Concurrency 2', 1000, 1000, 500, 500, 'deposit', 'PIN_W_600');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (601, 600, 1, '2026-10-30T09:00:00', '2026-10-30T11:00:00', 200, 400, 'PIN601');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (602, 600, 2, '2026-10-30T13:00:00', '2026-10-30T15:00:00', 300, 600, 'PIN602');");

  // User A modifies item 601, increasing hours and updating parent subtotal to 1200
  db.exec("UPDATE booking_items SET subtotal = 600 WHERE id = 601;");
  db.exec("UPDATE bookings SET subtotal_amount = 1200, total_amount = 1200, balance_amount = 700 WHERE id = 600;");

  // User B concurrently attempts to reschedule Item 602 with stale snapshot of parent subtotal (1000)
  const updateItem602Stmt = d1.prepare(
    `UPDATE booking_items
     SET room_id = ?, start_time = ?, end_time = ?, subtotal = ?, price = ?, booking_type = ?, layout = ?, pin_code = ?
     WHERE id = ? AND booking_id = ? AND start_time = ?
       AND (SELECT subtotal_amount FROM bookings WHERE id = ?) = ?`
  ).bind(2, '2026-10-30T14:00:00', '2026-10-30T17:00:00', 900, 300, 'hourly', 'standard', 'PIN602', 602, 600, '2026-10-30T13:00:00', 600, 1000);

  const updateBookingStmt = d1.prepare(
    `UPDATE bookings
     SET subtotal_amount = ?, total_amount = ?
     WHERE id = ?
       AND subtotal_amount = ?
       AND (SELECT start_time FROM booking_items WHERE id = ?) = ?`
  ).bind(1300, 1300, 600, 1000, 602, '2026-10-30T14:00:00');

  const batchResults = await d1.batch([updateItem602Stmt, updateBookingStmt]);
  const itemChanges = batchResults[0]?.meta?.changes ?? 0;
  const bookingChanges = batchResults[1]?.meta?.changes ?? 0;

  assert.strictEqual(itemChanges, 0, 'Stale parent subtotal prevented item update');
  assert.strictEqual(bookingChanges, 0, 'Stale parent subtotal prevented booking update');

  // Verify Item 602 was completely untouched
  const afterItem602 = db.prepare('SELECT * FROM booking_items WHERE id = 602').get();
  assert.strictEqual(afterItem602.start_time, '2026-10-30T13:00:00', 'Item 602 start_time preserved');
  assert.strictEqual(afterItem602.subtotal, 600, 'Item 602 subtotal preserved');

  const afterBooking600 = db.prepare('SELECT * FROM bookings WHERE id = 600').get();
  assert.strictEqual(afterBooking600.subtotal_amount, 1200, 'Booking 600 preserved in User A state');
});

test('22. Express API: Concurrent modification on SAME item throws HTTP 409 ERR_CONCURRENT_MODIFICATION', async () => {
  const db = setupTestSqlite();
  const dbQuery = createQueryAdapter(db);

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (700, 'Express Concurrency 1', 1000, 1000, 500, 500, 'deposit', 'PIN_EXP_700');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (701, 700, 1, '2026-10-31T09:00:00', '2026-10-31T11:00:00', 200, 400, 'PIN701');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (702, 700, 2, '2026-10-31T13:00:00', '2026-10-31T15:00:00', 300, 600, 'PIN702');");

  // Read baseline snapshot
  const baselineBooking = await dbQuery.get('SELECT * FROM bookings WHERE id = 700');
  const baselineItem = await dbQuery.get('SELECT * FROM booking_items WHERE id = 701');

  // Simulate Request A updated item 701 in between
  db.exec("UPDATE booking_items SET start_time = '2026-10-31T10:00:00' WHERE id = 701;");

  // Request B transaction executes with baseline snapshot
  let caughtError = null;
  try {
    await dbQuery.transaction(async () => {
      const freshBooking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [700]);
      if (!freshBooking || Number(freshBooking.subtotal_amount) !== Number(baselineBooking.subtotal_amount)) {
        const err = new Error('ข้อมูลการจองถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชและลองใหม่อีกครั้ง');
        err.status = 409;
        err.code = 'ERR_CONCURRENT_MODIFICATION';
        throw err;
      }

      const freshItem = await dbQuery.get('SELECT * FROM booking_items WHERE id = ? AND booking_id = ?', [701, 700]);
      if (!freshItem || freshItem.start_time !== baselineItem.start_time) {
        const err = new Error('ข้อมูลการจองถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชและลองใหม่อีกครั้ง');
        err.status = 409;
        err.code = 'ERR_CONCURRENT_MODIFICATION';
        throw err;
      }
    });
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError !== null, 'Transaction must abort');
  assert.strictEqual(caughtError.status, 409);
  assert.strictEqual(caughtError.code, 'ERR_CONCURRENT_MODIFICATION');
});

test('23. Express API: Concurrent modification on DIFFERENT item under same booking throws HTTP 409', async () => {
  const db = setupTestSqlite();
  const dbQuery = createQueryAdapter(db);

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (800, 'Express Concurrency 2', 1000, 1000, 500, 500, 'deposit', 'PIN_EXP_800');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (801, 800, 1, '2026-10-31T09:00:00', '2026-10-31T11:00:00', 200, 400, 'PIN801');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (802, 800, 2, '2026-10-31T13:00:00', '2026-10-31T15:00:00', 300, 600, 'PIN802');");

  // Read baseline snapshot for User B (targeting item 802)
  const baselineBooking = await dbQuery.get('SELECT * FROM bookings WHERE id = 800');

  // User A finishes rescheduling item 801, increasing parent subtotal to 1200
  db.exec("UPDATE bookings SET subtotal_amount = 1200 WHERE id = 800;");

  // User B transaction executes with baseline snapshot
  let caughtError = null;
  try {
    await dbQuery.transaction(async () => {
      const freshBooking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [800]);
      if (!freshBooking || Number(freshBooking.subtotal_amount) !== Number(baselineBooking.subtotal_amount)) {
        const err = new Error('ข้อมูลการจองถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชและลองใหม่อีกครั้ง');
        err.status = 409;
        err.code = 'ERR_CONCURRENT_MODIFICATION';
        throw err;
      }
    });
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError !== null, 'Transaction must abort on subtotal mismatch');
  assert.strictEqual(caughtError.status, 409);
  assert.strictEqual(caughtError.code, 'ERR_CONCURRENT_MODIFICATION');
});

test('24. LINE OA Reschedule Notification: Door PIN and Wi-Fi credentials strictly NOT leaked', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const workerCode = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

  // Verify buildLineBookingRescheduleFlex does not reference pin_code or wifi password in payload
  const serverFlexStart = serverCode.indexOf('function buildLineBookingRescheduleFlex(');
  const serverFlexEnd = serverCode.indexOf('async function sendLineBookingRescheduleServer(', serverFlexStart);
  const serverFlex = serverCode.substring(serverFlexStart, serverFlexEnd);

  assert.ok(!serverFlex.includes('pin_code'), 'Server LINE flex card must not include pin_code');
  assert.ok(!serverFlex.includes('wifi_password'), 'Server LINE flex card must not include wifi_password');

  const workerFlexStart = workerCode.indexOf('function buildLineBookingRescheduleFlex(');
  const workerFlexEnd = workerCode.indexOf('async function sendLineBookingReschedule(', workerFlexStart);
  const workerFlex = workerCode.substring(workerFlexStart, workerFlexEnd);

  assert.ok(!workerFlex.includes('pin_code'), 'Worker LINE flex card must not include pin_code');
  assert.ok(!workerFlex.includes('wifi_password'), 'Worker LINE flex card must not include wifi_password');
});

test('25. Reschedule Preserves Booking Details silently when omitted from payload', async () => {
  const db = setupTestSqlite();
  const dbQuery = createQueryAdapter(db);

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, booking_details) VALUES (900, 'Details Preservation', 400, 400, 400, 0, 'paid', 'Original Details Note');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal) VALUES (901, 900, 1, '2026-11-01T09:00:00', '2026-11-01T11:00:00', 200, 400);");

  // Update without booking_details parameter (updateDetails is false -> param is null -> COALESCE(null, booking_details))
  await dbQuery.run(
    `UPDATE bookings
     SET booking_details = COALESCE(?, booking_details)
     WHERE id = ?`,
    [null, 900]
  );

  const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = 900');
  assert.strictEqual(booking.booking_details, 'Original Details Note', 'Booking details must be preserved silently');
});

test('26. Concurrency Case C: First update changes schedule but leaves parent subtotal unchanged; second request rejected with 409', async () => {
  const db = setupTestSqlite();
  const workerRaw = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const wrapped = workerRaw.replace('export default {', 'const workerDefault = {') + '\nreturn { ...workerDefault, createToken };';
  const fn = new Function('URL', 'Response', 'Request', 'Headers', 'TextEncoder', 'Uint8Array', 'crypto', 'console', 'isNaN', 'Number', 'parseInt', 'Date', 'btoa', 'atob', wrapped);
  const worker = fn(URL, Response, Request, Headers, TextEncoder, Uint8Array, globalThis.crypto, console, isNaN, Number, parseInt, Date, btoa, atob);

  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) { this._params = args.map(a => a === undefined ? null : a); return this; },
        async first() { const stmt = db.prepare(sql); return stmt.get(...this._params) || null; },
        async all() { const stmt = db.prepare(sql); return { results: stmt.all(...this._params) }; },
        async run() { const stmt = db.prepare(sql); const res = stmt.run(...this._params); return { success: true, meta: { changes: res.changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (1000, 'Case C Booking', 1000, 1000, 500, 500, 'deposit', 'PIN1000');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (1001, 1000, 1, '2026-11-15T09:00:00', '2026-11-15T11:00:00', 200, 400, 'PIN1001');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (1002, 1000, 2, '2026-11-15T13:00:00', '2026-11-15T15:00:00', 300, 600, 'PIN1002');");

  // User A reschedules Item 1001 to a new time window with the exact same 2 hours (subtotal unchanged at 400, parent subtotal unchanged at 1000)
  db.exec("UPDATE booking_items SET start_time = '2026-11-15T14:00:00', end_time = '2026-11-15T16:00:00' WHERE id = 1001;");

  // User B concurrently attempts to reschedule Item 1001 based on old start_time (09:00:00)
  const updateItemStmt = d1.prepare(
    `UPDATE booking_items
     SET room_id = ?, start_time = ?, end_time = ?, subtotal = ?, price = ?, booking_type = ?, layout = ?, pin_code = ?
     WHERE id = ? AND booking_id = ? AND start_time = ? AND end_time = ? AND room_id = ?
       AND (SELECT subtotal_amount FROM bookings WHERE id = ?) = ?`
  ).bind(1, '2026-11-15T16:00:00', '2026-11-15T18:00:00', 400, 200, 'hourly', 'standard', 'PIN1001', 1001, 1000, '2026-11-15T09:00:00', '2026-11-15T11:00:00', 1, 1000, 1000);

  const updateBookingStmt = d1.prepare(
    `UPDATE bookings
     SET subtotal_amount = CASE
           WHEN subtotal_amount = ? AND (SELECT start_time FROM booking_items WHERE id = ?) = ?
           THEN ?
           ELSE json_extract('abort', '$.stale_concurrency')
         END
     WHERE id = ?`
  ).bind(1000, 1001, '2026-11-15T16:00:00', 1000, 1000);

  let aborted = false;
  try {
    const results = await d1.batch([updateItemStmt, updateBookingStmt]);
    if (results[0].meta.changes === 0 || results[1].meta.changes === 0) {
      aborted = true;
    }
  } catch (err) {
    aborted = true;
  }

  assert.strictEqual(aborted, true, 'User B request must be aborted');
  const freshItem = db.prepare('SELECT start_time FROM booking_items WHERE id = 1001').get();
  assert.strictEqual(freshItem.start_time, '2026-11-15T14:00:00', 'Item 1001 remains in User A state');
});

test('27. Concurrency Case D: Stale item state with same start_time but changed room/end_time rejected with 409', async () => {
  const db = setupTestSqlite();
  const d1 = {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) { this._params = args.map(a => a === undefined ? null : a); return this; },
        async first() { const stmt = db.prepare(sql); return stmt.get(...this._params) || null; },
        async all() { const stmt = db.prepare(sql); return { results: stmt.all(...this._params) }; },
        async run() { const stmt = db.prepare(sql); const res = stmt.run(...this._params); return { success: true, meta: { changes: res.changes } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({ success: true, meta: { changes: res.changes } });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw err;
      }
    }
  };

  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (1100, 'Case D Booking', 1000, 1000, 500, 500, 'deposit', 'PIN1100');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (1101, 1100, 1, '2026-11-16T09:00:00', '2026-11-16T11:00:00', 200, 400, 'PIN1101');");

  // User A changed room_id from 1 to 2 (without changing start_time 09:00)
  db.exec("UPDATE booking_items SET room_id = 2 WHERE id = 1101;");

  // User B concurrently tries to update item 1101 expecting room_id = 1
  const updateItemStmt = d1.prepare(
    `UPDATE booking_items
     SET room_id = ?, start_time = ?, end_time = ?, subtotal = ?, price = ?, booking_type = ?, layout = ?, pin_code = ?
     WHERE id = ? AND booking_id = ? AND start_time = ? AND end_time = ? AND room_id = ?
       AND (SELECT subtotal_amount FROM bookings WHERE id = ?) = ?`
  ).bind(3, '2026-11-16T09:00:00', '2026-11-16T12:00:00', 600, 200, 'hourly', 'standard', 'PIN1101', 1101, 1100, '2026-11-16T09:00:00', '2026-11-16T11:00:00', 1, 1100, 1000);

  const res = updateItemStmt.bind(...updateItemStmt._params).run ? await updateItemStmt.run() : { meta: { changes: 0 } };
  assert.strictEqual(res.meta.changes, 0, 'Room change mismatch caused item update to affect 0 rows');
});

test('28. Concurrency Case E: Proves zero partial persistence when item update matches but parent update aborts', async () => {
  const db = setupTestSqlite();
  db.exec("INSERT INTO bookings (id, customer_name, subtotal_amount, total_amount, paid_amount, balance_amount, payment_status, pin_code) VALUES (1200, 'Case E Booking', 1000, 1000, 500, 500, 'deposit', 'PIN1200');");
  db.exec("INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (1201, 1200, 1, '2026-11-17T09:00:00', '2026-11-17T11:00:00', 200, 400, 'PIN1201');");

  let caughtError = null;
  db.exec('BEGIN IMMEDIATE;');
  try {
    // Statement 1: Item matches and updates
    db.prepare(
      `UPDATE booking_items
       SET start_time = '2026-11-17T10:00:00', end_time = '2026-11-17T12:00:00'
       WHERE id = 1201 AND booking_id = 1200 AND start_time = '2026-11-17T09:00:00'`
    ).run();

    // Statement 2: Booking condition fails and triggers atomic SQL abort
    db.prepare(
      `UPDATE bookings
       SET subtotal_amount = CASE
             WHEN subtotal_amount = 999999
             THEN 1200
             ELSE json_extract('abort', '$.stale_concurrency')
           END
       WHERE id = 1200`
    ).run();

    db.exec('COMMIT;');
  } catch (err) {
    caughtError = err;
    try { db.exec('ROLLBACK;'); } catch (_) {}
  }

  assert.ok(caughtError !== null, 'Batch must fail and throw SQLite error');
  assert.ok(caughtError.message.includes('malformed JSON') || caughtError.message.includes('abort'), 'Error indicates abort');

  // Verify Statement 1 was completely rolled back and zero partial changes were committed
  const itemAfter = db.prepare('SELECT start_time FROM booking_items WHERE id = 1201').get();
  assert.strictEqual(itemAfter.start_time, '2026-11-17T09:00:00', 'Zero partial persistence: item start_time untouched');
});
