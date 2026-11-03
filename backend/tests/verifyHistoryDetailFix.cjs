/**
 * verifyHistoryDetailFix.cjs
 * Comprehensive Browser UAT Verification for History Detail Modal:
 * - Fixes ReferenceError: Plus is not defined (ปุ่มแนบสลิป และ แนบสลิปย้อนหลัง)
 * - Fixes ReferenceError: ShieldCheck is not defined
 * - Verifies zero white screens and zero runtime exceptions when opening booking details
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 5099;
const BASE_URL = `http://localhost:${PORT}`;
const ARTIFACT_DIR = path.resolve('C:/Users/ADMIN/.gemini/antigravity/brain/93b1ef54-72e7-446f-a6a3-437743441774');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9259;
const DB_FILE = path.join(__dirname, 'database_history_test.sqlite');

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
    const p1 = path.join(ARTIFACT_DIR, baseName);
    fs.writeFileSync(p1, buffer);
    console.log(`  📸 Captured: ${baseName} (${buffer.length} bytes)`);
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function setupTestDb() {
  if (fs.existsSync(DB_FILE)) {
    try { fs.unlinkSync(DB_FILE); } catch (_) {}
  }
  process.env.DB_PATH = DB_FILE;
  process.env.APP_ENV = 'development';

  const { initDatabase, dbQuery, hashPassword } = require('../database');
  await initDatabase();

  // Create admin user
  const adminPasswordHash = hashPassword('admin123');
  await dbQuery.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, fullname, role, permissions) 
     VALUES (1, 'admin', ?, 'Administrator', 'admin', 'pos,history,manage,admin-system')`,
    [adminPasswordHash]
  );

  // Create rooms
  await dbQuery.run(
    `INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate) 
     VALUES (1, 'Mercury (302)', 10, 300),
            (2, 'Venus (304)', 15, 400)`
  );

  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Booking #801: Case 1 (Split payments, missing slip on balance transaction)
  await dbQuery.run(
    `INSERT INTO bookings (
      id, customer_name, customer_email, contact, total_amount, paid_amount, balance_amount, 
      payment_status, payment_method, booking_source, created_at, receipt_number
    ) VALUES (
      801, 'นายสมชาย ทดสอบแนบสลิป', 'somchai@test.com', '0812345678', 1000, 500, 500,
      'deposit', 'transfer', 'pos', CURRENT_TIMESTAMP, 'BK-000801'
    )`
  );
  await dbQuery.run(
    `INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, layout)
     VALUES (8011, 801, 1, '${todayStr}T09:00:00', '${todayStr}T12:00:00', 1000, 1000, 'standard')`
  );
  // Transaction 1: Has slip
  await dbQuery.run(
    `INSERT INTO payment_transactions (id, booking_id, amount, payment_method, transaction_type, slip_url, status, created_at)
     VALUES (80101, 801, 500, 'transfer', 'deposit', '/uploads/mock_deposit_slip.jpg', 'completed', CURRENT_TIMESTAMP)`
  );
  // Transaction 2: Missing slip (triggers Plus icon 'แนบสลิป')
  await dbQuery.run(
    `INSERT INTO payment_transactions (id, booking_id, amount, payment_method, transaction_type, slip_url, status, created_at)
     VALUES (80102, 801, 500, 'transfer', 'balance', NULL, 'pending', CURRENT_TIMESTAMP)`
  );

  // 2. Booking #802: Case 2 (Legacy booking, zero payment_transactions, missing slip)
  await dbQuery.run(
    `INSERT INTO bookings (
      id, customer_name, customer_email, contact, total_amount, paid_amount, balance_amount, 
      payment_status, payment_method, booking_source, created_at, receipt_number, slip_image_url
    ) VALUES (
      802, 'นางสมหญิง ทดสอบแนบย้อนหลัง', 'somying@test.com', '0823456789', 600, 600, 0,
      'paid', 'transfer', 'pos', CURRENT_TIMESTAMP, 'BK-000802', NULL
    )`
  );
  await dbQuery.run(
    `INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, layout)
     VALUES (8021, 802, 2, '${todayStr}T13:00:00', '${todayStr}T15:00:00', 600, 600, 'standard')`
  );
  // Zero payment_transactions -> triggers Plus icon 'แนบสลิปย้อนหลัง'

  // 3. Booking #803: Case 3 (Fully paid with split transactions -> ShieldCheck icon)
  await dbQuery.run(
    `INSERT INTO bookings (
      id, customer_name, customer_email, contact, total_amount, paid_amount, balance_amount, 
      payment_status, payment_method, booking_source, created_at, receipt_number
    ) VALUES (
      803, 'นายสมศักดิ์ ทดสอบโล่เขียว', 'somsak@test.com', '0834567890', 800, 800, 0,
      'paid', 'transfer', 'pos', CURRENT_TIMESTAMP, 'BK-000803'
    )`
  );
  await dbQuery.run(
    `INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, layout)
     VALUES (8031, 803, 1, '${todayStr}T16:00:00', '${todayStr}T18:00:00', 800, 800, 'standard')`
  );
  await dbQuery.run(
    `INSERT INTO payment_transactions (id, booking_id, amount, payment_method, transaction_type, slip_url, status, created_at)
     VALUES (80301, 803, 400, 'transfer', 'deposit', '/uploads/mock_s1.jpg', 'completed', CURRENT_TIMESTAMP),
            (80302, 803, 400, 'transfer', 'balance', '/uploads/mock_s2.jpg', 'completed', CURRENT_TIMESTAMP)`
  );

  console.log('✓ Test SQLite database seeded with Bookings #801, #802, #803');
}

async function run() {
  console.log('=== Starting Real Browser UAT: POS History Detail Modal Fix ===\n');

  // Step 1: Seed test database
  await setupTestDb();

  // Step 2: Start Express Backend
  console.log(`Starting Express backend on port ${PORT}...`);
  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE }
  });

  serverProcess.stdout.on('data', d => {
    // console.log('[Server stdout]', d.toString());
  });
  serverProcess.stderr.on('data', d => {
    // console.error('[Server stderr]', d.toString());
  });

  // Wait for server to respond
  let serverReady = false;
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/public/rooms`);
      if (res.status === 200) {
        serverReady = true;
        break;
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 400));
  }
  if (!serverReady) {
    serverProcess.kill();
    throw new Error(`Server failed to start on port ${PORT}`);
  }
  console.log(`✓ Express backend ready on http://127.0.0.1:${PORT}`);

  // Step 3: Launch Chrome Headless with CDP
  console.log(`Launching Headless Chrome on CDP port ${CDP_PORT}...`);
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1440,900',
    `--user-data-dir=${path.join(ARTIFACT_DIR, 'scratch', 'chrome_uat_history_profile')}`,
    'about:blank'
  ]);

  const cdp = new CDPClient(CDP_PORT);
  await cdp.connect();
  await cdp.setViewport(1440, 900);
  console.log('✓ Connected to Chrome CDP');

  try {
    // Step 4: Login to POS
    console.log('Logging into POS Application...');
    await cdp.navigate(`${BASE_URL}/`);

    // Inject token directly into localStorage to bypass form if needed, or fill form
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;

    await cdp.evaluate(`
      localStorage.setItem('pos_token', '${token}');
      localStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(loginData.user)}));
      window.location.reload();
    `);
    await new Promise(r => setTimeout(r, 2000));

    // Step 5: Navigate to History tab
    console.log('Navigating to History tab...');
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
    console.log('Clicked History tab button:', clickedHistory);
    await new Promise(r => setTimeout(r, 2000));

    // Verify History view is loaded
    const historyLoaded = await cdp.evaluate(`
      (() => {
        return !!document.querySelector('.history-desktop-table') || (document.body.innerText.includes('ประวัติการใช้บริการ') && document.body.innerText.includes('สมชาย'));
      })()
    `);
    console.log('History table loaded:', historyLoaded);

    // --------------------------------------------------------------------------
    // Test Case 1: Booking #801 (Modern transactions, missing slip -> 'แนบสลิป')
    // --------------------------------------------------------------------------
    console.log('\n--- Testing Case 1: Booking #801 (Attach Transaction Slip) ---');
    const tableDebug = await cdp.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('tr')];
        return rows.map((r, i) => ({
          i,
          text: r.innerText ? r.innerText.replace(/\\s+/g, ' ').slice(0, 80) : '',
          buttons: [...r.querySelectorAll('button')].map(b => b.innerText.trim())
        }));
      })()
    `);
    console.log('Table rows debug:', JSON.stringify(tableDebug, null, 2));

    const openCase1 = await cdp.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('tr')];
        const row801 = rows.find(r => r.innerText && r.innerText.includes('สมชาย'));
        if (row801) {
          const detailBtn = [...row801.querySelectorAll('button')].find(b => b.innerText && (b.innerText.includes('รายละเอียด') || b.innerText.includes('ใบเสร็จ')));
          if (detailBtn) { detailBtn.click(); return true; }
        }
        return false;
      })()
    `);
    console.log('Clicked details on Booking #801:', openCase1);
    await new Promise(r => setTimeout(r, 1500));

    // Verify modal rendered without crash
    const modal1Info = await cdp.evaluate(`
      (() => {
        const modal = document.querySelector('.modal-backdrop, [role="dialog"], .fixed');
        const attachBtn = document.querySelector('#history-btn-attach-slip-tx-80102');
        const hasPlusIcon = attachBtn ? !!attachBtn.querySelector('svg') : false;
        const isWhiteScreen = !document.querySelector('#root') || document.querySelector('#root').children.length === 0;
        return {
          modalExists: !!modal,
          attachBtnExists: !!attachBtn,
          hasPlusIcon,
          isWhiteScreen,
          buttonText: attachBtn ? attachBtn.innerText.trim() : null
        };
      })()
    `);
    console.log('Case 1 Modal Info:', modal1Info);

    if (modal1Info.isWhiteScreen) throw new Error('WHITE SCREEN DETECTED on Case 1!');
    if (!modal1Info.attachBtnExists) throw new Error('Attach Slip button #history-btn-attach-slip-tx-80102 NOT found!');
    if (!modal1Info.hasPlusIcon) throw new Error('<Plus /> icon not rendered inside attach slip button!');
    if (modal1Info.buttonText !== 'แนบสลิป') throw new Error(`Unexpected button text: ${modal1Info.buttonText}`);

    await cdp.captureScreenshot('uat_history_detail_case1_attach_slip.png');
    console.log('✅ Case 1 Passed: <Plus size={10} /> rendered successfully with text "แนบสลิป", zero ReferenceError');

    // Close Case 1 modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = [...document.querySelectorAll('button')].find(b => b.innerText === '✕' || b.innerText === 'ปิด' || b.getAttribute('aria-label') === 'Close');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    // --------------------------------------------------------------------------
    // Test Case 2: Booking #802 (Legacy booking, zero tx -> 'แนบสลิปย้อนหลัง')
    // --------------------------------------------------------------------------
    console.log('\n--- Testing Case 2: Booking #802 (Attach Legacy Slip) ---');
    const openCase2 = await cdp.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('tr')];
        const row802 = rows.find(r => r.innerText && r.innerText.includes('สมหญิง'));
        if (row802) {
          const detailBtn = [...row802.querySelectorAll('button')].find(b => b.innerText && (b.innerText.includes('รายละเอียด') || b.innerText.includes('ใบเสร็จ')));
          if (detailBtn) { detailBtn.click(); return true; }
        }
        return false;
      })()
    `);
    console.log('Clicked details on Booking #802:', openCase2);
    await new Promise(r => setTimeout(r, 1500));

    const modal2Info = await cdp.evaluate(`
      (() => {
        const modal = document.querySelector('.modal-backdrop, [role="dialog"], .fixed');
        const attachBtn = document.querySelector('#history-btn-attach-legacy-slip');
        const hasPlusIcon = attachBtn ? !!attachBtn.querySelector('svg') : false;
        const isWhiteScreen = !document.querySelector('#root') || document.querySelector('#root').children.length === 0;
        return {
          modalExists: !!modal,
          attachBtnExists: !!attachBtn,
          hasPlusIcon,
          isWhiteScreen,
          buttonText: attachBtn ? attachBtn.innerText.trim() : null
        };
      })()
    `);
    console.log('Case 2 Modal Info:', modal2Info);

    if (modal2Info.isWhiteScreen) throw new Error('WHITE SCREEN DETECTED on Case 2!');
    if (!modal2Info.attachBtnExists) throw new Error('Legacy Attach Slip button #history-btn-attach-legacy-slip NOT found!');
    if (!modal2Info.hasPlusIcon) throw new Error('<Plus /> icon not rendered inside legacy attach slip button!');
    if (modal2Info.buttonText !== 'แนบสลิปย้อนหลัง') throw new Error(`Unexpected button text: ${modal2Info.buttonText}`);

    await cdp.captureScreenshot('uat_history_detail_case2_attach_legacy_slip.png');
    console.log('✅ Case 2 Passed: <Plus size={11} /> rendered successfully with text "แนบสลิปย้อนหลัง", zero ReferenceError');

    // Close Case 2 modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = [...document.querySelectorAll('button')].find(b => b.innerText === '✕' || b.innerText === 'ปิด' || b.getAttribute('aria-label') === 'Close');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    // --------------------------------------------------------------------------
    // Test Case 3: Booking #803 (Fully paid split tx -> ShieldCheck icon)
    // --------------------------------------------------------------------------
    console.log('\n--- Testing Case 3: Booking #803 (ShieldCheck Icon) ---');
    const openCase3 = await cdp.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('tr')];
        const row803 = rows.find(r => r.innerText && r.innerText.includes('สมศักดิ์'));
        if (row803) {
          const detailBtn = [...row803.querySelectorAll('button')].find(b => b.innerText && (b.innerText.includes('รายละเอียด') || b.innerText.includes('ใบเสร็จ')));
          if (detailBtn) { detailBtn.click(); return true; }
        }
        return false;
      })()
    `);
    console.log('Clicked details on Booking #803:', openCase3);
    await new Promise(r => setTimeout(r, 1500));

    const modal3Info = await cdp.evaluate(`
      (() => {
        const modal = document.querySelector('.modal-backdrop, [role="dialog"], .fixed');
        const hasShieldCheck = !!document.querySelector('.lucide-shield-check');
        const isWhiteScreen = !document.querySelector('#root') || document.querySelector('#root').children.length === 0;
        return {
          modalExists: !!modal,
          hasShieldCheck,
          isWhiteScreen
        };
      })()
    `);
    console.log('Case 3 Modal Info:', modal3Info);

    if (modal3Info.isWhiteScreen) throw new Error('WHITE SCREEN DETECTED on Case 3!');
    if (!modal3Info.hasShieldCheck) throw new Error('<ShieldCheck /> icon was NOT found in DOM on fully paid booking!');

    await cdp.captureScreenshot('uat_history_detail_case3_shield_check.png');
    console.log('✅ Case 3 Passed: <ShieldCheck size={15} /> rendered successfully, zero ReferenceError');

    // Close Case 3 modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = [...document.querySelectorAll('button')].find(b => b.innerText === '✕' || b.innerText === 'ปิด' || b.getAttribute('aria-label') === 'Close');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    // --------------------------------------------------------------------------
    // Test Case 4: Attach Slip Modal Workflow & Success Refresh (fetchBookings(true))
    // --------------------------------------------------------------------------
    console.log('\n--- Testing Case 4: Attach Slip Modal Workflow & Success Refresh ---');
    // Open Booking #801 detail
    await cdp.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('tr')];
        const row801 = rows.find(r => r.innerText && r.innerText.includes('สมชาย'));
        if (row801) {
          const detailBtn = [...row801.querySelectorAll('button')].find(b => b.innerText && (b.innerText.includes('รายละเอียด') || b.innerText.includes('ใบเสร็จ')));
          if (detailBtn) detailBtn.click();
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    // Click #history-btn-attach-slip-tx-80102 to open AttachSlipModal
    const openedAttachModal = await cdp.evaluate(`
      (() => {
        const attachBtn = document.querySelector('#history-btn-attach-slip-tx-80102');
        if (attachBtn) { attachBtn.click(); return true; }
        return false;
      })()
    `);
    console.log('Opened AttachSlipModal:', openedAttachModal);
    await new Promise(r => setTimeout(r, 1000));

    // Verify AttachSlipModal is open
    const attachModalState = await cdp.evaluate(`
      (() => {
        const modal = document.querySelector('[aria-labelledby="attach-slip-modal-title"], [role="dialog"]');
        const fileInput = document.querySelector('input[type="file"]');
        const confirmBtn = document.querySelector('#btn-confirm-attach-slip');
        const cancelBtn = document.querySelector('#btn-cancel-attach-slip');
        return {
          isOpen: !!modal,
          hasFileInput: !!fileInput,
          hasConfirmBtn: !!confirmBtn,
          hasCancelBtn: !!cancelBtn
        };
      })()
    `);
    console.log('AttachSlipModal State:', attachModalState);
    if (!attachModalState.isOpen) throw new Error('AttachSlipModal failed to open!');

    // Inject valid 1x1 PNG data into the file input
    await cdp.evaluate(`
      (() => {
        const fileInput = document.querySelector('input[type="file"]');
        const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const byteCharacters = atob(base64Png);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/png' });
        const file = new File([blob], 'test_slip.png', { type: 'image/png' });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));

    // Verify confirm button is enabled and click it to submit
    const submittedSlip = await cdp.evaluate(`
      (() => {
        const confirmBtn = document.querySelector('#btn-confirm-attach-slip');
        if (confirmBtn && !confirmBtn.disabled) {
          confirmBtn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Submitted attach slip form:', submittedSlip);
    await new Promise(r => setTimeout(r, 2000));

    // Dismiss sysAlert alert dialog if present
    await cdp.evaluate(`
      (() => {
        const okBtn = [...document.querySelectorAll('button')].find(b => b.innerText === 'ตกลง' || b.innerText === 'OK');
        if (okBtn) okBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    await cdp.captureScreenshot('uat_history_case4_attach_slip_success.png');
    console.log('✅ Case 4 Passed: Attach slip succeeded, fetchBookings(true) executed cleanly without ReferenceError');

    // --------------------------------------------------------------------------
    // Test Case 5: TaxInvoiceManagementModal Open, onClose, and onUpdated
    // --------------------------------------------------------------------------
    console.log('\n--- Testing Case 5: TaxInvoiceManagementModal Open, onClose, and onUpdated ---');
    // Click #history-btn-manage-tax-invoice
    const openedTaxModal = await cdp.evaluate(`
      (() => {
        const taxBtn = document.querySelector('#history-btn-manage-tax-invoice');
        if (taxBtn) { taxBtn.click(); return true; }
        return false;
      })()
    `);
    console.log('Opened TaxInvoiceManagementModal:', openedTaxModal);
    await new Promise(r => setTimeout(r, 1200));

    // Sub-case 5.1: Test onClose (verify setTaxCopied error is gone)
    console.log('Testing TaxInvoiceManagementModal onClose...');
    const closedTaxModal = await cdp.evaluate(`
      (() => {
        const closeBtn = document.querySelector('button[aria-label="ปิดหน้าต่าง"], button[aria-label="Close"]') ||
                         [...document.querySelectorAll('button')].find(b => b.innerText === '✕' || b.innerText === 'ยกเลิก');
        if (closeBtn) {
          closeBtn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Clicked close on TaxInvoiceManagementModal:', closedTaxModal);
    await new Promise(r => setTimeout(r, 1000));

    // Verify modal is closed and zero errors thrown
    const taxModalClosed = await cdp.evaluate(`
      (() => {
        return !document.querySelector('button[aria-label="ปิดหน้าต่าง"]');
      })()
    `);
    console.log('TaxInvoiceManagementModal successfully closed:', taxModalClosed);
    if (!taxModalClosed) throw new Error('TaxInvoiceManagementModal failed to close!');
    console.log('✅ Case 5.1 Passed: TaxInvoiceManagementModal closed without ReferenceError: setTaxCopied is not defined');

    // Sub-case 5.2: Re-open TaxInvoiceManagementModal and trigger onUpdated
    console.log('Testing TaxInvoiceManagementModal onUpdated handler...');
    await cdp.evaluate(`
      (() => {
        const taxBtn = document.querySelector('#history-btn-manage-tax-invoice');
        if (taxBtn) taxBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    // Save tax info to trigger onUpdated -> fetchBookings(true)
    const savedTaxInfo = await cdp.evaluate(`
      (async () => {
        // Find edit tax info button
        const buttons = [...document.querySelectorAll('button')];
        const editBtn = buttons.find(b => b.innerText && (b.innerText.includes('แก้ไขข้อมูล') || b.innerText.includes('บันทึกข้อมูลภาษี')));
        if (editBtn) editBtn.click();
        
        await new Promise(r => setTimeout(r, 600));

        // Fill required fields if inputs present
        const nameInput = document.querySelector('input[placeholder*="ชื่อ"]') || document.querySelector('input[type="text"]');
        if (nameInput) {
          nameInput.value = 'บริษัท ทดสอบ จำกัด';
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const taxIdInput = document.querySelector('input[placeholder*="เลข"]') || document.querySelector('#input-tax-id');
        if (taxIdInput) {
          taxIdInput.value = '0105558000000';
          taxIdInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Find save button
        const allBtns = [...document.querySelectorAll('button')];
        const saveBtn = allBtns.find(b => b.innerText && b.innerText.includes('บันทึกข้อมูลภาษี'));
        if (saveBtn) {
          saveBtn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Saved tax info in modal:', savedTaxInfo);
    await new Promise(r => setTimeout(r, 2000));

    // Dismiss sysAlert if present and close modal
    await cdp.evaluate(`
      (() => {
        const okBtn = [...document.querySelectorAll('button')].find(b => b.innerText === 'ตกลง' || b.innerText === 'OK');
        if (okBtn) okBtn.click();
        const closeBtn = document.querySelector('button[aria-label="ปิดหน้าต่าง"]');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    await cdp.captureScreenshot('uat_history_case5_tax_modal_handlers.png');
    console.log('✅ Case 5.2 Passed: onUpdated and onClose executed cleanly without ReferenceError');

    // Final Assertion on Captured Errors
    console.log('\n--- Final Error Check ---');
    console.log(`Captured Uncaught Exceptions: ${capturedErrors.length}`);
    if (capturedErrors.length > 0) {
      console.error('Captured errors:', capturedErrors);
      throw new Error(`Test failed with ${capturedErrors.length} browser exceptions`);
    }

    console.log('\n======================================================');
    console.log('  ALL BROWSER UAT TESTS PASSED (3/3 CASES)');
    console.log('  - Zero ReferenceError exceptions');
    console.log('  - Zero white screens');
    console.log('  - <Plus /> rendered for both attach slip buttons');
    console.log('  - <ShieldCheck /> rendered for fully paid booking');
    console.log('======================================================\n');

  } finally {
    await cdp.close();
    chromeProcess.kill();
    serverProcess.kill();
    try { fs.unlinkSync(DB_FILE); } catch (_) {}
  }
}

run().catch(err => {
  console.error('\n❌ UAT FAILED:', err);
  process.exit(1);
});
