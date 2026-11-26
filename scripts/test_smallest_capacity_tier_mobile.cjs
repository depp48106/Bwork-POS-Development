/**
 * BWORK-POS — MOBILE 360px & 390px E2E TEST: SMALLEST AVAILABLE CAPACITY TIER
 *
 * Verifies all 4 required cases at BOTH 360x800 and 390x844:
 * 1. Search 3 guests, 4-seat rooms available -> opens 4-seat room, switcher lists ONLY 4-seat rooms (Jupiter NOT shown)
 * 2. Search 3 guests, all 4-seat rooms full, 6-seat rooms available -> opens 6-seat room, switcher lists ONLY 6-seat rooms (Jupiter NOT shown) + shows 2-line notice
 * 3. Search 3 guests, all rooms full -> shows "ไม่พบห้องว่างสำหรับ 3 คนในวันที่เลือก" + "เปลี่ยนวัน"
 * 4. Direct room mode selecting Jupiter (300) -> opens Jupiter directly
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require(path.resolve(__dirname, '../backend/node_modules/express'));
const { spawn } = require('child_process');

const PORT = 5196;
const CDP_PORT = 9293;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

class CDPClient {
  constructor(port) { this.port = port; this.ws = null; this.msgId = 1; this.callbacks = new Map(); }
  async connect() {
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
        if (res.ok) {
          const t = (await res.json()).find(x => x.type === 'page');
          if (t?.webSocketDebuggerUrl) {
            return new Promise((resolve, reject) => {
              this.ws = new WebSocket(t.webSocketDebuggerUrl);
              this.ws.onopen = async () => { await this.send('Page.enable'); await this.send('Runtime.enable'); resolve(); };
              this.ws.onerror = reject;
              this.ws.onmessage = (e) => {
                const d = JSON.parse(e.data);
                if (d.id && this.callbacks.has(d.id)) {
                  const c = this.callbacks.get(d.id);
                  this.callbacks.delete(d.id);
                  d.error ? c.reject(new Error(d.error.message)) : c.resolve(d.result);
                }
              };
            });
          }
        }
      } catch {}
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
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result?.value;
  }
  close() { if (this.ws) try { this.ws.close(); } catch {} }
}

async function run() {
  console.log('================================================================');
  console.log('  MOBILE 360px & 390px E2E: SMALLEST AVAILABLE CAPACITY TIER');
  console.log('================================================================\n');

  const app = express();
  const distDir = path.resolve(__dirname, '../booking-app/dist');
  app.use(express.static(distDir));

  let scenario = 'small_free'; // 'small_free' | 'small_full' | 'all_full'

  const mockRooms = [
    { id: 1, name: 'Saturn (303)', capacity: 4, has_hourly: 1, hourly_rate: 300 },
    { id: 2, name: 'Venus (304)', capacity: 4, has_hourly: 1, hourly_rate: 200 },
    { id: 3, name: 'Mercury (302)', capacity: 6, has_hourly: 1, hourly_rate: 400 },
    { id: 4, name: 'Mars (301)', capacity: 6, has_hourly: 1, hourly_rate: 450 },
    { id: 5, name: 'Jupiter (300)', capacity: 40, has_hourly: 1, hourly_rate: 1700 }
  ];

  app.get('/api/public/rooms', (req, res) => res.json(mockRooms));
  app.get('/api/public/rooms/availability-month', (req, res) => res.json({ month: req.query.month, rooms: mockRooms, intervals: [], cleaning_buffer_minutes: 30 }));
  app.get('/api/public/rooms/schedule', (req, res) => {
    const d = req.query.date || '2026-11-27';
    const full = [{ start_time: `${d} 08:00:00`, end_time: `${d} 18:00:00`, payment_status: 'paid' }];
    res.json({
      date: d,
      cleaning_buffer_minutes: 30,
      rooms: mockRooms.map(r => {
        if (scenario === 'all_full') return { ...r, bookings: full };
        if (scenario === 'small_full' && r.capacity === 4) return { ...r, bookings: full };
        return { ...r, bookings: [] };
      })
    });
  });
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));

  const server = http.createServer(app);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));

  const proc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--user-data-dir=D:\\Project BL\\Bwork-POS-Development\\scratch\\chrome_test_profile',
    '--headless=new', '--disable-gpu', '--no-first-run', 'about:blank'
  ]);
  const client = new CDPClient(CDP_PORT);
  await client.connect();

  try {
    for (const [w, h] of [[360, 800], [390, 844]]) {
      console.log(`--- Testing Mobile Viewport ${w}x${h} ---`);
      await client.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });

      // Case 1: 3 guests, 4-seat rooms free
      scenario = 'small_free';
      await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=3` });
      await new Promise(r => setTimeout(r, 900));
      const c1 = await client.eval(`(async () => {
        const activeId = document.querySelector('.room-detail-layout')?.id || '';
        document.getElementById('btn-mobile-switch-room')?.click();
        await new Promise(r => setTimeout(r, 200));
        const names = Array.from(document.querySelectorAll('#mobile-room-switcher-list button.room-switcher-item')).map(b => b.innerText.split('\\n')[0].trim());
        return { activeId, switcherNames: names };
      })()`);
      console.log(`  [Case 1: 3 guests, 4-seat free]`, JSON.stringify(c1));
      if (c1.activeId !== 'single-room-view-1' || c1.switcherNames.length !== 2 || c1.switcherNames.some(n => n.includes('Jupiter') || n.includes('Mercury'))) {
        throw new Error('Case 1 failed: ' + JSON.stringify(c1));
      }

      // Case 2: 3 guests, 4-seat rooms FULL, 6-seat free
      scenario = 'small_full';
      await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=3` });
      await new Promise(r => setTimeout(r, 900));
      const c2 = await client.eval(`(async () => {
        const activeId = document.querySelector('.room-detail-layout')?.id || '';
        const notice = document.getElementById('room-capacity-notice')?.innerText?.trim() || '';
        document.getElementById('btn-mobile-switch-room')?.click();
        await new Promise(r => setTimeout(r, 200));
        const names = Array.from(document.querySelectorAll('#mobile-room-switcher-list button.room-switcher-item')).map(b => b.innerText.split('\\n')[0].trim());
        return { activeId, notice, switcherNames: names };
      })()`);
      console.log(`  [Case 2: 3 guests, 4-seat full -> 6-seat]`, JSON.stringify(c2));
      if ((c2.activeId !== 'single-room-view-3' && c2.activeId !== 'single-room-view-4') || !c2.notice.includes('ห้องขนาด 4 ที่นั่งเต็มแล้วสำหรับวันที่เลือก') || !c2.notice.includes('ตอนนี้มีห้องขนาด 6 ที่นั่งให้จอง') || c2.switcherNames.length !== 2 || c2.switcherNames.some(n => n.includes('Jupiter'))) {
        throw new Error('Case 2 failed: ' + JSON.stringify(c2));
      }

      // Case 3: 3 guests, ALL rooms full
      scenario = 'all_full';
      await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=3` });
      await new Promise(r => setTimeout(r, 900));
      const c3 = await client.eval(`(() => ({
        text: document.getElementById('empty-rooms-for-date')?.innerText?.trim() || '',
        hasBtn: Boolean(document.getElementById('btn-change-date-empty'))
      }))()`);
      console.log(`  [Case 3: 3 guests, all full]`, JSON.stringify(c3));
      if (!c3.text.includes('ไม่พบห้องว่างสำหรับ 3 คนในวันที่เลือก') || !c3.hasBtn) {
        throw new Error('Case 3 failed: ' + JSON.stringify(c3));
      }

      // Case 4: directRoom mode -> Jupiter directly
      scenario = 'small_free';
      await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=directRoom&date=2026-11-27&guests=3&roomId=5` });
      await new Promise(r => setTimeout(r, 900));
      const c4 = await client.eval(`(() => ({
        activeId: document.querySelector('.room-detail-layout')?.id || '',
        title: document.querySelector('.room-detail-right h3')?.innerText?.trim() || ''
      }))()`);
      console.log(`  [Case 4: directRoom Jupiter]`, JSON.stringify(c4));
      if (c4.activeId !== 'single-room-view-5' || !c4.title.includes('Jupiter')) {
        throw new Error('Case 4 failed: ' + JSON.stringify(c4));
      }
    }

    console.log('\n================================================================');
    console.log('  ALL SMALLEST CAPACITY TIER MOBILE (360px & 390px) TESTS PASSED!');
    console.log('================================================================\n');
  } finally {
    client.close();
    proc.kill();
    server.close();
  }
}

run().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
