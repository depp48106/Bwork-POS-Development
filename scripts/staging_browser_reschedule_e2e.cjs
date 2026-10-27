/**
 * BWORK-POS — STAGING BROWSER RESCHEDULE END-TO-END AUTOMATION
 * Phase: PRODUCTION FINAL PRE-DEPLOYMENT GATE (Section 1)
 *
 * Full headless Chrome browser testing against:
 * POS Pages:   https://bwork-pos-staging.pages.dev
 * Worker API:  https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev
 * D1 Database: bworkpos_staging_db (8511096e-3c57-428f-8b2c-98fdb297f705)
 *
 * Tests multi-item rescheduling on synthetic Booking #9002:
 * 1. Stage 1 Multi-Item Selector renders all 3 items (first, middle, last)
 * 2. Stage 2 Edit Form for Item 1 (#9102) -> Date changed to 2026-10-25, saved & verified in D1
 * 3. Stage 2 Edit Form for Item 2 (#9103) -> Room changed to Room 4 (Mars 301), Date changed to 2026-10-25, saved & verified in D1
 * 4. Stage 2 Edit Form for Item 3 (#9105) -> Date changed to 2026-10-25, saved & verified in D1
 * 5. Verifies unchanged items remain untouched during each step
 * 6. Verifies financial totals (total_amount=3000, paid_amount=1000, balance_amount=2000)
 * 7. Verifies PIN code isolation (970491# preserved)
 * 8. Verifies mock LINE delivery (zero live external LINE calls)
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/Runrasa.P/.gemini/antigravity/brain/03721993-8ed4-4f8b-a41b-db0f7e984101';
const STAGING_API = 'https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev';
const POS_PAGES = 'https://bwork-pos-staging.pages.dev';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let passedTests = 0;
let totalTests = 0;
const results = [];

function assertTest(condition, name, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${name} ${details ? '(' + details + ')' : ''}`);
    results.push({ name, status: 'PASS', details });
  } else {
    console.error(`  [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
    results.push({ name, status: 'FAIL', details });
    throw new Error(`Test failed: ${name} - ${details}`);
  }
}

function queryStagingD1(sql) {
  const backendDir = path.join(__dirname, '..', 'backend');
  const isWin = process.platform === 'win32';
  const cmd = isWin
    ? `powershell.exe -NoProfile -Command "npx.cmd wrangler d1 execute bworkpos_staging_db --remote --command \\"${sql}\\" --config wrangler.staging.toml --json"`
    : `npx wrangler d1 execute bworkpos_staging_db --remote --command "${sql}" --config wrangler.staging.toml --json`;
  const out = execSync(cmd, { cwd: backendDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const jsonStart = out.indexOf('[');
  const jsonEnd = out.lastIndexOf(']');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`Invalid D1 output: ${out}`);
  }
  const parsed = JSON.parse(out.substring(jsonStart, jsonEnd + 1));
  return parsed[0]?.results || [];
}

async function main() {
  console.log('====================================================');
  console.log('  BWORK-POS STAGING BROWSER RESCHEDULE ACCEPTANCE');
  console.log('====================================================\n');

  // Preflight: Reset synthetic booking #9002 to clean baseline in Staging D1
  console.log('Preflight: Resetting and checking synthetic booking #9002 in Staging D1...');
  queryStagingD1("UPDATE booking_items SET room_id = 5, start_time = '2026-10-21T07:00:00', end_time = '2026-10-21T09:00:00' WHERE id = 9102;");
  queryStagingD1("UPDATE booking_items SET room_id = 5, start_time = '2026-10-21T14:00:00', end_time = '2026-10-21T16:00:00' WHERE id = 9103;");
  queryStagingD1("UPDATE booking_items SET room_id = 5, start_time = '2026-10-21T17:00:00', end_time = '2026-10-21T19:00:00' WHERE id = 9105;");
  queryStagingD1("UPDATE bookings SET total_amount = 3000, subtotal_amount = 3000, paid_amount = 1000, balance_amount = 2000, pin_code = '970491#' WHERE id = 9002;");

  const itemsBefore = queryStagingD1('SELECT id, booking_id, room_id, start_time, end_time, price, subtotal, pin_code FROM booking_items WHERE booking_id = 9002 ORDER BY id ASC;');
  assertTest(itemsBefore.length === 3, 'Preflight: Booking #9002 has 3 items in Staging D1', `Items: ${itemsBefore.map(i => i.id).join(', ')}`);

  const bookingBefore = queryStagingD1('SELECT id, customer_name, total_amount, paid_amount, balance_amount, pin_code FROM bookings WHERE id = 9002;')[0];
  assertTest(bookingBefore && bookingBefore.total_amount === 3000, 'Preflight: Booking #9002 total_amount is 3000', `Total: ${bookingBefore.total_amount}`);

  // Launch Chrome
  console.log('\nStep 1: Launching Headless Chrome on port 9223...');
  const tempProfile = path.join(ARTIFACT_DIR, 'scratch', 'chrome_staging_e2e_profile');
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(tempProfile, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${tempProfile}`,
    '--window-size=1280,900',
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const pages = await new Promise((resolve, reject) => {
    http.get('http://localhost:9223/json', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const targetPage = pages.find(p => p.type === 'page');
  console.log('Connected to Chrome target page:', targetPage.webSocketDebuggerUrl);

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

  try {
    // Step 2: Auth
    console.log('\nStep 2: Authenticating with Staging Worker API...');
    const credFile = path.join(ARTIFACT_DIR, 'scratch', 'staging_admin_credentials.json');
    const stagingAdminPass = process.env.STAGING_ADMIN_PASSWORD || (fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, 'utf8')).password : '');
    const loginRes = await fetch(`${STAGING_API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: stagingAdminPass })
    });
    const loginData = await loginRes.json();
    assertTest(loginRes.status === 200 && loginData.token, 'Auth: Admin login token received', `User: ${loginData.user?.username}`);

    // Step 3: Load POS
    console.log('\nStep 3: Loading Staging POS in Chrome and setting session...');
    await send('Page.navigate', { url: POS_PAGES });
    await new Promise(r => setTimeout(r, 2500));

    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('pos_token', ${JSON.stringify(loginData.token)});
        localStorage.setItem('token', ${JSON.stringify(loginData.token)});
        localStorage.setItem('pos_user', ${JSON.stringify(JSON.stringify(loginData.user))});
      `
    });

    await send('Page.navigate', { url: POS_PAGES });
    await new Promise(r => setTimeout(r, 3500));

    const authCheck = await send('Runtime.evaluate', {
      expression: `Boolean(document.querySelector('.app-container') || document.body.innerText.includes('ผู้ดูแลระบบ'))`
    });
    assertTest(authCheck.result?.value === true, 'Browser: Staging POS authenticated session active');

    // Step 4: Nav to Booking Management
    console.log('\nStep 4: Navigating to Booking Management...');
    await send('Runtime.evaluate', {
      expression: `
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Booking Management'));
        if (btn) btn.click();
      `
    });
    await new Promise(r => setTimeout(r, 3000));

    const pendingCheck = await send('Runtime.evaluate', {
      expression: `Boolean(document.body.innerText.includes('รายการจอง') || document.body.innerText.includes('9002'))`
    });
    assertTest(pendingCheck.result?.value === true, 'Browser: Booking Management table rendered');

    // Helpers
    async function openRescheduleModal() {
      console.log('  Triggering reschedule modal for Booking #9002...');
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const rows = Array.from(document.querySelectorAll('tr'));
            const r9002 = rows.find(r => r.innerText.includes('9002'));
            const moreBtn = r9002.querySelector('button.pb-more-btn, button[aria-label="เมนูเพิ่มเติม"]');
            moreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          })()
        `
      });
      await new Promise(r => setTimeout(r, 800));

      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const items = Array.from(document.querySelectorAll('.action-menu-item'));
            const reschedBtn = items.find(it => it.innerText.includes('แก้ไขวัน/เวลา'));
            if (reschedBtn) reschedBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          })()
        `
      });
      await new Promise(r => setTimeout(r, 2500));
    }

    async function selectItemToReschedule(itemIndex) {
      console.log(`  Selecting Item ${itemIndex + 1} from Stage 1 selector...`);
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const cards = Array.from(document.querySelectorAll('.pb-resched-item-card'));
            const btn = cards[${itemIndex}]?.querySelector('button');
            if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          })()
        `
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    async function selectDateDay(dayNum) {
      console.log(`  Selecting date day ${dayNum} via CustomDatePicker...`);
      // Open CustomDatePicker popover
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const labels = Array.from(document.querySelectorAll('label'));
            const dateLabel = labels.find(l => l.innerText.includes('วันที่ต้องการเปลี่ยน'));
            const pickerDiv = dateLabel?.parentElement?.querySelector('div');
            if (pickerDiv) pickerDiv.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          })()
        `
      });
      await new Promise(r => setTimeout(r, 800));

      // Click day button
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const popover = document.querySelector('.custom-datepicker-popover');
            if (!popover) return;
            const dayBtns = Array.from(popover.querySelectorAll('button'));
            const targetDay = dayBtns.find(b => b.innerText.trim() === '${dayNum}');
            if (targetDay) targetDay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          })()
        `
      });
      await new Promise(r => setTimeout(r, 800));
    }

    async function selectRoom(roomName) {
      console.log(`  Selecting room "${roomName}"...`);
      // Open Room Dropdown
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const labels = Array.from(document.querySelectorAll('label'));
            const roomLabel = labels.find(l => l.innerText.includes('ห้องประชุม'));
            const roomDiv = roomLabel?.parentElement?.querySelector('div[style*="cursor: pointer"]');
            if (roomDiv) roomDiv.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          })()
        `
      });
      await new Promise(r => setTimeout(r, 600));

      // Click Room Option
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const dropdown = document.querySelector('.action-dropdown-menu');
            if (!dropdown) return;
            const options = Array.from(dropdown.querySelectorAll('div'));
            const targetOpt = options.find(o => o.innerText.includes('${roomName}'));
            if (targetOpt) targetOpt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          })()
        `
      });
      await new Promise(r => setTimeout(r, 600));
    }

    async function clickSave() {
      console.log('  Clicking Save button in Stage 2...');
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const btns = Array.from(document.querySelectorAll('button'));
            const saveBtn = btns.find(b => b.innerText.includes('บันทึกการเปลี่ยนแปลง'));
            if (saveBtn) saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          })()
        `
      });
      await new Promise(r => setTimeout(r, 2500));

      // Dismiss sysAlert dialog ("เปลี่ยนแปลงวันและเวลาการจองสำเร็จแล้ว")
      console.log('  Dismissing system alert dialog...');
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const btns = Array.from(document.querySelectorAll('button'));
            const okBtn = btns.find(b => b.innerText.trim() === 'ตกลง');
            if (okBtn) okBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          })()
        `
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    async function takeScreenshot(filename) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const dest = path.join(ARTIFACT_DIR, filename);
      fs.writeFileSync(dest, Buffer.from(shot.data, 'base64'));
      console.log(`  [SCREENSHOT] Saved ${filename}`);
      return dest;
    }

    // =========================================================================
    // FLOW A: STAGE 1 MULTI-ITEM SELECTOR
    // =========================================================================
    console.log('\n--- Test Flow A: Stage 1 Multi-Item Selector ---');
    await openRescheduleModal();

    const s1Info = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const cards = Array.from(document.querySelectorAll('.pb-resched-item-card'));
          return {
            cardCount: cards.length,
            isMulti: Boolean(document.body.innerText.includes('การจองนี้มีหลายรายการ')),
            texts: cards.map(c => c.innerText.replace(/\\n/g, ' '))
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(s1Info.result?.value?.cardCount === 3, 'A1. Stage 1 displays all 3 items (first, middle, last)', `Found ${s1Info.result?.value?.cardCount} item cards`);
    await takeScreenshot('smoke_desktop_stage1_selector.png');

    // =========================================================================
    // FLOW B: RESCHEDULE FIRST ITEM (#9102)
    // =========================================================================
    console.log('\n--- Test Flow B: Reschedule First Item (#9102) ---');
    await selectItemToReschedule(0);

    const s2Check = await send('Runtime.evaluate', {
      expression: `Boolean(document.body.innerText.includes('ย้อนกลับไปเลือกรายการอื่น') && document.body.innerText.includes('กำลังแก้ไข:'))`
    });
    assertTest(s2Check.result?.value === true, 'B1. Stage 2 Edit Form rendered for Item 1 (first item)');
    await takeScreenshot('smoke_desktop_stage2_edit_form.png');

    await selectDateDay('25');
    await clickSave();

    const d1Item1 = queryStagingD1('SELECT id, start_time, end_time, price, subtotal FROM booking_items WHERE id = 9102;')[0];
    assertTest(d1Item1 && d1Item1.start_time.startsWith('2026-10-25'), 'B2. Item 1 date updated in Staging D1', `start_time: ${d1Item1?.start_time}`);

    const d1Item2Untouched = queryStagingD1('SELECT id, start_time FROM booking_items WHERE id = 9103;')[0];
    const d1Item3Untouched = queryStagingD1('SELECT id, start_time FROM booking_items WHERE id = 9105;')[0];
    assertTest(d1Item2Untouched.start_time.startsWith('2026-10-21'), 'B3. Item 2 (middle) untouched during Item 1 save', `start_time: ${d1Item2Untouched.start_time}`);
    assertTest(d1Item3Untouched.start_time.startsWith('2026-10-21'), 'B4. Item 3 (last) untouched during Item 1 save', `start_time: ${d1Item3Untouched.start_time}`);

    // =========================================================================
    // FLOW C: RESCHEDULE MIDDLE ITEM (#9103)
    // =========================================================================
    console.log('\n--- Test Flow C: Reschedule Middle Item (#9103) ---');
    await openRescheduleModal();
    await selectItemToReschedule(1);

    // Edit Room to Room 4 (Mars 301) and Date to day 25
    await selectRoom('Mars (301)');
    await selectDateDay('25');
    await clickSave();

    const d1Item2 = queryStagingD1('SELECT id, room_id, start_time, end_time FROM booking_items WHERE id = 9103;')[0];
    assertTest(d1Item2 && d1Item2.start_time.startsWith('2026-10-25'), 'C1. Item 2 date updated in Staging D1', `start_time: ${d1Item2?.start_time}`);
    assertTest(d1Item2 && d1Item2.room_id === 4, 'C2. Item 2 room updated to Room 4 in Staging D1', `room_id: ${d1Item2?.room_id}`);

    // =========================================================================
    // FLOW D: RESCHEDULE LAST ITEM (#9105)
    // =========================================================================
    console.log('\n--- Test Flow D: Reschedule Last Item (#9105) ---');
    await openRescheduleModal();
    await selectItemToReschedule(2);

    await selectDateDay('25');
    await clickSave();

    const d1Item3 = queryStagingD1('SELECT id, start_time, end_time FROM booking_items WHERE id = 9105;')[0];
    assertTest(d1Item3 && d1Item3.start_time.startsWith('2026-10-25'), 'D1. Item 3 date updated in Staging D1', `start_time: ${d1Item3?.start_time}`);

    // =========================================================================
    // FLOW E: FINANCIAL TOTALS & PIN INTEGRITY
    // =========================================================================
    console.log('\n--- Test Flow E: Financial Totals & PIN Isolation ---');
    const b9002After = queryStagingD1('SELECT id, total_amount, paid_amount, balance_amount, pin_code FROM bookings WHERE id = 9002;')[0];
    assertTest(b9002After.total_amount === 3000, 'E1. Booking #9002 total_amount preserved (3000)', `Total: ${b9002After.total_amount}`);
    assertTest(b9002After.paid_amount === 1000, 'E2. Booking #9002 paid_amount preserved (1000)', `Paid: ${b9002After.paid_amount}`);
    assertTest(b9002After.balance_amount === 2000, 'E3. Booking #9002 balance_amount preserved (2000)', `Balance: ${b9002After.balance_amount}`);
    assertTest(b9002After.pin_code === '970491#', 'E4. Booking #9002 PIN code preserved (970491#)', `PIN: ${b9002After.pin_code}`);

    const b9001After = queryStagingD1('SELECT id, total_amount, pin_code FROM bookings WHERE id = 9001;')[0];
    const b9003After = queryStagingD1('SELECT id, total_amount, pin_code FROM bookings WHERE id = 9003;')[0];
    assertTest(b9001After.pin_code === '970491#', 'E5. Sibling booking #9001 PIN untouched', `PIN: ${b9001After.pin_code}`);
    assertTest(b9003After.pin_code === '987654#', 'E6. Unrelated booking #9003 PIN untouched', `PIN: ${b9003After.pin_code}`);

    // =========================================================================
    // FLOW F: CONFIRM NO REAL LINE DELIVERY
    // =========================================================================
    console.log('\n--- Test Flow F: LINE Isolation Proof ---');
    const lineTestRes = await fetch(`${STAGING_API}/api/settings/line/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${loginData.token}` },
      body: JSON.stringify({ channel_access_token: 'dummy_staging_token_12345' })
    });
    const lineTestData = await lineTestRes.json();
    assertTest(lineTestData.mocked === true && lineTestData.sent === false, 'F1. Staging reports mocked: true, sent: false', `mocked: ${lineTestData.mocked}, sent: ${lineTestData.sent}, bot: ${lineTestData.bot?.name}`);

    console.log('\n====================================================');
    console.log(`STAGING BROWSER ACCEPTANCE: ${passedTests}/${totalTests} TESTS PASSED!`);
    console.log('STATUS: ALL STAGING BROWSER ACCEPTANCE CRITERIA VERIFIED');
    console.log('====================================================\n');
  } finally {
    ws.close();
    chromeProc.kill();
  }
}

main().catch(err => {
  console.error('\n[STAGING BROWSER ACCEPTANCE FAILED]');
  console.error(err);
  process.exit(1);
});
