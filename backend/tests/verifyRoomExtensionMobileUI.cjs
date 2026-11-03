/**
 * verifyRoomExtensionMobileUI.cjs
 * Comprehensive Browser UAT for Room Extension Modal
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { spawn } = require('child_process');

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
const EVIDENCE_DIR = path.resolve(__dirname, '../ui-review-evidence/uat-evidence');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9236;
const TEST_PORT = 5198;

// Isolated SQLite database path
const ISOLATED_DB_PATH = path.resolve(__dirname, '../database_uat_extension_mobile.sqlite');
if (fs.existsSync(ISOLATED_DB_PATH)) {
  try { fs.unlinkSync(ISOLATED_DB_PATH); } catch (e) {}
}
process.env.DB_PATH = ISOLATED_DB_PATH;
process.env.APP_ENV = 'test';

// Import database and server after setting environment variables
const { dbQuery } = require('../database.js');
const { app, dbInitPromise, createToken } = require('../server.js');

const SEED_ROOMS = [
  { id: 4, name: 'Mars (301)', capacity: 12, hourly_rate: 300, image_url: '/uploads/rooms/img_1784255043064_qip98.png', classroom_image_url: null, status: 'active', has_hourly: 1 },
  { id: 5, name: 'Mercury (302)', capacity: 8, hourly_rate: 250, image_url: '/uploads/rooms/img_1784255053352_gyczk.png', classroom_image_url: null, status: 'active', has_hourly: 1 },
  { id: 6, name: 'Saturn (303)', capacity: 6, hourly_rate: 200, image_url: '/uploads/rooms/img_1784255104724_sitlj.png', classroom_image_url: null, status: 'active', has_hourly: 1 }
];

async function seedTestDatabase() {
  console.log('[Seed] Waiting for database migrations and seeding test data...');
  if (dbInitPromise) await dbInitPromise;

  await dbQuery.run('DELETE FROM booking_items WHERE booking_id IN (201, 202)');
  await dbQuery.run('DELETE FROM payment_transactions WHERE booking_id IN (201, 202)');
  await dbQuery.run('DELETE FROM booking_history WHERE booking_id IN (201, 202)');
  await dbQuery.run('DELETE FROM bookings WHERE id IN (201, 202)');
  await dbQuery.run('DELETE FROM rooms');

  for (const r of SEED_ROOMS) {
    await dbQuery.run(`
      INSERT INTO rooms (id, name, capacity, hourly_rate, image_url, classroom_image_url, status, has_hourly)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [r.id, r.name, r.capacity, r.hourly_rate, r.image_url, r.classroom_image_url, r.status, r.has_hourly]);
  }

  const todayIso = new Date().toISOString().split('T')[0];

  // Booking 201: Single-Room Booking (Room 4 Mars, 10:00 - 12:00)
  await dbQuery.run(`
    INSERT INTO bookings (id, customer_name, contact, total_amount, paid_amount, balance_amount, payment_status, payment_method, checkin_status, customer_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [201, 'คุณธนากร ทดสอบระบบ', '081-111-2222', 600, 600, 0, 'paid', 'cash', 'confirmed', 'walkin', `${todayIso} 08:00:00`]);

  await dbQuery.run(`
    INSERT INTO booking_items (id, booking_id, room_id, price, quantity, subtotal, start_time, end_time, layout, booking_type, checkin_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [2001, 201, 4, 300, 2, 600, `${todayIso}T10:00:00`, `${todayIso}T12:00:00`, 'standard', 'hourly', 'confirmed']);

  // Booking 202: Multi-Room Booking (Room 5 Mercury & Room 6 Saturn, 10:00 - 12:00)
  await dbQuery.run(`
    INSERT INTO bookings (id, customer_name, contact, total_amount, paid_amount, balance_amount, payment_status, payment_method, checkin_status, customer_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [202, 'บริษัท ทริปเปิ้ลเอ็กซ์ จำกัด', '082-999-8888', 900, 900, 0, 'paid', 'promptpay', 'confirmed', 'walkin', `${todayIso} 08:15:00`]);

  await dbQuery.run(`
    INSERT INTO booking_items (id, booking_id, room_id, price, quantity, subtotal, start_time, end_time, layout, booking_type, checkin_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [2002, 202, 5, 250, 2, 500, `${todayIso}T10:00:00`, `${todayIso}T12:00:00`, 'standard', 'hourly', 'confirmed']);

  await dbQuery.run(`
    INSERT INTO booking_items (id, booking_id, room_id, price, quantity, subtotal, start_time, end_time, layout, booking_type, checkin_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [2003, 202, 6, 200, 2, 400, `${todayIso}T10:00:00`, `${todayIso}T12:00:00`, 'standard', 'hourly', 'confirmed']);

  console.log('[Seed] Database seeded with 3 rooms and 2 test bookings.');
}

// Generate valid test image files
const TEST_DIR = path.resolve(__dirname, '../tests_temp');
if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

// Valid PNG sample (1x1 red pixel PNG)
const VALID_PNG_PATH = path.join(TEST_DIR, 'test_payment_slip.png');
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
fs.writeFileSync(VALID_PNG_PATH, Buffer.from(PNG_BASE64, 'base64'));

// Dummy HEIC sample (magic bytes ftypheic)
const INVALID_HEIC_PATH = path.join(TEST_DIR, 'test_invoice_slip.heic');
const HEIC_BUFFER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00]);
fs.writeFileSync(INVALID_HEIC_PATH, HEIC_BUFFER);

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
              await this.send('Network.enable');
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

  async navigate(url, waitMs = 2000) {
    await this.send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, waitMs));
  }

  async setViewport(width, height, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: isMobile
    });
    await new Promise(r => setTimeout(r, 300));
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
    console.log(`[Screenshot] Saved: ${baseName} (${buffer.length} bytes)`);
    return p1;
  }

  async setFileInputFiles(selector, filePaths) {
    const { root } = await this.send('DOM.getDocument');
    const { nodeId } = await this.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: selector
    });
    if (!nodeId) throw new Error(`Element not found for selector: ${selector}`);
    await this.send('DOM.setFileInputFiles', {
      nodeId: nodeId,
      files: filePaths
    });
    await new Promise(r => setTimeout(r, 400));
  }
}

async function runTest() {
  console.log('===============================================================');
  console.log('Starting Room Extension Mobile UI & Payment Verification UAT');
  console.log('===============================================================');

  await seedTestDatabase();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log(`[Server] Live test server listening on http://127.0.0.1:${TEST_PORT}`);

  const chromeProfileDir = path.resolve(__dirname, '../.chrome-test-profile-rx');
  if (!fs.existsSync(chromeProfileDir)) fs.mkdirSync(chromeProfileDir, { recursive: true });

  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--window-size=1440,900',
    `--user-data-dir=${chromeProfileDir}`,
    'about:blank'
  ]);

  let cdp;
  const results = {
    checks: [],
    screenshots: []
  };

  const addCheck = (name, pass, detail = '') => {
    results.checks.push({ name, pass, detail });
    console.log(`[CHECK] ${pass ? '✔ PASS' : '❌ FAIL'}: ${name} ${detail ? '(' + detail + ')' : ''}`);
    if (!pass) throw new Error(`Assertion failed: ${name} - ${detail}`);
  };

  try {
    cdp = new CDPClient(CDP_PORT);
    await cdp.connect();
    console.log('[CDP] Connected to Headless Chrome via WebSocket\n');

    const adminToken = createToken({
      id: 1,
      username: 'admin',
      role: 'admin',
      permissions: 'pos,dashboard,pending,layout,history,quotations,hour-credits,customers,tickets,manage,admin-users,admin-system,admin-promotion,admin-quotation,admin-backup,admin-dooraccess,admin-general'
    });
    const adminUser = {
      id: 1,
      username: 'admin',
      role: 'admin',
      permissions: 'pos,dashboard,pending,layout,history,quotations,hour-credits,customers,tickets,manage,admin-users,admin-system,admin-promotion,admin-quotation,admin-backup,admin-dooraccess,admin-general'
    };

    // 1. Initial Desktop Load (1440x900)
    await cdp.setViewport(1440, 900, false);
    await cdp.navigate(`http://127.0.0.1:${TEST_PORT}/`);

    // Set auth tokens in localStorage
    await cdp.evaluate(`
      ((token, user) => {
        localStorage.setItem('pos_token', token);
        localStorage.setItem('token', token);
        localStorage.setItem('pos_user', JSON.stringify(user));
      })('${adminToken}', ${JSON.stringify(adminUser)})
    `);

    // Reload page with authenticated state
    await cdp.navigate(`http://127.0.0.1:${TEST_PORT}/`, 2500);

    // Navigate to Booking Management tab
    console.log('[Test] Navigating to Booking Management...');
    await cdp.evaluate(`
      (() => {
        const topMenuItems = Array.from(document.querySelectorAll('.top-menu-item, .menu-card, button'));
        const bookingMgmtBtn = topMenuItems.find(el => el.textContent.includes('Booking Management') || el.textContent.includes('จัดการการจอง'));
        if (bookingMgmtBtn) bookingMgmtBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 2000));

    // Open detail modal for Booking 201
    console.log('[Test] Opening detail modal for Single-Room Booking #201...');
    await cdp.evaluate(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const targetRow = rows.find(r => r.textContent.includes('201') || r.textContent.includes('คุณธนากร'));
        if (targetRow) {
          const btn = targetRow.querySelector('.pb-primary-action-btn, .pb-btn-view, button');
          if (btn) btn.click();
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));

    // Click extend room button
    console.log('[Test] Clicking extend room button...');
    await cdp.evaluate(`
      (() => {
        const extBtn = document.getElementById('pb-detail-btn-extend-room');
        if (extBtn) extBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));

    // Check modal visibility
    const isModalOpen = await cdp.evaluate(`Boolean(document.querySelector('.rx-modal-card'))`);
    addCheck('Modal is opened and visible', isModalOpen);

    // Capture Desktop Screenshot 1: Main Extension View
    await cdp.captureScreenshot('uat_desktop_01_main_extension.png');

    // =========================================================================
    // 2. PAYMENT METHODS & BANK DETAILS CHECK
    // =========================================================================
    console.log('\n--- Checking Payment Methods & Payment Card Details ---');

    // Click PromptPay payment method
    await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-payment-chip'));
        const promptPayChip = chips.find(c => c.textContent.includes('พร้อมเพย์'));
        if (promptPayChip) promptPayChip.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    // Verify PromptPay Card details
    const promptPayDetails = await cdp.evaluate(`
      (() => {
        const card = document.querySelector('.rx-payment-card');
        if (!card) return null;
        const title = card.querySelector('.rx-payment-card-title')?.textContent.trim();
        const promptPayId = card.querySelector('.rx-payment-field-value.mono')?.textContent.trim();
        const qrImg = card.querySelector('.rx-promptpay-qr-img')?.getAttribute('src');
        const amount = card.querySelector('.rx-payment-amount-value')?.textContent.trim();
        return { title, promptPayId, qrImg, amount };
      })()
    `);
    console.log('  PromptPay Card Info:', promptPayDetails);
    addCheck('PromptPay Card Title present', Boolean(promptPayDetails && promptPayDetails.title.includes('พร้อมเพย์')));
    addCheck('PromptPay ID matches system', promptPayDetails?.promptPayId === '0125554000401');
    addCheck('PromptPay QR image loaded', promptPayDetails?.qrImg === '/bwork_payment_qr.png');
    addCheck('Payable amount displayed correctly', promptPayDetails?.amount === '฿300');

    // Test Copy PromptPay ID button
    await cdp.evaluate(`
      (() => {
        const copyBtn = document.querySelector('.rx-btn-copy');
        if (copyBtn) copyBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 300));

    const copyFeedbackPromptPay = await cdp.evaluate(`
      (() => {
        const copyBtn = document.querySelector('.rx-btn-copy');
        return copyBtn ? copyBtn.textContent.trim() : '';
      })()
    `);
    addCheck('Copy PromptPay feedback displayed', copyFeedbackPromptPay.includes('คัดลอกแล้ว'), `Got: ${copyFeedbackPromptPay}`);

    // Switch to Transfer payment method
    await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-payment-chip'));
        const transferChip = chips.find(c => c.textContent.includes('โอนเงิน'));
        if (transferChip) transferChip.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    // Verify Transfer Card details
    const transferDetails = await cdp.evaluate(`
      (() => {
        const card = document.querySelector('.rx-payment-card');
        if (!card) return null;
        const title = card.querySelector('.rx-payment-card-title')?.textContent.trim();
        const accountNo = card.querySelector('.rx-payment-field-value.mono')?.textContent.trim();
        const bankName = card.querySelector('.rx-payment-card-sub')?.textContent.trim();
        const amount = card.querySelector('.rx-payment-amount-value')?.textContent.trim();
        return { title, accountNo, bankName, amount };
      })()
    `);
    console.log('  Transfer Card Info:', transferDetails);
    addCheck('Transfer Card Title present', Boolean(transferDetails && transferDetails.title.includes('โอนเงิน')));
    addCheck('Bank Account No matches system', transferDetails?.accountNo === '329-1-38429-0');
    addCheck('Bank Name displayed', transferDetails?.bankName.includes('กรุงศรี') || transferDetails?.bankName.includes('Krungsri'));

    // Test Copy Bank Account button
    await cdp.evaluate(`
      (() => {
        const copyBtn = document.querySelector('.rx-btn-copy');
        if (copyBtn) copyBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 300));

    const copyFeedbackAccount = await cdp.evaluate(`
      (() => {
        const copyBtn = document.querySelector('.rx-btn-copy');
        return copyBtn ? copyBtn.textContent.trim() : '';
      })()
    `);
    addCheck('Copy Account feedback displayed', copyFeedbackAccount.includes('คัดลอกเลขบัญชีแล้ว'), `Got: ${copyFeedbackAccount}`);

    // Capture Desktop Screenshot with Transfer Card
    const s1 = await cdp.captureScreenshot('uat_rx_desktop_transfer.png');
    await cdp.captureScreenshot('uat_desktop_02_transfer_selected.png');
    results.screenshots.push(s1);

    // =========================================================================
    // 3. FILE VALIDATION: HEIC REJECTION CHECK
    // =========================================================================
    console.log('\n--- Checking Slip Upload: HEIC/HEIF Explicit Rejection ---');

    await cdp.setFileInputFiles('input[type="file"]', [INVALID_HEIC_PATH]);
    await new Promise(r => setTimeout(r, 600));

    const heicErrorResult = await cdp.evaluate(`
      (() => {
        const errBanner = document.querySelector('.rx-slip-error-banner');
        const isAttached = Boolean(document.querySelector('.rx-slip-attached-card'));
        return {
          errorText: errBanner ? errBanner.textContent.trim() : null,
          isAttached
        };
      })()
    `);
    console.log('  HEIC Rejection Info:', heicErrorResult);
    addCheck('HEIC file is rejected with explicit Thai alert',
      Boolean(heicErrorResult.errorText && heicErrorResult.errorText.includes('HEIC/HEIF') && heicErrorResult.errorText.includes('JPG หรือ PNG')),
      `Got: ${heicErrorResult.errorText}`
    );
    addCheck('No slip is attached on HEIC rejection', !heicErrorResult.isAttached);

    // =========================================================================
    // 4. VALID SLIP UPLOAD & PREVIEW DETAILS
    // =========================================================================
    console.log('\n--- Checking Slip Upload: Valid PNG Attachment ---');

    await cdp.setFileInputFiles('input[type="file"]', [VALID_PNG_PATH]);
    await new Promise(r => setTimeout(r, 800));

    const slipAttachedInfo = await cdp.evaluate(`
      (() => {
        const card = document.querySelector('.rx-slip-attached-card');
        if (!card) return null;
        const name = card.querySelector('.rx-slip-attached-name')?.textContent.trim();
        const size = card.querySelector('.rx-slip-attached-size')?.textContent.trim();
        const badge = card.querySelector('.rx-slip-badge-success')?.textContent.trim();
        const thumbSrc = card.querySelector('.rx-slip-thumbnail-img')?.getAttribute('src');
        const viewBtn = Boolean(card.querySelector('.rx-btn-slip-action.view'));
        const changeBtn = Boolean(card.querySelector('.rx-btn-slip-action.change'));
        const removeBtn = Boolean(card.querySelector('.rx-btn-slip-action.remove'));
        return { name, size, badge, thumbSrc, viewBtn, changeBtn, removeBtn };
      })()
    `);
    console.log('  Slip Attached Info:', slipAttachedInfo);
    addCheck('Slip file attached card visible', Boolean(slipAttachedInfo));
    addCheck('Slip file name matches', slipAttachedInfo?.name === 'test_payment_slip.png');
    addCheck('Slip file size formatted', Boolean(slipAttachedInfo?.size));
    addCheck('Slip badge success displayed', slipAttachedInfo?.badge.includes('แนบสลิปแล้ว'));
    addCheck('Slip thumbnail blob URL loaded', Boolean(slipAttachedInfo?.thumbSrc && slipAttachedInfo?.thumbSrc.startsWith('blob:')));
    addCheck('View, Change, and Remove buttons present', slipAttachedInfo?.viewBtn && slipAttachedInfo?.changeBtn && slipAttachedInfo?.removeBtn);

    // Capture Desktop Screenshot with Slip Attached
    const s2 = await cdp.captureScreenshot('uat_rx_desktop_slip_attached.png');
    await cdp.captureScreenshot('uat_desktop_03_slip_attached.png');
    results.screenshots.push(s2);

    // =========================================================================
    // 5. LIGHTBOX MODAL PREVIEW
    // =========================================================================
    console.log('\n--- Checking Lightbox Modal Preview ---');

    // Click on thumbnail to open Lightbox
    await cdp.evaluate(`
      (() => {
        const thumbBox = document.querySelector('.rx-slip-thumbnail-box');
        if (thumbBox) thumbBox.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    const lightboxInfo = await cdp.evaluate(`
      (() => {
        const overlay = document.querySelector('.rx-lightbox-overlay');
        if (!overlay) return null;
        const filename = overlay.querySelector('.rx-lightbox-filename')?.textContent.trim();
        const imgSrc = overlay.querySelector('.rx-lightbox-image')?.getAttribute('src');
        const closeBtn = Boolean(overlay.querySelector('.rx-lightbox-close-btn'));
        return { isOpen: true, filename, imgSrc, closeBtn };
      })()
    `);
    console.log('  Lightbox Info:', lightboxInfo);
    addCheck('Lightbox overlay opened', Boolean(lightboxInfo?.isOpen));
    addCheck('Lightbox displays slip filename', lightboxInfo?.filename === 'test_payment_slip.png');
    addCheck('Lightbox displays slip image', Boolean(lightboxInfo?.imgSrc && lightboxInfo?.imgSrc.startsWith('blob:')));

    // Capture Desktop Lightbox Screenshot
    const s3 = await cdp.captureScreenshot('uat_rx_desktop_lightbox.png');
    await cdp.captureScreenshot('uat_desktop_04_lightbox.png');
    results.screenshots.push(s3);

    // Close Lightbox via close button
    await cdp.evaluate(`
      (() => {
        const closeBtn = document.querySelector('.rx-lightbox-close-btn');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 400));

    const isLightboxClosed = await cdp.evaluate(`!document.querySelector('.rx-lightbox-overlay')`);
    addCheck('Lightbox closed cleanly', isLightboxClosed);

    // =========================================================================
    // 6. SLIP RETENTION ACROSS DURATION PRESETS & RECALCULATIONS
    // =========================================================================
    console.log('\n--- Checking Slip Retention on Duration Change (+2 Hours) ---');

    // Click "+2 ชั่วโมง" preset chip
    await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-duration-chip'));
        const chip2h = chips.find(c => c.textContent.includes('+2 ชั่วโมง'));
        if (chip2h) chip2h.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1500)); // wait for preview recalculation

    const slipRetainedAfterDurationChange = await cdp.evaluate(`
      (() => {
        const card = document.querySelector('.rx-slip-attached-card');
        const amount = document.querySelector('.rx-summary-fee-amount')?.textContent.trim();
        const durationChipActive = document.querySelector('.rx-duration-chip.active')?.textContent.trim();
        return {
          isSlipStillAttached: Boolean(card),
          slipName: card?.querySelector('.rx-slip-attached-name')?.textContent.trim(),
          amount,
          durationChipActive
        };
      })()
    `);
    console.log('  Slip Retention Info:', slipRetainedAfterDurationChange);
    addCheck('Fee recalculated to 2 hours (฿600)', slipRetainedAfterDurationChange?.amount === '฿600');
    addCheck('Slip file remains attached after duration change (NOT reset)',
      slipRetainedAfterDurationChange?.isSlipStillAttached && slipRetainedAfterDurationChange?.slipName === 'test_payment_slip.png'
    );

    // Test Slip Removal
    await cdp.evaluate(`
      (() => {
        const removeBtn = document.querySelector('.rx-btn-slip-action.remove');
        if (removeBtn) removeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 400));

    const slipRemovedCheck = await cdp.evaluate(`
      (() => {
        const card = document.querySelector('.rx-slip-attached-card');
        const dropzone = document.querySelector('.rx-slip-dropzone-prominent');
        return { cardExists: Boolean(card), dropzoneExists: Boolean(dropzone) };
      })()
    `);
    addCheck('Slip successfully removed by user', !slipRemovedCheck.cardExists && slipRemovedCheck.dropzoneExists);

    // Re-attach slip for mobile testing
    await cdp.setFileInputFiles('input[type="file"]', [VALID_PNG_PATH]);
    await new Promise(r => setTimeout(r, 600));

    // =========================================================================
    // 7. MOBILE VIEWPORT 360px (GALAXY S8 / ANDROID 360x740)
    // =========================================================================
    console.log('\n--- Checking Mobile Viewport 360px (Android 360x740) ---');

    await cdp.setViewport(360, 740, true);
    await new Promise(r => setTimeout(r, 600));

    // Switch payment to PromptPay to show QR on mobile
    await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-payment-chip'));
        const ppChip = chips.find(c => c.textContent.includes('พร้อมเพย์'));
        if (ppChip) ppChip.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    const mobile360Metrics = await cdp.evaluate(`
      (() => {
        const modal = document.querySelector('.rx-modal-card');
        const buttons = Array.from(modal.querySelectorAll('button'));
        const inputs = Array.from(modal.querySelectorAll('input'));

        const minButtonHeight = Math.min(...buttons.map(b => b.offsetHeight).filter(h => h > 0));
        const bodyScrollable = modal.querySelector('.rx-modal-body').scrollHeight >= modal.querySelector('.rx-modal-body').clientHeight;
        const noHorizontalOverflow = modal.scrollWidth <= window.innerWidth;

        return {
          modalHeight: modal.offsetHeight,
          windowHeight: window.innerHeight,
          minButtonHeight,
          bodyScrollable,
          noHorizontalOverflow
        };
      })()
    `);
    console.log('  Mobile 360 Metrics:', mobile360Metrics);
    addCheck('Mobile 360 fills full viewport (100dvh)', mobile360Metrics?.modalHeight === 740);
    addCheck('Buttons meet touch target min-height >= 44px', mobile360Metrics?.minButtonHeight >= 44, 'Min button height: ' + mobile360Metrics?.minButtonHeight + 'px');
    addCheck('No horizontal overflow on 360px', mobile360Metrics?.noHorizontalOverflow);

    const s4 = await cdp.captureScreenshot('uat_rx_mobile_360_promptpay.png');
    results.screenshots.push(s4);

    // =========================================================================
    // 8. MOBILE VIEWPORT 390px (IPHONE 12/13/14 PORTRAIT 390x844)
    // =========================================================================
    console.log('\n--- Checking Mobile Viewport 390px (iPhone 390x844) ---');

    await cdp.setViewport(390, 844, true);
    await new Promise(r => setTimeout(r, 600));

    // Toggle custom minutes to test input font-size
    await cdp.evaluate(`
      (() => {
        const link = document.querySelector('.rx-btn-link');
        if (link && link.textContent.includes('กำหนดนาทีเอง')) link.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 400));

    // Verify input font-size >= 16px to prevent iOS auto-zoom
    const mobile390Metrics = await cdp.evaluate(`
      (() => {
        const input = document.querySelector('.rx-custom-minutes-input');
        const computedFontSize = input ? parseFloat(window.getComputedStyle(input).fontSize) : 0;
        const inputMode = input ? input.getAttribute('inputmode') : null;

        return {
          computedFontSize,
          inputMode,
          attachedCardVisible: Boolean(document.querySelector('.rx-slip-attached-card'))
        };
      })()
    `);
    console.log('  Mobile 390 Metrics:', mobile390Metrics);
    addCheck('Custom minutes input has font-size >= 16px (iOS zoom prevention)', mobile390Metrics?.computedFontSize >= 16, 'Font size: ' + mobile390Metrics?.computedFontSize + 'px');
    addCheck('Custom minutes input has inputmode="numeric"', mobile390Metrics?.inputMode === 'numeric');
    addCheck('Attached slip card visible on 390px', mobile390Metrics?.attachedCardVisible);

    // Toggle back to standard presets
    await cdp.evaluate(`
      (() => {
        const link = document.querySelector('.rx-btn-link');
        if (link && link.textContent.includes('เลือกเวลามาตรฐาน')) link.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 400));

    const s5 = await cdp.captureScreenshot('uat_rx_mobile_390_slip_attached.png');
    await cdp.captureScreenshot('uat_mobile_03_slip_attached.png');
    results.screenshots.push(s5);

    // Mobile Lightbox Screenshot
    await cdp.evaluate(`
      (() => {
        const thumbBox = document.querySelector('.rx-slip-thumbnail-box');
        if (thumbBox) thumbBox.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 400));
    await cdp.captureScreenshot('uat_mobile_04_lightbox.png');

    // Close Lightbox
    await cdp.evaluate(`
      (() => {
        const closeBtn = document.querySelector('.rx-lightbox-close-btn');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 400));

    // Mobile Transfer Selected Screenshot
    await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-payment-chip'));
        const transferChip = chips.find(c => c.textContent.includes('โอนเงิน'));
        if (transferChip) transferChip.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 400));
    await cdp.captureScreenshot('uat_mobile_02_transfer_selected.png');

    // Mobile Main Extension View (Cash / Default) Screenshot
    await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-payment-chip'));
        const cashChip = chips.find(c => c.textContent.includes('เงินสด'));
        if (cashChip) cashChip.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 400));
    await cdp.captureScreenshot('uat_mobile_01_main_extension.png');

    // =========================================================================
    // 9. MOBILE VIEWPORT 430px (IPHONE 14/15 PRO MAX PORTRAIT & LANDSCAPE)
    // =========================================================================
    console.log('\n--- Checking Mobile Viewport 430px (iPhone Pro Max Portrait & Landscape) ---');

    // Portrait 430x932
    await cdp.setViewport(430, 932, true);
    await new Promise(r => setTimeout(r, 500));
    const s6 = await cdp.captureScreenshot('uat_rx_mobile_430_portrait.png');
    results.screenshots.push(s6);

    // Landscape 932x430
    console.log('  Switching to Landscape 932x430...');
    await cdp.setViewport(932, 430, true);
    await new Promise(r => setTimeout(r, 600));

    const landscapeMetrics = await cdp.evaluate(`
      (() => {
        const modal = document.querySelector('.rx-modal-card');
        const body = modal.querySelector('.rx-modal-body');
        return {
          modalHeight: modal.offsetHeight,
          windowHeight: window.innerHeight,
          bodyScrollable: body.scrollHeight > body.clientHeight,
          noHorizontalOverflow: modal.scrollWidth <= window.innerWidth
        };
      })()
    `);
    console.log('  Landscape 932x430 Metrics:', landscapeMetrics);
    addCheck('Landscape modal fits viewport height (430px)', landscapeMetrics?.modalHeight === 430);
    addCheck('Landscape body scrolls cleanly', landscapeMetrics?.bodyScrollable);
    addCheck('Landscape has no horizontal overflow', landscapeMetrics?.noHorizontalOverflow);

    const s7 = await cdp.captureScreenshot('uat_rx_mobile_430_landscape.png');
    results.screenshots.push(s7);

    // =========================================================================
    // 10. MULTI-ROOM BOOKING CHECK & SLIP ISOLATION
    // =========================================================================
    console.log('\n--- Checking Multi-Room Booking (#202) & Slip Isolation ---');

    // Restore desktop viewport
    await cdp.setViewport(1440, 900, false);
    await new Promise(r => setTimeout(r, 400));

    // Close Room Extension Modal
    await cdp.evaluate(`
      (() => {
        const closeBtn = document.querySelector('.rx-modal-close-btn');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    // Close detail modal for 201
    await cdp.evaluate(`
      (() => {
        const closeBtn = document.querySelector('.pb-detail-btn-close') ||
                         Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('ปิด'));
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    // Open detail modal for Multi-Room Booking 202
    await cdp.evaluate(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const targetRow = rows.find(r => r.textContent.includes('202') || r.textContent.includes('ทริปเปิ้ลเอ็กซ์'));
        if (targetRow) {
          const btn = targetRow.querySelector('.pb-primary-action-btn, .pb-btn-view, button');
          if (btn) btn.click();
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    // Click extend room button for Booking 202
    await cdp.evaluate(`
      (() => {
        const extBtn = document.getElementById('pb-detail-btn-extend-room');
        if (extBtn) extBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));

    // Invariant check: In multi-room booking, NO room is auto-selected!
    const multiRoomInitialState = await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-room-chips-grid .rx-duration-chip'));
        const activeChip = chips.find(c => c.classList.contains('active'));
        const promptMsg = Array.from(document.querySelectorAll('div')).find(d => d.textContent.includes('การจองนี้มีหลายห้อง กรุณาคลิกเลือกห้อง'));
        const primaryBtn = document.querySelector('.rx-btn-primary');
        return {
          roomCount: chips.length,
          hasActiveRoom: Boolean(activeChip),
          promptMsgVisible: Boolean(promptMsg),
          primaryBtnDisabled: primaryBtn ? primaryBtn.disabled : true
        };
      })()
    `);
    console.log('  Multi-Room Initial State:', multiRoomInitialState);
    addCheck('Multi-room modal shows 2 room choices', multiRoomInitialState?.roomCount === 2);
    addCheck('Multi-room modal does NOT auto-select first room', !multiRoomInitialState?.hasActiveRoom);
    addCheck('Submit button is disabled when no room is selected', multiRoomInitialState?.primaryBtnDisabled);

    // Select Room 5 (Mercury)
    await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-room-chips-grid .rx-duration-chip'));
        const roomMercury = chips.find(c => c.textContent.includes('Mercury'));
        if (roomMercury) roomMercury.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    // Select PromptPay so slip upload area is active
    await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-payment-chip'));
        const pp = chips.find(c => c.textContent.includes('พร้อมเพย์'));
        if (pp) pp.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    // Attach slip to Room Mercury
    await cdp.setFileInputFiles('input[type="file"]', [VALID_PNG_PATH]);
    await new Promise(r => setTimeout(r, 600));

    const slipAttachedRoomMercury = await cdp.evaluate(`
      Boolean(document.querySelector('.rx-slip-attached-card'))
    `);
    addCheck('Slip attached to Room Mercury', slipAttachedRoomMercury);

    // Switch to Room 6 (Saturn) -> Invariant: slip must be reset for safety
    await cdp.evaluate(`
      (() => {
        const chips = Array.from(document.querySelectorAll('.rx-room-chips-grid .rx-duration-chip'));
        const roomSaturn = chips.find(c => c.textContent.includes('Saturn'));
        if (roomSaturn) roomSaturn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    const slipIsolationCheck = await cdp.evaluate(`
      (() => {
        const card = document.querySelector('.rx-slip-attached-card');
        const activeChip = document.querySelector('.rx-room-chips-grid .rx-duration-chip.active')?.textContent.trim();
        return {
          isSlipStillAttached: Boolean(card),
          activeRoom: activeChip
        };
      })()
    `);
    console.log('  Slip Isolation on Room Switch Info:', slipIsolationCheck);
    addCheck('Active room is now Saturn', slipIsolationCheck?.activeRoom.includes('Saturn'));
    addCheck('Slip is reset when switching rooms in multi-room booking (NO slip leakage)', !slipIsolationCheck?.isSlipStillAttached);

    const s8 = await cdp.captureScreenshot('uat_rx_multiroom_isolation.png');
    results.screenshots.push(s8);

    console.log('\n===============================================================');
    console.log(`ALL CHECKS PASSED: ${results.checks.filter(c => c.pass).length}/${results.checks.length}`);
    console.log(`Screenshots Captured: ${results.screenshots.length}`);
    console.log('===============================================================');

    // Save test results report JSON
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'uat_room_extension_mobile_results.json'),
      JSON.stringify(results, null, 2)
    );

  } catch (err) {
    console.error('\n❌ UAT Test Run Failed:', err);
    throw err;
  } finally {
    if (cdp && cdp.ws) cdp.ws.close();
    chromeProcess.kill();
    server.close();
  }
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
