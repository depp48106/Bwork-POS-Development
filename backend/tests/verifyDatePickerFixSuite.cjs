/**
 * verifyDatePickerFixSuite.cjs
 * Comprehensive Real Headless Chrome Test Suite for Customer Wide Modal DatePicker Fix
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 5011;
const BASE_URL = `http://localhost:${PORT}`;
const ARTIFACT_DIR = 'C:\\Users\\ADMIN\\.gemini\\antigravity\\brain\\93b1ef54-72e7-446f-a6a3-437743441774';
const EVIDENCE_DIR = path.join(__dirname, '../ui-review-evidence/datepicker-fix');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9251;

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

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

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, 1500));
  }

  async setViewport(width, height, isMobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: isMobile
    });
    await new Promise(r => setTimeout(r, 400));
  }

  async captureScreenshot(fileName) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(data, 'base64');
    const artifactPath = path.join(ARTIFACT_DIR, fileName);
    const evidencePath = path.join(EVIDENCE_DIR, fileName);
    fs.writeFileSync(artifactPath, buffer);
    fs.writeFileSync(evidencePath, buffer);
    console.log(`  📸 Saved: ${fileName} (${Math.round(buffer.length / 1024)} KB)`);
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

async function startServer() {
  const env = { ...process.env, PORT: String(PORT) };
  const server = spawn('node', [path.join(__dirname, '../server.js')], { env });
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
      });
      const data = await res.json();
      if (data.token) {
        return { server, token: data.token, user: data.user };
      }
    } catch (_) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  server.kill();
  throw new Error('Server failed to start on port ' + PORT);
}

async function run() {
  console.log('=== Starting Real Browser Test Suite: Customer Wide Modal DatePicker Fix ===\n');
  const { server, token, user } = await startServer();
  console.log(`✓ Backend running on port ${PORT}. Authenticated as ${user.username}.`);

  const chromeProfile = path.join(__dirname, '../.chrome-test-verify-fix');
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1920,1080',
    `--user-data-dir=${chromeProfile}`
  ]);

  const cdp = new CDPClient(CDP_PORT);
  const testResults = [];

  try {
    await cdp.connect();
    console.log('✓ Connected to Chrome CDP.');

    await cdp.setViewport(1920, 1080);
    await cdp.navigate(BASE_URL);

    await cdp.evaluate(`(() => {
      localStorage.setItem('pos_token', '${token}');
      localStorage.setItem('token', '${token}');
      localStorage.setItem('pos_user', ${JSON.stringify(JSON.stringify(user))});
      location.reload();
    })()`);
    await new Promise(r => setTimeout(r, 2000));

    // Navigate to Customer Management
    await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const crmBtn = buttons.find(b => b.textContent && b.textContent.includes('จัดการลูกค้า'));
      if (crmBtn) crmBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    // =========================================================================
    // TEST 1: DESKTOP 1920x1080 — CREATE CUSTOMER WIDE MODAL START DATE POPUP
    // =========================================================================
    console.log('\n[Test 1] Testing Desktop 1920x1080 Start Date Popup...');
    await cdp.setViewport(1920, 1080);

    // Click "เพิ่มลูกค้า / ร้านค้า"
    await cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const createBtn = buttons.find(b => b.textContent && b.textContent.includes('เพิ่มลูกค้า'));
      if (createBtn) createBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    // Click start_date input
    await cdp.evaluate(`(() => {
      const inputs = document.querySelectorAll('.thai-datepicker-input');
      if (inputs.length) inputs[0].click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const popoverInfo = await cdp.evaluate(`(() => {
      const p = document.querySelector('.thai-datepicker-popover');
      if (!p) return { found: false };
      const r = p.getBoundingClientRect();
      const cs = window.getComputedStyle(p);
      return {
        found: true,
        height: r.height,
        width: r.width,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        position: cs.position,
        zIndex: cs.zIndex,
        backgroundColor: cs.backgroundColor,
        opacity: cs.opacity,
        boxShadow: cs.boxShadow,
        isOpaque: cs.backgroundColor.includes('255, 255, 255') && cs.opacity === '1',
        isFullHeight: r.height > 320,
        className: p.className
      };
    })()`);

    console.log('  Popover Status:', JSON.stringify(popoverInfo, null, 2));
    testResults.push({
      test: 'Desktop 1920x1080 Start Date Popup',
      isOpaque: popoverInfo.isOpaque,
      isFullHeight: popoverInfo.isFullHeight,
      height: popoverInfo.height,
      pass: popoverInfo.found && popoverInfo.isOpaque && popoverInfo.isFullHeight
    });

    await cdp.captureScreenshot('customer_datepicker_desktop_1920_after.png');

    // =========================================================================
    // TEST 2: DATE SELECTION & THAI B.E. VALUE FORMAT
    // =========================================================================
    console.log('\n[Test 2] Testing Date Selection & Thai B.E. Format...');
    const selectDateResult = await cdp.evaluate(`(() => {
      const dayCells = Array.from(document.querySelectorAll('.thai-datepicker-day-cell:not(.outside-month):not(.disabled)'));
      const targetCell = dayCells.find(c => c.textContent.trim() === '15') || dayCells[10];
      if (targetCell) {
        targetCell.click();
        const input = document.querySelectorAll('.thai-datepicker-input')[0];
        return {
          clicked: true,
          inputValue: input ? input.value : '',
          hasBE: input && input.value.includes('256')
        };
      }
      return { clicked: false };
    })()`);

    console.log('  Select Date Result:', selectDateResult);
    testResults.push({
      test: 'Date Selection & Thai B.E. Value',
      inputValue: selectDateResult.inputValue,
      pass: selectDateResult.clicked && selectDateResult.hasBE
    });

    // =========================================================================
    // TEST 3: END DATE CALENDAR POPUP
    // =========================================================================
    console.log('\n[Test 3] Testing End Date Calendar Popup...');
    await cdp.evaluate(`(() => {
      const inputs = document.querySelectorAll('.thai-datepicker-input');
      if (inputs.length > 1) inputs[1].click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const endDatePopover = await cdp.evaluate(`(() => {
      const p = document.querySelector('.thai-datepicker-popover');
      if (!p) return { found: false };
      const r = p.getBoundingClientRect();
      const cs = window.getComputedStyle(p);
      return {
        found: true,
        height: r.height,
        isOpaque: cs.backgroundColor.includes('255, 255, 255'),
        isFullHeight: r.height > 320
      };
    })()`);

    testResults.push({
      test: 'End Date Popup',
      pass: endDatePopover.found && endDatePopover.isOpaque && endDatePopover.isFullHeight
    });
    await cdp.captureScreenshot('customer_datepicker_enddate_desktop_1920.png');

    // =========================================================================
    // TEST 4: MONTH & YEAR GRID NAVIGATION
    // =========================================================================
    console.log('\n[Test 4] Testing Month & Year Selection Grids...');
    // Click Month Button
    await cdp.evaluate(`(() => {
      const monthBtn = document.querySelector('.thai-datepicker-title-btn.month-btn');
      if (monthBtn) monthBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 400));

    const monthGridInfo = await cdp.evaluate(`(() => {
      const monthCells = document.querySelectorAll('.thai-datepicker-month-cell');
      const p = document.querySelector('.thai-datepicker-popover');
      const cs = p ? window.getComputedStyle(p) : null;
      return {
        cellCount: monthCells.length,
        isOpaque: cs && cs.backgroundColor.includes('255, 255, 255')
      };
    })()`);

    testResults.push({
      test: 'Month Selection Grid (3x4 = 12 cells)',
      cellCount: monthGridInfo.cellCount,
      pass: monthGridInfo.cellCount === 12 && monthGridInfo.isOpaque
    });
    await cdp.captureScreenshot('customer_datepicker_month_grid_1920.png');

    // Click back and then Year button
    await cdp.evaluate(`(() => {
      const backBtn = document.querySelector('.thai-datepicker-footer-btn.back');
      if (backBtn) backBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 300));

    await cdp.evaluate(`(() => {
      const yearBtn = document.querySelector('.thai-datepicker-title-btn.year-btn');
      if (yearBtn) yearBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 400));

    const yearGridInfo = await cdp.evaluate(`(() => {
      const yearCells = document.querySelectorAll('.thai-datepicker-year-cell');
      const p = document.querySelector('.thai-datepicker-popover');
      const cs = p ? window.getComputedStyle(p) : null;
      return {
        cellCount: yearCells.length,
        isOpaque: cs && cs.backgroundColor.includes('255, 255, 255')
      };
    })()`);

    testResults.push({
      test: 'Year Selection Grid (3x4 = 12 cells)',
      cellCount: yearGridInfo.cellCount,
      pass: yearGridInfo.cellCount === 12 && yearGridInfo.isOpaque
    });
    await cdp.captureScreenshot('customer_datepicker_year_grid_1920.png');

    // Close calendar via Escape key
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await new Promise(r => setTimeout(r, 400));

    const modalStillOpen = await cdp.evaluate(`(() => {
      const modal = document.querySelector('.crm-modal-dialog');
      const popover = document.querySelector('.thai-datepicker-popover');
      return {
        modalPresent: !!modal,
        popoverClosed: !popover
      };
    })()`);

    testResults.push({
      test: 'Escape Key Closes Popover Without Closing Modal',
      pass: modalStillOpen.modalPresent && modalStillOpen.popoverClosed
    });

    // =========================================================================
    // TEST 5: SCROLL ADAPTATION (Top, Middle, Bottom)
    // =========================================================================
    console.log('\n[Test 5] Testing Scroll Positions (Top, Middle, Bottom)...');
    for (const scrollTop of [0, 250, 500]) {
      await cdp.evaluate(`(() => {
        const body = document.querySelector('.crm-modal-body-wide, .crm-modal-body');
        if (body) body.scrollTop = ${scrollTop};
      })()`);
      await new Promise(r => setTimeout(r, 300));

      await cdp.evaluate(`(() => {
        const inputs = document.querySelectorAll('.thai-datepicker-input');
        if (inputs.length) inputs[0].click();
      })()`);
      await new Promise(r => setTimeout(r, 500));

      const scrollPop = await cdp.evaluate(`(() => {
        const p = document.querySelector('.thai-datepicker-popover');
        if (!p) return { found: false };
        const r = p.getBoundingClientRect();
        const cs = window.getComputedStyle(p);
        return {
          found: true,
          height: r.height,
          top: r.top,
          isFullHeight: r.height > 320,
          isOpaque: cs.backgroundColor.includes('255, 255, 255')
        };
      })()`);

      testResults.push({
        test: `Scroll scrollTop=${scrollTop} Placement`,
        height: scrollPop.height,
        top: scrollPop.top,
        pass: scrollPop.found && scrollPop.isFullHeight && scrollPop.isOpaque
      });

      // Close for next iteration
      await cdp.evaluate(`(() => {
        const p = document.querySelector('.thai-datepicker-popover');
        if (p) document.body.click();
      })()`);
      await new Promise(r => setTimeout(r, 300));
    }

    // =========================================================================
    // TEST 6: LAPTOP 1366x768
    // =========================================================================
    console.log('\n[Test 6] Testing Laptop 1366x768...');
    await cdp.setViewport(1366, 768);
    await cdp.evaluate(`(() => {
      const inputs = document.querySelectorAll('.thai-datepicker-input');
      if (inputs.length) inputs[0].click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const laptopPop = await cdp.evaluate(`(() => {
      const p = document.querySelector('.thai-datepicker-popover');
      if (!p) return { found: false };
      const r = p.getBoundingClientRect();
      const cs = window.getComputedStyle(p);
      return {
        found: true,
        height: r.height,
        top: r.top,
        bottom: r.bottom,
        isFullHeight: r.height > 320,
        isOpaque: cs.backgroundColor.includes('255, 255, 255')
      };
    })()`);

    testResults.push({
      test: 'Laptop 1366x768 Popover Opaque & Full Height',
      height: laptopPop.height,
      pass: laptopPop.found && laptopPop.isFullHeight && laptopPop.isOpaque
    });
    await cdp.captureScreenshot('customer_datepicker_laptop_1366_after.png');

    // Close popover
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await new Promise(r => setTimeout(r, 300));

    // =========================================================================
    // TEST 7: TABLET 820x1180
    // =========================================================================
    console.log('\n[Test 7] Testing Tablet 820x1180...');
    await cdp.setViewport(820, 1180);
    await cdp.evaluate(`(() => {
      const inputs = document.querySelectorAll('.thai-datepicker-input');
      if (inputs.length) inputs[0].click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const tabletPop = await cdp.evaluate(`(() => {
      const p = document.querySelector('.thai-datepicker-popover');
      if (!p) return { found: false };
      const r = p.getBoundingClientRect();
      const cs = window.getComputedStyle(p);
      return {
        found: true,
        height: r.height,
        isFullHeight: r.height > 320,
        isOpaque: cs.backgroundColor.includes('255, 255, 255')
      };
    })()`);

    testResults.push({
      test: 'Tablet 820x1180 Popover Opaque & Full Height',
      height: tabletPop.height,
      pass: tabletPop.found && tabletPop.isFullHeight && tabletPop.isOpaque
    });
    await cdp.captureScreenshot('customer_datepicker_tablet_820_after.png');

    // Close popover
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await new Promise(r => setTimeout(r, 300));

    // =========================================================================
    // TEST 8: MOBILE 390x844 (BOTTOM SHEET MODE)
    // =========================================================================
    console.log('\n[Test 8] Testing Mobile 390x844 (Bottom Sheet Dialog)...');
    await cdp.setViewport(390, 844, true);
    await cdp.evaluate(`(() => {
      const inputs = document.querySelectorAll('.thai-datepicker-input');
      if (inputs.length) inputs[0].click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const mobileSheet = await cdp.evaluate(`(() => {
      const sheet = document.querySelector('.thai-datepicker-popover.mobile-sheet');
      const backdrop = document.querySelector('.thai-datepicker-mobile-backdrop');
      const cs = sheet ? window.getComputedStyle(sheet) : null;
      return {
        sheetFound: !!sheet,
        backdropFound: !!backdrop,
        isOpaque: cs && cs.backgroundColor.includes('255, 255, 255'),
        height: sheet ? sheet.getBoundingClientRect().height : 0
      };
    })()`);

    testResults.push({
      test: 'Mobile 390x844 Bottom Sheet Mode',
      height: mobileSheet.height,
      pass: mobileSheet.sheetFound && mobileSheet.backdropFound && mobileSheet.isOpaque
    });
    await cdp.captureScreenshot('customer_datepicker_mobile_390_after.png');

    // Close modal to reset for other components
    await cdp.evaluate(`(() => {
      const closeBtn = document.querySelector('.thai-datepicker-sheet-close');
      if (closeBtn) closeBtn.click();
      const modalClose = document.querySelector('.crm-modal-close-btn');
      if (modalClose) modalClose.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    // =========================================================================
    // TEST 9: EDIT CONTRACT DATES MODAL (REUSING THAIDATEPICKER)
    // =========================================================================
    console.log('\n[Test 9] Testing Reused ThaiDatePicker in Contract Edit Dates Modal...');
    await cdp.setViewport(1920, 1080);
    // Click on first customer row contract cell or contract action
    const editModalOpened = await cdp.evaluate(`(() => {
      // Find a contract cell to open drawer or action
      const contractCells = document.querySelectorAll('.crm-contract-cell');
      if (contractCells.length > 0) {
        contractCells[0].click();
        return true;
      }
      return false;
    })()`);
    await new Promise(r => setTimeout(r, 1000));

    if (editModalOpened) {
      // In drawer/modal, find "แก้ไขวันที่สัญญา" button
      await cdp.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const editBtn = buttons.find(b => b.textContent && b.textContent.includes('แก้ไขวันที่สัญญา'));
        if (editBtn) editBtn.click();
      })()`);
      await new Promise(r => setTimeout(r, 800));

      // Click on datepicker input inside edit dates modal
      await cdp.evaluate(`(() => {
        const inputs = document.querySelectorAll('.crm-contract-modal-dialog .thai-datepicker-input, .thai-datepicker-input');
        if (inputs.length) inputs[0].click();
      })()`);
      await new Promise(r => setTimeout(r, 600));

      const editDatePickerPop = await cdp.evaluate(`(() => {
        const p = document.querySelector('.thai-datepicker-popover');
        if (!p) return { found: false };
        const r = p.getBoundingClientRect();
        const cs = window.getComputedStyle(p);
        return {
          found: true,
          height: r.height,
          isFullHeight: r.height > 320,
          isOpaque: cs.backgroundColor.includes('255, 255, 255')
        };
      })()`);

      testResults.push({
        test: 'Reused ThaiDatePicker in Contract Edit Dates Modal',
        pass: editDatePickerPop.found && editDatePickerPop.isFullHeight && editDatePickerPop.isOpaque
      });
      await cdp.captureScreenshot('customer_datepicker_edit_contract_dates.png');
    }

    console.log('\n=================================================================');
    console.log('                 FINAL TEST SUITE SUMMARY                        ');
    console.log('=================================================================');
    let allPassed = true;
    for (const r of testResults) {
      const status = r.pass ? '✓ PASS' : '✗ FAIL';
      console.log(`[${status}] ${r.test}`);
      if (!r.pass) allPassed = false;
    }
    console.log('=================================================================');
    console.log(`Overall Result: ${allPassed ? 'ALL TESTS PASSED (100%)' : 'SOME TESTS FAILED'}`);

  } finally {
    await cdp.close();
    chromeProcess.kill();
    server.kill();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
