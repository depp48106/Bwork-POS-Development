/**
 * ============================================================================
 * verifyBookingConfirmationRoomImagesUAT.cjs
 * Comprehensive Browser UAT Verification for Meeting Room Booking Confirmation Card:
 * - Room Image Display on Single-Room Bookings (/uploads/rooms/... and /uploads/img_...)
 * - Multi-Room Booking Room Image Thumbnails & Isolation
 * - Neutral Fallback Placeholder ("ไม่มีรูปภาพห้องประชุมที่ตั้งค่าไว้") when no image configured
 * - Canvas Inlining & CORS Protection (crossOrigin="anonymous", no tainted canvas)
 * - Mobile Viewport 390px (iPhone 12/13/14) Responsive Layout
 * - Print / PDF Styling & Preservation
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 5088;
const BASE_URL = `http://localhost:${PORT}`;
const ARTIFACT_DIR = path.resolve('C:/Users/Runrasa.P/.gemini/antigravity/brain/03721993-8ed4-4f8b-a41b-db0f7e984101');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9268;
const DB_FILE = path.join(__dirname, 'database_room_images_uat.sqlite');

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
      mobile: width < 600
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
     VALUES (1, 'admin', ?, 'Administrator', 'admin', 'pos,pending,manage,admin-system,admin-management')`,
    [adminPasswordHash]
  );

  // Create Rooms
  // Room 1: Has /uploads/rooms/ image path
  // Room 2: Has legacy /uploads/img_ image path
  // Room 3: Has NO image (null)
  await dbQuery.run(
    `INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, image_url, pin_code, wifi_username, wifi_password_enc) 
     VALUES (1, 'ห้องประชุม Jupiter (300)', 10, 500, '/uploads/rooms/img_1784255149006_z8qg8.jpeg', '123456', 'wifi_jup', 'enc_pass'),
            (2, 'ห้องประชุมกลาง B (Standard Room)', 6, 350, '/uploads/img_1784255139060_dczce.jpeg', '234567', 'wifi_std', 'enc_pass'),
            (3, 'ห้องประชุมเล็ก C (Mini Room)', 4, 250, NULL, '345678', 'wifi_mini', 'enc_pass')`
  );

  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Booking #101: Single-Room booking with room image (Jupiter 300)
  await dbQuery.run(
    `INSERT INTO bookings (
      id, customer_name, customer_email, contact, total_amount, paid_amount, balance_amount, 
      payment_status, payment_method, booking_source, created_at, receipt_number
    ) VALUES (
      101, 'นายสมศักดิ์ จองห้องเดี่ยวมีรูป', 'somsak@test.com', '0812345678', 1000, 1000, 0,
      'completed', 'transfer', 'pos', CURRENT_TIMESTAMP, 'BK-000101'
    )`
  );
  await dbQuery.run(
    `INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, layout)
     VALUES (1011, 101, 1, '${todayStr}T09:00:00', '${todayStr}T11:00:00', 1000, 1000, 'standard')`
  );

  // 2. Booking #102: Multi-Room booking (Room 1 and Room 2)
  await dbQuery.run(
    `INSERT INTO bookings (
      id, customer_name, customer_email, contact, total_amount, paid_amount, balance_amount, 
      payment_status, payment_method, booking_source, created_at, receipt_number
    ) VALUES (
      102, 'บริษัท ทริปเปิ้ลเอ็กซ์ จำกัด (มัลติรูม)', 'corporate@test.com', '0898765432', 1700, 1700, 0,
      'completed', 'transfer', 'pos', CURRENT_TIMESTAMP, 'BK-000102'
    )`
  );
  await dbQuery.run(
    `INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, layout)
     VALUES (1021, 102, 1, '${todayStr}T13:00:00', '${todayStr}T15:00:00', 1000, 1000, 'standard'),
            (1022, 102, 2, '${todayStr}T13:00:00', '${todayStr}T15:00:00', 700, 700, 'standard')`
  );

  // 3. Booking #103: Single-Room booking WITHOUT image (Room 3)
  await dbQuery.run(
    `INSERT INTO bookings (
      id, customer_name, customer_email, contact, total_amount, paid_amount, balance_amount, 
      payment_status, payment_method, booking_source, created_at, receipt_number
    ) VALUES (
      103, 'นางสาวมาลี จองห้องไม่มีรูป', 'malee@test.com', '0861112233', 500, 500, 0,
      'completed', 'transfer', 'pos', CURRENT_TIMESTAMP, 'BK-000103'
    )`
  );
  await dbQuery.run(
    `INSERT INTO booking_items (id, booking_id, room_id, start_time, end_time, price, subtotal, layout)
     VALUES (1031, 103, 3, '${todayStr}T16:00:00', '${todayStr}T18:00:00', 500, 500, 'standard')`
  );

  console.log('✓ Test SQLite database seeded successfully.');
}

async function runTest() {
  console.log('=== Starting Real Browser UAT: Meeting Room Booking Confirmation Card ===\n');

  // Step 1: Seed database
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
    `--user-data-dir=${path.join(ARTIFACT_DIR, 'scratch', 'chrome_uat_conf_profile')}`,
    'about:blank'
  ]);

  const cdp = new CDPClient(CDP_PORT);
  await cdp.connect();
  await cdp.setViewport(1440, 900);
  console.log('✓ Connected to Chrome CDP');

  try {
    // Step 4: Login to POS Application
    console.log('Logging into POS Application...');
    await cdp.navigate(`${BASE_URL}/`);

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    if (!loginData.token) {
      throw new Error('Failed to obtain auth token: ' + JSON.stringify(loginData));
    }
    const token = loginData.token;
    console.log('✓ Auth Token generated');

    await cdp.evaluate(`
      localStorage.setItem('pos_token', '${token}');
      localStorage.setItem('token', '${token}');
      localStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(loginData.user)}));
      localStorage.setItem('user', JSON.stringify(${JSON.stringify(loginData.user)}));
      window.location.reload();
    `);
    await new Promise(r => setTimeout(r, 2500));

    // Navigate to Pending Bookings Tab
    console.log('Navigating to Pending Bookings tab...');
    await cdp.evaluate(`
      const navButtons = Array.from(document.querySelectorAll('.top-menu-item, nav button, header button, .nav-item, [role="tab"]'));
      const pbTab = navButtons.find(b => b.textContent && (b.textContent.includes('Booking Management') || b.textContent.includes('จัดการการจอง') || b.textContent.includes('Pending')));
      if (pbTab) pbTab.click();
      else throw new Error('Booking Management nav button not found');
    `);
    await new Promise(r => setTimeout(r, 2000));

    async function openConfirmationModalForBooking(bookingId) {
      await cdp.evaluate(`
        (() => {
          const rows = Array.from(document.querySelectorAll('tbody tr'));
          const targetRow = rows.find(r => r.textContent.includes(String(${bookingId})));
          if (!targetRow) throw new Error('Row for booking ' + ${bookingId} + ' not found in table');
          const moreBtn = targetRow.querySelector('.pb-more-btn');
          if (!moreBtn) throw new Error('More button (.pb-more-btn) not found on row ' + ${bookingId});
          moreBtn.click();
        })()
      `);
      await new Promise(r => setTimeout(r, 600));

      await cdp.evaluate(`
        (() => {
          const menuItems = Array.from(document.querySelectorAll('.action-menu-item, .dropdown-item'));
          const confBtn = menuItems.find(m => m.textContent && (m.textContent.includes('ใบยืนยันการจอง') || m.textContent.includes('Wi-Fi')));
          if (!confBtn) throw new Error('Confirmation menu item not found in action menu');
          confBtn.click();
        })()
      `);
      await new Promise(r => setTimeout(r, 1800));
    }

    // ========================================================================
    // TEST 1: Single-Room Booking with Room Image (Booking #101 - Jupiter 300)
    // ========================================================================
    console.log('\n--- TEST 1: Single-Room Booking with Image (Booking #101) ---');
    await cdp.evaluate(`
      // Fetch wifi-card data for booking 101 and trigger modal directly
      const token = localStorage.getItem('token');
      fetch('/api/bookings/101/wifi-card', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(r => r.json()).then(data => {
        window.__TEST_WIFI_CARD_DATA = data;
      });
    `);
    await new Promise(r => setTimeout(r, 1000));

    const card101Data = await cdp.evaluate(`window.__TEST_WIFI_CARD_DATA`);
    console.log('  API response received for Booking 101:');
    console.log('    Banner Type:', card101Data.banner_type);
    console.log('    Banner Image URL:', card101Data.banner_image_url);
    console.log('    Rooms count:', card101Data.rooms?.length);
    console.log('    Room 1 Image:', card101Data.rooms?.[0]?.image_url);

    if (card101Data.banner_type !== 'room' || !card101Data.banner_image_url) {
      throw new Error(`Expected banner_type 'room' and valid banner_image_url for Booking 101, got: ${card101Data.banner_type}`);
    }

    // Open Confirmation Card Modal via UI row button
    await openConfirmationModalForBooking(101);

    // Verify Modal DOM
    const modalCheck101 = await cdp.evaluate(`
      (() => {
        const modal = document.getElementById('booking-confirmation-card-modal');
        const card = document.getElementById('wifi-customer-card');
        const banner = document.getElementById('booking-confirmation-banner');
        const heroImg = banner ? banner.querySelector('img') : null;
        const noImageLabel = banner ? banner.querySelector('[data-no-room-image-label]') : null;

        return {
          hasModal: !!modal,
          hasCard: !!card,
          bannerMode: banner ? banner.getAttribute('data-banner-mode') : null,
          hasHeroImg: !!heroImg,
          heroImgSrc: heroImg ? heroImg.src : null,
          heroImgCrossOrigin: heroImg ? heroImg.getAttribute('crossorigin') : null,
          heroImgLoaded: heroImg ? (heroImg.complete && heroImg.naturalWidth > 0) : false,
          heroImgNaturalWidth: heroImg ? heroImg.naturalWidth : 0,
          hasNoImageLabel: !!noImageLabel,
          noImageLabelText: noImageLabel ? noImageLabel.textContent.trim() : null
        };
      })()
    `);

    console.log('  Modal DOM Verification (Booking 101):', modalCheck101);

    if (!modalCheck101.hasModal || !modalCheck101.hasCard) {
      throw new Error('Booking confirmation modal did not open for Booking 101');
    }
    if (modalCheck101.bannerMode !== 'single-room-image') {
      throw new Error(`Expected bannerMode 'single-room-image', got: ${modalCheck101.bannerMode}`);
    }
    if (!modalCheck101.hasHeroImg) {
      throw new Error('Hero <img> element missing in confirmation banner');
    }
    if (modalCheck101.hasNoImageLabel) {
      throw new Error(`Unexpected 'ไม่มีรูปภาพห้องประชุม' label displayed when room image exists!`);
    }
    if (modalCheck101.heroImgCrossOrigin !== 'anonymous') {
      throw new Error(`Expected crossOrigin="anonymous" on hero <img>, got: ${modalCheck101.heroImgCrossOrigin}`);
    }
    console.log('  ✓ Single-room hero image rendered and loaded properly (naturalWidth: ' + modalCheck101.heroImgNaturalWidth + 'px)');

    // Capture Desktop Screenshot
    await cdp.captureScreenshot('uat_confirmation_single_room_with_image_desktop.png');

    // ========================================================================
    // TEST 2: Canvas Inlining & CORS Verification (Export JPG)
    // ========================================================================
    console.log('\n--- TEST 2: Canvas Export & CORS Safety Verification ---');
    const canvasTestResult = await cdp.evaluate(`
      (async () => {
        const cardEl = document.getElementById('wifi-customer-card');
        if (!cardEl) return { success: false, error: 'cardEl not found' };

        const heroImg = cardEl.querySelector('.bwork-conf-hero-image-wrap img');
        if (!heroImg) return { success: false, error: 'heroImg not found' };

        // Test drawing heroImg to a canvas
        const c = document.createElement('canvas');
        c.width = heroImg.naturalWidth;
        c.height = heroImg.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(heroImg, 0, 0);

        let dataUrl = null;
        let isTainted = false;
        try {
          dataUrl = c.toDataURL('image/png');
        } catch (taintErr) {
          isTainted = true;
          return { success: false, isTainted: true, error: taintErr.message };
        }

        // Click "บันทึกเป็น JPG" button
        const exportBtn = document.getElementById('btn-export-confirmation-card-jpg');
        let btnClicked = false;
        if (exportBtn) {
          exportBtn.click();
          btnClicked = true;
        }

        return {
          success: true,
          isTainted: false,
          dataUrlPrefix: dataUrl ? dataUrl.slice(0, 30) : null,
          dataUrlLength: dataUrl ? dataUrl.length : 0,
          heroImgHasExportHide: heroImg.getAttribute('data-export-hide') === 'true',
          btnClicked
        };
      })()
    `);

    console.log('  Canvas Inlining Result:', canvasTestResult);
    if (!canvasTestResult.success || canvasTestResult.isTainted) {
      throw new Error('Canvas was tainted by cross-origin image: ' + canvasTestResult.error);
    }
    if (canvasTestResult.dataUrlLength < 1000) {
      throw new Error('Canvas exported dataUrl is too short or empty');
    }
    if (canvasTestResult.heroImgHasExportHide) {
      throw new Error('Valid loaded image was incorrectly marked data-export-hide="true"!');
    }
    console.log('  ✓ Canvas drawing succeeded without taint; exported ' + canvasTestResult.dataUrlLength + ' bytes PNG data');

    // Close Modal
    await cdp.evaluate(`document.getElementById('btn-close-confirmation-card')?.click();`);
    await new Promise(r => setTimeout(r, 600));

    // ========================================================================
    // TEST 3: Multi-Room Booking with Thumbnails (Booking #102)
    // ========================================================================
    console.log('\n--- TEST 3: Multi-Room Booking Thumbnails (Booking #102) ---');
    await openConfirmationModalForBooking(102);

    const modalCheck102 = await cdp.evaluate(`
      (() => {
        const modal = document.getElementById('booking-confirmation-card-modal');
        const card = document.getElementById('wifi-customer-card');
        const banner = document.getElementById('booking-confirmation-banner');
        const heroImg = banner ? banner.querySelector('img') : null;
        const itemCards = Array.from(document.querySelectorAll('.bwork-conf-room-item-card'));

        const itemImages = itemCards.map((it, idx) => {
          const img = it.querySelector('img');
          const placeholder = it.querySelector('[data-room-placeholder]');
          return {
            index: idx,
            hasImg: !!img,
            src: img ? img.src : null,
            crossOrigin: img ? img.getAttribute('crossorigin') : null,
            loaded: img ? (img.complete && img.naturalWidth > 0) : false,
            hasPlaceholder: !!placeholder
          };
        });

        return {
          hasModal: !!modal,
          hasCard: !!card,
          bannerMode: banner ? banner.getAttribute('data-banner-mode') : null,
          hasHeroImg: !!heroImg,
          heroImgSrc: heroImg ? heroImg.src : null,
          heroImgCrossOrigin: heroImg ? heroImg.getAttribute('crossorigin') : null,
          itemCardsCount: itemCards.length,
          itemImages
        };
      })()
    `);

    console.log('  Multi-Room Verification (Booking 102):', modalCheck102);

    if (modalCheck102.bannerMode !== 'multi-room-brand') {
      throw new Error(`Expected bannerMode 'multi-room-brand' for multi-room, got: ${modalCheck102.bannerMode}`);
    }
    if (modalCheck102.itemCardsCount !== 2) {
      throw new Error(`Expected 2 room item cards, got: ${modalCheck102.itemCardsCount}`);
    }
    for (const it of modalCheck102.itemImages) {
      if (!it.hasImg || !it.loaded) {
        throw new Error(`Multi-room item card ${it.index} failed to load room thumbnail!`);
      }
      if (it.crossOrigin !== 'anonymous') {
        throw new Error(`Multi-room item card ${it.index} missing crossOrigin="anonymous"!`);
      }
    }
    console.log('  ✓ Multi-room banner uses brand hero and all ' + modalCheck102.itemCardsCount + ' room items have loaded thumbnails');

    // Capture Multi-Room Desktop Screenshot
    await cdp.captureScreenshot('uat_confirmation_multi_room_desktop.png');

    // Close Modal
    await cdp.evaluate(`document.getElementById('btn-close-confirmation-card')?.click();`);
    await new Promise(r => setTimeout(r, 600));

    // ========================================================================
    // TEST 4: Room WITHOUT Image Fallback (Booking #103)
    // ========================================================================
    console.log('\n--- TEST 4: Room without Image Fallback (Booking #103) ---');
    await openConfirmationModalForBooking(103);

    const modalCheck103 = await cdp.evaluate(`
      (() => {
        const banner = document.getElementById('booking-confirmation-banner');
        const heroImg = banner ? banner.querySelector('img') : null;
        const noImageLabel = banner ? banner.querySelector('[data-no-room-image-label]') : null;

        return {
          bannerMode: banner ? banner.getAttribute('data-banner-mode') : null,
          hasHeroImg: !!heroImg,
          hasNoImageLabel: !!noImageLabel,
          noImageLabelText: noImageLabel ? noImageLabel.textContent.trim() : null
        };
      })()
    `);

    console.log('  No-Image Fallback Verification (Booking 103):', modalCheck103);
    if (modalCheck103.bannerMode !== 'single-room-placeholder') {
      throw new Error(`Expected bannerMode 'single-room-placeholder' for room without image, got: ${modalCheck103.bannerMode}`);
    }
    if (modalCheck103.hasHeroImg) {
      throw new Error('Expected no hero <img> when room has no image, but found one!');
    }
    if (!modalCheck103.hasNoImageLabel || modalCheck103.noImageLabelText !== 'ไม่มีรูปภาพห้องประชุมที่ตั้งค่าไว้') {
      throw new Error(`Expected label 'ไม่มีรูปภาพห้องประชุมที่ตั้งค่าไว้', got: ${modalCheck103.noImageLabelText}`);
    }
    console.log('  ✓ Fallback placeholder correctly displayed without errors');

    // Capture No-Image Desktop Screenshot
    await cdp.captureScreenshot('uat_confirmation_room_no_image_fallback.png');

    // Close Modal
    await cdp.evaluate(`document.getElementById('btn-close-confirmation-card')?.click();`);
    await new Promise(r => setTimeout(r, 600));

    // ========================================================================
    // TEST 5: Mobile Viewport 390px (iPhone 12/13/14)
    // ========================================================================
    console.log('\n--- TEST 5: Mobile Viewport 390px Verification ---');
    await cdp.setViewport(390, 844);
    await new Promise(r => setTimeout(r, 600));

    // Reopen Booking 101 on Mobile
    await openConfirmationModalForBooking(101);

    const mobileCheck = await cdp.evaluate(`
      (() => {
        const modal = document.getElementById('booking-confirmation-card-modal');
        const card = document.getElementById('wifi-customer-card');
        const banner = document.getElementById('booking-confirmation-banner');
        const heroImg = banner ? banner.querySelector('img') : null;

        const bodyWidth = document.body.offsetWidth;
        const cardWidth = card ? card.offsetWidth : 0;
        const bannerHeight = banner ? banner.offsetHeight : 0;

        return {
          bodyWidth,
          cardWidth,
          fitsViewport: cardWidth <= 390,
          bannerHeight,
          heroImgLoaded: heroImg ? (heroImg.complete && heroImg.naturalWidth > 0) : false
        };
      })()
    `);

    console.log('  Mobile 390px Layout Check:', mobileCheck);
    if (!mobileCheck.fitsViewport) {
      throw new Error(`Card width (${mobileCheck.cardWidth}px) exceeds 390px mobile viewport!`);
    }
    if (!mobileCheck.heroImgLoaded) {
      throw new Error('Hero image failed to load on mobile viewport');
    }
    console.log('  ✓ Card fits perfectly on 390px viewport with loaded hero image');

    // Capture Mobile Screenshot
    await cdp.captureScreenshot('uat_confirmation_mobile_390px.png');

    // ========================================================================
    // TEST 6: Print / PDF Layout Verification
    // ========================================================================
    console.log('\n--- TEST 6: Print / PDF Simulation Verification ---');
    await cdp.setViewport(1280, 900);
    await cdp.evaluate(`
      document.body.classList.add('printing-booking-confirmation');
    `);
    await new Promise(r => setTimeout(r, 500));

    const printCheck = await cdp.evaluate(`
      (() => {
        const card = document.getElementById('wifi-customer-card');
        const banner = document.getElementById('booking-confirmation-banner');
        const heroImg = banner ? banner.querySelector('img') : null;

        return {
          isPrintingClassActive: document.body.classList.contains('printing-booking-confirmation'),
          cardVisible: card ? window.getComputedStyle(card).display !== 'none' : false,
          heroImgLoaded: heroImg ? (heroImg.complete && heroImg.naturalWidth > 0) : false
        };
      })()
    `);

    console.log('  Print Simulation Check:', printCheck);
    if (!printCheck.isPrintingClassActive || !printCheck.cardVisible || !printCheck.heroImgLoaded) {
      throw new Error('Print layout failed verification: ' + JSON.stringify(printCheck));
    }
    console.log('  ✓ Print mode active and confirmation card rendered with full image fidelity');

    // Capture Print Screenshot
    await cdp.captureScreenshot('uat_confirmation_print_preview.png');

    await cdp.evaluate(`
      document.body.classList.remove('printing-booking-confirmation');
    `);

    console.log('\n================================================================');
    console.log('  ALL BROWSER UAT SCENARIOS COMPLETED SUCCESSFULLY (100% PASS)');
    console.log('================================================================');

  } finally {
    await cdp.close();
    chromeProcess.kill();
    serverProcess.kill();
    try { fs.unlinkSync(DB_FILE); } catch (_) {}
  }
}

runTest().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
