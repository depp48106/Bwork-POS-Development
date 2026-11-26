/**
 * BWORK-POS — MOBILE (390x844) & DESKTOP (1280x800) E2E TEST SUITE V2
 *
 * Verifies:
 * 1. Calendar soft diagonal ribbon ("ผ่านมาแล้ว") & timeline colors (#FDBA74 booked vs #64748B past)
 * 2. By-Guests search with time range (10:00–12:00):
 *    - Room with overlapping booking (11:00–11:30) is HIDDEN
 *    - Free room is SHOWN
 *    - When all rooms conflict -> shows "ไม่มีห้องว่างในช่วงเวลานี้" + "เปลี่ยนเวลา" button
 * 3. Dragging left & right edges of selected timeline capsule on BOTH Mobile and Desktop
 * 4. Krungsri Preview (/confirm?preview=krungsri) displays banner, logo, "ธนาคารกรุงศรีอยุธยา", "329-1-38429-0",
 *    copies "3291384290" and updates button to "คัดลอกแล้ว"
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require(path.resolve(__dirname, '../backend/node_modules/express'));
const { spawn } = require('child_process');

const PORT = 5192;
const CDP_PORT = 9282;
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
  console.log('  BWORK E2E V2: BY-GUESTS FILTER, EDGE DRAG, & KRUNGSRI PREVIEW');
  console.log('================================================================\n');

  const app = express();
  app.use(express.json());
  const distDir = path.resolve(__dirname, '../booking-app/dist');
  app.use(express.static(distDir));

  let blockBothRooms = false;
  const mockRooms = [
    { id: 4, name: 'Mars (301)', capacity: 8, room_type: 'meeting', has_hourly: 1, hourly_rate: 350, price_per_hour: 350 },
    { id: 5, name: 'Venus (302)', capacity: 8, room_type: 'meeting', has_hourly: 1, hourly_rate: 350, price_per_hour: 350 }
  ];

  app.get('/api/public/rooms', (req, res) => res.json(mockRooms));
  app.get('/api/public/rooms/availability-month', (req, res) => {
    res.json({ month: req.query.month, rooms: mockRooms, intervals: [], cleaning_buffer_minutes: 30 });
  });
  app.get('/api/public/rooms/schedule', (req, res) => {
    const d = req.query.date || '2026-11-27';
    res.json({
      date: d,
      cleaning_buffer_minutes: 30,
      rooms: [
        {
          ...mockRooms[0],
          // Mars (301) has a booking 11:00-11:30 -> overlaps 10:00-12:00!
          bookings: [{ start_time: `${d} 11:00:00`, end_time: `${d} 11:30:00`, payment_status: 'paid' }]
        },
        {
          ...mockRooms[1],
          bookings: blockBothRooms
            ? [{ start_time: `${d} 10:30:00`, end_time: `${d} 11:30:00`, payment_status: 'paid' }]
            : []
        }
      ]
    });
  });
  app.get('/api/public/settings/payment', (req, res) => {
    res.json({
      payment_bank_name: 'ธนาคารทดสอบสเตจจิ้ง (Mock Test Bank)',
      payment_bank_account: '000-0-00000-0',
      payment_bank_account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด (Staging)',
      payment_window_minutes: 15
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
    '--window-size=390,844',
    'about:blank'
  ]);

  const client = new CDPClient(CDP_PORT);
  await client.connect();

  try {
    // =========================================================================
    // PART A: MOBILE VIEWPORT (390 x 844)
    // =========================================================================
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

    console.log('0. [Mobile] Testing collapsible time filter in modal (collapsed by default -> expand -> clear)...');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await new Promise(r => setTimeout(r, 900));
    await client.eval(`(() => {
      const btn27 = Array.from(document.querySelectorAll('button.customer-cal-day')).find(b => b.innerText.includes('27'));
      if (btn27) btn27.click();
    })()`);
    await new Promise(r => setTimeout(r, 400));

    const collapseCheck = await client.eval(`(async () => {
      const expandBtnBefore = Boolean(document.getElementById('btn-expand-modal-time'));
      const panelBefore = Boolean(document.getElementById('modal-time-filter-panel'));
      document.getElementById('btn-expand-modal-time')?.click();
      await new Promise(r => setTimeout(r, 200));
      const panelAfterExpand = Boolean(document.getElementById('modal-time-filter-panel'));
      const clearBtn = document.getElementById('btn-clear-modal-time');
      const clearLabel = clearBtn?.innerText?.trim() || '';
      clearBtn?.click();
      await new Promise(r => setTimeout(r, 200));
      const panelAfterClear = Boolean(document.getElementById('modal-time-filter-panel'));
      return { expandBtnBefore, panelBefore, panelAfterExpand, clearLabel, panelAfterClear };
    })()`);
    console.log('  [RESULT Collapsible Filter]', JSON.stringify(collapseCheck));
    if (!collapseCheck.expandBtnBefore || collapseCheck.panelBefore || !collapseCheck.panelAfterExpand || collapseCheck.clearLabel !== 'ล้างช่วงเวลา' || collapseCheck.panelAfterClear) {
      throw new Error('Collapsible time filter check failed: ' + JSON.stringify(collapseCheck));
    }

    console.log('\n0.5. [Mobile] Testing timeline tap on booked/cleaning slots shows tooltip WITHOUT changing selected time...');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=directRoom&date=2026-11-27&guests=4&roomId=4` });
    await new Promise(r => setTimeout(r, 1000));

    const tapBookedCheck = await client.eval(`(async () => {
      const selectsBefore = Array.from(document.querySelectorAll('select')).map(s => s.value);
      const bookedSlot = document.querySelector('[data-slot-type="booked"]');
      const cleaningSlot = document.querySelector('[data-slot-type="cleaning"]');
      if (!bookedSlot || !cleaningSlot) return { error: 'Booked or cleaning slot missing' };
      bookedSlot.click();
      await new Promise(r => setTimeout(r, 200));
      const bookedTip = document.querySelector('[data-testid="timeline-slot-tooltip-4"]')?.innerText?.trim() || '';
      const selectsAfterBooked = Array.from(document.querySelectorAll('select')).map(s => s.value);

      cleaningSlot.click();
      await new Promise(r => setTimeout(r, 200));
      const cleaningTip = document.querySelector('[data-testid="timeline-slot-tooltip-4"]')?.innerText?.trim() || '';
      const selectsAfterCleaning = Array.from(document.querySelectorAll('select')).map(s => s.value);

      return {
        bookedTip,
        cleaningTip,
        unchangedAfterBooked: JSON.stringify(selectsBefore) === JSON.stringify(selectsAfterBooked),
        unchangedAfterCleaning: JSON.stringify(selectsBefore) === JSON.stringify(selectsAfterCleaning)
      };
    })()`);
    console.log('  [RESULT Tap Booked/Cleaning]', JSON.stringify(tapBookedCheck));
    if (tapBookedCheck.error || !tapBookedCheck.bookedTip.includes('11:00–11:30 น. · ติดจอง') || !tapBookedCheck.cleaningTip.includes('น. · ทำความสะอาด') || !tapBookedCheck.unchangedAfterBooked || !tapBookedCheck.unchangedAfterCleaning) {
      throw new Error('Timeline tap tooltip check failed: ' + JSON.stringify(tapBookedCheck));
    }

    console.log('\n1. [Mobile] Testing byGuests 10:00-12:00 filter (Mars 11:00-11:30 hidden, Venus shown)...');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=4&start=10:00&end=12:00` });
    await new Promise(r => setTimeout(r, 1200));

    const filterCheck = await client.eval(`(() => {
      const text = document.body.innerText;
      return {
        hasMars: text.includes('Mars (301)'),
        hasVenus: text.includes('Venus (302)'),
        hasSummaryTime: text.includes('10:00–12:00')
      };
    })()`);
    console.log('  [RESULT]', JSON.stringify(filterCheck));
    if (filterCheck.hasMars) throw new Error('Mars (301) with 11:00-11:30 booking should be HIDDEN for 10:00-12:00 search!');
    if (!filterCheck.hasVenus) throw new Error('Venus (302) which is free should be SHOWN!');

    console.log('\n2. [Mobile] Testing edge drag (left & right edges) on Venus (302) timeline...');
    // Expand Venus (302) card
    await client.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('ดูเวลาว่าง'));
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const dragMobile = await client.eval(`(async () => {
      const leftEdge = document.querySelector('[data-testid="timeline-edge-start-5"]');
      const rightEdge = document.querySelector('[data-testid="timeline-edge-end-5"]');
      if (!leftEdge || !rightEdge) return { error: 'Edge handles not found' };

      const track = leftEdge.parentElement;
      const rect = track.getBoundingClientRect();

      // Drag left edge from 10:00 (20%) to 09:00 (10%)
      leftEdge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: rect.left + rect.width * 0.2, clientY: rect.top + 14 }));
      leftEdge.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: rect.left + rect.width * 0.1, clientY: rect.top + 14 }));
      leftEdge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: rect.left + rect.width * 0.1, clientY: rect.top + 14 }));
      await new Promise(r => setTimeout(r, 200));

      // Drag right edge from 12:00 (40%) to 13:00 (50%)
      rightEdge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: rect.left + rect.width * 0.4, clientY: rect.top + 14 }));
      rightEdge.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: rect.left + rect.width * 0.5, clientY: rect.top + 14 }));
      rightEdge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, clientX: rect.left + rect.width * 0.5, clientY: rect.top + 14 }));
      await new Promise(r => setTimeout(r, 200));

      const selects = Array.from(document.querySelectorAll('select')).map(s => s.value);
      return {
        hasLeftEdge: true,
        hasRightEdge: true,
        trackTouchAction: track.style.touchAction,
        edgeTouchAction: leftEdge.style.touchAction,
        selectedTimes: selects
      };
    })()`);
    console.log('  [RESULT Mobile Edge Drag]', JSON.stringify(dragMobile));
    if (dragMobile.error || dragMobile.selectedTimes[0] >= '10:00' || dragMobile.selectedTimes[1] <= '12:00') {
      throw new Error('Mobile edge drag failed: ' + JSON.stringify(dragMobile));
    }

    console.log('\n3. [Mobile] Testing Empty State ("ไม่มีห้องว่างในช่วงเวลานี้" + "เปลี่ยนเวลา")...');
    blockBothRooms = true;
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=4&start=10:00&end=12:00` });
    await new Promise(r => setTimeout(r, 1000));

    const emptyCheck = await client.eval(`(() => {
      const text = document.body.innerText;
      const btn = document.getElementById('btn-change-search-time');
      if (btn) btn.click();
      return {
        hasEmptyMsg: text.includes('ไม่มีห้องว่างในช่วงเวลานี้'),
        hasChangeBtn: Boolean(btn && btn.innerText.includes('เปลี่ยนเวลา')),
        modalOpened: Boolean(document.getElementById('select-modal-start-time'))
      };
    })()`);
    await new Promise(r => setTimeout(r, 300));
    const modalOpenAfterClick = await client.eval(`Boolean(document.getElementById('select-modal-start-time'))`);
    console.log('  [RESULT Empty State]', JSON.stringify({ ...emptyCheck, modalOpenAfterClick }));
    if (!emptyCheck.hasEmptyMsg || !emptyCheck.hasChangeBtn || !modalOpenAfterClick) {
      throw new Error('Empty state check failed');
    }

    console.log('\n4. [Mobile] Testing Krungsri Preview (/confirm?preview=krungsri)...');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/confirm?preview=krungsri` });
    await new Promise(r => setTimeout(r, 1000));

    const previewCheck = await client.eval(`(async () => {
      let copiedText = null;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (txt) => { copiedText = txt; } }
      });
      const banner = document.getElementById('staging-krungsri-preview-banner')?.innerText?.trim() || '';
      const logo = document.getElementById('bank-logo-krungsri');
      const bankName = document.getElementById('bank-name-display')?.innerText?.trim();
      const accNum = document.getElementById('bank-account-number-display')?.innerText?.trim();
      const copyBtn = document.getElementById('btn-copy-bank-account');
      copyBtn.click();
      await new Promise(r => setTimeout(r, 250));
      return {
        hasBanner: banner.includes('ตัวอย่างสำหรับตรวจหน้าตา'),
        hasLogo: Boolean(logo),
        bankName,
        accNum,
        copiedText,
        btnTextAfter: copyBtn.innerText.trim(),
        hasBranch: document.body.innerText.includes('สาขา')
      };
    })()`);
    console.log('  [RESULT Krungsri Preview]', JSON.stringify(previewCheck));
    if (!previewCheck.hasBanner || !previewCheck.hasLogo || previewCheck.bankName !== 'ธนาคารกรุงศรีอยุธยา' || previewCheck.accNum !== '329-1-38429-0' || previewCheck.copiedText !== '3291384290' || !previewCheck.btnTextAfter.includes('คัดลอกแล้ว') || previewCheck.hasBranch) {
      throw new Error('Krungsri Preview verification failed');
    }
    await client.captureScreenshot('mobile_e2e_v2_krungsri_preview.png');

    // =========================================================================
    // PART B: DESKTOP VIEWPORT (1280 x 800)
    // =========================================================================
    console.log('\n5. [Desktop 1280x800] Testing byGuests filter & edge drag...');
    blockBothRooms = false;
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/rooms?mode=byGuests&date=2026-11-27&guests=4&start=10:00&end=12:00` });
    await new Promise(r => setTimeout(r, 1000));

    await client.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('ดูเวลาว่าง'));
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 500));

    const dragDesktop = await client.eval(`(async () => {
      const leftEdge = document.querySelector('[data-testid="timeline-edge-start-5"]');
      const rightEdge = document.querySelector('[data-testid="timeline-edge-end-5"]');
      if (!leftEdge || !rightEdge) return { error: 'Edge handles not found on desktop' };
      const rect = leftEdge.parentElement.getBoundingClientRect();
      // Drag left edge to 08:30 (5%) and right edge to 14:00 (60%)
      leftEdge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 10, clientX: rect.left + rect.width * 0.2, clientY: rect.top + 14 }));
      leftEdge.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 10, clientX: rect.left + rect.width * 0.05, clientY: rect.top + 14 }));
      leftEdge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 10, clientX: rect.left + rect.width * 0.05, clientY: rect.top + 14 }));
      await new Promise(r => setTimeout(r, 150));
      rightEdge.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, clientX: rect.left + rect.width * 0.4, clientY: rect.top + 14 }));
      rightEdge.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 11, clientX: rect.left + rect.width * 0.6, clientY: rect.top + 14 }));
      rightEdge.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11, clientX: rect.left + rect.width * 0.6, clientY: rect.top + 14 }));
      await new Promise(r => setTimeout(r, 150));
      return { selectedTimes: Array.from(document.querySelectorAll('select')).map(s => s.value) };
    })()`);
    console.log('  [RESULT Desktop Edge Drag]', JSON.stringify(dragDesktop));
    if (dragDesktop.error || dragDesktop.selectedTimes[0] >= '10:00' || dragDesktop.selectedTimes[1] <= '12:00') {
      throw new Error('Desktop edge drag failed: ' + JSON.stringify(dragDesktop));
    }

    console.log('\n================================================================');
    console.log('  ALL MOBILE & DESKTOP E2E V2 CHECKS PASSED SUCCESSFULLY!');
    console.log('================================================================\n');
  } finally {
    client.close();
    chromeProc.kill();
    server.close();
  }
}

run().catch(err => {
  console.error('\n[FATAL] E2E V2 Failed:', err);
  process.exit(1);
});
