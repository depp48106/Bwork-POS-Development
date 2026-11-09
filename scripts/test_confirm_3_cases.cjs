/**
 * scripts/test_confirm_3_cases.cjs
 * Automated E2E Verification of Room Guidelines Pre-Payment Gate on /confirm
 *
 * Covers all 3 required test scenarios:
 * Case 1: Room 201 created AFTER cutover:
 *         - Before acknowledge: QR locked on /confirm, slip upload rejected (400 GUIDELINES_NOT_ACKNOWLEDGED)
 *         - After clicking confirm on /confirm: QR unlocked & visible, test slip upload succeeds (200)
 * Case 2: Pre-cutover legacy booking:
 *         - QR directly unlocked, slip upload succeeds directly without acknowledgement (200)
 * Case 3: Enforcement disabled (guidelines_enforcement_enabled = 'false'):
 *         - New Room 201 booking: QR directly unlocked, slip upload succeeds normally (200)
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9444;
const VITE_PORT = 5174;
const WORKER_PORT = 5000;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Connect to Chrome via CDP WebSocket
async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (err) => {
      console.error('[CDP WS ERROR]', err);
      reject(err);
    };
  });

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
    if (msg.method === 'Runtime.consoleAPICalled') {
      console.log('[BROWSER CONSOLE]', msg.params.type, msg.params.args?.map(a => a.value || a.description).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await send('Page.enable');
  await send('DOM.enable');
  await send('Runtime.enable');

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res && res.result ? res.result.value : undefined;
  }

  async function waitForElement(selector, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await evaluate(`Boolean(document.querySelector('${selector}'))`);
      if (found) return true;
      await sleep(150);
    }
    return false;
  }

  return { ws, send, evaluate, waitForElement };
}

async function runTests() {
  console.log('===============================================================');
  console.log('STARTING AUTOMATED /CONFIRM 3 CASES VERIFICATION');
  console.log('Worker Port:', WORKER_PORT, '| Vite Port:', VITE_PORT);
  console.log('===============================================================\n');

  // Load sample slip image as base64
  const slipPath = path.resolve(__dirname, '../backend/uploads/slips/slip_BK000041_1786089659264.png');
  const slipBase64 = 'data:image/png;base64,' + fs.readFileSync(slipPath).toString('base64');

  // Launch Chrome Headless
  const tempProfile = path.resolve(__dirname, '../backend/.chrome-test-confirm-3cases');
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(tempProfile, { recursive: true });

  console.log('[Setup] Launching Headless Chrome on CDP port', CDP_PORT);
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    '--window-size=430,932',
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ]);

  await sleep(2500);

  // Wait for Chrome to be ready and get or create a page target
  let wsUrl = null;
  for (let i = 0; i < 20; i++) {
    try {
      const list = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
      });
      const target = list.find(p => p.type === 'page') || list[0];
      if (target && target.webSocketDebuggerUrl) {
        wsUrl = target.webSocketDebuggerUrl;
        break;
      }
      if (list.length === 0) {
        // Create new target
        const newTarget = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${CDP_PORT}/json/new`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
          }).on('error', reject);
        });
        if (newTarget && newTarget.webSocketDebuggerUrl) {
          wsUrl = newTarget.webSocketDebuggerUrl;
          break;
        }
      }
    } catch (_) {}
    await sleep(500);
  }

  if (!wsUrl) {
    throw new Error('Failed to connect to Headless Chrome on port ' + CDP_PORT);
  }

  wsUrl = wsUrl.replace('localhost', '127.0.0.1');
  console.log('[Setup] Connecting CDP WebSocket to:', wsUrl);
  const cdp = await connectCdp(wsUrl);

  const results = {
    case1: { status: 'PENDING', steps: [] },
    case2: { status: 'PENDING', steps: [] },
    case3: { status: 'PENDING', steps: [] }
  };

  try {
    // =========================================================================
    // CASE 1: Booking Room 201 created AFTER cutover (enforcement ON)
    // =========================================================================
    console.log('---------------------------------------------------------------');
    console.log('TEST CASE 1: Room 201 created AFTER cutover (Enforcement ON)');
    console.log('---------------------------------------------------------------');

    // 1.1 Set session storage access token/contact & navigate
    const confirmUrl1 = `http://localhost:${VITE_PORT}/confirm?id=901`;
    console.log('Navigating to:', confirmUrl1);
    await cdp.send('Page.navigate', { url: `http://localhost:${VITE_PORT}/` });
    await sleep(1000);
    await cdp.evaluate(`
      sessionStorage.setItem('bwork_booking_access_901', JSON.stringify({ contact: '0811111111' }));
      sessionStorage.setItem('bwork_booking_access_902', JSON.stringify({ contact: '0822222222' }));
      sessionStorage.setItem('bwork_booking_access_903', JSON.stringify({ contact: '0833333333' }));
    `);
    await cdp.send('Page.navigate', { url: confirmUrl1 });
    await sleep(2500);

    const pageText = await cdp.evaluate(`document.body.innerText`);
    console.log('[DEBUG Page Text]:\n', pageText ? pageText.slice(0, 500) : 'EMPTY');

    // 1.2 Check that QR is locked on /confirm
    const gatedCardExists = await cdp.waitForElement('#gated-qr-placeholder', 6000);
    const lockedText = await cdp.evaluate(`document.getElementById('gated-qr-placeholder')?.innerText || ''`);
    const isLockedTextFound = lockedText.includes('QR Code สำหรับชำระเงินถูกล็อกไว้');
    console.log('Step 1.1 - Gated QR placeholder visible:', gatedCardExists);
    console.log('Step 1.1 - Locked text detected:', isLockedTextFound);
    assert.strictEqual(gatedCardExists && isLockedTextFound, true, 'Case 1: QR code must be locked before acknowledgement');
    results.case1.steps.push('QR locked on /confirm before acknowledgement: PASS');

    // 1.3 Check upload-slip is rejected with 400 GUIDELINES_NOT_ACKNOWLEDGED
    console.log('Step 1.2 - Testing slip upload rejection before acknowledgement...');
    const uploadBeforeRes = await fetch(`http://127.0.0.1:${WORKER_PORT}/api/public/bookings/901/upload-slip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slip_image: slipBase64,
        contact: '0811111111'
      })
    });
    const uploadBeforeData = await uploadBeforeRes.json();
    console.log('Upload response status:', uploadBeforeRes.status, 'code:', uploadBeforeData.code);
    assert.strictEqual(uploadBeforeRes.status, 400, 'Must return HTTP 400');
    assert.strictEqual(uploadBeforeData.code, 'GUIDELINES_NOT_ACKNOWLEDGED', 'Must return GUIDELINES_NOT_ACKNOWLEDGED code');
    assert.ok(uploadBeforeData.error.includes('กรุณารับทราบข้อปฏิบัติการใช้ห้องประชุม'), 'Must contain guidance error message');
    results.case1.steps.push('Slip upload rejected before acknowledgement (400 GUIDELINES_NOT_ACKNOWLEDGED): PASS');

    // 1.4 In UI: Tick checkbox and click confirm acknowledgement
    console.log('Step 1.3 - Acknowledging guidelines in UI...');
    await cdp.evaluate(`
      const cb = document.getElementById('checkbox-acknowledge-guidelines');
      if (cb && !cb.checked) cb.click();
    `);
    await sleep(300);

    await cdp.evaluate(`
      const btn = document.getElementById('btn-confirm-acknowledge-guidelines');
      if (btn) btn.click();
    `);
    await sleep(2000);

    // 1.5 Verify QR is now unlocked and placeholder is gone
    const gatedGone = await cdp.evaluate(`!document.getElementById('gated-qr-placeholder')`);
    const ackBadgeFound = await cdp.waitForElement('#guidelines-acknowledged-badge', 4000);
    const qrImgFound = await cdp.evaluate(`Boolean(document.querySelector('img[alt*="Payment QR Code"]'))`);
    console.log('Step 1.4 - Gated placeholder gone:', gatedGone);
    console.log('Step 1.4 - Acknowledged badge visible:', ackBadgeFound);
    console.log('Step 1.4 - Official QR standee visible:', qrImgFound);
    assert.strictEqual(gatedGone && qrImgFound, true, 'Case 1: QR code must unlock after acknowledging guidelines');
    results.case1.steps.push('QR unlocked on /confirm after acknowledgement: PASS');

    // 1.6 Upload test slip - must now succeed with 200
    console.log('Step 1.5 - Testing slip upload after acknowledgement...');
    const uploadAfterRes = await fetch(`http://127.0.0.1:${WORKER_PORT}/api/public/bookings/901/upload-slip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slip_image: slipBase64,
        contact: '0811111111'
      })
    });
    const uploadAfterData = await uploadAfterRes.json();
    console.log('Upload response status:', uploadAfterRes.status, 'success:', uploadAfterData.success);
    assert.strictEqual(uploadAfterRes.status, 200, 'Must return HTTP 200');
    assert.strictEqual(uploadAfterData.success, true, 'Must succeed');
    results.case1.steps.push('Slip upload succeeded after acknowledgement (HTTP 200): PASS');
    results.case1.status = 'PASS';
    console.log('>>> CASE 1 RESULT: PASS\n');

    // =========================================================================
    // CASE 2: Pre-cutover legacy booking (created before cutover)
    // =========================================================================
    console.log('---------------------------------------------------------------');
    console.log('TEST CASE 2: Pre-cutover legacy booking (created 2026-11-08)');
    console.log('---------------------------------------------------------------');

    // 2.1 Navigate to /confirm for booking 902
    const confirmUrl2 = `http://localhost:${VITE_PORT}/confirm?id=902`;
    console.log('Navigating to:', confirmUrl2);
    await cdp.send('Page.navigate', { url: confirmUrl2 });
    await sleep(2500);

    // 2.2 Check that QR is unlocked immediately (no placeholder)
    const gatedPlaceholder2 = await cdp.evaluate(`Boolean(document.getElementById('gated-qr-placeholder'))`);
    const qrImg2 = await cdp.evaluate(`Boolean(document.querySelector('img[alt*="Payment QR Code"]'))`);
    console.log('Step 2.1 - Gated placeholder present:', gatedPlaceholder2);
    console.log('Step 2.1 - Official QR standee visible:', qrImg2);
    assert.strictEqual(gatedPlaceholder2, false, 'Legacy booking must not have locked placeholder');
    assert.strictEqual(qrImg2, true, 'Legacy booking must have QR visible directly');
    results.case2.steps.push('QR directly unlocked on /confirm without gate: PASS');

    // 2.3 Upload slip directly without acknowledgement
    console.log('Step 2.2 - Testing slip upload directly for legacy booking...');
    const uploadLegacyRes = await fetch(`http://127.0.0.1:${WORKER_PORT}/api/public/bookings/902/upload-slip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slip_image: slipBase64,
        contact: '0822222222'
      })
    });
    const uploadLegacyData = await uploadLegacyRes.json();
    console.log('Upload response status:', uploadLegacyRes.status, 'success:', uploadLegacyData.success);
    assert.strictEqual(uploadLegacyRes.status, 200, 'Legacy booking slip upload must return HTTP 200');
    assert.strictEqual(uploadLegacyData.success, true, 'Must succeed');
    results.case2.steps.push('Slip upload succeeded directly without acknowledgement: PASS');
    results.case2.status = 'PASS';
    console.log('>>> CASE 2 RESULT: PASS\n');

    // =========================================================================
    // CASE 3: Enforcement disabled (guidelines_enforcement_enabled = 'false')
    // =========================================================================
    console.log('---------------------------------------------------------------');
    console.log('TEST CASE 3: Enforcement toggle DISABLED (guidelines_enforcement_enabled = false)');
    console.log('---------------------------------------------------------------');

    // 3.1 Disable enforcement toggle in local D1
    console.log('Disabling guidelines_enforcement_enabled in local D1...');
    // We execute via wrangler d1 execute
    const { execSync } = require('child_process');
    execSync('npx.cmd wrangler d1 execute DB --local --command="UPDATE settings SET value = \'false\' WHERE key = \'guidelines_enforcement_enabled\';"', {
      cwd: path.resolve(__dirname, '../backend'),
      stdio: 'pipe'
    });
    await sleep(1000);

    // 3.2 Navigate to /confirm for booking 903
    const confirmUrl3 = `http://localhost:${VITE_PORT}/confirm?id=903`;
    console.log('Navigating to:', confirmUrl3);
    await cdp.send('Page.navigate', { url: confirmUrl3 });
    await sleep(2500);

    // 3.3 Check QR is directly unlocked
    const gatedPlaceholder3 = await cdp.evaluate(`Boolean(document.getElementById('gated-qr-placeholder'))`);
    const qrImg3 = await cdp.evaluate(`Boolean(document.querySelector('img[alt*="Payment QR Code"]'))`);
    console.log('Step 3.1 - Gated placeholder present:', gatedPlaceholder3);
    console.log('Step 3.1 - Official QR standee visible:', qrImg3);
    assert.strictEqual(gatedPlaceholder3, false, 'When enforcement is disabled, QR must not be locked');
    assert.strictEqual(qrImg3, true, 'When enforcement is disabled, QR must be visible directly');
    results.case3.steps.push('QR directly unlocked on /confirm with toggle OFF: PASS');

    // 3.4 Upload slip directly for new Room 201 booking
    console.log('Step 3.2 - Testing slip upload directly with toggle OFF...');
    const uploadDisabledRes = await fetch(`http://127.0.0.1:${WORKER_PORT}/api/public/bookings/903/upload-slip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slip_image: slipBase64,
        contact: '0833333333'
      })
    });
    const uploadDisabledData = await uploadDisabledRes.json();
    console.log('Upload response status:', uploadDisabledRes.status, 'success:', uploadDisabledData.success);
    assert.strictEqual(uploadDisabledRes.status, 200, 'When enforcement disabled, slip upload must return HTTP 200');
    assert.strictEqual(uploadDisabledData.success, true, 'Must succeed');
    results.case3.steps.push('Slip upload succeeded directly with toggle OFF: PASS');
    results.case3.status = 'PASS';
    console.log('>>> CASE 3 RESULT: PASS\n');

  } catch (err) {
    console.error('ERROR OCCURRED DURING TEST EXECUTION:', err);
    throw err;
  } finally {
    // Clean up Chrome
    try {
      cdp.ws.close();
      chromeProc.kill();
    } catch (_) {}

    // Print summary
    console.log('===============================================================');
    console.log('AUTOMATED TEST SUMMARY');
    console.log('===============================================================');
    console.log('Case 1 (Post-cutover Room 201 with enforcement ON):', results.case1.status);
    results.case1.steps.forEach(s => console.log('  -', s));
    console.log('Case 2 (Pre-cutover legacy booking):', results.case2.status);
    results.case2.steps.forEach(s => console.log('  -', s));
    console.log('Case 3 (Enforcement toggle OFF):', results.case3.status);
    results.case3.steps.forEach(s => console.log('  -', s));
    console.log('===============================================================');
  }
}

runTests().catch(err => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
