/**
 * captureRoomExtensionScreenshots.cjs
 * Automated Real Browser Screenshot Capture for Room Extension Workflow
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:5000';
const ARTIFACT_DIR = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
const EVIDENCE_DIR = path.join(__dirname, '../ui-review-evidence/room-extension');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9231;

class CDPClient {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    for (let i = 0; i < 20; i++) {
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
    await new Promise(r => setTimeout(r, 1800));
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
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

async function run() {
  console.log('=== Capturing Real Browser Screenshots of Room Extension Modal ===\n');

  // 1. Get real JWT token from backend
  const authRes = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const authData = await authRes.json();
  if (!authData.success) {
    throw new Error('Failed to login via API: ' + JSON.stringify(authData));
  }
  const token = authData.token;
  const user = authData.user;
  console.log(`✓ Authenticated as ${user.username} (${user.role}).`);

  // Ensure an active room booking exists for today
  const bListRes = await fetch(`${API_URL}/api/bookings`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const bList = await bListRes.json();
  const bookings = Array.isArray(bList) ? bList : (bList.bookings || []);
  let targetBooking = bookings.find(b => b.items && b.items.some(it => it.room_id) && b.payment_status !== 'cancelled');

  if (!targetBooking) {
    console.log('Creating a test room booking for extension...');
    const roomRes = await fetch(`${API_URL}/api/rooms`, { headers: { 'Authorization': `Bearer ${token}` } });
    const rooms = await roomRes.json();
    const rId = rooms[0]?.id || 1;

    const createRes = await fetch(`${API_URL}/api/bookings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer_name: 'คุณวิชัย เจริญกิจ',
        contact: '081-999-8888',
        customer_type: 'walkin',
        payment_method: 'cash',
        payment_status: 'paid',
        items: [{
          room_id: rId,
          start_time: '2026-10-27T12:00:00',
          end_time: '2026-10-27T13:00:00',
          price: 500,
          quantity: 1,
          subtotal: 500,
          booking_type: 'hourly',
          layout: 'standard'
        }]
      })
    });
    const cData = await createRes.json();
    targetBooking = cData.booking || { id: cData.id };
  }

  const targetId = targetBooking.id || targetBooking.booking_id;
  console.log(`✓ Using active room booking #${targetId} for extension visual review.`);

  // 2. Spawn Headless Chrome
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1440,900',
    '--user-data-dir=' + path.join(__dirname, '../.chrome-test-profile-ext')
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const cdp = new CDPClient(CDP_PORT);
  await cdp.connect();

  try {
    // 3. Navigate to App and inject Auth Token
    await cdp.navigate(BASE_URL);
    await cdp.evaluate(`
      localStorage.setItem('token', '${token}');
      localStorage.setItem('user', JSON.stringify(${JSON.stringify(user)}));
      sessionStorage.setItem('token', '${token}');
      sessionStorage.setItem('user', JSON.stringify(${JSON.stringify(user)}));
    `);

    // Navigate to Pending Bookings
    await cdp.navigate(`${BASE_URL}/#pending`);
    await new Promise(r => setTimeout(r, 1500));

    // Open detail modal for target booking
    await cdp.evaluate(`
      // Find row or open detail modal directly
      const btn = document.querySelector('button[title*="ดูรายละเอียด"], button[aria-label*="ดูรายละเอียด"], tr');
      if (btn) btn.click();
    `);
    await new Promise(r => setTimeout(r, 1000));

    // Open Room Extension Modal
    await cdp.evaluate(`
      // Click "ต่อเวลาห้อง" button
      const extBtn = document.getElementById('pb-detail-btn-extend-room');
      if (extBtn) {
        extBtn.click();
      } else {
        // Fallback: trigger directly via custom event or state if needed
        const allBtns = Array.from(document.querySelectorAll('button'));
        const found = allBtns.find(b => b.textContent.includes('ต่อเวลาห้อง'));
        if (found) found.click();
      }
    `);
    await new Promise(r => setTimeout(r, 1200));

    // 1. Desktop Viewport Screenshot
    await cdp.setViewport(1440, 900);
    await new Promise(r => setTimeout(r, 600));
    await cdp.captureScreenshot('room_extension_desktop_modal.png');

    // 2. Select +2 hours chip to showcase live preview recalculation
    await cdp.evaluate(`
      const chips = Array.from(document.querySelectorAll('.rx-duration-chip'));
      const chip2h = chips.find(c => c.textContent.includes('+2 ชั่วโมง'));
      if (chip2h) chip2h.click();
    `);
    await new Promise(r => setTimeout(r, 1000));
    await cdp.captureScreenshot('room_extension_desktop_2hours_preview.png');

    // 3. Select PromptPay payment to showcase slip dropzone
    await cdp.evaluate(`
      const methodBtns = Array.from(document.querySelectorAll('.rx-pay-method-chip'));
      const promptPayBtn = methodBtns.find(b => b.textContent.includes('PromptPay'));
      if (promptPayBtn) promptPayBtn.click();
    `);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('room_extension_desktop_promptpay_slip_dropzone.png');

    // 4. Tablet Viewport Screenshot (820px)
    await cdp.setViewport(820, 1180);
    await new Promise(r => setTimeout(r, 800));
    await cdp.captureScreenshot('room_extension_tablet_modal.png');

    // 5. Navigate to POS Timeline and view "ต่อเวลาห้อง" on event drawer
    await cdp.setViewport(1440, 900);
    await cdp.navigate(`${BASE_URL}/#pos`);
    await new Promise(r => setTimeout(r, 1500));

    // Click on a timeline event if exists
    await cdp.evaluate(`
      const eventEl = document.querySelector('.timeline-event, [class*="booking-block"], [class*="pos-event"]');
      if (eventEl) eventEl.click();
    `);
    await new Promise(r => setTimeout(r, 1000));
    await cdp.captureScreenshot('room_extension_pos_timeline_view.png');

    console.log('\n✓ All 5 screenshots successfully captured and stored in artifact directory.');
  } catch (err) {
    console.error('Error during screenshot capture:', err);
    throw err;
  } finally {
    await cdp.close();
    chromeProcess.kill();
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
