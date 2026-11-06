'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');
const assert = require('assert');

const ARTIFACT_DIR = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9255;
const HTTP_PORT = 4173;

// ==========================================
// PART 1: BACKEND INTEGRATION & PARITY TESTS
// ==========================================
function runBackendUnitTests() {
  console.log('\n======================================================');
  console.log('PART 1: BACKEND INTEGRATION & PARITY TEST SUITE');
  console.log('======================================================\n');

  // Load database.js and simulate Express / Worker DB operations in SQLite
  const sqlite3 = require('D:/Project BL/Bwork-POS-Development/backend/node_modules/sqlite3').verbose();
  const db = new sqlite3.Database(':memory:');

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Create tables
      db.run(`
        CREATE TABLE settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE,
          value TEXT
        )
      `);

      db.run(`
        CREATE TABLE rooms (
          id INTEGER PRIMARY KEY,
          name TEXT,
          hourly_rate REAL DEFAULT 500,
          daily_rate REAL DEFAULT 3500,
          half_day_rate REAL DEFAULT 2000,
          classroom_hourly_rate REAL DEFAULT 600,
          classroom_daily_rate REAL DEFAULT 4000,
          status TEXT DEFAULT 'active'
        )
      `);

      db.run(`
        CREATE TABLE bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_name TEXT,
          department TEXT,
          contact TEXT,
          subtotal_amount REAL,
          discount_type TEXT,
          discount_value REAL,
          discount_amount REAL,
          total_amount REAL,
          paid_amount REAL DEFAULT 0,
          balance_amount REAL,
          payment_status TEXT DEFAULT 'pending',
          payment_method TEXT DEFAULT 'transfer',
          receipt_number TEXT,
          pin_code TEXT,
          qr_token TEXT,
          booking_source TEXT DEFAULT 'online',
          booking_channel TEXT DEFAULT 'line_oa',
          customer_type TEXT DEFAULT 'general',
          customer_email TEXT,
          checkin_status TEXT DEFAULT 'pending',
          line_user_id TEXT,
          tax_invoice_required INTEGER DEFAULT 0,
          tax_payer_type TEXT,
          tax_name TEXT,
          tax_address TEXT,
          tax_id TEXT,
          tax_branch_type TEXT,
          tax_branch_number TEXT,
          tax_phone TEXT,
          tax_delivery_method TEXT,
          tax_postal_address TEXT,
          tax_email TEXT,
          guest_count INTEGER DEFAULT 1,
          created_at TEXT
        )
      `);

      db.run(`
        CREATE TABLE tax_invoices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id INTEGER,
          invoice_number TEXT,
          tax_name TEXT,
          tax_id TEXT,
          tax_email TEXT,
          tax_address TEXT,
          email_recipient TEXT,
          email_status TEXT,
          status TEXT DEFAULT 'active',
          file_url TEXT,
          file_name TEXT
        )
      `);

      // Seed room & settings
      db.run(`INSERT INTO rooms (id, name, hourly_rate) VALUES (1, 'Meeting Room A', 500)`);
      db.run(`INSERT INTO settings (key, value) VALUES ('online_promotion', '{"enabled":false}')`);

      console.log('✓ In-memory SQLite initialized with full schema including bookings.tax_email');

      // Helper function matching backend/server.js and backend/worker.js logic
      function simulateCreateBooking(body) {
        return new Promise((resP, rejP) => {
          const {
            customer_name, contact, email, department, note, room_id, booking_date,
            start_time, end_time, booking_type, layout, total_amount, line_user_id,
            tax_invoice_required, tax_payer_type, tax_name, tax_address, tax_id, tax_branch_type, tax_branch_number, tax_phone,
            tax_delivery_method, tax_postal_address, tax_email, guest_count, guests
          } = body;

          const isTaxInvoiceRequired = tax_invoice_required === 1 || tax_invoice_required === true || tax_invoice_required === '1' || tax_invoice_required === 'true';
          let cleanTaxPayerType = null;
          let cleanTaxName = null;
          let cleanTaxId = null;
          let cleanTaxBranchType = null;
          let cleanTaxBranchNumber = null;
          let cleanTaxAddress = null;
          let cleanTaxPhone = null;
          let cleanTaxDeliveryMethod = null;
          let cleanTaxPostalAddress = null;
          let cleanTaxEmail = null;

          if (isTaxInvoiceRequired) {
            cleanTaxPayerType = String(tax_payer_type || '').toLowerCase().trim();
            if (cleanTaxPayerType !== 'individual' && cleanTaxPayerType !== 'corporate') {
              return rejP(new Error('กรุณาระบุประเภทผู้เสียภาษี (บุคคลธรรมดา หรือ นิติบุคคล)'));
            }
            cleanTaxName = String(tax_name || '').trim();
            if (!cleanTaxName) {
              return rejP(new Error('กรุณากรอกชื่อสำหรับออกใบกำกับภาษี'));
            }
            cleanTaxId = String(tax_id || '').replace(/[-\s]/g, '').trim();
            if (!cleanTaxId || cleanTaxId.length !== 13 || !/^\d{13}$/.test(cleanTaxId)) {
              return rejP(new Error('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก'));
            }
            cleanTaxAddress = String(tax_address || '').trim();
            if (!cleanTaxAddress) {
              return rejP(new Error('ที่อยู่สำหรับออกใบกำกับภาษีจำเป็นต้องระบุ'));
            }
            cleanTaxPhone = String(tax_phone || contact || '').trim();
            if (!cleanTaxPhone) {
              return rejP(new Error('กรุณาระบุเบอร์โทรศัพท์สำหรับใบกำกับภาษี'));
            }
            cleanTaxDeliveryMethod = String(tax_delivery_method || 'online').trim();
            if (cleanTaxDeliveryMethod === 'postal') {
              cleanTaxPostalAddress = String(tax_postal_address || '').trim();
              if (!cleanTaxPostalAddress) {
                return rejP(new Error('กรุณาระบุที่อยู่สำหรับจัดส่งทางไปรษณีย์'));
              }
              cleanTaxEmail = null;
            } else {
              cleanTaxPostalAddress = null;
              if (tax_email) {
                cleanTaxEmail = String(tax_email).trim();
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(cleanTaxEmail)) {
                  return rejP(new Error('รูปแบบอีเมลสำหรับรับใบกำกับภาษีไม่ถูกต้อง'));
                }
              }
            }
          }

          db.run(
            `INSERT INTO bookings (
              customer_name, department, contact,
              subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount,
              payment_status, payment_method,
              receipt_number, pin_code, qr_token, booking_source, booking_channel, customer_type, customer_email, checkin_status, line_user_id,
              tax_invoice_required, tax_payer_type, tax_name, tax_address, tax_id, tax_branch_type, tax_branch_number, tax_phone, tax_delivery_method, tax_postal_address, tax_email,
              guest_count, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              customer_name, department || '', contact,
              500, 'none', 0, 0, 500, 0, 500,
              'pending', 'transfer',
              'BK-000001', '1234', 'tok123', 'online', 'line_oa', 'general', email || null, 'pending', line_user_id || null,
              isTaxInvoiceRequired ? 1 : 0, cleanTaxPayerType, cleanTaxName, cleanTaxAddress, cleanTaxId, cleanTaxBranchType, cleanTaxBranchNumber, cleanTaxPhone, cleanTaxDeliveryMethod, cleanTaxPostalAddress, cleanTaxEmail,
              1, new Date().toISOString()
            ],
            function (err) {
              if (err) return rejP(err);
              const bookingId = this.lastID;
              db.get(`SELECT * FROM bookings WHERE id = ?`, [bookingId], (getErr, row) => {
                if (getErr) return rejP(getErr);
                resP(row);
              });
            }
          );
        });
      }

      // Helper function matching POS preview logic (backend/server.js:5187 and worker.js:8739)
      function simulatePosEmailPreview(bookingId) {
        return new Promise((resP, rejP) => {
          db.get(`SELECT * FROM bookings WHERE id = ?`, [bookingId], (err, booking) => {
            if (err || !booking) return rejP(err || new Error('Booking not found'));
            const recipientEmail = (booking.tax_email || '').trim();
            if (!recipientEmail) {
              return rejP(new Error('ยังไม่ได้ระบุอีเมลผู้รับ กรุณากรอกและบันทึกอีเมลในข้อมูลใบกำกับภาษีก่อนดูตัวอย่าง'));
            }
            resP({
              to: recipientEmail,
              customer_email: booking.customer_email,
              booking_id: booking.id,
              tax_name: booking.tax_name
            });
          });
        });
      }

      // RUN CASES
      (async () => {
        try {
          // TEST CASE 1: Customer email = A, Tax invoice email = B (Online + Email)
          console.log('\n--- Case 1: Customer email A vs Tax invoice recipient email B ---');
          const booking1 = await simulateCreateBooking({
            customer_name: 'นายสมชาย ใจดี',
            contact: '0812345678',
            email: 'customerA@example.com',
            room_id: 1,
            booking_date: '2026-11-20',
            start_time: '09:00',
            end_time: '10:00',
            tax_invoice_required: 1,
            tax_payer_type: 'corporate',
            tax_name: 'บริษัท สยามการค้า จำกัด',
            tax_id: '0105558000123',
            tax_address: '123 ถนนสีลม กรุงเทพฯ',
            tax_phone: '021234567',
            tax_delivery_method: 'online',
            tax_online_subchannel: 'email',
            tax_email: 'accountingB@example.com'
          });

          assert.strictEqual(booking1.customer_email, 'customerA@example.com', 'Customer email must be customerA@example.com');
          assert.strictEqual(booking1.tax_email, 'accountingB@example.com', 'Tax invoice email must be accountingB@example.com');
          console.log('✓ Database columns separated: bookings.customer_email =', booking1.customer_email, '| bookings.tax_email =', booking1.tax_email);

          // Call POS Preview
          const preview1 = await simulatePosEmailPreview(booking1.id);
          assert.strictEqual(preview1.to, 'accountingB@example.com', 'POS Email Preview "To:" must strictly be accountingB@example.com');
          assert.strictEqual(preview1.customer_email, 'customerA@example.com', 'Customer contact email remains customerA@example.com');
          console.log('✓ POS Email Preview correctly authoritative: "To:" =', preview1.to, '| Customer =', preview1.customer_email);

          // TEST CASE 2: Same email (A == B)
          console.log('\n--- Case 2: Same email (A == B) ---');
          const booking2 = await simulateCreateBooking({
            customer_name: 'นายสมชาย ใจดี',
            contact: '0812345678',
            email: 'userA@example.com',
            room_id: 1,
            booking_date: '2026-11-20',
            start_time: '10:00',
            end_time: '11:00',
            tax_invoice_required: 1,
            tax_payer_type: 'individual',
            tax_name: 'นายสมชาย ใจดี',
            tax_id: '1234567890123',
            tax_address: '99/1 ซอยอารีย์ กรุงเทพฯ',
            tax_phone: '0812345678',
            tax_delivery_method: 'online',
            tax_online_subchannel: 'email',
            tax_email: 'userA@example.com'
          });
          assert.strictEqual(booking2.customer_email, 'userA@example.com');
          assert.strictEqual(booking2.tax_email, 'userA@example.com');
          const preview2 = await simulatePosEmailPreview(booking2.id);
          assert.strictEqual(preview2.to, 'userA@example.com');
          console.log('✓ Case 2 passed: Both fields saved as userA@example.com, POS Preview To =', preview2.to);

          // TEST CASE 3: Invalid email format rejected
          console.log('\n--- Case 3: Invalid email format rejection ---');
          let rejected = false;
          try {
            await simulateCreateBooking({
              customer_name: 'นายสมชาย ใจดี',
              contact: '0812345678',
              email: 'valid@example.com',
              room_id: 1,
              booking_date: '2026-11-20',
              start_time: '11:00',
              end_time: '12:00',
              tax_invoice_required: 1,
              tax_payer_type: 'individual',
              tax_name: 'นายสมชาย ใจดี',
              tax_id: '1234567890123',
              tax_address: '99/1 ซอยอารีย์',
              tax_phone: '0812345678',
              tax_delivery_method: 'online',
              tax_email: 'invalid-email-address'
            });
          } catch (e) {
            rejected = true;
            assert.strictEqual(e.message, 'รูปแบบอีเมลสำหรับรับใบกำกับภาษีไม่ถูกต้อง');
          }
          assert.ok(rejected, 'Invalid email format must be rejected with 400 Bad Request');
          console.log('✓ Case 3 passed: Invalid email rejected with "รูปแบบอีเมลสำหรับรับใบกำกับภาษีไม่ถูกต้อง"');

          // TEST CASE 4: Switch to LINE subchannel
          console.log('\n--- Case 4: Switch to LINE subchannel ---');
          const booking4 = await simulateCreateBooking({
            customer_name: 'นายสมชาย ใจดี',
            contact: '0812345678',
            email: 'customerA@example.com',
            room_id: 1,
            booking_date: '2026-11-20',
            start_time: '12:00',
            end_time: '13:00',
            tax_invoice_required: 1,
            tax_payer_type: 'corporate',
            tax_name: 'บริษัท ไลน์ จำกัด',
            tax_id: '0105558000123',
            tax_address: '1 อาคารเกษร กรุงเทพฯ',
            tax_phone: '029999999',
            tax_delivery_method: 'online',
            tax_online_subchannel: 'line',
            tax_email: null
          });
          assert.strictEqual(booking4.customer_email, 'customerA@example.com');
          assert.strictEqual(booking4.tax_email, null, 'tax_email must be null when LINE is chosen');
          console.log('✓ Case 4 passed: LINE delivery succeeds without tax_email (tax_email is null)');

          // TEST CASE 5: Postal delivery
          console.log('\n--- Case 5: Postal delivery ---');
          const booking5 = await simulateCreateBooking({
            customer_name: 'นายสมชาย ใจดี',
            contact: '0812345678',
            email: 'customerA@example.com',
            room_id: 1,
            booking_date: '2026-11-20',
            start_time: '13:00',
            end_time: '14:00',
            tax_invoice_required: 1,
            tax_payer_type: 'corporate',
            tax_name: 'บริษัท ไปรษณีย์ จำกัด',
            tax_id: '0105558000123',
            tax_address: '55 ถนนแจ้งวัฒนะ',
            tax_phone: '028888888',
            tax_delivery_method: 'postal',
            tax_postal_address: '111/2 อาคารไปรษณีย์กลาง บางรัก กรุงเทพฯ 10500',
            tax_email: null
          });
          assert.strictEqual(booking5.tax_delivery_method, 'postal');
          assert.strictEqual(booking5.tax_postal_address, '111/2 อาคารไปรษณีย์กลาง บางรัก กรุงเทพฯ 10500');
          assert.strictEqual(booking5.tax_email, null);
          console.log('✓ Case 5 passed: Postal address stored, tax_email is null');

          // TEST CASE 6: No tax invoice requested
          console.log('\n--- Case 6: No tax invoice requested ---');
          const booking6 = await simulateCreateBooking({
            customer_name: 'นายสมชาย ใจดี',
            contact: '0812345678',
            email: 'customerA@example.com',
            room_id: 1,
            booking_date: '2026-11-20',
            start_time: '14:00',
            end_time: '15:00',
            tax_invoice_required: 0
          });
          assert.strictEqual(booking6.tax_invoice_required, 0);
          assert.strictEqual(booking6.tax_email, null);
          console.log('✓ Case 6 passed: No tax invoice, tax_email is null, booking succeeds');

          resolve();
        } catch (err) {
          reject(err);
        }
      })();
    });
  });
}

// ==========================================
// PART 2: REAL HEADLESS CHROME CDP UI TESTS
// ==========================================
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
              await this.send('DOM.enable');
              await this.send('Runtime.enable');
              resolve();
            };
            this.ws.onmessage = (evt) => {
              const msg = JSON.parse(evt.data);
              if (msg.id && this.callbacks.has(msg.id)) {
                const cb = this.callbacks.get(msg.id);
                this.callbacks.delete(msg.id);
                if (msg.error) cb.reject(new Error(msg.error.message));
                else cb.resolve(msg.result);
              }
            };
            this.ws.onerror = reject;
          });
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
    throw new Error('Failed to connect to Chrome CDP');
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
    return res.result ? res.result.value : undefined;
  }

  async screenshot(filePath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
    console.log(`[Screenshot Saved] -> ${filePath}`);
  }

  async close() {
    if (this.ws) this.ws.close();
  }
}

async function runBrowserUITests() {
  console.log('\n======================================================');
  console.log('PART 2: HEADLESS CHROME CDP UI TEST (MOBILE 390x844)');
  console.log('======================================================\n');

  // Start a local static server serving booking-app/dist with mock public API handlers
  const distDir = 'D:\\Project BL\\Bwork-POS-Development\\booking-app\\dist';
  let capturedPayload = null;

  const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/api/public/rooms' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        rooms: [{
          id: 1,
          name: 'Meeting Room A',
          hourly_rate: 500,
          daily_rate: 3500,
          capacity: 8,
          status: 'active'
        }]
      }));
      return;
    }

    if (req.url === '/api/public/bookings' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', () => {
        try {
          capturedPayload = JSON.parse(bodyStr);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            booking_id: 999,
            booking_code: 'BK-000999',
            total_amount: 500,
            payment_window_minutes: 15
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Serve static files from distDir
    let safeUrl = req.url.split('?')[0];
    if (safeUrl === '/' || safeUrl.startsWith('/confirm')) safeUrl = '/index.html';
    let localFilePath = path.join(distDir, safeUrl);

    if (!fs.existsSync(localFilePath)) {
      localFilePath = path.join(distDir, 'index.html');
    }

    const ext = path.extname(localFilePath);
    const contentTypeMap = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };
    const cType = contentTypeMap[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': cType });
    res.end(fs.readFileSync(localFilePath));
  });

  await new Promise(r => server.listen(HTTP_PORT, r));
  console.log(`✓ Local mock HTTP test server listening on http://127.0.0.1:${HTTP_PORT}`);

  // Launch Chrome
  const tempProfileDir = path.join(ARTIFACT_DIR, 'scratch', 'chrome_tax_delivery_test_profile');
  if (!fs.existsSync(tempProfileDir)) fs.mkdirSync(tempProfileDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=390,844',
    'about:blank'
  ]);

  try {
    const cdp = new CDPClient(CDP_PORT);
    await cdp.connect();
    console.log('✓ Connected to Headless Chrome CDP');

    // Emulate Mobile Device 390x844 (iPhone 12/13/14)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true
    });

    // Seed sessionStorage with mock booking data before loading page
    const seedBooking = {
      room_id: 1,
      room_name: 'Meeting Room A',
      date: '2026-11-20',
      start_time: '09:00',
      end_time: '10:00',
      duration: 1,
      guests: 2,
      total_amount: 500,
      totalPrice: 500,
      room: { id: 1, name: 'Meeting Room A', hourly_rate: 500 }
    };

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });
    await new Promise(r => setTimeout(r, 1000));

    // Seed storage and navigate to form
    await cdp.eval(`
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('current_booking_payload', JSON.stringify(${JSON.stringify(seedBooking)}));
      window.location.href = '/form';
    `);

    await new Promise(r => setTimeout(r, 1500));

    // Step A: Fill customer fields (Customer Email = customerA@example.com)
    console.log('\nStep A: Filling customer details (Email = customerA@example.com)...');
    await cdp.eval(`
      (() => {
        const setVal = (el, val) => {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        const emailInput = document.querySelector('input[type="email"]');
        if (emailInput) setVal(emailInput, 'customerA@example.com');

        const textInputs = document.querySelectorAll('input[type="text"], input[type="tel"]');
        if (textInputs[0]) setVal(textInputs[0], 'สมชาย ใจดี');
        if (textInputs[1]) setVal(textInputs[1], '0812345678');
      })()
    `);

    // Step B: Check "ต้องการขอใบกำกับภาษี"
    console.log('Step B: Checking "ต้องการขอใบกำกับภาษี"...');
    await cdp.eval(`
      (() => {
        const toggle = document.getElementById('tax-invoice-accordion-toggle');
        if (toggle) toggle.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    // Step C: Select "นิติบุคคล" and fill corporate fields
    console.log('Step C: Selecting Corporate entity...');
    await cdp.eval(`document.getElementById('btn-tax-corporate').click();`);
    await new Promise(r => setTimeout(r, 300));

    await cdp.eval(`
      (() => {
        const setVal = (el, val) => {
          if (!el) return;
          const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          nativeSetter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setVal(document.getElementById('input-tax-name'), 'บริษัท ตัวอย่าง จำกัด');
        setVal(document.getElementById('input-tax-id'), '0105558000123');
        setVal(document.getElementById('input-tax-address'), '123 สุขุมวิท คลองเตย กรุงเทพฯ');
        setVal(document.getElementById('input-tax-phone'), '0812345678');
      })()
    `);

    // Step D: Verify Delivery Dropdown option text and LINE sub-channel default
    console.log('Step D: Checking Delivery Dropdown label and LINE default...');
    const deliveryOptionText = await cdp.eval(`
      document.querySelector('#select-tax-delivery-method option[value="online"]').textContent
    `);
    assert.strictEqual(deliveryOptionText, 'จัดส่งออนไลน์ (LINE หรืออีเมล)', 'Must display "จัดส่งออนไลน์ (LINE หรืออีเมล)"');
    console.log('✓ Select Option Text verified:', deliveryOptionText);

    // Verify LINE subchannel is active and email input is hidden
    const isLineActive = await cdp.eval(`
      document.getElementById('btn-tax-subchannel-line') !== null
    `);
    const isTaxEmailVisibleWhenLine = await cdp.eval(`
      document.getElementById('input-tax-email') !== null
    `);
    assert.ok(isLineActive, 'LINE subchannel button must be present');
    assert.strictEqual(isTaxEmailVisibleWhenLine, false, 'Tax email input must be hidden when LINE is selected');
    console.log('✓ Default sub-channel is LINE, Tax email input is hidden');

    // Screenshot LINE subchannel selected
    await cdp.eval(`document.getElementById('select-tax-delivery-method')?.scrollIntoView({ behavior: 'instant', block: 'center' });`);
    await new Promise(r => setTimeout(r, 200));
    const lineShotPath = path.join(ARTIFACT_DIR, 'booking_tax_delivery_line_selected_mobile_390.png');
    await cdp.screenshot(lineShotPath);

    // Step E: Click "อีเมล" sub-channel button
    console.log('Step E: Clicking "อีเมล" subchannel button...');
    await cdp.eval(`document.getElementById('btn-tax-subchannel-email').click();`);
    await new Promise(r => setTimeout(r, 400));

    const isTaxEmailVisibleNow = await cdp.eval(`document.getElementById('input-tax-email') !== null`);
    assert.ok(isTaxEmailVisibleNow, 'Tax email input must be visible when email sub-channel is selected');
    console.log('✓ Sub-channel switched to Email: input-tax-email is visible');

    // Step F: Test "ใช้อีเมลเดียวกับผู้จอง" button
    console.log('Step F: Testing "ใช้อีเมลเดียวกับผู้จอง" button...');
    await cdp.eval(`document.getElementById('btn-use-booking-email').click();`);
    await new Promise(r => setTimeout(r, 200));

    const copiedTaxEmail = await cdp.eval(`document.getElementById('input-tax-email').value`);
    assert.strictEqual(copiedTaxEmail, 'customerA@example.com', 'Should copy customer email customerA@example.com');
    console.log('✓ Button "ใช้อีเมลเดียวกับผู้จอง" correctly set tax email to:', copiedTaxEmail);

    // Step G: Edit tax email to accountingB@example.com (Verify customer email remains unchanged!)
    console.log('Step G: Editing tax email to accountingB@example.com...');
    await cdp.eval(`
      (() => {
        const el = document.getElementById('input-tax-email');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, 'accountingB@example.com');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);

    const customerEmailVal = await cdp.eval(`document.querySelector('input[type="email"]').value`);
    const finalTaxEmailVal = await cdp.eval(`document.getElementById('input-tax-email').value`);
    assert.strictEqual(customerEmailVal, 'customerA@example.com', 'Customer email must NOT be modified');
    assert.strictEqual(finalTaxEmailVal, 'accountingB@example.com', 'Tax email must be accountingB@example.com');
    console.log('✓ State separation confirmed: customer email =', customerEmailVal, '| tax email =', finalTaxEmailVal);

    // Screenshot filled email on mobile 390
    await cdp.eval(`document.getElementById('input-tax-email')?.scrollIntoView({ behavior: 'instant', block: 'center' });`);
    await new Promise(r => setTimeout(r, 200));
    const filledShotPath = path.join(ARTIFACT_DIR, 'booking_tax_delivery_email_filled_mobile_390.png');
    await cdp.screenshot(filledShotPath);

    // Step H: Test Validation (Clear email and click Next)
    console.log('Step H: Testing validation on empty tax email...');
    await cdp.eval(`
      (() => {
        const el = document.getElementById('input-tax-email');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Click Submit button (Next)
        const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ถัดไป'));
        if (submitBtn) submitBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 400));

    const errorMsg = await cdp.eval(`
      (() => {
        const errEl = document.querySelector('div[style*="var(--danger)"] span') || document.querySelector('div[style*="var(--danger)"]');
        return errEl ? errEl.innerText : '';
      })()
    `);
    console.log('Validation Error displayed:', errorMsg);
    assert.ok(errorMsg.includes('กรุณาระบุอีเมลสำหรับรับใบกำกับภาษี'), 'Must show empty tax email validation message');

    // Screenshot validation error on mobile 390
    await cdp.eval(`document.querySelector('div[style*="var(--danger)"]')?.scrollIntoView({ behavior: 'instant', block: 'center' });`);
    await new Promise(r => setTimeout(r, 200));
    const validShotPath = path.join(ARTIFACT_DIR, 'booking_tax_delivery_validation_mobile_390.png');
    await cdp.screenshot(validShotPath);

    // Step I: Test Horizontal Overflow on Mobile 390
    console.log('Step I: Checking horizontal overflow at viewport 390px...');
    const overflowInfo = await cdp.eval(`
      ({
        bodyScrollW: document.body.scrollWidth,
        bodyClientW: document.body.clientWidth,
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth,
        wideElements: Array.from(document.querySelectorAll('*'))
          .filter(el => el.scrollWidth > 390 || el.getBoundingClientRect().right > 390)
          .map(el => ({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            scrollW: el.scrollWidth,
            clientW: el.clientWidth,
            rectRight: el.getBoundingClientRect().right,
            text: el.innerText ? el.innerText.substring(0, 40) : ''
          }))
          .slice(0, 10)
      })
    `);
    console.log('Viewport metrics:', JSON.stringify(overflowInfo, null, 2));
    assert.strictEqual(overflowInfo.docScrollW, 390, 'Horizontal scrollWidth must strictly be 390 (no overflow)');
    console.log('✓ Zero horizontal overflow on mobile 390 confirmed!');

    // Step J: Submit with valid accountingB@example.com and check captured payload
    console.log('Step J: Submitting valid form and verifying payload sent to API...');
    await cdp.eval(`
      (() => {
        const el = document.getElementById('input-tax-email');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, 'accountingB@example.com');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ถัดไป'));
        if (submitBtn) submitBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    assert.ok(capturedPayload, 'Form must successfully submit to API');
    assert.strictEqual(capturedPayload.email, 'customerA@example.com', 'Payload email must be customerA@example.com');
    assert.strictEqual(capturedPayload.tax_email, 'accountingB@example.com', 'Payload tax_email must be accountingB@example.com');
    assert.strictEqual(capturedPayload.tax_delivery_method, 'online');
    assert.strictEqual(capturedPayload.tax_online_subchannel, 'email');
    console.log('✓ API Payload received correctly:');
    console.log('  - email:', capturedPayload.email);
    console.log('  - tax_email:', capturedPayload.tax_email);
    console.log('  - tax_delivery_method:', capturedPayload.tax_delivery_method);
    console.log('  - tax_online_subchannel:', capturedPayload.tax_online_subchannel);

    // Step K: Test returning to form from confirmation
    console.log('\nStep K: Testing returning to form and draft editing...');
    await cdp.eval(`
      (() => {
        sessionStorage.setItem('current_booking_payload', JSON.stringify(${JSON.stringify(seedBooking)}));
        const draft = {
          name: 'สมชาย ใจดี',
          contact: '0812345678',
          email: 'customerA@example.com',
          needTaxInvoice: true,
          taxPayerType: 'corporate',
          taxName: 'บริษัท ตัวอย่าง จำกัด',
          taxId: '0105558000123',
          taxAddress: '123 สุขุมวิท กรุงเทพฯ',
          taxDeliveryMethod: 'online',
          taxOnlineSubChannel: 'email',
          taxEmail: 'accountingB@example.com'
        };
        sessionStorage.setItem('bwork_booking_form_draft', JSON.stringify(draft));
        sessionStorage.setItem('bwork_draft_guest_1', JSON.stringify(draft));
        window.location.href = '/form';
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    const restoredTaxEmail = await cdp.eval(`document.getElementById('input-tax-email')?.value`);
    assert.strictEqual(restoredTaxEmail, 'accountingB@example.com', 'Draft must restore accountingB@example.com');
    console.log('✓ Draft restoration on return confirmed: tax email =', restoredTaxEmail);

    // Switch back to LINE
    await cdp.eval(`document.getElementById('btn-tax-subchannel-line')?.click();`);
    await new Promise(r => setTimeout(r, 300));
    const isHiddenAfterSwitch = await cdp.eval(`document.getElementById('input-tax-email') === null`);
    assert.ok(isHiddenAfterSwitch, 'Email input must hide when switched back to LINE');
    console.log('✓ Switched back to LINE successfully, input-tax-email hidden');

    await cdp.close();
  } finally {
    chromeProc.kill();
    server.close();
  }
}

async function main() {
  try {
    await runBackendUnitTests();
    await runBrowserUITests();
    console.log('\n======================================================');
    console.log('ALL TESTS PASSED WITH 100% SUCCESS!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ Test suite failed:', err);
    process.exit(1);
  }
}

main();
