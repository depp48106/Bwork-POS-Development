'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  ROOM_CONFLICT_MAP,
  getConflictingRoomIds,
  areRoomsConflicting,
  getRoomAvailabilityForDay
} = require('../../shared/roomAvailability.mjs');

const {
  buildAvailabilityResponse
} = require('../roomAvailabilityQuery.mjs');

const { runMigrations } = require('../migrator');

// Load and compile worker.js in an isolated context
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const cleanedSource = workerSource
  .replace('export default {', 'const workerDefault = {')
  .replace(/export\s*\{[^}]*\};?/g, '');
const wrappedSource = cleanedSource +
  '\nreturn { ...workerDefault, createToken, verifyToken, checkRoomOverlap, formatOverlapErrorMessage };';

function compileWorker(customGlobals = {}) {
  const globals = {
    URL,
    Response,
    Request,
    Headers,
    TextEncoder,
    Uint8Array,
    crypto: globalThis.crypto,
    console,
    isNaN,
    Number,
    parseInt,
    Date,
    btoa,
    atob,
    ...customGlobals
  };
  const fn = new Function(...Object.keys(globals), wrappedSource);
  return fn(...Object.values(globals));
}

function createD1Mock(db) {
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...args) {
          const clone = Object.create(this);
          clone._params = args;
          return clone;
        },
        async first() {
          const stmt = db.prepare(this._sql);
          return stmt.get(...this._params) || null;
        },
        async all() {
          const stmt = db.prepare(this._sql);
          return { results: stmt.all(...this._params) || [] };
        },
        async run() {
          const stmt = db.prepare(this._sql);
          const result = stmt.run(...this._params);
          return {
            meta: {
              changes: result.changes,
              last_row_id: Number(result.lastInsertRowid)
            }
          };
        }
      };
    },
    async batch(statements) {
      const results = [];
      db.exec('BEGIN TRANSACTION');
      try {
        for (const s of statements) {
          const stmt = db.prepare(s._sql);
          const res = stmt.run(...(s._params || []));
          results.push({
            meta: {
              changes: res.changes,
              last_row_id: Number(res.lastInsertRowid)
            }
          });
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return results;
    }
  };
}

async function initTestSchema(db) {
  db.exec('PRAGMA foreign_keys = ON;');
  const adapter = {
    async all(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    },
    async get(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.get(...params) || null;
    },
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      const stmt = db.prepare(sql);
      const res = stmt.run(...params);
      return { changes: res.changes, lastID: Number(res.lastInsertRowid) };
    }
  };
  await runMigrations(adapter);

  // Seed required test configuration, users and conflict rooms
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      details TEXT,
      performed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS timeline_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      author TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR REPLACE INTO settings (key, value) VALUES ('cleaning_buffer_minutes', '30');
    INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', 'test-secret-key-at-least-32-chars-long-xxx');

    INSERT OR REPLACE INTO users (id, username, password_hash, fullname, role, permissions) VALUES
      (1, 'staff1', 'hash1', 'Staff One', 'staff', 'pos,pending,history'),
      (2, 'admin', 'hash2', 'Admin User', 'admin', 'all');

    INSERT OR REPLACE INTO roles (name, label, permissions) VALUES
      ('staff', 'Staff', 'pos,pending,history'),
      ('admin', 'Admin', 'all');

    INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, daily_rate, half_day_rate, status) VALUES
      (4, 'Mars (301)', 8, 400, 3000, 1800, 'active'),
      (5, 'Mercury (302)', 10, 500, 3500, 2000, 'active'),
      (10, 'Jupiter (300)', 40, 1000, 8000, 4500, 'active'),
      (12, 'Jupiter (300) & Co-Working', 40, 1500, 12000, 7000, 'active'),
      (13, 'เหมาโซน Co-working', 40, 800, 6000, 3500, 'active');
  `);
}

test('1. Room Conflict Matrix Definition', () => {
  // Room 10 (Jupiter) conflicts with Room 10 and Room 12
  assert.deepEqual(getConflictingRoomIds(10), [10, 12]);
  // Room 12 (Jupiter & Co-Working) conflicts with Room 12, 10, and 13
  assert.deepEqual(getConflictingRoomIds(12), [12, 10, 13]);
  // Room 13 (Co-Working) conflicts with Room 13 and Room 12
  assert.deepEqual(getConflictingRoomIds(13), [13, 12]);
  // Normal room (e.g. 4) conflicts only with itself
  assert.deepEqual(getConflictingRoomIds(4), [4]);

  // Symmetric conflict checks
  assert.equal(areRoomsConflicting(10, 12), true);
  assert.equal(areRoomsConflicting(12, 10), true);
  assert.equal(areRoomsConflicting(12, 13), true);
  assert.equal(areRoomsConflicting(13, 12), true);

  // Separate areas do NOT conflict
  assert.equal(areRoomsConflicting(10, 13), false);
  assert.equal(areRoomsConflicting(13, 10), false);
  assert.equal(areRoomsConflicting(4, 5), false);
  assert.equal(areRoomsConflicting(10, 4), false);
});

test('2. Worker checkRoomOverlap Enforces Conflict Map with Buffer', async () => {
  const db = new DatabaseSync(':memory:');
  await initTestSchema(db);
  const worker = compileWorker();
  const env = { DB: createD1Mock(db) };

  // Insert an existing booking on Room 10 (Jupiter) 10:00 - 12:00
  db.exec(`
    INSERT INTO bookings (id, customer_name, receipt_number, payment_status, total_amount, created_at)
    VALUES (1, 'Alice', 'BK-20261112-001', 'pending', 1000, '2026-11-12T08:00:00');
    INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, checkin_status)
    VALUES (1, 10, '2026-11-12T10:00:00', '2026-11-12T12:00:00', 1000, 1000, 'pending');
  `);

  // A. Checking Room 10 directly on same slot -> Overlap
  const resSame = await worker.checkRoomOverlap(env, 10, '2026-11-12T10:00:00', '2026-11-12T12:00:00');
  assert.equal(resSame.hasOverlap, true);

  // B. Checking Room 12 (Jupiter & Co-Working) on same slot -> Overlap!
  const resCombo = await worker.checkRoomOverlap(env, 12, '2026-11-12T10:00:00', '2026-11-12T12:00:00');
  assert.equal(resCombo.hasOverlap, true);
  assert.equal(resCombo.booking.room_id, 10);
  assert.equal(resCombo.booking.room_name, 'Jupiter (300)');

  // C. Checking Room 12 in the 30-min cleaning buffer (12:00 - 12:30) -> Overlap (isCleaningBuffer: true)
  const resBuffer = await worker.checkRoomOverlap(env, 12, '2026-11-12T12:00:00', '2026-11-12T13:00:00');
  assert.equal(resBuffer.hasOverlap, true);
  assert.equal(resBuffer.isCleaningBuffer, true);

  // D. Checking Room 13 (Co-Working) on same slot (10:00 - 12:00) -> NO overlap (physically separate)
  const resCoWork = await worker.checkRoomOverlap(env, 13, '2026-11-12T10:00:00', '2026-11-12T12:00:00');
  assert.equal(resCoWork.hasOverlap, false);

  // E. Reverse test: Insert booking on Room 12, check Room 10 and Room 13
  db.exec(`
    INSERT INTO bookings (id, customer_name, receipt_number, payment_status, total_amount, created_at)
    VALUES (2, 'Bob', 'BK-20261112-002', 'pending', 1500, '2026-11-12T08:00:00');
    INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, checkin_status)
    VALUES (2, 12, '2026-11-12T14:00:00', '2026-11-12T16:00:00', 1500, 1500, 'pending');
  `);

  // Room 10 checked at 14:00 - 16:00 -> Overlap!
  const resJupFromCombo = await worker.checkRoomOverlap(env, 10, '2026-11-12T14:00:00', '2026-11-12T16:00:00');
  assert.equal(resJupFromCombo.hasOverlap, true);
  assert.equal(resJupFromCombo.booking.room_id, 12);

  // Room 13 checked at 14:00 - 16:00 -> Overlap!
  const resCoFromCombo = await worker.checkRoomOverlap(env, 13, '2026-11-12T14:00:00', '2026-11-12T16:00:00');
  assert.equal(resCoFromCombo.hasOverlap, true);
  assert.equal(resCoFromCombo.booking.room_id, 12);

  // Formatted error message mentions conflicting room name
  const msg = worker.formatOverlapErrorMessage('Jupiter (300)', resJupFromCombo, 10);
  assert.match(msg, /ทับซ้อนกับห้อง "Jupiter \(300\) & Co-Working"/);
});

test('3. Jupiter Three-Way Conflict Matrix (10 vs 12 vs 13) across Staff, Public & POS', async () => {
  const month = { month: '2026-11' };
  const rooms = [
    { id: 10, name: 'Jupiter (300)' },
    { id: 12, name: 'Jupiter (300) & Co-Working' },
    { id: 13, name: 'เหมาโซน Co-working' }
  ];

  // -------------------------------------------------------------
  // Scenario A: Book Room 10 (09:00 - 11:00)
  // - Room 10 is blocked
  // - Room 12 is blocked
  // - Room 13 is FREE (no transitive blocking!)
  // -------------------------------------------------------------
  const items10 = [{ room_id: 10, start_time: '2026-11-15T09:00:00', end_time: '2026-11-15T11:00:00' }];
  const resp10 = buildAvailabilityResponse(month, rooms, items10, 30, t => t);

  // 1. Staff Availability Page consumes data.intervals directly
  const r10BookingsFrom10 = resp10.intervals.filter(i => i.room_id === 10);
  const r12BookingsFrom10 = resp10.intervals.filter(i => i.room_id === 12);
  const r13BookingsFrom10 = resp10.intervals.filter(i => i.room_id === 13);

  assert.equal(getRoomAvailabilityForDay('2026-11-15', r10BookingsFrom10, 30).status, 'partial', 'Room 10 must be blocked');
  assert.equal(getRoomAvailabilityForDay('2026-11-15', r12BookingsFrom10, 30).status, 'partial', 'Room 12 must be blocked by Room 10');
  assert.equal(getRoomAvailabilityForDay('2026-11-15', r13BookingsFrom10, 30).status, 'free', 'Room 13 must remain FREE (no transitive block!)');

  // 2. Schedule & Booking API
  const db10 = new DatabaseSync(':memory:');
  await initTestSchema(db10);
  const worker = compileWorker();
  const env10 = { DB: createD1Mock(db10) };

  // Book Room 10 via public booking API
  const bookRes10 = await worker.fetch(new Request('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Customer 10',
      contact: '0812345678',
      room_id: 10,
      start_time: '09:00',
      end_time: '11:00',
      booking_date: '2026-11-15',
      guest_count: 5
    })
  }), env10);
  assert.equal(bookRes10.status, 201, 'Public booking on Room 10 succeeds');

  // Customer Room Schedule
  const schedRes10 = await worker.fetch(new Request('http://localhost/api/public/rooms/schedule?date=2026-11-15'), env10);
  const schedData10 = await schedRes10.json();
  const s10 = schedData10.rooms.find(r => r.id === 10);
  const s12 = schedData10.rooms.find(r => r.id === 12);
  const s13 = schedData10.rooms.find(r => r.id === 13);
  assert.ok(s10.bookings.some(b => String(b.start_time).includes('09:00')), 'Room 10 schedule shows booked');
  assert.ok(s12.bookings.some(b => String(b.start_time).includes('09:00')), 'Room 12 schedule shows booked');
  assert.equal(s13.bookings.length, 0, 'Room 13 schedule is empty');

  // Public Booking attempt on Room 12 -> 409 Conflict
  const conflictRes12 = await worker.fetch(new Request('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Customer 12 Blocked',
      contact: '0812345678',
      room_id: 12,
      start_time: '09:00',
      end_time: '11:00',
      booking_date: '2026-11-15',
      guest_count: 5
    })
  }), env10);
  assert.equal(conflictRes12.status, 409, 'Room 12 is blocked when Room 10 is booked');

  // Public Booking attempt on Room 13 on same slot -> 201 SUCCEEDS
  const successRes13 = await worker.fetch(new Request('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Customer 13 Allowed',
      contact: '0812345678',
      room_id: 13,
      start_time: '09:00',
      end_time: '11:00',
      booking_date: '2026-11-15',
      guest_count: 5
    })
  }), env10);
  assert.equal(successRes13.status, 201, 'Room 13 succeeds when Room 10 is booked');

  // POS Overlap check
  const posOverlap10 = await worker.checkRoomOverlap(env10, 10, '2026-11-15T09:00:00', '2026-11-15T11:00:00');
  const posOverlap12 = await worker.checkRoomOverlap(env10, 12, '2026-11-15T09:00:00', '2026-11-15T11:00:00');
  assert.equal(posOverlap10.hasOverlap, true);
  assert.equal(posOverlap12.hasOverlap, true);

  // -------------------------------------------------------------
  // Scenario B: Book Room 13 (13:00 - 15:00)
  // - Room 13 is blocked
  // - Room 12 is blocked
  // - Room 10 is FREE
  // -------------------------------------------------------------
  const items13 = [{ room_id: 13, start_time: '2026-11-15T13:00:00', end_time: '2026-11-15T15:00:00' }];
  const resp13 = buildAvailabilityResponse(month, rooms, items13, 30, t => t);

  const r10BookingsFrom13 = resp13.intervals.filter(i => i.room_id === 10);
  const r12BookingsFrom13 = resp13.intervals.filter(i => i.room_id === 12);
  const r13BookingsFrom13 = resp13.intervals.filter(i => i.room_id === 13);

  assert.equal(getRoomAvailabilityForDay('2026-11-15', r13BookingsFrom13, 30).status, 'partial', 'Room 13 is blocked');
  assert.equal(getRoomAvailabilityForDay('2026-11-15', r12BookingsFrom13, 30).status, 'partial', 'Room 12 is blocked by Room 13');
  assert.equal(getRoomAvailabilityForDay('2026-11-15', r10BookingsFrom13, 30).status, 'free', 'Room 10 remains FREE');

  const db13 = new DatabaseSync(':memory:');
  await initTestSchema(db13);
  const env13 = { DB: createD1Mock(db13) };

  // Book Room 13
  const bookRes13 = await worker.fetch(new Request('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Customer 13',
      contact: '0812345678',
      room_id: 13,
      start_time: '13:00',
      end_time: '15:00',
      booking_date: '2026-11-15',
      guest_count: 5
    })
  }), env13);
  assert.equal(bookRes13.status, 201);

  // Public Booking attempt on Room 12 -> 409 Conflict
  const conflictRes12From13 = await worker.fetch(new Request('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Customer 12 Blocked',
      contact: '0812345678',
      room_id: 12,
      start_time: '13:00',
      end_time: '15:00',
      booking_date: '2026-11-15',
      guest_count: 5
    })
  }), env13);
  assert.equal(conflictRes12From13.status, 409, 'Room 12 is blocked when Room 13 is booked');

  // Public Booking attempt on Room 10 on same slot -> 201 SUCCEEDS
  const successRes10 = await worker.fetch(new Request('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Customer 10 Allowed',
      contact: '0812345678',
      room_id: 10,
      start_time: '13:00',
      end_time: '15:00',
      booking_date: '2026-11-15',
      guest_count: 5
    })
  }), env13);
  assert.equal(successRes10.status, 201, 'Room 10 succeeds when Room 13 is booked');

  // -------------------------------------------------------------
  // Scenario C: Book Room 12 (16:00 - 18:00)
  // - Room 12 is blocked
  // - BOTH Room 10 and Room 13 are blocked!
  // -------------------------------------------------------------
  const items12 = [{ room_id: 12, start_time: '2026-11-15T16:00:00', end_time: '2026-11-15T18:00:00' }];
  const resp12 = buildAvailabilityResponse(month, rooms, items12, 30, t => t);

  const r10BookingsFrom12 = resp12.intervals.filter(i => i.room_id === 10);
  const r12BookingsFrom12 = resp12.intervals.filter(i => i.room_id === 12);
  const r13BookingsFrom12 = resp12.intervals.filter(i => i.room_id === 13);

  assert.equal(getRoomAvailabilityForDay('2026-11-15', r12BookingsFrom12, 30).status, 'partial', 'Room 12 is blocked');
  assert.equal(getRoomAvailabilityForDay('2026-11-15', r10BookingsFrom12, 30).status, 'partial', 'Room 10 is blocked by Room 12');
  assert.equal(getRoomAvailabilityForDay('2026-11-15', r13BookingsFrom12, 30).status, 'partial', 'Room 13 is blocked by Room 12');

  const db12 = new DatabaseSync(':memory:');
  await initTestSchema(db12);
  const env12 = { DB: createD1Mock(db12) };

  // Book Room 12
  const bookRes12 = await worker.fetch(new Request('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Customer 12',
      contact: '0812345678',
      room_id: 12,
      start_time: '16:00',
      end_time: '18:00',
      booking_date: '2026-11-15',
      guest_count: 5
    })
  }), env12);
  assert.equal(bookRes12.status, 201);

  // Public Booking attempt on Room 10 -> 409 Conflict
  const conflict10From12 = await worker.fetch(new Request('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Customer 10 Blocked',
      contact: '0812345678',
      room_id: 10,
      start_time: '16:00',
      end_time: '18:00',
      booking_date: '2026-11-15',
      guest_count: 5
    })
  }), env12);
  assert.equal(conflict10From12.status, 409, 'Room 10 is blocked when Room 12 is booked');

  // Public Booking attempt on Room 13 -> 409 Conflict
  const conflict13From12 = await worker.fetch(new Request('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Customer 13 Blocked',
      contact: '0812345678',
      room_id: 13,
      start_time: '16:00',
      end_time: '18:00',
      booking_date: '2026-11-15',
      guest_count: 5
    })
  }), env12);
  assert.equal(conflict13From12.status, 409, 'Room 13 is blocked when Room 12 is booked');
});

test('4. Worker Reschedule API Enforces Conflict Matrix and Buffer', async () => {
  const db = new DatabaseSync(':memory:');
  await initTestSchema(db);
  const worker = compileWorker();
  const env = { DB: createD1Mock(db) };

  const staffToken = await worker.createToken({ id: 1, username: 'staff1', role: 'staff', permissions: 'pos,pending,history' }, 'test-secret-key-at-least-32-chars-long-xxx');

  // Insert existing booking on Room 10 (10:00 - 12:00)
  db.exec(`
    INSERT INTO bookings (id, customer_name, receipt_number, payment_status, total_amount, subtotal_amount, paid_amount, created_at)
    VALUES (1, 'Alice', 'BK-20261112-001', 'pending', 1000, 1000, 0, '2026-11-12T08:00:00');
    INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, checkin_status)
    VALUES (101, 1, 10, '2026-11-12T10:00:00', '2026-11-12T12:00:00', 1000, 1000, 'pending');

    -- Insert another booking to be rescheduled (currently at 14:00 - 16:00 on Room 4)
    INSERT INTO bookings (id, customer_name, receipt_number, payment_status, total_amount, subtotal_amount, paid_amount, created_at)
    VALUES (2, 'Bob', 'BK-20261112-002', 'pending', 500, 500, 0, '2026-11-12T08:00:00');
    INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, checkin_status)
    VALUES (201, 2, 4, '2026-11-12T14:00:00', '2026-11-12T16:00:00', 500, 500, 'pending');
  `);

  // Attempt to reschedule booking 2 into Room 12 at 10:00 - 12:00 (which conflicts with Room 10)
  const reqRescheduleConflict = new Request('http://localhost/api/bookings/2/reschedule', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${staffToken}`
    },
    body: JSON.stringify({
      booking_item_id: 201,
      room_id: 12,
      date: '2026-11-12',
      start_time: '10:00',
      end_time: '12:00'
    })
  });
  const resRescheduleConflict = await worker.fetch(reqRescheduleConflict, env);
  assert.equal(resRescheduleConflict.status, 400, 'Rescheduling Room 12 into Room 10 slot must be rejected');
  const resJson = await resRescheduleConflict.json();
  assert.equal(resJson.code, 'ERR_ROOM_OVERLAP');

  // Attempt to reschedule booking 2 into Room 13 at 10:00 - 12:00 (physically separate space -> SUCCEEDS)
  const reqRescheduleOk = new Request('http://localhost/api/bookings/2/reschedule', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${staffToken}`
    },
    body: JSON.stringify({
      booking_item_id: 201,
      room_id: 13,
      date: '2026-11-12',
      start_time: '10:00',
      end_time: '12:00'
    })
  });
  const resRescheduleOk = await worker.fetch(reqRescheduleOk, env);
  assert.equal(resRescheduleOk.status, 200, 'Rescheduling to Room 13 alongside Room 10 must succeed');
});

test('5. POS Hard Deletion - Cascades Child Tables, Frees Slot, and Enforces Financial Rules', async () => {
  const db = new DatabaseSync(':memory:');
  await initTestSchema(db);
  const worker = compileWorker();
  const env = { DB: createD1Mock(db) };

  // Helper to generate auth token
  const staffToken = await worker.createToken({ id: 1, username: 'staff1', role: 'staff', permissions: 'pos,pending,history' }, 'test-secret-key-at-least-32-chars-long-xxx');
  const adminToken = await worker.createToken({ id: 2, username: 'admin', role: 'admin', permissions: 'all' }, 'test-secret-key-at-least-32-chars-long-xxx');

  // Insert a test booking with all related tables populated
  db.exec(`
    INSERT INTO bookings (id, customer_name, receipt_number, payment_status, total_amount, paid_amount, created_at)
    VALUES (10, 'Test Customer', 'BK-20261112-010', 'pending', 1000, 0, '2026-11-12T08:00:00');

    INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, checkin_status)
    VALUES (100, 10, 10, '2026-11-12T10:00:00', '2026-11-12T12:00:00', 1000, 1000, 'pending');

    INSERT INTO booking_history (booking_id, action, details) VALUES (10, 'create', 'test');
    INSERT INTO timeline_notes (booking_id, author, content) VALUES (10, 'staff1', 'note');
    INSERT INTO payment_transactions (booking_id, amount, payment_method) VALUES (10, 0, 'cash');
    INSERT INTO slip_verifications (booking_id, trans_ref) VALUES (10, 'REF123');
    INSERT INTO line_notification_claims (booking_id, notification_type, claim_token, retry_key, claimed_at, updated_at)
    VALUES (10, 'booking_confirmed', 'token_123', 'retry_123', '2026-11-12T08:00:00', '2026-11-12T08:00:00');
    INSERT INTO room_guidelines_acknowledgements (booking_id, room_id, rule_set, rule_version) VALUES (10, 10, 'standard', '1.0');
    INSERT INTO line_guidelines_dispatches (line_user_id, rule_set, rule_version, first_booking_id) VALUES ('U123', 'standard', '1.0', 10);
    INSERT INTO tax_invoices (booking_id, invoice_number, tax_name, tax_id, tax_address)
    VALUES (10, 'INV001', 'Test Corp', '1234567890123', 'Bangkok');
    INSERT INTO tax_invoice_email_logs (booking_id, recipient_email, subject) VALUES (10, 'test@example.com', 'Your Receipt');
    INSERT INTO support_tickets (booking_id, ticket_number, customer_name, customer_phone, category, subject, description)
    VALUES (10, 'TICKET-001', 'Test Customer', '0812345678', 'booking', 'Ticket Subject', 'Ticket details');
  `);

  // Verify room is currently blocked
  const beforeOverlap = await worker.checkRoomOverlap(env, 10, '2026-11-12T10:00:00', '2026-11-12T12:00:00');
  assert.equal(beforeOverlap.hasOverlap, true);

  // A. Missing Auth -> 401
  const reqNoAuth = new Request('http://localhost/api/bookings/10', { method: 'DELETE' });
  const resNoAuth = await worker.fetch(reqNoAuth, env);
  assert.equal(resNoAuth.status, 401);

  // B. Staff Deletes Pending Booking by numeric ID -> Success (200)
  const reqDelete = new Request('http://localhost/api/bookings/10', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  const resDelete = await worker.fetch(reqDelete, env);
  assert.equal(resDelete.status, 200);
  const dataDelete = await resDelete.json();
  assert.equal(dataDelete.success, true);

  // C. Verify all child tables were cleaned up
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM bookings WHERE id = 10').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM booking_items WHERE booking_id = 10').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM booking_history WHERE booking_id = 10').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM timeline_notes WHERE booking_id = 10').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM payment_transactions WHERE booking_id = 10').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM slip_verifications WHERE booking_id = 10').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM line_notification_claims WHERE booking_id = 10').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM room_guidelines_acknowledgements WHERE booking_id = 10').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM tax_invoices WHERE booking_id = 10').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM tax_invoice_email_logs WHERE booking_id = 10').get().c, 0);
  // Unlinked reference:
  assert.equal(db.prepare('SELECT first_booking_id FROM line_guidelines_dispatches WHERE line_user_id = ?').get('U123').first_booking_id, null);
  assert.equal(db.prepare('SELECT booking_id FROM support_tickets WHERE ticket_number = ?').get('TICKET-001').booking_id, null);

  // D. Time slot is FREED immediately!
  const afterOverlap = await worker.checkRoomOverlap(env, 10, '2026-11-12T10:00:00', '2026-11-12T12:00:00');
  assert.equal(afterOverlap.hasOverlap, false);

  // E. Deletion by Receipt Number
  db.exec(`
    INSERT INTO bookings (id, customer_name, receipt_number, payment_status, total_amount, paid_amount, created_at)
    VALUES (20, 'Receipt Delete Test', 'BK-20261112-020', 'pending', 500, 0, '2026-11-12T08:00:00');
    INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal)
    VALUES (20, 4, '2026-11-12T13:00:00', '2026-11-12T14:00:00', 500, 500);
  `);
  const reqByReceipt = new Request('http://localhost/api/bookings/BK-20261112-020', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  const resByReceipt = await worker.fetch(reqByReceipt, env);
  assert.equal(resByReceipt.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM bookings WHERE id = 20').get().c, 0);

  // F. Paid Booking cannot be deleted by normal staff -> 403
  db.exec(`
    INSERT INTO bookings (id, customer_name, receipt_number, payment_status, total_amount, paid_amount, created_at)
    VALUES (30, 'Paid Customer', 'BK-20261112-030', 'paid', 2000, 2000, '2026-11-12T08:00:00');
    INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal)
    VALUES (30, 4, '2026-11-12T15:00:00', '2026-11-12T17:00:00', 2000, 2000);
  `);
  const reqPaidStaff = new Request('http://localhost/api/bookings/30', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  const resPaidStaff = await worker.fetch(reqPaidStaff, env);
  assert.equal(resPaidStaff.status, 403);
  const dataPaidErr = await resPaidStaff.json();
  assert.match(dataPaidErr.error, /ไม่อนุญาตให้ลบรายการจองที่ชำระเงินแล้ว/);

  // G. Admin CAN delete paid booking
  const reqPaidAdmin = new Request('http://localhost/api/bookings/30', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const resPaidAdmin = await worker.fetch(reqPaidAdmin, env);
  assert.equal(resPaidAdmin.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM bookings WHERE id = 30').get().c, 0);

  // H. Booking linked to hour credit cannot be deleted -> 409
  db.exec(`
    INSERT INTO bookings (id, customer_name, receipt_number, payment_status, total_amount, created_at)
    VALUES (40, 'Credit Source', 'BK-20261112-040', 'pending', 0, '2026-11-12T08:00:00');
    INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal)
    VALUES (401, 40, 10, '2026-11-12T08:00:00', '2026-11-12T09:00:00', 0, 0);
    INSERT INTO room_hour_credits (credit_id, source_booking_id, source_item_id, customer_name, customer_phone, room_id, created_by, created_at)
    VALUES ('CR-001', 40, 401, 'Credit Source', '0812345678', 10, 1, '2026-11-12T08:00:00');
  `);
  const reqCredit = new Request('http://localhost/api/bookings/40', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const resCredit = await worker.fetch(reqCredit, env);
  assert.equal(resCredit.status, 409);
  const dataCreditErr = await resCredit.json();
  assert.match(dataCreditErr.error, /linked to hour credit|ผูกกับเครดิตชั่วโมง/);
});

test('6. Worker Concurrency & Race Condition: Room 10 vs Room 12 vs Room 13', async () => {
  const db = new DatabaseSync(':memory:');
  await initTestSchema(db);
  const worker = compileWorker();
  const env = { DB: createD1Mock(db) };

  const staffToken = await worker.createToken({ id: 1, username: 'staff1', role: 'staff', permissions: 'pos,pending,history' }, 'test-secret-key-at-least-32-chars-long-xxx');

  // Attempt 1: Book Room 10 (Jupiter) 10:00 - 12:00 via POST /api/bookings
  const req10 = new Request('http://localhost/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${staffToken}`
    },
    body: JSON.stringify({
      customer_name: 'Customer Jup',
      items: [{
        room_id: 10,
        start_time: '2026-11-12T10:00:00',
        end_time: '2026-11-12T12:00:00',
        price: 1000,
        subtotal: 1000,
        quantity: 1,
        booking_type: 'hourly'
      }]
    })
  });

  const res10 = await worker.fetch(req10, env);
  assert.equal(res10.status, 201);

  // Attempt 2: Simultaneous or sequential attempt to book Room 12 (Jupiter & Co-Working) on same slot 10:00 - 12:00
  const req12 = new Request('http://localhost/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${staffToken}`
    },
    body: JSON.stringify({
      customer_name: 'Customer Combo',
      items: [{
        room_id: 12,
        start_time: '2026-11-12T10:00:00',
        end_time: '2026-11-12T12:00:00',
        price: 1500,
        subtotal: 1500,
        quantity: 1,
        booking_type: 'hourly'
      }]
    })
  });

  const res12 = await worker.fetch(req12, env);
  assert.equal(res12.status, 409, 'Room 12 must be blocked by Room 10 booking');
  const data12 = await res12.json();
  assert.match(data12.error, /Jupiter/);

  // Attempt 3: Book Room 13 (Co-Working) on the EXACT SAME time slot 10:00 - 12:00
  // Since Room 10 does NOT overlap with Room 13, this MUST succeed!
  const req13 = new Request('http://localhost/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${staffToken}`
    },
    body: JSON.stringify({
      customer_name: 'Customer Cowork',
      items: [{
        room_id: 13,
        start_time: '2026-11-12T10:00:00',
        end_time: '2026-11-12T12:00:00',
        price: 800,
        subtotal: 800,
        quantity: 1,
        booking_type: 'hourly'
      }]
    })
  });

  const res13 = await worker.fetch(req13, env);
  assert.equal(res13.status, 201, 'Room 13 must succeed concurrently with Room 10');

  // Verify DB state: Room 10 and Room 13 both exist; Room 12 was rejected with 0 rows
  const bookedRoomIds = db.prepare('SELECT room_id FROM booking_items ORDER BY room_id').all().map(r => r.room_id);
  assert.deepEqual(bookedRoomIds, [10, 13]);
});
