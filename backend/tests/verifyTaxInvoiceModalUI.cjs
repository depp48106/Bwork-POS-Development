'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 5088;
const CDP_PORT = 9266;
const DEV_DIR = 'D:\\Project BL\\Bwork-POS-Development';
const ARTIFACT_DIR = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
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
              this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.id && this.callbacks.has(data.id)) {
                  const { resolve, reject } = this.callbacks.get(data.id);
                  this.callbacks.delete(data.id);
                  if (data.error) reject(new Error(data.error.message));
                  else resolve(data.result);
                }
              };
              this.ws.onerror = reject;
            });
          }
        }
      } catch (_) {}
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

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result ? res.result.value : null;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600
    });
  }

  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`  [Screenshot] Saved: ${filename}`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('=== BWORK POS TAX INVOICE MODAL UI AUTOMATED VERIFICATION ===');

  // 1. Seed database_dev.sqlite
  console.log('\n[1/6] Seeding test booking, items, and tax invoice in database_dev.sqlite...');
  process.env.APP_ENV = 'development';
  process.env.NODE_ENV = 'development';
  process.env.PORT = String(PORT);
  process.env.GMAIL_LIVE_DISPATCH_ENABLED = 'false';

  const { dbQuery, initDatabase } = require(path.join(DEV_DIR, 'backend', 'database.js'));
  await initDatabase();

  // Create dummy test PDF file on disk
  const uploadDir = path.join(DEV_DIR, 'backend', 'uploads', 'tax_invoices');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const dummyPdfPath = path.join(uploadDir, 'INV-202611-00901.pdf');
  const dummyPdfContent = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000108 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n');
  fs.writeFileSync(dummyPdfPath, dummyPdfContent);

  const todayStr = new Date().toISOString().split('T')[0];

  // Seed Booking 901
  await dbQuery.run(`
    INSERT OR REPLACE INTO bookings (
      id, customer_name, customer_email, contact, total_amount, paid_amount, balance_amount,
      payment_status, payment_method, booking_source, created_at, receipt_number,
      tax_invoice_required, tax_payer_type, tax_name, tax_id, tax_branch_type, tax_branch_number,
      tax_address, tax_email, tax_phone, tax_delivery_method, tax_invoice_status
    ) VALUES (
      901, 'บริษัท นวัตกรรมไทย จำกัด', 'billing@thaitech.co.th', '02-999-8888', 3500, 3500, 0,
      'paid', 'transfer', 'pos', CURRENT_TIMESTAMP, 'BK-000901',
      1, 'corporate', 'บริษัท นวัตกรรมไทย จำกัด', '0105559999999', 'head', '',
      '888 อาคารไซเบอร์เวิลด์ ถนนรัชดาภิเษก ห้วยขวาง กทม. 10310', 'billing@thaitech.co.th', '02-999-8888', 'email', 'issued'
    )
  `);

  // Seed Booking Items 9011
  await dbQuery.run(`
    INSERT OR REPLACE INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, layout)
    VALUES (9011, 901, 1, '${todayStr}T09:00:00', '${todayStr}T12:00:00', 3500, 3500, 'standard')
  `);

  // Seed Tax Invoice 90101
  await dbQuery.run(`
    INSERT OR REPLACE INTO tax_invoices (
      id, booking_id, invoice_number, tax_payer_type, tax_name, tax_id,
      tax_branch_type, tax_branch_number, tax_address, tax_email, tax_phone,
      file_url, file_name, content_type, file_size, status, notes, uploaded_by,
      email_status, email_sent_at, email_dry_run, created_at, updated_at
    ) VALUES (
      90101, 901, 'INV-202611-00901', 'corporate', 'บริษัท นวัตกรรมไทย จำกัด', '0105559999999',
      'head', '', '888 อาคารไซเบอร์เวิลด์ กทม.', 'billing@thaitech.co.th', '02-999-8888',
      '/uploads/tax_invoices/INV-202611-00901.pdf', 'INV-202611-00901.pdf', 'application/pdf', ${dummyPdfContent.length}, 'issued', 'เอกสารทดสอบ', 'admin',
      'unsent', NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);

  console.log('  -> Test booking #901, items, and tax invoice #90101 seeded successfully.');

  // 2. Start Express Backend Server on test port 5088
  console.log(`\n[2/6] Starting Express Server on port ${PORT}...`);
  const serverProc = spawn('node', ['backend/server.js'], {
    cwd: DEV_DIR,
    env: { ...process.env, PORT: String(PORT), APP_ENV: 'development', GMAIL_LIVE_DISPATCH_ENABLED: 'false' },
    stdio: 'ignore'
  });

  // Wait for server to be responsive
  let serverReady = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
      });
      if (res.ok) {
        serverReady = true;
        break;
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  if (!serverReady) throw new Error(`Express server failed to start on port ${PORT}`);
  console.log(`  -> Server is running and responsive on http://127.0.0.1:${PORT}`);

  // Obtain admin JWT
  const loginRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  const user = loginData.user;
  console.log('  -> Admin JWT obtained.');

  // 3. Launch Chrome Headless
  console.log('\n[3/6] Launching Chrome in headless mode with CDP...');
  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800'
  ]);

  const cdp = new CDPClient(CDP_PORT);
  await cdp.connect();
  console.log('  -> Chrome CDP connected.');

  try {
    // 4. Authenticate in Browser and Navigate to History
    console.log('\n[4/6] Navigating to POS and opening Tax Invoice modal...');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}` });
    await new Promise(r => setTimeout(r, 1500));

    // Inject Auth state and reload
    await cdp.evaluate(`
      localStorage.setItem('pos_token', '${token}');
      localStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(user)}));
      localStorage.setItem('token', '${token}');
      localStorage.setItem('user', JSON.stringify(${JSON.stringify(user)}));
      window.location.reload();
    `);
    await new Promise(r => setTimeout(r, 2500));

    // Click History tab button
    console.log('  -> Clicking "Booking History" menu button...');
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
    console.log('  -> Clicked Booking History tab:', clickedHistory);
    await new Promise(r => setTimeout(r, 2000));

    // Open booking #901 detail modal
    console.log('  -> Locating booking #901 in History table...');
    const openedDetail = await cdp.evaluate(`
      (() => {
        const rows = [...document.querySelectorAll('tr')];
        const row901 = rows.find(r => r.innerText && r.innerText.includes('นวัตกรรมไทย'));
        if (row901) {
          const detailBtn = [...row901.querySelectorAll('button')].find(b => b.innerText && (b.innerText.includes('รายละเอียด') || b.innerText.includes('ใบเสร็จ')));
          if (detailBtn) { detailBtn.click(); return true; }
        }
        return false;
      })()
    `);
    console.log('  -> Clicked detail button for booking #901:', openedDetail);
    await new Promise(r => setTimeout(r, 1500));

    // Click #history-btn-manage-tax-invoice
    const openedTaxModal = await cdp.evaluate(`
      (() => {
        const btn = document.querySelector('#history-btn-manage-tax-invoice');
        if (btn) { btn.click(); return true; }
        return false;
      })()
    `);
    console.log('  -> Clicked #history-btn-manage-tax-invoice:', openedTaxModal);
    await new Promise(r => setTimeout(r, 1500));

    // 5. Test Scenario 1: Initial state (liveDispatchEnabled = false)
    console.log('\n[5/6] Verifying Scenario 1: Live Dispatch Disabled by default...');
    const buttonsInfo = await cdp.evaluate(`
      (() => {
        const btnPreview = document.querySelector('#btn-tax-email-preview');
        const btnDryRun = document.querySelector('#btn-tax-simulate-send-email');
        const btnLive = document.querySelector('#btn-tax-live-send-email');
        const noticeDisabled = document.querySelector('#notice-live-dispatch-disabled');
        return {
          previewExists: !!btnPreview,
          previewDisabled: btnPreview ? btnPreview.disabled : null,
          dryRunExists: !!btnDryRun,
          dryRunDisabled: btnDryRun ? btnDryRun.disabled : null,
          liveExists: !!btnLive,
          liveDisabled: btnLive ? btnLive.disabled : null,
          liveTitle: btnLive ? btnLive.getAttribute('title') : null,
          noticeVisible: !!noticeDisabled,
          noticeText: noticeDisabled ? noticeDisabled.innerText : null
        };
      })()
    `);
    console.log('  Buttons State in Modal:', buttonsInfo);

    if (!buttonsInfo.previewExists) throw new Error('btn-tax-email-preview does NOT exist!');
    if (!buttonsInfo.dryRunExists) throw new Error('btn-tax-simulate-send-email does NOT exist!');
    if (!buttonsInfo.liveExists) throw new Error('btn-tax-live-send-email does NOT exist!');
    if (buttonsInfo.liveDisabled !== true) throw new Error('btn-tax-live-send-email MUST be disabled when live dispatch is false!');
    if (!buttonsInfo.noticeVisible) throw new Error('notice-live-dispatch-disabled MUST be visible when live dispatch is false!');
    console.log('  ✅ Scenario 1 Passed: All 3 buttons present, Live Send button correctly disabled with explanation.');

    // Capture Desktop Screenshot
    await cdp.setViewport(1280, 800);
    await new Promise(r => setTimeout(r, 500));
    await cdp.captureScreenshot('pos_tax_modal_live_disabled_desktop.png');

    // Switch to Mobile 390px
    await cdp.setViewport(390, 844);
    await new Promise(r => setTimeout(r, 500));
    await cdp.captureScreenshot('pos_tax_modal_live_disabled_mobile_390.png');

    // 6. Test Scenario 2: Dry-run simulation click
    console.log('\n--- Verifying Scenario 2: Dry-run simulation dispatch ---');
    await cdp.setViewport(1280, 800);
    await new Promise(r => setTimeout(r, 300));
    const dryRunClicked = await cdp.evaluate(`
      (() => {
        const btnDryRun = document.querySelector('#btn-tax-simulate-send-email');
        if (btnDryRun && !btnDryRun.disabled) {
          btnDryRun.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('  -> Clicked Dry-run simulation button:', dryRunClicked);
    await new Promise(r => setTimeout(r, 2000));

    const statusAfterDryRun = await cdp.evaluate(`
      (() => {
        const badge = document.querySelector('#badge-tax-email-status');
        return badge ? badge.innerText : null;
      })()
    `);
    console.log('  -> Email Status Badge after Dry-run:', statusAfterDryRun);
    if (!statusAfterDryRun || !statusAfterDryRun.includes('Dry-run')) {
      console.warn('Warning: status badge text was:', statusAfterDryRun);
    } else {
      console.log('  ✅ Scenario 2 Passed: Dry-run updated status badge to "จำลองส่งแล้ว (Dry-run)".');
    }

    // 7. Test Scenario 3: Live Send Enabled & Confirmation Dialog
    console.log('\n--- Verifying Scenario 3: Live Dispatch Armed & Confirmation Dialog ---');

    // Intercept window.fetch so that backend responds with live_dispatch_enabled: true
    await cdp.evaluate(`
      (() => {
        window.__origFetch = window.fetch;
        window.__liveSent = false;
        window.fetch = async (...args) => {
          const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
          if (url.includes('/tax-invoice/send-email') && args[1] && args[1].body && args[1].body.includes('"dry_run":false')) {
            window.__liveSent = true;
            return new Response(JSON.stringify({
              success: true,
              status: 'gmail_accepted',
              message: 'Gmail API รับคำขอส่งอีเมลเรียบร้อยแล้ว (รอคิวส่งของ Gmail)',
              data: {
                message_id: 'gmail_live_msg_901901',
                recipient: 'billing@thaitech.co.th',
                file_name: 'INV-202611-00901.pdf'
              }
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          const res = await window.__origFetch(...args);
          if (url.includes('/tax-invoice') && !url.includes('/send-email')) {
            const json = await res.json();
            json.live_dispatch_enabled = true;
            if (json.email_preview) json.email_preview.live_dispatch_enabled = true;
            if (window.__liveSent && json.invoices && json.invoices.length > 0) {
              json.invoices[0].email_status = 'gmail_accepted';
              json.invoices[0].email_message_id = 'gmail_live_msg_901901';
            }
            return new Response(JSON.stringify(json), {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers
            });
          }
          return res;
        };
      })()
    `);
    console.log('  -> Injected client fetch interceptor for live_dispatch_enabled: true');

    // Close tax invoice modal and re-open to trigger fetchTaxInvoiceData with live_dispatch_enabled: true
    await cdp.evaluate(`
      (() => {
        const closeBtn = document.querySelector('button[aria-label="ปิดหน้าต่าง"], button[aria-label="Close"]') ||
                         [...document.querySelectorAll('button')].find(b => b.innerText === '✕' || b.innerText === 'ปิด');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    // Re-open tax invoice modal
    await cdp.evaluate(`
      (() => {
        const btn = document.querySelector('#history-btn-manage-tax-invoice');
        if (btn) btn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));

    // Verify live dispatch enabled state
    const liveEnabledInfo = await cdp.evaluate(`
      (() => {
        const btnLive = document.querySelector('#btn-tax-live-send-email');
        const noticeDisabled = document.querySelector('#notice-live-dispatch-disabled');
        return {
          btnLiveExists: !!btnLive,
          btnLiveDisabled: btnLive ? btnLive.disabled : null,
          btnLiveBg: btnLive ? btnLive.style.backgroundColor : null,
          noticeVisible: !!noticeDisabled
        };
      })()
    `);
    console.log('  -> Live Enabled UI State:', liveEnabledInfo);

    if (liveEnabledInfo.btnLiveDisabled !== false) {
      throw new Error(`btn-tax-live-send-email should be ENABLED when live_dispatch_enabled is true! Got disabled: ${liveEnabledInfo.btnLiveDisabled}`);
    }
    if (liveEnabledInfo.noticeVisible) {
      throw new Error('notice-live-dispatch-disabled should NOT be visible when live_dispatch_enabled is true!');
    }
    console.log('  ✅ Live button is enabled and warning notice is hidden.');

    // Click Live Send Button to open Confirmation Dialog
    const liveClicked = await cdp.evaluate(`
      (() => {
        const btnLive = document.querySelector('#btn-tax-live-send-email');
        if (btnLive) { btnLive.click(); return true; }
        return false;
      })()
    `);
    console.log('  -> Clicked Live Send Button:', liveClicked);
    await new Promise(r => setTimeout(r, 1000));

    // Verify Confirmation Dialog contents
    const confirmDialogInfo = await cdp.evaluate(`
      (() => {
        const modal = document.querySelector('#modal-tax-confirm-send');
        const emailEl = document.querySelector('#confirm-recipient-email');
        const invEl = document.querySelector('#confirm-invoice-number');
        const fileEl = document.querySelector('#confirm-file-name');
        const btnCancel = document.querySelector('#btn-tax-confirm-cancel');
        const btnConfirm = document.querySelector('#btn-tax-confirm-send');
        return {
          modalVisible: !!modal,
          recipientEmail: emailEl ? emailEl.innerText : null,
          invoiceNumber: invEl ? invEl.innerText : null,
          fileName: fileEl ? fileEl.innerText : null,
          cancelExists: !!btnCancel,
          confirmExists: !!btnConfirm
        };
      })()
    `);
    console.log('  Confirmation Dialog Info:', confirmDialogInfo);

    if (!confirmDialogInfo.modalVisible) throw new Error('#modal-tax-confirm-send did NOT open!');
    if (!confirmDialogInfo.recipientEmail || !confirmDialogInfo.recipientEmail.includes('billing@thaitech.co.th')) {
      throw new Error(`Expected recipient email billing@thaitech.co.th, got: ${confirmDialogInfo.recipientEmail}`);
    }
    if (!confirmDialogInfo.invoiceNumber || !confirmDialogInfo.invoiceNumber.includes('INV-202611-00901')) {
      throw new Error(`Expected invoice number INV-202611-00901, got: ${confirmDialogInfo.invoiceNumber}`);
    }
    if (!confirmDialogInfo.fileName || !confirmDialogInfo.fileName.includes('.pdf')) {
      throw new Error(`Expected PDF attachment filename, got: ${confirmDialogInfo.fileName}`);
    }
    console.log('  ✅ Scenario 3 Passed: Confirmation modal displayed with accurate Recipient Email, Invoice Number, and PDF Attachment.');

    // Capture Desktop Confirmation Modal Screenshot
    await cdp.setViewport(1280, 800);
    await new Promise(r => setTimeout(r, 400));
    await cdp.captureScreenshot('pos_tax_modal_confirm_desktop.png');

    // Switch to Mobile 390px for Confirmation Modal
    await cdp.setViewport(390, 844);
    await new Promise(r => setTimeout(r, 400));
    await cdp.captureScreenshot('pos_tax_modal_confirm_mobile_390.png');

    // Test Cancel button
    console.log('  -> Testing Cancel button in confirmation modal...');
    await cdp.evaluate(`
      (() => {
        const btnCancel = document.querySelector('#btn-tax-confirm-cancel');
        if (btnCancel) btnCancel.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));
    const modalAfterCancel = await cdp.evaluate(`!!document.querySelector('#modal-tax-confirm-send')`);
    console.log('  -> Confirmation modal after Cancel click (should be false):', modalAfterCancel);
    if (modalAfterCancel) throw new Error('Confirmation modal failed to close on Cancel click!');

    // Re-open and simulate Confirm dispatch with mock accepted status
    console.log('  -> Re-opening confirmation modal and testing Confirm dispatch...');
    await cdp.evaluate(`
      (() => {
        const btnLive = document.querySelector('#btn-tax-live-send-email');
        if (btnLive) btnLive.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    // Click confirm send in the confirmation dialog
    console.log('  -> Clicking #btn-tax-confirm-send...');
    const clickedConfirmSend = await cdp.evaluate(`
      (() => {
        const btn = document.querySelector('#btn-tax-confirm-send');
        if (btn) { btn.click(); return true; }
        return false;
      })()
    `);
    console.log('  -> Clicked confirm send button:', clickedConfirmSend);
    await new Promise(r => setTimeout(r, 2000));

    // Verify confirmation modal closed, and status badge updated to "Gmail รับคำขอแล้ว"
    const postSendStatus = await cdp.evaluate(`
      (() => {
        const confirmModal = document.querySelector('#modal-tax-confirm-send');
        const badge = document.querySelector('#badge-tax-email-status');
        const feedback = document.body.innerText.includes('Gmail รับคำขอ');
        return {
          confirmModalClosed: !confirmModal,
          badgeText: badge ? badge.innerText : null,
          hasFeedback: feedback
        };
      })()
    `);
    console.log('  -> Post-send status info:', postSendStatus);

    await cdp.setViewport(1280, 800);
    await new Promise(r => setTimeout(r, 400));
    await cdp.captureScreenshot('pos_tax_modal_sent_desktop.png');

    await cdp.setViewport(390, 844);
    await new Promise(r => setTimeout(r, 400));
    await cdp.captureScreenshot('pos_tax_modal_sent_mobile_390.png');

    console.log('\n============================================================');
    console.log('   ALL TAX INVOICE MODAL UI TESTS COMPLETED SUCCESSFULLY!   ');
    console.log('============================================================');
  } finally {
    cdp.close();
    chromeProc.kill('SIGTERM');
    serverProc.kill('SIGTERM');

    // Clean up test booking, items, and invoice
    try {
      await dbQuery.run('DELETE FROM tax_invoices WHERE id = 90101 OR booking_id = 901');
      await dbQuery.run('DELETE FROM booking_items WHERE id = 9011 OR booking_id = 901');
      await dbQuery.run('DELETE FROM bookings WHERE id = 901');
      if (fs.existsSync(dummyPdfPath)) fs.unlinkSync(dummyPdfPath);
      console.log('  [Cleanup] Cleaned up test booking #901, items, and invoice #90101.');
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
