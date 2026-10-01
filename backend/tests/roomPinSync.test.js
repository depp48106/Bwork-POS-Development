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

// Emulate backend/server.js and backend/worker.js room sync transaction logic
async function updateRoomAndSyncBookings(db, roomId, roomData, nowIso) {
  const NO_PIN_ROOM_IDS = [10, 12, 13];
  function roomUsesDoorPin(r) {
    if (!r) return false;
    const rId = typeof r === 'number' ? r : Number(r.id || r.room_id);
    if (rId && NO_PIN_ROOM_IDS.includes(rId)) return false;
    const name = String(r.name || '').trim();
    if (name && /jupiter/i.test(name)) return false;
    return true;
  }

  const existingRoom = await getQuery(db, 'SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!existingRoom) throw new Error('Room not found');

  const isPinCapable = roomUsesDoorPin(existingRoom);
  const cleanPin = isPinCapable ? (roomData.pin_code && String(roomData.pin_code).trim() ? String(roomData.pin_code).trim() : null) : null;
  const cleanBuiltlandPin = isPinCapable ? (roomData.builtland_pin_code && String(roomData.builtland_pin_code).trim() ? String(roomData.builtland_pin_code).trim() : null) : null;

  let syncedBookingsCount = 0;

  // 1. Update room
  await runQuery(
    db,
    `UPDATE rooms SET name = ?, capacity = ?, hourly_rate = ?, pin_code = ?, builtland_pin_code = ? WHERE id = ?`,
    [
      roomData.name || existingRoom.name,
      roomData.capacity || existingRoom.capacity,
      roomData.hourly_rate || existingRoom.hourly_rate,
      cleanPin,
      cleanBuiltlandPin,
      roomId
    ]
  );

  // 2. Sync if PIN capable
  if (isPinCapable && (roomData.pin_code !== undefined || roomData.builtland_pin_code !== undefined)) {
    const eligibleBookings = await allQuery(
      db,
      `SELECT DISTINCT b.id, b.customer_type
       FROM bookings b
       JOIN booking_items bi ON bi.booking_id = b.id
       WHERE bi.room_id = ?
         AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed'))
         AND (b.checkin_status IS NULL OR b.checkin_status != 'cancelled')
         AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
         AND REPLACE(bi.end_time, ' ', 'T') >= ?`,
      [roomId, nowIso]
    );

    syncedBookingsCount = eligibleBookings.length;

    if (syncedBookingsCount > 0) {
      // General / Walk-in / Basecamp: Update booking_items
      const generalPin = cleanPin;
      await runQuery(
        db,
        `UPDATE booking_items
         SET pin_code = ?
         WHERE room_id = ?
           AND REPLACE(end_time, ' ', 'T') >= ?
           AND (checkin_status IS NULL OR checkin_status != 'cancelled')
           AND booking_id IN (
             SELECT id FROM bookings
             WHERE (payment_status IS NULL OR payment_status NOT IN ('cancelled', 'failed'))
               AND (checkin_status IS NULL OR checkin_status != 'cancelled')
               AND (customer_type != 'builtland' OR customer_type IS NULL)
           )`,
        [generalPin, roomId, nowIso]
      );

      // Update parent bookings ONLY if this room is the primary room (MIN(id) room item)
      await runQuery(
        db,
        `UPDATE bookings
         SET pin_code = ?
         WHERE (payment_status IS NULL OR payment_status NOT IN ('cancelled', 'failed'))
           AND (checkin_status IS NULL OR checkin_status != 'cancelled')
           AND (customer_type != 'builtland' OR customer_type IS NULL)
           AND id IN (
             SELECT bi1.booking_id
             FROM booking_items bi1
             WHERE bi1.room_id = ?
               AND bi1.id = (
                 SELECT MIN(bi2.id)
                 FROM booking_items bi2
                 WHERE bi2.booking_id = bi1.booking_id
                   AND bi2.room_id IS NOT NULL
               )
               AND REPLACE(bi1.end_time, ' ', 'T') >= ?
               AND (bi1.checkin_status IS NULL OR bi1.checkin_status != 'cancelled')
           )`,
        [generalPin, roomId, nowIso]
      );

      // Builtland: Update booking_items
      const builtlandEffectivePin = cleanBuiltlandPin || cleanPin;
      await runQuery(
        db,
        `UPDATE booking_items
         SET pin_code = ?
         WHERE room_id = ?
           AND REPLACE(end_time, ' ', 'T') >= ?
           AND (checkin_status IS NULL OR checkin_status != 'cancelled')
           AND booking_id IN (
             SELECT id FROM bookings
             WHERE (payment_status IS NULL OR payment_status NOT IN ('cancelled', 'failed'))
               AND (checkin_status IS NULL OR checkin_status != 'cancelled')
               AND customer_type = 'builtland'
           )`,
        [builtlandEffectivePin, roomId, nowIso]
      );

      // Update parent bookings for Builtland ONLY if this room is the primary room
      await runQuery(
        db,
        `UPDATE bookings
         SET pin_code = ?
         WHERE (payment_status IS NULL OR payment_status NOT IN ('cancelled', 'failed'))
           AND (checkin_status IS NULL OR checkin_status != 'cancelled')
           AND customer_type = 'builtland'
           AND id IN (
             SELECT bi1.booking_id
             FROM booking_items bi1
             WHERE bi1.room_id = ?
               AND bi1.id = (
                 SELECT MIN(bi2.id)
                 FROM booking_items bi2
                 WHERE bi2.booking_id = bi1.booking_id
                   AND bi2.room_id IS NOT NULL
               )
               AND REPLACE(bi1.end_time, ' ', 'T') >= ?
               AND (bi1.checkin_status IS NULL OR bi1.checkin_status != 'cancelled')
           )`,
        [builtlandEffectivePin, roomId, nowIso]
      );
    }
  }

  return { success: true, synced_bookings_count: syncedBookingsCount };
}

test('Room PIN Sync Test Suite', async (t) => {
  const db = new sqlite3.Database(DB_PATH);
  const nowIso = '2026-10-01T12:00:00';

  // Setup test rooms
  const ROOM_A = 9901;
  const ROOM_B = 9902;
  const NO_PIN_ROOM = 10; // Jupiter 10

  await runQuery(db, 'DELETE FROM booking_items WHERE room_id IN (?, ?)', [ROOM_A, ROOM_B]);
  await runQuery(db, 'DELETE FROM rooms WHERE id IN (?, ?)', [ROOM_A, ROOM_B]);

  await runQuery(db, "INSERT INTO rooms (id, name, capacity, hourly_rate, pin_code, status) VALUES (?, 'Test Mars', 10, 500, '111111', 'active')", [ROOM_A]);
  await runQuery(db, "INSERT INTO rooms (id, name, capacity, hourly_rate, pin_code, status) VALUES (?, 'Test Venus', 8, 400, '333333', 'active')", [ROOM_B]);

  // Clean up any test bookings
  const createdBookingIds = [];

  async function createBooking(name, roomId, startStr, endStr, paymentStatus = 'paid', customerType = 'walkin', initialPin = '111111') {
    const bRes = await runQuery(
      db,
      "INSERT INTO bookings (customer_name, total_amount, payment_status, pin_code, customer_type) VALUES (?, 500, ?, ?, ?)",
      [name, paymentStatus, initialPin, customerType]
    );
    const bId = bRes.id;
    createdBookingIds.push(bId);
    await runQuery(
      db,
      "INSERT INTO booking_items (booking_id, room_id, price, subtotal, start_time, end_time, pin_code) VALUES (?, ?, 500, 500, ?, ?, ?)",
      [bId, roomId, startStr, endStr, initialPin]
    );
    return bId;
  }

  async function createMultiItemBooking(name, items, paymentStatus = 'paid', customerType = 'walkin', parentPin = null) {
    const bRes = await runQuery(
      db,
      "INSERT INTO bookings (customer_name, total_amount, payment_status, pin_code, customer_type) VALUES (?, 1000, ?, ?, ?)",
      [name, paymentStatus, parentPin, customerType]
    );
    const bId = bRes.id;
    createdBookingIds.push(bId);
    for (const item of items) {
      await runQuery(
        db,
        "INSERT INTO booking_items (booking_id, room_id, price, subtotal, start_time, end_time, pin_code) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [bId, item.room_id, item.price || 500, item.subtotal || 500, item.start_time, item.end_time, item.pin_code]
      );
    }
    return bId;
  }

  // 1. Future Booking for Room A
  const futureId = await createBooking('Future Booking', ROOM_A, '2099-01-01T10:00:00', '2099-01-01T11:00:00', 'paid', 'walkin', '111111');

  // 2. Historical/Past Booking for Room A
  const pastId = await createBooking('Past Booking', ROOM_A, '2020-01-01T10:00:00', '2020-01-01T11:00:00', 'paid', 'walkin', '111111');

  // 3. Cancelled Booking for Room A
  const cancelledId = await createBooking('Cancelled Booking', ROOM_A, '2099-01-01T14:00:00', '2099-01-01T15:00:00', 'cancelled', 'walkin', '111111');

  // 4. Other Room B Booking
  const otherRoomId = await createBooking('Other Room Booking', ROOM_B, '2099-01-01T10:00:00', '2099-01-01T11:00:00', 'paid', 'walkin', '333333');

  // 5. Builtland Future Booking for Room A
  const builtlandId = await createBooking('Builtland Booking', ROOM_A, '2099-01-01T16:00:00', '2099-01-01T17:00:00', 'internal_free', 'builtland', '111111');

  await t.test('1. Future booking PIN updates when Room PIN changes to 222222', async () => {
    const res = await updateRoomAndSyncBookings(db, ROOM_A, { pin_code: '222222', builtland_pin_code: '777777' }, nowIso);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.synced_bookings_count, 2, 'Should sync 2 eligible future bookings (future regular + future builtland)');

    const updatedFutureBooking = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [futureId]);
    const updatedFutureItem = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [futureId]);
    assert.strictEqual(updatedFutureBooking.pin_code, '222222', 'Future booking should receive new PIN');
    assert.strictEqual(updatedFutureItem.pin_code, '222222', 'Future booking_item should receive new PIN');
  });

  await t.test('2. Historical / completed booking PIN remains unchanged', async () => {
    const pastBooking = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [pastId]);
    const pastItem = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [pastId]);
    assert.strictEqual(pastBooking.pin_code, '111111', 'Past booking PIN must retain historical snapshot');
    assert.strictEqual(pastItem.pin_code, '111111', 'Past booking_item PIN must retain historical snapshot');
  });

  await t.test('3. Cancelled booking PIN remains unchanged', async () => {
    const cancelBooking = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [cancelledId]);
    const cancelItem = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [cancelledId]);
    assert.strictEqual(cancelBooking.pin_code, '111111', 'Cancelled booking PIN must not be modified');
    assert.strictEqual(cancelItem.pin_code, '111111', 'Cancelled booking_item PIN must not be modified');
  });

  await t.test('4. Other room bookings remain completely isolated and unchanged', async () => {
    const otherBooking = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [otherRoomId]);
    const otherItem = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [otherRoomId]);
    assert.strictEqual(otherBooking.pin_code, '333333', 'Other room booking PIN must remain unchanged');
    assert.strictEqual(otherItem.pin_code, '333333', 'Other room booking_item PIN must remain unchanged');
  });

  await t.test('5. Builtland bookings receive builtland_pin_code when configured', async () => {
    const bBooking = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [builtlandId]);
    const bItem = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [builtlandId]);
    assert.strictEqual(bBooking.pin_code, '777777', 'Builtland booking should receive builtland_pin_code');
    assert.strictEqual(bItem.pin_code, '777777', 'Builtland booking_item should receive builtland_pin_code');
  });

  await t.test('6. No-PIN room policy preservation (Rooms 10, 12, 13 do not set/sync PIN)', async () => {
    const jupiterRoom = await getQuery(db, 'SELECT * FROM rooms WHERE id = ?', [NO_PIN_ROOM]);
    if (jupiterRoom) {
      const res = await updateRoomAndSyncBookings(db, NO_PIN_ROOM, { pin_code: '999999' }, nowIso);
      assert.strictEqual(res.synced_bookings_count, 0, 'No bookings synced for no-PIN room');
      const roomAfter = await getQuery(db, 'SELECT pin_code FROM rooms WHERE id = ?', [NO_PIN_ROOM]);
      assert.strictEqual(roomAfter.pin_code, null, 'No-PIN room PIN must remain null');
    }
  });

  // 7. Multi-room booking test: primary room vs secondary room PIN update
  await t.test('7. Multi-room booking: updating secondary room does not overwrite parent booking PIN, but updates item PIN', async () => {
    const multiBookingId = await createMultiItemBooking(
      'Multi-Room Booking Test',
      [
        { room_id: ROOM_A, start_time: '2099-02-01T10:00:00', end_time: '2099-02-01T11:00:00', pin_code: '222222' }, // Item 1 (Primary)
        { room_id: ROOM_B, start_time: '2099-02-01T11:00:00', end_time: '2099-02-01T12:00:00', pin_code: '333333' }  // Item 2 (Secondary)
      ],
      'paid',
      'walkin',
      '222222' // Parent booking PIN represents primary room (ROOM_A)
    );

    // Update Room B's PIN to 555555
    const resB = await updateRoomAndSyncBookings(db, ROOM_B, { pin_code: '555555' }, nowIso);
    assert.strictEqual(resB.success, true);

    const itemsAfterB = await allQuery(db, 'SELECT room_id, pin_code FROM booking_items WHERE booking_id = ? ORDER BY id ASC', [multiBookingId]);
    const bookingAfterB = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [multiBookingId]);

    // Item 1 (Room A) must stay 222222
    assert.strictEqual(itemsAfterB[0].pin_code, '222222', 'Room A item PIN must remain untouched');
    // Item 2 (Room B) must be updated to 555555
    assert.strictEqual(itemsAfterB[1].pin_code, '555555', 'Room B item PIN must be updated to 555555');
    // Parent booking PIN must REMAIN 222222 (because Room A is primary room!)
    assert.strictEqual(bookingAfterB.pin_code, '222222', 'Parent booking PIN must NOT be overwritten by secondary Room B');

    // Now update Room A's PIN to 666666
    const resA = await updateRoomAndSyncBookings(db, ROOM_A, { pin_code: '666666', builtland_pin_code: '777777' }, nowIso);
    assert.strictEqual(resA.success, true);

    const itemsAfterA = await allQuery(db, 'SELECT room_id, pin_code FROM booking_items WHERE booking_id = ? ORDER BY id ASC', [multiBookingId]);
    const bookingAfterA = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [multiBookingId]);

    // Item 1 (Room A) must now be 666666
    assert.strictEqual(itemsAfterA[0].pin_code, '666666', 'Room A item PIN must be updated to 666666');
    // Item 2 (Room B) must remain 555555
    assert.strictEqual(itemsAfterA[1].pin_code, '555555', 'Room B item PIN must remain 555555');
    // Parent booking PIN must be updated to 666666 (because Room A is the primary room!)
    assert.strictEqual(bookingAfterA.pin_code, '666666', 'Parent booking PIN must be updated when primary Room A updates');
  });

  // 8. Multi-room Builtland booking test
  await t.test('8. Multi-room Builtland booking: preserves item PINs and syncs primary room to parent', async () => {
    const multiBuiltlandId = await createMultiItemBooking(
      'Multi-Room Builtland Test',
      [
        { room_id: ROOM_A, start_time: '2099-03-01T10:00:00', end_time: '2099-03-01T11:00:00', pin_code: '777777' }, // Item 1 (Primary)
        { room_id: ROOM_B, start_time: '2099-03-01T11:00:00', end_time: '2099-03-01T12:00:00', pin_code: '888888' }  // Item 2 (Secondary)
      ],
      'internal_free',
      'builtland',
      '777777'
    );

    // Update Room B builtland PIN to 999999
    await updateRoomAndSyncBookings(db, ROOM_B, { pin_code: '555555', builtland_pin_code: '999999' }, nowIso);

    const itemsAfterB = await allQuery(db, 'SELECT room_id, pin_code FROM booking_items WHERE booking_id = ? ORDER BY id ASC', [multiBuiltlandId]);
    const bookingAfterB = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [multiBuiltlandId]);

    assert.strictEqual(itemsAfterB[0].pin_code, '777777', 'Room A builtland item PIN remains unchanged');
    assert.strictEqual(itemsAfterB[1].pin_code, '999999', 'Room B builtland item PIN updated to 999999');
    assert.strictEqual(bookingAfterB.pin_code, '777777', 'Parent booking PIN remains Room A builtland PIN');

    // Update Room A builtland PIN to 123456
    await updateRoomAndSyncBookings(db, ROOM_A, { pin_code: '666666', builtland_pin_code: '123456' }, nowIso);

    const itemsAfterA = await allQuery(db, 'SELECT room_id, pin_code FROM booking_items WHERE booking_id = ? ORDER BY id ASC', [multiBuiltlandId]);
    const bookingAfterA = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [multiBuiltlandId]);

    assert.strictEqual(itemsAfterA[0].pin_code, '123456', 'Room A builtland item PIN updated to 123456');
    assert.strictEqual(itemsAfterA[1].pin_code, '999999', 'Room B builtland item PIN remains 999999');
    assert.strictEqual(bookingAfterA.pin_code, '123456', 'Parent booking PIN updated to Room A new builtland PIN');
  });

  // 9. Mixed room booking: No-PIN room + PIN room
  await t.test('9. Mixed booking with No-PIN room: preserves null PIN for no-PIN items', async () => {
    // Booking with Room 10 (Item 1, No PIN) and Room A (Item 2, PIN capable)
    const mixedBookingId = await createMultiItemBooking(
      'Mixed Booking Test',
      [
        { room_id: NO_PIN_ROOM, start_time: '2099-04-01T10:00:00', end_time: '2099-04-01T11:00:00', pin_code: null },
        { room_id: ROOM_A, start_time: '2099-04-01T11:00:00', end_time: '2099-04-01T12:00:00', pin_code: '666666' }
      ],
      'paid',
      'walkin',
      null // Primary room was Room 10, which has no PIN
    );

    // Update Room A PIN to 888888
    await updateRoomAndSyncBookings(db, ROOM_A, { pin_code: '888888' }, nowIso);

    const mixedItems = await allQuery(db, 'SELECT room_id, pin_code FROM booking_items WHERE booking_id = ? ORDER BY id ASC', [mixedBookingId]);
    const mixedBooking = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [mixedBookingId]);

    // Item 1 (Room 10) must remain null
    assert.strictEqual(mixedItems[0].pin_code, null, 'No-PIN room item must remain null');
    // Item 2 (Room A) must be updated to 888888
    assert.strictEqual(mixedItems[1].pin_code, '888888', 'Room A item must receive updated PIN');
    // Parent booking PIN remains null because primary room was Room 10
    assert.strictEqual(mixedBooking.pin_code, null, 'Parent booking PIN remains null for no-PIN primary room');
  });

  // Cleanup
  for (const id of createdBookingIds) {
    await runQuery(db, 'DELETE FROM booking_items WHERE booking_id = ?', [id]);
    await runQuery(db, 'DELETE FROM bookings WHERE id = ?', [id]);
  }
  await runQuery(db, 'DELETE FROM rooms WHERE id IN (?, ?)', [ROOM_A, ROOM_B]);
  db.close();
});
