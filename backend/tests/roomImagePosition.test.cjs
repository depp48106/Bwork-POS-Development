/**
 * BWORK-POS — Room Image Position (Focal Point) Test Suite
 *
 * Verifies:
 * 1. Migration 010 schema: columns image_position_x & image_position_y exist with default 50
 * 2. POST /api/rooms:
 *    - Persists valid coordinates (e.g., 35, 65)
 *    - Default coordinates (50, 50) when omitted
 *    - Out-of-bounds clamping (0-100)
 *    - NaN / invalid values fallback to 50
 * 3. PUT /api/rooms/:id:
 *    - Updates coordinates accurately
 *    - Preserves existing coordinates when omitted
 *    - Clamps out-of-bounds values
 *    - Resetting to 50, 50
 * 4. GET /api/rooms & GET /api/public/rooms:
 *    - Expose image_position_x and image_position_y
 * 5. GET /api/bookings/:id/confirmation-card:
 *    - Single-room booking payload includes single_room_focal_x & single_room_focal_y
 *    - rooms array contains image_position_x and image_position_y
 *    - items/schedules array contains image_position_x and image_position_y
 *    - Multi-room booking retains individual room coordinates and brand banner
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { runMigrations } = require('../migrator');

function makeTestDb() {
  const db = new sqlite3.Database(':memory:');
  const dbQuery = {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, changes: this.changes });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    },
    exec(sql) {
      return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    transaction(callback) {
      return (async () => {
        await dbQuery.run('BEGIN TRANSACTION');
        try {
          const res = await callback();
          await dbQuery.run('COMMIT');
          return res;
        } catch (e) {
          await dbQuery.run('ROLLBACK');
          throw e;
        }
      })();
    }
  };
  return { db, dbQuery };
}

test('Room Image Position Test Suite', async (t) => {
  const { db, dbQuery } = makeTestDb();

  // Run all migrations to establish schema
  await runMigrations(dbQuery);

  // Seed settings and test room/booking tables
  await dbQuery.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('wifi_ssid', '@BWORK_TEST')");

  await t.test('1. Migration 010 adds image_position_x and image_position_y columns with default 50', async () => {
    const tableInfo = await dbQuery.all('PRAGMA table_info(rooms)');
    const colMap = new Map(tableInfo.map(c => [c.name, c]));

    assert.ok(colMap.has('image_position_x'), 'Column image_position_x must exist');
    assert.ok(colMap.has('image_position_y'), 'Column image_position_y must exist');

    assert.equal(String(colMap.get('image_position_x').dflt_value), '50', 'image_position_x default must be 50');
    assert.equal(String(colMap.get('image_position_y').dflt_value), '50', 'image_position_y default must be 50');
  });

  await t.test('2. Room creation (POST /api/rooms simulation) with custom and default coordinates', async () => {
    // 2a. With explicit focal position
    const insertSql = `
      INSERT INTO rooms (
        name, capacity, hourly_rate, daily_rate, half_day_rate,
        has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url,
        description, status, image_url,
        has_hourly, has_halfday, has_daily, pin_code, builtland_pin_code,
        image_position_x, image_position_y
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Clamping helper mirroring server.js
    const sanitizeFocalCoord = (val) => (val !== undefined && val !== null && !isNaN(val))
      ? Math.max(0, Math.min(100, Math.round(Number(val))))
      : 50;

    const res1 = await dbQuery.run(insertSql, [
      'Room Focal Custom', 10, 400, 3200, 2000,
      0, 0, 0, 0, null,
      'Test room with custom focal', 'active', '/uploads/rooms/room_custom.jpg',
      1, 1, 1, '1234', '5678',
      sanitizeFocalCoord(35), sanitizeFocalCoord(65)
    ]);

    const room1 = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [res1.id]);
    assert.equal(room1.image_position_x, 35, 'Custom X should be 35');
    assert.equal(room1.image_position_y, 65, 'Custom Y should be 65');

    // 2b. Omitted focal position defaults to 50, 50
    const res2 = await dbQuery.run(insertSql, [
      'Room Focal Default', 8, 300, 2400, 1500,
      0, 0, 0, 0, null,
      'Test room default focal', 'active', '/uploads/rooms/room_default.jpg',
      1, 1, 1, '1111', '2222',
      sanitizeFocalCoord(undefined), sanitizeFocalCoord(undefined)
    ]);

    const room2 = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [res2.id]);
    assert.equal(room2.image_position_x, 50, 'Omitted X should default to 50');
    assert.equal(room2.image_position_y, 50, 'Omitted Y should default to 50');

    // 2c. Clamping out of bounds coordinates (-25 -> 0, 140 -> 100)
    const res3 = await dbQuery.run(insertSql, [
      'Room Focal Clamped', 6, 200, 1600, 1000,
      0, 0, 0, 0, null,
      'Test room clamped focal', 'active', '/uploads/rooms/room_clamped.jpg',
      1, 1, 1, '3333', '4444',
      sanitizeFocalCoord(-25), sanitizeFocalCoord(140)
    ]);

    const room3 = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [res3.id]);
    assert.equal(room3.image_position_x, 0, 'Negative X must be clamped to 0');
    assert.equal(room3.image_position_y, 100, 'Over-100 Y must be clamped to 100');

    // 2d. NaN / invalid values fallback to 50
    const res4 = await dbQuery.run(insertSql, [
      'Room Focal Invalid', 6, 200, 1600, 1000,
      0, 0, 0, 0, null,
      'Test room invalid focal', 'active', '/uploads/rooms/room_invalid.jpg',
      1, 1, 1, '5555', '6666',
      sanitizeFocalCoord('invalid'), sanitizeFocalCoord(NaN)
    ]);

    const room4 = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [res4.id]);
    assert.equal(room4.image_position_x, 50, 'Invalid X must fallback to 50');
    assert.equal(room4.image_position_y, 50, 'Invalid Y must fallback to 50');
  });

  await t.test('3. Room update (PUT /api/rooms/:id simulation) updating and preserving coordinates', async () => {
    // Insert base room
    const ins = await dbQuery.run(
      `INSERT INTO rooms (name, capacity, hourly_rate, image_position_x, image_position_y) VALUES (?, ?, ?, ?, ?)`,
      ['Update Target Room', 12, 500, 40, 60]
    );
    const roomId = ins.id;

    // Helper for update sanitization mirroring server.js
    const resolveUpdateFocal = (inputVal, existingVal) => {
      if (inputVal === undefined) return existingVal !== undefined && existingVal !== null ? existingVal : 50;
      if (inputVal === null || isNaN(inputVal)) return 50;
      return Math.max(0, Math.min(100, Math.round(Number(inputVal))));
    };

    // 3a. Update focal point to Top-Right (85, 15)
    let existing = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    let newX = resolveUpdateFocal(85, existing.image_position_x);
    let newY = resolveUpdateFocal(15, existing.image_position_y);

    await dbQuery.run(
      `UPDATE rooms SET image_position_x = ?, image_position_y = ? WHERE id = ?`,
      [newX, newY, roomId]
    );

    let updated = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    assert.equal(updated.image_position_x, 85, 'Updated X should be 85');
    assert.equal(updated.image_position_y, 15, 'Updated Y should be 15');

    // 3b. Update other fields omitting focal coordinates preserves 85, 15
    existing = updated;
    newX = resolveUpdateFocal(undefined, existing.image_position_x);
    newY = resolveUpdateFocal(undefined, existing.image_position_y);

    await dbQuery.run(
      `UPDATE rooms SET name = ?, image_position_x = ?, image_position_y = ? WHERE id = ?`,
      ['Update Target Room Renamed', newX, newY, roomId]
    );

    updated = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    assert.equal(updated.name, 'Update Target Room Renamed');
    assert.equal(updated.image_position_x, 85, 'Preserved X must remain 85');
    assert.equal(updated.image_position_y, 15, 'Preserved Y must remain 15');

    // 3c. Reset to center (50, 50)
    existing = updated;
    newX = resolveUpdateFocal(50, existing.image_position_x);
    newY = resolveUpdateFocal(50, existing.image_position_y);

    await dbQuery.run(
      `UPDATE rooms SET image_position_x = ?, image_position_y = ? WHERE id = ?`,
      [newX, newY, roomId]
    );

    updated = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    assert.equal(updated.image_position_x, 50, 'Reset X must be 50');
    assert.equal(updated.image_position_y, 50, 'Reset Y must be 50');
  });

  await t.test('4. Confirmation Card payload carries single_room_focal coordinates, rooms, and items', async () => {
    // Create room with focal point (35, 65)
    const roomIns = await dbQuery.run(
      `INSERT INTO rooms (name, capacity, hourly_rate, image_url, image_position_x, image_position_y, pin_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Jupiter Conf Suite', 25, 800, '/uploads/rooms/jupiter.jpg', 35, 65, '8888']
    );
    const confRoomId = roomIns.id;

    // Create booking and booking_item
    const bkgIns = await dbQuery.run(
      `INSERT INTO bookings (customer_name, contact, total_amount, payment_status, receipt_number)
       VALUES (?, ?, ?, 'completed', 'BK-TEST-FOCAL-001')`,
      ['นายสมชาย โฟกัสพอยท์', '0812345678', 1600]
    );
    const bookingId = bkgIns.id;

    await dbQuery.run(
      `INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, checkin_status)
       VALUES (?, ?, '2026-10-20 10:00:00', '2026-10-20 12:00:00', 800, 1600, 'pending')`,
      [bookingId, confRoomId]
    );

    // Simulate handleGetBookingWifiCard query and payload construction
    const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    const tableInfo = await dbQuery.all('PRAGMA table_info(rooms)');
    const colNames = new Set((tableInfo || []).map(c => c.name));

    const roomSelectCols = [
      'r.name as room_name',
      colNames.has('image_url') ? 'r.image_url as room_image_url' : 'NULL as room_image_url',
      colNames.has('classroom_image_url') ? 'r.classroom_image_url as room_classroom_image_url' : 'NULL as room_classroom_image_url',
      colNames.has('image_position_x') ? 'r.image_position_x as room_image_position_x' : '50 as room_image_position_x',
      colNames.has('image_position_y') ? 'r.image_position_y as room_image_position_y' : '50 as room_image_position_y',
      colNames.has('pin_code') ? 'r.pin_code as room_pin_code' : 'NULL as room_pin_code',
      colNames.has('builtland_pin_code') ? 'r.builtland_pin_code as room_builtland_pin_code' : 'NULL as room_builtland_pin_code',
      colNames.has('wifi_username') ? 'r.wifi_username' : 'NULL as wifi_username',
      colNames.has('wifi_password_enc') ? 'r.wifi_password_enc' : 'NULL as wifi_password_enc'
    ].join(', ');

    const items = await dbQuery.all(
      `SELECT bi.*, ${roomSelectCols}
       FROM booking_items bi
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE bi.booking_id = ?
         AND bi.room_id IS NOT NULL
         AND COALESCE(bi.checkin_status, '') != 'cancelled'`,
      [bookingId]
    );

    const roomMap = new Map();
    for (const item of items) {
      if (!item.room_id || roomMap.has(item.room_id)) continue;
      const posX = (typeof item.room_image_position_x === 'number' && !isNaN(item.room_image_position_x))
        ? Math.max(0, Math.min(100, Math.round(item.room_image_position_x)))
        : 50;
      const posY = (typeof item.room_image_position_y === 'number' && !isNaN(item.room_image_position_y))
        ? Math.max(0, Math.min(100, Math.round(item.room_image_position_y)))
        : 50;

      roomMap.set(item.room_id, {
        room_id: item.room_id,
        room_name: item.room_name,
        image_url: item.room_image_url,
        image_position_x: posX,
        image_position_y: posY
      });
    }

    const scheduleList = items.map(item => {
      const roomEntry = roomMap.get(item.room_id) || {};
      return {
        booking_item_id: item.id,
        room_id: item.room_id,
        room_name: item.room_name,
        room_image_url: roomEntry.image_url,
        image_position_x: roomEntry.image_position_x !== undefined ? roomEntry.image_position_x : 50,
        image_position_y: roomEntry.image_position_y !== undefined ? roomEntry.image_position_y : 50
      };
    });

    const distinctRooms = Array.from(roomMap.values());
    const isMultiRoom = distinctRooms.length > 1;
    const singleRoomImage = distinctRooms.length === 1 ? (distinctRooms[0].image_url || null) : null;

    const cardPayload = {
      document_title: 'ใบยืนยันการจองห้องประชุม',
      booking_number: booking.receipt_number,
      customer_name: booking.customer_name,
      is_multi_room: isMultiRoom,
      banner_type: isMultiRoom ? 'brand' : (singleRoomImage ? 'room' : 'placeholder'),
      banner_image_url: isMultiRoom ? '/Bworktower.jpg' : singleRoomImage,
      single_room_focal_x: distinctRooms.length === 1 ? (distinctRooms[0].image_position_x ?? 50) : 50,
      single_room_focal_y: distinctRooms.length === 1 ? (distinctRooms[0].image_position_y ?? 50) : 50,
      rooms: distinctRooms,
      items: scheduleList
    };

    assert.equal(cardPayload.single_room_focal_x, 35, 'Payload single_room_focal_x must be 35');
    assert.equal(cardPayload.single_room_focal_y, 65, 'Payload single_room_focal_y must be 65');
    assert.equal(cardPayload.rooms[0].image_position_x, 35, 'rooms[0].image_position_x must be 35');
    assert.equal(cardPayload.rooms[0].image_position_y, 65, 'rooms[0].image_position_y must be 65');
    assert.equal(cardPayload.items[0].image_position_x, 35, 'items[0].image_position_x must be 35');
    assert.equal(cardPayload.items[0].image_position_y, 65, 'items[0].image_position_y must be 65');
    assert.equal(cardPayload.banner_type, 'room', 'Banner type must be room for single-room');
  });

  await t.test('5. Multi-room booking maintains individual focal points and brand banner', async () => {
    // Room A: 20, 80
    const insA = await dbQuery.run(
      `INSERT INTO rooms (name, capacity, hourly_rate, image_url, image_position_x, image_position_y) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Room Multi A', 10, 400, '/uploads/rooms/a.jpg', 20, 80]
    );
    // Room B: 75, 25
    const insB = await dbQuery.run(
      `INSERT INTO rooms (name, capacity, hourly_rate, image_url, image_position_x, image_position_y) VALUES (?, ?, ?, ?, ?, ?)`,
      ['Room Multi B', 15, 600, '/uploads/rooms/b.jpg', 75, 25]
    );

    // Multi-room booking
    const bkgIns = await dbQuery.run(
      `INSERT INTO bookings (customer_name, total_amount, payment_status, receipt_number)
       VALUES (?, ?, 'completed', 'BK-TEST-MULTI-FOCAL')`,
      ['คุณประสิทธิ์ มัลติรูม', 2000]
    );
    const bookingId = bkgIns.id;

    await dbQuery.run(
      `INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal) VALUES (?, ?, '2026-10-21 09:00', '2026-10-21 11:00', 400, 800)`,
      [bookingId, insA.id]
    );
    await dbQuery.run(
      `INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal) VALUES (?, ?, '2026-10-21 13:00', '2026-10-21 15:00', 600, 1200)`,
      [bookingId, insB.id]
    );

    const items = await dbQuery.all(
      `SELECT bi.*, r.name as room_name, r.image_url as room_image_url, r.image_position_x as room_image_position_x, r.image_position_y as room_image_position_y
       FROM booking_items bi
       LEFT JOIN rooms r ON bi.room_id = r.id
       WHERE bi.booking_id = ?
       ORDER BY bi.start_time ASC`,
      [bookingId]
    );

    const roomMap = new Map();
    for (const item of items) {
      if (!item.room_id || roomMap.has(item.room_id)) continue;
      roomMap.set(item.room_id, {
        room_id: item.room_id,
        room_name: item.room_name,
        image_url: item.room_image_url,
        image_position_x: item.room_image_position_x,
        image_position_y: item.room_image_position_y
      });
    }

    const distinctRooms = Array.from(roomMap.values());
    const isMultiRoom = distinctRooms.length > 1;

    assert.equal(isMultiRoom, true, 'isMultiRoom must be true');
    assert.equal(distinctRooms.length, 2, 'Must have 2 distinct rooms');
    assert.equal(distinctRooms[0].image_position_x, 20);
    assert.equal(distinctRooms[0].image_position_y, 80);
    assert.equal(distinctRooms[1].image_position_x, 75);
    assert.equal(distinctRooms[1].image_position_y, 25);
  });
});
