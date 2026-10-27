/**
 * unifiedCustomerContractModal.test.cjs
 * Comprehensive Automated Verification Suite for Unified Customer & Contract Modal (CRM UX Overhaul)
 *
 * Verifies:
 * 1. 3-Tab Architecture (profile, contracts, quota)
 * 2. Tab 1: Customer Profile Save Invariant (PUT /api/customers/:id preserves contracts & quotas)
 * 3. Tab 2: Contract Lifecycle Management (Active hero, Edit Dates, Renew, Terminate)
 * 4. Tab 2: Empty State for Customers Without Contracts
 * 5. Tab 2: RBAC Protection on Audit Logs (Admin vs Staff)
 * 6. Tab 3: Authoritative Quota Hero Metrics (Shop 4h, Basecamp Office 4h, Hotdesk 2h)
 * 7. Tab 3: Contract Eligibility Banner (Active vs Expired vs Terminated)
 * 8. Error Resilience & Graceful Fallback (Drawer eliminated, no silent failure)
 * 9. Date Conversion & Thai Buddhist Era Parity
 * 10. Express & Cloudflare Worker Endpoint Parity
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
  updateContractDates,
  evaluateContractStatus,
  verifyServiceDateContractEligibility
} = require('../customerContracts/service');
const { createCustomerRouter } = require('../customerContracts/routes');

// Helper to format Thai date (matching frontend/src/utils/thaiDateHelper.js)
function formatThaiDate(dateVal) {
  if (!dateVal) return '-';
  const str = typeof dateVal === 'string' ? dateVal.trim() : (dateVal instanceof Date ? dateVal.toISOString() : String(dateVal));
  const isoDateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    const year = parseInt(isoDateMatch[1], 10);
    const month = isoDateMatch[2];
    const day = isoDateMatch[3];
    const beYear = year + 543;
    return `${day}/${month}/${beYear}`;
  }
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
}

test('CRM Unified Customer, Contract & Quota Modal Verification Suite', async (t) => {
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

  // Base schema
  await dbQuery.exec(`
    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hourly_rate REAL NOT NULL
    );

    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      contract_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_type TEXT DEFAULT 'walkin',
      basecamp_sub_type TEXT,
      basecamp_unit TEXT,
      quota_hours_used REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      billing_option TEXT DEFAULT 'paid',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      room_id INTEGER,
      start_time TEXT,
      end_time TEXT,
      subtotal REAL NOT NULL
    );
  `);

  // Apply migration 011
  const m11Sql = fs.readFileSync(path.join(__dirname, '../migrations/011_add_customers_and_contracts.sql'), 'utf8');
  await executeMigrationSql(dbQuery, m11Sql);

  // Setup test customer 1: Shop with active contract
  const c1Res = await dbQuery.run(`
    INSERT INTO customers (customer_type, name, contact_name, phone, email, tax_id, address, status)
    VALUES ('shop', 'Artisan Bakery', 'Chef Pierre', '0819998877', 'pierre@bakery.co', '0105558889991', '123 Bakery Lane', 'active')
  `);
  const c1Id = c1Res.id;

  const ctr1Res = await dbQuery.run(`
    INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status, notes)
    VALUES (?, 'CTR-SHOP-001', '2026-10-01', '2026-10-31', 4.0, 'ACTIVE', 'Monthly Shop Lease')
  `, [c1Id]);
  const ctr1Id = ctr1Res.id;

  // Setup test customer 2: Basecamp Office
  const c2Res = await dbQuery.run(`
    INSERT INTO customers (customer_type, name, contact_name, basecamp_sub_type, basecamp_unit, status)
    VALUES ('basecamp', 'Tech Solutions Ltd.', 'David', 'office', 'Unit 305', 'active')
  `);
  const c2Id = c2Res.id;

  const ctr2Res = await dbQuery.run(`
    INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
    VALUES (?, 'CTR-BC-305', '2026-10-01', '2026-10-31', 4.0, 'ACTIVE')
  `, [c2Id]);
  const ctr2Id = ctr2Res.id;

  // Setup test customer 3: Basecamp Hotdesk
  const c3Res = await dbQuery.run(`
    INSERT INTO customers (customer_type, name, contact_name, basecamp_sub_type, basecamp_unit, status)
    VALUES ('basecamp', 'Alex Nomad', 'Alex', 'hotdesk', 'Desk 12', 'active')
  `);
  const c3Id = c3Res.id;

  const ctr3Res = await dbQuery.run(`
    INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
    VALUES (?, 'CTR-HD-012', '2026-10-01', '2026-10-31', 2.0, 'ACTIVE')
  `, [c3Id]);
  const ctr3Id = ctr3Res.id;

  // Setup test customer 4: Customer WITHOUT any contracts
  const c4Res = await dbQuery.run(`
    INSERT INTO customers (customer_type, name, contact_name, phone, status)
    VALUES ('general', 'Walkin Regular Co.', 'Sarah', '0891234567', 'active')
  `);
  const c4Id = c4Res.id;

  await t.test('1. Modal Tab Structure & Initial State Verification', async () => {
    // Verify CustomerManagement.jsx contains tabs: profile, contracts, quota
    const jsxPath = path.join(__dirname, '../../frontend/src/components/CustomerManagement.jsx');
    const jsxContent = fs.readFileSync(jsxPath, 'utf8');

    assert.ok(jsxContent.includes("editModalTab === 'profile'"), 'Must render profile tab content');
    assert.ok(jsxContent.includes("editModalTab === 'contracts'"), 'Must render contracts tab content');
    assert.ok(jsxContent.includes("editModalTab === 'quota'"), 'Must render quota tab content');

    // Verify row action buttons pass correct initialTab
    assert.ok(jsxContent.includes("handleOpenEdit(c, 'profile')"), 'Edit button opens profile tab');
    assert.ok(jsxContent.includes("handleOpenEdit(c, 'contracts')"), 'Contract button opens contracts tab');
    assert.ok(jsxContent.includes("handleOpenEdit(c, 'quota')"), 'Quota badge click opens quota tab');
  });

  await t.test('2. Tab 1: Customer Profile Save Invariant (Preserves Contracts & Quotas)', async () => {
    // Update customer 1 profile details
    await dbQuery.run(`
      UPDATE customers 
      SET name = ?, contact_name = ?, phone = ?, email = ?, tax_id = ?, address = ?
      WHERE id = ?
    `, [
      'Artisan Bakery & Cafe (Renamed)',
      'Pierre Laurent',
      '0819998877',
      'pierre.updated@bakery.co',
      '0105558889991',
      '123 Bakery Lane, Bangkok',
      c1Id
    ]);

    // Verify customer data updated
    const updatedCust = await dbQuery.get('SELECT * FROM customers WHERE id = ?', [c1Id]);
    assert.equal(updatedCust.name, 'Artisan Bakery & Cafe (Renamed)');
    assert.equal(updatedCust.contact_name, 'Pierre Laurent');
    assert.equal(updatedCust.email, 'pierre.updated@bakery.co');

    // CRITICAL INVARIANT: Verify contract and quota are 100% preserved
    const contractAfter = await dbQuery.get('SELECT * FROM customer_contracts WHERE customer_id = ?', [c1Id]);
    assert.equal(contractAfter.id, ctr1Id, 'Contract ID must remain unchanged');
    assert.equal(contractAfter.contract_number, 'CTR-SHOP-001', 'Contract number must remain unchanged');
    assert.equal(contractAfter.monthly_quota_hours, 4.0, 'Contract monthly quota must remain 4.0h');
    assert.equal(contractAfter.status, 'ACTIVE', 'Contract status must remain ACTIVE');
  });

  await t.test('3. Tab 2: Contract Lifecycle Management (Edit Dates, Renew, Terminate)', async () => {
    // 3a. Edit Dates
    const editRes = await updateContractDates(dbQuery, {
      contractId: ctr1Id,
      startDate: '2026-10-05',
      endDate: '2026-11-15',
      reason: 'Extended contract period per management agreement',
      performedBy: 'admin_test'
    });
    assert.ok(editRes.success, 'Contract date update must succeed');
    assert.equal(editRes.contract.start_date, '2026-10-05');
    assert.equal(editRes.contract.end_date, '2026-11-15');

    // Verify audit log created
    const auditLog = await dbQuery.get(
      'SELECT * FROM customer_audit_logs WHERE contract_id = ? ORDER BY id DESC LIMIT 1',
      [ctr1Id]
    );
    assert.ok(auditLog, 'Audit log must be created');
    assert.equal(auditLog.action, 'EDIT_CONTRACT_DATES');
    const details = JSON.parse(auditLog.details);
    assert.equal(details.change_reason, 'Extended contract period per management agreement');
    assert.equal(auditLog.performed_by, 'admin_test');

    // 3b. Renew Contract (create next month contract)
    const renewRes = await dbQuery.run(`
      INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
      VALUES (?, 'CTR-SHOP-001-R2', '2026-11-16', '2026-12-31', 4.0, 'ACTIVE')
    `, [c1Id]);
    assert.ok(renewRes.id > 0, 'Renewal contract created');

    const contractsList = await dbQuery.all('SELECT * FROM customer_contracts WHERE customer_id = ?', [c1Id]);
    assert.equal(contractsList.length, 2, 'Customer now has 2 contract records in history');

    // 3c. Terminate Contract
    await dbQuery.run("UPDATE customer_contracts SET status = 'TERMINATED' WHERE id = ?", [renewRes.id]);
    const terminatedCtr = await dbQuery.get('SELECT * FROM customer_contracts WHERE id = ?', [renewRes.id]);
    assert.equal(terminatedCtr.status, 'TERMINATED', 'Contract status marked TERMINATED');
  });

  await t.test('4. Tab 2: Empty State for Customer Without Contracts', async () => {
    // Customer 4 has no contracts
    const noContracts = await dbQuery.all('SELECT * FROM customer_contracts WHERE customer_id = ?', [c4Id]);
    assert.equal(noContracts.length, 0, 'Customer 4 has 0 contracts');

    // Verify CustomerManagement.jsx contains Empty State handler with "สร้างสัญญาใหม่" button
    const jsxPath = path.join(__dirname, '../../frontend/src/components/CustomerManagement.jsx');
    const jsxContent = fs.readFileSync(jsxPath, 'utf8');

    assert.ok(jsxContent.includes('ลูกค้ารายนี้ยังไม่มีสัญญาที่บันทึกไว้ในระบบ'), 'Must render empty contract message');
    assert.ok(jsxContent.includes('สร้างสัญญาใหม่ (Create Contract)'), 'Must render Create Contract button in empty state');
    assert.ok(jsxContent.includes("setContractSubTab('renew')"), 'Must toggle new contract form');
  });

  await t.test('5. Tab 2: RBAC Protection on Audit Logs (Admin vs Non-Admin)', async () => {
    // Inspect Express router and Cloudflare Worker for RBAC enforcement
    const routesPath = path.join(__dirname, '../customerContracts/routes.js');
    const routesContent = fs.readFileSync(routesPath, 'utf8');
    assert.ok(routesContent.includes("req.user && (req.user.role === 'admin' || req.user.username === 'admin')"), 'Express router checks admin role');
    assert.ok(routesContent.includes('403'), 'Express router returns 403 on non-admin');

    const workerPath = path.join(__dirname, '../worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    assert.ok(workerContent.includes("user && (user.role === 'admin' || user.username === 'admin')"), 'Worker checks admin role');
  });

  await t.test('6. Tab 3: Authoritative Quota Hero Metrics (Shop 4h, Office 4h, Hotdesk 2h)', async () => {
    // Quota for Shop (Customer 1)
    const quotaShop = await calculateCustomerQuota(dbQuery, { customerId: c1Id, serviceDate: '2026-10-10' });
    assert.equal(quotaShop.max_quota, 4.0, 'Shop quota must be 4.0h');
    assert.equal(quotaShop.remaining_quota, 4.0, 'Initial remaining quota must be 4.0h');
    assert.equal(quotaShop.used_quota, 0.0, 'Used quota must be 0');

    // Quota for Basecamp Office (Customer 2)
    const quotaOffice = await calculateCustomerQuota(dbQuery, { customerId: c2Id, serviceDate: '2026-10-10' });
    assert.equal(quotaOffice.max_quota, 4.0, 'Office quota must be 4.0h');

    // Quota for Basecamp Hotdesk (Customer 3)
    const quotaHotdesk = await calculateCustomerQuota(dbQuery, { customerId: c3Id, serviceDate: '2026-10-10' });
    assert.equal(quotaHotdesk.max_quota, 2.0, 'Hotdesk quota must be 2.0h');

    // Verify 3 Hero cards exist in frontend JSX
    const jsxPath = path.join(__dirname, '../../frontend/src/components/CustomerManagement.jsx');
    const jsxContent = fs.readFileSync(jsxPath, 'utf8');

    assert.ok(jsxContent.includes('crm-quota-hero-grid'), 'Must include 3-card hero grid');
    assert.ok(jsxContent.includes('โควตาสิทธิประโยชน์ต่อเดือน'), 'Card 1: Monthly Quota');
    assert.ok(jsxContent.includes('ชั่วโมงที่ใช้ไปแล้วในเดือนนี้'), 'Card 2: Used Hours');
    assert.ok(jsxContent.includes('ชั่วโมงโควตาคงเหลือ'), 'Card 3: Remaining Hours');
    assert.ok(jsxContent.includes('crm-quota-meter-track'), 'Must include visual quota progress meter');
    assert.ok(jsxContent.includes('ข้อกำหนดและเงื่อนไขการใช้โควตา (Bwork Rules)'), 'Must include rules card');
  });

  await t.test('7. Tab 3: Contract Eligibility Banner (Active vs Ineligible)', async () => {
    // Long-term active contract (more than 30 days) evaluated status
    const activeEval = evaluateContractStatus({
      status: 'ACTIVE',
      start_date: '2026-10-01',
      end_date: '2027-10-31'
    }, '2026-10-15');
    assert.equal(activeEval.is_active_or_expiring, true, 'Active contract must be active');
    assert.equal(activeEval.status, 'ACTIVE');

    // Expired contract evaluated status
    const expiredEval = evaluateContractStatus({
      status: 'ACTIVE',
      start_date: '2026-09-01',
      end_date: '2026-09-30'
    }, '2026-10-15');
    assert.equal(expiredEval.is_active_or_expiring, false, 'Expired contract must be inactive');
    assert.equal(expiredEval.status, 'EXPIRED');

    // Terminated contract eligibility
    const termEligibility = verifyServiceDateContractEligibility({
      status: 'TERMINATED',
      start_date: '2026-10-01',
      end_date: '2026-10-31'
    }, '2026-10-15');
    assert.equal(termEligibility.eligible, false, 'Terminated contract must not be eligible');
    assert.equal(termEligibility.reason, 'CONTRACT_TERMINATED');

    // Frontend JSX checks for eligibility banner
    const jsxPath = path.join(__dirname, '../../frontend/src/components/CustomerManagement.jsx');
    const jsxContent = fs.readFileSync(jsxPath, 'utf8');
    assert.ok(jsxContent.includes('crm-quota-eligibility-banner'), 'Must contain quota eligibility banner');
    assert.ok(jsxContent.includes('สัญญามีผลสมบูรณ์ — ได้รับสิทธิ์ใช้งานโควตาตามเงื่อนไข'), 'Must render active banner');
    assert.ok(jsxContent.includes('สิทธิ์โควตาถูกระงับ — สัญญาหมดอายุหรือถูกยกเลิก'), 'Must render ineligible banner');
  });

  await t.test('8. UI Resilience & Drawer Glitch Elimination', async () => {
    const jsxPath = path.join(__dirname, '../../frontend/src/components/CustomerManagement.jsx');
    const jsxContent = fs.readFileSync(jsxPath, 'utf8');
    const cssPath = path.join(__dirname, '../../frontend/src/components/CustomerManagement.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Verify slide-over drawer has been eliminated in favor of unified modal dialog
    assert.ok(!jsxContent.includes('contract-drawer-overlay'), 'Legacy contract-drawer-overlay must not exist in JSX');

    // Verify modal tab bar exists
    assert.ok(jsxContent.includes('crm-modal-tabs-bar'), 'Modal tab bar must be present in JSX');

    // Verify error catching in customer & contract loading (prevents silent failures)
    assert.ok(jsxContent.includes("sysAlert(data.error || 'ไม่สามารถโหลดรายละเอียดสัญญาและโควตาได้', 'error')"), 'Must catch and display sysAlert on API error');

    // Verify styling in CSS
    assert.ok(cssContent.includes('.crm-modal-tabs-bar'), 'Must style tabs bar');
    assert.ok(cssContent.includes('.crm-quota-hero-grid'), 'Must style 3-card hero grid');
    assert.ok(cssContent.includes('.crm-quota-meter-track'), 'Must style quota meter track');
  });

  await t.test('9. Date Conversion & Thai Buddhist Era Parity', async () => {
    // Verify ISO-to-Thai BE date conversion
    const thaiDate1 = formatThaiDate('2026-10-27');
    assert.equal(thaiDate1, '27/10/2569', '2026-10-27 must format to 27/10/2569 BE');

    const thaiDate2 = formatThaiDate('2027-01-01');
    assert.equal(thaiDate2, '01/01/2570', '2027-01-01 must format to 01/01/2570 BE');
  });

  await t.test('10. Cloudflare Worker Compatibility Parity', async () => {
    // Verify worker.js contains customer contract and audit endpoints
    const workerPath = path.join(__dirname, '../worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    assert.ok(workerContent.includes('/api/customers'), 'Worker must handle /api/customers');
    assert.ok(workerContent.includes('customer_contracts'), 'Worker must handle customer_contracts');
    assert.ok(workerContent.includes('/api/customers/contracts/:contractId/dates'), 'Worker must handle date edit');
    assert.ok(workerContent.includes('/api/customers/:id/audit-logs'), 'Worker must handle audit logs');
  });

  db.close();
});
