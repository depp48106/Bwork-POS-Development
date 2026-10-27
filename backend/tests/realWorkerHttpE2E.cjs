'use strict';

/**
 * realWorkerHttpE2E.cjs
 * Comprehensive Cloudflare Worker Staging HTTP E2E Validation Suite
 *
 * Targets the REAL REMOTE Cloudflare Worker Staging Endpoint:
 * Worker Endpoint: https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev
 * Database: bworkpos_staging_db (UUID: 8511096e-3c57-428f-8b2c-98fdb297f705)
 * Region: APAC (Singapore / SIN)
 *
 * ALL requests are sent as REAL HTTP requests over the network through the
 * Cloudflare Worker Router and API endpoints (NOT just D1 REST API SQL).
 *
 * 11 Required Scenarios:
 * 1. Online Booking vs Online Booking
 * 2. POS Booking vs Online Booking
 * 3. Room Extension vs Online Booking
 * 4. Cleaning Buffer 30 นาที
 * 5. Booking Reschedule Collision
 * 6. Multi-room Partial Failure
 * 7. Booking Shell Cleanup Failure
 * 8. Duplicate Payment Retry
 * 9. Slip Review CAS
 * 10. Authentication and Authorization
 * 11. Support Ticket Routes return 404
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const WORKER_BASE = 'https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev';
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '8cfd6bbc5cd3025b0139f49d05ae2ad4';
const DB_ID = process.env.CLOUDFLARE_D1_STAGING_DB_ID || '8511096e-3c57-428f-8b2c-98fdb297f705';

// Resolve Cloudflare credentials securely without hardcoded paths
function resolveCloudflareToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN.trim();
  if (process.env.CF_TOKEN) return process.env.CF_TOKEN.trim();
  const defaultWranglerConfig = path.join(os.homedir(), '.wrangler', 'config', 'default.toml');
  if (fs.existsSync(defaultWranglerConfig)) {
    const tomlContent = fs.readFileSync(defaultWranglerConfig, 'utf8');
    const match = tomlContent.match(/oauth_token\s*=\s*"([^"]+)"/);
    if (match && match[1]) return match[1].trim();
  }
  throw new Error('Cloudflare API Token not found. Set CLOUDFLARE_API_TOKEN or CF_TOKEN env var.');
}

const CF_TOKEN = resolveCloudflareToken();

// Direct D1 REST client used exclusively for test data setup, cleanup, and DB assertions
function createD1Inspector() {
  const queryUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;

  async function queryD1(sql, params = []) {
    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql, params })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      const msg = json.errors?.[0]?.message || `D1 HTTP Error ${res.status}`;
      const err = new Error(msg);
      err.d1Errors = json.errors;
      throw err;
    }
    return json.result;
  }

  return {
    async query(sql, params = []) {
      return await queryD1(sql, params);
    }
  };
}

test('Real Cloudflare Worker HTTP E2E Test Suite', async (t) => {
  const d1 = createD1Inspector();
  const TEST_DATE = '2026-11-20'; // Dedicated future date to isolate test runs
  const TEST_ROOM_ID = 5; // Mercury (302)
  const ALT_ROOM_ID = 4;  // Mars (301)

  console.log(`[HTTP E2E] Initializing against Remote Worker: ${WORKER_BASE}`);

  // Helper: clean test records
  async function cleanRemoteTestRecords() {
    await d1.query(`
      DELETE FROM payment_transactions WHERE booking_id IN (
        SELECT b.id FROM bookings b
        JOIN booking_items bi ON b.id = bi.booking_id
        WHERE bi.start_time LIKE '${TEST_DATE}%'
      )
    `);
    await d1.query(`
      DELETE FROM slip_verifications WHERE booking_id IN (
        SELECT id FROM bookings WHERE customer_name LIKE 'E2E-Worker-%'
      )
    `);
    await d1.query(`
      DELETE FROM booking_history WHERE booking_id IN (
        SELECT b.id FROM bookings b
        JOIN booking_items bi ON b.id = bi.booking_id
        WHERE bi.start_time LIKE '${TEST_DATE}%'
      )
    `);
    await d1.query(`DELETE FROM booking_items WHERE start_time LIKE '${TEST_DATE}%'`);
    await d1.query(`
      DELETE FROM bookings WHERE receipt_number LIKE 'BK-${TEST_DATE.replace(/-/g, '')}%'
         OR customer_name LIKE 'E2E-Worker-%'
    `);
  }

  // Pre-test cleanup
  await cleanRemoteTestRecords();

  // Obtain staff token via real HTTP login endpoint
  let staffToken = null;
  const loginRes = await fetch(`${WORKER_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin_staging', password: 'admin' })
  });
  assert.equal(loginRes.status, 200, 'HTTP Login to Staging Worker must succeed');
  const loginJson = await loginRes.json();
  assert.ok(loginJson.token, 'Must return JWT token');
  staffToken = loginJson.token;
  console.log('  [PASS] Staging Worker Staff Login Successful. Staff Token acquired.');

  // ----------------------------------------------------
  // Scenario 1: Online Booking vs Online Booking (Simultaneous Race)
  // ----------------------------------------------------
  await t.test('Scenario 1: Online vs Online HTTP Concurrency Race', async () => {
    await cleanRemoteTestRecords();

    const payloadA = {
      customer_name: 'E2E-Worker-Online-A',
      contact: '0811111111',
      room_id: TEST_ROOM_ID,
      booking_date: TEST_DATE,
      start_time: '10:00',
      end_time: '11:00',
      booking_type: 'hourly',
      guest_count: 2
    };

    const payloadB = {
      customer_name: 'E2E-Worker-Online-B',
      contact: '0822222222',
      room_id: TEST_ROOM_ID,
      booking_date: TEST_DATE,
      start_time: '10:00',
      end_time: '11:00',
      booking_type: 'hourly',
      guest_count: 2
    };

    const [resA, resB] = await Promise.all([
      fetch(`${WORKER_BASE}/api/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadA)
      }),
      fetch(`${WORKER_BASE}/api/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadB)
      })
    ]);

    const isOneSuccessOneConflict =
      (resA.status === 201 && resB.status === 409) ||
      (resA.status === 409 && resB.status === 201);
    assert.ok(isOneSuccessOneConflict, `Expected exactly one 201 and one 409. Got A=${resA.status}, B=${resB.status}`);

    // D1 verification: exactly 1 booking item in DB
    const checkDb = await d1.query(
      `SELECT count(*) as count FROM booking_items WHERE room_id = ? AND start_time = ?`,
      [TEST_ROOM_ID, `${TEST_DATE}T10:00:00`]
    );
    assert.equal(checkDb[0].results[0].count, 1, 'Only 1 booking item must exist in D1 Staging');
    console.log('  [PASS Real Worker HTTP] Scenario 1: Online vs Online race resolved with exactly 1 winner and 0 double bookings');
  });

  // ----------------------------------------------------
  // Scenario 2: POS Booking vs Online Booking (Cross-Channel Race)
  // ----------------------------------------------------
  await t.test('Scenario 2: POS Booking vs Online Booking HTTP Cross-Channel Race', async () => {
    await cleanRemoteTestRecords();

    const posPayload = {
      customer_name: 'E2E-Worker-POS-Walkin',
      contact: '0833333333',
      customer_type: 'walkin',
      payment_method: 'cash',
      payment_status: 'paid',
      total_amount: 350,
      paid_amount: 350,
      balance_amount: 0,
      items: [
        {
          room_id: TEST_ROOM_ID,
          start_time: `${TEST_DATE}T12:00:00`,
          end_time: `${TEST_DATE}T13:00:00`,
          price: 350,
          quantity: 1,
          subtotal: 350,
          booking_type: 'hourly',
          guest_count: 2
        }
      ]
    };

    const onlinePayload = {
      customer_name: 'E2E-Worker-Online-Competitor',
      contact: '0844444444',
      room_id: TEST_ROOM_ID,
      booking_date: TEST_DATE,
      start_time: '12:00',
      end_time: '13:00',
      booking_type: 'hourly',
      guest_count: 2
    };

    const [resPos, resOnline] = await Promise.all([
      fetch(`${WORKER_BASE}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${staffToken}`
        },
        body: JSON.stringify(posPayload)
      }),
      fetch(`${WORKER_BASE}/api/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(onlinePayload)
      })
    ]);

    const isOneSuccessOneConflict =
      ((resPos.status === 200 || resPos.status === 201) && resOnline.status === 409) ||
      (resPos.status === 409 && resOnline.status === 201);
    assert.ok(isOneSuccessOneConflict, `Expected one success and one 409. Got POS=${resPos.status}, Online=${resOnline.status}`);

    const checkDb = await d1.query(
      `SELECT count(*) as count FROM booking_items WHERE room_id = ? AND start_time = ?`,
      [TEST_ROOM_ID, `${TEST_DATE}T12:00:00`]
    );
    assert.equal(checkDb[0].results[0].count, 1, 'Only 1 booking item in D1 staging');
    console.log('  [PASS Real Worker HTTP] Scenario 2: Cross-Channel POS vs Online race resolved with 0 double bookings');
  });

  // ----------------------------------------------------
  // Scenario 3: Room Extension vs Online Booking
  // ----------------------------------------------------
  await t.test('Scenario 3: Room Extension vs Online Booking HTTP Race', async () => {
    await cleanRemoteTestRecords();

    // Create seed booking via POS: 13:00 - 14:00
    const seedRes = await fetch(`${WORKER_BASE}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Ext-Base',
        contact: '0855555555',
        customer_type: 'walkin',
        payment_method: 'cash',
        payment_status: 'paid',
        total_amount: 350,
        paid_amount: 350,
        balance_amount: 0,
        items: [
          {
            room_id: TEST_ROOM_ID,
            start_time: `${TEST_DATE}T13:00:00`,
            end_time: `${TEST_DATE}T14:00:00`,
            price: 350,
            quantity: 1,
            subtotal: 350,
            booking_type: 'hourly',
            guest_count: 2
          }
        ]
      })
    });
    assert.ok(seedRes.ok, 'Seed booking creation must succeed');
    const seedJson = await seedRes.json();
    const bookingId = seedJson.booking_id;

    // Get booking item ID from DB
    const itemQuery = await d1.query(`SELECT id FROM booking_items WHERE booking_id = ?`, [bookingId]);
    const itemId = itemQuery[0].results[0].id;

    // Concurrently:
    // A) POS extends Room 5 by 60 mins (to 15:00)
    // B) Online customer attempts to book Room 5: 14:30 - 15:30
    const [resExtend, resOnline] = await Promise.all([
      fetch(`${WORKER_BASE}/api/bookings/${bookingId}/extend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${staffToken}`
        },
        body: JSON.stringify({
          booking_item_id: itemId,
          duration_minutes: 60,
          amount_paid: 350,
          method: 'cash',
          current_end_time: `${TEST_DATE}T14:00:00`
        })
      }),
      fetch(`${WORKER_BASE}/api/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: 'E2E-Worker-Ext-Competitor',
          contact: '0866666666',
          room_id: TEST_ROOM_ID,
          booking_date: TEST_DATE,
          start_time: '14:30',
          end_time: '15:30',
          booking_type: 'hourly',
          guest_count: 2
        })
      })
    ]);

    const isOneSuccessOneConflict =
      (resExtend.status === 200 && resOnline.status === 409) ||
      (resExtend.status === 409 && resOnline.status === 201);
    assert.ok(isOneSuccessOneConflict, `Expected one success and one 409. Got Extend=${resExtend.status}, Online=${resOnline.status}`);
    console.log('  [PASS Real Worker HTTP] Scenario 3: Room Extension vs Online race resolved cleanly');
  });

  // ----------------------------------------------------
  // Scenario 4: Cleaning Buffer 30 นาที
  // ----------------------------------------------------
  await t.test('Scenario 4: Cleaning Buffer 30-min Boundary Collision', async () => {
    await cleanRemoteTestRecords();

    // Base booking: 10:00 - 11:00 (Buffer is 30 mins -> holds until 11:30)
    const seedRes = await fetch(`${WORKER_BASE}/api/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Buffer-Base',
        contact: '0871111111',
        room_id: TEST_ROOM_ID,
        booking_date: TEST_DATE,
        start_time: '10:00',
        end_time: '11:00',
        booking_type: 'hourly',
        guest_count: 2
      })
    });
    assert.equal(seedRes.status, 201);

    // Attempt Online booking: 11:15 - 12:00 (within 30-min cleaning buffer) -> MUST BE REJECTED 409
    const resWithinBuffer = await fetch(`${WORKER_BASE}/api/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Buffer-Violator',
        contact: '0872222222',
        room_id: TEST_ROOM_ID,
        booking_date: TEST_DATE,
        start_time: '11:15',
        end_time: '12:00',
        booking_type: 'hourly',
        guest_count: 2
      })
    });
    assert.equal(resWithinBuffer.status, 409, 'Request within 30-min cleaning buffer must be rejected with 409 Conflict');

    // Attempt Online booking: 11:30 - 12:30 (outside 30-min cleaning buffer) -> MUST SUCCEED 201
    const resOutsideBuffer = await fetch(`${WORKER_BASE}/api/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Buffer-Valid',
        contact: '0873333333',
        room_id: TEST_ROOM_ID,
        booking_date: TEST_DATE,
        start_time: '11:30',
        end_time: '12:30',
        booking_type: 'hourly',
        guest_count: 2
      })
    });
    assert.equal(resOutsideBuffer.status, 201, 'Request outside 30-min cleaning buffer must succeed with 201');
    console.log('  [PASS Real Worker HTTP] Scenario 4: 30-min cleaning buffer strictly enforced on Worker API');
  });

  // ----------------------------------------------------
  // Scenario 5: Booking Reschedule Collision
  // ----------------------------------------------------
  await t.test('Scenario 5: Booking Reschedule Collision', async () => {
    await cleanRemoteTestRecords();

    // Create Booking A in Room 5: 09:00 - 10:00
    const resA = await fetch(`${WORKER_BASE}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Resched-A',
        contact: '0881111111',
        customer_type: 'walkin',
        payment_method: 'cash',
        payment_status: 'paid',
        total_amount: 350,
        paid_amount: 350,
        balance_amount: 0,
        items: [{
          room_id: TEST_ROOM_ID,
          start_time: `${TEST_DATE}T09:00:00`,
          end_time: `${TEST_DATE}T10:00:00`,
          price: 350,
          quantity: 1,
          subtotal: 350,
          booking_type: 'hourly',
          guest_count: 2
        }]
      })
    });
    assert.equal(resA.status, 201);

    // Create Booking B in Room 4: 09:00 - 10:00
    const resB = await fetch(`${WORKER_BASE}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Resched-B',
        contact: '0882222222',
        customer_type: 'walkin',
        payment_method: 'cash',
        payment_status: 'paid',
        total_amount: 350,
        paid_amount: 350,
        balance_amount: 0,
        items: [{
          room_id: ALT_ROOM_ID,
          start_time: `${TEST_DATE}T09:00:00`,
          end_time: `${TEST_DATE}T10:00:00`,
          price: 350,
          quantity: 1,
          subtotal: 350,
          booking_type: 'hourly',
          guest_count: 2
        }]
      })
    });
    assert.equal(resB.status, 201);
    const idB = (await resB.json()).booking_id;
    const itemQueryB = await d1.query(`SELECT id FROM booking_items WHERE booking_id = ?`, [idB]);
    const itemBId = itemQueryB[0].results[0].id;

    // Attempt to reschedule Booking B into Room 5: 09:30 - 10:30 (collides with Booking A)
    const resResched = await fetch(`${WORKER_BASE}/api/bookings/${idB}/reschedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        booking_item_id: itemBId,
        room_id: TEST_ROOM_ID,
        date: TEST_DATE,
        start_time: '09:30',
        end_time: '10:30',
        booking_type: 'hourly'
      })
    });
    // Reschedule collision returns error status (400 or 409) with overlap code
    assert.ok(resResched.status === 400 || resResched.status === 409, 'Reschedule collision must return 400/409');
    const reschedJson = await resResched.json();
    assert.equal(reschedJson.code, 'ERR_ROOM_OVERLAP', 'Must return ERR_ROOM_OVERLAP code');

    // Confirm Booking B item in Room 4 was untouched
    const checkB = await d1.query(`SELECT room_id, start_time FROM booking_items WHERE id = ?`, [itemBId]);
    assert.equal(checkB[0].results[0].room_id, ALT_ROOM_ID);
    console.log('  [PASS Real Worker HTTP] Scenario 5: Reschedule collision trapped; original booking untouched');
  });

  // ----------------------------------------------------
  // Scenario 6: Multi-room Partial Failure
  // ----------------------------------------------------
  await t.test('Scenario 6: Multi-room Partial Failure Atomic Rollback', async () => {
    await cleanRemoteTestRecords();

    // Pre-book Room 5 during regular hours: 16:00 - 17:00
    const seedRes = await fetch(`${WORKER_BASE}/api/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Prebooked-Room5',
        contact: '0891111111',
        room_id: TEST_ROOM_ID,
        booking_date: TEST_DATE,
        start_time: '16:00',
        end_time: '17:00',
        booking_type: 'hourly',
        guest_count: 2
      })
    });
    assert.equal(seedRes.status, 201);

    // Attempt POS multi-room booking: Room 4 (free) AND Room 5 (occupied)
    const multiRes = await fetch(`${WORKER_BASE}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Multi-Attempt',
        contact: '0892222222',
        customer_type: 'walkin',
        payment_method: 'cash',
        payment_status: 'paid',
        total_amount: 700,
        paid_amount: 700,
        balance_amount: 0,
        items: [
          {
            room_id: ALT_ROOM_ID, // Free
            start_time: `${TEST_DATE}T16:00:00`,
            end_time: `${TEST_DATE}T17:00:00`,
            price: 350,
            quantity: 1,
            subtotal: 350,
            booking_type: 'hourly',
            guest_count: 2
          },
          {
            room_id: TEST_ROOM_ID, // Occupied -> Conflict!
            start_time: `${TEST_DATE}T16:00:00`,
            end_time: `${TEST_DATE}T17:00:00`,
            price: 350,
            quantity: 1,
            subtotal: 350,
            booking_type: 'hourly',
            guest_count: 2
          }
        ]
      })
    });
    assert.equal(multiRes.status, 409, 'Multi-room request with partial conflict must be rejected with 409');

    // Confirm Room 4 has NO booking items created (atomic all-or-nothing rollback)
    const checkAlt = await d1.query(
      `SELECT count(*) as count FROM booking_items WHERE room_id = ? AND start_time = ?`,
      [ALT_ROOM_ID, `${TEST_DATE}T16:00:00`]
    );
    assert.equal(checkAlt[0].results[0].count, 0, 'No partial booking items allowed in Room 4');
    console.log('  [PASS Real Worker HTTP] Scenario 6: Multi-room partial failure cleanly rolled back (all-or-nothing)');
  });

  // ----------------------------------------------------
  // Scenario 7: Booking Shell Cleanup Failure
  // ----------------------------------------------------
  await t.test('Scenario 7: Zero Orphan Booking Shells After Conflict', async () => {
    // Check D1 for any orphan booking parent records without booking_items
    const orphanCheck = await d1.query(`
      SELECT b.id, b.customer_name FROM bookings b
      LEFT JOIN booking_items bi ON b.id = bi.booking_id
      WHERE bi.id IS NULL AND b.customer_name LIKE 'E2E-Worker-%'
    `);
    const orphans = orphanCheck[0].results;
    assert.equal(orphans.length, 0, `Zero orphan booking shells must exist. Found: ${JSON.stringify(orphans)}`);
    console.log('  [PASS Real Worker HTTP] Scenario 7: Zero orphan booking shells verified in D1 Staging');
  });

  // ----------------------------------------------------
  // Scenario 8: Duplicate Payment Retry
  // ----------------------------------------------------
  await t.test('Scenario 8: Duplicate Payment Retry & Financial Ledger Safety', async () => {
    await cleanRemoteTestRecords();

    // Create deposit booking: Total 700, Paid 350, Balance 350
    const resCreate = await fetch(`${WORKER_BASE}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Ledger-Cust',
        contact: '0893333333',
        customer_type: 'walkin',
        payment_method: 'cash',
        payment_mode: 'deposit',
        deposit_amount: 350,
        items: [{
          room_id: TEST_ROOM_ID,
          start_time: `${TEST_DATE}T13:00:00`,
          end_time: `${TEST_DATE}T15:00:00`,
          price: 350,
          quantity: 2,
          subtotal: 700,
          booking_type: 'hourly',
          guest_count: 2
        }]
      })
    });
    assert.equal(resCreate.status, 201);
    const bookingId = (await resCreate.json()).booking_id;

    // Staff pays balance: 350
    const resBal = await fetch(`${WORKER_BASE}/api/bookings/${bookingId}/pay-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        amount: 350,
        payment_method: 'transfer'
      })
    });
    assert.equal(resBal.status, 200, 'Balance payment must succeed');

    // Simulate Replay / Retry on already-paid booking
    const resRetry = await fetch(`${WORKER_BASE}/api/bookings/${bookingId}/pay-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        amount: 350,
        payment_method: 'transfer'
      })
    });
    assert.equal(resRetry.status, 400, 'Replay payment retry must be rejected with 400');

    // Invariant check on D1: total_amount = paid_amount + balance_amount
    const finCheck = await d1.query(
      `SELECT total_amount, paid_amount, balance_amount, payment_status FROM bookings WHERE id = ?`,
      [bookingId]
    );
    const fin = finCheck[0].results[0];
    assert.equal(fin.total_amount, 700);
    assert.equal(fin.paid_amount, 700);
    assert.equal(fin.balance_amount, 0);
    assert.equal(fin.payment_status, 'paid');

    // Invariant check on payment_transactions: exactly 2 transactions (deposit + balance)
    const txCheck = await d1.query(
      `SELECT count(*) as count FROM payment_transactions WHERE booking_id = ?`,
      [bookingId]
    );
    assert.equal(txCheck[0].results[0].count, 2, 'Exactly 2 payment transactions recorded in D1');
    console.log('  [PASS Real Worker HTTP] Scenario 8: Duplicate payment replay safely rejected; ledger invariant verified');
  });

  // ----------------------------------------------------
  // Scenario 9: Slip Review CAS
  // ----------------------------------------------------
  await t.test('Scenario 9: Slip Review CAS Concurrency Guard', async () => {
    await cleanRemoteTestRecords();

    // Create an online booking in 'reviewing' status with an evidence slip
    const seedRes = await fetch(`${WORKER_BASE}/api/public/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'E2E-Worker-Slip-Cust',
        contact: '0894444444',
        room_id: TEST_ROOM_ID,
        booking_date: TEST_DATE,
        start_time: '08:00',
        end_time: '09:00',
        booking_type: 'hourly',
        guest_count: 2
      })
    });
    assert.equal(seedRes.status, 201);
    const bookingId = (await seedRes.json()).booking_id;

    // Seed reviewing status and a slip record in D1 with separate queries
    await d1.query(
      `UPDATE bookings SET payment_status = 'reviewing', slip_verify_status = 'pending_manual', slip_image_url = 'slips/test_slip_v1.jpg' WHERE id = ?`,
      [bookingId]
    );
    await d1.query(
      `INSERT INTO slip_verifications (booking_id, slip_image_url, verification_status, created_at) VALUES (?, 'slips/test_slip_v1.jpg', 'pending_manual', '${TEST_DATE}T08:00:00')`,
      [bookingId]
    );

    // Query the evidence ID
    const svCheck = await d1.query(`SELECT id FROM slip_verifications WHERE booking_id = ? ORDER BY id DESC LIMIT 1`, [bookingId]);
    const evidenceId = svCheck[0].results[0].id;

    // Simulate CAS Conflict: Staff tries to reject using outdated evidence ID
    const resStaleReject = await fetch(`${WORKER_BASE}/api/bookings/${bookingId}/reject-slip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        reason_code: 'AMOUNT_MISMATCH',
        evidence_id: evidenceId + 999, // Stale / mismatched evidence ID
        expected_slip_url: 'slips/test_slip_v1.jpg'
      })
    });
    assert.equal(resStaleReject.status, 409, 'Stale slip review must be rejected with 409 Conflict');
    const rejectJson = await resStaleReject.json();
    assert.equal(rejectJson.code, 'SLIP_VERSION_CONFLICT');

    // Valid Reject Slip with correct evidence ID
    const resValidReject = await fetch(`${WORKER_BASE}/api/bookings/${bookingId}/reject-slip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        reason_code: 'AMOUNT_MISMATCH',
        evidence_id: evidenceId,
        expected_slip_url: 'slips/test_slip_v1.jpg'
      })
    });
    assert.equal(resValidReject.status, 200, 'Valid reject slip must succeed');

    // Second reject attempt after status has already changed -> MUST BE 409
    const resSecondReject = await fetch(`${WORKER_BASE}/api/bookings/${bookingId}/reject-slip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        reason_code: 'AMOUNT_MISMATCH',
        evidence_id: evidenceId,
        expected_slip_url: 'slips/test_slip_v1.jpg'
      })
    });
    assert.equal(resSecondReject.status, 409, 'Subsequent reject on non-reviewing status must be 409');
    console.log('  [PASS Real Worker HTTP] Scenario 9: Slip Review CAS version check and state transition verified');
  });

  // ----------------------------------------------------
  // Scenario 10: Authentication and Authorization
  // ----------------------------------------------------
  await t.test('Scenario 10: Authentication and Authorization Enforcement', async () => {
    // 1. Unauthenticated call to protected POS route -> 401
    const resNoAuth = await fetch(`${WORKER_BASE}/api/bookings`);
    assert.equal(resNoAuth.status, 401, 'Request without token must be 401 Unauthorized');

    // 2. Invalid Bearer token -> 401
    const resBadAuth = await fetch(`${WORKER_BASE}/api/bookings`, {
      headers: { 'Authorization': 'Bearer invalid_bogus_token_xyz' }
    });
    assert.equal(resBadAuth.status, 401, 'Request with bogus token must be 401 Unauthorized');

    // 3. Authenticated call with valid token -> 200
    const resGoodAuth = await fetch(`${WORKER_BASE}/api/bookings?limit=5`, {
      headers: { 'Authorization': `Bearer ${staffToken}` }
    });
    assert.equal(resGoodAuth.status, 200, 'Request with valid token must be 200 OK');
    console.log('  [PASS Real Worker HTTP] Scenario 10: Authentication & authorization barriers strictly enforced');
  });

  // ----------------------------------------------------
  // Scenario 11: Support Ticket Routes return 404
  // ----------------------------------------------------
  await t.test('Scenario 11: Support Ticket Routes Hard-Gated Return 404', async () => {
    const endpoints = [
      { method: 'POST', path: '/api/public/support/tickets', body: { subject: 'test' } },
      { method: 'GET',  path: '/api/public/support/tickets' },
      { method: 'GET',  path: '/api/pos/support/tickets' },
      { method: 'POST', path: '/api/pos/support/tickets/999/notes', body: { note: 'test' } }
    ];

    for (const ep of endpoints) {
      const opts = {
        method: ep.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${staffToken}`
        }
      };
      if (ep.body) opts.body = JSON.stringify(ep.body);

      const res = await fetch(`${WORKER_BASE}${ep.path}`, opts);
      assert.equal(res.status, 404, `Support endpoint ${ep.method} ${ep.path} must return 404 Not Found. Got ${res.status}`);
    }
    console.log('  [PASS Real Worker HTTP] Scenario 11: All Support Ticket endpoints return 404 Not Found');
  });

  // Final cleanup
  await cleanRemoteTestRecords();
  console.log('[HTTP E2E] All synthetic test records cleaned up from D1 Staging.');
});
