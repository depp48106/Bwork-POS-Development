'use strict';

/**
 * crossChannelConcurrency.test.cjs
 * Comprehensive Real Concurrency UAT Suite:
 * - Scenario A: POS Extension vs LINE OA Booking
 * - Scenario B: Cleaning Buffer (30 mins before next customer)
 * - Scenario C: Two Staff Extension (Simultaneous submit)
 * - Scenario D: Two New Bookings (Simultaneous submit on same room/time)
 * - Scenario E: Stale Availability
 * - Stress Testing: Multiple parallel execution cycles with strict database verification
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const { app, createToken, autoCancelInterval } = require('../server.js');
const { dbQuery } = require('../database.js');

let server;
let baseUrl;
let staffToken;

test.before(async () => {
  staffToken = createToken({ id: 1, username: 'staff_tester', role: 'staff' });
  
  // Start ephemeral HTTP test server
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[Concurrency UAT] Test server listening on ${baseUrl}`);
      resolve();
    });
  });
});

test.after(async () => {
  if (autoCancelInterval) {
    clearInterval(autoCancelInterval);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// Helper to seed a fresh room and clean test bookings
async function resetRoom(roomName = 'Room 302 Concurrency') {
  let room = await dbQuery.get('SELECT * FROM rooms WHERE name = ?', [roomName]);
  if (!room) {
    const res = await dbQuery.run(
      'INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, status) VALUES (?, ?, ?, ?, ?)',
      [roomName, 8, 500, 3000, 'active']
    );
    room = await dbQuery.get('SELECT * FROM rooms WHERE id = ?', [res.id]);
  }
  // Clear any existing test bookings for this room
  const items = await dbQuery.all('SELECT booking_id FROM booking_items WHERE room_id = ?', [room.id]);
  for (const it of items) {
    await dbQuery.run('DELETE FROM payment_transactions WHERE booking_id = ?', [it.booking_id]);
    await dbQuery.run('DELETE FROM booking_history WHERE booking_id = ?', [it.booking_id]);
    await dbQuery.run('DELETE FROM booking_items WHERE booking_id = ?', [it.booking_id]);
    await dbQuery.run('DELETE FROM bookings WHERE id = ?', [it.booking_id]);
  }
  return room;
}

test('SCENARIO-A: POS Extension (13:00-14:00) vs LINE OA Booking (13:30-14:30) on Room 302', async () => {
  const room = await resetRoom('Room 302 Concurrency');

  // Existing booking: 12:00 - 13:00
  const bRes = await dbQuery.run(
    `INSERT INTO bookings (customer_name, contact, total_amount, paid_amount, balance_amount, payment_status, payment_method)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Customer A', '0812345678', 500, 500, 0, 'paid', 'cash']
  );
  const bookingId = bRes.id;
  const itRes = await dbQuery.run(
    `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal, checkin_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [bookingId, room.id, 1, 500, '2026-10-28T12:00:00', '2026-10-28T13:00:00', 500, 'pending']
  );
  const bookingItemId = itRes.id;

  // POS Extension payload: extend 60 mins (13:00 -> 14:00)
  const posPayload = {
    booking_item_id: bookingItemId,
    current_end_time: '2026-10-28T13:00:00',
    duration_minutes: 60,
    payment_method: 'cash',
    amount_paid: 500
  };

  // LINE OA Booking payload: 13:30 - 14:30 (overlaps with extended 13:00-14:00 and cleaning buffer)
  const linePayload = {
    customer_name: 'LINE Customer',
    contact: '0899998888',
    room_id: room.id,
    booking_date: '2026-10-28',
    start_time: '13:30',
    end_time: '14:30',
    booking_type: 'hourly',
    guest_count: 2
  };

  // Launch both requests simultaneously
  const [posRes, lineRes] = await Promise.all([
    fetch(`${baseUrl}/api/bookings/${bookingId}/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify(posPayload)
    }),
    fetch(`${baseUrl}/api/public/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(linePayload)
    })
  ]);

  const posStatus = posRes.status;
  const lineStatus = lineRes.status;
  const posJson = await posRes.json().catch(() => ({}));
  const lineJson = await lineRes.json().catch(() => ({}));

  console.log(`[Scenario A Result] POS Extension Status: ${posStatus}, LINE OA Status: ${lineStatus}`);

  // Assert: Exactly ONE succeeds (200), and the other fails with 409 Conflict
  const oneSucceeded = (posStatus === 200 && lineStatus === 409) || (posStatus === 409 && (lineStatus === 200 || lineStatus === 201));
  assert.ok(oneSucceeded, `Exactly one request must succeed, other must be 409 Conflict. Got POS: ${posStatus}, LINE: ${lineStatus}`);

  // Verify Database Integrity: No overlap in booking_items!
  const activeItems = await dbQuery.all(
    `SELECT bi.*, b.customer_name, b.payment_status FROM booking_items bi
     JOIN bookings b ON bi.booking_id = b.id
     WHERE bi.room_id = ? AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed'))`,
    [room.id]
  );

  // Check overlap among active items
  for (let i = 0; i < activeItems.length; i++) {
    for (let j = i + 1; j < activeItems.length; j++) {
      const it1 = activeItems[i];
      const it2 = activeItems[j];
      const s1 = new Date(it1.start_time).getTime();
      const e1 = new Date(it1.end_time).getTime();
      const s2 = new Date(it2.start_time).getTime();
      const e2 = new Date(it2.end_time).getTime();
      const overlaps = (s1 < e2 && e1 > s2);
      assert.equal(overlaps, false, `Database must have NO overlapping booking items! Found ${it1.customer_name} (${it1.start_time}-${it1.end_time}) and ${it2.customer_name} (${it2.start_time}-${it2.end_time})`);
    }
  }

  // Financial invariant verification: total_amount = paid_amount + balance_amount
  const allBookings = await dbQuery.all('SELECT * FROM bookings WHERE id IN (?, ?)', [bookingId, lineJson.id || 0]);
  for (const b of allBookings) {
    const sum = Math.round(((Number(b.paid_amount) || 0) + (Number(b.balance_amount) || 0)) * 100) / 100;
    assert.equal(sum, Number(b.total_amount), `Financial invariant violated for booking ${b.id}: total ${b.total_amount} != paid ${b.paid_amount} + balance ${b.balance_amount}`);
  }
});

test('SCENARIO-B: Cleaning Buffer (POS Extend 13:00-14:00 vs Next Customer 14:15-15:15)', async () => {
  const room = await resetRoom('Room 302 Buffer');

  // Customer 1: 12:00 - 13:00
  const b1 = await dbQuery.run(
    `INSERT INTO bookings (customer_name, contact, total_amount, paid_amount, balance_amount, payment_status)
     VALUES ('Existing Cust', '0811111111', 500, 500, 0, 'paid')`
  );
  const it1 = await dbQuery.run(
    `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal)
     VALUES (?, ?, 1, 500, '2026-10-28T12:00:00', '2026-10-28T13:00:00', 500)`,
    [b1.id, room.id]
  );

  // Next Customer 2: 14:15 - 15:15 (Leaving 1 hour 15 min gap from 13:00)
  const b2 = await dbQuery.run(
    `INSERT INTO bookings (customer_name, contact, total_amount, paid_amount, balance_amount, payment_status)
     VALUES ('Next Cust', '0822222222', 500, 500, 0, 'paid')`
  );
  await dbQuery.run(
    `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal)
     VALUES (?, ?, 1, 500, '2026-10-28T14:15:00', '2026-10-28T15:15:00', 500)`,
    [b2.id, room.id]
  );

  // POS attempts to extend Customer 1 by 60 mins -> new end_time: 14:00
  // Cleaning buffer is 30 mins: 14:00 + 30m = 14:30 > 14:15 (Next customer starts at 14:15!)
  const extendRes = await fetch(`${baseUrl}/api/bookings/${b1.id}/extend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${staffToken}`
    },
    body: JSON.stringify({
      booking_item_id: it1.id,
      current_end_time: '2026-10-28T13:00:00',
      duration_minutes: 60,
      payment_method: 'cash',
      amount_paid: 500
    })
  });

  const extendJson = await extendRes.json();
  console.log(`[Scenario B Result] Status: ${extendRes.status}, Error: ${extendJson.error}`);

  assert.equal(extendRes.status, 409, 'Must reject extension that violates cleaning buffer before next customer');
  assert.ok(extendJson.error.includes('ทำความสะอาด'), 'Error message must mention cleaning buffer');
  assert.ok(extendJson.error.includes('30 นาที'), 'Error message must mention 30 minutes buffer');

  // Verify Customer 1 end_time remains untouched at 13:00
  const refreshedItem = await dbQuery.get('SELECT * FROM booking_items WHERE id = ?', [it1.id]);
  assert.equal(refreshedItem.end_time, '2026-10-28T13:00:00');
});

test('SCENARIO-C: Two Staff Extension (Simultaneous submit on same booking)', async () => {
  const room = await resetRoom('Room 302 TwoStaff');

  // Active booking: 12:00 - 13:00
  const b = await dbQuery.run(
    `INSERT INTO bookings (customer_name, contact, total_amount, paid_amount, balance_amount, payment_status)
     VALUES ('TwoStaff Customer', '0833333333', 500, 500, 0, 'paid')`
  );
  const it = await dbQuery.run(
    `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal)
     VALUES (?, ?, 1, 500, '2026-10-28T12:00:00', '2026-10-28T13:00:00', 500)`,
    [b.id, room.id]
  );

  // Both staff submit +60 min extension expecting current_end_time = 13:00
  const staffAPayload = {
    booking_item_id: it.id,
    current_end_time: '2026-10-28T13:00:00',
    duration_minutes: 60,
    payment_method: 'cash',
    amount_paid: 500,
    notes: 'Staff A extension'
  };

  const staffBPayload = {
    booking_item_id: it.id,
    current_end_time: '2026-10-28T13:00:00',
    duration_minutes: 60,
    payment_method: 'cash',
    amount_paid: 500,
    notes: 'Staff B extension'
  };

  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/bookings/${b.id}/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify(staffAPayload)
    }),
    fetch(`${baseUrl}/api/bookings/${b.id}/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify(staffBPayload)
    })
  ]);

  const jsonA = await resA.json().catch(() => ({}));
  const jsonB = await resB.json().catch(() => ({}));

  console.log(`[Scenario C Result] Staff A Status: ${resA.status}, Staff B Status: ${resB.status}`);

  // Assert: Exactly ONE succeeds (200), and other fails with 409 Conflict
  const oneSucceeded = (resA.status === 200 && resB.status === 409) || (resA.status === 409 && resB.status === 200);
  assert.ok(oneSucceeded, `Exactly one staff extension must succeed, other must be 409 Conflict. Got A: ${resA.status}, B: ${resB.status}`);

  // Verify end_time is extended ONLY once (+60m -> 14:00, NOT 15:00)
  const updatedItem = await dbQuery.get('SELECT * FROM booking_items WHERE id = ?', [it.id]);
  assert.equal(updatedItem.end_time, '2026-10-28T14:00:00', 'End time must be extended exactly 60 minutes to 14:00');

  // Verify total amount increased by exactly 500 (total = 1000)
  const updatedBooking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [b.id]);
  assert.equal(updatedBooking.total_amount, 1000, 'Total amount must only increase by single 500 fee');
  assert.equal(updatedBooking.paid_amount, 1000, 'Paid amount must be 1000');
  assert.equal(updatedBooking.balance_amount, 0, 'Balance amount must be 0');

  // Verify payment transactions count for extension is exactly 1
  const extTxs = await dbQuery.all("SELECT * FROM payment_transactions WHERE booking_id = ? AND transaction_type = 'extension'", [b.id]);
  assert.equal(extTxs.length, 1, 'Exactly one extension transaction must exist');
});

test('SCENARIO-D: Two New Bookings (POS and LINE OA simultaneously booking same room/time)', async () => {
  const room = await resetRoom('Room 302 TwoNew');

  const posBookingPayload = {
    customer_name: 'Walkin Customer',
    contact: '0844444444',
    total_amount: 1000,
    payment_status: 'paid',
    payment_method: 'cash',
    items: [{
      room_id: room.id,
      quantity: 2,
      price: 500,
      start_time: '2026-10-28T15:00:00',
      end_time: '2026-10-28T17:00:00',
      subtotal: 1000
    }]
  };

  const lineBookingPayload = {
    customer_name: 'Online Customer',
    contact: '0855555555',
    room_id: room.id,
    booking_date: '2026-10-28',
    start_time: '15:00',
    end_time: '17:00',
    booking_type: 'hourly',
    guest_count: 3
  };

  const [posRes, lineRes] = await Promise.all([
    fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify(posBookingPayload)
    }),
    fetch(`${baseUrl}/api/public/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(lineBookingPayload)
    })
  ]);

  const posJson = await posRes.json().catch(() => ({}));
  const lineJson = await lineRes.json().catch(() => ({}));

  console.log(`[Scenario D Result] POS New Status: ${posRes.status}, LINE New Status: ${lineRes.status}`);

  const oneSucceeded = ((posRes.status === 200 || posRes.status === 201) && lineRes.status === 409) ||
                        (posRes.status === 409 && (lineRes.status === 200 || lineRes.status === 201));
  assert.ok(oneSucceeded, `Exactly one booking must succeed, other must be 409 Conflict. Got POS: ${posRes.status}, LINE: ${lineRes.status}`);

  // Verify only 1 booking item recorded for 15:00 - 17:00
  const recordedItems = await dbQuery.all(
    `SELECT * FROM booking_items WHERE room_id = ? AND start_time = '2026-10-28T15:00:00'`,
    [room.id]
  );
  assert.equal(recordedItems.length, 1, 'Only one booking item must exist for the room and time slot');
});

test('SCENARIO-E: Stale Availability (Availability check when slot open -> staff extends -> submit rejected)', async () => {
  const room = await resetRoom('Room 302 StaleAvail');

  // Booking from 10:00 - 11:00
  const b = await dbQuery.run(
    `INSERT INTO bookings (customer_name, contact, total_amount, paid_amount, balance_amount, payment_status)
     VALUES ('Stale Base Cust', '0866666666', 500, 500, 0, 'paid')`
  );
  const it = await dbQuery.run(
    `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal)
     VALUES (?, ?, 1, 500, '2026-10-28T10:00:00', '2026-10-28T11:00:00', 500)`,
    [b.id, room.id]
  );

  // 1. Customer checks availability for 11:30 - 12:30 (accounting for buffer: 11:00+30m = 11:30, so 11:30 is available!)
  const availRes = await fetch(`${baseUrl}/api/bookings/check-overlap?room_id=${room.id}&start_time=2026-10-28T11:30:00&end_time=2026-10-28T12:30:00`, {
    headers: { 'Authorization': `Bearer ${staffToken}` }
  });
  const availJson = await availRes.json();
  assert.equal(availJson.overlap, false, 'Time slot 11:30-12:30 was originally open');

  // 2. Staff now extends booking from 11:00 to 12:00 (+60 mins)
  const extRes = await fetch(`${baseUrl}/api/bookings/${b.id}/extend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${staffToken}`
    },
    body: JSON.stringify({
      booking_item_id: it.id,
      current_end_time: '2026-10-28T11:00:00',
      duration_minutes: 60,
      payment_method: 'cash',
      amount_paid: 500
    })
  });
  assert.equal(extRes.status, 200, 'Staff extension must succeed');

  // 3. Customer now submits booking for 11:30 - 12:30 based on stale availability
  const lineSubmitRes = await fetch(`${baseUrl}/api/public/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: 'Stale Customer',
      contact: '0877777777',
      room_id: room.id,
      booking_date: '2026-10-28',
      start_time: '11:30',
      end_time: '12:30',
      booking_type: 'hourly',
      guest_count: 2
    })
  });

  const lineSubmitJson = await lineSubmitRes.json();
  console.log(`[Scenario E Result] Submit Status: ${lineSubmitRes.status}, Error: ${lineSubmitJson.error}`);

  assert.equal(lineSubmitRes.status, 409, 'Must reject stale booking submission with 409 Conflict');
  assert.ok(lineSubmitJson.error.includes('ห้อง') || lineSubmitJson.error.includes('ทำความสะอาด'), 'Must alert user that slot is no longer available');
});

test('STRESS TEST: 5 Consecutive Parallel Execution Cycles (Zero double bookings allowed)', async () => {
  const room = await resetRoom('Room 302 Stress');

  // Run 5 cycles on different days to ensure complete buffer isolation
  for (let cycle = 1; cycle <= 5; cycle++) {
    const day = String(20 + cycle).padStart(2, '0');
    const bookingDate = `2026-11-${day}`;

    const [req1, req2] = await Promise.all([
      fetch(`${baseUrl}/api/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: `Stress A Cycle ${cycle}`,
          contact: `08000000${cycle}1`,
          room_id: room.id,
          booking_date: bookingDate,
          start_time: '14:00',
          end_time: '16:00',
          booking_type: 'hourly',
          guest_count: 2
        })
      }),
      fetch(`${baseUrl}/api/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: `Stress B Cycle ${cycle}`,
          contact: `08000000${cycle}2`,
          room_id: room.id,
          booking_date: bookingDate,
          start_time: '14:00',
          end_time: '16:00',
          booking_type: 'hourly',
          guest_count: 2
        })
      })
    ]);

    const s1 = req1.status;
    const s2 = req2.status;
    const ok1 = (s1 === 200 || s1 === 201);
    const ok2 = (s2 === 200 || s2 === 201);

    assert.ok(
      (ok1 && s2 === 409) || (ok2 && s1 === 409),
      `Cycle ${cycle}: Exactly one request must succeed, got (${s1}, ${s2})`
    );
  }

  // Final check: exactly 5 bookings in database for this room across the 5 test days
  const totalBookings = await dbQuery.all(
    `SELECT bi.* FROM booking_items bi
     JOIN bookings b ON bi.booking_id = b.id
     WHERE bi.room_id = ? AND bi.start_time LIKE '2026-11-%'
       AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed'))`,
    [room.id]
  );
  assert.equal(totalBookings.length, 5, 'Exactly 5 non-conflicting bookings must be created across 5 cycles');
  console.log(`[Stress Test Passed] 5/5 cycles executed with 100% collision detection!`);
});
