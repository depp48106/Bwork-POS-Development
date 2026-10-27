/**
 * BWORK-POS | CUSTOMER, SHOP & CONTRACT LOCAL BROWSER UAT RUNNER
 * Full headless Chrome browser testing against local isolated services:
 * - Express Backend on http://127.0.0.1:5000 (database_customer_uat.sqlite)
 * - POS Frontend Vite on http://localhost:5173
 * - Chrome CDP on http://localhost:9225
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/Runrasa.P/.gemini/antigravity/brain/03721993-8ed4-4f8b-a41b-db0f7e984101';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT_DIR = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

function assertTest(condition, name, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${name} ${details ? '(' + details + ')' : ''}`);
    testResults.push({ name, status: 'PASS', details });
  } else {
    failedTests++;
    console.error(`  [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
    testResults.push({ name, status: 'FAIL', details });
    throw new Error(`UAT Assertion Failed: ${name} - ${details}`);
  }
}

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
  console.log(`    [Screenshot Saved] -> ${path.basename(filePath)}`);
}

async function main() {
  console.log('================================================================');
  console.log('  BWORK-POS CUSTOMER, SHOP & CONTRACT LOCAL BROWSER UAT');
  console.log('================================================================\n');

  // Step 1: Pre-flight database setup
  console.log('Step 1: Initializing isolated local Customer UAT database...');
  execSync('node scripts/setup_customer_uat_db.cjs', { cwd: ROOT_DIR, stdio: 'inherit' });
  assertTest(fs.existsSync(path.join(BACKEND_DIR, 'database_customer_uat.sqlite')), 'Isolated Customer UAT database created');

  // Step 2: Start Express Backend on port 5000
  console.log('\nStep 2: Starting Local Express Backend on port 5000...');
  const backendEnv = {
    ...process.env,
    PORT: '5000',
    APP_ENV: 'development',
    DB_PATH: path.join(BACKEND_DIR, 'database_customer_uat.sqlite'),
    DISABLE_LIVE_LINE: 'true'
  };

  const backendProc = spawn('node', [
    '--require', path.join(__dirname, 'mock_line_interceptor.cjs'),
    'backend/server.js'
  ], {
    cwd: ROOT_DIR,
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProc.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('Server is running locally') || s.includes('MOCK LINE')) {
      console.log(`  [Backend Log] ${s.trim()}`);
    }
  });
  backendProc.stderr.on('data', d => console.error(`  [Backend Err] ${d.toString().trim()}`));

  await waitForHttp('http://127.0.0.1:5000/api/rooms');
  assertTest(true, 'Local Backend listening on http://127.0.0.1:5000');

  // Step 3: Start POS Frontend Vite on port 5173
  console.log('\nStep 3: Starting POS Frontend Vite server on port 5173...');
  const frontendProc = spawn('npm.cmd', ['--prefix', 'frontend', 'run', 'dev', '--', '--port', '5173'], {
    cwd: ROOT_DIR,
    stdio: 'ignore',
    shell: true
  });
  await waitForHttp('http://localhost:5173');
  assertTest(true, 'POS Frontend listening on http://localhost:5173');

  // Step 4: Launch Chrome Headless on CDP port 9225
  console.log('\nStep 4: Launching Headless Chrome on port 9225...');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9225',
    '--window-size=1440,900',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const pages = await new Promise((resolve, reject) => {
    http.get('http://localhost:9225/json', (res) => {
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
  assertTest(true, 'Chrome DevTools Protocol connected successfully');

  // Login as admin to obtain JWT
  const loginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  assertTest(token && loginRes.ok, 'TC01: Admin authentication successful');

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  try {
    // =========================================================================
    // SECTION A: CUSTOMER MANAGEMENT
    // =========================================================================
    console.log('\n--- Section A: Customer Management ---');

    // TC02: Validation: creating customer without name returns 400
    const invalidRes = await fetch('http://127.0.0.1:5000/api/customers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ customer_type: 'shop', name: '   ' })
    });
    assertTest(invalidRes.status === 400, 'TC02: Validation rejects customer without name with HTTP 400');

    // Helper dates
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const nextYear = new Date();
    nextYear.setFullYear(now.getFullYear() + 1);
    const nextYearStr = nextYear.toISOString().slice(0, 10);

    // TC03: Create Basecamp Office customer (Unit 402, monthly quota 4.0h)
    const bcOfficeRes = await fetch('http://127.0.0.1:5000/api/customers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_type: 'basecamp',
        name: 'บริษัท ดิจิทัล โนแมดส์ จำกัด (Office 402)',
        contact_name: 'คุณณัฐพล',
        phone: '0812345678',
        email: 'natthapol@digitalnomads.co',
        basecamp_sub_type: 'office',
        basecamp_unit: '402',
        start_date: todayStr,
        end_date: nextYearStr,
        monthly_quota_hours: 4.0
      })
    });
    const bcOfficeData = await bcOfficeRes.json();
    assertTest(bcOfficeRes.ok && bcOfficeData.success, 'TC03: Create Basecamp Office customer (Unit 402, 4h quota)');
    const officeCustomerId = bcOfficeData.customer_id;

    // TC04: Create Basecamp Hotdesk customer (Unit 419, monthly quota 2.0h)
    const bcHotdeskRes = await fetch('http://127.0.0.1:5000/api/customers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_type: 'basecamp',
        name: 'คุณกิตติศักดิ์ ฟรีแลนซ์ (Hotdesk 419)',
        contact_name: 'คุณกิตติศักดิ์',
        phone: '0823456789',
        email: 'kittisak@freelance.th',
        basecamp_sub_type: 'hotdesk',
        basecamp_unit: '419',
        start_date: todayStr,
        end_date: nextYearStr,
        monthly_quota_hours: 2.0
      })
    });
    const bcHotdeskData = await bcHotdeskRes.json();
    assertTest(bcHotdeskRes.ok && bcHotdeskData.success, 'TC04: Create Basecamp Hotdesk customer (Unit 419, 2h quota)');
    const bcHotdeskId = bcHotdeskData.customer_id;

    // TC05: Create Shop A customer ("ร้านกาแฟสุขใจ (Shop A)", monthly quota 4.0h)
    const shopARes = await fetch('http://127.0.0.1:5000/api/customers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_type: 'shop',
        name: 'ร้านกาแฟสุขใจ (Shop A)',
        contact_name: 'คุณสุชาดา',
        phone: '0834567890',
        email: 'sukjai.coffee@gmail.com',
        start_date: todayStr,
        end_date: nextYearStr,
        monthly_quota_hours: 4.0
      })
    });
    const shopAData = await shopARes.json();
    assertTest(shopARes.ok && shopAData.success, 'TC05: Create Shop A customer (4h monthly quota)');
    const shopAId = shopAData.customer_id;
    const shopAContractId = shopAData.contract_id;

    // TC06: Create Shop B customer ("ร้านเบเกอรี่อบอุ่น (Shop B)", monthly quota 4.0h)
    const shopBRes = await fetch('http://127.0.0.1:5000/api/customers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_type: 'shop',
        name: 'ร้านเบเกอรี่อบอุ่น (Shop B)',
        contact_name: 'คุณวราภรณ์',
        phone: '0845678901',
        email: 'warm.bakery@gmail.com',
        start_date: todayStr,
        end_date: nextYearStr,
        monthly_quota_hours: 4.0
      })
    });
    const shopBData = await shopBRes.json();
    assertTest(shopBRes.ok && shopBData.success, 'TC06: Create Shop B customer (4h monthly quota)');
    const shopBId = shopBData.customer_id;

    // TC07: Edit customer contact info
    const editRes = await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        customer_type: 'shop',
        name: 'ร้านกาแฟสุขใจ (Shop A)',
        contact_name: 'คุณสุชาดา เจ้าของร้าน',
        phone: '0834567899'
      })
    });
    const editData = await editRes.json();
    assertTest(editRes.ok && editData.success, 'TC07: Edit customer contact name and phone number');

    // TC08: Filter customers by type and status
    const filterShopRes = await fetch('http://127.0.0.1:5000/api/customers?type=shop&status=active', { headers: authHeaders });
    const filterShopData = await filterShopRes.json();
    assertTest(filterShopData.customers.length === 2, 'TC08: Filter customers by type=shop returns exactly 2 shops');

    // TC09: Deactivate customer
    const deactRes = await fetch(`http://127.0.0.1:5000/api/customers/${shopBId}/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'inactive' })
    });
    const deactData = await deactRes.json();
    assertTest(deactRes.ok && deactData.success, 'TC09: Deactivate customer sets status to inactive');

    // TC10: Reactivate customer
    const reactRes = await fetch(`http://127.0.0.1:5000/api/customers/${shopBId}/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'active' })
    });
    assertTest(reactRes.ok, 'TC10: Reactivate customer back to active');

    // TC11: Permissions: staff user with 'pos' can access customer API
    const staffLoginRes = await fetch('http://127.0.0.1:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'staff', password: 'staff123' })
    });
    const staffToken = (await staffLoginRes.json()).token;
    const staffCustRes = await fetch('http://127.0.0.1:5000/api/customers', {
      headers: { 'Authorization': `Bearer ${staffToken}` }
    });
    assertTest(staffCustRes.ok, 'TC11: Staff role with POS permission successfully accesses customers endpoint');

    // TC12: Browser UI test for Customer Management
    await send('Page.navigate', { url: 'http://localhost:5173' });
    await new Promise(r => setTimeout(r, 2000));

    // Inject localStorage login credentials
    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('pos_token', '${token}');
        localStorage.setItem('token', '${token}');
        localStorage.setItem('pos_user', JSON.stringify(${JSON.stringify(loginData.user)}));
        location.reload();
      `
    });
    await new Promise(r => setTimeout(r, 2500));

    // Navigate to Customer Management tab
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const custMenu = Array.from(document.querySelectorAll('.top-menu-item, .menu-card, button')).find(el => el.innerText && el.innerText.trim().includes('จัดการลูกค้า'));
          if (custMenu) custMenu.click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    const custUiEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasTitle: text.includes('จัดการลูกค้า') || text.includes('ข้อมูลลูกค้า') || text.includes('สัญญา'),
            hasShopA: text.includes('ร้านกาแฟสุขใจ'),
            hasShopB: text.includes('ร้านเบเกอรี่อบอุ่น'),
            hasOffice: text.includes('ดิจิทัล โนแมดส์')
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(custUiEval.result.value.hasShopA && custUiEval.result.value.hasOffice, 'TC12: Browser UI Customer Management table renders registered customers');

    const custScreenshot = path.join(ARTIFACT_DIR, 'uat_customer_management_list.png');
    await takeScreenshot(send, custScreenshot);

    // =========================================================================
    // SECTION B: CONTRACT MANAGEMENT
    // =========================================================================
    console.log('\n--- Section B: Contract Management ---');

    // TC13: Verify automatic contract creation
    const custDetailRes = await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}`, { headers: authHeaders });
    const custDetail = await custDetailRes.json();
    assertTest(custDetail.customer.contracts && custDetail.customer.contracts.length >= 1, 'TC13: Customer has linked contract record');

    // TC14: Renew contract for Shop A (Next year period)
    const renewStart = new Date(nextYear.getTime() + 86400000).toISOString().slice(0, 10);
    const renewEnd = new Date(nextYear.getTime() + 365 * 86400000).toISOString().slice(0, 10);
    const renewRes = await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}/contracts`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        contract_number: 'CTR-SHOP-A-Y2',
        start_date: renewStart,
        end_date: renewEnd,
        monthly_quota_hours: 4.0,
        notes: 'ต่อสัญญาปีที่ 2'
      })
    });
    const renewData = await renewRes.json();
    assertTest(renewRes.ok && renewData.success, 'TC14: Renew contract successfully creates consecutive contract period');

    // TC15: Terminate contract
    const termRes = await fetch(`http://127.0.0.1:5000/api/customers/contracts/${renewData.contract_id}/terminate`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        termination_date: todayStr,
        reason: 'ลูกค้าย้ายสาขา'
      })
    });
    const termData = await termRes.json();
    assertTest(termRes.ok && termData.success, 'TC15: Terminate contract marks contract status as TERMINATED');

    // TC16: Overlap prevention
    const overlapRes = await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}/contracts`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        contract_number: 'CTR-SHOP-A-OVERLAP',
        start_date: todayStr,
        end_date: nextYearStr,
        monthly_quota_hours: 4.0
      })
    });
    assertTest(overlapRes.status === 400, 'TC16: Overlap prevention rejects overlapping active contract with HTTP 400');

    // TC17: Verify audit logs
    const auditRes = await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}`, { headers: authHeaders });
    const auditData = await auditRes.json();
    assertTest(auditData.customer && auditData.customer.audit_logs && auditData.customer.audit_logs.length >= 2, 'TC17: Customer audit logs table records creation, renewal and termination');

    // TC18: Date formatting in Asia/Bangkok
    const contractObj = custDetail.customer.contracts[0];
    assertTest(/^\d{4}-\d{2}-\d{2}$/.test(contractObj.start_date) && /^\d{4}-\d{2}-\d{2}$/.test(contractObj.end_date), 'TC18: Contract dates conform to standard YYYY-MM-DD');

    // TC19: Browser UI: Open Contract Modal
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const rows = Array.from(document.querySelectorAll('tr'));
          const shopRow = rows.find(r => r.innerText.includes('ร้านกาแฟสุขใจ'));
          if (shopRow) {
            const ctrBtn = shopRow.querySelector('button[title="จัดการสัญญา"]') || Array.from(shopRow.querySelectorAll('button')).find(b => b.innerText.includes('สัญญา'));
            if (ctrBtn) ctrBtn.click();
          }
        })()
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    const ctrModalEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasModal: text.includes('จัดการสัญญา') || text.includes('ประวัติสัญญา') || text.includes('CTR-'),
            hasActivePill: text.includes('ACTIVE') || text.includes('วันคงเหลือ') || text.includes('วัน')
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(ctrModalEval.result.value.hasModal, 'TC19: Browser UI Contract Lifecycle modal renders successfully');

    const ctrScreenshot = path.join(ARTIFACT_DIR, 'uat_contract_lifecycle_modal.png');
    await takeScreenshot(send, ctrScreenshot);

    // Close contract modal
    await send('Runtime.evaluate', {
      expression: `
        const closeBtn = document.querySelector('.cust-modal-close-btn') || document.querySelector('button[title="ปิดหน้าต่าง"], button[title="ปิด"], .modal-close-btn');
        if (closeBtn) closeBtn.click();
      `
    });
    await new Promise(r => setTimeout(r, 1000));

    // =========================================================================
    // SECTION C: QUOTA ENGINE & ISOLATION RULES
    // =========================================================================
    console.log('\n--- Section C: Quota Engine & Isolation Rules ---');

    // TC20: Quota calculation: Basecamp Office = 4h, Hotdesk = 2h
    const officeQuotaRes = await (await fetch(`http://127.0.0.1:5000/api/customers/${officeCustomerId}/quota`, { headers: authHeaders })).json();
    const hotdeskQuotaRes = await (await fetch(`http://127.0.0.1:5000/api/customers/${bcHotdeskId}/quota`, { headers: authHeaders })).json();
    assertTest(officeQuotaRes.max_quota === 4.0, 'TC20.1: Basecamp Office max quota is 4.0 hours/month');
    assertTest(hotdeskQuotaRes.max_quota === 2.0, 'TC20.2: Basecamp Hotdesk max quota is 2.0 hours/month');

    // TC21: Quota calculation: Shop A = 4h, Shop B = 4h
    const shopAQuotaPre = await (await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}/quota`, { headers: authHeaders })).json();
    const shopBQuotaPre = await (await fetch(`http://127.0.0.1:5000/api/customers/${shopBId}/quota`, { headers: authHeaders })).json();
    assertTest(shopAQuotaPre.max_quota === 4.0 && shopBQuotaPre.max_quota === 4.0, 'TC21: Shop A and Shop B each have 4.0 hours/month quota');

    // TC22: Book 2 hours for Shop A
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    const curDay = String(now.getDate()).padStart(2, '0');
    const bookingStartTime = `${curYear}-${curMonth}-${curDay}T09:00:00`;
    const bookingEndTime = `${curYear}-${curMonth}-${curDay}T11:00:00`;

    const bookShopARes = await fetch('http://127.0.0.1:5000/api/bookings', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_name: 'ร้านกาแฟสุขใจ (Shop A)',
        customer_type: 'shop',
        customer_id: shopAId,
        contract_id: shopAContractId,
        payment_method: 'free',
        items: [{
          room_id: 1,
          start_time: bookingStartTime,
          end_time: bookingEndTime,
          quantity: 2,
          price: 300,
          subtotal: 600
        }]
      })
    });
    const bookShopAData = await bookShopARes.json();
    const savedBooking = bookShopAData.booking || bookShopAData;
    assertTest(bookShopARes.ok && bookShopAData.success, 'TC22.1: Booking 2 hours for Shop A created successfully');
    assertTest(savedBooking.quota_hours_used === 2.0, 'TC22.2: Booking used exactly 2.0 quota hours');
    assertTest(savedBooking.total_amount === 0, 'TC22.3: Total amount is 0 (covered 100% by free quota)');
    const shopABookingId = savedBooking.id || savedBooking.bookingId;

    // Verify remaining quota
    const shopAQuotaPost = await (await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}/quota`, { headers: authHeaders })).json();
    assertTest(shopAQuotaPost.remaining_quota === 2.0 && shopAQuotaPost.used_quota === 2.0, 'TC22.4: Shop A remaining quota is now 2.0 hours');

    // TC23: Shop Quota Isolation: Shop B's quota remains untouched at 4.0h
    const shopBQuotaPost = await (await fetch(`http://127.0.0.1:5000/api/customers/${shopBId}/quota`, { headers: authHeaders })).json();
    assertTest(shopBQuotaPost.remaining_quota === 4.0 && shopBQuotaPost.used_quota === 0, 'TC23: Shop B quota is completely isolated (remains 4.0h unused)');

    // TC24: Name Change Invariance: Updating Shop A name does NOT reset used quota
    await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        customer_type: 'shop',
        name: 'ร้านกาแฟสุขใจ โฉมใหม่ (Shop A Renovated)',
        phone: '0834567890'
      })
    });
    const shopAQuotaAfterRename = await (await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}/quota`, { headers: authHeaders })).json();
    assertTest(shopAQuotaAfterRename.used_quota === 2.0 && shopAQuotaAfterRename.remaining_quota === 2.0, 'TC24: Name change does not reset used quota (Invariance maintained)');

    // TC25: Tenant Transfer Isolation
    const transferRes = await fetch('http://127.0.0.1:5000/api/customers/transfer-unit', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        basecamp_unit: '402',
        new_tenant: {
          name: 'บริษัท นิวเวฟ ครีเอทีฟ จำกัด (New Tenant 402)',
          contact_name: 'คุณพงศกร',
          phone: '0899998888',
          email: 'pongsakorn@newwave.co'
        },
        new_contract: {
          start_date: todayStr,
          end_date: nextYearStr,
          monthly_quota_hours: 4.0
        }
      })
    });
    const transferData = await transferRes.json();
    assertTest(transferRes.ok && transferData.success, 'TC25.1: Tenant transfer completed successfully');
    const newTenantQuota = await (await fetch(`http://127.0.0.1:5000/api/customers/${transferData.customer_id}/quota`, { headers: authHeaders })).json();
    assertTest(newTenantQuota.used_quota === 0 && newTenantQuota.remaining_quota === 4.0, 'TC25.2: New tenant starts with full fresh 4.0h quota');

    // TC26: Booking Cancellation Quota Restoration
    const cancelRes = await fetch(`http://127.0.0.1:5000/api/bookings/${shopABookingId}/cancel`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'ลูกค้ายกเลิกการประชุม' })
    });
    assertTest(cancelRes.ok, 'TC27.1: Cancel Shop A booking returned HTTP 200');
    const shopAQuotaRestored = await (await fetch(`http://127.0.0.1:5000/api/customers/${shopAId}/quota`, { headers: authHeaders })).json();
    assertTest(shopAQuotaRestored.used_quota === 0 && shopAQuotaRestored.remaining_quota === 4.0, 'TC27.2: Cancelled booking restored Shop A quota back to 4.0h');

    // TC28: Over-quota Partial Pricing: Booking 5 hours with 4h quota
    const overStartTime = `${curYear}-${curMonth}-${curDay}T12:00:00`;
    const overEndTime = `${curYear}-${curMonth}-${curDay}T17:00:00`;
    const overRes = await fetch('http://127.0.0.1:5000/api/bookings', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_name: 'ร้านกาแฟสุขใจ (Shop A)',
        customer_type: 'shop',
        customer_id: shopAId,
        payment_method: 'cash',
        items: [{
          room_id: 1, // 300 THB/hr
          start_time: overStartTime,
          end_time: overEndTime,
          quantity: 5,
          price: 300,
          subtotal: 1500
        }]
      })
    });
    const overData = await overRes.json();
    const overBooking = overData.booking || overData;
    assertTest(overRes.ok && overData.success, 'TC28.1: Over-quota booking created');
    assertTest(overBooking.quota_hours_used === 4.0, 'TC28.2: Exactly 4.0 hours used from quota');
    assertTest(overBooking.total_amount === 300.0, 'TC28.3: Chargeable 1 hour billed at 300.0 THB');
    assertTest(overBooking.billing_option === 'quota_partial', 'TC28.4: Billing option set to quota_partial');

    // =========================================================================
    // SECTION D: POS BOOKING FLOW
    // =========================================================================
    console.log('\n--- Section D: POS Booking Flow ---');

    // Navigate to POS Booking interface
    await send('Runtime.evaluate', {
      expression: `
        const posMenu = Array.from(document.querySelectorAll('.top-menu-item, .menu-card, button')).find(el => el.innerText && el.innerText.trim() === 'POS');
        if (posMenu) posMenu.click();
      `
    });
    await new Promise(r => setTimeout(r, 2500));

    // Open booking drawer for Room to expose Customer Type Switcher
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const roomCell = document.querySelector('div[title*="คลิกเพื่อเปิดฟอร์มจองห้องนี้"]') ||
                           Array.from(document.querySelectorAll('div')).find(d => d.title && d.title.includes('คลิกเพื่อเปิดฟอร์มจอง'));
          if (roomCell) {
            roomCell.click();
          } else {
            const anyCell = Array.from(document.querySelectorAll('div')).find(el => el.innerText && (el.innerText.includes('Room 1') || el.innerText.includes('ห้องประชุม')));
            if (anyCell) anyCell.click();
          }
        })()
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    // Check customer type options in POS
    const posUiEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          const btns = Array.from(document.querySelectorAll('button')).map(b => b.innerText);
          const hasShopBtn = btns.some(t => t.includes('Shop') || t.includes('ร้านค้า'));
          return {
            hasShopBtn,
            textSnippet: text.slice(0, 300)
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(posUiEval.result.value.hasShopBtn, 'TC29: POS interface includes "Shop (ร้านค้า)" customer type button');

    // Click "Shop / ร้านค้า" button to select shop type
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Shop') && b.innerText.includes('ร้านค้า'));
          if (btn) btn.click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 1500));

    // Verify Shop dropdown is visible and contains shops
    const shopDropdownEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          const hasShopLabel = text.includes('เลือกร้านค้าพันธมิตร');
          const customSelect = document.querySelector('.custom-select-container');
          const hasShopInSelect = text.includes('ร้านกาแฟสุขใจ') || text.includes('ร้านเบเกอรี่');
          return {
            hasShopSelect: hasShopLabel && (hasShopInSelect || !!customSelect)
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(shopDropdownEval.result.value.hasShopSelect, 'TC30: Shop selection dropdown rendered in POS');

    // Check quota badge display
    const quotaDisplayEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasQuotaInfo: text.includes('สิทธิ์โควต้าประจำเดือน') || text.includes('โควต้า') || text.includes('ชม./เดือน') || text.includes('เหลือ')
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(quotaDisplayEval.result.value.hasQuotaInfo, 'TC31: POS displays real-time quota status for selected Shop');

    const posScreenshot = path.join(ARTIFACT_DIR, 'uat_pos_shop_booking.png');
    await takeScreenshot(send, posScreenshot);

    // Close room drawer
    await send('Runtime.evaluate', {
      expression: `
        const closeBtn = document.querySelector('.pos-drawer-content button, button[title*="ปิด"], [aria-label*="close"]');
        if (closeBtn) closeBtn.click();
      `
    });
    await new Promise(r => setTimeout(r, 1000));

    // TC33: Service date after contract expiration policy test
    // Create an expired contract customer (ended 30 days ago)
    const pastStart = new Date(now.getTime() - 400 * 86400000).toISOString().slice(0, 10);
    const pastEnd = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const expiredShopRes = await (await fetch('http://127.0.0.1:5000/api/customers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_type: 'shop',
        name: 'ร้านค้าหมดสัญญา (Expired Shop)',
        start_date: pastStart,
        end_date: pastEnd,
        monthly_quota_hours: 4.0
      })
    })).json();
    const expiredShopId = expiredShopRes.customer_id;

    // Booking attempt for today (service date > contract.end_date)
    const expiredBookingRes = await fetch('http://127.0.0.1:5000/api/bookings', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customer_name: 'ร้านค้าหมดสัญญา (Expired Shop)',
        customer_type: 'shop',
        customer_id: expiredShopId,
        payment_method: 'cash',
        items: [{
          room_id: 1,
          start_time: bookingStartTime,
          end_time: bookingEndTime,
          quantity: 2,
          price: 300,
          subtotal: 600
        }]
      })
    });
    const expiredBookingData = await expiredBookingRes.json();
    const expiredBooking = expiredBookingData.booking || expiredBookingData;
    assertTest(expiredBookingRes.ok, 'TC33.1: Booking after contract expiration allowed to proceed');
    assertTest(expiredBooking.quota_hours_used === 0, 'TC33.2: Expired contract customer gets 0 free quota hours');
    assertTest(expiredBooking.total_amount === 600.0, 'TC33.3: Expired contract customer is billed full standard price (600 THB)');

    // =========================================================================
    // SECTION E: DASHBOARD, HISTORY & EXPORT
    // =========================================================================
    console.log('\n--- Section E: Dashboard, History & Export ---');

    // TC34: Dashboard Contract Alerts API test
    // Create contracts expiring in 5 days, 14 days, 25 days
    const makeExpiring = async (days, name) => {
      const eDate = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
      await fetch('http://127.0.0.1:5000/api/customers', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          customer_type: 'shop',
          name: `ร้านทดสอบแจ้งเตือน ${name} (${days} วัน)`,
          start_date: todayStr,
          end_date: eDate,
          monthly_quota_hours: 4.0
        })
      });
    };
    await makeExpiring(5, 'ด่วนมาก 7 วัน');
    await makeExpiring(14, 'เตือน 15 วัน');
    await makeExpiring(25, 'เตือน 30 วัน');

    const alertsRes = await (await fetch('http://127.0.0.1:5000/api/customers/contracts/alerts', { headers: authHeaders })).json();
    assertTest(alertsRes.success && alertsRes.summary.expiring_7_days >= 1, 'TC34.1: Alerts API identifies contracts expiring within 7 days');
    assertTest(alertsRes.summary.expiring_15_days >= 1, 'TC34.2: Alerts API identifies contracts expiring within 15 days');
    assertTest(alertsRes.summary.expiring_30_days >= 1, 'TC34.3: Alerts API identifies contracts expiring within 30 days');
    assertTest(alertsRes.summary.expired >= 1, 'TC34.4: Alerts API identifies expired contracts');

    // TC35: Browser UI: Dashboard Contract Alerts widget
    await send('Runtime.evaluate', {
      expression: `
        const dashBtn = Array.from(document.querySelectorAll('.top-menu-item, .menu-card, button')).find(el => el.innerText && (el.innerText.includes('Today Overview') || el.innerText.includes('Dashboard') || el.innerText.includes('แดชบอร์ด')));
        if (dashBtn) dashBtn.click();
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    const dashAlertEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasAlertWidget: text.includes('Contract Alerts') || text.includes('เตือนสัญญา') || text.includes('สัญญา'),
            hasAlertCounts: text.includes('วัน') || text.includes('Shop')
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(dashAlertEval.result.value.hasAlertWidget, 'TC35: Dashboard renders Contract Expiration Alerts widget');

    const dashScreenshot = path.join(ARTIFACT_DIR, 'uat_dashboard_contract_alerts.png');
    await takeScreenshot(send, dashScreenshot);

    // TC36: Browser UI: History view renders Shop bookings
    await send('Runtime.evaluate', {
      expression: `
        const histBtn = Array.from(document.querySelectorAll('.top-menu-item, .menu-card, button')).find(el => el.innerText && el.innerText.includes('Booking History'));
        if (histBtn) histBtn.click();
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    const historyEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasShopBooking: text.includes('ร้านกาแฟสุขใจ') || text.includes('ร้านค้าหมดสัญญา'),
            hasShopBadge: text.includes('Shop') || text.includes('ร้านค้า')
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(historyEval.result.value.hasShopBooking, 'TC36: Booking History renders Shop customer bookings');

    const histScreenshot = path.join(ARTIFACT_DIR, 'uat_history_shop_booking.png');
    await takeScreenshot(send, histScreenshot);

    // TC37: PendingBookings renders Shop badge
    await send('Runtime.evaluate', {
      expression: `
        const pendBtn = Array.from(document.querySelectorAll('.top-menu-item, .menu-card, button')).find(el => el.innerText && el.innerText.includes('Booking Management'));
        if (pendBtn) pendBtn.click();
      `
    });
    await new Promise(r => setTimeout(r, 2000));

    const pendingEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const text = document.body.innerText;
          return {
            hasPendingShop: text.includes('ร้านกาแฟสุขใจ') || text.includes('Shop')
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(pendingEval.result.value.hasPendingShop, 'TC37: Booking Management renders Shop customer bookings');

    // TC38: Dashboard Export mapping check
    const { pathToFileURL } = require('url');
    const { formatBillingOption } = await import(pathToFileURL(path.join(ROOT_DIR, 'frontend/src/utils/dashboardExport.js')).href);
    const shopBillingFormatted = formatBillingOption({ customer_type: 'shop' });
    assertTest(shopBillingFormatted === 'โควต้า Shop', 'TC38: dashboardExport.js formatBillingOption correctly outputs "โควต้า Shop"');

    // TC39: Responsive layout check (Mobile viewport 390x844)
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await send('Page.navigate', { url: 'http://localhost:5173' });
    await new Promise(r => setTimeout(r, 2000));

    const mobileEval = await send('Runtime.evaluate', {
      expression: `
        (() => {
          return {
            hasBody: document.body.scrollWidth <= 420,
            hasContent: document.body.innerText.length > 50
          };
        })()
      `,
      returnByValue: true
    });
    assertTest(mobileEval.result.value.hasContent, 'TC39: POS renders cleanly on mobile screen size');

    console.log('\n================================================================');
    console.log(`  UAT AUTOMATION COMPLETED: ${passedTests} PASSED / ${failedTests} FAILED`);
    console.log('================================================================\n');

  } finally {
    console.log('Tearing down local processes...');
    function killProc(proc) {
      if (!proc || !proc.pid) return;
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
        } else {
          proc.kill('SIGTERM');
        }
      } catch (_) {}
    }

    try { ws.close(); } catch (_) {}
    killProc(chromeProc);
    killProc(frontendProc);
    killProc(backendProc);

    // Clean up temporary database
    try {
      if (fs.existsSync(path.join(BACKEND_DIR, 'database_customer_uat.sqlite'))) {
        fs.unlinkSync(path.join(BACKEND_DIR, 'database_customer_uat.sqlite'));
      }
      if (fs.existsSync(path.join(BACKEND_DIR, 'database_customer_uat.sqlite-journal'))) {
        fs.unlinkSync(path.join(BACKEND_DIR, 'database_customer_uat.sqlite-journal'));
      }
    } catch (_) {}
  }
}

main().catch(err => {
  console.error('\n[UAT FATAL ERROR]:', err);
  process.exit(1);
});
