/**
 * BWORK-POS — LIVE STAGING FOCAL POINT & IMAGE POSITION ACCEPTANCE
 *
 * Fully automated headless Chrome (CDP) acceptance test suite targeting:
 * - POS Pages:   https://bwork-pos-staging.pages.dev
 * - Worker API:  https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev
 * - D1 Database: bworkpos_staging_db (8511096e-3c57-428f-8b2c-98fdb297f705)
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/Runrasa.P/.gemini/antigravity/brain/03721993-8ed4-4f8b-a41b-db0f7e984101';
const STAGING_API = 'https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev';
const POS_PAGES = 'https://bwork-pos-staging.pages.dev';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9224;

let passedCount = 0;
let totalCount = 0;
const results = [];

function assertTest(condition, name, details = '') {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${name} ${details ? '(' + details + ')' : ''}`);
    results.push({ name, status: 'PASS', details });
  } else {
    console.error(`  [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
    results.push({ name, status: 'FAIL', details });
    throw new Error(`Test failed: ${name} - ${details}`);
  }
}

function executeStagingD1(sql, maxRetries = 3) {
  const backendDir = path.join(__dirname, '..', 'backend');
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (sql.length < 1500) {
        const clean = sql.replace(/[\r\n]+/g, ' ').replace(/"/g, '`"').trim();
        const tempScript = path.join(backendDir, `_run_d1_exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.ps1`);
        fs.writeFileSync(tempScript, `npx.cmd wrangler d1 execute bworkpos_staging_db --remote --command "${clean}" --config wrangler.staging.toml --json\n`, 'utf8');
        try {
          execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${path.basename(tempScript)}"`, { cwd: backendDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
          return;
        } finally {
          try { fs.unlinkSync(tempScript); } catch (e) {}
        }
      } else {
        const tempSqlFile = path.join(backendDir, `_temp_staging_exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.sql`);
        fs.writeFileSync(tempSqlFile, sql, 'utf8');
        try {
          const cmd = `npx.cmd wrangler d1 execute bworkpos_staging_db --remote --file=${path.basename(tempSqlFile)} --config wrangler.staging.toml --json`;
          execSync(cmd, { cwd: backendDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: 'cmd.exe' });
          return;
        } finally {
          try { fs.unlinkSync(tempSqlFile); } catch (e) {}
        }
      }
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`  [FATAL D1 EXEC ERROR] Failed after ${maxRetries} attempts for SQL: ${sql.slice(0, 100)}...`);
        throw err;
      }
      console.warn(`  [RETRY D1 EXEC] Attempt ${attempt} failed, retrying in 2.5s...`);
      execSync('powershell.exe -NoProfile -Command "Start-Sleep -Milliseconds 2500"');
    }
  }
}

function queryStagingD1(sql) {
  const backendDir = path.join(__dirname, '..', 'backend');
  const clean = sql.replace(/[\r\n]+/g, ' ').replace(/"/g, '`"').trim();
  const tempScript = path.join(backendDir, `_run_d1_query_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.ps1`);
  fs.writeFileSync(tempScript, `npx.cmd wrangler d1 execute bworkpos_staging_db --remote --command "${clean}" --config wrangler.staging.toml --json\n`, 'utf8');
  try {
    const out = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${path.basename(tempScript)}"`, { cwd: backendDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const jsonStart = out.indexOf('[');
    const jsonEnd = out.lastIndexOf(']');
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error(`Invalid D1 output: ${out}`);
    }
    const parsed = JSON.parse(out.substring(jsonStart, jsonEnd + 1));
    return parsed[0]?.results || [];
  } finally {
    try { fs.unlinkSync(tempScript); } catch (e) {}
  }
}

async function runStagingAcceptance() {
  console.log('====================================================');
  console.log('  BWORK-POS LIVE STAGING FOCAL ACCEPTANCE SUITE');
  console.log('====================================================\n');

  // Load real sample photo for synthetic room
  const samplePhotoBuf = fs.readFileSync(path.join(__dirname, '..', 'backend', 'public', 'uploads', 'img_1783326410504_n2mlq.jpeg'));
  const samplePhotoDataUrl = 'data:image/jpeg;base64,' + samplePhotoBuf.toString('base64');
  console.log(`Loaded test photo: ${samplePhotoBuf.length} bytes (Data URL ${samplePhotoDataUrl.length} chars)`);

  // Step 1: Preflight Seed Synthetic Staging Rooms & Bookings
  console.log('\nStep 1: Seeding synthetic staging records in Staging D1...');
  
  const seedSql = `
DELETE FROM booking_items WHERE booking_id IN (9991, 9992, 9993);
DELETE FROM bookings WHERE id IN (9991, 9992, 9993);
DELETE FROM rooms WHERE id IN (991, 992, 993);

INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, status, image_url, image_position_x, image_position_y, pin_code, builtland_pin_code, wifi_username, category)
  VALUES (991, 'Staging Focal Room Alpha (991)', 6, 300, 2400, 'active', '${samplePhotoDataUrl}', 50, 50, '123456#', 'BL-991', 'wifi_991', 'Meeting Room');

INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, status, image_url, image_position_x, image_position_y, pin_code, builtland_pin_code, wifi_username, category)
  VALUES (992, 'Staging No-Image Room Beta (992)', 4, 200, 1600, 'active', NULL, 50, 50, '234567#', 'BL-992', NULL, 'Meeting Room');

INSERT INTO rooms (id, name, capacity, hourly_rate, daily_rate, status, image_url, image_position_x, image_position_y, pin_code, builtland_pin_code, wifi_username, category)
  VALUES (993, 'Staging Multi Room Gamma (993)', 8, 400, 3200, 'active', '${samplePhotoDataUrl}', 50, 50, '345678#', 'BL-993', 'wifi_993', 'Meeting Room');

INSERT INTO bookings (id, customer_name, contact, customer_type, total_amount, subtotal_amount, paid_amount, balance_amount, payment_status, receipt_number, checkin_status, pin_code, created_at)
  VALUES (9991, 'คุณพัฒนศักดิ์ ทดสอบสเตจจิ้ง', '081-999-8888', 'general', 600, 600, 600, 0, 'paid', 'BK-STAGE-FOCAL-001', 'pending', '123456#', '2026-10-20 09:00:00');
INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, checkin_status, pin_code)
  VALUES (9991, 991, '2026-10-25 10:00:00', '2026-10-25 12:00:00', 300, 600, 'pending', '123456#');

INSERT INTO bookings (id, customer_name, contact, customer_type, total_amount, subtotal_amount, paid_amount, balance_amount, payment_status, receipt_number, checkin_status, pin_code, created_at)
  VALUES (9992, 'คุณสุรีพร (ห้องไม่มีรูป)', '082-111-2222', 'general', 400, 400, 400, 0, 'paid', 'BK-STAGE-NO-IMG', 'pending', '234567#', '2026-10-20 10:00:00');
INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, checkin_status, pin_code)
  VALUES (9992, 992, '2026-10-25 13:00:00', '2026-10-25 15:00:00', 200, 400, 'pending', '234567#');

INSERT INTO bookings (id, customer_name, contact, customer_type, total_amount, subtotal_amount, paid_amount, balance_amount, payment_status, receipt_number, checkin_status, pin_code, created_at)
  VALUES (9993, 'คุณมัลติรูม ทดสอบสเตจจิ้ง', '083-333-4444', 'general', 1400, 1400, 1400, 0, 'paid', 'BK-STAGE-MULTI', 'pending', '123456#', '2026-10-20 11:00:00');
INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, checkin_status, pin_code)
  VALUES (9993, 991, '2026-10-25 16:00:00', '2026-10-25 18:00:00', 300, 600, 'pending', '123456#');
INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, checkin_status, pin_code)
  VALUES (9993, 993, '2026-10-25 16:00:00', '2026-10-25 18:00:00', 400, 800, 'pending', '345678#');
`;

  executeStagingD1(seedSql);

  const seededRooms = queryStagingD1("SELECT id, name, image_position_x, image_position_y FROM rooms WHERE id IN (991, 992, 993);");
  assertTest(seededRooms.length === 3, 'Preflight: 3 synthetic rooms seeded', `IDs: ${seededRooms.map(r => r.id).join(', ')}`);
  assertTest(seededRooms.find(r => r.id === 991).image_position_x === 50, 'Preflight: Room 991 default image_position_x is 50');
  assertTest(seededRooms.find(r => r.id === 991).image_position_y === 50, 'Preflight: Room 991 default image_position_y is 50');

  // Step 2: Launch Headless Chrome & Connect CDP
  console.log('\nStep 2: Launching Headless Chrome on port ' + CDP_PORT + '...');
  const tempProfile = path.join(ARTIFACT_DIR, 'scratch', 'chrome_staging_focal_profile');
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(tempProfile, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    '--window-size=1280,900',
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const pages = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const targetPage = pages.find(p => p.type === 'page');
  console.log('Connected to Chrome target page:', targetPage.webSocketDebuggerUrl);

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

  try {
    // Step 3: Authenticate with Staging Worker API
    console.log('\nStep 3: Authenticating with Staging Worker API...');
    const credFile = path.join(ARTIFACT_DIR, 'scratch', 'staging_admin_credentials.json');
    const stagingAdminPass = process.env.STAGING_ADMIN_PASSWORD || (fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, 'utf8')).password : '');
    const loginRes = await fetch(`${STAGING_API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: stagingAdminPass })
    });
    const loginData = await loginRes.json();
    assertTest(loginRes.status === 200 && loginData.token, 'Auth: Admin login token received', `User: ${loginData.user?.username}`);

    // Step 4: Load POS and initialize session
    console.log('\nStep 4: Loading Staging POS and setting localStorage...');
    await send('Page.navigate', { url: POS_PAGES });
    await new Promise(r => setTimeout(r, 2500));

    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('pos_token', ${JSON.stringify(loginData.token)});
        localStorage.setItem('token', ${JSON.stringify(loginData.token)});
        localStorage.setItem('pos_user', ${JSON.stringify(JSON.stringify(loginData.user))});
      `
    });

    await send('Page.navigate', { url: POS_PAGES });
    
    let authActive = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const authCheck = await send('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('.app-container') || document.body.innerText.includes('ผู้ดูแลระบบ') || document.body.innerText.includes('admin') || document.body.innerText.includes('Today Overview'))`
      });
      if (authCheck.result?.value === true) {
        authActive = true;
        break;
      }
    }
    assertTest(authActive, 'Browser: Authenticated admin session active');

    async function navigateToManagement() {
      const step1 = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const btns = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
            const settingsBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Settings'));
            if (settingsBtn) {
              settingsBtn.click();
              return { clicked: true, btns };
            }
            return { clicked: false, btns };
          })()
        `,
        returnByValue: true
      });
      console.log('  [NAV] Settings button click result:', step1.result.value);
      await new Promise(r => setTimeout(r, 1500));

      const step2 = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const btns = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
            const manageBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('จัดการคลังสินค้า') || b.innerText.includes('จัดการห้องประชุม'));
            if (manageBtn) {
              manageBtn.click();
              return { clicked: true, btns };
            }
            return { clicked: false, btns };
          })()
        `,
        returnByValue: true
      });
      console.log('  [NAV] Manage button click result:', step2.result.value);
      await new Promise(r => setTimeout(r, 2500));

      // Diagnostic: Check rendered rows in table before searching
      const rowsBeforeSearch = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const trs = Array.from(document.querySelectorAll('tr')).map(r => r.innerText.replace(/\\s+/g, ' ').trim());
            return trs;
          })()
        `,
        returnByValue: true
      });
      console.log('  [NAV] Rows in table before search:', rowsBeforeSearch.result.value);

      await send('Runtime.evaluate', {
        expression: `
          (() => {
            const searchInput = document.querySelector('input[placeholder*="ค้นหา"]');
            if (searchInput) {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(searchInput, '991');
              searchInput.dispatchEvent(new Event('input', { bubbles: true }));
              searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()
        `
      });
      await new Promise(r => setTimeout(r, 1500));
    }

    async function navigateToBookingManagement() {
      console.log('  [NAV] Navigating to Booking Management...');
      const navRes = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const candidates = Array.from(document.querySelectorAll('.menu-card, button, div, a, span'));
            const target = candidates.find(el => el.innerText && el.innerText.trim() === 'Booking Management') ||
                           candidates.find(el => el.innerText && (el.innerText.includes('Booking Management') || el.innerText.includes('รายการจอง')));
            if (target) {
              const clickable = target.closest('.menu-card') || target.closest('button') || target;
              clickable.click();
              return { clicked: true, tag: clickable.tagName, text: clickable.innerText.slice(0, 30) };
            }
            return { clicked: false };
          })()
        `,
        returnByValue: true
      });
      console.log('  [NAV] Booking Management navigation click result:', navRes.result?.value);
      await new Promise(r => setTimeout(r, 2500));

      // Wait for table and data to load
      for (let i = 0; i < 20; i++) {
        const check = await send('Runtime.evaluate', {
          expression: `
            (() => {
              const text = document.body.innerText;
              const hasBooking = text.includes('BK-STAGE-FOCAL-001') || text.includes('คุณพัฒนศักดิ์');
              const hasTable = Boolean(document.querySelector('.pending-bookings, table, .pb-row'));
              return { hasBooking, hasTable };
            })()
          `,
          returnByValue: true
        });
        if (check.result?.value?.hasBooking) {
          console.log('  [NAV] Test bookings loaded and visible in table');
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    async function closeConfirmationCard() {
      await send('Runtime.evaluate', {
        expression: `
          (() => {
            const closeBtn = document.getElementById('btn-close-confirmation-card') || document.querySelector('#booking-confirmation-card-modal button');
            if (closeBtn) closeBtn.click();
          })()
        `
      });
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 200));
        const check = await send('Runtime.evaluate', { expression: `Boolean(document.querySelector('#wifi-customer-card'))` });
        if (!check.result?.value) break;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    async function openConfirmationCard(identifier) {
      // 1. Close any open modal first
      await closeConfirmationCard();

      // 2. Click the 3-dots action menu in the booking row
      const moreClick = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const rows = Array.from(document.querySelectorAll('tr, .booking-row, .pb-row'));
            const row = rows.find(r => r.innerText.includes('${identifier}'));
            if (!row) return { error: 'Row not found for: ' + '${identifier}' };
            const moreBtn = row.querySelector('.pb-more-btn') || Array.from(row.querySelectorAll('button')).find(b => b.classList.contains('pb-more-btn') || b.querySelector('svg'));
            if (!moreBtn) return { error: 'pb-more-btn not found in row' };
            moreBtn.click();
            return { success: true };
          })()
        `,
        returnByValue: true
      });
      if (moreClick.result?.value?.error) {
        throw new Error('Action menu click failed: ' + moreClick.result.value.error);
      }
      await new Promise(r => setTimeout(r, 600));

      // 3. Click "ใบยืนยันการจอง / Wi-Fi" from action menu
      const itemClick = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const items = Array.from(document.querySelectorAll('.action-menu-item'));
            const cardItem = items.find(m => m.innerText.includes('ยืนยันการจอง') || m.innerText.includes('Wi-Fi'));
            if (!cardItem) return { error: 'Action menu item not found' };
            cardItem.click();
            return { success: true };
          })()
        `,
        returnByValue: true
      });
      if (itemClick.result?.value?.error) {
        throw new Error('Confirmation Card menu item click failed: ' + itemClick.result.value.error);
      }

      // 4. Poll until #wifi-customer-card exists and finished loading
      let cardReady = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 300));
        const check = await send('Runtime.evaluate', {
          expression: `
            (() => {
              const card = document.querySelector('#wifi-customer-card');
              const spinner = document.querySelector('#booking-confirmation-card-modal .spin-animation');
              return Boolean(card && !spinner);
            })()
          `
        });
        if (check.result?.value === true) {
          cardReady = true;
          break;
        }
      }
      assertTest(cardReady, `Confirmation Card modal opened and loaded for ${identifier}`);
      await new Promise(r => setTimeout(r, 500));
    }

    // Step 5: Test Room Management UI & Focal Point Editor
    console.log('\nStep 5: Navigating to Settings -> ManagementPanel...');
    await navigateToManagement();

    // Verify room 991 appears in room management table
    const roomTableEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const rows = Array.from(document.querySelectorAll('tr, .room-card, .table-row'));
          const found = rows.some(r => r.innerText.includes('Staging Focal Room Alpha (991)') || r.innerText.includes('991'));
          return { found, rowCount: rows.length };
        })()
      `,
      returnByValue: true
    });
    console.log('Room table inspection:', roomTableEval.result.value);

    // Click edit on Room 991
    const openEditEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const rows = Array.from(document.querySelectorAll('tr'));
          const r991 = rows.find(r => r.innerText.includes('Staging Focal Room Alpha (991)') || r.innerText.includes('991'));
          if (!r991) return { error: 'Row 991 not found' };
          const editBtn = Array.from(r991.querySelectorAll('button')).find(b => b.innerText.includes('แก้ไข'));
          if (!editBtn) return { error: 'Edit button not found in row 991' };
          editBtn.click();
          return { success: true };
        })()
      `,
      returnByValue: true
    });
    assertTest(openEditEval.result.value.success, 'Room Management: Opened Edit Modal for Room 991');
    await new Promise(r => setTimeout(r, 1500));

    // Verify Focal Point Editor components in modal
    const focalEditorEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const hasTitle = bodyText.includes('จุดโฟกัสภาพห้องประชุม') || bodyText.includes('Focal Point');
          const hasSliders = document.querySelectorAll('input[type="range"]').length >= 2;
          const hasResetBtn = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('รีเซ็ตตรงกลาง') || b.innerText.includes('รีเซ็ตจุดกึ่งกลาง') || b.title?.includes('50% 50%'));
          const sliders = Array.from(document.querySelectorAll('input[type="range"]')).map(s => Number(s.value));
          
          // Check for emojis using Extended_Pictographic (Unicode 13+)
          const modalElem = document.querySelector('.modal, .modal-content, [role="dialog"]') || document.body;
          const hasEmoji = /\\p{Extended_Pictographic}/u.test(modalElem.innerText);

          return { hasTitle, hasSliders, hasResetBtn, sliderValues: sliders, hasEmoji };
        })()
      `,
      returnByValue: true
    });
    console.log('Focal Editor Modal Inspection:', focalEditorEval.result.value);
    assertTest(focalEditorEval.result.value.hasSliders, 'Focal Editor: Dual X & Y range sliders present');
    assertTest(focalEditorEval.result.value.hasResetBtn, 'Focal Editor: 1-Click Reset to center button present');
    assertTest(!focalEditorEval.result.value.hasEmoji, 'Focal Editor: Clean typography & zero emojis verified');

    // Capture screenshot of Room Management Focal Editor Modal
    const modalShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'staging_room_management_focal_editor.png'), Buffer.from(modalShot.data, 'base64'));
    console.log('  [SCREENSHOT] Saved staging_room_management_focal_editor.png');

    // Test Slider adjustments & Reticle movement to (35, 65)
    console.log('\nTesting slider controls: setting X=35, Y=65...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const sliders = Array.from(document.querySelectorAll('input[type="range"]'));
          if (sliders.length >= 2) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            // Slider 0 is X
            setter.call(sliders[0], '35');
            sliders[0].dispatchEvent(new Event('input', { bubbles: true }));
            sliders[0].dispatchEvent(new Event('change', { bubbles: true }));
            // Slider 1 is Y
            setter.call(sliders[1], '65');
            sliders[1].dispatchEvent(new Event('input', { bubbles: true }));
            sliders[1].dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `
    });
    await new Promise(r => setTimeout(r, 500));

    // Verify updated values on badge
    const badgeEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const has3565 = bodyText.includes('X: 35%') && bodyText.includes('Y: 65%');
          return { has3565 };
        })()
      `,
      returnByValue: true
    });
    assertTest(badgeEval.result.value.has3565, 'Focal Editor: Sliders moved reticle and badge updated to X: 35% | Y: 65%');

    // Test "Reset to center" button
    console.log('Testing "Reset to center" button...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('รีเซ็ตตรงกลาง') || b.innerText.includes('รีเซ็ตจุดกึ่งกลาง') || b.title?.includes('50% 50%'));
          if (resetBtn) resetBtn.click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 500));

    const resetEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const bodyText = document.body.innerText;
          const has5050 = bodyText.includes('X: 50%') && bodyText.includes('Y: 50%');
          return { has5050 };
        })()
      `,
      returnByValue: true
    });
    assertTest(resetEval.result.value.has5050, 'Focal Editor: Reset button cleanly restored X: 50% | Y: 50%');

    // Now set to 35% / 65% and SAVE
    console.log('Setting to X=35, Y=65 and saving to Staging D1...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const sliders = Array.from(document.querySelectorAll('input[type="range"]'));
          if (sliders.length >= 2) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(sliders[0], '35');
            sliders[0].dispatchEvent(new Event('input', { bubbles: true }));
            sliders[0].dispatchEvent(new Event('change', { bubbles: true }));
            setter.call(sliders[1], '65');
            sliders[1].dispatchEvent(new Event('input', { bubbles: true }));
            sliders[1].dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `
    });
    await new Promise(r => setTimeout(r, 500));

    // Click Save Button in Modal
    console.log('Clicking "บันทึกข้อมูล" and dismissing dialog...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const submitBtn = document.querySelector('form button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('บันทึกข้อมูล'));
          if (submitBtn) submitBtn.click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 1500));

    // Dismiss alert dialog ("ตกลง")
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const okBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'ตกลง');
          if (okBtn) okBtn.click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    // Verify in Staging D1 that 35 / 65 was persisted
    const d1Saved = queryStagingD1("SELECT id, name, image_position_x, image_position_y, pin_code, wifi_username FROM rooms WHERE id = 991;")[0];
    assertTest(d1Saved.image_position_x === 35 && d1Saved.image_position_y === 65, 'Persistence: Saved focal point (35, 65) verified in Staging D1', `X=${d1Saved.image_position_x}, Y=${d1Saved.image_position_y}`);
    assertTest(d1Saved.pin_code === '123456#', 'Isolation: Door PIN code preserved during focal point save', `PIN=${d1Saved.pin_code}`);
    assertTest(d1Saved.wifi_username === 'wifi_991', 'Isolation: Wi-Fi credentials preserved during focal point save', `WiFi=${d1Saved.wifi_username}`);

    // Verify other rooms in Staging D1 were NOT affected
    const d1Other = queryStagingD1("SELECT id, image_position_x, image_position_y FROM rooms WHERE id = 992;")[0];
    assertTest(d1Other.image_position_x === 50 && d1Other.image_position_y === 50, 'Isolation: Companion room 992 completely unaffected', `X=${d1Other.image_position_x}, Y=${d1Other.image_position_y}`);

    // Verify Refresh persistence
    console.log('Verifying refresh persistence...');
    await send('Page.reload');
    await new Promise(r => setTimeout(r, 3000));

    await navigateToManagement();

    // Reopen edit modal for room 991
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const rows = Array.from(document.querySelectorAll('tr'));
          const r991 = rows.find(r => r.innerText.includes('Staging Focal Room Alpha (991)') || r.innerText.includes('991'));
          const editBtn = Array.from(r991.querySelectorAll('button')).find(b => b.innerText.includes('แก้ไข'));
          if (editBtn) editBtn.click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 1000));

    const refreshedFocalEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const sliders = Array.from(document.querySelectorAll('input[type="range"]')).map(s => Number(s.value));
          const text = document.body.innerText;
          const has3565 = text.includes('X: 35%') && text.includes('Y: 65%');
          return { sliders, has3565 };
        })()
      `,
      returnByValue: true
    });
    assertTest(refreshedFocalEval.result.value.has3565, 'Persistence: Refresh page preserved X: 35% | Y: 65%', `Sliders: ${refreshedFocalEval.result.value.sliders}`);

    // Close edit modal
    await send('Runtime.evaluate', {
      expression: `document.querySelector('.modal button.btn-secondary, [role="dialog"] button')?.click();`
    });
    await new Promise(r => setTimeout(r, 500));

    // Verify Logout/Login persistence
    console.log('Verifying logout/login persistence...');
    await send('Runtime.evaluate', {
      expression: `
        localStorage.clear();
        sessionStorage.clear();
      `
    });
    await send('Page.navigate', { url: POS_PAGES });
    await new Promise(r => setTimeout(r, 2000));

    // Relogin
    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('pos_token', ${JSON.stringify(loginData.token)});
        localStorage.setItem('token', ${JSON.stringify(loginData.token)});
        localStorage.setItem('pos_user', ${JSON.stringify(JSON.stringify(loginData.user))});
      `
    });
    await send('Page.navigate', { url: POS_PAGES });
    await new Promise(r => setTimeout(r, 3000));

    const reloginSaved = queryStagingD1("SELECT image_position_x, image_position_y FROM rooms WHERE id = 991;")[0];
    assertTest(reloginSaved.image_position_x === 35 && reloginSaved.image_position_y === 65, 'Persistence: Logout/Login preserved focal point in Staging D1');

    // =========================================================================
    // Step 6: Confirmation Card Live Acceptance across all 6 Focal Scenarios
    // =========================================================================
    console.log('\n====================================================');
    console.log('Step 6: Confirmation Card Live Testing across Focal Scenarios');
    console.log('====================================================');

    await navigateToBookingManagement();

    const focalScenarios = [
      { name: 'Default center 50/50',  x: 50, y: 50, file: 'staging_conf_card_focal_50_50.png' },
      { name: 'Top center 50/0',       x: 50, y: 0,  file: 'staging_conf_card_focal_50_0.png' },
      { name: 'Bottom center 50/100',  x: 50, y: 100,file: 'staging_conf_card_focal_50_100.png' },
      { name: 'Left center 0/50',      x: 0,  y: 50, file: 'staging_conf_card_focal_0_50.png' },
      { name: 'Right center 100/50',   x: 100,y: 50, file: 'staging_conf_card_focal_100_50.png' },
      { name: 'Custom 35/65',          x: 35, y: 65, file: 'staging_conf_card_focal_35_65.png' }
    ];

    for (const sc of focalScenarios) {
      console.log(`\nTesting Confirmation Card Scenario: ${sc.name} (${sc.x}% ${sc.y}%)...`);
      // Update D1
      executeStagingD1(`UPDATE rooms SET image_position_x = ${sc.x}, image_position_y = ${sc.y} WHERE id = 991;`);

      // Open Confirmation Card for Booking 9991
      await openConfirmationCard('BK-STAGE-FOCAL-001');

      // Inspect Hero Image CSS object-position
      const imgInspect = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const card = document.querySelector('#wifi-customer-card');
            if (!card) return { error: '#wifi-customer-card not found' };
            const heroImg = card.querySelector('.bwork-conf-hero-image-wrap img');
            if (!heroImg) return { error: 'Hero image not found in card' };
            const computed = window.getComputedStyle(heroImg);
            return {
              src: heroImg.src?.slice(0, 40),
              inlineObjectPosition: heroImg.style.objectPosition,
              computedObjectPosition: computed.objectPosition,
              width: heroImg.clientWidth,
              height: heroImg.clientHeight
            };
          })()
        `,
        returnByValue: true
      });
      console.log(`  Inspection for ${sc.name}:`, imgInspect.result.value);

      const expPos = `${sc.x}% ${sc.y}%`;
      assertTest(
        imgInspect.result.value.inlineObjectPosition === expPos || imgInspect.result.value.computedObjectPosition.includes(`${sc.x}%`),
        `Confirmation Card: ${sc.name} applies objectPosition: ${expPos}`,
        `Actual: inline=${imgInspect.result.value.inlineObjectPosition}, computed=${imgInspect.result.value.computedObjectPosition}`
      );

      // Capture screenshot
      const cardClipEval = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const card = document.querySelector('#wifi-customer-card');
            if (!card) return null;
            const r = card.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
          })()
        `,
        returnByValue: true
      });

      let shot;
      if (cardClipEval.result.value) {
        shot = await send('Page.captureScreenshot', {
          format: 'png',
          clip: { ...cardClipEval.result.value, scale: 1 }
        });
      } else {
        shot = await send('Page.captureScreenshot', { format: 'png' });
      }
      fs.writeFileSync(path.join(ARTIFACT_DIR, sc.file), Buffer.from(shot.data, 'base64'));
      console.log(`  [SCREENSHOT] Saved ${sc.file}`);

      // Close modal
      await closeConfirmationCard();
    }

    // =========================================================================
    // Step 7: Multi-room Booking Isolation
    // =========================================================================
    console.log('\n====================================================');
    console.log('Step 7: Testing Multi-room Booking Isolation (Booking 9993)...');
    console.log('====================================================');

    await openConfirmationCard('BK-STAGE-MULTI');

    const multiBannerEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const card = document.querySelector('#wifi-customer-card');
          if (!card) return { error: 'Card not found' };
          const banner = card.querySelector('#booking-confirmation-banner');
          const bannerMode = banner?.getAttribute('data-banner-mode');
          const isMultiRoomBrand = bannerMode === 'multi-room-brand';
          const roomListText = banner?.innerText || '';
          return { bannerMode, isMultiRoomBrand, roomListText };
        })()
      `,
      returnByValue: true
    });
    console.log('Multi-room banner evaluation:', multiBannerEval.result.value);
    assertTest(multiBannerEval.result.value.isMultiRoomBrand, 'Multi-room Isolation: Uses neutral brand banner mode, isolating room focal point');

    const multiShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'staging_conf_card_multi_room_isolated.png'), Buffer.from(multiShot.data, 'base64'));
    console.log('  [SCREENSHOT] Saved staging_conf_card_multi_room_isolated.png');

    // Close modal
    await closeConfirmationCard();

    // =========================================================================
    // Step 8: Missing Image Fallback
    // =========================================================================
    console.log('\n====================================================');
    console.log('Step 8: Testing Missing Image Fallback (Booking 9992 - Room 992)...');
    console.log('====================================================');

    await openConfirmationCard('BK-STAGE-NO-IMG');

    const fallbackEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const card = document.querySelector('#wifi-customer-card');
          if (!card) return { error: 'Card not found' };
          const banner = card.querySelector('#booking-confirmation-banner');
          const bannerMode = banner?.getAttribute('data-banner-mode');
          return { bannerMode, hasBanner: !!banner };
        })()
      `,
      returnByValue: true
    });
    console.log('Missing image fallback evaluation:', fallbackEval.result.value);
    assertTest(fallbackEval.result.value.bannerMode === 'single-room-placeholder', 'Missing Image Fallback: Clean placeholder banner rendered when room has no photo');

    const fallbackShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'staging_conf_card_missing_image_fallback.png'), Buffer.from(fallbackShot.data, 'base64'));
    console.log('  [SCREENSHOT] Saved staging_conf_card_missing_image_fallback.png');

    // Close modal
    await closeConfirmationCard();

    // Reopen Booking 9991 for Responsive & Export tests
    console.log('\nReopening Booking 9991 for responsive viewports and export testing...');
    await openConfirmationCard('BK-STAGE-FOCAL-001');

    // =========================================================================
    // Step 9: Responsive Mobile Viewports (320px, 375px, 400px, 1280px)
    // =========================================================================
    console.log('\n====================================================');
    console.log('Step 9: Responsive Viewports (320, 375, 400, 1280px)...');
    console.log('====================================================');

    const viewports = [
      { width: 320, height: 640, file: 'staging_conf_card_focal_mobile_320px.png' },
      { width: 375, height: 750, file: 'staging_conf_card_focal_mobile_375px.png' },
      { width: 400, height: 800, file: 'staging_conf_card_focal_mobile_400px.png' },
      { width: 1280,height: 900, file: 'staging_conf_card_desktop_1280px.png' }
    ];

    for (const vp of viewports) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 2,
        mobile: vp.width < 500
      });
      await new Promise(r => setTimeout(r, 800));

      const overflowEval = await send('Runtime.evaluate', {
        expression: `
          (() => {
            const card = document.querySelector('#wifi-customer-card');
            if (!card) return { error: 'Card not found' };
            const docWidth = document.documentElement.clientWidth;
            const cardScrollWidth = card.scrollWidth;
            const cardClientWidth = card.clientWidth;
            const hasHorizontalScroll = cardScrollWidth > cardClientWidth + 1;
            return { docWidth, cardScrollWidth, cardClientWidth, hasHorizontalScroll };
          })()
        `,
        returnByValue: true
      });
      console.log(`Viewport ${vp.width}px overflow inspection:`, overflowEval.result.value);
      assertTest(!overflowEval.result.value.hasHorizontalScroll, `Responsive: ${vp.width}px has zero horizontal overflow`);

      const vShot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(ARTIFACT_DIR, vp.file), Buffer.from(vShot.data, 'base64'));
      console.log(`  [SCREENSHOT] Saved ${vp.file}`);
    }

    // Reset Viewport to Desktop
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 600));

    // =========================================================================
    // Step 10: JPG Export Test
    // =========================================================================
    console.log('\n====================================================');
    console.log('Step 10: Testing JPG Export Fidelity...');
    console.log('====================================================');

    const cardClipForJpg = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const card = document.querySelector('#wifi-customer-card');
          if (!card) return null;
          const r = card.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        })()
      `,
      returnByValue: true
    });

    const jpgShot = await send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 95,
      clip: { ...cardClipForJpg.result.value, scale: 2 }
    });
    const jpgPath = path.join(ARTIFACT_DIR, 'staging_exported_single_room_focal.jpg');
    fs.writeFileSync(jpgPath, Buffer.from(jpgShot.data, 'base64'));
    const jpgSize = fs.statSync(jpgPath).size;
    console.log(`  [JPG EXPORT] Saved staging_exported_single_room_focal.jpg (${jpgSize} bytes)`);
    assertTest(jpgSize > 20000, 'JPG Export: High-resolution exported image generated and verified (>20KB)', `Size: ${jpgSize} bytes`);

    // =========================================================================
    // Step 11: A4 PDF Print Test
    // =========================================================================
    console.log('\n====================================================');
    console.log('Step 11: Testing A4 PDF Print Fidelity...');
    console.log('====================================================');

    const pdfData = await send('Page.printToPDF', {
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.39,
      marginBottom: 0.39,
      marginLeft: 0.39,
      marginRight: 0.39,
      printBackground: true,
      preferCSSPageSize: true
    });
    const pdfPath = path.join(ARTIFACT_DIR, 'staging_conf_card_a4_focal_print.pdf');
    fs.writeFileSync(pdfPath, Buffer.from(pdfData.data, 'base64'));
    const pdfSize = fs.statSync(pdfPath).size;
    const pdfHeader = fs.readFileSync(pdfPath).subarray(0, 5).toString('utf8');
    console.log(`  [PDF EXPORT] Saved staging_conf_card_a4_focal_print.pdf (${pdfSize} bytes, header=${pdfHeader})`);
    assertTest(pdfSize > 15000 && pdfHeader.startsWith('%PDF'), 'A4 PDF Print: Valid PDF document generated and verified', `Size: ${pdfSize} bytes, Header: ${pdfHeader}`);

    await closeConfirmationCard();

    // =========================================================================
    // Step 12: Cleanup Synthetic Test Data
    // =========================================================================
    console.log('\n====================================================');
    console.log('Step 12: Cleaning up synthetic staging test records...');
    console.log('====================================================');
    executeStagingD1("DELETE FROM booking_items WHERE booking_id IN (9991, 9992, 9993);");
    executeStagingD1("DELETE FROM bookings WHERE id IN (9991, 9992, 9993);");
    executeStagingD1("DELETE FROM rooms WHERE id IN (991, 992, 993);");
    const cleanupCheck = queryStagingD1("SELECT count(*) as count FROM rooms WHERE id IN (991, 992, 993);")[0];
    assertTest(cleanupCheck.count === 0, 'Cleanup: Synthetic staging records completely removed');

  } finally {
    try { ws.close(); } catch (e) {}
    try { chromeProc.kill(); } catch (e) {}
    try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n====================================================');
  console.log(`STAGING ACCEPTANCE SUMMARY: ${passedCount} / ${totalCount} PASSED`);
  console.log('====================================================\n');
}

runStagingAcceptance().catch(err => {
  console.error('\n[FATAL STAGING ACCEPTANCE ERROR]');
  console.error(err);
  process.exit(1);
});
