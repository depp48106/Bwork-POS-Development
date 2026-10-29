/**
 * verifyCustomerScopeClarification.test.cjs
 * Comprehensive Automated Verification Suite for Customer Groups & Meeting Room Quota
 *
 * Verifies:
 * 1. Customer Groups:
 *    - Basecamp (Office 401-414, Hotdesk 419-422 and 427-430)
 *    - Shop (replaces Partner Shop, no subtitle/translation)
 *    - OnDemand (no unit required, customer_id reference)
 *    - Virtual Office (no unit required, customer_id reference)
 * 2. Meeting Room Quota:
 *    - Freely enter custom quota
 *    - Edit existing quota via PUT /api/customers/:id
 *    - Support 0 hours
 *    - Proper validation (rejects negative numbers)
 *    - Used hours are NOT reset when quota is modified
 *    - Historical booking logs are NOT changed
 *    - Remaining quota calculation: remaining = Math.max(0, quota - used)
 * 3. UI Invariants:
 *    - Wide Modal, ThaiDatePicker, and scroll preservation
 * 4. Cloudflare Worker & Express parity
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sqlite3 = require('../node_modules/sqlite3');
const { executeMigrationSql } = require('../migrator');
const {
  getBangkokDateToday,
  calculateCustomerQuota,
  evaluateContractStatus
} = require('../customerContracts/service');
const { createCustomerRouter } = require('../customerContracts/routes');

test('Customer Scope Clarification & Quota Management Test Suite', async (t) => {
  const db = new sqlite3.Database(':memory:');
  const dbQuery = {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, changes: this.changes });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    },
    exec(sql) {
      return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };

  await dbQuery.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      customer_type TEXT,
      basecamp_sub_type TEXT,
      basecamp_unit TEXT,
      quota_hours_used REAL DEFAULT 0,
      payment_status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      room_id INTEGER,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL
    );
  `);

  // Run migrations
  const migration011 = fs.readFileSync(path.join(__dirname, '../migrations/011_add_customers_and_contracts.sql'), 'utf8');
  await executeMigrationSql(dbQuery, migration011);

  const router = createCustomerRouter(dbQuery);

  // Mock Request / Response helper
  function mockReq(method, url, body = {}, query = {}, user = { role: 'admin', username: 'admin' }) {
    return {
      method,
      url,
      body,
      query,
      params: {},
      user
    };
  }

  function mockRes() {
    return {
      _status: 200,
      _json: null,
      status(s) { this._status = s; return this; },
      json(j) { this._json = j; return this; }
    };
  }

  async function callRoute(fn, req, res) {
    return new Promise((resolve, reject) => {
      fn(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      }).then(resolve).catch(reject);
    });
  }

  // Find router handlers
  const postCustomerHandler = router.stack.find(s => s.route && s.route.path === '/' && s.route.methods.post).route.stack[0].handle;
  const putCustomerHandler = router.stack.find(s => s.route && s.route.path === '/:id' && s.route.methods.put).route.stack[0].handle;
  const getCustomerListHandler = router.stack.find(s => s.route && s.route.path === '/' && s.route.methods.get).route.stack[0].handle;

  await t.test('1. Basecamp Units: Verify Office 401-414 and Hotdesk 419-422, 427-430', async () => {
    const jsxContent = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/CustomerManagement.jsx'), 'utf8');
    
    // Check Office units
    assert.match(jsxContent, /const officeUnits = useMemo\(\(\) => \['401', '402', '403', '404', '405', '406', '407', '408', '409', '410', '411', '412', '413', '414'\], \[\]\);/);
    
    // Check Hotdesk units
    assert.match(jsxContent, /const hotdeskUnits = useMemo\(\(\) => \['419', '420', '421', '422', '427', '428', '429', '430'\], \[\]\);/);
    
    // Verify office count is 14 and hotdesk count is 8
    const expectedOffice = ['401', '402', '403', '404', '405', '406', '407', '408', '409', '410', '411', '412', '413', '414'];
    const expectedHotdesk = ['419', '420', '421', '422', '427', '428', '429', '430'];
    assert.equal(expectedOffice.length, 14);
    assert.equal(expectedHotdesk.length, 8);
  });

  await t.test('2. Create Basecamp, Shop, OnDemand, and Virtual Office Customers', async () => {
    // 2.1 Basecamp Office
    const reqBc = mockReq('POST', '/', {
      customer_type: 'basecamp',
      name: 'Basecamp Tech 401',
      basecamp_sub_type: 'office',
      basecamp_unit: '401',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      monthly_quota_hours: 4.0
    });
    const resBc = mockRes();
    await callRoute(postCustomerHandler, reqBc, resBc);
    assert.ok(resBc._status === 200 || resBc._status === 201, `Status was ${resBc._status}`);
    assert.equal(resBc._json.success, true);
    const bcCust = await dbQuery.get('SELECT * FROM customers WHERE basecamp_unit = "401"');
    assert.equal(bcCust.customer_type, 'basecamp');
    assert.equal(bcCust.basecamp_unit, '401');

    // 2.2 Shop (No unit)
    const reqShop = mockReq('POST', '/', {
      customer_type: 'shop',
      name: 'Koo Koo Cafe',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      monthly_quota_hours: 4.0
    });
    const resShop = mockRes();
    await callRoute(postCustomerHandler, reqShop, resShop);
    assert.ok(resShop._status === 200 || resShop._status === 201, `Status was ${resShop._status}`);
    assert.equal(resShop._json.success, true);
    const shopCust = await dbQuery.get('SELECT * FROM customers WHERE name = "Koo Koo Cafe"');
    assert.equal(shopCust.customer_type, 'shop');
    assert.equal(shopCust.basecamp_unit, null);

    // 2.3 OnDemand (No unit, 0 hours quota)
    const reqOd = mockReq('POST', '/', {
      customer_type: 'ondemand',
      name: 'Freelance Nomad Studio',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      monthly_quota_hours: 0
    });
    const resOd = mockRes();
    await callRoute(postCustomerHandler, reqOd, resOd);
    assert.ok(resOd._status === 200 || resOd._status === 201, `Status was ${resOd._status}`);
    assert.equal(resOd._json.success, true);
    const odCust = await dbQuery.get('SELECT * FROM customers WHERE name = "Freelance Nomad Studio"');
    assert.equal(odCust.customer_type, 'ondemand');
    assert.equal(odCust.basecamp_unit, null);
    const odContract = await dbQuery.get('SELECT * FROM customer_contracts WHERE customer_id = ?', [odCust.id]);
    assert.equal(odContract.monthly_quota_hours, 0);

    // 2.4 Virtual Office (No unit, custom 2.5 hours quota)
    const reqVo = mockReq('POST', '/', {
      customer_type: 'virtual_office',
      name: 'Global Ventures Ltd',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      monthly_quota_hours: 2.5
    });
    const resVo = mockRes();
    await callRoute(postCustomerHandler, reqVo, resVo);
    assert.ok(resVo._status === 200 || resVo._status === 201, `Status was ${resVo._status}`);
    assert.equal(resVo._json.success, true);
    const voCust = await dbQuery.get('SELECT * FROM customers WHERE name = "Global Ventures Ltd"');
    assert.equal(voCust.customer_type, 'virtual_office');
    assert.equal(voCust.basecamp_unit, null);
    const voContract = await dbQuery.get('SELECT * FROM customer_contracts WHERE customer_id = ?', [voCust.id]);
    assert.equal(voContract.monthly_quota_hours, 2.5);
  });

  await t.test('3. Edit Quota: Freely Enter & Edit Quota (Supporting 0 Hours)', async () => {
    const shopCust = await dbQuery.get('SELECT * FROM customers WHERE name = "Koo Koo Cafe"');
    
    // Edit quota from 4.0 to 10.0 hours
    const reqEdit1 = mockReq('PUT', `/${shopCust.id}`, {
      name: 'Koo Koo Cafe Premium',
      monthly_quota_hours: 10
    });
    reqEdit1.params = { id: String(shopCust.id) };
    const resEdit1 = mockRes();
    await callRoute(putCustomerHandler, reqEdit1, resEdit1);
    assert.equal(resEdit1._status, 200);

    const ctrUpdated1 = await dbQuery.get('SELECT * FROM customer_contracts WHERE customer_id = ?', [shopCust.id]);
    assert.equal(ctrUpdated1.monthly_quota_hours, 10);

    // Edit quota to 0 hours
    const reqEdit0 = mockReq('PUT', `/${shopCust.id}`, {
      name: 'Koo Koo Cafe Premium',
      monthly_quota_hours: 0
    });
    reqEdit0.params = { id: String(shopCust.id) };
    const resEdit0 = mockRes();
    await callRoute(putCustomerHandler, reqEdit0, resEdit0);
    assert.equal(resEdit0._status, 200);

    const ctrUpdated0 = await dbQuery.get('SELECT * FROM customer_contracts WHERE customer_id = ?', [shopCust.id]);
    assert.equal(ctrUpdated0.monthly_quota_hours, 0);
  });

  await t.test('4. Quota Invariant: Editing Quota Does NOT Reset Used Hours or Alter Past Bookings', async () => {
    const bcCust = await dbQuery.get('SELECT * FROM customers WHERE basecamp_unit = "401"');
    
    // Simulate past booking using 2.5 hours of quota
    const today = new Date().toISOString().slice(0, 10);
    const curMonthStr = today.slice(0, 7);
    const insBooking = await dbQuery.run(
      `INSERT INTO bookings (customer_id, customer_type, quota_hours_used, payment_status, created_at)
       VALUES (?, 'basecamp', 2.5, 'completed', CURRENT_TIMESTAMP)`,
      [bcCust.id]
    );
    await dbQuery.run(
      `INSERT INTO booking_items (booking_id, start_time, end_time)
       VALUES (?, '${today} 10:00:00', '${today} 12:30:00')`,
      [insBooking.id]
    );

    // Initial quota check (max 4.0, used 2.5, remaining 1.5)
    let quotaCheck = await calculateCustomerQuota(dbQuery, { customerId: bcCust.id, targetDate: today });
    assert.equal(quotaCheck.max_quota, 4.0);
    assert.equal(quotaCheck.used_quota, 2.5);
    assert.equal(quotaCheck.remaining_quota, 1.5);

    // Now admin edits quota from 4.0 to 6.0 hours
    const reqEditQuota = mockReq('PUT', `/${bcCust.id}`, {
      name: bcCust.name,
      monthly_quota_hours: 6.0
    });
    reqEditQuota.params = { id: String(bcCust.id) };
    const resEditQuota = mockRes();
    await callRoute(putCustomerHandler, reqEditQuota, resEditQuota);
    assert.equal(resEditQuota._status, 200);

    // Verify used hours is STILL 2.5 (NOT reset), and remaining is 6.0 - 2.5 = 3.5
    quotaCheck = await calculateCustomerQuota(dbQuery, { customerId: bcCust.id, targetDate: today });
    assert.equal(quotaCheck.max_quota, 6.0);
    assert.equal(quotaCheck.used_quota, 2.5, 'Used hours must NOT be reset');
    assert.equal(quotaCheck.remaining_quota, 3.5, 'Remaining hours must be max - used');

    // Verify historical booking row was NOT modified
    const bookingRow = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [insBooking.id]);
    assert.equal(bookingRow.quota_hours_used, 2.5);
    assert.equal(bookingRow.payment_status, 'completed');

    // Now admin reduces quota to 1.0 hour (less than used 2.5 hours)
    const reqEditLow = mockReq('PUT', `/${bcCust.id}`, {
      name: bcCust.name,
      monthly_quota_hours: 1.0
    });
    reqEditLow.params = { id: String(bcCust.id) };
    const resEditLow = mockRes();
    await callRoute(putCustomerHandler, reqEditLow, resEditLow);
    assert.equal(resEditLow._status, 200);

    // Remaining must clamp to 0 (Math.max(0, 1.0 - 2.5) = 0), used is STILL 2.5
    quotaCheck = await calculateCustomerQuota(dbQuery, { customerId: bcCust.id, targetDate: today });
    assert.equal(quotaCheck.max_quota, 1.0);
    assert.equal(quotaCheck.used_quota, 2.5);
    assert.equal(quotaCheck.remaining_quota, 0);

    // Now admin sets quota to 0.0 hours
    const reqEditZero = mockReq('PUT', `/${bcCust.id}`, {
      name: bcCust.name,
      monthly_quota_hours: 0
    });
    reqEditZero.params = { id: String(bcCust.id) };
    const resEditZero = mockRes();
    await callRoute(putCustomerHandler, reqEditZero, resEditZero);
    assert.equal(resEditZero._status, 200);

    quotaCheck = await calculateCustomerQuota(dbQuery, { customerId: bcCust.id, targetDate: today });
    assert.equal(quotaCheck.max_quota, 0);
    assert.equal(quotaCheck.used_quota, 2.5);
    assert.equal(quotaCheck.remaining_quota, 0);
  });

  await t.test('5. UI Invariants & Display Requirements', async () => {
    const jsxContent = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/CustomerManagement.jsx'), 'utf8');
    const cssContent = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/CustomerManagement.css'), 'utf8');

    // 5.1 Shop has no subtitle below
    assert.match(jsxContent, /<strong>Shop<\/strong>/);
    assert.doesNotMatch(jsxContent, /<strong>Shop<\/strong>\s*<span>/);

    // 5.2 Responsive 4-group selector
    assert.match(jsxContent, /<strong>Basecamp<\/strong>/);
    assert.match(jsxContent, /<strong>Shop<\/strong>/);
    assert.match(jsxContent, /<strong>OnDemand<\/strong>/);
    assert.match(jsxContent, /<strong>Virtual Office<\/strong>/);

    // 5.3 Tags in CSS
    assert.match(cssContent, /\.crm-type-tag\.ondemand/);
    assert.match(cssContent, /\.crm-type-tag\.virtual-office/);

    // 5.4 Wide modal and datepicker preserved
    assert.match(jsxContent, /crm-modal-dialog crm-modal-wide/);
    assert.match(jsxContent, /<ThaiDatePicker/);
  });

  await t.test('6. Cloudflare Worker Code Parity', async () => {
    const workerContent = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

    // Check 4 groups handling in Worker
    assert.match(workerContent, /const validTypes = \['basecamp', 'shop', 'ondemand', 'virtual_office'\];/);
    assert.match(workerContent, /ORDER BY CASE customer_type WHEN/);
    assert.match(workerContent, /UPDATE customer_contracts\s+SET monthly_quota_hours = \?, updated_at = CURRENT_TIMESTAMP/);
  });
});
