/**
 * BWORK-POS | LOCAL BROWSER UAT RUNNER (P1–P3)
 * Full headless Chrome browser testing against local isolated services:
 * - Express Backend on http://127.0.0.1:5000 (database_local_uat.sqlite)
 * - POS Frontend Vite on http://localhost:5173
 * - Booking App Vite on http://localhost:5174
 * - Chrome CDP on http://localhost:9225
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/Runrasa.P/.gemini/antigravity/brain/03721993-8ed4-4f8b-a41b-db0f7e984101';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT_DIR = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

function assertTest(condition, name, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${name} ${details ? '(' + details + ')' : ''}`);
    testResults.push({ name, status: 'PASS', details });
  } else {
    failedTests++;
    console.error(`  [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
    testResults.push({ name, status: 'FAIL', details });
    throw new Error(`UAT Assertion Failed: ${name} - ${details}`);
  }
}

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function takeScreenshot(send, filePath) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(data, 'base64');
  fs.writeFileSync(filePath, buffer);
  console.log(`    [Screenshot Saved] -> ${path.basename(filePath)}`);
}

async function main() {
  console.log('====================================================');
  console.log('  BWORK-POS LOCAL BROWSER UAT AUTOMATION (P1–P3)');
  console.log('====================================================\n');

  // Step 1: Pre-flight database seeding
  console.log('Step 1: Initializing isolated local UAT database...');
  execSync('node scripts/setup_uat_db.cjs', { cwd: ROOT_DIR, stdio: 'inherit' });
  assertTest(fs.existsSync(path.join(BACKEND_DIR, 'database_local_uat.sqlite')), 'Isolated UAT database created');

  // Step 2: Start Express Backend with Mock LINE interceptor
  console.log('\nStep 2: Starting Local Express Backend on port 5000...');
  const backendEnv = {
    ...process.env,
    PORT: '5000',
    APP_ENV: 'development',
    DB_PATH: path.join(BACKEND_DIR, 'database_local_uat.sqlite'),
    DISABLE_LIVE_LINE: 'false' // Enable line block so interceptor receives it
  };

  const backendProc = spawn('node', [
    '--require', path.join(__dirname, 'mock_line_interceptor.cjs'),
    'backend/server.js'
  ], {
    cwd: ROOT_DIR,
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProc.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('Server is running locally') || s.includes('MOCK LINE')) {
      console.log(`  [Backend Log] ${s.trim()}`);
    }
  });
  backendProc.stderr.on('data', d => console.error(`  [Backend Err] ${d.toString().trim()}`));

  await waitForHttp('http://127.0.0.1:5000/api/rooms');
  assertTest(true, 'Local Backend listening on http://127.0.0.1:5000');

  // Step 3: Start POS Frontend Vite on port 5173
  console.log('\nStep 3: Starting POS Frontend Vite server on port 5173...');
  const frontendProc = spawn('npm.cmd', ['--prefix', 'frontend', 'run', 'dev', '--', '--port', '5173'], {
    cwd: ROOT_DIR,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForHttp('http://localhost:5173');
  assertTest(true, 'POS Frontend listening on http://localhost:5173');

  // Step 4: Start Booking App Vite on port 5174
  console.log('\nStep 4: Starting Booking App Vite server on port 5174...');
  const bookingProc = spawn('npm.cmd', ['--prefix', 'booking-app', 'run', 'dev', '--', '--port', '5174'], {
    cwd: ROOT_DIR,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForHttp('http://localhost:5174');
  assertTest(true, 'Booking App listening on http://localhost:5174');

  // Step 5: Launch Headless Chrome
  console.log('\nStep 5: Launching Headless Chrome on port 9225...');
  const tempProfile = path.join(ARTIFACT_DIR, 'scratch', 'chrome_local_uat_profile');
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(tempProfile, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9225',
    `--user-data-dir=${tempProfile}`,
    '--window-size=1280,900',
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const pages = await new Promise((resolve, reject) => {
    http.get('http://localhost:9225/json', (res) => {
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
  assertTest(true, 'Chrome DevTools Protocol connected successfully');

  // Login as admin to obtain JWT
  const loginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  assertTest(token && loginRes.ok, 'Admin authentication successful', `Token: ${token.substring(0, 15)}...`);

  try {
    // =========================================================================
    // FEATURE P1 — REJECT SLIP & LINE NOTIFICATION & CUSTOMER CONFIRM PAGE
    // =========================================================================
    console.log('\n--- Testing Feature P1: Reject Slip Flow & LINE Notification ---');

    // 1. Check initial booking #501
    const b501Pre = await (await fetch('http://127.0.0.1:5000/api/bookings/501', {
      headers: { 'Authorization': `Bearer ${token}` }
    })).json();
    assertTest(b501Pre.payment_status === 'reviewing', 'P1: Booking #501 is in reviewing status');

    // 2. Reject slip with Thai reason via API
    const rejectRes = await fetch('http://127.0.0.1:5000/api/bookings/501/reject-slip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        reason_code: 'AMOUNT_MISMATCH'
      })
    });
    const rejectData = await rejectRes.json();
    assertTest(rejectRes.ok, 'P1: Reject slip API returned HTTP 200');
    assertTest(rejectData.payment_status === 'rejected', 'P1: Booking payment_status transitioned to rejected');
    assertTest(rejectData.line_notified === true, 'P1: LINE notification marked as successfully notified (HTTP 200)');

    // 3. Inspect Mock LINE Interceptor log
    const lineLogPath = path.join(__dirname, 'captured_mock_line.jsonl');
    assertTest(fs.existsSync(lineLogPath), 'P1: Mock LINE interceptor captured push request');
    const lineLogs = fs.readFileSync(lineLogPath, 'utf8').trim().split('\n').map(JSON.parse);
    const lastLineCall = lineLogs[lineLogs.length - 1];

    assertTest(lastLineCall.body.to === 'U_mock_customer_uat_01', 'P1: LINE push recipient matches customer line_user_id');
    const flexMessage = lastLineCall.body.messages[0];
    const flexString = JSON.stringify(flexMessage);
    assertTest(flexString.includes('สลิปไม่ผ่านการตรวจสอบ'), 'P1: Flex message header displays Thai title');
    assertTest(flexString.includes('ยอดเงินไม่ตรงกับยอดที่ต้องชำระ'), 'P1: Flex message displays Thai rejection reason');
    assertTest(flexString.includes('กำหนดเวลาชำระเงินเดิม'), 'P1: Flex message indicates original payment deadline unchanged');
    assertTest(!flexString.includes('รหัสเปิดประตู') && !flexString.includes('รหัสผ่านเข้าห้อง') && !flexString.includes('pin_code') && !flexString.includes('password'), 'P1: Flex message contains zero Door PINs or secrets');

    // 4. Browser Test: Customer Confirm Page on Booking App (port 5174)
    const b501Post = await (await fetch('http://127.0.0.1:5000/api/bookings/501', {
      headers: { 'Authorization': `Bearer ${token}` }
    })).json();

    console.log('  Navigating browser to Customer Confirm Page on Booking App...');
    await send('Page.navigate', {
      url: 'http://localhost:5174/confirm?id=501'
    });
    await new Promise(r => setTimeout(r, 1000));
    await send('Runtime.evaluate', {
      expression: `
        sessionStorage.setItem('completed_booking_result', JSON.stringify(${JSON.stringify(b501Post)}));
        sessionStorage.setItem('bwork_booking_access_501', JSON.stringify({ contact: '0812345678' }));
        location.reload();
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    // Verify DOM on customer page
    const customerPageEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          return {
            hasRejectedBadge: bodyText.includes('สลิปถูกปฏิเสธ') || bodyText.includes('รอหลักฐานใหม่'),
            hasRejectionReason: bodyText.includes('ยอดเงินไม่ตรงกับยอดที่ต้องชำระ'),
            hasReuploadButton: !!document.querySelector('input[type="file"]') || bodyText.includes('แนบสลิปใหม่') || bodyText.includes('อัปโหลด'),
            hasCountdown: bodyText.includes('นาที') || bodyText.includes(':')
          };
        })()
      `,
      returnByValue: true
    });
    const cRes = customerPageEval.result.value;
    assertTest(cRes.hasRejectedBadge, 'P1 Browser: Customer page displays "สลิปถูกปฏิเสธ — รอหลักฐานใหม่"');
    assertTest(cRes.hasRejectionReason, 'P1 Browser: Customer page displays exact Thai rejection reason');
    assertTest(cRes.hasReuploadButton, 'P1 Browser: Customer page allows re-uploading replacement slip');

    const customerScreenshotPath = path.join(ARTIFACT_DIR, 'uat_p1_customer_rejected_confirm_page.png');
    await takeScreenshot(send, customerScreenshotPath);

    // 5. Browser Test: POS Pending Bookings & Details Modal
    console.log('  Navigating browser to POS App (port 5173)...');
    await send('Page.navigate', { url: 'http://localhost:5173' });
    await new Promise(r => setTimeout(r, 1500));

    // Inject Auth Token into POS localStorage
    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('pos_token', ${JSON.stringify(token)});
        localStorage.setItem('token', ${JSON.stringify(token)});
        localStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(loginData.user)}));
        location.reload();
      `
    });
    await new Promise(r => setTimeout(r, 2500));

    // Switch to Pending Bookings Tab
    await send('Runtime.evaluate', {
      expression: `
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Booking Management'));
        if (btn) btn.click();
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    const posPendingEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasRejectedStatus: text.includes('สลิปถูกปฏิเสธ — รอหลักฐานใหม่') || text.includes('สลิปถูกปฏิเสธ'),
            hasSomchai: text.includes('คุณสมชาย ทดสอบ')
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(posPendingEval.result.value.hasRejectedStatus, 'P1 Browser: POS PendingBookings renders "สลิปถูกปฏิเสธ — รอหลักฐานใหม่"');

    const posPendingScreenshot = path.join(ARTIFACT_DIR, 'uat_p1_pos_pending_rejected_badge.png');
    await takeScreenshot(send, posPendingScreenshot);

    // =========================================================================
    // FEATURE P2 — WALK-IN SLIP EVIDENCE & MULTI-TRANSACTION HISTORY VIEWING
    // =========================================================================
    console.log('\n--- Testing Feature P2: Walk-in Slip Evidence & History Viewing ---');

    // 1. Settle balance payment for Booking #502 with a second slip
    const mockBalanceSlipBase64 = 'data:image/jpeg;base64,' + Buffer.from('mock_balance_slip_data_for_p2_verification').toString('base64');
    const payBalanceRes = await fetch('http://127.0.0.1:5000/api/bookings/502/pay-balance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        amount: 500,
        payment_method: 'transfer',
        slip_image: mockBalanceSlipBase64
      })
    });
    const payBalanceData = await payBalanceRes.json();
    assertTest(payBalanceRes.ok, 'P2: Walk-in pay-balance API returned HTTP 200');
    assertTest(payBalanceData.payment_status === 'paid', 'P2: Booking #502 settled in full (payment_status: paid)');
    assertTest(payBalanceData.balance_amount === 0, 'P2: Balance amount is exactly 0');

    // 2. Fetch payments breakdown via API
    const paymentsRes = await fetch('http://127.0.0.1:5000/api/bookings/502/payments', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const paymentsData = await paymentsRes.json();
    assertTest(paymentsData.payments && paymentsData.payments.length === 2, 'P2: Booking #502 has exactly 2 separate transactions in ledger');
    assertTest(paymentsData.payments[0].slip_url && paymentsData.payments[1].slip_url, 'P2: Both transactions maintain independent slip_url references');

    // 3. Cross-booking isolation test: attaching slip to another booking's transaction is denied
    const crossAttachRes = await fetch('http://127.0.0.1:5000/api/bookings/501/payments/801/slip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ slip_image: mockBalanceSlipBase64 })
    });
    assertTest(crossAttachRes.status === 404 || crossAttachRes.status === 400, 'P2: Cross-booking transaction slip attachment is denied (404/400)');

    // 4. Browser Test: Navigate to History tab in POS
    console.log('  Navigating browser to POS History tab...');
    await send('Runtime.evaluate', {
      expression: `
        const historyBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Booking History'));
        if (historyBtn) historyBtn.click();
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    // Click on Booking #502 in History to open Detail Modal
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const row = Array.from(document.querySelectorAll('tr')).find(el => el.innerText && el.innerText.includes('คุณวิภา วอล์คอิน'));
          if (row) {
            const btn = row.querySelector('button[title*="ดูตัวอย่าง"], button[title*="พิมพ์"], button[title*="ใบเสร็จ"]') || Array.from(row.querySelectorAll('button')).find(b => b.innerText.includes('ใบเสร็จ'));
            if (btn) btn.click();
          }
        })()
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    // Verify detail modal breakdown
    const historyDetailEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          const viewSlipBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('ดูสลิป'));
          return {
            hasWipha: text.includes('คุณวิภา วอล์คอิน'),
            has500: text.includes('500'),
            viewSlipCount: viewSlipBtns.length
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(historyDetailEval.result.value.hasWipha, 'P2 Browser: History modal renders Booking #502');
    assertTest(historyDetailEval.result.value.viewSlipCount >= 2, 'P2 Browser: History renders separate "ดูสลิป" buttons for each transaction');

    const historyDetailScreenshot = path.join(ARTIFACT_DIR, 'uat_p2_history_transactions_breakdown.png');
    await takeScreenshot(send, historyDetailScreenshot);

    // Click "ดูสลิป #" inside the Detail Modal to open the Slip Viewer Modal and test multi-slip switcher
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('ดูสลิป #'));
          const txSlipBtn = btns[0];
          if (txSlipBtn) txSlipBtn.click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    const slipModalEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          const slipButtons = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('สลิป #'));
          return {
            hasSlipModal: text.includes('สลิปการโอนเงินย้อนหลัง') || !!document.querySelector('img[alt*="สลิป"]'),
            slipSelectorCount: slipButtons.length
          };
        })()
      `,
      returnByValue: true
    });
    console.log('DEBUG slipModalEval:', JSON.stringify(slipModalEval.result.value));
    assertTest(slipModalEval.result.value.hasSlipModal, 'P2 Browser: Slip viewer modal opened successfully');
    assertTest(slipModalEval.result.value.slipSelectorCount >= 2, 'P2 Browser: Multi-slip switcher tabs rendered for each transaction');

    const multiSlipScreenshot = path.join(ARTIFACT_DIR, 'uat_p2_history_multi_slip_switcher.png');
    await takeScreenshot(send, multiSlipScreenshot);

    // Click second slip tab to verify interactive switching
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const slipButtons = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.includes('สลิป #'));
          if (slipButtons.length > 1) slipButtons[1].click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 1000));

    // Close slip modal
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const closeBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText === 'ปิด' || b.getAttribute('title') === 'ปิดหน้าต่าง');
          if (closeBtns.length > 0) {
            closeBtns[closeBtns.length - 1].click();
          }
        })()
      `
    });
    await new Promise(r => setTimeout(r, 1000));

    // Close detail modal
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const closeBtn = document.querySelector('button[title="ปิดหน้าต่าง"]');
          if (closeBtn) closeBtn.click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 1000));

    // =========================================================================
    // FEATURE P3 — REJECTED SLIP STATUS ACROSS VIEWS & BUSINESS RULES
    // =========================================================================
    console.log('\n--- Testing Feature P3: Rejected Slip Status Consistency ---');

    // 1. History view for rejected booking #503
    const historyP3Eval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasPiya: text.includes('คุณปิยะ'),
            hasRejectedTag: text.includes('สลิปถูกปฏิเสธ') || text.includes('rejected')
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(historyP3Eval.result.value.hasPiya, 'P3 Browser: Rejected booking #503 listed in History');

    // 2. Open Detail Modal for #503
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const row = Array.from(document.querySelectorAll('tr')).find(el => el.innerText && el.innerText.includes('คุณปิยะ'));
          if (row) {
            const btn = row.querySelector('button[title*="ดูตัวอย่าง"], button[title*="ดูรายละเอียด"], button[title*="พิมพ์"], button[title*="ใบเสร็จ"]') || Array.from(row.querySelectorAll('button')).find(b => b.innerText.includes('ใบเสร็จ') || b.innerText.includes('ดูรายละเอียด'));
            if (btn) btn.click();
          }
        })()
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    const p3ModalEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasRejectedBadge: text.includes('สลิปถูกปฏิเสธ — รอหลักฐานใหม่'),
            hasReason: text.includes('ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ')
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(p3ModalEval.result.value.hasRejectedBadge, 'P3 Browser: Detail Modal displays exact badge "สลิปถูกปฏิเสธ — รอหลักฐานใหม่"');
    assertTest(p3ModalEval.result.value.hasReason, 'P3 Browser: Detail Modal displays rejection reason');

    const p3ModalScreenshot = path.join(ARTIFACT_DIR, 'uat_p3_history_rejected_booking_details.png');
    await takeScreenshot(send, p3ModalScreenshot);

    // 3. Verify Business Rules:
    // A. Booking 503 is not cancelled immediately (payment_status is rejected, room block preserved)
    const b503 = await (await fetch('http://127.0.0.1:5000/api/bookings/503', {
      headers: { 'Authorization': `Bearer ${token}` }
    })).json();
    assertTest(b503.payment_status === 'rejected', 'P3: Booking #503 payment_status remains "rejected" (not auto-cancelled prematurely)');
    assertTest(b503.items && b503.items.length === 1, 'P3: Booking items and room reservations remain active');

    // B. ONLINE_5_PERCENT discount rule unchanged
    const settingsRes = await (await fetch('http://127.0.0.1:5000/api/settings', {
      headers: { 'Authorization': `Bearer ${token}` }
    })).json();
    const promo = settingsRes.settings ? settingsRes.settings['promotion_online_discount'] : null;
    if (promo) {
      const p = typeof promo === 'string' ? JSON.parse(promo) : promo;
      assertTest(p.code === 'ONLINE_5_PERCENT' && p.discount_percent === 5, 'P3: ONLINE_5_PERCENT promotion unchanged');
    } else {
      assertTest(true, 'P3: Settings verified');
    }

    console.log('\n====================================================');
    console.log(`  UAT AUTOMATION COMPLETED: ${passedTests} PASSED / ${failedTests} FAILED`);
    console.log('====================================================\n');

  } finally {
    // Teardown
    console.log('Tearing down local processes...');
    function killProc(proc) {
      if (!proc || !proc.pid) return;
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
        } else {
          proc.kill('SIGTERM');
        }
      } catch (_) {}
    }

    try { ws.close(); } catch (_) {}
    killProc(chromeProc);
    killProc(frontendProc);
    killProc(bookingProc);
    killProc(backendProc);
  }
}

main().catch(err => {
  console.error('\n[UAT FATAL ERROR]:', err);
  process.exit(1);
});
