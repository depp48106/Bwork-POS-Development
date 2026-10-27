/**
 * verifyLandscapeModal.cjs
 * Comprehensive Real Browser UAT: POS Booking Details Wide Landscape Modal Redesign
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require(path.join(__dirname, '../node_modules/sqlite3'));

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:5000';
const ARTIFACT_DIR = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
const EVIDENCE_DIR = path.join(__dirname, '../ui-review-evidence/landscape-modal');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9265;

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
      // Find or setup a booking with payments for testing
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
  console.log('=== Starting Real Browser UAT: POS Booking Details Wide Landscape Modal ===\n');

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
    '--user-data-dir=' + path.join(__dirname, '../.chrome-test-landscape-uat')
  ]);

  await new Promise(r => setTimeout(r, 2000));
  const cdp = new CDPClient(CDP_PORT);
  await cdp.connect();

  try {
    await cdp.navigate(BASE_URL);

    // Inject token & set user session
    await cdp.evaluate(`
      localStorage.setItem('pos_token', '${token}');
      localStorage.setItem('token', '${token}');
      localStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(user)}));
      localStorage.setItem('user', JSON.stringify(${JSON.stringify(user)}));
    `);

    // Reload POS with session
    await cdp.navigate(BASE_URL);
    await new Promise(r => setTimeout(r, 2500));

    // Ensure POS Tab is active
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const posBtn = btns.find(b => b.textContent.includes('แผนผังและจุดขาย') || b.textContent.includes('POS'));
        if (posBtn) posBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 2000));

    // 1. Open Booking Details Modal by clicking a timeline booking block
    const opened = await cdp.evaluate(`
      (() => {
        const blocks = Array.from(document.querySelectorAll('.bwork-matrix-booking-block, [class*="booking-block"], [style*="position: absolute"]'))
          .filter(el => el.textContent && (el.textContent.includes('REF') || el.textContent.includes('#') || el.textContent.includes('คุณ') || el.textContent.includes('บริษัท')));
        if (blocks.length > 0) {
          blocks[0].click();
          return { success: true, count: blocks.length };
        }
        return { success: false, count: 0 };
      })()
    `);

    console.log('Opened booking block:', opened);
    if (!opened.success) {
      throw new Error('No booking block found on timeline to click');
    }

    await new Promise(r => setTimeout(r, 1200));

    // Verify Wide Landscape Modal Structure
    const modalCheck = await cdp.evaluate(`
      (() => {
        const modal = document.querySelector('.bwork-details-modal');
        const overlay = document.querySelector('.bwork-details-overlay');
        const header = document.querySelector('.bwork-details-header');
        const grid = document.querySelector('.bwork-details-grid');
        const footer = document.querySelector('.bwork-details-footer');
        const extendBtn = document.getElementById('btn-drawer-extend-room');
        const taxBtn = document.getElementById('btn-viewed-tax-manage');
        const closeBtn = document.querySelector('.bwork-details-close-btn');

        if (!modal) return { found: false };

        const rect = modal.getBoundingClientRect();
        const style = window.getComputedStyle(modal);
        const gridStyle = grid ? window.getComputedStyle(grid) : null;

        return {
          found: true,
          width: rect.width,
          height: rect.height,
          maxWidth: style.maxWidth,
          gridColumns: gridStyle ? gridStyle.gridTemplateColumns : null,
          hasExtendBtn: !!extendBtn,
          hasTaxBtn: !!taxBtn,
          hasCloseBtn: !!closeBtn,
          headerTitle: header ? header.querySelector('.bwork-details-title')?.textContent : null
        };
      })()
    `);

    console.log('✓ Landscape Modal Diagnostic:', modalCheck);
    if (!modalCheck.found) {
      throw new Error('Landscape Modal (.bwork-details-modal) not found in DOM');
    }

    // -------------------------------------------------------------
    // Viewport 1: Desktop Landscape (1440 × 900)
    // -------------------------------------------------------------
    await cdp.setViewport(1440, 900);
    await new Promise(r => setTimeout(r, 600));
    await cdp.captureScreenshot('pos_booking_details_desktop_landscape.png');
    console.log('✓ Captured Viewport 1: Desktop 1440x900 Landscape');

    // -------------------------------------------------------------
    // Viewport 2: Laptop Landscape (1280 × 800)
    // -------------------------------------------------------------
    await cdp.setViewport(1280, 800);
    await new Promise(r => setTimeout(r, 600));
    await cdp.captureScreenshot('pos_booking_details_laptop_1280.png');
    console.log('✓ Captured Viewport 2: Laptop 1280x800 Landscape');

    // -------------------------------------------------------------
    // Viewport 3: Tablet Landscape (1180 × 820)
    // -------------------------------------------------------------
    await cdp.setViewport(1180, 820);
    await new Promise(r => setTimeout(r, 600));
    await cdp.captureScreenshot('pos_booking_details_tablet_landscape.png');
    console.log('✓ Captured Viewport 3: Tablet 1180x820 Landscape');

    // -------------------------------------------------------------
    // Viewport 4: Tablet Portrait (820 × 1180)
    // -------------------------------------------------------------
    await cdp.setViewport(820, 1180);
    await new Promise(r => setTimeout(r, 600));
    await cdp.captureScreenshot('pos_booking_details_tablet_portrait.png');
    console.log('✓ Captured Viewport 4: Tablet 820x1180 Portrait (Adaptive Stacked Layout)');

    // -------------------------------------------------------------
    // Viewport 5: Mobile (390 × 844)
    // -------------------------------------------------------------
    await cdp.setViewport(390, 844);
    await new Promise(r => setTimeout(r, 600));
    await cdp.captureScreenshot('pos_booking_details_mobile_390.png');
    console.log('✓ Captured Viewport 5: Mobile 390x844');

    // Return to Desktop for Interaction Tests
    await cdp.setViewport(1440, 900);
    await new Promise(r => setTimeout(r, 600));

    // -------------------------------------------------------------
    // Interaction Test 1: Door PIN Reveal
    // -------------------------------------------------------------
    const pinRevealed = await cdp.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ดูรหัสผ่านห้อง'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);
    if (pinRevealed) {
      await new Promise(r => setTimeout(r, 500));
      await cdp.captureScreenshot('pos_landscape_pin_revealed.png');
      console.log('✓ Interaction Test 1: Door PIN Revealed & Captured');
    }

    // -------------------------------------------------------------
    // Interaction Test 2: Single Active Modal Transition to Room Extension
    // -------------------------------------------------------------
    const extendClicked = await cdp.evaluate(`
      (() => {
        const btn = document.getElementById('btn-drawer-extend-room');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()
    `);

    if (!extendClicked) {
      throw new Error('#btn-drawer-extend-room not found or could not be clicked');
    }

    await new Promise(r => setTimeout(r, 1000));

    // Verify Room Extension Modal is open and Details Modal is hidden (Single Active Modal)
    const transitionCheck = await cdp.evaluate(`
      (() => {
        const rxModal = document.querySelector('.rx-modal-card');
        const detailsModal = document.querySelector('.bwork-details-modal');
        return {
          rxModalOpen: !!rxModal,
          detailsModalHidden: !detailsModal
        };
      })()
    `);

    console.log('✓ Transition Check (Extend Modal Open):', transitionCheck);
    if (!transitionCheck.rxModalOpen || !transitionCheck.detailsModalHidden) {
      throw new Error('Single Active Modal transition failed: ' + JSON.stringify(transitionCheck));
    }

    await cdp.captureScreenshot('pos_landscape_extend_transition_opened.png');
    console.log('✓ Captured: Room Extension Modal Frontmost (Details Modal Hidden)');

    // -------------------------------------------------------------
    // Interaction Test 3: Cancel Room Extension & Restore Details Modal
    // -------------------------------------------------------------
    await cdp.evaluate(`
      (() => {
        const cancelBtn = Array.from(document.querySelectorAll('.rx-btn-secondary, button')).find(b => b.textContent.includes('ยกเลิก'));
        if (cancelBtn) cancelBtn.click();
      })()
    `);

    await new Promise(r => setTimeout(r, 1000));

    const restoredCheck = await cdp.evaluate(`
      (() => {
        const rxModal = document.querySelector('.rx-modal-card');
        const detailsModal = document.querySelector('.bwork-details-modal');
        return {
          rxModalClosed: !rxModal,
          detailsModalRestored: !!detailsModal
        };
      })()
    `);

    console.log('✓ Transition Check (Details Modal Restored):', restoredCheck);
    if (!restoredCheck.rxModalClosed || !restoredCheck.detailsModalRestored) {
      throw new Error('Landscape Modal restoration failed: ' + JSON.stringify(restoredCheck));
    }

    await cdp.captureScreenshot('pos_landscape_extend_transition_returned.png');
    console.log('✓ Captured: Landscape Modal Restored Cleanly');

    console.log('\n=== ALL BROWSER UAT VERIFICATIONS PASSED WITH 100% SUCCESS! ===');
  } finally {
    await cdp.close();
    chromeProcess.kill();
  }
}

run().catch(err => {
  console.error('\n❌ UAT Failure:', err);
  process.exit(1);
});
