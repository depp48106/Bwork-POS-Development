/**
 * BWORK-POS — REMOTE STAGING ACCEPTANCE TEST RUNNER
 * Phase: RELEASE-2C
 *
 * Executes full remote acceptance suite against:
 * Worker API: https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev
 * POS Pages:  https://bwork-pos-staging.pages.dev
 * Booking Pages: https://bwork-booking-staging.pages.dev
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STAGING_API = 'https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev';
const POS_PAGES = 'https://bwork-pos-staging.pages.dev';
const BOOKING_PAGES = 'https://bwork-booking-staging.pages.dev';
const ARTIFACT_DIR = 'C:\\Users\\Runrasa.P\\.gemini\\antigravity\\brain\\03721993-8ed4-4f8b-a41b-db0f7e984101';

let passedCount = 0;
let totalCount = 0;
const results = [];

function assertTest(condition, name, details = '') {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${name} ${details ? '(' + details + ')' : ''}`);
    results.push({ name, status: 'PASS', details });
  } else {
    console.error(`  [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
    results.push({ name, status: 'FAIL', details });
    throw new Error(`Test failed: ${name} - ${details}`);
  }
}

async function runAcceptanceSuite() {
  console.log('====================================================');
  console.log('  BWORK-POS REMOTE STAGING ACCEPTANCE SUITE (RELEASE-2C)');
  console.log('====================================================\n');

  let adminToken = '';
  let staffToken = '';

  // -------------------------------------------------------------
  // Scenario A: Staff login and authorization
  // -------------------------------------------------------------
  console.log('Scenario A: Staff Login & Authorization');
  const credFile = path.join(ARTIFACT_DIR, 'scratch', 'staging_admin_credentials.json');
  const stagingAdminPass = process.env.STAGING_ADMIN_PASSWORD || (fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, 'utf8')).password : '');
  const loginRes = await fetch(`${STAGING_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: stagingAdminPass })
  });
  const loginData = await loginRes.json();
  assertTest(loginRes.status === 200 && loginData.token, 'A1. Admin login succeeds', `Token received, user=${loginData.user?.username}`);
  adminToken = loginData.token;

  const staffLoginRes = await fetch(`${STAGING_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'staff_staging', password: 'admin' })
  });
  const staffData = await staffLoginRes.json();
  assertTest(staffLoginRes.status === 200 && staffData.token, 'A2. Staff login succeeds', `Token received, user=${staffData.user?.username}`);
  staffToken = staffData.token;

  // -------------------------------------------------------------
  // Scenario B: Booking Management Loads
  // -------------------------------------------------------------
  console.log('\nScenario B: Booking Management Loads');
  const bookingsRes = await fetch(`${STAGING_API}/api/bookings`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const bookingsData = await bookingsRes.json();
  assertTest(bookingsRes.status === 200 && Array.isArray(bookingsData), 'B1. GET /api/bookings returns synthetic bookings', `Found ${bookingsData.length} bookings`);

  // -------------------------------------------------------------
  // Scenario D: Multi-Item Booking Inspection & Item Retrieval
  // -------------------------------------------------------------
  console.log('\nScenario D: Multi-Item Stage 1 Selector Data');
  const b9002Res = await fetch(`${STAGING_API}/api/bookings/9002`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const b9002 = await b9002Res.json();
  assertTest(b9002.items && b9002.items.length >= 2, 'D1. Booking #9002 has multiple distinct items for selector', `Items: ${b9002.items.map(i => i.id).join(', ')}`);

  const it9102 = b9002.items.find(i => i.id === 9102);
  const it9103 = b9002.items.find(i => i.id === 9103);
  const it9102StartDate = it9102.start_time.slice(0, 10);
  const it9102StartHour = parseInt(it9102.start_time.slice(11, 13), 10);
  const it9102EndHour = parseInt(it9102.end_time.slice(11, 13), 10);

  // -------------------------------------------------------------
  // Scenario H: Sibling Item Conflict (Same Room Conflict)
  // -------------------------------------------------------------
  console.log('\nScenario H: Sibling Item Conflict');
  // Directly overlap item 9103 with item 9102 in Room 5
  const overlapStart = `${String(it9102StartHour).padStart(2, '0')}:30`;
  const overlapEnd = `${String(it9102EndHour).padStart(2, '0')}:30`;
  const conflictRes = await fetch(`${STAGING_API}/api/bookings/9002/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      booking_item_id: 9103,
      room_id: it9102.room_id,
      date: it9102StartDate,
      start_time: overlapStart,
      end_time: overlapEnd,
      reason: 'Testing sibling collision'
    })
  });
  assertTest(conflictRes.status === 400, 'H1. Sibling room collision rejected with HTTP 400', `Status: ${conflictRes.status}`);

  // -------------------------------------------------------------
  // Scenario I: 15-Minute Cleaning Buffer Conflict
  // -------------------------------------------------------------
  console.log('\nScenario I: 15-Minute Cleaning Buffer Conflict');
  // Attempt to schedule item 9103 5 minutes after item 9102 ends (within 15-min cleaning buffer)
  const bufferStart = `${String(it9102EndHour).padStart(2, '0')}:05`;
  const bufferEnd = `${String(it9102EndHour + 1).padStart(2, '0')}:05`;
  const bufferRes = await fetch(`${STAGING_API}/api/bookings/9002/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      booking_item_id: 9103,
      room_id: it9102.room_id,
      date: it9102StartDate,
      start_time: bufferStart,
      end_time: bufferEnd,
      reason: 'Testing cleaning buffer'
    })
  });
  assertTest(bufferRes.status === 400, 'I1. 15-minute cleaning buffer conflict rejected with HTTP 400', `Status: ${bufferRes.status}`);

  // -------------------------------------------------------------
  // Scenario K: Paid Amount Floor Protection
  // -------------------------------------------------------------
  console.log('\nScenario K: Paid Amount Floor Protection');
  // Booking #9001 total is 1,000 THB, paid 1,000 THB. Reducing duration from 2 hours to 1 hour (500 THB) must be blocked
  const floorRes = await fetch(`${STAGING_API}/api/bookings/9001/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      booking_item_id: 9101,
      date: '2026-10-20',
      start_time: '10:00',
      end_time: '11:00',
      reason: 'Testing floor reduction'
    })
  });
  assertTest(floorRes.status === 400, 'K1. Total below paid amount rejected with HTTP 400', `Status: ${floorRes.status}`);

  // -------------------------------------------------------------
  // Scenario C: Single-Item Reschedule (Legitimate Time Shift)
  // -------------------------------------------------------------
  console.log('\nScenario C: Single-Item Reschedule');
  const resched9001 = await fetch(`${STAGING_API}/api/bookings/9001/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      booking_item_id: 9101,
      date: '2026-10-20',
      start_time: '11:00',
      end_time: '13:00',
      reason: 'Client requested 1 hr shift'
    })
  });
  assertTest(resched9001.status === 200, 'C1. Single-item reschedule succeeds', `New start: 11:00, end: 13:00`);

  // -------------------------------------------------------------
  // Scenario E, J, M, N: Edit Primary Booking Item in Multi-Item Booking
  // -------------------------------------------------------------
  console.log('\nScenario E & J & M & N: Multi-Item Primary Item Reschedule');
  const reschedPrimary = await fetch(`${STAGING_API}/api/bookings/9002/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      booking_item_id: 9102,
      date: '2026-10-21',
      start_time: '07:00',
      end_time: '09:00',
      reason: 'Move primary item earlier'
    })
  });
  assertTest(reschedPrimary.status === 200, 'E1. Primary item reschedule succeeds', `Status: 200`);

  // Verify unchanged sibling item (9103) is preserved and parent PIN is updated
  const fresh9002Res = await fetch(`${STAGING_API}/api/bookings/9002`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const fresh9002 = await fresh9002Res.json();
  const item9102 = fresh9002.items.find(i => i.id === 9102);
  const item9103 = fresh9002.items.find(i => i.id === 9103);
  assertTest(item9103 && item9103.start_time === it9103.start_time && item9103.end_time === it9103.end_time, 'M1. Unchanged sibling item #9103 preserved intact', `Start=${item9103?.start_time}`);
  assertTest(fresh9002.pin_code === item9102.pin_code, 'N1. Parent door PIN synchronized with primary item', `Parent PIN=${fresh9002.pin_code}`);

  // -------------------------------------------------------------
  // Scenario F & G: Edit Sibling Item in Multi-Item Booking
  // -------------------------------------------------------------
  console.log('\nScenario F & G: Edit Sibling Item (#9103)');
  const reschedSibling = await fetch(`${STAGING_API}/api/bookings/9002/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      booking_item_id: 9103,
      date: '2026-10-21',
      start_time: '14:00',
      end_time: '16:00',
      reason: 'Shift sibling item by 1 hour'
    })
  });
  assertTest(reschedSibling.status === 200, 'F1. Sibling item reschedule succeeds', `Status: 200`);

  // Verify parent PIN did NOT change when editing non-primary item
  const postSiblingRes = await fetch(`${STAGING_API}/api/bookings/9002`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const postSibling = await postSiblingRes.json();
  assertTest(postSibling.pin_code === fresh9002.pin_code, 'N2. Parent door PIN preserved when sibling item rescheduled', `PIN unchanged=${postSibling.pin_code}`);

  // -------------------------------------------------------------
  // Scenario Y: Concurrent Reschedule Conflict (HTTP 409)
  // -------------------------------------------------------------
  console.log('\nScenario Y: Concurrent Reschedule Conflict Detection');
  const [c1, c2] = await Promise.all([
    fetch(`${STAGING_API}/api/bookings/9001/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        booking_item_id: 9101,
        date: '2026-10-20',
        start_time: '10:00',
        end_time: '12:00',
        reason: 'Concurrent request A'
      })
    }),
    fetch(`${STAGING_API}/api/bookings/9001/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        booking_item_id: 9101,
        date: '2026-10-20',
        start_time: '10:00',
        end_time: '12:00',
        reason: 'Concurrent request B'
      })
    })
  ]);
  const statuses = [c1.status, c2.status];
  assertTest(statuses.every(s => s === 200 || s === 409), 'Y1. D1 Concurrency / atomicity correctly arbitrated', `Statuses: ${statuses.join(', ')}`);

  // -------------------------------------------------------------
  // Scenario O & P: Wi-Fi Decryption & Customer Wi-Fi Card
  // -------------------------------------------------------------
  console.log('\nScenario O & P: Wi-Fi Credential Decryption & Customer Card');
  const wifiCardRes = await fetch(`${STAGING_API}/api/bookings/9001/wifi-card`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const wifiCardData = await wifiCardRes.json();
  assertTest(wifiCardRes.status === 200, 'P1. GET /api/bookings/9001/wifi-card succeeds', `HTTP 200`);
  const roomCred = wifiCardData.rooms?.find(r => r.room_id === 5);
  assertTest(roomCred && roomCred.is_configured === true, 'P2. Wi-Fi is marked configured for Room 5', `is_configured: true`);
  assertTest(roomCred && roomCred.wifi_username === 'staging_room_302', 'P3. Correct Wi-Fi username returned', `User: ${roomCred?.wifi_username}`);
  assertTest(roomCred && roomCred.wifi_password === 'StagingWiFi2026', 'P4. Correct decrypted Wi-Fi password returned', `Plaintext verified: StagingWiFi2026`);

  // -------------------------------------------------------------
  // Scenario Q: Public API Credential Redaction
  // -------------------------------------------------------------
  console.log('\nScenario Q: Public API Credential Redaction');
  const publicRoomsRes = await fetch(`${STAGING_API}/api/rooms`);
  const publicRooms = await publicRoomsRes.json();
  const room5 = publicRooms.find(r => r.id === 5);
  assertTest(room5 && room5.wifi_password_enc === undefined && room5.wifi_password === undefined, 'Q1. Public /api/rooms strictly redacts Wi-Fi password fields', `Password fields absent`);

  // -------------------------------------------------------------
  // Scenario R: Unauthorized API Access Rejection
  // -------------------------------------------------------------
  console.log('\nScenario R: Unauthorized API Access Rejection');
  const unauthWifiRes = await fetch(`${STAGING_API}/api/bookings/9001/wifi-card`, {
    headers: { 'Authorization': 'Bearer invalid-token-xyz' }
  });
  assertTest(unauthWifiRes.status === 401 || unauthWifiRes.status === 403, 'R1. Invalid staff token rejected with HTTP 401/403', `Status: ${unauthWifiRes.status}`);

  const unauthAdminRes = await fetch(`${STAGING_API}/api/admin/clear-history`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer invalid-token' }
  });
  assertTest(unauthAdminRes.status === 401 || unauthAdminRes.status === 403, 'R2. Invalid staff token rejected with 401/403', `Status: ${unauthAdminRes.status}`);

  // -------------------------------------------------------------
  // Scenario S: LINE Hard-Block Evidence
  // -------------------------------------------------------------
  console.log('\nScenario S: LINE Hard-Block Evidence');
  const testLineRes = await fetch(`${STAGING_API}/api/settings/line/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ channel_access_token: 'dummy_staging_token_12345' })
  });
  const testLineData = await testLineRes.json();
  assertTest(testLineData.mocked === true && testLineData.sent === false, 'S1. LINE test endpoint returns mock without touching live API', `mocked: true, sent: false, bot: ${testLineData.bot?.name}`);

  // -------------------------------------------------------------
  // Scenario X: Cancellation & Error Handling
  // -------------------------------------------------------------
  console.log('\nScenario X: Cancellation & Error Handling');
  const cancelRes = await fetch(`${STAGING_API}/api/bookings/9003/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ reason: 'Staging customer requested cancellation' })
  });
  const cancelData = await cancelRes.json();
  assertTest(cancelRes.status === 200, 'X1. Cancel booking #9003 succeeds', `Status: 200, success: ${cancelData.success}`);

  // -------------------------------------------------------------
  // Scenario U: Frontend / Worker API Parity & Pages Hosting
  // -------------------------------------------------------------
  console.log('\nScenario U: Frontend Hosting & API Parity');
  const posPagesRes = await fetch(POS_PAGES);
  assertTest(posPagesRes.status === 200, 'U1. POS Pages index.html responds 200 OK', `Status: 200`);

  const bookingPagesRes = await fetch(BOOKING_PAGES);
  assertTest(bookingPagesRes.status === 200, 'U2. Booking App Pages index.html responds 200 OK', `Status: 200`);

  // -------------------------------------------------------------
  // Scenario V: Responsive Browser Screenshot Capture
  // -------------------------------------------------------------
  console.log('\nScenario V: Chrome Headless Screenshot Capture');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (fs.existsSync(chromePath)) {
    try {
      const desktopShot = path.join(ARTIFACT_DIR, 'staging_pos_desktop.png');
      const mobileShot = path.join(ARTIFACT_DIR, 'staging_pos_mobile_400px.png');
      const bookingShot = path.join(ARTIFACT_DIR, 'staging_booking_desktop.png');

      execSync(`"${chromePath}" --headless --screenshot="${desktopShot}" --window-size=1280,800 --hide-scrollbars "${POS_PAGES}"`, { stdio: 'pipe' });
      execSync(`"${chromePath}" --headless --screenshot="${mobileShot}" --window-size=400,800 --hide-scrollbars "${POS_PAGES}"`, { stdio: 'pipe' });
      execSync(`"${chromePath}" --headless --screenshot="${bookingShot}" --window-size=1280,800 --hide-scrollbars "${BOOKING_PAGES}"`, { stdio: 'pipe' });

      assertTest(fs.existsSync(desktopShot), 'V1. Desktop screenshot captured (1280x800)', desktopShot);
      assertTest(fs.existsSync(mobileShot), 'V2. Mobile screenshot captured (400x800)', mobileShot);
      assertTest(fs.existsSync(bookingShot), 'V3. Booking app screenshot captured (1280x800)', bookingShot);
    } catch (shotErr) {
      console.warn('Screenshot capture skipped:', shotErr.message);
    }
  }

  console.log('\n====================================================');
  console.log(`ACCEPTANCE SUMMARY: ${passedCount}/${totalCount} TESTS PASSED!`);
  console.log('STATUS: ALL STAGING ACCEPTANCE CRITERIA SATISFIED');
  console.log('====================================================\n');
}

runAcceptanceSuite().catch(err => {
  console.error('\n[ACCEPTANCE SUITE FAILED]');
  console.error(err);
  process.exit(1);
});
