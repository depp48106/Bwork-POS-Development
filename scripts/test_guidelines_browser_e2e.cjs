/**
 * scripts/test_guidelines_browser_e2e.cjs
 * Automated Browser E2E Test Suite for Room Guidelines Acknowledgement Gate
 * 
 * Verifies via Headless Chrome (CDP):
 * 1. Switching Room 201 to 302 while 201 is in-flight: Room 302 remains strictly locked.
 * 2. Concurrently confirming in two tabs: LINE dispatched exactly once; neither tab blocked.
 * 3. Takes visual screenshot artifacts.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require(path.resolve(__dirname, '../backend/node_modules/express'));
const assert = require('assert/strict');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR = 'C:/Users/ADMIN/.gemini/antigravity/brain/93b1ef54-72e7-446f-a6a3-437743441774';
const PORT = 5188;
const CDP_PORT = 9228;

async function runBrowserE2E() {
  console.log('--- Starting Browser E2E Test Suite for Room Guidelines Gate ---');

  // State for mock API
  let lineDispatchCallCount = 0;
  let acknowledgedBookings = new Set();
  let delayAck101Ms = 1200;

  // 1. Setup local express server serving booking-app/dist and mock public APIs
  const app = express();
  app.use(express.json());

  // Mock API: GET /api/public/bookings/:id
  app.get('/api/public/bookings/:id', (req, res) => {
    const id = req.params.id;
    const isAck = acknowledgedBookings.has(String(id));

    const nowIso = new Date().toISOString();
    const deadlineIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const todayStr = nowIso.split('T')[0];

    if (id === '101') {
      return res.json({
        id: 101,
        booking_code: 'BK-000101',
        customer_name: 'Test Customer 101',
        contact: '0811111111',
        room: { id: 11, name: 'ห้องประชุม 201 (Pluto)', capacity: 12 },
        total_amount: 1200,
        payment_status: 'pending',
        created_at: nowIso,
        payment_deadline: deadlineIso,
        date: todayStr,
        start_time: '13:00',
        end_time: '14:00',
        guidelines_enforcement_enabled: true,
        guidelines_enforced: true,
        guidelines_acknowledged: isAck,
        guidelines_acknowledged_at: isAck ? new Date().toISOString() : null,
        guidelines_required: true,
        guidelines_rule_set: 'meeting_room_201_306',
        guidelines_rule_version: 'v1'
      });
    }

    if (id === '102') {
      return res.json({
        id: 102,
        booking_code: 'BK-000102',
        customer_name: 'Test Customer 102',
        contact: '0822222222',
        room: { id: 5, name: 'ห้องประชุม 302 (Mercury)', capacity: 8 },
        total_amount: 800,
        payment_status: 'pending',
        created_at: nowIso,
        payment_deadline: deadlineIso,
        date: todayStr,
        start_time: '14:00',
        end_time: '15:00',
        guidelines_enforcement_enabled: true,
        guidelines_enforced: true,
        guidelines_acknowledged: isAck,
        guidelines_acknowledged_at: isAck ? new Date().toISOString() : null,
        guidelines_required: true,
        guidelines_rule_set: 'meeting_room_201_306',
        guidelines_rule_version: 'v1'
      });
    }

    if (id === '201') {
      return res.json({
        id: 201,
        booking_code: 'BK-000201',
        customer_name: 'Concurrent Customer',
        contact: '0833333333',
        room: { id: 4, name: 'ห้องประชุม 301 (Mars)', capacity: 8 },
        total_amount: 800,
        payment_status: 'pending',
        created_at: nowIso,
        payment_deadline: deadlineIso,
        date: todayStr,
        start_time: '15:00',
        end_time: '16:00',
        guidelines_enforcement_enabled: true,
        guidelines_enforced: true,
        guidelines_acknowledged: isAck,
        guidelines_acknowledged_at: isAck ? new Date().toISOString() : null,
        guidelines_required: true,
        guidelines_rule_set: 'meeting_room_201_306',
        guidelines_rule_version: 'v1'
      });
    }

    res.status(404).json({ error: 'Not found' });
  });

  // Mock API: POST /api/public/bookings/:id/acknowledge-rules
  app.post('/api/public/bookings/:id/acknowledge-rules', async (req, res) => {
    const id = req.params.id;
    const { rule_set, rule_version } = req.body || {};

    if (!rule_set || !rule_version) {
      return res.status(400).json({ error: 'Missing rule_set or rule_version' });
    }

    // Add artificial delay for booking 101 to allow tab switching race
    if (id === '101' && delayAck101Ms > 0) {
      await new Promise(r => setTimeout(r, delayAck101Ms));
    }

    const wasAck = acknowledgedBookings.has(String(id));
    acknowledgedBookings.add(String(id));

    let lineStatus = 'pending';
    if (!wasAck) {
      lineDispatchCallCount++;
      lineStatus = 'pending';
    } else {
      lineStatus = 'already_sent';
    }

    return res.json({
      success: true,
      acknowledged: true,
      required: true,
      rule_set,
      rule_version,
      acknowledged_at: new Date().toISOString(),
      line_notification: {
        status: lineStatus,
        deduplicated: wasAck
      }
    });
  });

  // Serve static assets from booking-app/dist
  const distPath = path.resolve(__dirname, '../booking-app/dist');
  app.use(express.static(distPath));

  // SPA fallback to dist/index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  const server = app.listen(PORT, '127.0.0.1');
  console.log(`Test server running at http://127.0.0.1:${PORT}`);

  // 2. Launch Headless Chrome
  const tempProfile = path.join(ARTIFACT_DIR, 'scratch', 'chrome_guidelines_e2e_profile');
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(tempProfile, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    '--window-size=390,844', // iPhone 12/13 mobile viewport
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  // Connect CDP
  async function connectCdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
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

    async function waitForElement(id, timeoutMs = 6000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = await evaluate(`Boolean(document.getElementById('${id}'))`);
        if (found) return true;
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    }

    return { ws, send, evaluate, waitForElement };
  }

  const pages = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const page1 = pages.find(p => p.type === 'page');
  const cdp1 = await connectCdp(page1.webSocketDebuggerUrl);

  try {
    // ========================================================
    // TEST 1: Switch Room 201 to 302 while 201 is in flight
    // ========================================================
    console.log('\n[E2E-01] Testing tab switch from Room 201 to 302 while 201 acknowledgement is in flight...');

    // 1. Navigate to Room 201 confirmation page
    await cdp1.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/confirm?id=101` });
    await new Promise(r => setTimeout(r, 2000));
    const debugHtml = await cdp1.evaluate(`document.body.innerText`);
    console.log('[DEBUG] Page innerText:', debugHtml ? debugHtml.slice(0, 300) : 'EMPTY');
    const gate101Found = await cdp1.waitForElement('guidelines-gate-card', 6000);
    assert.strictEqual(gate101Found, true, 'Room 201 must show guidelines gate card initially');

    // Tick checkbox
    await cdp1.evaluate(`
      const cb = document.getElementById('checkbox-acknowledge-guidelines');
      if (cb && !cb.checked) cb.click();
    `);
    await new Promise(r => setTimeout(r, 200));

    // Click confirm button (starts in-flight delayed POST /101/acknowledge-rules)
    console.log('[E2E-01] Submitting acknowledgement for Room 201 (in-flight delay: 1200ms)...');
    await cdp1.evaluate(`
      const btn = document.getElementById('btn-confirm-acknowledge-guidelines');
      if (btn) btn.click();
    `);

    // Immediately navigate / switch to Room 302 while 101 request is pending!
    console.log('[E2E-01] Immediately switching URL to Room 302 while 201 is still in flight...');
    await cdp1.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/confirm?id=102` });

    // Wait 1600ms (longer than the 1200ms 101 delay) so 101 response returns while on 302
    await new Promise(r => setTimeout(r, 1600));

    // Check Room 302 state: Room 302 MUST REMAIN LOCKED!
    const evalGate102 = await cdp1.evaluate(`
      ({
        hasGateCard: Boolean(document.getElementById('guidelines-gate-card')),
        hasAckBadge: Boolean(document.getElementById('guidelines-acknowledged-badge')),
        hasPlaceholder: Boolean(document.getElementById('gated-qr-placeholder')),
        hasQrImage: Boolean(document.querySelector('img[alt="B WORK Payment QR Code"]'))
      })
    `);

    console.log('[E2E-01] Room 302 state after Room 201 response returned:', evalGate102);
    assert.strictEqual(evalGate102.hasGateCard, true, 'Room 302 must remain locked with gate card visible!');
    assert.strictEqual(evalGate102.hasAckBadge, false, 'Room 302 must NOT have acknowledged badge!');
    assert.strictEqual(evalGate102.hasPlaceholder, true, 'Room 302 QR placeholder must be visible!');
    assert.strictEqual(evalGate102.hasQrImage, false, 'Room 302 QR image must remain hidden!');

    // Capture screenshot of Room 302 staying locked
    const ss1 = await cdp1.send('Page.captureScreenshot', { format: 'png' });
    const ss1Path = path.join(ARTIFACT_DIR, 'e2e_01_switch_room_lock_preserved.png');
    fs.writeFileSync(ss1Path, Buffer.from(ss1.data, 'base64'));
    console.log(`[E2E-01] Saved visual screenshot: ${ss1Path}`);

    // Now acknowledge Room 302 explicitly
    console.log('[E2E-01] Now acknowledging Room 302 with its own policy...');
    await cdp1.evaluate(`
      const cb = document.getElementById('checkbox-acknowledge-guidelines');
      if (cb && !cb.checked) cb.click();
    `);
    await new Promise(r => setTimeout(r, 200));

    await cdp1.evaluate(`
      const btn = document.getElementById('btn-confirm-acknowledge-guidelines');
      if (btn) btn.click();
    `);
    
    await cdp1.waitForElement('guidelines-acknowledged-badge', 6000);

    const evalUnlocked102 = await cdp1.evaluate(`
      ({
        hasGateCard: Boolean(document.getElementById('guidelines-gate-card')),
        hasAckBadge: Boolean(document.getElementById('guidelines-acknowledged-badge')),
        hasPlaceholder: Boolean(document.getElementById('gated-qr-placeholder')),
        hasQrImage: Boolean(document.querySelector('img[alt="B WORK Payment QR Code"]'))
      })
    `);
    console.log('[E2E-01] Room 302 state after explicit acknowledgement:', evalUnlocked102);
    assert.strictEqual(evalUnlocked102.hasGateCard, false, 'Gate card removed');
    assert.strictEqual(evalUnlocked102.hasAckBadge, true, 'Acknowledged badge displayed');
    assert.strictEqual(evalUnlocked102.hasPlaceholder, false, 'Gated QR placeholder removed');
    assert.strictEqual(evalUnlocked102.hasQrImage, true, 'Payment QR image unlocked and visible');
    console.log('✔ [E2E-01] PASSED: In-flight race dropped cleanly; Room 302 stayed locked until acknowledged!');

    // ========================================================
    // TEST 2: Concurrently confirm in two tabs
    // ========================================================
    console.log('\n[E2E-02] Testing concurrent confirmation in two tabs for booking 201...');
    lineDispatchCallCount = 0; // reset counter

    // Create 2nd browser tab via CDP
    const newTarget = await new Promise((resolve, reject) => {
      const req = http.request(`http://localhost:${CDP_PORT}/json/new?http://127.0.0.1:${PORT}/confirm?id=201`, { method: 'PUT' }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.end();
    });

    const cdp2 = await connectCdp(newTarget.webSocketDebuggerUrl);

    // Tab 1 navigates to booking 201 as well
    await cdp1.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/confirm?id=201` });
    
    await Promise.all([
      cdp1.waitForElement('guidelines-gate-card', 6000),
      cdp2.waitForElement('guidelines-gate-card', 6000)
    ]);

    // Tick checkbox in both tabs
    await Promise.all([
      cdp1.evaluate(`document.getElementById('checkbox-acknowledge-guidelines')?.click()`),
      cdp2.evaluate(`document.getElementById('checkbox-acknowledge-guidelines')?.click()`)
    ]);
    await new Promise(r => setTimeout(r, 200));

    // Click confirm in both tabs simultaneously
    console.log('[E2E-02] Clicking confirm simultaneously in Tab 1 and Tab 2...');
    await Promise.all([
      cdp1.evaluate(`document.getElementById('btn-confirm-acknowledge-guidelines')?.click()`),
      cdp2.evaluate(`document.getElementById('btn-confirm-acknowledge-guidelines')?.click()`)
    ]);

    await Promise.all([
      cdp1.waitForElement('guidelines-acknowledged-badge', 6000),
      cdp2.waitForElement('guidelines-acknowledged-badge', 6000)
    ]);

    // Both tabs must be unlocked immediately without blocking
    const [evalTab1, evalTab2] = await Promise.all([
      cdp1.evaluate(`({ hasAckBadge: Boolean(document.getElementById('guidelines-acknowledged-badge')), hasQrImage: Boolean(document.querySelector('img[alt="B WORK Payment QR Code"]')) })`),
      cdp2.evaluate(`({ hasAckBadge: Boolean(document.getElementById('guidelines-acknowledged-badge')), hasQrImage: Boolean(document.querySelector('img[alt="B WORK Payment QR Code"]')) })`)
    ]);

    console.log('[E2E-02] Tab 1 result:', evalTab1);
    console.log('[E2E-02] Tab 2 result:', evalTab2);
    assert.strictEqual(evalTab1.hasAckBadge, true, 'Tab 1 unlocked');
    assert.strictEqual(evalTab1.hasQrImage, true, 'Tab 1 QR image visible');
    assert.strictEqual(evalTab2.hasAckBadge, true, 'Tab 2 unlocked');
    assert.strictEqual(evalTab2.hasQrImage, true, 'Tab 2 QR image visible');

    // Verify LINE dispatch was triggered exactly once
    console.log(`[E2E-02] LINE dispatch mock call count: ${lineDispatchCallCount}`);
    assert.strictEqual(lineDispatchCallCount, 1, 'LINE dispatch must be invoked exactly once across concurrent tabs');

    // Capture screenshot of unlocked QR
    const ss2 = await cdp1.send('Page.captureScreenshot', { format: 'png' });
    const ss2Path = path.join(ARTIFACT_DIR, 'e2e_02_concurrent_confirm_qr_unlocked.png');
    fs.writeFileSync(ss2Path, Buffer.from(ss2.data, 'base64'));
    console.log(`[E2E-02] Saved visual screenshot: ${ss2Path}`);

    console.log('✔ [E2E-02] PASSED: Concurrent confirmation succeeded, exactly 1 LINE dispatch, QR displayed without blocking!');

    cdp2.ws.close();
  } finally {
    cdp1.ws.close();
    chromeProc.kill();
    server.close();
    try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n--- ALL BROWSER E2E TESTS PASSED SUCCESSFULLY! ---');
}

runBrowserE2E().catch(err => {
  console.error('\n❌ BROWSER E2E TEST FAILED:', err);
  process.exit(1);
});
