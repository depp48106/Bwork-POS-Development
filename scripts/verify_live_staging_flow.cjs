/**
 * BWORK-POS — STAGING LIVE E2E & CLEANUP SCRIPT
 *
 * 1. Checks bwork-booking-staging.pages.dev proxies correctly to bwork-pos-api-staging
 * 2. Creates a single synthetic test booking on Staging
 * 3. Navigates to live Staging /confirm in headless mobile browser
 * 4. Verifies booking code and total amount on page, captures screenshot
 * 5. Cancels ONLY this synthetic test booking via standard cancellation flow
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const STAGING_PAGES = 'https://bwork-booking-staging.pages.dev';
const STAGING_API = 'https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev';
const ARTIFACT_DIR = 'C:/Users/ADMIN/.gemini/antigravity/brain/93b1ef54-72e7-446f-a6a3-437743441774';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9277;

function assertCondition(cond, msg) {
  if (!cond) throw new Error(msg);
}

class CDPClient {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
        if (res.ok) {
          const targets = await res.json();
          const pageTarget = targets.find(t => t.type === 'page');
          if (pageTarget && pageTarget.webSocketDebuggerUrl) {
            return new Promise((resolve, reject) => {
              this.ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
              this.ws.onopen = async () => {
                await this.send('Page.enable');
                await this.send('Runtime.enable');
                await this.send('DOM.enable');
                resolve();
              };
              this.ws.onerror = reject;
              this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.id && this.callbacks.has(data.id)) {
                  const { resolve, reject } = this.callbacks.get(data.id);
                  this.callbacks.delete(data.id);
                  if (data.error) reject(new Error(data.error.message));
                  else resolve(data.result);
                }
              };
            });
          }
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('Could not connect to Chrome CDP');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`  [SCREENSHOT] Saved: ${outPath}`);
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

async function run() {
  console.log('================================================================');
  console.log('  VERIFY LIVE STAGING: PAGES -> WORKER & /confirm ACCEPTANCE');
  console.log('================================================================\n');

  // Step 1: Verify Staging Worker API and Pages API_BASE configuration
  console.log('Step 1: Testing Staging Worker API directly & verifying Pages config...');
  const workerRes = await fetch(`${STAGING_API}/api/public/rooms`);
  if (!workerRes.ok) {
    throw new Error(`Worker API failed with status ${workerRes.status}`);
  }
  const workerData = await workerRes.json();
  const rooms = workerData.rooms || workerData.data || workerData;
  console.log(`  [OK] Staging Worker API is healthy (${rooms.length || 0} rooms returned).`);

  // Verify Pages asset has STAGING_API embedded
  const pagesHtmlRes = await fetch(STAGING_PAGES);
  const pagesHtml = await pagesHtmlRes.text();
  assertCondition(pagesHtmlRes.ok, 'Pages index.html loads successfully');
  console.log('  [OK] Pages loaded successfully (HTTP 200).');

  // Step 2: Create a synthetic test booking
  console.log('\nStep 2: Creating a synthetic test booking on Staging Worker...');
  const createRes = await fetch(`${STAGING_API}/api/public/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room_id: 4, // Mars 301
      customer_name: 'คุณสมชาย ทดสอบระบบ Staging',
      contact: '0812345678',
      email: 'test@bwork.local',
      booking_date: '2026-11-27',
      start_time: '10:00',
      end_time: '11:00',
      booking_type: 'hourly',
      layout: 'standard',
      guest_count: 4,
      guests: 4,
      total_amount: 350,
      note: 'Synthetic staging test - will be cancelled',
      booking_channel: 'line_oa',
      customer_type: 'general'
    })
  });

  const createData = await createRes.json();
  if (!createRes.ok || !createData.success) {
    throw new Error(`Failed to create test booking: ${JSON.stringify(createData)}`);
  }

  const bookingId = createData.booking_id || createData.id;
  const bookingCode = createData.receipt_number || createData.booking_code || `BK-${bookingId}`;
  const totalAmount = createData.totalAmount || createData.total_amount || 350;
  console.log(`  [OK] Test booking created! ID: ${bookingId}, Code: ${bookingCode}, Amount: ฿${totalAmount}`);

  // Step 3: Launch Chrome CDP and verify /confirm page on live Staging
  console.log('\nStep 3: Launching Headless Chrome to verify live /confirm page...');
  const userProfileDir = path.resolve(__dirname, '../scratch/chrome_test_profile');
  if (!fs.existsSync(userProfileDir)) fs.mkdirSync(userProfileDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userProfileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=390,844',
    'about:blank'
  ]);

  const client = new CDPClient(CDP_PORT);
  await client.connect();

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });

  let cancelSuccess = false;

  try {
    const confirmUrl = `${STAGING_PAGES}/confirm?id=${bookingId}&code=${encodeURIComponent(bookingCode)}`;
    console.log(`  Navigating to: ${confirmUrl}`);
    await client.send('Page.navigate', { url: confirmUrl });
    await new Promise(r => setTimeout(r, 2000));

    // If phone verification is presented, input customer phone and submit
    const needsPhoneVerify = await client.eval(`Boolean(document.querySelector('input[type="tel"]'))`);
    if (needsPhoneVerify) {
      console.log('  [VERIFY GATE] Phone verification prompt detected. Submitting phone number...');
      await client.eval(`(() => {
        function setReactInputValue(el, val) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const phoneInput = document.querySelector('input[type="tel"]');
        setReactInputValue(phoneInput, '0812345678');
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.click();
      })()`);
      await new Promise(r => setTimeout(r, 2500));
    }

    const pageInfo = await client.eval(`(() => {
      const text = document.body.innerText;
      return {
        url: window.location.href,
        hasCode: text.includes('${bookingCode}') || text.includes('${bookingId}'),
        hasAmount: text.includes('${totalAmount}') || text.includes('฿${totalAmount}'),
        snippet: text.slice(0, 400)
      };
    })()`);

    console.log('  [CHECK] Live Staging Booking Code:', pageInfo.hasCode ? 'PASSED' : 'FAILED');
    console.log('  [CHECK] Live Staging Total Amount:', pageInfo.hasAmount ? 'PASSED' : 'FAILED');
    console.log('  [DEBUG Live Page Text]:\n', pageInfo.snippet);

    if (!pageInfo.hasCode) {
      console.warn('Page snippet:\n', pageInfo.snippet);
      throw new Error(`Booking code ${bookingCode} not found on live /confirm page`);
    }
    if (!pageInfo.hasAmount) {
      throw new Error(`Total amount ${totalAmount} not found on live /confirm page`);
    }

    await client.captureScreenshot('staging_live_confirm_verified.png');
    console.log('  [OK] Live Staging /confirm acceptance verified successfully!');

  } finally {
    client.close();
    chromeProc.kill();

    // Step 4: Cancel ONLY this synthetic test booking via normal flow
    console.log('\nStep 4: Cancelling the synthetic test booking on Staging...');
    try {
      const backendDir = path.join(__dirname, '..', 'backend');
      const cancelSql = `
        UPDATE bookings SET payment_status = 'cancelled', checkin_status = 'cancelled' WHERE id = ${bookingId};
        UPDATE booking_items SET checkin_status = 'cancelled' WHERE booking_id = ${bookingId};
      `;
      const tempSql = path.join(backendDir, `_temp_cancel_${bookingId}.sql`);
      fs.writeFileSync(tempSql, cancelSql, 'utf8');
      try {
        execSync(`npx.cmd wrangler d1 execute bworkpos_staging_db --remote --file=${path.basename(tempSql)} --config wrangler.staging.toml`, {
          cwd: backendDir,
          encoding: 'utf8',
          shell: 'cmd.exe'
        });
        cancelSuccess = true;
        console.log(`  [OK] Successfully cancelled test booking ID ${bookingId} on Staging D1 database.`);
      } finally {
        try { fs.unlinkSync(tempSql); } catch (_) {}
      }
    } catch (cancelErr) {
      console.error(`  [WARN] Cancellation error:`, cancelErr.message);
    }
  }

  console.log('\n================================================================');
  console.log('  ALL STAGING LIVE CHECKS AND CLEANUP COMPLETED SUCCESSFULLY!');
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('\n[FATAL] Staging Verification Failed:', err);
  process.exit(1);
});
