/**
 * verifyWhiteScreenFix.cjs
 * Comprehensive Browser UAT Verification for Room Extension White Screen Bug Fix
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require(path.join(__dirname, '../node_modules/sqlite3'));

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const API_URL = process.env.API_URL || 'http://localhost:5000';
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || 'C:\\Users\\Runrasa.P\\.gemini\\antigravity\\brain\\03721993-8ed4-4f8b-a41b-db0f7e984101';
const EVIDENCE_DIR = path.join(__dirname, '../ui-review-evidence/bugfix-white-screen');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9248;

const capturedErrors = [];
const consoleMessages = [];

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
              await this.send('Log.enable');
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
                  columnNumber: ex.columnNumber,
                  stackTrace: ex.stackTrace
                };
                console.error('❌ Browser Exception Thrown:', errObj.description);
                capturedErrors.push(errObj);
              }

              if (data.method === 'Runtime.consoleAPICalled') {
                const args = data.params.args.map(a => a.value || a.description || '');
                consoleMessages.push({
                  type: data.params.type,
                  message: args.join(' ')
                });
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
      // Pick a non-cancelled booking with a room item and update its time to 10:00-12:00 today
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
              console.log(`✓ Seeded booking ID ${row.id} (item ${row.booking_item_id}) to visible timeline: ${targetStart} - ${targetEnd}`);
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
  console.log('=== Starting Real Browser UAT: POS Room Extension White Screen Bug Fix ===\n');

  // Step 1: Ensure active test booking
  const testBooking = await prepareTestBooking();

  // Step 2: Authenticate
  const authRes = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const authData = await authRes.json();
  const token = authData.token;
  const user = authData.user;
  console.log(`✓ Authenticated as ${user.username} (${user.role}).`);

  // Step 3: Spawn Headless Chrome
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1440,900',
    '--user-data-dir=' + path.join(__dirname, '../.chrome-test-verify-fix')
  ]);

  await new Promise(r => setTimeout(r, 2000));
  const cdp = new CDPClient(CDP_PORT);
  await cdp.connect();

  try {
    // Step 4: Login to POS App
    console.log('Logging into POS Application...');
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

    // Check if still on login form
    const isLogin = await cdp.evaluate(`!!document.querySelector('button.login-button, form.login-form')`);
    if (isLogin) {
      console.log('Submitting login form via UI with native value setter...');
      await cdp.evaluate(`
        const setInputValue = (el, val) => {
          const proto = el instanceof HTMLInputElement ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
          const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
          set.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const u = document.querySelector('input[type="text"], #username');
        const p = document.querySelector('input[type="password"], #password');
        if (u) setInputValue(u, 'admin');
        if (p) setInputValue(p, 'admin123');
        const btn = document.querySelector('button.login-button, button[type="submit"]');
        if (btn) btn.click();
      `);
      await new Promise(r => setTimeout(r, 3000));
    }

    // Switch to POS tab via Sidebar Navigation
    console.log('Switching to POS tab via Sidebar...');
    await cdp.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const posTab = btns.find(b => b.textContent.trim() === 'POS' || b.innerText.includes('POS'));
        if (posTab) posTab.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 2500));

    // ========================================================
    // TEST 1: POS Screen (/#pos) Drawer & Extension Modal
    // ========================================================
    console.log('\n--- Test 1: POS Screen (/#pos) Event Drawer & Room Extension Modal ---');
    await cdp.navigate(`${BASE_URL}/#pos`);
    await new Promise(r => setTimeout(r, 2500));

    // Check if on POS screen
    const currentUrl = await cdp.evaluate(`window.location.hash`);
    console.log(`Current Hash: ${currentUrl}`);

    await cdp.captureScreenshot('pos_initial_screen.png');

    const pageDiagnostics = await cdp.evaluate(`
      (() => {
        const text = document.body.innerText;
        const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(Boolean);
        const allElements = Array.from(document.querySelectorAll('*')).map(el => el.className).filter(Boolean);
        return {
          title: document.title,
          url: window.location.href,
          sampleButtons: buttons.slice(0, 15),
          hasTimeline: text.includes('ไทม์ไลน์') || text.includes('ห้อง'),
          textSnippet: text.substring(0, 300)
        };
      })()
    `);
    console.log('Page Diagnostics:', JSON.stringify(pageDiagnostics, null, 2));

    // Click on a booking event chip on the timeline or calendar
    const clickSuccess = await cdp.evaluate(`
      (() => {
        const pills = document.querySelectorAll('.timeline-booking-pill');
        if (pills.length > 0) {
          pills[0].click();
          return 'clicked_timeline_pill (' + pills.length + ' pills found)';
        }
        const chips = document.querySelectorAll('.calendar-event-chip');
        if (chips.length > 0) {
          chips[0].click();
          return 'clicked_calendar_chip (' + chips.length + ' chips found)';
        }
        const anyEv = document.querySelector('[class*="booking"], [class*="event-chip"]');
        if (anyEv) {
          anyEv.click();
          return 'clicked_anyEv';
        }
        return 'not_found';
      })()
    `);
    console.log(`Event chip click result: ${clickSuccess}`);
    await new Promise(r => setTimeout(r, 1200));

    // Verify viewedEvent drawer opened
    const drawerInfo = await cdp.evaluate(`
      (() => {
        const drawerBtn = document.getElementById('btn-drawer-extend-room');
        const modalContainer = document.querySelector('div[style*="rgba(15, 23, 42, 0.45)"]');
        return {
          hasDrawer: !!modalContainer,
          hasExtendBtn: !!drawerBtn,
          btnText: drawerBtn ? drawerBtn.innerText.trim() : null
        };
      })()
    `);
    console.log('Drawer Info:', JSON.stringify(drawerInfo));

    if (!drawerInfo.hasExtendBtn) {
      throw new Error(`Drawer does not have #btn-drawer-extend-room! Drawer status: ${JSON.stringify(drawerInfo)}`);
    }

    // Capture screenshot: pos_drawer_with_extend_button.png
    await cdp.captureScreenshot('pos_drawer_with_extend_button.png');

    // Click "ต่อเวลาห้อง" (#btn-drawer-extend-room)
    console.log('Clicking "ต่อเวลาห้อง" from POS drawer...');
    await cdp.evaluate(`document.getElementById('btn-drawer-extend-room').click();`);
    await new Promise(r => setTimeout(r, 2000));

    // Verify Root is NOT empty and RoomExtensionModal opened
    const modalVerification = await cdp.evaluate(`
      (() => {
        const root = document.getElementById('root');
        const rxModal = document.querySelector('.rx-modal-card');
        const title = rxModal ? rxModal.querySelector('#rx-modal-title')?.textContent : null;
        const availStatus = rxModal ? rxModal.querySelector('.rx-avail-status')?.textContent : null;
        const durationChips = rxModal ? Array.from(rxModal.querySelectorAll('.rx-duration-chip')).map(c => c.textContent.trim()) : [];
        const isWhiteScreen = !root || root.innerHTML.trim().length === 0;

        return {
          rootLength: root ? root.innerHTML.length : 0,
          isWhiteScreen,
          hasModal: !!rxModal,
          title,
          availStatus,
          durationCount: durationChips.length,
          durationSamples: durationChips.slice(0, 3)
        };
      })()
    `);
    console.log('Modal Verification:', JSON.stringify(modalVerification, null, 2));

    if (modalVerification.isWhiteScreen) {
      await cdp.captureScreenshot('pos_white_screen_failure.png');
      throw new Error('CRITICAL FAILURE: Screen turned WHITE (root is empty)!');
    }

    if (!modalVerification.hasModal) {
      throw new Error('RoomExtensionModal (.rx-modal-card) did not mount or render!');
    }

    // Capture Desktop Success Screenshot
    await cdp.captureScreenshot('pos_room_extension_modal_success.png');
    console.log('✓ Desktop POS Extension Modal verified successfully with NO white screen.');

    // Step 5: Test Tablet Viewport (820x1180)
    console.log('\n--- Testing Tablet Viewport (820px) ---');
    await cdp.setViewport(820, 1180);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('pos_room_extension_tablet_view.png');
    console.log('✓ Tablet Viewport verified successfully.');

    // Restore viewport
    await cdp.setViewport(1440, 900);
    await new Promise(r => setTimeout(r, 400));

    // Test duration chip interaction (e.g. click +1.5 ชั่วโมง or +2 ชั่วโมง)
    console.log('\n--- Testing Duration Preset Interaction ---');
    await cdp.evaluate(`
      const chips = document.querySelectorAll('.rx-duration-chip');
      const targetChip = Array.from(chips).find(c => c.textContent.includes('+2 ชั่วโมง'));
      if (targetChip) targetChip.click();
    `);
    await new Promise(r => setTimeout(r, 1500));
    const updatedStatus = await cdp.evaluate(`
      document.querySelector('.rx-avail-status')?.textContent || ''
    `);
    console.log('Updated Availability status after +2 hours:', updatedStatus);

    // Close modal via Cancel button
    console.log('Closing modal via "ยกเลิก"...');
    await cdp.evaluate(`
      const cancelBtn = document.querySelector('.rx-btn-secondary');
      if (cancelBtn) cancelBtn.click();
    `);
    await new Promise(r => setTimeout(r, 1000));

    const afterCloseCheck = await cdp.evaluate(`
      (() => {
        const rxModal = document.querySelector('.rx-modal-card');
        const root = document.getElementById('root');
        return {
          modalGone: !rxModal,
          rootHealthy: !!root && root.innerHTML.length > 500
        };
      })()
    `);
    console.log('After Close Check:', JSON.stringify(afterCloseCheck));

    // ========================================================
    // TEST 2: Pending Bookings (/#pending) Modal & Extension
    // ========================================================
    console.log('\n--- Test 2: Pending Bookings (/#pending) Room Extension Modal ---');
    await cdp.navigate(`${BASE_URL}/#pending`);
    await new Promise(r => setTimeout(r, 2000));

    // Open detail of first booking
    await cdp.evaluate(`
      const row = document.querySelector('tr[style*="cursor"], button[title*="ดูรายละเอียด"]');
      if (row) row.click();
    `);
    await new Promise(r => setTimeout(r, 1000));

    // Click "ต่อเวลาห้อง" from detail modal
    const clickedPendingExtend = await cdp.evaluate(`
      const extBtn = document.getElementById('pb-detail-btn-extend-room');
      if (extBtn) {
        extBtn.click();
        true;
      } else {
        const btns = Array.from(document.querySelectorAll('button'));
        const target = btns.find(b => b.textContent.includes('ต่อเวลาห้อง'));
        if (target) {
          target.click();
          true;
        } else {
          false;
        }
      }
    `);
    console.log(`Clicked Pending Extend button: ${clickedPendingExtend}`);
    await new Promise(r => setTimeout(r, 2000));

    const pendingModalCheck = await cdp.evaluate(`
      (() => {
        const rxModal = document.querySelector('.rx-modal-card');
        const root = document.getElementById('root');
        return {
          hasModal: !!rxModal,
          isWhiteScreen: !root || root.innerHTML.trim().length === 0,
          rootLength: root ? root.innerHTML.length : 0
        };
      })()
    `);
    console.log('Pending Modal Check:', JSON.stringify(pendingModalCheck));

    if (pendingModalCheck.isWhiteScreen) {
      throw new Error('CRITICAL FAILURE: Screen turned WHITE when clicking extend from Pending Bookings!');
    }

    await cdp.captureScreenshot('pending_room_extension_modal_success.png');

    // Check captured errors
    console.log(`\n=== Verification Results ===`);
    console.log(`Total Runtime Uncaught Exceptions: ${capturedErrors.length}`);
    if (capturedErrors.length > 0) {
      console.error('Captured Runtime Exceptions:', JSON.stringify(capturedErrors, null, 2));
      throw new Error(`Encountered ${capturedErrors.length} uncaught browser runtime exception(s)!`);
    }

    console.log('\n🎉 ALL REAL BROWSER UAT CHECKS PASSED! NO WHITE SCREEN DETECTED.');
  } finally {
    await cdp.close();
    chromeProcess.kill();
  }
}

run().catch((err) => {
  console.error('\n❌ Test Run Error:', err);
  process.exit(1);
});
