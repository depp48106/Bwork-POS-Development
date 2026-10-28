/**
 * captureCustomerWideModalScreenshots.cjs
 * Automated Headless Chrome Visual Verification for Customer Create Wide Modal Redesign
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 5001; // Use 5001 to avoid conflicts
const BASE_URL = `http://localhost:${PORT}`;
const ARTIFACT_DIR = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
const EVIDENCE_DIR = path.join(__dirname, '../ui-review-evidence/customer-wide-modal');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9235;

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

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
    await new Promise(r => setTimeout(r, 1500));
  }

  async setViewport(width, height, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: isMobile
    });
    await new Promise(r => setTimeout(r, 400));
  }

  async captureScreenshot(fileName) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(data, 'base64');
    const artifactPath = path.join(ARTIFACT_DIR, fileName);
    const evidencePath = path.join(EVIDENCE_DIR, fileName);
    fs.writeFileSync(artifactPath, buffer);
    fs.writeFileSync(evidencePath, buffer);
    console.log(`  📸 Captured: ${fileName} (${Math.round(buffer.length / 1024)} KB)`);
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

async function startServer() {
  const env = { ...process.env, PORT: String(PORT) };
  const server = spawn('node', [path.join(__dirname, '../server.js')], { env });
  server.stdout.on('data', d => {
    // console.log('[Server]', d.toString().trim());
  });
  server.stderr.on('data', d => {
    // console.error('[Server Error]', d.toString().trim());
  });

  // Wait for server ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
      });
      const data = await res.json();
      if (data.token) {
        return { server, token: data.token, user: data.user };
      }
    } catch (_) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  server.kill();
  throw new Error('Server failed to start on port ' + PORT);
}

async function run() {
  console.log('=== Capturing Visual Evidence for Customer Create Wide Modal Redesign ===\n');

  console.log(`Starting backend server on port ${PORT}...`);
  const { server, token, user } = await startServer();
  console.log(`✓ Server running. Authenticated as ${user.username} (${user.role}).`);

  const chromeProfile = path.join(__dirname, '../.chrome-test-wide-modal');
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1920,1080',
    `--user-data-dir=${chromeProfile}`
  ]);

  const cdp = new CDPClient(CDP_PORT);

  try {
    await cdp.connect();
    console.log('✓ Connected to Chrome CDP.');

    // Navigate and set token
    await cdp.navigate(BASE_URL);
    await cdp.evaluate(`(() => {
      localStorage.setItem('pos_token', '${token}');
      localStorage.setItem('token', '${token}');
      localStorage.setItem('pos_user', ${JSON.stringify(JSON.stringify(user))});
      location.reload();
    })()`);
    await new Promise(r => setTimeout(r, 2000));

    // Navigate to Customer Management menu
    console.log('Navigating to Customer Management menu...');
    await cdp.evaluate(`(() => {
      const topButtons = Array.from(document.querySelectorAll('button.top-menu-item, button'));
      const target = topButtons.find(el => el.textContent && el.textContent.includes('จัดการลูกค้า'));
      if (target) target.click();
    })()`);
    await new Promise(r => setTimeout(r, 1500));

    // =========================================================================
    // 1. DESKTOP VIEWPORT (1920 x 1080) - CUSTOMER CREATE WIDE MODAL
    // =========================================================================
    console.log('\n[1/5] Capturing Customer Create Wide Modal (Desktop 1920x1080)...');
    await cdp.setViewport(1920, 1080);
    // Click "เพิ่มลูกค้า / ร้านค้า" button
    await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const createBtn = buttons.find(b => b.textContent && b.textContent.includes('เพิ่มลูกค้า'));
      if (createBtn) createBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    // Fill some sample data for realistic display
    await cdp.evaluate(`(() => {
      const nameInput = document.querySelector('input[placeholder*="บจก. เทคโนโลยีอนาคต"]');
      if (nameInput) {
        nameInput.value = 'บริษัท ดิจิทัล บิซเวิร์ก จำกัด (Basecamp Office 401)';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const contactInput = document.querySelector('input[placeholder*="คุณสมชาย"]');
      if (contactInput) {
        contactInput.value = 'คุณวีระศักดิ์ สุขประเสริฐ';
        contactInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const phoneInput = document.querySelector('input[placeholder*="08X-XXX-XXXX"]');
      if (phoneInput) {
        phoneInput.value = '089-123-4567';
        phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const emailInput = document.querySelector('input[placeholder*="contact@company.com"]');
      if (emailInput) {
        emailInput.value = 'bizwork@digital.co.th';
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const taxInput = document.querySelector('input[placeholder*="13 หลัก"]');
      if (taxInput) {
        taxInput.value = '0105565012345';
        taxInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await new Promise(r => setTimeout(r, 400));
    await cdp.captureScreenshot('crm_customer_create_wide_desktop_1920.png');

    // =========================================================================
    // 2. LAPTOP VIEWPORT (1366 x 768) - SCROLL ARCHITECTURE & STICKY FOOTER
    // =========================================================================
    console.log('\n[2/5] Capturing Customer Create Modal on Standard Laptop (1366x768)...');
    await cdp.setViewport(1366, 768);
    await new Promise(r => setTimeout(r, 500));
    await cdp.captureScreenshot('crm_customer_create_wide_laptop_1366x768.png');

    // =========================================================================
    // 3. TABLET VIEWPORT (820 x 1180) - RESPONSIVE 2-COL / CONTRACT CARD
    // =========================================================================
    console.log('\n[3/5] Capturing Customer Create Modal on Tablet (820x1180)...');
    await cdp.setViewport(820, 1180);
    await new Promise(r => setTimeout(r, 500));
    await cdp.captureScreenshot('crm_customer_create_tablet_820.png');

    // =========================================================================
    // 4. MOBILE VIEWPORT (390 x 844) - SINGLE-COLUMN SHEET
    // =========================================================================
    console.log('\n[4/5] Capturing Customer Create Modal on Mobile iPhone 14 (390x844)...');
    await cdp.setViewport(390, 844, true);
    await new Promise(r => setTimeout(r, 500));
    await cdp.captureScreenshot('crm_customer_create_mobile_390.png');

    // Reset Viewport to Desktop for Edit Modal
    await cdp.setViewport(1920, 1080, false);
    await new Promise(r => setTimeout(r, 400));

    // Close Create Modal
    await cdp.evaluate(`(() => {
      const closeBtn = document.querySelector('.crm-modal-close-btn');
      if (closeBtn) closeBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    // =========================================================================
    // 5. CUSTOMER EDIT MODAL (1920 x 1080) - CLEAN 2-COLUMN PROFILE
    // =========================================================================
    console.log('\n[5/5] Capturing Customer Edit Modal (Desktop 1920x1080)...');
    await cdp.evaluate(`(() => {
      const editBtns = Array.from(document.querySelectorAll('.crm-btn-row-action'));
      const editBtn = editBtns.find(b => b.textContent && b.textContent.includes('แก้ไข'));
      if (editBtn) editBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('crm_customer_edit_wide_desktop.png');

    console.log('\n✅ All 5 visual evidence screenshots captured successfully!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    await cdp.close();
    chromeProcess.kill();
    server.kill();
  }
}

run();
