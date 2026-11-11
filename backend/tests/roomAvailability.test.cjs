const assert = require('node:assert/strict');
const fs = require('node:fs');
const { registerHooks } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const workerUrl = pathToFileURL(require.resolve('../worker.js')).href;
const workerHook = registerHooks({
  load(url, context, nextLoad) {
    if (url !== workerUrl) return nextLoad(url, context);
    return { format: 'module', source: fs.readFileSync(new URL(url)), shortCircuit: true };
  }
});
const workerModule = import(workerUrl).finally(() => workerHook.deregister());

test('monthly Worker availability uses POS reservations without returning customer data', async t => {
  const { default: worker } = await workerModule;
  const { getRoomAvailabilityForDay } = await import('../../shared/roomAvailability.mjs');
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE settings (key TEXT, value TEXT);
    INSERT INTO settings VALUES ('cleaning_buffer_minutes', '30');
    CREATE TABLE rooms (id INTEGER, name TEXT, capacity INTEGER, status TEXT, pin_code TEXT);
    INSERT INTO rooms VALUES (4, 'Mars (301)', 6, 'active', 'private'),
                             (5, 'Mercury (302)', 8, 'active', NULL),
                             (6, 'Saturn (303)', 4, 'inactive', NULL);
    CREATE TABLE bookings (id INTEGER, payment_status TEXT, customer_name TEXT);
    INSERT INTO bookings VALUES (1, 'paid', 'private'), (2, 'pending', 'private'),
      (3, 'cancelled', 'private'), (4, 'failed', 'private'), (5, 'rejected', 'private'),
      (6, NULL, 'private');
    CREATE TABLE booking_items (booking_id INTEGER, room_id INTEGER, start_time TEXT, end_time TEXT, checkin_status TEXT);
    INSERT INTO booking_items VALUES
      (1, 4, '2026-11-12T09:00:00', '2026-11-12T11:00:00', NULL),
      (2, 4, '2026-11-12T06:00:00Z', '2026-11-12T07:00:00Z', NULL),
      (3, 4, '2026-11-12T08:00:00', '2026-11-12T18:00:00', NULL),
      (4, 4, '2026-11-12T08:00:00', '2026-11-12T18:00:00', NULL),
      (5, 4, '2026-11-12T08:00:00', '2026-11-12T18:00:00', NULL),
      (1, 4, '2026-11-12T08:00:00', '2026-11-12T18:00:00', 'cancelled'),
      (1, 6, '2026-11-12T08:00:00', '2026-11-12T18:00:00', NULL),
      (6, 4, '2026-10-31T17:00:00', '2026-11-01T09:00:00', NULL),
      (1, 4, '2026-12-10T09:00:00', '2026-12-10T11:00:00', NULL);
  `);
  const env = {
    DB: {
      prepare(sql) {
        const statement = db.prepare(sql);
        const bound = params => ({
          first: async () => statement.get(...params) ?? null,
          all: async () => ({ results: statement.all(...params) })
        });
        return { ...bound([]), bind: (...params) => bound(params) };
      },
      batch(statements) { return Promise.all(statements.map(statement => statement.all())); }
    }
  };
  const request = month => worker.fetch(new Request(`http://localhost/api/public/rooms/availability-month?month=${month}`), env);

  assert.equal((await request('2026-13')).status, 400);
  const response = await request('2026-11');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = await response.json();
  assert.deepEqual(data.rooms, [
    { id: 4, name: 'Mars (301)', capacity: 6 }, { id: 5, name: 'Mercury (302)', capacity: 8 }
  ]);
  assert.equal(data.intervals.length, 3);
  assert.ok(data.intervals.every(item => Object.keys(item).sort().join(',') === 'end,room_id,start'));
  assert.deepEqual(getRoomAvailabilityForDay('2026-11-12', data.intervals, data.cleaning_buffer_minutes), {
    status: 'partial',
    ranges: [{ start: '08:00', end: '08:30' }, { start: '11:30', end: '12:30' }, { start: '14:30', end: '18:00' }]
  });
  assert.deepEqual(getRoomAvailabilityForDay('2026-11-01', data.intervals, data.cleaning_buffer_minutes).ranges,
    [{ start: '09:30', end: '18:00' }]);
});

test('calendar supports leap days and rejects unavailable fragments shorter than a slot', async () => {
  const { getAvailabilityMonth, getRoomAvailabilityForDay } = await import('../../shared/roomAvailability.mjs');
  assert.equal(getAvailabilityMonth('2028-02').days, 29);
  assert.equal(getAvailabilityMonth('2026-12', 1).month, '2027-01');
  assert.equal(getRoomAvailabilityForDay('2026-11-12', [], 30).status, 'free');
  assert.deepEqual(getRoomAvailabilityForDay('2026-11-12', [{
    start: '2026-11-12T08:15:00', end: '2026-11-12T17:45:00'
  }], 0), { status: 'full', ranges: [] });
});
