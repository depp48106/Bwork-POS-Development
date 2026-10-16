const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sqlite3 = require('../node_modules/sqlite3');
const { executeMigrationSql } = require('../migrator');
const {
  getBangkokDateToday,
  calculateDaysDifference,
  evaluateContractStatus,
  verifyServiceDateContractEligibility,
  calculateCustomerQuota,
  getContractAlerts
} = require('../customerContracts/service');

test('Customer, Shop & Contract Quota API Engine Tests', async (t) => {
  // Setup in-memory SQLite database
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

  // Initialize schema with bookings, booking_items, rooms, and migration 011
  await dbQuery.exec(`
    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hourly_rate REAL NOT NULL
    );

    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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

  // Seed sample room
  await dbQuery.run("INSERT INTO rooms (name, hourly_rate) VALUES ('Room 1', 500)");

  let basecampCustomerId, basecampContractId;
  let shopACustomerId, shopAContractId;
  let shopBCustomerId, shopBContractId;

  await t.test('1. Basecamp Quota Allocation (Office = 4h, Hotdesk = 2h)', async () => {
    // Office customer
    const cRes = await dbQuery.run(`
      INSERT INTO customers (customer_type, name, contact_name, basecamp_sub_type, basecamp_unit, status)
      VALUES ('basecamp', 'Alpha Office Co.', 'Alice', 'office', '401', 'active')
    `);
    basecampCustomerId = cRes.id;

    const ctrRes = await dbQuery.run(`
      INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
      VALUES (?, 'CTR-BC-401-202610', '2026-10-01', '2026-10-31', 4.0, 'ACTIVE')
    `, [basecampCustomerId]);
    basecampContractId = ctrRes.id;

    const quotaOffice = await calculateCustomerQuota(dbQuery, {
      customerId: basecampCustomerId,
      serviceDate: '2026-10-15'
    });
    assert.equal(quotaOffice.max_quota, 4.0, 'Office max quota must be 4.0h');
    assert.equal(quotaOffice.remaining_quota, 4.0, 'New office customer remaining quota must be 4.0h');
    assert.equal(quotaOffice.used_quota, 0, 'No used quota initially');

    // Hotdesk customer
    const hdRes = await dbQuery.run(`
      INSERT INTO customers (customer_type, name, basecamp_sub_type, basecamp_unit, status)
      VALUES ('basecamp', 'Hotdesk Freelancer', 'hotdesk', '419', 'active')
    `);
    await dbQuery.run(`
      INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
      VALUES (?, 'CTR-BC-419-202610', '2026-10-01', '2026-10-31', 2.0, 'ACTIVE')
    `, [hdRes.id]);

    const quotaHd = await calculateCustomerQuota(dbQuery, {
      customerId: hdRes.id,
      serviceDate: '2026-10-15'
    });
    assert.equal(quotaHd.max_quota, 2.0, 'Hotdesk max quota must be 2.0h');
    assert.equal(quotaHd.remaining_quota, 2.0, 'Hotdesk remaining quota must be 2.0h');
  });

  await t.test('2. Shop Quota Allocation and Pool Isolation', async () => {
    // Shop A: Koo.Koo Cafe
    const saRes = await dbQuery.run(`
      INSERT INTO customers (customer_type, name, contact_name, status)
      VALUES ('shop', 'Koo.Koo Cafe', 'Jane', 'active')
    `);
    shopACustomerId = saRes.id;
    const saCtr = await dbQuery.run(`
      INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
      VALUES (?, 'CTR-SHOP-A', '2026-10-01', '2026-10-31', 4.0, 'ACTIVE')
    `, [shopACustomerId]);
    shopAContractId = saCtr.id;

    // Shop B: Bwork Bookshop
    const sbRes = await dbQuery.run(`
      INSERT INTO customers (customer_type, name, contact_name, status)
      VALUES ('shop', 'Bwork Bookshop', 'Bob', 'active')
    `);
    shopBCustomerId = sbRes.id;
    const sbCtr = await dbQuery.run(`
      INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
      VALUES (?, 'CTR-SHOP-B', '2026-10-01', '2026-10-31', 4.0, 'ACTIVE')
    `, [shopBCustomerId]);
    shopBContractId = sbCtr.id;

    // Both shops should have independent 4.0h quota
    const quotaA1 = await calculateCustomerQuota(dbQuery, { customerId: shopACustomerId, serviceDate: '2026-10-15' });
    const quotaB1 = await calculateCustomerQuota(dbQuery, { customerId: shopBCustomerId, serviceDate: '2026-10-15' });
    assert.equal(quotaA1.remaining_quota, 4.0);
    assert.equal(quotaB1.remaining_quota, 4.0);

    // Shop A uses 3.0 hours
    const bA = await dbQuery.run(`
      INSERT INTO bookings (customer_name, customer_type, customer_id, contract_id, quota_hours_used, total_amount, payment_status, billing_option, created_at)
      VALUES ('Koo.Koo Cafe', 'shop', ?, ?, 3.0, 0, 'paid', 'quota', '2026-10-10 10:00:00')
    `, [shopACustomerId, shopAContractId]);
    await dbQuery.run(`
      INSERT INTO booking_items (booking_id, room_id, start_time, end_time, subtotal)
      VALUES (?, 1, '2026-10-10 10:00:00', '2026-10-10 13:00:00', 0)
    `, [bA.id]);

    // Check Shop A vs Shop B vs Basecamp
    const quotaA2 = await calculateCustomerQuota(dbQuery, { customerId: shopACustomerId, serviceDate: '2026-10-15' });
    const quotaB2 = await calculateCustomerQuota(dbQuery, { customerId: shopBCustomerId, serviceDate: '2026-10-15' });
    const quotaBC = await calculateCustomerQuota(dbQuery, { customerId: basecampCustomerId, serviceDate: '2026-10-15' });

    assert.equal(quotaA2.used_quota, 3.0, 'Shop A used quota should be 3.0h');
    assert.equal(quotaA2.remaining_quota, 1.0, 'Shop A remaining quota should be 1.0h');
    assert.equal(quotaB2.used_quota, 0.0, 'Shop B quota should remain 0h used (isolation)');
    assert.equal(quotaB2.remaining_quota, 4.0, 'Shop B remaining quota should remain 4.0h (isolation)');
    assert.equal(quotaBC.remaining_quota, 4.0, 'Basecamp quota untouched by shop usage');
  });

  await t.test('3. Name Change Invariance (Editing shop name does not reset quota)', async () => {
    // Edit Shop A name to "Koo.Koo Specialty Cafe & Bakery"
    await dbQuery.run(
      'UPDATE customers SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['Koo.Koo Specialty Cafe & Bakery', shopACustomerId]
    );

    // Re-verify quota for Shop A
    const quotaAAfterRename = await calculateCustomerQuota(dbQuery, { customerId: shopACustomerId, serviceDate: '2026-10-15' });
    assert.equal(quotaAAfterRename.customer_name, 'Koo.Koo Specialty Cafe & Bakery');
    assert.equal(quotaAAfterRename.used_quota, 3.0, 'Used quota must still be 3.0h after rename');
    assert.equal(quotaAAfterRename.remaining_quota, 1.0, 'Remaining quota must still be 1.0h after rename');
  });

  await t.test('4. Tenant Transfer Isolation (Unit 401 change preserves old history and isolates new tenant)', async () => {
    // Office 401 uses 2.0 hours
    const bBC = await dbQuery.run(`
      INSERT INTO bookings (customer_name, customer_type, customer_id, contract_id, basecamp_sub_type, basecamp_unit, quota_hours_used, total_amount, payment_status, billing_option, created_at)
      VALUES ('Alpha Office Co.', 'basecamp', ?, ?, 'office', '401', 2.0, 0, 'paid', 'quota', '2026-10-05 10:00:00')
    `, [basecampCustomerId, basecampContractId]);
    await dbQuery.run(`
      INSERT INTO booking_items (booking_id, room_id, start_time, end_time, subtotal)
      VALUES (?, 1, '2026-10-05 10:00:00', '2026-10-05 12:00:00', 0)
    `, [bBC.id]);

    // Deactivate old tenant of 401
    await dbQuery.run("UPDATE customers SET status = 'inactive' WHERE id = ?", [basecampCustomerId]);
    await dbQuery.run("UPDATE customer_contracts SET status = 'TERMINATED' WHERE id = ?", [basecampContractId]);

    // Create new tenant for unit 401: "Beta Cloud Solutions"
    const newTenantRes = await dbQuery.run(`
      INSERT INTO customers (customer_type, name, contact_name, basecamp_sub_type, basecamp_unit, status)
      VALUES ('basecamp', 'Beta Cloud Solutions', 'Bob Cloud', 'office', '401', 'active')
    `);
    const newTenantId = newTenantRes.id;
    const newContractRes = await dbQuery.run(`
      INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
      VALUES (?, 'CTR-BC-401-NEW', '2026-10-16', '2027-10-15', 4.0, 'ACTIVE')
    `, [newTenantId]);

    // Check old tenant quota
    const oldQuota = await calculateCustomerQuota(dbQuery, { customerId: basecampCustomerId, serviceDate: '2026-10-10' });
    assert.equal(oldQuota.used_quota, 2.0, 'Old tenant preserves its 2.0h used history');

    // Check new tenant quota: must start clean with 0 used, 4.0 remaining
    const newQuota = await calculateCustomerQuota(dbQuery, { customerId: newTenantId, serviceDate: '2026-10-20' });
    assert.equal(newQuota.used_quota, 0.0, 'New tenant starts with 0.0h used quota');
    assert.equal(newQuota.remaining_quota, 4.0, 'New tenant gets fresh 4.0h quota');
  });

  await t.test('5. Post-Expiration Service Date Policy Enforcement', async () => {
    // Shop B contract ends on 2026-10-31
    // Booking within contract: 2026-10-25 -> eligible
    const eligibleCheck = await calculateCustomerQuota(dbQuery, {
      customerId: shopBCustomerId,
      serviceDate: '2026-10-25'
    });
    assert.equal(eligibleCheck.contract_eligible, true, 'Booking within contract must be eligible');
    assert.equal(eligibleCheck.remaining_quota, 4.0, 'Full quota available within contract');

    // Booking after contract expiration: 2026-11-05 (contract ended 2026-10-31)
    const expiredCheck = await calculateCustomerQuota(dbQuery, {
      customerId: shopBCustomerId,
      serviceDate: '2026-11-05'
    });
    assert.equal(expiredCheck.contract_eligible, false, 'Service date after contract expiration must NOT be eligible');
    assert.equal(expiredCheck.ineligibility_reason, 'SERVICE_DATE_AFTER_CONTRACT_EXPIRATION');
    assert.equal(expiredCheck.remaining_quota, 0, 'No free quota permitted for post-expiration service date');
  });

  await t.test('6. Dashboard Contract Expiry Alerts (30, 15, 7 days, expired)', async () => {
    // Setup 4 contracts with various end dates relative to today 2026-10-16
    // 1. Expired (-5 days): end_date = 2026-10-11
    // 2. Urgent / Danger (5 days left): end_date = 2026-10-21
    // 3. Warning (12 days left): end_date = 2026-10-28
    // 4. Info (25 days left): end_date = 2026-11-10
    // 5. Active (>30 days): end_date = 2026-12-31

    const baseDate = '2026-10-16';

    const c1 = await dbQuery.run("INSERT INTO customers (customer_type, name, status) VALUES ('shop', 'Expired Shop', 'active')");
    await dbQuery.run("INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status) VALUES (?, 'CTR-EXP', '2025-10-01', '2026-10-11', 4.0, 'ACTIVE')", [c1.id]);

    const c2 = await dbQuery.run("INSERT INTO customers (customer_type, name, status) VALUES ('shop', 'Danger 5d Shop', 'active')");
    await dbQuery.run("INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status) VALUES (?, 'CTR-DNG', '2025-10-01', '2026-10-21', 4.0, 'ACTIVE')", [c2.id]);

    const c3 = await dbQuery.run("INSERT INTO customers (customer_type, name, status) VALUES ('shop', 'Warning 12d Shop', 'active')");
    await dbQuery.run("INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status) VALUES (?, 'CTR-WRN', '2025-10-01', '2026-10-28', 4.0, 'ACTIVE')", [c3.id]);

    const c4 = await dbQuery.run("INSERT INTO customers (customer_type, name, status) VALUES ('shop', 'Info 25d Shop', 'active')");
    await dbQuery.run("INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status) VALUES (?, 'CTR-INF', '2025-10-01', '2026-11-10', 4.0, 'ACTIVE')", [c4.id]);

    const alertsResult = await getContractAlerts(dbQuery, baseDate);
    assert.ok(alertsResult.summary.expired >= 1, 'Must detect at least 1 expired contract');
    assert.ok(alertsResult.summary.expiring_7_days >= 1, 'Must detect danger (<=7 days)');
    assert.ok(alertsResult.summary.expiring_15_days >= 1, 'Must detect warning (8-15 days)');
    assert.ok(alertsResult.summary.expiring_30_days >= 1, 'Must detect info (16-30 days)');

    const dangerAlert = alertsResult.alerts.find(a => a.contract_number === 'CTR-DNG');
    assert.ok(dangerAlert);
    assert.equal(dangerAlert.days_left, 5);
    assert.equal(dangerAlert.urgency, 'danger');

    const warningAlert = alertsResult.alerts.find(a => a.contract_number === 'CTR-WRN');
    assert.ok(warningAlert);
    assert.equal(warningAlert.days_left, 12);
    assert.equal(warningAlert.urgency, 'warning');

    const expiredAlert = alertsResult.alerts.find(a => a.contract_number === 'CTR-EXP');
    assert.ok(expiredAlert);
    assert.equal(expiredAlert.status, 'EXPIRED');
    assert.equal(expiredAlert.urgency, 'expired');
  });

  await t.test('7. Cancellation Quota Restoration', async () => {
    // Customer with 4h quota creates 2h booking
    const cTest = await dbQuery.run("INSERT INTO customers (customer_type, name, status) VALUES ('shop', 'Cancel Test Shop', 'active')");
    const ctrTest = await dbQuery.run("INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status) VALUES (?, 'CTR-CAN', '2026-10-01', '2026-10-31', 4.0, 'ACTIVE')", [cTest.id]);

    const b = await dbQuery.run(`
      INSERT INTO bookings (customer_name, customer_type, customer_id, contract_id, quota_hours_used, total_amount, payment_status, billing_option, created_at)
      VALUES ('Cancel Test Shop', 'shop', ?, ?, 2.0, 0, 'paid', 'quota', '2026-10-15 10:00:00')
    `, [cTest.id, ctrTest.id]);
    await dbQuery.run(`
      INSERT INTO booking_items (booking_id, room_id, start_time, end_time, subtotal)
      VALUES (?, 1, '2026-10-15 10:00:00', '2026-10-15 12:00:00', 0)
    `, [b.id]);

    let q = await calculateCustomerQuota(dbQuery, { customerId: cTest.id, serviceDate: '2026-10-15' });
    assert.equal(q.used_quota, 2.0);
    assert.equal(q.remaining_quota, 2.0);

    // Cancel the booking
    await dbQuery.run("UPDATE bookings SET payment_status = 'cancelled' WHERE id = ?", [b.id]);

    q = await calculateCustomerQuota(dbQuery, { customerId: cTest.id, serviceDate: '2026-10-15' });
    assert.equal(q.used_quota, 0.0, 'Quota restored to 0 used after cancellation');
    assert.equal(q.remaining_quota, 4.0, 'Full 4.0h available after cancellation');
  });

  await t.test('8. Express and Worker Quota Parity Check', async () => {
    // Verify server.js and worker.js both contain the required API routes and handlers
    const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const workerCode = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

    assert.ok(serverCode.includes("app.use('/api/customers'"), 'server.js must mount /api/customers');
    assert.ok(serverCode.includes("customer_type === 'shop'"), 'server.js must support customer_type shop');
    assert.ok(serverCode.includes('customer_id, contract_id'), 'server.js must store customer_id and contract_id');

    assert.ok(workerCode.includes("pathname.startsWith('/api/customers')"), 'worker.js must route /api/customers');
    assert.ok(workerCode.includes("pathname === '/api/customers/contracts/alerts'"), 'worker.js must have contract alerts endpoint');
    assert.ok(workerCode.includes("customer_type === 'shop'"), 'worker.js must support customer_type shop');
    assert.ok(workerCode.includes('customer_id, contract_id'), 'worker.js must store customer_id and contract_id');
  });

  db.close();
});
