const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT_DIR = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const TEST_DB_PATH = path.join(BACKEND_DIR, 'database_ui_test.sqlite');

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function takeScreenshot(send, filePath) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(data, 'base64');
  fs.writeFileSync(filePath, buffer);
  console.log(`  [Screenshot Saved] -> ${path.basename(filePath)}`);
}

async function main() {
  console.log('====================================================');
  console.log('  BWORK-POS TAX INVOICE EMAIL DRY-RUN UI UAT (390px) ');
  console.log('====================================================\n');

  // Step 1: Initialize isolated test database
  console.log('Step 1: Setting up isolated test database...');
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch (_) {}
  }

  process.env.DB_PATH = TEST_DB_PATH;
  const { initDatabase, dbQuery } = require('../backend/database');
  await initDatabase();

  // Create upload dir and sample PDF
  const invUploadDir = path.join(BACKEND_DIR, 'uploads', 'tax_invoices');
  fs.mkdirSync(invUploadDir, { recursive: true });
  const samplePdfPath = path.join(invUploadDir, 'INV-202611-001.pdf');
  fs.writeFileSync(samplePdfPath, Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'));

  // Seed sample booking with tax invoice
  const bRes = await dbQuery.run(
    `INSERT INTO bookings (
      customer_name, contact, total_amount, paid_amount, payment_status,
      tax_invoice_required, tax_payer_type, tax_name, tax_id, tax_branch_type,
      tax_address, tax_email, tax_phone, tax_delivery_method, tax_invoice_status,
      created_at
    ) VALUES (
      'บริษัท ทริปเปิ้ลเอ็กซ์ จำกัด', '0899998888', 4500, 4500, 'paid',
      1, 'corporate', 'บริษัท ทริปเปิ้ลเอ็กซ์ จำกัด', '0105559999999', 'head',
      '88 อาคารเพรสทีจ ชั้น 12 ถนนสุขุมวิท', 'finance@triplex.co.th', '0899998888', 'email', 'issued',
      datetime('now')
    )`
  );
  const testBookingId = bRes.id;

  try {
    await dbQuery.run(
      `INSERT INTO booking_items (booking_id, room_id, price, subtotal, start_time, end_time)
       VALUES (?, 1, 4500, 4500, datetime('now', '+1 hour'), datetime('now', '+3 hours'))`,
      [testBookingId]
    );
  } catch (_) {}

  await dbQuery.run(
    `INSERT INTO tax_invoices (
      booking_id, invoice_number, tax_payer_type, tax_name, tax_id,
      tax_email, file_url, file_name, content_type, file_size, status, email_status, created_at
    ) VALUES (
      ?, 'INV-202611-001', 'corporate', 'บริษัท ทริปเปิ้ลเอ็กซ์ จำกัด', '0105559999999',
      'finance@triplex.co.th', '/uploads/tax_invoices/INV-202611-001.pdf', 'INV-202611-001.pdf',
      'application/pdf', 1540, 'issued', 'unsent', datetime('now')
    )`,
    [testBookingId]
  );
  console.log(`  Seeded test booking #${testBookingId} with attached PDF tax invoice`);

  // Step 2: Start Express Backend serving backend/public on port 5003
  console.log('\nStep 2: Starting Express server on port 5003...');
  const backendProc = spawn('node', ['backend/server.js'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: '5003',
      DB_PATH: TEST_DB_PATH,
      APP_ENV: 'development'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProc.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('Server is running') || s.includes('DRY-RUN')) {
      console.log(`  [Server] ${s.trim()}`);
    }
  });

  await waitForHttp('http://127.0.0.1:5003/api/rooms');
  console.log('  Server is up and running on http://127.0.0.1:5003');

  // Step 3: Launch Headless Chrome on CDP port 9235
  console.log('\nStep 3: Launching Headless Chrome on CDP 9235...');
  const tempProfile = path.join(ARTIFACT_DIR, 'scratch', 'chrome_tax_email_profile');
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(tempProfile, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9235',
    `--user-data-dir=${tempProfile}`,
    '--window-size=1280,900',
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const pages = await new Promise((resolve, reject) => {
    http.get('http://localhost:9235/json', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const targetPage = pages.find(p => p.type === 'page');
  const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');

  // Step 4: Login as admin
  console.log('\nStep 4: Authenticating admin and loading POS...');
  const loginRes = await fetch('http://127.0.0.1:5003/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  }).then(r => r.json()).catch(() => null);

  const token = loginRes?.token || '';
  console.log('  Login status:', Boolean(token), 'user:', loginRes?.user?.username);

  await send('Page.navigate', { url: 'http://localhost:5003/' });
  await new Promise(r => setTimeout(r, 1500));

  if (token) {
    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('pos_token', '${token}');
        localStorage.setItem('token', '${token}');
        localStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(loginRes.user)}));
        location.reload();
      `
    });
    await new Promise(r => setTimeout(r, 2000));
  }

  // Step 5: Test Mobile Viewport 390px (iPhone 12/13/14)
  console.log('\nStep 5: Testing Mobile Viewport 390x844...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await new Promise(r => setTimeout(r, 800));

  // Navigate to History tab
  console.log('  Navigating to History tab...');
  await send('Runtime.evaluate', {
    expression: `
      // Try to find the history button/card
      const allElements = Array.from(document.querySelectorAll('button, div, a'));
      const historyEl = allElements.find(el => 
        el.className && (el.className.includes('menu-card') || el.className.includes('top-menu-item')) &&
        (el.textContent.includes('ประวัติ') || el.textContent.includes('History'))
      ) || allElements.find(el => el.textContent.trim() === 'ประวัติการจอง' || el.textContent.trim() === 'ประวัติ');

      if (historyEl) historyEl.click();
    `
  });
  await new Promise(r => setTimeout(r, 2000));

  // Open the TaxInvoiceManagementModal by clicking the tax button on the booking row
  console.log('  Clicking tax invoice button on booking row...');
  await send('Runtime.evaluate', {
    expression: `
      const taxBtn = document.querySelector('button[title*="ข้อมูลใบกำกับภาษี"]') ||
                     Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ใบกำกับ'));
      if (taxBtn) {
        taxBtn.click();
      } else {
        // If row clicked, open drawer then click tax button
        const row = document.querySelector('.history-row, tr, [data-booking-id]');
        if (row) row.click();
      }
    `
  });
  await new Promise(r => setTimeout(r, 2000));

  // Verify modal elements
  const checkModal = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const modal = document.querySelector('#tax-email-dispatch-card');
        const badge = document.querySelector('#badge-tax-email-status');
        const previewBtn = document.querySelector('#btn-tax-email-preview');
        const sendBtn = document.querySelector('#btn-tax-simulate-send-email');
        return {
          hasCard: Boolean(modal),
          badgeText: badge ? badge.textContent.trim() : null,
          hasPreviewBtn: Boolean(previewBtn),
          hasSendBtn: Boolean(sendBtn),
          cardWidth: modal ? modal.getBoundingClientRect().width : 0
        };
      })()
    `,
    returnByValue: true
  });

  console.log('  Modal status check:', checkModal.result.value);

  // Capture Screenshot 1: Mobile 390px initial view with e-Tax card
  const mobileShot1 = path.join(ARTIFACT_DIR, 'pos_tax_email_dispatch_mobile_390.png');
  await takeScreenshot(send, mobileShot1);

  // Step 6: Test Preview Modal
  console.log('\nStep 6: Testing Email Preview Sub-modal...');
  await send('Runtime.evaluate', {
    expression: `
      const previewBtn = document.querySelector('#btn-tax-email-preview');
      if (previewBtn) previewBtn.click();
    `
  });
  await new Promise(r => setTimeout(r, 1500));

  const checkPreview = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const previewModal = document.querySelector('#tax-email-preview-modal');
        const htmlTab = document.querySelector('#btn-preview-tab-html');
        const textTab = document.querySelector('#btn-preview-tab-text');
        return {
          isOpen: Boolean(previewModal),
          hasTabs: Boolean(htmlTab && textTab)
        };
      })()
    `,
    returnByValue: true
  });
  console.log('  Preview modal check:', checkPreview.result.value);

  // Capture Screenshot 2: Mobile 390px Email Preview
  const mobileShot2 = path.join(ARTIFACT_DIR, 'pos_tax_email_preview_mobile_390.png');
  await takeScreenshot(send, mobileShot2);

  // Close preview modal
  await send('Runtime.evaluate', {
    expression: `
      const closeBtn = document.querySelector('#btn-close-email-preview-footer') || document.querySelector('#btn-close-email-preview-x');
      if (closeBtn) closeBtn.click();
    `
  });
  await new Promise(r => setTimeout(r, 800));

  // Step 7: Test Simulate Send (Dry-run)
  console.log('\nStep 7: Testing Simulate Send Email (Dry-run)...');
  await send('Runtime.evaluate', {
    expression: `
      const sendBtn = document.querySelector('#btn-tax-simulate-send-email');
      if (sendBtn) sendBtn.click();
    `
  });
  await new Promise(r => setTimeout(r, 2000));

  const checkAfterSend = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const badge = document.querySelector('#badge-tax-email-status');
        return {
          badgeText: badge ? badge.textContent.trim() : null
        };
      })()
    `,
    returnByValue: true
  });
  console.log('  Status badge after dry-run dispatch:', checkAfterSend.result.value);

  // Capture Screenshot 3: Mobile 390px after Dry-run dispatch
  const mobileShot3 = path.join(ARTIFACT_DIR, 'pos_tax_email_dispatch_sent_mobile_390.png');
  await takeScreenshot(send, mobileShot3);

  // Step 8: Test Desktop Viewport 1280x800
  console.log('\nStep 8: Testing Desktop Viewport 1280x800...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });
  await new Promise(r => setTimeout(r, 1000));

  const desktopShot = path.join(ARTIFACT_DIR, 'pos_tax_email_dispatch_desktop.png');
  await takeScreenshot(send, desktopShot);

  // Clean up
  console.log('\nStep 9: Cleaning up processes...');
  ws.close();
  chromeProc.kill();
  backendProc.kill();
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  try { fs.unlinkSync(TEST_DB_PATH); } catch (_) {}

  console.log('\n====================================================');
  console.log('  ALL BROWSER UAT TESTS & SCREENSHOTS COMPLETED!');
  console.log('====================================================');
}

main().catch(err => {
  console.error('[UAT Fatal Error]', err);
  process.exit(1);
});
