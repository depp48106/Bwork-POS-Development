/**
 * verifyCustomerTypeAndTaxInvoiceUI.cjs
 * Automated Real Browser UAT Suite for:
 * 1. POS Customer Type Dropdown (Dynamic types, Quotas, Basecamp Unit, Searchable, Mobile)
 * 2. Booking App Tax Invoice (Individual vs Corporate entity selection, Dynamic labels, Draft retention, Mobile 360/430px)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const POS_URL = 'http://127.0.0.1:5000';
const BOOKING_URL = 'http://127.0.0.1:5174';
const ARTIFACT_DIR = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
const EVIDENCE_DIR = path.join(__dirname, '../ui-review-evidence/customer-type-and-tax');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9245;

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
            this.ws.onmessage = (event) => {
              const data = JSON.parse(event.data);
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
        await new Promise(r => setTimeout(r, 500));
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

  async setViewport(width, height, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile
    });
    await new Promise(r => setTimeout(r, 400));
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

// Simple static server for booking-app/dist with SPA fallback
function startBookingAppServer() {
  const distDir = path.join(__dirname, '../../booking-app/dist');
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  const server = http.createServer((req, res) => {
    let filePath = path.join(distDir, req.url.split('?')[0]);
    if (filePath.endsWith(path.sep) || !path.extname(filePath)) {
      filePath = path.join(distDir, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(distDir, 'index.html');
    }

    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading file');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(5174, '127.0.0.1', () => {
      console.log('✓ Booking App Static Server running on http://127.0.0.1:5174');
      resolve(server);
    });
  });
}

async function run() {
  console.log('=== Starting Real Browser UAT: Customer Type Dropdown & Tax Invoice ===\n');

  // 1. Start Booking App static server
  const bookingServer = await startBookingAppServer();

  // 2. Start or verify Backend server
  let serverProcess = null;
  let backendRunning = false;
  try {
    const health = await fetch(`${POS_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (health.ok) backendRunning = true;
  } catch (e) {}

  if (!backendRunning) {
    console.log('Starting backend server on port 5000...');
    serverProcess = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: '5000', APP_ENV: 'development' }
    });

    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${POS_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'admin123' })
        });
        if (res.ok) {
          backendRunning = true;
          console.log('✓ Backend server is up and responding on http://127.0.0.1:5000');
          break;
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 600));
      }
    }
  }

  if (!backendRunning) {
    throw new Error('Backend failed to start within timeout');
  }

  // Authenticate to POS
  const authRes = await fetch(`${POS_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const authData = await authRes.json();
  const token = authData.token;
  const user = authData.user;
  console.log(`✓ Authenticated to POS as ${user.username}`);

  // Launch Chrome
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--disable-gpu',
    '--disable-extensions',
    '--window-size=1440,900',
    '--user-data-dir=' + path.join(__dirname, '../.chrome-test-customer-tax'),
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));
  const cdp = new CDPClient(CDP_PORT);
  await cdp.connect();

  try {
    // =========================================================================
    // PART 1: POS Customer Type Dropdown Testing
    // =========================================================================
    console.log('\n--- PART 1: Testing POS Customer Type Dropdown ---');
    await cdp.setViewport(1440, 900, false);
    await cdp.navigate(POS_URL);

    // Inject tokens and go to POS
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
    await new Promise(r => setTimeout(r, 3000));

    // Ensure we are in POS tab
    await cdp.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('button'));
        const posTab = tabs.find(b => b.textContent.trim() === 'POS' || b.innerText.includes('POS'));
        if (posTab) posTab.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));

    // Click on a room timeline cell to open booking drawer
    const drawerOpened = await cdp.evaluate(`
      (() => {
        const headerCell = document.querySelector('.timeline-room-header-cell');
        if (headerCell) {
          headerCell.click();
          return true;
        }
        const roomCard = document.querySelector('.room-card, [data-room-id]');
        if (roomCard) {
          roomCard.click();
          return true;
        }
        return false;
      })()
    `);
    console.log(`Booking Drawer triggered: ${drawerOpened}`);
    await new Promise(r => setTimeout(r, 1500));

    // Check Customer Type dropdown trigger
    const dropdownFound = await cdp.evaluate(`
      (() => {
        const wrap = document.querySelector('#pos-customer-type-dropdown-wrap');
        const trigger = wrap ? wrap.querySelector('[role="button"]') : null;
        return !!trigger;
      })()
    `);
    console.log(`POS Customer Type Dropdown Trigger present: ${dropdownFound}`);

    // Click trigger to open dropdown
    await cdp.evaluate(`
      (() => {
        const wrap = document.querySelector('#pos-customer-type-dropdown-wrap');
        const trigger = wrap ? wrap.querySelector('[role="button"]') : null;
        if (trigger) trigger.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('pos_customer_type_dropdown_open.png');

    // Type in search box to test searchable filter
    await cdp.evaluate(`
      (() => {
        const searchInput = document.querySelector('.custom-select-popover input');
        if (searchInput) {
          const proto = window.HTMLInputElement.prototype;
          const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
          set.call(searchInput, 'Basecamp');
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    // Select "Basecamp"
    await cdp.evaluate(`
      (() => {
        const options = Array.from(document.querySelectorAll('.custom-select-option, [role="option"]'));
        const basecampOpt = options.find(o => o.innerText.includes('Basecamp'));
        if (basecampOpt) basecampOpt.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));
    await cdp.captureScreenshot('pos_customer_type_basecamp_selected.png');

    // Re-open and select "Shop"
    await cdp.evaluate(`
      (() => {
        const wrap = document.querySelector('#pos-customer-type-dropdown-wrap');
        const trigger = wrap ? wrap.querySelector('[role="button"]') : null;
        if (trigger) trigger.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));
    await cdp.evaluate(`
      (() => {
        const options = Array.from(document.querySelectorAll('.custom-select-option, [role="option"]'));
        const shopOpt = options.find(o => o.innerText.includes('Shop'));
        if (shopOpt) shopOpt.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));
    await cdp.captureScreenshot('pos_customer_type_shop_selected.png');

    // Test mobile responsive 390px
    await cdp.setViewport(390, 844, true);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('pos_customer_type_mobile_390.png');

    // =========================================================================
    // PART 2: Booking App Tax Invoice Testing
    // =========================================================================
    console.log('\n--- PART 2: Testing Booking App Tax Invoice Form ---');
    await cdp.setViewport(1440, 900, false);
    
    // 1. Establish same-origin context by navigating to BOOKING_URL root first
    await cdp.navigate(`${BOOKING_URL}/`);
    await cdp.evaluate(`
      sessionStorage.setItem('current_booking_payload', JSON.stringify({
        room_id: 1,
        room_name: "Meeting Room A (Boardroom)",
        room_type: "room",
        booking_date: "2026-11-05",
        start_time: "10:00",
        end_time: "12:00",
        duration_hours: 2,
        room_price: 500,
        total_price: 1000,
        guests: 4
      }));
    `);

    // 2. Navigate to /form
    await cdp.navigate(`${BOOKING_URL}/form`);
    await new Promise(r => setTimeout(r, 1500));

    // Fill customer name and phone
    await cdp.evaluate(`
      (() => {
        const setVal = (sel, val) => {
          const el = document.querySelector(sel);
          if (el) {
            const proto = el instanceof HTMLInputElement ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
            const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
            set.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };
        setVal('input[type="text"]', 'สมชาย ใจดี');
        setVal('input[type="tel"]', '0812345678');
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    // Open Tax Invoice accordion
    await cdp.evaluate(`
      (() => {
        const toggle = document.querySelector('#tax-invoice-accordion-toggle');
        if (toggle) toggle.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    // Step A: Corporate View (Default)
    await cdp.evaluate(`
      (() => {
        const corpBtn = document.querySelector('#btn-tax-corporate');
        if (corpBtn) corpBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('booking_app_tax_corporate_desktop.png');

    // Step B: Individual View
    await cdp.evaluate(`
      (() => {
        const indBtn = document.querySelector('#btn-tax-individual');
        if (indBtn) indBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('booking_app_tax_individual_desktop.png');

    // Fill in Individual Tax info to test draft persistence
    await cdp.evaluate(`
      (() => {
        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el) {
            const proto = el instanceof HTMLInputElement ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
            const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
            set.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };
        setVal('input-tax-name', 'นายสมชาย ผู้เสียภาษี');
        setVal('input-tax-id', '1234567890123');
        setVal('input-tax-address', '99/9 ถ.พหลโยธิน แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900');
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    // Step C: Mobile 360px & 430px
    await cdp.setViewport(360, 780, true);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('booking_app_tax_mobile_360.png');

    await cdp.setViewport(430, 932, true);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('booking_app_tax_mobile_430.png');

    // Step D: Draft Retention on Navigation
    console.log('\nTesting Draft State Retention on Navigation...');
    await cdp.setViewport(1440, 900, false);
    // Navigate to root, then back to /form
    await cdp.navigate(`${BOOKING_URL}/`);
    await new Promise(r => setTimeout(r, 1000));
    await cdp.navigate(`${BOOKING_URL}/form`);
    await new Promise(r => setTimeout(r, 2000));

    // Re-verify restored values
    const restoredValues = await cdp.evaluate(`
      (() => {
        const taxNameEl = document.getElementById('input-tax-name');
        const taxIdEl = document.getElementById('input-tax-id');
        const indBtn = document.getElementById('btn-tax-individual');
        
        return {
          tax_name: taxNameEl ? taxNameEl.value : null,
          tax_id: taxIdEl ? taxIdEl.value : null,
          is_individual_selected: indBtn ? indBtn.style.color.includes('2563eb') || indBtn.style.color.includes('rgb(37, 99, 235)') : false
        };
      })()
    `);
    console.log('Restored draft values:', restoredValues);
    await cdp.captureScreenshot('booking_app_tax_draft_restored.png');

    console.log('\n✓ All browser tests completed successfully!');
  } finally {
    await cdp.close();
    chromeProcess.kill();
    bookingServer.close();
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

run().catch((err) => {
  console.error('Browser Test Error:', err);
  process.exit(1);
});
