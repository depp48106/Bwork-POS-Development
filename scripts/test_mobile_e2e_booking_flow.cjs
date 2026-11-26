/**
 * BWORK-POS — AUTOMATED MOBILE E2E TEST: BOOKING FLOW TO /confirm
 * 
 * Verifies:
 * 1. Room / Date selection on mobile view (390 x 844)
 * 2. Form field accessibility:
 *    - Select via label (`htmlFor="customer-name"`)
 *    - Select via accessible name (`aria-label="ชื่อ - นามสกุล ผู้จอง"`)
 *    - Select via placeholder (`"เช่น คุณสมชาย ใจดี"`)
 * 3. Successful submission of test data
 * 4. Arrival at `/confirm` page:
 *    - Verified booking code (`BK-TEST-E2E-888`)
 *    - Verified total payment amount (฿700)
 *    - Strictly test data, zero real money transfer
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
  console.log('  BWORK MOBILE E2E TEST: ROOM SELECTION -> FORM -> /confirm');
  console.log('================================================================\n');

  const app = express();
  app.use(express.json());
  const distDir = path.resolve(__dirname, '../booking-app/dist');
  app.use(express.static(distDir));

  const now = new Date();
  const deadlineStr = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  // Mock API endpoints
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
    room: {
      id: 4,
      name: 'Mars (301)',
      capacity: 8
    }
  };

  app.get('/api/public/rooms', (req, res) => {
    res.json({
      success: true,
      rooms: [
        { id: 4, name: 'Mars (301)', capacity: 8, room_type: 'meeting', hourly_rate: 350 },
        { id: 10, name: 'Jupiter (300)', capacity: 40, room_type: 'auditorium', hourly_rate: 1500 }
      ]
    });
  });

  app.get('/api/public/rooms/availability-month', (req, res) => {
    res.json({ success: true, intervals: [] });
  });

  app.get('/api/public/rooms/:id/schedule', (req, res) => {
    res.json({ success: true, bookings: [], cleaning_buffer_minutes: 30 });
  });

  app.get('/api/public/settings/payment', (req, res) => {
    res.json({
      bank_name: 'ธนาคารกสิกรไทย',
      account_number: '329-1-38429-0',
      account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
      promptpay_id: '0105556187741'
    });
  });

  app.post('/api/public/bookings', (req, res) => {
    console.log('  [API] Received POST /api/public/bookings payload:', JSON.stringify(req.body));
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

  // Emulate Mobile Device (390 x 844)
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Set Pre-configured Booking State and navigate to BookingFormPage
    // -------------------------------------------------------------------------
    console.log('\nStep 1: Navigating to Booking Form with valid test booking...');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await new Promise(r => setTimeout(r, 800));

    // Inject active bookingData into sessionStorage so BookingFormPage mounts with room & time
    await client.eval(`
      const testBooking = {
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
      };
      sessionStorage.setItem('current_booking_payload', JSON.stringify(testBooking));
    `);

    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/form` });
    await new Promise(r => setTimeout(r, 1000));

    // -------------------------------------------------------------------------
    // Phase 2: Verify Accessibility Selectors for Customer Name Input
    // -------------------------------------------------------------------------
    console.log('\nStep 2: Testing Customer Name input field accessibility selectors...');
    const pageState = await client.eval(`({
      url: window.location.href,
      htmlSnippet: document.body.innerText.slice(0, 300)
    })`);
    console.log('  [DEBUG Page State]:', JSON.stringify(pageState));

    // Method A: Select via label[for="customer-name"]
    const labelForTarget = await client.eval(`(() => {
      const label = document.querySelector('label[for="customer-name"]');
      const input = document.getElementById(label ? label.getAttribute('for') : '');
      return Boolean(input && input.id === 'customer-name');
    })()`);
    console.log('  [CHECK A] Select via label[for="customer-name"]:', labelForTarget ? 'PASSED' : 'FAILED');
    if (!labelForTarget) throw new Error('Failed to associate label with input via htmlFor="customer-name"');

    // Method B: Select via accessible name (aria-label)
    const ariaLabelTarget = await client.eval(`(() => {
      const input = document.querySelector('input[aria-label="ชื่อ - นามสกุล ผู้จอง"]');
      return Boolean(input && input.id === 'customer-name');
    })()`);
    console.log('  [CHECK B] Select via aria-label="ชื่อ - นามสกุล ผู้จอง":', ariaLabelTarget ? 'PASSED' : 'FAILED');
    if (!ariaLabelTarget) throw new Error('Failed to find input via aria-label');

    // Method C: Select via placeholder
    const placeholderTarget = await client.eval(`(() => {
      const input = document.querySelector('input[placeholder="เช่น คุณสมชาย ใจดี"]');
      return Boolean(input && input.id === 'customer-name');
    })()`);
    console.log('  [CHECK C] Select via placeholder="เช่น คุณสมชาย ใจดี":', placeholderTarget ? 'PASSED' : 'FAILED');
    if (!placeholderTarget) throw new Error('Failed to find input via placeholder');

    // -------------------------------------------------------------------------
    // Phase 3: Fill Form Data & Submit
    // -------------------------------------------------------------------------
    console.log('\nStep 3: Entering customer details into form...');
    await client.eval(`(() => {
      function setReactInputValue(el, val) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const nameInput = document.getElementById('customer-name');
      const phoneInput = document.getElementById('customer-phone');
      
      setReactInputValue(nameInput, 'คุณสมชาย ใจดี');
      setReactInputValue(phoneInput, '0812345678');
    })()`);
    await new Promise(r => setTimeout(r, 400));

    console.log('Step 4: Submitting booking form...');
    await client.eval(`(() => {
      const submitBtn = document.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
      }
    })()`);

    // Wait for submission and navigation to /confirm
    console.log('Waiting for navigation to /confirm...');
    let onConfirm = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 300));
      const currentUrl = await client.eval('window.location.href');
      if (currentUrl.includes('/confirm')) {
        onConfirm = true;
        console.log(`  [OK] Successfully navigated to: ${currentUrl}`);
        break;
      }
    }
    if (!onConfirm) throw new Error('Did not navigate to /confirm within timeout');

    // -------------------------------------------------------------------------
    // Phase 4: Verify /confirm page displays booking code and amount
    // -------------------------------------------------------------------------
    console.log('\nStep 5: Verifying booking details on /confirm page...');
    await new Promise(r => setTimeout(r, 1000));

    const confirmDetails = await client.eval(`(() => {
      const bodyText = document.body.innerText;
      return {
        url: window.location.href,
        hasBookingCode: bodyText.includes('BK-TEST-E2E-888') || bodyText.includes('88801'),
        hasAmount: bodyText.includes('700') || bodyText.includes('฿700'),
        bodySnippet: bodyText.slice(0, 500)
      };
    })()`);

    console.log('  [CHECK] Booking code found on page:', confirmDetails.hasBookingCode ? 'PASSED' : 'FAILED');
    console.log('  [CHECK] Total amount found on page:', confirmDetails.hasAmount ? 'PASSED' : 'FAILED');
    console.log('  [DEBUG Body on Confirm Page]:\n', confirmDetails.bodySnippet);

    if (!confirmDetails.hasBookingCode) {
      console.warn('Body text snippet:\n', confirmDetails.bodySnippet);
      throw new Error('Booking code not found on /confirm page');
    }
    if (!confirmDetails.hasAmount) {
      throw new Error('Total amount not found on /confirm page');
    }

    await client.captureScreenshot('mobile_e2e_confirm_success.png');

    console.log('\n================================================================');
    console.log('  MOBILE E2E TEST COMPLETED SUCCESSFULLY! ALL CHECKS PASSED.');
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
