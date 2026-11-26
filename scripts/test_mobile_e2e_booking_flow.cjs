/**
 * BWORK-POS — AUTOMATED MOBILE E2E TEST: FULL FLOW, PHONE VALIDATION & KRUNGSRI PAYMENT UI
 *
 * Verifies on mobile viewport (390 x 844):
 * 1. Header has NO "B-WORK · จองออนไลน์ผ่าน LINE", Calendar has NO hours banner & diagonal "ผ่านมาแล้ว"
 * 2. Form accessibility: label[for="customer-name"], aria-label, placeholder
 * 3. Phone input: 9 digits rejected, letters stripped & leading zero preserved, 11 digits capped at 10
 * 4. Submission -> /confirm with mock Krungsri settings (329-1-38429-0):
 *    - Displays Krungsri logo, "ธนาคารกรุงศรีอยุธยา" (no branch), "329-1-38429-0"
 *    - Clicking "คัดลอกเลขบัญชี" copies exact "3291384290" and updates button to "คัดลอกแล้ว"
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require(path.resolve(__dirname, '../backend/node_modules/express'));
const { spawn } = require('child_process');

const PORT = 5188;
const CDP_PORT = 9266;
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
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`  [SCREENSHOT] Saved: ${outPath}`);
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

async function run() {
  console.log('================================================================');
  console.log('  BWORK MOBILE E2E TEST: CALENDAR -> FORM -> KRUNGSRI /confirm');
  console.log('================================================================\n');

  const app = express();
  app.use(express.json());
  const distDir = path.resolve(__dirname, '../booking-app/dist');
  app.use(express.static(distDir));

  const now = new Date();
  const deadlineStr = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  const mockBooking = {
    id: 88801,
    booking_id: 88801,
    booking_code: 'BK-TEST-E2E-888',
    receipt_number: 'BK-TEST-E2E-888',
    total_amount: 700,
    subtotal_amount: 700,
    room_name: 'Mars (301)',
    date: '2026-11-27',
    start_time: '10:00',
    end_time: '12:00',
    customer_name: 'คุณสมชาย ใจดี',
    customer_contact: '0812345678',
    payment_status: 'pending',
    payment_window_minutes: 15,
    created_at: now.toISOString(),
    paymentDeadline: deadlineStr,
    room: { id: 4, name: 'Mars (301)', capacity: 8 }
  };

  const mockRooms = [
    { id: 4, name: 'Mars (301)', capacity: 8, room_type: 'meeting', hourly_rate: 350, price_per_hour: 350 },
    { id: 10, name: 'Jupiter (300)', capacity: 40, room_type: 'auditorium', hourly_rate: 1500, price_per_hour: 1500 }
  ];

  app.get('/api/public/rooms', (req, res) => {
    res.json(mockRooms);
  });

  app.get('/api/public/rooms/availability-month', (req, res) => {
    res.json({ month: req.query.month, rooms: mockRooms, intervals: [], cleaning_buffer_minutes: 30 });
  });

  app.get('/api/public/rooms/schedule', (req, res) => {
    res.json({
      date: req.query.date,
      cleaning_buffer_minutes: 30,
      rooms: mockRooms.map(r => ({ ...r, bookings: [] }))
    });
  });

  app.get('/api/public/rooms/:id/schedule', (req, res) => {
    res.json({ success: true, bookings: [], cleaning_buffer_minutes: 30 });
  });

  // Mock Krungsri payment settings to verify visual match
  app.get('/api/public/settings/payment', (req, res) => {
    res.json({
      payment_bank_name: 'ธนาคารกรุงศรีอยุธยา (Krungsri)',
      payment_bank_account: '329-1-38429-0',
      payment_bank_account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
      promptpay_id: '0125554000401',
      payment_window_minutes: 15
    });
  });

  app.post('/api/public/bookings', (req, res) => {
    if (!/^\d{10}$/.test(String(req.body.contact || '').trim())) {
      return res.status(400).json({ error: 'กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก', code: 'ERR_INVALID_PHONE' });
    }
    const currentNow = new Date();
    res.json({
      success: true,
      booking_id: mockBooking.id,
      receipt_number: mockBooking.receipt_number,
      booking_code: mockBooking.booking_code,
      total_amount: mockBooking.total_amount,
      totalAmount: mockBooking.total_amount,
      paymentDeadline: new Date(currentNow.getTime() + 15 * 60 * 1000).toISOString(),
      payment_window_minutes: 15
    });
  });

  app.get('/api/public/bookings/:id', (req, res) => {
    res.json(mockBooking);
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  const server = http.createServer(app);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log(`Preview server running at http://127.0.0.1:${PORT}`);

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

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });

  try {
    // Step 1: Calendar & Header Verification
    console.log('\nStep 1: Verifying Calendar & Header on mobile...');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await new Promise(r => setTimeout(r, 1000));

    const homeChecks = await client.eval(`(() => {
      const text = document.body.innerText;
      return {
        hasLineSubtitle: text.includes('จองออนไลน์ผ่าน LINE'),
        hasHoursBanner: Boolean(document.querySelector('.customer-hours-banner')) || text.includes('ดูวันและเวลาว่างล่วงหน้า') || text.includes('เวลาทั้งหมดเป็นเวลาไทย'),
        hasPastRibbon: Boolean(document.querySelector('.customer-cal-day__diagonal-label'))
      };
    })()`);

    console.log('  [CHECK] Header has NO "จองออนไลน์ผ่าน LINE":', !homeChecks.hasLineSubtitle ? 'PASSED' : 'FAILED');
    console.log('  [CHECK] Calendar has NO hours banner:', !homeChecks.hasHoursBanner ? 'PASSED' : 'FAILED');
    console.log('  [CHECK] Calendar past dates have diagonal ribbon:', homeChecks.hasPastRibbon ? 'PASSED' : 'FAILED');
    if (homeChecks.hasLineSubtitle || homeChecks.hasHoursBanner || !homeChecks.hasPastRibbon) {
      throw new Error('Calendar/Header verification failed: ' + JSON.stringify(homeChecks));
    }
    await client.captureScreenshot('mobile_e2e_calendar_clean.png');

    // Step 2: Navigate to /form with active booking payload
    console.log('\nStep 2: Testing Form accessibility & Phone validation (9, 10, 11 digits & letters)...');
    await client.eval(`
      sessionStorage.setItem('current_booking_payload', JSON.stringify({
        room_id: 4,
        room: { id: 4, name: 'Mars (301)', capacity: 8 },
        room_name: 'Mars (301)',
        date: '2026-11-27',
        start_time: '10:00',
        end_time: '12:00',
        total_amount: 700,
        subtotal_amount: 700,
        attendees: 4,
        guests: 4
      }));
    `);
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/form` });
    await new Promise(r => setTimeout(r, 900));

    // Check Name accessibility + Phone input attributes
    const formChecks = await client.eval(`(() => {
      const label = document.querySelector('label[for="customer-name"]');
      const nameInput = document.getElementById('customer-name');
      const phoneInput = document.getElementById('customer-phone');
      return {
        labelForOk: Boolean(label && nameInput),
        ariaLabelOk: nameInput?.getAttribute('aria-label') === 'ชื่อ - นามสกุล ผู้จอง',
        placeholderOk: nameInput?.getAttribute('placeholder') === 'เช่น คุณสมชาย ใจดี',
        phoneNumericOk: phoneInput?.getAttribute('inputmode') === 'numeric' && phoneInput?.getAttribute('maxlength') === '10'
      };
    })()`);
    console.log('  [CHECK] Name & Phone attributes:', JSON.stringify(formChecks));
    if (!formChecks.labelForOk || !formChecks.ariaLabelOk || !formChecks.placeholderOk || !formChecks.phoneNumericOk) {
      throw new Error('Form attribute check failed');
    }

    // Test 9 digits -> expect error "กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก"
    const nineDigitErr = await client.eval(`(() => {
      function setVal(el, val) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setVal(document.getElementById('customer-name'), 'คุณสมชาย ใจดี');
      setVal(document.getElementById('customer-phone'), '081234567');
      document.querySelector('button[type="submit"]').click();
      return new Promise(r => setTimeout(() => r(document.body.innerText.includes('กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก')), 200));
    })()`);
    console.log('  [CHECK] 9 digits rejected with Thai error:', nineDigitErr ? 'PASSED' : 'FAILED');
    if (!nineDigitErr) throw new Error('9-digit phone validation did not trigger expected error');

    // Test letters + 11 digits -> verify sanitized to 10 digits with leading 0
    const sanitizeRes = await client.eval(`(() => {
      function setVal(el, val) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const phoneEl = document.getElementById('customer-phone');
      setVal(phoneEl, '08a1b2c3d4e5f6g7h899');
      return new Promise(r => setTimeout(() => r(phoneEl.value), 150));
    })()`);
    console.log('  [CHECK] Letters & 11+ digits sanitized to:', sanitizeRes);
    if (sanitizeRes !== '0812345678') throw new Error(`Expected sanitized "0812345678", got "${sanitizeRes}"`);

    // Submit valid 10-digit form
    console.log('\nStep 3: Submitting valid form and navigating to /confirm...');
    await client.eval(`document.querySelector('button[type="submit"]').click()`);
    let onConfirm = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 300));
      if ((await client.eval('window.location.href')).includes('/confirm')) {
        onConfirm = true;
        break;
      }
    }
    if (!onConfirm) throw new Error('Did not navigate to /confirm');
    await new Promise(r => setTimeout(r, 1000));

    // Step 4: Verify Krungsri logo, bank name, account number, and copy behavior
    console.log('\nStep 4: Verifying Krungsri Payment UI & Clipboard Copy on /confirm...');
    const confirmCheck = await client.eval(`(async () => {
      let copiedText = null;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (txt) => { copiedText = txt; }
        }
      });

      const logo = document.getElementById('bank-logo-krungsri');
      const bankName = document.getElementById('bank-name-display')?.innerText?.trim();
      const accNum = document.getElementById('bank-account-number-display')?.innerText?.trim();
      const copyBtn = document.getElementById('btn-copy-bank-account');
      copyBtn.click();
      await new Promise(r => setTimeout(r, 250));
      const btnTextAfter = copyBtn.innerText.trim();
      const bodyText = document.body.innerText;

      return {
        hasLogo: Boolean(logo && logo.getAttribute('src')?.includes('krungsri-logo.svg')),
        bankName,
        accNum,
        copiedText,
        btnTextAfter,
        hasBranchLine: bodyText.includes('สาขา'),
        hasBookingCode: bodyText.includes('BK-TEST-E2E-888'),
        hasAmount: bodyText.includes('700')
      };
    })()`);

    console.log('  [CHECK] Confirm Payment Details:', JSON.stringify(confirmCheck));
    if (!confirmCheck.hasLogo) throw new Error('Krungsri logo missing');
    if (confirmCheck.bankName !== 'ธนาคารกรุงศรีอยุธยา') throw new Error(`Expected "ธนาคารกรุงศรีอยุธยา", got "${confirmCheck.bankName}"`);
    if (confirmCheck.accNum !== '329-1-38429-0') throw new Error(`Expected "329-1-38429-0", got "${confirmCheck.accNum}"`);
    if (confirmCheck.copiedText !== '3291384290') throw new Error(`Expected copied "3291384290", got "${confirmCheck.copiedText}"`);
    if (!confirmCheck.btnTextAfter.includes('คัดลอกแล้ว')) throw new Error(`Expected "คัดลอกแล้ว", got "${confirmCheck.btnTextAfter}"`);
    if (confirmCheck.hasBranchLine) throw new Error('Branch line should not be displayed');

    await client.captureScreenshot('mobile_e2e_krungsri_confirm.png');

    console.log('\n================================================================');
    console.log('  ALL MOBILE E2E CHECKS PASSED SUCCESSFULLY!');
    console.log('================================================================\n');
  } finally {
    client.close();
    chromeProc.kill();
    server.close();
  }
}

run().catch(err => {
  console.error('\n[FATAL] E2E Test Failed:', err);
  process.exit(1);
});
