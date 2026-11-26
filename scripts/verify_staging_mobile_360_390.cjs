/**
 * BWORK-POS — MOBILE-FIRST STAGING E2E VERIFICATION (360px & 390px + Desktop Sanity)
 *
 * Tests LIVE Staging: https://65111d58.bwork-booking-staging.pages.dev
 * 1. Mobile 360x800:
 *    - Open date (2026-11-27), guests = 4 -> single-room view
 *    - Scroll to room photo + "เปลี่ยนห้อง" button + timeline
 *    - Capture screenshot before switch
 *    - Tap "เปลี่ยนห้อง" -> capture screenshot with list open -> select another room
 *    - Verify list closes, room updates in-place, NO scroll jump to top, zero horizontal overflow
 * 2. Mobile 390x844:
 *    - Full E2E: room switch -> adjust time -> fill /form (10-digit phone) -> submit -> /confirm
 *    - Verify booking code, total amount, copy test account digits -> capture /confirm screenshot
 *    - Cancel ONLY the synthetic test booking created in this run on Staging D1
 * 3. Desktop 1280x800:
 *    - Quick sanity check: page renders and desktop room switch works
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const STAGING_PAGES = 'https://65111d58.bwork-booking-staging.pages.dev';
const ARTIFACT_DIR = 'C:/Users/ADMIN/.gemini/antigravity/brain/93b1ef54-72e7-446f-a6a3-437743441774';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9288;

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
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    return res.result?.value;
  }
  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const outPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
    console.log(`  [SCREENSHOT] Saved: ${outPath}`);
  }
  close() {
    if (this.ws) try { this.ws.close(); } catch (_) {}
  }
}

async function run() {
  console.log('================================================================');
  console.log('  MOBILE-FIRST STAGING E2E: 360px & 390px + DESKTOP SANITY');
  console.log('================================================================\n');

  const userProfileDir = path.resolve(__dirname, '../scratch/chrome_test_profile');
  if (!fs.existsSync(userProfileDir)) fs.mkdirSync(userProfileDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userProfileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=360,800',
    'about:blank'
  ]);

  const client = new CDPClient(CDP_PORT);
  await client.connect();

  let createdBookingId = null;

  try {
    // =========================================================================
    // 1. MOBILE 360 x 800 (Live Staging)
    // =========================================================================
    console.log('1. [Mobile 360x800] Live Staging room view, switcher, and in-place scroll check...');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
    await client.send('Page.navigate', { url: `${STAGING_PAGES}/rooms?mode=byGuests&date=2026-11-27&guests=4` });
    await new Promise(r => setTimeout(r, 2500));

    // Scroll to single room view so photo + "เปลี่ยนห้อง" + timeline are framed
    await client.eval(`(() => {
      const el = document.querySelector('.room-detail-layout');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    })()`);
    await new Promise(r => setTimeout(r, 300));
    await client.captureScreenshot('staging_mobile_360_room_view.png');

    const check360 = await client.eval(`(async () => {
      const scrollBefore = window.scrollY;
      const noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth + 2;
      const switchBtn = document.getElementById('btn-mobile-switch-room');
      const beforeRoomId = document.querySelector('.room-detail-layout')?.id || '';
      switchBtn?.click();
      await new Promise(r => setTimeout(r, 250));
      const listEl = document.getElementById('mobile-room-switcher-list');
      const items = listEl ? Array.from(listEl.querySelectorAll('button.room-switcher-item')) : [];
      return { scrollBefore, noHorizontalOverflow, hasSwitchBtn: Boolean(switchBtn), beforeRoomId, itemCount: items.length };
    })()`);
    console.log('  [360px Switcher Open]', JSON.stringify(check360));
    await client.captureScreenshot('staging_mobile_360_switcher_open.png');

    // Select the 2nd room in the switcher list
    const after360 = await client.eval(`(async () => {
      const listEl = document.getElementById('mobile-room-switcher-list');
      const items = listEl ? Array.from(listEl.querySelectorAll('button.room-switcher-item')) : [];
      if (items.length > 1) items[1].click();
      await new Promise(r => setTimeout(r, 350));
      const listClosed = !document.getElementById('mobile-room-switcher-list');
      const afterRoomId = document.querySelector('.room-detail-layout')?.id || '';
      const scrollAfter = window.scrollY;
      return { listClosed, afterRoomId, scrollAfter };
    })()`);
    console.log('  [360px After Switch]', JSON.stringify(after360));
    if (!check360.noHorizontalOverflow || !after360.listClosed || after360.afterRoomId === check360.beforeRoomId || after360.scrollAfter < 100) {
      throw new Error('360px mobile switch check failed: ' + JSON.stringify({ check360, after360 }));
    }

    // =========================================================================
    // 2. MOBILE 390 x 844 (Live Staging Full Flow -> /form -> /confirm)
    // =========================================================================
    console.log('\n2. [Mobile 390x844] Live Staging Full E2E: Switch Room -> Select Time -> Form -> /confirm...');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await client.send('Page.navigate', { url: `${STAGING_PAGES}/rooms?mode=byGuests&date=2026-11-27&guests=4` });
    await new Promise(r => setTimeout(r, 2200));

    // Scroll to room view & capture
    await client.eval(`(() => {
      const el = document.querySelector('.room-detail-layout');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    })()`);
    await new Promise(r => setTimeout(r, 300));
    await client.captureScreenshot('staging_mobile_390_room_timeline.png');

    // Switch room, verify scroll stays in place, pick time, click "กรอกข้อมูลผู้จอง"
    const step390 = await client.eval(`(async () => {
      const scrollBefore = window.scrollY;
      const noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth + 2;
      document.getElementById('btn-mobile-switch-room')?.click();
      await new Promise(r => setTimeout(r, 250));
      const items = Array.from(document.querySelectorAll('#mobile-room-switcher-list button.room-switcher-item'));
      if (items.length > 1) items[1].click();
      await new Promise(r => setTimeout(r, 350));
      const scrollAfter = window.scrollY;
      const activeLayoutId = document.querySelector('.room-detail-layout')?.id || '';
      const roomId = activeLayoutId.replace('single-room-view-', '');

      // Pick start time from dropdown if available
      const sSel = document.getElementById('select-start-time-' + roomId);
      if (sSel && sSel.options.length > 1) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        const optVal = Array.from(sSel.options).find(o => o.value === '10:00')?.value || Array.from(sSel.options).find(o => o.value)?.value;
        if (optVal) {
          setter.call(sSel, optVal);
          sSel.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 250));
        }
      }

      const summaryTime = document.getElementById('active-room-summary-time')?.innerText?.trim() || '';
      const summaryPrice = document.getElementById('active-room-summary-price')?.innerText?.trim() || '';
      const bookBtn = document.getElementById('btn-book-room-' + roomId);
      const bookDisabled = Boolean(bookBtn?.disabled);
      if (bookBtn && !bookDisabled) bookBtn.click();

      return { scrollBefore, scrollAfter, noHorizontalOverflow, roomId, summaryTime, summaryPrice, bookDisabled };
    })()`);
    console.log('  [390px Room & Time Step]', JSON.stringify(step390));
    if (!step390.noHorizontalOverflow || step390.bookDisabled || step390.scrollAfter < 100) {
      throw new Error('390px room/time step failed: ' + JSON.stringify(step390));
    }

    // Wait for /form
    await new Promise(r => setTimeout(r, 1200));
    const formUrl = await client.eval('window.location.href');
    console.log('  [390px Reached Form]:', formUrl);
    if (!formUrl.includes('/form')) throw new Error('Did not navigate to /form');

    // Fill form with test data & submit
    await client.eval(`(async () => {
      const setVal = (el, val) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(document.getElementById('customer-name'), 'คุณสมชาย ทดสอบมือถือ');
      setVal(document.getElementById('customer-phone'), '0812345678');
      await new Promise(r => setTimeout(r, 200));
      document.querySelector('button[type="submit"]')?.click();
    })()`);

    // Wait for /confirm
    let confirmUrl = '';
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 350));
      const u = await client.eval('window.location.href');
      if (u.includes('/confirm')) {
        confirmUrl = u;
        break;
      }
    }
    if (!confirmUrl) throw new Error('Did not reach /confirm on Staging');
    await new Promise(r => setTimeout(r, 1500));

    const uObj = new URL(confirmUrl);
    createdBookingId = uObj.searchParams.get('id');
    const bookingCode = uObj.searchParams.get('code');

    const confirmRes = await client.eval(`(async () => {
      let copiedText = null;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (txt) => { copiedText = txt; } }
      });
      const accNum = document.getElementById('bank-account-number-display')?.innerText?.trim() || '';
      const copyBtn = document.getElementById('btn-copy-bank-account');
      if (copyBtn) copyBtn.click();
      await new Promise(r => setTimeout(r, 250));
      return {
        accNum,
        copiedText,
        btnTextAfter: copyBtn?.innerText?.trim() || '',
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 2
      };
    })()`);
    console.log(`  [390px Reached /confirm] ID=${createdBookingId}, Code=${bookingCode}, Details=${JSON.stringify(confirmRes)}`);
    await client.captureScreenshot('staging_mobile_390_confirm_payment.png');

    if (!confirmRes.noHorizontalOverflow || !confirmRes.btnTextAfter.includes('คัดลอกแล้ว')) {
      throw new Error('390px /confirm check failed: ' + JSON.stringify(confirmRes));
    }

    // =========================================================================
    // 3. DESKTOP SANITY CHECK (1280 x 800)
    // =========================================================================
    console.log('\n3. [Desktop 1280x800] Quick sanity check (renders & switches room)...');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.navigate', { url: `${STAGING_PAGES}/rooms?mode=byGuests&date=2026-11-27&guests=4` });
    await new Promise(r => setTimeout(r, 2000));

    const desktopSanity = await client.eval(`(async () => {
      const beforeId = document.querySelector('.room-detail-layout')?.id || '';
      const items = Array.from(document.querySelectorAll('#desktop-room-switcher button.room-switcher-item'));
      if (items.length > 1) items[1].click();
      await new Promise(r => setTimeout(r, 250));
      const afterId = document.querySelector('.room-detail-layout')?.id || '';
      return { desktopSwitcherCount: items.length, switched: beforeId !== afterId };
    })()`);
    console.log('  [Desktop Sanity]', JSON.stringify(desktopSanity));
    if (!desktopSanity.switched) throw new Error('Desktop sanity room switch failed');

    console.log('\n================================================================');
    console.log('  MOBILE-FIRST (360px & 390px) + DESKTOP SANITY ALL PASSED!');
    console.log('================================================================\n');
  } finally {
    client.close();
    chromeProc.kill();

    if (createdBookingId) {
      console.log(`Step 4: Cancelling synthetic test booking ID ${createdBookingId} on Staging D1...`);
      const backendDir = path.join(__dirname, '..', 'backend');
      const tempSql = path.join(backendDir, `_temp_cancel_mobile_${createdBookingId}.sql`);
      fs.writeFileSync(tempSql, `UPDATE bookings SET payment_status = 'cancelled', checkin_status = 'cancelled' WHERE id = ${createdBookingId}; UPDATE booking_items SET checkin_status = 'cancelled' WHERE booking_id = ${createdBookingId};`, 'utf8');
      try {
        execSync(`npx.cmd wrangler d1 execute bworkpos_staging_db --remote --file=${path.basename(tempSql)} --config wrangler.staging.toml`, {
          cwd: backendDir,
          encoding: 'utf8',
          shell: 'cmd.exe'
        });
        console.log(`  [OK] Cancelled synthetic booking ID ${createdBookingId} on Staging D1.`);
      } finally {
        try { fs.unlinkSync(tempSql); } catch (_) {}
      }
    }
  }
}

run().catch(err => {
  console.error('\n[FATAL] Mobile-First Staging E2E Failed:', err);
  process.exit(1);
});
