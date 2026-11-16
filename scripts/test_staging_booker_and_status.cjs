/**
 * BWORK-POS — STAGING ACCEPTANCE: BOOKER TYPES, COLOR SEPARATION, THREE CLICK ACTIONS, ZERO PII
 * Phase: feature/staff-booking-calendar
 *
 * Automated CDP verification against:
 * - Worker API:  https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev
 * - POS Pages:   https://bwork-pos-staging.pages.dev/staff-booking
 * - D1 Database: bworkpos_staging_db (8511096e-3c57-428f-8b2c-98fdb297f705)
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/Runrasa.P/.gemini/antigravity/brain/03721993-8ed4-4f8b-a41b-db0f7e984101';
const STAGING_API = 'https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev';
const STAFF_BOOKING_URL = 'https://bwork-pos-staging.pages.dev/staff-booking';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9228;

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

function executeStagingD1(sql, maxRetries = 3) {
  const backendDir = path.join(__dirname, '..', 'backend');
  const tempSqlFile = path.join(backendDir, `_temp_staging_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.sql`);
  fs.writeFileSync(tempSqlFile, sql, 'utf8');
  try {
    const cmd = `npx.cmd wrangler d1 execute bworkpos_staging_db --remote --file=${path.basename(tempSqlFile)} --config wrangler.staging.toml --json`;
    execSync(cmd, { cwd: backendDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: 'cmd.exe' });
  } finally {
    try { fs.unlinkSync(tempSqlFile); } catch (e) {}
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureScreenshot(send, filePath) {
  const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
  if (screenshotRes?.data) {
    fs.writeFileSync(filePath, Buffer.from(screenshotRes.data, 'base64'));
    console.log(`  [SCREENSHOT] Saved: ${filePath}`);
  }
}

async function run() {
  console.log('================================================================');
  console.log('  BWORK-POS STAGING ACCEPTANCE TEST: BOOKER TYPES & 3 CLICK ACTIONS');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Step 1: Preflight Data Seeding on Staging D1
  // -------------------------------------------------------------
  console.log('Step 1: Preflight Data Seeding on Staging D1...');
  
  executeStagingD1(`
    DELETE FROM booking_items WHERE booking_id IN (99801, 99802, 99803, 99804, 99805, 99806, 99807);
    DELETE FROM bookings WHERE id IN (99801, 99802, 99803, 99804, 99805, 99806, 99807);
  `);

  const now = new Date();
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const todayStr = bangkok.toISOString().slice(0, 10);

  const seedSql = `
    INSERT INTO bookings (id, receipt_number, customer_name, customer_type, booking_source, booking_channel, department, internal_department, checkin_status, payment_status, total_amount, created_at)
    VALUES
      (99801, 'BK-TEST-PAST', 'คุณสมพงษ์ ภายนอก', 'walkin', 'pos', 'pos_web', NULL, NULL, 'pending', 'paid', 500, '${todayStr} 09:00:00'),
      (99802, 'BK-TEST-INSLOT', 'คุณอนุชา ไอที', 'builtland', 'staff', 'staff_calendar', 'ฝ่าย IT', 'ฝ่ายเทคโนโลยีสารสนเทศ (IT)', 'pending', 'paid', 0, '${todayStr} 09:00:00'),
      (99803, 'BK-TEST-UPCOMING', 'คุณวิภาวรรณ บัญชี', 'builtland', 'staff', 'staff_calendar', 'ฝ่ายบัญชี', 'ฝ่ายการเงินและบัญชี', 'pending', 'paid', 0, '${todayStr} 09:00:00'),
      (99804, 'BK-TEST-CHKIN', 'คุณณัฐพล ลูกค้า', 'corporate', 'online', 'pos_web', NULL, NULL, 'checked_in', 'paid', 800, '${todayStr} 09:00:00'),
      (99805, 'BK-TEST-CHKOUT', 'คุณพงศธร บริหาร', 'builtland', 'staff', 'staff_calendar', 'ผู้บริหาร', 'สำนักกรรมการผู้จัดการ / ผู้บริหาร', 'checked_out', 'paid', 0, '${todayStr} 08:00:00'),
      (99806, 'BK-TEST-M-BL', 'คุณชวลิต ก่อสร้าง', 'builtland', 'staff', 'staff_calendar', 'ฝ่ายบริหารโครงการ', 'ฝ่ายบริหารโครงการและก่อสร้าง', 'pending', 'paid', 0, '2026-11-10 10:00:00'),
      (99807, 'BK-TEST-M-EXT', 'คุณธนกฤต บุคคลทั่วไป', 'general', 'walkin', 'walkin', NULL, NULL, 'pending', 'paid', 600, '2026-11-10 11:00:00');

    INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, checkin_status)
    VALUES
      (99801, 4, '${todayStr} 10:00:00', '${todayStr} 11:00:00', 500, 500, 'pending'),
      (99802, 4, '${todayStr} 14:00:00', '${todayStr} 15:30:00', 0, 0, 'pending'),
      (99803, 4, '${todayStr} 16:30:00', '${todayStr} 17:30:00', 0, 0, 'pending'),
      (99804, 6, '${todayStr} 12:00:00', '${todayStr} 13:00:00', 800, 800, 'checked_in'),
      (99805, 8, '${todayStr} 08:30:00', '${todayStr} 09:30:00', 0, 0, 'checked_out'),
      (99806, 4, '2026-11-20 10:00:00', '2026-11-20 11:30:00', 0, 0, 'pending'),
      (99807, 4, '2026-11-20 13:00:00', '2026-11-20 14:30:00', 600, 600, 'pending');
  `;
  executeStagingD1(seedSql);
  console.log('  [OK] 7 synthetic test bookings seeded into bworkpos_staging_db.');

  // -------------------------------------------------------------
  // Step 2: Public API Zero-PII & Classification Verification
  // -------------------------------------------------------------
  console.log('\nStep 2: Verifying Public API Zero-PII on Staging...');
  const pubMonthRes = await fetch(`${STAGING_API}/api/public/rooms/availability-month?month=2026-11`);
  assertTest(pubMonthRes.status === 200, 'Public API returns HTTP 200');
  const pubData = await pubMonthRes.json();
  assertTest(Array.isArray(pubData.intervals) && pubData.intervals.length >= 7, 'Public API returns intervals array');

  const leakedPii = pubData.intervals.filter(i => i.customer_name || i.department || i.internal_department);
  assertTest(leakedPii.length === 0, 'Public API has ZERO PII (no customer_name, no department)');

  // -------------------------------------------------------------
  // Step 3: Staff API Verification (with Authentication)
  // -------------------------------------------------------------
  console.log('\nStep 3: Verifying Staff API Authentication on Staging...');
  const staffAuthRes = await fetch(`${STAGING_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'staff_staging', password: 'admin' })
  });
  const staffAuthData = await staffAuthRes.json();
  assertTest(staffAuthRes.status === 200 && staffAuthData.token, 'Staff login succeeds and provides JWT');
  const staffToken = staffAuthData.token;

  const staffMonthRes = await fetch(`${STAGING_API}/api/staff/rooms/availability-month?month=2026-11`, {
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  assertTest(staffMonthRes.status === 200, 'Staff API returns HTTP 200 for authenticated staff');
  const staffData = await staffMonthRes.json();
  const staffBlItem = staffData.intervals.find(i => i.start.includes('2026-11-20T10:00:00'));
  assertTest(staffBlItem && staffBlItem.customer_name === 'คุณชวลิต ก่อสร้าง', 'Staff API includes customer_name for staff');
  assertTest(staffBlItem && staffBlItem.internal_department === 'ฝ่ายบริหารโครงการและก่อสร้าง', 'Staff API includes internal_department for staff');

  // -------------------------------------------------------------
  // Step 4: Headless Chrome CDP Verification on Staging Pages
  // -------------------------------------------------------------
  console.log('\nStep 4: Launching Headless Chrome & Connecting CDP...');
  const tempProfile = path.join(ARTIFACT_DIR, 'scratch', 'chrome_staging_booker_profile');
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(tempProfile, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    '--window-size=1280,900',
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ]);

  await delay(2500);

  const pages = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const targetPage = pages.find(p => p.type === 'page');
  const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');

  const evaluate = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return res.result?.value;
  };

  try {
    // =========================================================================
    // SCENARIO 1: AUTHENTICATED STAFF USER (shows booker names in monthly view)
    // =========================================================================
    console.log('\n--- Scenario 1: Authenticated Staff Session ---');
    await send('Page.navigate', { url: STAFF_BOOKING_URL });
    await delay(3000);

    // Set staff token in localStorage to simulate logged in staff
    await evaluate(`
      localStorage.setItem('token', '${staffToken}');
      localStorage.setItem('pos_token', '${staffToken}');
      localStorage.setItem('staff_token', '${staffToken}');
    `);
    // Reload page to activate authenticated staff session
    await send('Page.reload');
    await delay(3500);

    // Switch to POS Monthly Calendar view
    await evaluate('document.getElementById("staff-btn-view-pos-calendar").click()');
    await delay(1200);

    assertTest(await evaluate('document.querySelector(".staff-pos-section") !== null'),
      'Staff user switches to POS Monthly Calendar view');

    // Check Builtland chip with Booker Name on day 20
    const staffBlChip = await evaluate(`
      (() => {
        const cell20 = Array.from(document.querySelectorAll('.staff-pos-cell')).find(c => c.querySelector('.staff-pos-cell__day-num')?.innerText.trim() === '20');
        if (!cell20) return null;
        const chip = cell20.querySelector('.staff-pos-event-chip--builtland');
        if (!chip) return null;
        return {
          title: chip.querySelector('.staff-pos-event-chip__title')?.innerText.trim(),
          room: chip.querySelector('.staff-pos-event-chip__room')?.innerText.trim(),
          time: chip.querySelector('.staff-pos-event-chip__time')?.innerText.trim(),
          status: chip.querySelector('.staff-pos-event-chip__status')?.innerText.trim()
        };
      })()
    `);
    console.log('Staff Builtland Chip on UI (Day 20):', staffBlChip);
    assertTest(staffBlChip && staffBlChip.title.includes('คุณชวลิต ก่อสร้าง (พนักงาน Builtland)'),
      'Staff sees "ชื่อผู้จอง (พนักงาน Builtland)" on primary chip line', staffBlChip?.title);

    // Check External customer chip with Booker Name on day 20
    const staffExtChip = await evaluate(`
      (() => {
        const cell20 = Array.from(document.querySelectorAll('.staff-pos-cell')).find(c => c.querySelector('.staff-pos-cell__day-num')?.innerText.trim() === '20');
        if (!cell20) return null;
        const chip = cell20.querySelector('.staff-pos-event-chip--external');
        if (!chip) return null;
        return {
          title: chip.querySelector('.staff-pos-event-chip__title')?.innerText.trim(),
          room: chip.querySelector('.staff-pos-event-chip__room')?.innerText.trim(),
          time: chip.querySelector('.staff-pos-event-chip__time')?.innerText.trim(),
          status: chip.querySelector('.staff-pos-event-chip__status')?.innerText.trim()
        };
      })()
    `);
    console.log('Staff External Chip on UI (Day 20):', staffExtChip);
    assertTest(staffExtChip && staffExtChip.title.includes('คุณธนกฤต บุคคลทั่วไป (ลูกค้าภายนอก)'),
      'Staff sees "ชื่อผู้จอง (ลูกค้าภายนอก)" on primary chip line', staffExtChip?.title);

    // -------------------------------------------------------------------------
    // ACTION 1: Click Booking Item -> Opens Single Booking Detail Modal
    // -------------------------------------------------------------------------
    console.log('\n--- Action 1: Click Booking Item -> Single Booking Detail Modal ---');
    await evaluate(`
      (() => {
        const cell20 = Array.from(document.querySelectorAll('.staff-pos-cell')).find(c => c.querySelector('.staff-pos-cell__day-num')?.innerText.trim() === '20');
        const chip = cell20 ? cell20.querySelector('.staff-pos-event-chip--builtland') : null;
        if (chip) chip.click();
      })()
    `);
    await delay(600);

    const isSingleModalOpen = await evaluate('document.getElementById("staff-event-detail-modal") !== null');
    assertTest(isSingleModalOpen, 'Action 1: Single Booking Detail Modal opens upon clicking booking chip');

    const singleModalData = await evaluate(`
      (() => {
        const modal = document.getElementById("staff-event-detail-modal");
        if (!modal) return null;
        return {
          title: modal.querySelector('.staff-modal-title')?.innerText.trim(),
          bookerName: document.getElementById('staff-detail-booker-name')?.innerText.trim(),
          bookerDept: document.getElementById('staff-detail-booker-dept')?.innerText.trim(),
          badge: modal.querySelector('.staff-booker-type-badge')?.innerText.trim(),
          status: modal.querySelector('.staff-status-pill')?.innerText.trim()
        };
      })()
    `);
    assertTest(singleModalData && singleModalData.bookerName === 'คุณชวลิต ก่อสร้าง',
      'Action 1: Modal displays authorized booker name', singleModalData?.bookerName);
    assertTest(singleModalData && singleModalData.bookerDept === 'ฝ่ายบริหารโครงการและก่อสร้าง',
      'Action 1: Modal displays authorized department', singleModalData?.bookerDept);
    assertTest(singleModalData && singleModalData.badge === 'พนักงาน Builtland',
      'Action 1: Modal displays booker type badge "พนักงาน Builtland"');

    // Verify still in POS monthly view
    assertTest(await evaluate('document.querySelector(".staff-pos-section") !== null'),
      'Action 1: Opening single booking detail modal DOES NOT navigate away from POS monthly view');

    // Capture screenshot of Single Detail Modal
    const modalShotPath = path.join(ARTIFACT_DIR, 'staging_staff_booking_detail_modal.png');
    await captureScreenshot(send, modalShotPath);

    // Close Single Detail Modal
    await evaluate('document.querySelector("#staff-event-detail-modal .staff-modal-close").click()');
    await delay(400);
    assertTest(await evaluate('document.getElementById("staff-event-detail-modal") === null'),
      'Single booking detail modal closes cleanly returning to monthly view');

    // -------------------------------------------------------------------------
    // ACTION 2: Click "ดูเพิ่มเติม" -> Opens All Bookings of That Day
    // -------------------------------------------------------------------------
    console.log('\n--- Action 2: Click "ดูเพิ่มเติม" -> Day Bookings Modal ---');
    await evaluate(`
      (() => {
        const cells = Array.from(document.querySelectorAll('.staff-pos-cell'));
        for (const cell of cells) {
          const btn = cell.querySelector('.staff-pos-more-btn');
          const dayNum = cell.querySelector('.staff-pos-cell__day-num')?.innerText.trim();
          if (btn && dayNum === '20') {
            btn.click();
            return;
          }
        }
      })()
    `);
    await delay(600);

    const isDayModalOpen = await evaluate('document.getElementById("staff-pos-day-detail-modal") !== null');
    assertTest(isDayModalOpen, 'Action 2: "ดูเพิ่มเติม" modal opens upon clicking more button');

    // Verify still in POS monthly view
    assertTest(await evaluate('document.querySelector(".staff-pos-section") !== null'),
      'Action 2: Opening "ดูเพิ่มเติม" modal DOES NOT navigate away from POS monthly view');

    // Close Day Modal
    await evaluate('document.querySelector("#staff-pos-day-detail-modal .staff-modal-close").click()');
    await delay(400);

    // -------------------------------------------------------------------------
    // ACTION 3: Click Day Number / Cell -> Returns to Booking View with Date Expanded
    // -------------------------------------------------------------------------
    console.log('\n--- Action 3: Click Day Number -> Returns to Booking View & Expands Day ---');
    await evaluate(`
      (() => {
        const cells = Array.from(document.querySelectorAll('.staff-pos-cell'));
        for (const cell of cells) {
          const dayBtn = cell.querySelector('.staff-pos-cell__day-btn');
          const dayNum = cell.querySelector('.staff-pos-cell__day-num')?.innerText.trim();
          if (dayBtn && dayNum === '20') {
            dayBtn.click();
            return;
          }
        }
      })()
    `);
    await delay(800);

    const isBackInBookingView = await evaluate('document.querySelector(".staff-main-layout") !== null');
    assertTest(isBackInBookingView, 'Action 3: Clicking day number returns to Home Booking view');

    const expandedDateTitle = await evaluate('document.querySelector(".staff-expanded-panel__date")?.innerText.trim()');
    assertTest(expandedDateTitle && expandedDateTitle.includes('20 พฤศจิกายน 2569'),
      'Action 3: Expands inline week accordion for 20 พฤศจิกายน 2569', expandedDateTitle);

    // =========================================================================
    // SCENARIO 2: UNAUTHENTICATED PUBLIC LINK USER (zero PII, types only)
    // =========================================================================
    console.log('\n--- Scenario 2: Unauthenticated Public Link User ---');
    // Clear tokens to become public unauthenticated link user
    await evaluate(`
      localStorage.clear();
      sessionStorage.clear();
    `);
    await send('Page.reload');
    await delay(3500);

    // Switch to POS Monthly Calendar view
    await evaluate('document.getElementById("staff-btn-view-pos-calendar").click()');
    await delay(1200);

    // Public user should see booker TYPE instead of booker name
    const pubChips = await evaluate(`
      Array.from(document.querySelectorAll('.staff-pos-event-chip')).map(chip => ({
        title: chip.querySelector('.staff-pos-event-chip__title')?.innerText.trim(),
        room: chip.querySelector('.staff-pos-event-chip__room')?.innerText.trim(),
        time: chip.querySelector('.staff-pos-event-chip__time')?.innerText.trim()
      }))
    `);
    console.log('Public chips on UI:', pubChips.slice(0, 4));

    // Verify NO customer names appear on public chips
    const hasAnyCustomerName = pubChips.some(c => c.title.includes('ชวลิต') || c.title.includes('ธนกฤต') || c.title.includes('สมพงษ์'));
    assertTest(!hasAnyCustomerName, 'Public user sees ZERO booker names in monthly chips');

    const pubBlChip = pubChips.find(c => c.title === 'พนักงาน Builtland');
    assertTest(!!pubBlChip, 'Public user sees "พนักงาน Builtland" on primary chip line');

    const pubExtChip = pubChips.find(c => c.title === 'ลูกค้าภายนอก');
    assertTest(!!pubExtChip, 'Public user sees "ลูกค้าภายนอก" on primary chip line');

    // Click chip as public user
    await evaluate(`
      (() => {
        const chip = document.querySelector('.staff-pos-event-chip--builtland');
        if (chip) chip.click();
      })()
    `);
    await delay(600);

    const isPubModalOpen = await evaluate('document.getElementById("staff-event-detail-modal") !== null');
    assertTest(isPubModalOpen, 'Public user can open single booking detail modal');

    const pubModalHasName = await evaluate('document.getElementById("staff-detail-booker-name") !== null');
    assertTest(!pubModalHasName, 'Public modal has ZERO booker name element (Zero PII)');

    const pubModalHasDept = await evaluate('document.getElementById("staff-detail-booker-dept") !== null');
    assertTest(!pubModalHasDept, 'Public modal has ZERO department element (Zero PII)');

    // Close modal
    await evaluate('document.querySelector("#staff-event-detail-modal .staff-modal-close").click()');
    await delay(400);

    // Capture desktop monthly calendar screenshot
    const desktopShotPath = path.join(ARTIFACT_DIR, 'staging_monthly_calendar_desktop.png');
    await captureScreenshot(send, desktopShotPath);

    // =========================================================================
    // SCENARIO 3: MOBILE VIEWPORT (390x844 Bottom Sheet & Responsiveness)
    // =========================================================================
    console.log('\n--- Scenario 3: Mobile Viewport Bottom Sheet Test (390x844) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true
    });
    await delay(600);

    // Open booking chip on mobile
    await evaluate(`
      (() => {
        const chip = document.querySelector('.staff-pos-event-chip--external');
        if (chip) chip.click();
      })()
    `);
    await delay(600);

    const isMobileModalOpen = await evaluate('document.getElementById("staff-event-detail-modal") !== null');
    assertTest(isMobileModalOpen, 'Mobile Bottom Sheet opens upon clicking booking chip');

    const mobileShotPath = path.join(ARTIFACT_DIR, 'staging_booking_detail_mobile_sheet.png');
    await captureScreenshot(send, mobileShotPath);

    // Close bottom sheet
    await evaluate('document.querySelector("#staff-event-detail-modal .staff-modal-close").click()');
    await delay(400);

    await send('Emulation.clearDeviceMetricsOverride');
    await delay(400);

    console.log('\n================================================================');
    console.log(`ACCEPTANCE SUMMARY: ${passedCount}/${totalCount} TESTS PASSED!`);
    console.log('================================================================\n');

  } finally {
    try { ws.close(); } catch (e) {}
    try { chromeProc.kill(); } catch (e) {}
    try {
      executeStagingD1(`
        DELETE FROM booking_items WHERE booking_id IN (99801, 99802, 99803, 99804, 99805, 99806, 99807);
        DELETE FROM bookings WHERE id IN (99801, 99802, 99803, 99804, 99805, 99806, 99807);
      `);
      console.log('  [CLEANUP] Synthetic staging fixtures cleaned up.');
    } catch (e) {}
  }
}

run().catch(err => {
  console.error('\n[FATAL RUN ERROR]:', err);
  process.exit(1);
});
