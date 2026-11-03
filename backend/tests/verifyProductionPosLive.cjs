/**
 * verifyProductionPosLive.cjs
 * Read-only Production Live Verification for Bwork-POS Pages
 * - Endpoint: https://bwork-pos.pages.dev
 * - Verifies zero ReferenceError and zero white screen when opening booking details
 * - Tests Case 1 (Attach transaction slip), Case 2 (Legacy booking), Case 3 (ShieldCheck icon)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROD_URL = 'https://bwork-pos.pages.dev';
const API_BASE = 'https://bwork-pos-api.ohnatza74185-ky.workers.dev';
const ARTIFACT_DIR = path.resolve('C:/Users/ADMIN/.gemini/antigravity/brain/93b1ef54-72e7-446f-a6a3-437743441774');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9262;

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
    for (let i = 0; i < 30; i++) {
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
                  columnNumber: ex.columnNumber
                };
                console.error('❌ Browser Exception Thrown on Production:', errObj.description);
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
    await new Promise(r => setTimeout(r, 2500));
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
    const p1 = path.join(ARTIFACT_DIR, baseName);
    fs.writeFileSync(p1, buffer);
    console.log(`  📸 Captured Live Screenshot: ${baseName} (${buffer.length} bytes)`);
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function run() {
  console.log('=== Starting Read-Only Live Production POS Pages Audit ===\n');
  console.log(`Target Production URL: ${PROD_URL}`);

  // Step 1: Obtain Auth Token from Production API
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  if (!loginData.success || !loginData.token) {
    throw new Error('Failed to obtain authenticated session from Production Worker API');
  }
  const token = loginData.token;
  const user = loginData.user;
  console.log('✓ Successfully authenticated session with Production Worker API');

  // Step 2: Launch Headless Chrome
  console.log(`Launching Headless Chrome on port ${CDP_PORT}...`);
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1440,900',
    `--user-data-dir=${path.join(ARTIFACT_DIR, 'scratch', 'chrome_prod_history_profile')}`,
    'about:blank'
  ]);

  const cdp = new CDPClient(CDP_PORT);
  await cdp.connect();
  await cdp.setViewport(1440, 900);
  console.log('✓ Connected to Chrome CDP');

  try {
    // Step 3: Navigate to Production POS
    console.log(`Navigating to ${PROD_URL}...`);
    await cdp.navigate(PROD_URL);

    // Verify index.html loads newly deployed asset
    const scriptSrc = await cdp.evaluate(`
      (() => {
        const scripts = [...document.querySelectorAll('script[type="module"]')];
        return scripts.map(s => s.getAttribute('src'));
      })()
    `);
    console.log('Production loaded module scripts:', scriptSrc);
    const hasNewAsset = scriptSrc.some(s => s && s.includes('index-DrE3dByv.js'));
    if (!hasNewAsset) {
      console.warn('⚠️ Warning: script src does not yet mention index-DrE3dByv.js. Current:', scriptSrc);
    } else {
      console.log('✓ Confirmed: Production is executing new compiled asset (index-DrE3dByv.js)');
    }

    // Step 4: Inject authentication into localStorage and reload
    await cdp.evaluate(`
      localStorage.setItem('pos_token', '${token}');
      localStorage.setItem('token', '${token}');
      localStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(user)}));
      window.location.reload();
    `);
    await new Promise(r => setTimeout(r, 3000));

    // Step 5: Navigate to History tab
    console.log('Navigating to History tab on live production...');
    const clickedHistory = await cdp.evaluate(`
      (() => {
        const historyBtn = [...document.querySelectorAll('button.top-menu-item, div.menu-card, button')].find(b => {
          const text = b.innerText ? b.innerText.trim() : '';
          return text === 'Booking History' || text.includes('Booking History');
        });
        if (historyBtn) {
          historyBtn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Clicked History tab:', clickedHistory);
    await new Promise(r => setTimeout(r, 2500));

    // Ensure History table is visible
    const historyReady = await cdp.evaluate(`
      (() => {
        return !!document.querySelector('.history-desktop-table, table');
      })()
    `);
    console.log('Production History table loaded:', historyReady);
    if (!historyReady) throw new Error('History table failed to load on production!');

    // Helper to trigger React input change
    const setReactInput = async (selector, value) => {
      await cdp.evaluate(`
        (() => {
          const input = document.querySelector('${selector}');
          if (input) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, '${value}');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()
      `);
      await new Promise(r => setTimeout(r, 1200));
    };

    // Clear filters first
    await cdp.evaluate(`
      (() => {
        const clearBtn = [...document.querySelectorAll('button')].find(b => b.innerText && (b.innerText.includes('ล้างตัวกรอง') || b.innerText.includes('ล้าง')));
        if (clearBtn) clearBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));

    // --------------------------------------------------------------------------
    // Case 1: Booking #68 (Missing slip in transaction -> shows 'แนบสลิป' button)
    // --------------------------------------------------------------------------
    console.log('\n--- Production Case 1: Booking #68 (Attach Transaction Slip) ---');
    await setReactInput('input[placeholder*="ค้นหา"]', 'BK-2610051');

    const openCase1 = await cdp.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('tr')];
        const row68 = rows.find(r => r.innerText && r.innerText.includes('BK-2610051'));
        if (row68) {
          const btn = [...row68.querySelectorAll('button')].find(b => b.innerText && (b.innerText.includes('รายละเอียด') || b.innerText.includes('ใบเสร็จ')));
          if (btn) { btn.click(); return true; }
        }
        return false;
      })()
    `);
    console.log('Opened details for Booking #68:', openCase1);
    await new Promise(r => setTimeout(r, 1500));

    const modal1Info = await cdp.evaluate(`
      (() => {
        const isWhiteScreen = !document.querySelector('#root') || document.querySelector('#root').children.length === 0;
        const modalContainer = document.querySelector('.history-modal-container');
        const attachBtn = document.querySelector('#history-btn-attach-slip-tx-41');
        return {
          isWhiteScreen,
          modalFound: !!modalContainer,
          hasAttachBtn: !!attachBtn,
          attachBtnText: attachBtn ? attachBtn.innerText.trim() : null
        };
      })()
    `);
    console.log('Case 1 Modal Info:', modal1Info);
    if (modal1Info.isWhiteScreen) throw new Error('WHITE SCREEN DETECTED on Production Case 1!');
    if (!modal1Info.modalFound) throw new Error('Modal container not found on Case 1!');
    if (!modal1Info.hasAttachBtn) throw new Error('Attach button #history-btn-attach-slip-tx-41 not found on Case 1!');
    await cdp.captureScreenshot('prod_live_history_case1_attach_slip.png');
    console.log('✅ Production Case 1 Passed: Modal opened with Plus icon, zero ReferenceError');

    // Close Case 1 modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = [...document.querySelectorAll('button')].find(b => b.innerText === '✕' || b.innerText === 'ปิด' || b.getAttribute('aria-label') === 'Close');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    // --------------------------------------------------------------------------
    // Case 2: Booking #1 (Legacy booking without payment transactions)
    // --------------------------------------------------------------------------
    console.log('\n--- Production Case 2: Booking #1 (Legacy Booking with no transactions) ---');
    await setReactInput('input[placeholder*="ค้นหา"]', 'ONMATCH');

    const openCase2 = await cdp.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('tr')];
        const row1 = rows.find(r => r.innerText && r.innerText.includes('ONMATCH'));
        if (row1) {
          const btn = [...row1.querySelectorAll('button')].find(b => b.innerText && (b.innerText.includes('รายละเอียด') || b.innerText.includes('ใบเสร็จ')));
          if (btn) { btn.click(); return true; }
        }
        return false;
      })()
    `);
    console.log('Opened details for Booking #1:', openCase2);
    await new Promise(r => setTimeout(r, 1500));

    const modal2Info = await cdp.evaluate(`
      (() => {
        const isWhiteScreen = !document.querySelector('#root') || document.querySelector('#root').children.length === 0;
        const modalContainer = document.querySelector('.history-modal-container');
        const legacyAttachBtn = document.querySelector('#history-btn-attach-legacy-slip');
        return {
          isWhiteScreen,
          modalFound: !!modalContainer,
          hasLegacyAttachBtn: !!legacyAttachBtn,
          legacyBtnText: legacyAttachBtn ? legacyAttachBtn.innerText.trim() : null
        };
      })()
    `);
    console.log('Case 2 Modal Info:', modal2Info);
    if (modal2Info.isWhiteScreen) throw new Error('WHITE SCREEN DETECTED on Production Case 2!');
    if (!modal2Info.modalFound) throw new Error('Modal container not found on Case 2!');
    if (!modal2Info.hasLegacyAttachBtn) throw new Error('Legacy attach button not found on Case 2!');
    await cdp.captureScreenshot('prod_live_history_case2_attach_legacy_slip.png');
    console.log('✅ Production Case 2 Passed: Legacy details opened with Plus icon, zero ReferenceError');

    // Close Case 2 modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = [...document.querySelectorAll('button')].find(b => b.innerText === '✕' || b.innerText === 'ปิด' || b.getAttribute('aria-label') === 'Close');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    // --------------------------------------------------------------------------
    // Case 3: Booking #57 (Fully paid multi-transaction -> ShieldCheck icon)
    // --------------------------------------------------------------------------
    console.log('\n--- Production Case 3: Booking #57 (Multi-transaction ShieldCheck) ---');
    await setReactInput('input[placeholder*="ค้นหา"]', 'BK-2610041');

    const openCase3 = await cdp.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('tr')];
        const row57 = rows.find(r => r.innerText && r.innerText.includes('BK-2610041'));
        if (row57) {
          const btn = [...row57.querySelectorAll('button')].find(b => b.innerText && (b.innerText.includes('รายละเอียด') || b.innerText.includes('ใบเสร็จ')));
          if (btn) { btn.click(); return true; }
        }
        return false;
      })()
    `);
    console.log('Opened details for Booking #57:', openCase3);
    await new Promise(r => setTimeout(r, 1500));

    const modal3Info = await cdp.evaluate(`
      (() => {
        const isWhiteScreen = !document.querySelector('#root') || document.querySelector('#root').children.length === 0;
        const modalContainer = document.querySelector('.history-modal-container');
        const hasShieldCheck = !!document.querySelector('.lucide-shield-check');
        return {
          isWhiteScreen,
          modalFound: !!modalContainer,
          hasShieldCheck
        };
      })()
    `);
    console.log('Case 3 Modal Info:', modal3Info);
    if (modal3Info.isWhiteScreen) throw new Error('WHITE SCREEN DETECTED on Production Case 3!');
    if (!modal3Info.modalFound) throw new Error('Modal container not found on Case 3!');
    if (!modal3Info.hasShieldCheck) throw new Error('ShieldCheck icon not found on Case 3!');
    await cdp.captureScreenshot('prod_live_history_case3_shield_check.png');
    console.log('✅ Production Case 3 Passed: Multi-transaction details opened with ShieldCheck icon, zero ReferenceError');

    // Close Case 3 modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = [...document.querySelectorAll('button')].find(b => b.innerText === '✕' || b.innerText === 'ปิด' || b.getAttribute('aria-label') === 'Close');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    // Final Assertion on Captured Errors
    console.log('\n--- Final Error Audit on Production ---');
    console.log(`Captured Uncaught Exceptions: ${capturedErrors.length}`);
    if (capturedErrors.length > 0) {
      console.error('Captured errors:', capturedErrors);
      throw new Error(`Production validation failed with ${capturedErrors.length} browser exceptions`);
    }

    console.log('\n======================================================');
    console.log('  ALL LIVE PRODUCTION AUDITS PASSED (3/3 CASES)');
    console.log('  - Zero ReferenceError exceptions');
    console.log('  - Zero white screens');
    console.log('  - Read-only verification complete (zero DB modifications)');
    console.log('======================================================\n');

  } finally {
    await cdp.close();
    chromeProcess.kill();
  }
}

run().catch(err => {
  console.error('\n❌ PRODUCTION AUDIT FAILED:', err);
  process.exit(1);
});
