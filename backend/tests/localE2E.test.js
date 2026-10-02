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

const NO_PIN_ROOM_IDS = [10, 12, 13];
function roomUsesDoorPin(r) {
  if (!r) return false;
  const rId = typeof r === 'number' ? r : Number(r.id || r.room_id);
  if (rId && NO_PIN_ROOM_IDS.includes(rId)) return false;
  const name = String(r.name || '').trim();
  if (name && /jupiter/i.test(name)) return false;
  return true;
}

// Exactly mirror server.js / worker.js PUT /api/rooms/:id logic
async function putRoom(db, roomId, body, nowIso) {
  const existingRoom = await getQuery(db, 'SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!existingRoom) throw new Error('Not found');

  const isPinCapable = roomUsesDoorPin(existingRoom);

  let cleanPin;
  if (!isPinCapable) {
    cleanPin = null;
  } else if (body.pin_code === undefined) {
    cleanPin = existingRoom.pin_code !== undefined ? existingRoom.pin_code : null;
  } else if (body.pin_code === null || String(body.pin_code).trim() === '') {
    cleanPin = null;
  } else {
    cleanPin = String(body.pin_code).trim();
  }

  let cleanBuiltlandPin;
  if (!isPinCapable) {
    cleanBuiltlandPin = null;
  } else if (body.builtland_pin_code === undefined) {
    cleanBuiltlandPin = existingRoom.builtland_pin_code !== undefined ? existingRoom.builtland_pin_code : null;
  } else if (body.builtland_pin_code === null || String(body.builtland_pin_code).trim() === '') {
    cleanBuiltlandPin = null;
  } else {
    cleanBuiltlandPin = String(body.builtland_pin_code).trim();
  }

  const prevPin = existingRoom.pin_code || null;
  const prevBuiltlandPin = existingRoom.builtland_pin_code || null;
  const generalPinChanged = isPinCapable && (cleanPin !== prevPin);
  const builtlandPinChanged = isPinCapable && (cleanBuiltlandPin !== prevBuiltlandPin);

  const effectiveBuiltlandPin = cleanBuiltlandPin || cleanPin;
  const prevEffectiveBuiltlandPin = prevBuiltlandPin || prevPin;
  const builtlandEffectiveChanged = isPinCapable && (effectiveBuiltlandPin !== prevEffectiveBuiltlandPin);

  let syncedGeneralCount = 0;
  let syncedBuiltlandCount = 0;

  await runQuery(
    db,
    `UPDATE rooms SET name = ?, capacity = ?, hourly_rate = ?, pin_code = ?, builtland_pin_code = ? WHERE id = ?`,
    [
      body.name !== undefined ? body.name : existingRoom.name,
      body.capacity !== undefined ? body.capacity : existingRoom.capacity,
      body.hourly_rate !== undefined ? body.hourly_rate : existingRoom.hourly_rate,
      cleanPin,
      cleanBuiltlandPin,
      roomId
    ]
  );

  if (isPinCapable) {
    const eligibleGeneral = await allQuery(
        db,
        `SELECT DISTINCT b.id
         FROM bookings b
         JOIN booking_items bi ON bi.booking_id = b.id
         WHERE bi.room_id = ?
           AND COALESCE(b.payment_status, '') NOT IN ('cancelled', 'failed')
           AND COALESCE(b.checkin_status, '') != 'cancelled'
           AND COALESCE(bi.checkin_status, '') != 'cancelled'
           AND (CASE WHEN length(bi.end_time) = 16 THEN REPLACE(bi.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi.end_time, ' ', 'T') END) >= ?
           AND (b.customer_type != 'builtland' OR b.customer_type IS NULL)`,
        [roomId, nowIso]
      );
      syncedGeneralCount = eligibleGeneral ? eligibleGeneral.length : 0;

      if (syncedGeneralCount > 0) {
        await runQuery(
          db,
          `UPDATE booking_items
           SET pin_code = ?
           WHERE room_id = ?
             AND (CASE WHEN length(end_time) = 16 THEN REPLACE(end_time, ' ', 'T') || ':00' ELSE REPLACE(end_time, ' ', 'T') END) >= ?
             AND COALESCE(checkin_status, '') != 'cancelled'
             AND booking_id IN (
               SELECT id FROM bookings
               WHERE COALESCE(payment_status, '') NOT IN ('cancelled', 'failed')
                 AND COALESCE(checkin_status, '') != 'cancelled'
                 AND (customer_type != 'builtland' OR customer_type IS NULL)
             )`,
          [cleanPin, roomId, nowIso]
        );

        await runQuery(
          db,
          `UPDATE bookings
           SET pin_code = ?
           WHERE COALESCE(payment_status, '') NOT IN ('cancelled', 'failed')
             AND COALESCE(checkin_status, '') != 'cancelled'
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
                     AND (CASE WHEN length(bi2.end_time) = 16 THEN REPLACE(bi2.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi2.end_time, ' ', 'T') END) >= ?
                     AND COALESCE(bi2.checkin_status, '') != 'cancelled'
                 )
                 AND (CASE WHEN length(bi1.end_time) = 16 THEN REPLACE(bi1.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi1.end_time, ' ', 'T') END) >= ?
                 AND COALESCE(bi1.checkin_status, '') != 'cancelled'
             )`,
          [cleanPin, roomId, nowIso, nowIso]
        );
      }

    const eligibleBuiltland = await allQuery(
        db,
        `SELECT DISTINCT b.id
         FROM bookings b
         JOIN booking_items bi ON bi.booking_id = b.id
         WHERE bi.room_id = ?
           AND COALESCE(b.payment_status, '') NOT IN ('cancelled', 'failed')
           AND COALESCE(b.checkin_status, '') != 'cancelled'
           AND COALESCE(bi.checkin_status, '') != 'cancelled'
           AND (CASE WHEN length(bi.end_time) = 16 THEN REPLACE(bi.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi.end_time, ' ', 'T') END) >= ?
           AND b.customer_type = 'builtland'`,
        [roomId, nowIso]
      );
      syncedBuiltlandCount = eligibleBuiltland ? eligibleBuiltland.length : 0;

      if (syncedBuiltlandCount > 0) {
        await runQuery(
          db,
          `UPDATE booking_items
           SET pin_code = ?
           WHERE room_id = ?
             AND (CASE WHEN length(end_time) = 16 THEN REPLACE(end_time, ' ', 'T') || ':00' ELSE REPLACE(end_time, ' ', 'T') END) >= ?
             AND COALESCE(checkin_status, '') != 'cancelled'
             AND booking_id IN (
               SELECT id FROM bookings
               WHERE COALESCE(payment_status, '') NOT IN ('cancelled', 'failed')
                 AND COALESCE(checkin_status, '') != 'cancelled'
                 AND customer_type = 'builtland'
             )`,
          [effectiveBuiltlandPin, roomId, nowIso]
        );

        await runQuery(
          db,
          `UPDATE bookings
           SET pin_code = ?
           WHERE COALESCE(payment_status, '') NOT IN ('cancelled', 'failed')
             AND COALESCE(checkin_status, '') != 'cancelled'
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
                     AND (CASE WHEN length(bi2.end_time) = 16 THEN REPLACE(bi2.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi2.end_time, ' ', 'T') END) >= ?
                     AND COALESCE(bi2.checkin_status, '') != 'cancelled'
                 )
                 AND (CASE WHEN length(bi1.end_time) = 16 THEN REPLACE(bi1.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi1.end_time, ' ', 'T') END) >= ?
                 AND COALESCE(bi1.checkin_status, '') != 'cancelled'
             )`,
          [effectiveBuiltlandPin, roomId, nowIso, nowIso]
        );
      }
  }

  return {
    success: true,
    synced_bookings_count: syncedGeneralCount + syncedBuiltlandCount,
    synced_general_bookings_count: syncedGeneralCount,
    synced_builtland_bookings_count: syncedBuiltlandCount,
    room: {
      id: Number(roomId),
      name: body.name !== undefined ? body.name : existingRoom.name,
      pin_code: cleanPin,
      builtland_pin_code: cleanBuiltlandPin
    }
  };
}

test('Step 24: Comprehensive Local E2E Flow (A through P)', async () => {
  const db = new sqlite3.Database(DB_PATH);
  const nowIso = '2026-10-01T15:00:00';

  const E2E_ROOM_1 = 9801;
  const E2E_ROOM_2 = 9802;

  // Cleanup prior runs
  await runQuery(db, 'DELETE FROM booking_items WHERE room_id IN (?, ?)', [E2E_ROOM_1, E2E_ROOM_2]);
  await runQuery(db, 'DELETE FROM rooms WHERE id IN (?, ?)', [E2E_ROOM_1, E2E_ROOM_2]);

  // Insert fresh rooms
  await runQuery(db, "INSERT INTO rooms (id, name, capacity, hourly_rate, pin_code, builtland_pin_code, status) VALUES (?, 'E2E Room 1', 10, 500, '111111', '999999', 'active')", [E2E_ROOM_1]);
  await runQuery(db, "INSERT INTO rooms (id, name, capacity, hourly_rate, pin_code, builtland_pin_code, status) VALUES (?, 'E2E Room 2', 8, 400, '333333', '888888', 'active')", [E2E_ROOM_2]);

  // A. Edit Builtland PIN (999999 -> 888888)
  // B. Save
  const saveRes = await putRoom(db, E2E_ROOM_1, { builtland_pin_code: '888888' }, nowIso);
  assert.strictEqual(saveRes.success, true, 'B. Save succeeded');

  // C. Refetch room
  const refetchedRoom = await getQuery(db, 'SELECT id, name, pin_code, builtland_pin_code FROM rooms WHERE id = ?', [E2E_ROOM_1]);

  // D. Verify persisted
  assert.strictEqual(refetchedRoom.builtland_pin_code, '888888', 'D. Builtland PIN persisted as 888888');
  assert.strictEqual(refetchedRoom.pin_code, '111111', 'D. Normal PIN preserved as 111111');

  // E. Create existing future General booking (start 2099-01-01)
  const gBookRes = await runQuery(db, "INSERT INTO bookings (customer_name, customer_type, payment_status, checkin_status, pin_code, total_amount) VALUES ('E2E General', 'walkin', 'paid', 'pending', '111111', 500)");
  const gBookId = gBookRes.id;
  await runQuery(db, "INSERT INTO booking_items (booking_id, room_id, start_time, end_time, pin_code, price, subtotal) VALUES (?, ?, '2099-01-01T10:00:00', '2099-01-01T12:00:00', '111111', 500, 500)", [gBookId, E2E_ROOM_1]);

  // F. Create existing future Builtland booking (start 2099-01-01)
  const bBookRes = await runQuery(db, "INSERT INTO bookings (customer_name, customer_type, payment_status, checkin_status, pin_code, total_amount) VALUES ('E2E Builtland', 'builtland', 'internal_free', 'pending', '888888', 0)");
  const bBookId = bBookRes.id;
  await runQuery(db, "INSERT INTO booking_items (booking_id, room_id, start_time, end_time, pin_code, price, subtotal) VALUES (?, ?, '2099-01-01T10:00:00', '2099-01-01T12:00:00', '888888', 0, 0)", [bBookId, E2E_ROOM_1]);

  // L-prep: Create Historical booking (past: 2020-01-01)
  const pastBookRes = await runQuery(db, "INSERT INTO bookings (customer_name, customer_type, payment_status, checkin_status, pin_code, total_amount) VALUES ('E2E Historical', 'walkin', 'paid', 'pending', '111111', 500)");
  const pastBookId = pastBookRes.id;
  await runQuery(db, "INSERT INTO booking_items (booking_id, room_id, start_time, end_time, pin_code, price, subtotal) VALUES (?, ?, '2020-01-01T10:00:00', '2020-01-01T12:00:00', '111111', 500, 500)", [pastBookId, E2E_ROOM_1]);

  // M-prep: Create Cancelled booking
  const cancelBookRes = await runQuery(db, "INSERT INTO bookings (customer_name, customer_type, payment_status, checkin_status, pin_code, total_amount) VALUES ('E2E Cancelled', 'walkin', 'cancelled', 'cancelled', '111111', 500)");
  const cancelBookId = cancelBookRes.id;
  await runQuery(db, "INSERT INTO booking_items (booking_id, room_id, start_time, end_time, pin_code, price, subtotal, checkin_status) VALUES (?, ?, '2099-01-01T10:00:00', '2099-01-01T12:00:00', '111111', 500, 500, 'cancelled')", [cancelBookId, E2E_ROOM_1]);

  // N-prep: Multi-room booking: Primary Room 1, Secondary Room 2
  const multiBookRes = await runQuery(db, "INSERT INTO bookings (customer_name, customer_type, payment_status, checkin_status, pin_code, total_amount) VALUES ('E2E Multi', 'walkin', 'paid', 'pending', '111111', 900)");
  const multiBookId = multiBookRes.id;
  await runQuery(db, "INSERT INTO booking_items (booking_id, room_id, start_time, end_time, pin_code, price, subtotal) VALUES (?, ?, '2099-02-01T10:00:00', '2099-02-01T12:00:00', '111111', 500, 500)", [multiBookId, E2E_ROOM_1]);
  await runQuery(db, "INSERT INTO booking_items (booking_id, room_id, start_time, end_time, pin_code, price, subtotal) VALUES (?, ?, '2099-02-01T10:00:00', '2099-02-01T12:00:00', '333333', 400, 400)", [multiBookId, E2E_ROOM_2]);

  // G. Update normal PIN: 111111 -> 222222
  const gUpdateRes = await putRoom(db, E2E_ROOM_1, { pin_code: '222222' }, nowIso);
  assert.strictEqual(gUpdateRes.success, true);
  assert.strictEqual(gUpdateRes.synced_general_bookings_count > 0, true, 'General bookings synced');

  // H. Verify General sync
  const gBookAfter = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [gBookId]);
  const gItemAfter = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [gBookId]);
  assert.strictEqual(gBookAfter.pin_code, '222222', 'H. General booking parent PIN synced to 222222');
  assert.strictEqual(gItemAfter.pin_code, '222222', 'H. General booking item PIN synced to 222222');

  // K-check: Verify General isolation when normal PIN was changed (Builtland booking must remain 888888)
  const bBookAfterG = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [bBookId]);
  const bItemAfterG = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [bBookId]);
  assert.strictEqual(bBookAfterG.pin_code, '888888', 'K. Builtland booking unchanged when normal PIN changed');
  assert.strictEqual(bItemAfterG.pin_code, '888888', 'K. Builtland booking item unchanged when normal PIN changed');

  // I. Update Builtland PIN: 888888 -> 777777
  const bUpdateRes = await putRoom(db, E2E_ROOM_1, { builtland_pin_code: '777777' }, nowIso);
  assert.strictEqual(bUpdateRes.success, true);
  assert.strictEqual(bUpdateRes.synced_builtland_bookings_count > 0, true, 'Builtland bookings synced');

  // J. Verify Builtland sync
  const bBookAfterB = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [bBookId]);
  const bItemAfterB = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [bBookId]);
  assert.strictEqual(bBookAfterB.pin_code, '777777', 'J. Builtland parent PIN synced to 777777');
  assert.strictEqual(bItemAfterB.pin_code, '777777', 'J. Builtland item PIN synced to 777777');

  // K. Verify General isolation (General booking must still be 222222)
  const gBookAfterB = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [gBookId]);
  const gItemAfterB = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [gBookId]);
  assert.strictEqual(gBookAfterB.pin_code, '222222', 'K. General parent PIN remains 222222');
  assert.strictEqual(gItemAfterB.pin_code, '222222', 'K. General item PIN remains 222222');

  // L. Verify historical booking unchanged
  const pastBookAfter = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [pastBookId]);
  const pastItemAfter = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [pastBookId]);
  assert.strictEqual(pastBookAfter.pin_code, '111111', 'L. Historical booking parent PIN remains 111111');
  assert.strictEqual(pastItemAfter.pin_code, '111111', 'L. Historical item PIN remains 111111');

  // M. Verify cancelled booking unchanged
  const cancelBookAfter = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [cancelBookId]);
  const cancelItemAfter = await getQuery(db, 'SELECT pin_code FROM booking_items WHERE booking_id = ?', [cancelBookId]);
  assert.strictEqual(cancelBookAfter.pin_code, '111111', 'M. Cancelled booking parent PIN remains 111111');
  assert.strictEqual(cancelItemAfter.pin_code, '111111', 'M. Cancelled item PIN remains 111111');

  // N. Verify multi-room behavior
  // Updating Room 2 PIN (secondary room in multi-room booking)
  await putRoom(db, E2E_ROOM_2, { pin_code: '654321' }, nowIso);
  const multiItemsAfter = await allQuery(db, 'SELECT room_id, pin_code FROM booking_items WHERE booking_id = ? ORDER BY id ASC', [multiBookId]);
  const multiBookAfter = await getQuery(db, 'SELECT pin_code FROM bookings WHERE id = ?', [multiBookId]);
  assert.strictEqual(multiItemsAfter[0].pin_code, '222222', 'N. Primary Room 1 item PIN remains 222222');
  assert.strictEqual(multiItemsAfter[1].pin_code, '654321', 'N. Secondary Room 2 item PIN updated to 654321');
  assert.strictEqual(multiBookAfter.pin_code, '222222', 'N. Parent booking PIN preserved as primary room PIN (222222), not clobbered by secondary room');

  // O. Reopen room edit modal / simulate GET /api/rooms
  const room1Latest = await getQuery(db, 'SELECT id, name, pin_code, builtland_pin_code FROM rooms WHERE id = ?', [E2E_ROOM_1]);
  const room2Latest = await getQuery(db, 'SELECT id, name, pin_code, builtland_pin_code FROM rooms WHERE id = ?', [E2E_ROOM_2]);

  // P. Confirm both PINs display latest saved values
  assert.strictEqual(room1Latest.pin_code, '222222', 'P. Room 1 normal PIN displays 222222');
  assert.strictEqual(room1Latest.builtland_pin_code, '777777', 'P. Room 1 Builtland PIN displays 777777');
  assert.strictEqual(room2Latest.pin_code, '654321', 'P. Room 2 normal PIN displays 654321');
  assert.strictEqual(room2Latest.builtland_pin_code, '888888', 'P. Room 2 Builtland PIN displays 888888');

  // Cleanup
  const allTestBookingIds = [gBookId, bBookId, pastBookId, cancelBookId, multiBookId];
  for (const bid of allTestBookingIds) {
    await runQuery(db, 'DELETE FROM booking_items WHERE booking_id = ?', [bid]);
    await runQuery(db, 'DELETE FROM bookings WHERE id = ?', [bid]);
  }
  await runQuery(db, 'DELETE FROM rooms WHERE id IN (?, ?)', [E2E_ROOM_1, E2E_ROOM_2]);

  db.close();
});
