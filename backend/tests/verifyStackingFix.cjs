/**
 * verifyStackingFix.cjs
 * Comprehensive Browser UAT Verification for Modal Stacking & Single Active Modal Transition
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require(path.join(__dirname, '../node_modules/sqlite3'));

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:5000';
const ARTIFACT_DIR = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
const EVIDENCE_DIR = path.join(__dirname, '../ui-review-evidence/room-extension-stacking');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9260;

const capturedErrors = [];

class CDPClient {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    for (let i = 0; i < 25; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
        const targets = await res.json();
        const pageTarget = targets.find(t => t.type === 'page') || targets[0];
        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          return new Promise((resolve, reject) => {
            this.ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
            this.ws.onopen = async () => {
              await this.send('Page.enable');
              await this.send('Runtime.enable');
              await this.send('DOM.enable');
              resolve();
            };
            this.ws.onmessage = (event) => {
              const data = JSON.parse(event.data);

              if (data.method === 'Runtime.exceptionThrown') {
                const ex = data.params.exceptionDetails;
                const errObj = {
                  text: ex.text,
                  description: ex.exception?.description || ex.text,
                  lineNumber: ex.lineNumber,
                  columnNumber: ex.columnNumber
                };
                console.error('❌ Browser Exception:', errObj.description);
                capturedErrors.push(errObj);
              }

              if (data.id && this.callbacks.has(data.id)) {
                const { resolve, reject } = this.callbacks.get(data.id);
                this.callbacks.delete(data.id);
                if (data.error) reject(new Error(JSON.stringify(data.error)));
                else resolve(data.result);
              }
            };
            this.ws.onerror = reject;
          });
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
    throw new Error('Failed to connect to Chrome CDP WebSocket');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`CDP Evaluate Error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, 2000));
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 500));
  }

  async captureScreenshot(baseName) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(data, 'base64');

    if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const p1 = path.join(ARTIFACT_DIR, baseName);
    const p2 = path.join(EVIDENCE_DIR, baseName);

    fs.writeFileSync(p1, buffer);
    fs.writeFileSync(p2, buffer);
    console.log(`  📸 Captured: ${baseName} (${buffer.length} bytes)`);
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function prepareTestBooking() {
  const dbPath = path.join(__dirname, '../database_dev.sqlite');
  const db = new sqlite3.Database(dbPath);

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayPrefix = `${y}-${m}-${d}`;
  const targetStart = `${todayPrefix}T10:00:00`;
  const targetEnd = `${todayPrefix}T12:00:00`;

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get(
        `SELECT b.id, bi.id as booking_item_id, bi.room_id
         FROM bookings b
         JOIN booking_items bi ON bi.booking_id = b.id
         WHERE bi.room_id IS NOT NULL AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
         ORDER BY b.id DESC LIMIT 1`,
        (err, row) => {
          if (err || !row) return reject(err || new Error('No booking found'));
          db.run(
            `UPDATE booking_items SET start_time = ?, end_time = ? WHERE id = ?`,
            [targetStart, targetEnd, row.booking_item_id],
            (err2) => {
              if (err2) return reject(err2);
              console.log(`✓ Seeded booking ID ${row.id} for today: ${targetStart} - ${targetEnd}`);
              db.close();
              resolve({
                ...row,
                start_time: targetStart,
                end_time: targetEnd
              });
            }
          );
        }
      );
    });
  });
}

async function run() {
  console.log('=== Starting Real Browser UAT: Room Extension Stacking Fix ===\n');

  await prepareTestBooking();

  const authRes = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const { token, user } = await authRes.json();
  console.log(`✓ Authenticated as ${user.username} (${user.role}).`);

  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1440,900',
    '--user-data-dir=' + path.join(__dirname, '../.chrome-test-stacking-uat')
  ]);

  await new Promise(r => setTimeout(r, 2000));
  const cdp = new CDPClient(CDP_PORT);
  await cdp.connect();

  try {
    // Login to POS App
    console.log('Logging in and navigating to POS...');
    await cdp.navigate(BASE_URL);
    await cdp.evaluate(`
      localStorage.setItem('pos_token', '${token}');
      localStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(user)}));
      localStorage.setItem('token', '${token}');
      localStorage.setItem('user', JSON.stringify(${JSON.stringify(user)}));
      sessionStorage.setItem('pos_token', '${token}');
      sessionStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(user)}));
      window.location.hash = '#pos';
      window.location.reload();
    `);
    await new Promise(r => setTimeout(r, 2500));

    // Switch to POS Tab
    await cdp.evaluate(`
      const btns = Array.from(document.querySelectorAll('button'));
      const posTab = btns.find(b => b.textContent.trim() === 'POS' || b.innerText.includes('POS'));
      if (posTab) posTab.click();
    `);
    await new Promise(r => setTimeout(r, 2500));

    // ========================================================
    // Scenario A: POS -> Booking -> ต่อเวลา -> Modal ต้องอยู่ด้านหน้า (Drawer ซ่อนไป ไม่มี Overlay ซ้อน)
    // ========================================================
    console.log('\n--- Scenario A: POS -> Booking Details -> ต่อเวลาห้อง ---');
    await cdp.evaluate(`
      const pill = document.querySelector('.timeline-booking-pill');
      if (pill) pill.click();
    `);
    await new Promise(r => setTimeout(r, 1200));

    // Assert Drawer is visible
    const drawerState1 = await cdp.evaluate(`
      (() => {
        const btn = document.getElementById('btn-drawer-extend-room');
        return {
          hasDrawer: !!btn,
          btnText: btn ? btn.innerText.trim() : null
        };
      })()
    `);
    console.log('Drawer State Before Extend:', JSON.stringify(drawerState1));
    await cdp.captureScreenshot('scenario_a1_pos_drawer.png');

    // Click "ต่อเวลาห้อง"
    console.log('Clicking "ต่อเวลาห้อง"...');
    await cdp.evaluate(`document.getElementById('btn-drawer-extend-room').click();`);
    await new Promise(r => setTimeout(r, 1800));

    // Assert: Single Active Modal
    const modalStateA = await cdp.evaluate(`
      (() => {
        const rxModal = document.querySelector('.rx-modal-card');
        const rxOverlay = document.querySelector('.rx-modal-overlay');
        const drawerModals = Array.from(document.querySelectorAll('div')).filter(d => {
          const s = window.getComputedStyle(d);
          return s.position === 'fixed' && (s.zIndex === '2000' || d.innerText.includes('รายละเอียดการจอง'));
        });

        const activeOverlays = document.querySelectorAll('.rx-modal-overlay');

        return {
          hasRxModal: !!rxModal,
          hasRxOverlay: !!rxOverlay,
          rxZIndex: rxOverlay ? window.getComputedStyle(rxOverlay).zIndex : null,
          isDrawerHiddenOrRemoved: drawerModals.length === 0,
          activeOverlaysCount: activeOverlays.length,
          title: rxModal?.querySelector('#rx-modal-title')?.textContent
        };
      })()
    `);
    console.log('Scenario A Verification:', JSON.stringify(modalStateA, null, 2));

    if (!modalStateA.hasRxModal) throw new Error('Scenario A Failed: RoomExtensionModal not found!');
    if (!modalStateA.isDrawerHiddenOrRemoved) throw new Error('Scenario A Failed: Booking Details Drawer was not hidden! Multiple modals active!');
    if (modalStateA.activeOverlaysCount !== 1) throw new Error('Scenario A Failed: Overlay stacking detected! Multiple overlays found: ' + modalStateA.activeOverlaysCount);

    await cdp.captureScreenshot('scenario_a2_modal_frontmost.png');

    // Test Tablet Viewport
    console.log('Testing Tablet 820px...');
    await cdp.setViewport(820, 1180);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('scenario_a3_tablet_modal.png');
    await cdp.setViewport(1440, 900);
    await new Promise(r => setTimeout(r, 400));
    console.log('✓ Scenario A Passed: Modal is front-most, drawer is cleanly hidden, 0 overlay stacking.');

    // ========================================================
    // Scenario B: ยกเลิก -> กลับรายละเอียด Booking เดิม
    // ========================================================
    console.log('\n--- Scenario B: ยกเลิก -> กลับรายละเอียด Booking เดิม ---');
    console.log('Clicking "ยกเลิก"...');
    await cdp.evaluate(`
      (() => {
        const cancelBtn = document.querySelector('.rx-btn-secondary');
        if (cancelBtn) cancelBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    const stateB = await cdp.evaluate(`
      (() => {
        const rxModal = document.querySelector('.rx-modal-card');
        const drawerBtn = document.getElementById('btn-drawer-extend-room');
        return {
          rxModalGone: !rxModal,
          drawerRestored: !!drawerBtn
        };
      })()
    `);
    console.log('Scenario B Verification:', JSON.stringify(stateB));
    if (!stateB.rxModalGone) throw new Error('Scenario B Failed: RoomExtensionModal did not close!');
    if (!stateB.drawerRestored) throw new Error('Scenario B Failed: Booking Details Drawer was not restored!');

    await cdp.captureScreenshot('scenario_b_returned_to_drawer.png');
    console.log('✓ Scenario B Passed: Extension cancelled cleanly, returned to original booking drawer.');

    // ========================================================
    // Scenario C: ต่อเวลา -> ปิดด้วย X -> กลับหน้ารายการเดิม
    // ========================================================
    console.log('\n--- Scenario C: ต่อเวลา -> ปิดด้วย X -> กลับรายละเอียดเดิม ---');
    await cdp.evaluate(`document.getElementById('btn-drawer-extend-room').click();`);
    await new Promise(r => setTimeout(r, 1500));

    console.log('Clicking X close button on modal...');
    await cdp.evaluate(`
      (() => {
        const xBtn = document.querySelector('.rx-modal-close-btn');
        if (xBtn) xBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    const stateC = await cdp.evaluate(`
      (() => {
        const rxModal = document.querySelector('.rx-modal-card');
        const drawerBtn = document.getElementById('btn-drawer-extend-room');
        return {
          rxModalGone: !rxModal,
          drawerRestored: !!drawerBtn
        };
      })()
    `);
    console.log('Scenario C Verification:', JSON.stringify(stateC));
    if (!stateC.rxModalGone) throw new Error('Scenario C Failed: RoomExtensionModal did not close via X!');
    if (!stateC.drawerRestored) throw new Error('Scenario C Failed: Drawer not restored after X click!');

    await cdp.captureScreenshot('scenario_c_closed_with_x_returned.png');
    console.log('✓ Scenario C Passed: Closed via X, smoothly returned to booking drawer.');

    // ========================================================
    // Scenario D: Preview / Conflict Interaction -> Cancel -> Returns cleanly
    // ========================================================
    console.log('\n--- Scenario D: Conflict / Warning Preview -> Cancel -> Safe Return ---');
    await cdp.evaluate(`document.getElementById('btn-drawer-extend-room').click();`);
    await new Promise(r => setTimeout(r, 1500));

    // Click +2 hours
    await cdp.evaluate(`
      const chips = Array.from(document.querySelectorAll('.rx-duration-chip'));
      const chip2h = chips.find(c => c.textContent.includes('+2 ชั่วโมง'));
      if (chip2h) chip2h.click();
    `);
    await new Promise(r => setTimeout(r, 1200));

    // Cancel and return
    await cdp.evaluate(`
      (() => {
        const cancelBtn = document.querySelector('.rx-btn-secondary');
        if (cancelBtn) cancelBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    const stateD = await cdp.evaluate(`
      (() => {
        const rxModal = document.querySelector('.rx-modal-card');
        const drawerBtn = document.getElementById('btn-drawer-extend-room');
        return { rxModalGone: !rxModal, drawerRestored: !!drawerBtn };
      })()
    `);
    console.log('Scenario D Verification:', JSON.stringify(stateD));
    if (!stateD.drawerRestored) throw new Error('Scenario D Failed: Drawer not restored after preview cancellation!');
    await cdp.captureScreenshot('scenario_d_conflict_cancel_return.png');
    console.log('✓ Scenario D Passed: Safe return from preview interaction.');

    // ========================================================
    // Scenario E: Repeated Open/Close transitions (no overlay stacking / memory leaks)
    // ========================================================
    console.log('\n--- Scenario E: Repeated Open / Close Cycles (Zero Overlay Leaks) ---');
    for (let cycle = 1; cycle <= 3; cycle++) {
      await cdp.evaluate(`document.getElementById('btn-drawer-extend-room').click();`);
      await new Promise(r => setTimeout(r, 800));
      const countOpen = await cdp.evaluate(`document.querySelectorAll('.rx-modal-overlay').length`);
      if (countOpen !== 1) throw new Error(`Scenario E: Overlay count ${countOpen} expected 1 during cycle ${cycle}`);

      await cdp.evaluate(`document.querySelector('.rx-btn-secondary').click();`);
      await new Promise(r => setTimeout(r, 800));
      const countClosed = await cdp.evaluate(`document.querySelectorAll('.rx-modal-overlay').length`);
      if (countClosed !== 0) throw new Error(`Scenario E: Overlay count ${countClosed} expected 0 during cycle ${cycle}`);
    }
    console.log('✓ Scenario E Passed: 3 consecutive cycles completed with strictly 0 or 1 active overlays.');

    // ========================================================
    // Scenario F: Pending Bookings (#pending) Compatibility
    // ========================================================
    console.log('\n--- Scenario F: Pending Bookings Compatibility ---');
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.textContent.includes('Booking Management') || b.textContent.includes('จัดการการจอง'));
        if (tab) tab.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 2500));

    // Click on booking cell to open detail modal
    const clickedRow = await cdp.evaluate(`
      (() => {
        const cell = document.querySelector('td.pb-td, .pb-td, tr[style*="cursor"]');
        if (cell) {
          cell.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Clicked booking cell in Pending Bookings table:', clickedRow);
    await new Promise(r => setTimeout(r, 2000));

    const clickedExt = await cdp.evaluate(`
      (() => {
        const extBtn = document.getElementById('pb-detail-btn-extend-room');
        if (extBtn) {
          extBtn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Clicked pb-detail-btn-extend-room:', clickedExt);
    await new Promise(r => setTimeout(r, 2000));

    const stateF = await cdp.evaluate(`
      (() => {
        const rxModal = document.querySelector('.rx-modal-card');
        const rxOverlay = document.querySelector('.rx-modal-overlay');
        return {
          hasRxModal: !!rxModal,
          zIndex: rxOverlay ? window.getComputedStyle(rxOverlay).zIndex : null
        };
      })()
    `);
    console.log('Scenario F Verification:', JSON.stringify(stateF));
    if (!stateF.hasRxModal) throw new Error('Scenario F Failed: RoomExtensionModal did not open in Pending Bookings!');
    if (stateF.zIndex !== '15000') throw new Error(`Scenario F Failed: zIndex is ${stateF.zIndex}, expected 15000!`);

    await cdp.captureScreenshot('scenario_f_pending_bookings_extension.png');
    console.log('✓ Scenario F Passed: Pending Bookings extension works with zIndex: 15000.');

    // ========================================================
    // Scenario G: Console Exceptions Assert
    // ========================================================
    console.log('\n--- Scenario G: Zero Console Exceptions Assert ---');
    console.log(`Total Captured Uncaught Exceptions: ${capturedErrors.length}`);
    if (capturedErrors.length > 0) {
      console.error('Errors:', JSON.stringify(capturedErrors, null, 2));
      throw new Error(`Scenario G Failed: ${capturedErrors.length} uncaught exceptions!`);
    }
    console.log('✓ Scenario G Passed: Exactly 0 uncaught runtime exceptions.');

    console.log('\n🎉 ALL 7 REAL BROWSER SCENARIOS (A-G) PASSED 100%!');
  } finally {
    await cdp.close();
    chromeProcess.kill();
  }
}

run().catch((err) => {
  console.error('\n❌ Test Run Error:', err);
  process.exit(1);
});
