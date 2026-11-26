/**
 * BWORK-POS — DESKTOP (1280x800) & MOBILE (390x844) E2E SUITE: SINGLE-ROOM MASTER-DETAIL VIEW
 *
 * Covers all required cases:
 * 1. Calendar past-date thin cross (no "ผ่านมาแล้ว" ribbon) & modal without time filter
 * 2. Fitting room available (4-seat free for 4 guests)
 * 3. Fitting room full, larger room available (4-seat full -> opens 6-seat + 2-line notice)
 * 4. Exact capacity doesn't exist (5 guests -> opens 6-seat + "เริ่มที่ 6 ที่นั่ง" notice)
 * 5. No rooms available ("ไม่พบห้องว่างสำหรับ 4 คนในวันที่เลือก" + "เปลี่ยนวัน")
 * 6. Direct room full ("ห้องนี้ไม่มีช่วงว่างในวันที่เลือก" + switcher available)
 * 7. Switching rooms after selecting time (10:00-12:00):
 *    - Free target room: preserves 10:00-12:00, recalculates price, no scroll-to-top
 *    - Conflicting target room: clears time, shows "ห้องนี้ไม่ว่างในช่วงเดิม กรุณาเลือกเวลาใหม่"
 * 8. Captures Desktop & Mobile screenshots
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require(path.resolve(__dirname, '../backend/node_modules/express'));
const { spawn } = require('child_process');

const PORT = 5194;
const CDP_PORT = 9284;
const ARTIFACT_DIR = 'C:/Users/ADMIN/.gemini/antigravity/brain/93b1ef54-72e7-446f-a6a3-437743441774';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

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
  console.log('  BWORK SINGLE-ROOM MASTER-DETAIL E2E (DESKTOP + MOBILE)');
  console.log('================================================================\n');

  const app = express();
  app.use(express.json());
  const distDir = path.resolve(__dirname, '../booking-app/dist');
  app.use(express.static(distDir));

  let scenario = 'fitting_free'; // 'fitting_free' | 'fitting_full' | 'all_full'

  const mockRooms = [
    { id: 1, name: 'Mercury (201)', capacity: 4, has_hourly: 1, hourly_rate: 350, floor: '2' },
    { id: 2, name: 'Venus (302)', capacity: 6, has_hourly: 1, hourly_rate: 500, floor: '3' },
    { id: 3, name: 'Mars (301)', capacity: 8, has_hourly: 1, hourly_rate: 700, floor: '3' }
  ];

  app.get('/api/public/rooms', (req, res) => res.json(mockRooms));
  app.get('/api/public/rooms/availability-month', (req, res) => {
    res.json({ month: req.query.month, rooms: mockRooms, intervals: [], cleaning_buffer_minutes: 30 });
  });
  app.get('/api/public/rooms/schedule', (req, res) => {
    const d = req.query.date || '2026-11-27';
    const fullDay = [{ start_time: `${d} 08:00:00`, end_time: `${d} 18:00:00`, payment_status: 'paid' }];
    const conflict11 = [{ start_time: `${d} 11:00:00`, end_time: `${d} 11:30:00`, payment_status: 'paid' }];

    let r1 = [], r2 = [], r3 = conflict11;
    if (scenario === 'fitting_full') {
      r1 = fullDay;
      r2 = [];
      r3 = conflict11;
    } else if (scenario === 'all_full') {
      r1 = fullDay;
      r2 = fullDay;
      r3 = fullDay;
    }

    res.json({
      date: d,
      cleaning_buffer_minutes: 30,
      rooms: [
        { ...mockRooms[0], bookings: r1 },
        { ...mockRooms[1], bookings: r2 },
        { ...mockRooms[2], bookings: r3 }
      ]
    });
  });
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));

  const server = http.createServer(app);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));

  const userProfileDir = path.resolve(__dirname, '../scratch/chrome_test_profile');
  if (!fs.existsSync(userProfileDir)) fs.mkdirSync(userProfileDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userProfileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    'about:blank'
  ]);

  const client = new CDPClient(CDP_PORT);
  await client.connect();

  try {
    // =========================================================================
    // DESKTOP (1280 x 800)
    // =========================================================================
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    console.log('1. [Desktop] Calendar thin past-date cross & Modal without time filter...');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await new Promise(r => setTimeout(r, 900));

    const calCheck = await client.eval(`(async () => {
      const hasPastX = Boolean(document.querySelector('.customer-cal-day__past-x'));
      const hasOldRibbon = Boolean(document.querySelector('.customer-cal-day__diagonal-label')) || document.body.innerText.includes('ผ่านมาแล้ว');
      const btn27 = Array.from(document.querySelectorAll('button.customer-cal-day')).find(b => b.innerText.includes('27'));
      btn27?.click();
      await new Promise(r => setTimeout(r, 300));
      const hasTimeFilter = Boolean(document.getElementById('btn-expand-modal-time')) || Boolean(document.getElementById('select-modal-start-time'));
      return { hasPastX, hasOldRibbon, hasTimeFilter };
    })()`);
    console.log('  [RESULT]', JSON.stringify(calCheck));
    if (!calCheck.hasPastX || calCheck.hasOldRibbon || calCheck.hasTimeFilter) {
      throw new Error('Calendar/Modal check failed: ' + JSON.stringify(calCheck));
    }

    console.log('\n2. [Desktop] Fitting room available (4 guests -> opens Mercury 4-seat) + Room Switch time preservation & conflict...');
    scenario = 'fitting_free';
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=4` });
    await new Promise(r => setTimeout(r, 1000));

    // Set 10:00 - 12:00 on Mercury (id 1, 350/hr -> 700), then switch to Venus (id 2, free -> 1000), then Mars (id 3, conflict 11:00-11:30 -> cleared)
    const switchDesktop = await client.eval(`(async () => {
      const initialActive = Boolean(document.getElementById('single-room-view-1'));
      const hasCapNotice = Boolean(document.getElementById('room-capacity-notice'));

      // Pick 10:00 - 12:00 via dropdowns
      const sSel = document.getElementById('select-start-time-1');
      const eSel = document.getElementById('select-end-time-1');
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      nativeSet.call(sSel, '10:00');
      sSel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      nativeSet.call(eSel, '12:00');
      eSel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));

      const priceMercury = document.getElementById('active-room-summary-price')?.innerText?.trim();

      // Scroll down slightly to verify switching does NOT jump scrollY back to 0
      window.scrollTo(0, 260);
      await new Promise(r => setTimeout(r, 150));
      const scrollBefore = window.scrollY;

      // Switch to Venus (id 2, free 10:00-12:00, 500/hr -> 1,000)
      document.querySelector('[data-testid="desktop-switch-room-2"]')?.click();
      await new Promise(r => setTimeout(r, 300));
      const scrollAfter = window.scrollY;
      const venusTime = document.getElementById('active-room-summary-time')?.innerText?.trim();
      const venusPrice = document.getElementById('active-room-summary-price')?.innerText?.trim();
      const venusSwitchNotice = document.getElementById('room-switch-notice')?.innerText?.trim() || '';

      // Switch to Mars (id 3, booked 11:00-11:30 -> time must clear & show notice)
      document.querySelector('[data-testid="desktop-switch-room-3"]')?.click();
      await new Promise(r => setTimeout(r, 300));
      const marsTime = document.getElementById('active-room-summary-time')?.innerText?.trim();
      const marsSwitchNotice = document.getElementById('room-switch-notice')?.innerText?.trim() || '';

      return {
        initialActive,
        hasCapNotice,
        priceMercury,
        noScrollToTop: scrollAfter >= scrollBefore - 20,
        venusTime,
        venusPrice,
        venusSwitchNotice,
        marsTime,
        marsSwitchNotice
      };
    })()`);
    console.log('  [RESULT Desktop Switch]', JSON.stringify(switchDesktop));
    if (!switchDesktop.initialActive || switchDesktop.hasCapNotice || switchDesktop.priceMercury !== '฿700' || !switchDesktop.noScrollToTop || !switchDesktop.venusTime.includes('10:00–12:00') || switchDesktop.venusPrice !== '฿1,000' || switchDesktop.venusSwitchNotice !== '' || !switchDesktop.marsTime.includes('กรุณาเลือกช่วงเวลา') || !switchDesktop.marsSwitchNotice.includes('ห้องนี้ไม่ว่างในช่วงเดิม กรุณาเลือกเวลาใหม่')) {
      throw new Error('Desktop switch test failed: ' + JSON.stringify(switchDesktop));
    }

    // Switch back to Venus for a clean Desktop screenshot
    await client.eval(`document.querySelector('[data-testid="desktop-switch-room-2"]')?.click()`);
    await new Promise(r => setTimeout(r, 300));
    await client.captureScreenshot('desktop_1280_single_room_view.png');

    console.log('\n3. [Desktop] Fitting room FULL (4 guests, 4-seat full -> opens 6-seat + 2-line notice)...');
    scenario = 'fitting_full';
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=4` });
    await new Promise(r => setTimeout(r, 900));
    const fittingFull = await client.eval(`(() => ({
      activeIsVenus: Boolean(document.getElementById('single-room-view-2')),
      notice: document.getElementById('room-capacity-notice')?.innerText?.trim() || ''
    }))()`);
    console.log('  [RESULT Fitting Full]', JSON.stringify(fittingFull));
    if (!fittingFull.activeIsVenus || !fittingFull.notice.includes('ห้องขนาด 4 ที่นั่งเต็มแล้วสำหรับวันที่เลือก') || !fittingFull.notice.includes('ตอนนี้มีห้องขนาด 6 ที่นั่งให้จอง')) {
      throw new Error('Fitting full notice failed: ' + JSON.stringify(fittingFull));
    }

    console.log('\n4. [Desktop] Exact size does not exist (5 guests -> opens 6-seat + "เริ่มที่ 6 ที่นั่ง")...');
    scenario = 'fitting_free';
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=5` });
    await new Promise(r => setTimeout(r, 900));
    const exactMissing = await client.eval(`(() => ({
      activeIsVenus: Boolean(document.getElementById('single-room-view-2')),
      notice: document.getElementById('room-capacity-notice')?.innerText?.trim() || ''
    }))()`);
    console.log('  [RESULT No Exact Size]', JSON.stringify(exactMissing));
    if (!exactMissing.activeIsVenus || !exactMissing.notice.includes('ห้องที่รองรับ 5 คนและยังว่าง เริ่มที่ 6 ที่นั่ง')) {
      throw new Error('Exact size missing notice failed: ' + JSON.stringify(exactMissing));
    }

    console.log('\n5. [Desktop] No rooms available (all full -> "ไม่พบห้องว่างสำหรับ 4 คนในวันที่เลือก" + "เปลี่ยนวัน")...');
    scenario = 'all_full';
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=4` });
    await new Promise(r => setTimeout(r, 900));
    const allFull = await client.eval(`(() => ({
      text: document.getElementById('empty-rooms-for-date')?.innerText?.trim() || '',
      hasChangeDateBtn: Boolean(document.getElementById('btn-change-date-empty'))
    }))()`);
    console.log('  [RESULT All Full]', JSON.stringify(allFull));
    if (!allFull.text.includes('ไม่พบห้องว่างสำหรับ 4 คนในวันที่เลือก') || !allFull.hasChangeDateBtn) {
      throw new Error('All full empty state failed: ' + JSON.stringify(allFull));
    }

    console.log('\n6. [Desktop] Direct room mode with full room ("ห้องนี้ไม่มีช่วงว่างในวันที่เลือก")...');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=directRoom&date=2026-11-27&guests=4&roomId=1` });
    await new Promise(r => setTimeout(r, 900));
    const directFull = await client.eval(`(() => ({
      notice: document.getElementById('direct-room-full-notice')?.innerText?.trim() || '',
      hasSwitcher: Boolean(document.getElementById('desktop-room-switcher'))
    }))()`);
    console.log('  [RESULT Direct Full]', JSON.stringify(directFull));
    if (!directFull.notice.includes('ห้องนี้ไม่มีช่วงว่างในวันที่เลือก') || !directFull.hasSwitcher) {
      throw new Error('Direct room full check failed: ' + JSON.stringify(directFull));
    }

    // =========================================================================
    // MOBILE (390 x 844)
    // =========================================================================
    console.log('\n7. [Mobile 390x844] Testing "เปลี่ยนห้อง" button, switching room in place, & screenshot...');
    scenario = 'fitting_full';
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=4` });
    await new Promise(r => setTimeout(r, 1000));

    await client.captureScreenshot('mobile_390_single_room_view.png');

    const mobileSwitch = await client.eval(`(async () => {
      const btn = document.getElementById('btn-mobile-switch-room');
      const desktopHidden = window.getComputedStyle(document.getElementById('desktop-room-switcher')).display === 'none';
      btn?.click();
      await new Promise(r => setTimeout(r, 250));
      const listVisible = Boolean(document.getElementById('mobile-room-switcher-list'));
      document.querySelector('[data-testid="mobile-switch-room-3"]')?.click();
      await new Promise(r => setTimeout(r, 250));
      const listClosed = !document.getElementById('mobile-room-switcher-list');
      const activeIsMars = Boolean(document.getElementById('single-room-view-3'));
      return { desktopHidden, listVisible, listClosed, activeIsMars };
    })()`);
    console.log('  [RESULT Mobile Switch]', JSON.stringify(mobileSwitch));
    if (!mobileSwitch.desktopHidden || !mobileSwitch.listVisible || !mobileSwitch.listClosed || !mobileSwitch.activeIsMars) {
      throw new Error('Mobile switch check failed: ' + JSON.stringify(mobileSwitch));
    }

    console.log('\n================================================================');
    console.log('  ALL SINGLE-ROOM MASTER-DETAIL E2E CHECKS PASSED!');
    console.log('================================================================\n');
  } finally {
    client.close();
    chromeProc.kill();
    server.close();
  }
}

run().catch(err => {
  console.error('\n[FATAL] Single-Room E2E Failed:', err);
  process.exit(1);
});
