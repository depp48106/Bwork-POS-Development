const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sqlite3 = require('../node_modules/sqlite3');

test('Customer & Contract Schema Migration Tests', async (t) => {
  // Use in-memory SQLite database to test schema migration cleanly
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

  await t.test('1. Migration 011 SQL syntax and execution', async () => {
    const migrationFile = path.join(__dirname, '../migrations/011_add_customers_and_contracts.sql');
    assert.ok(fs.existsSync(migrationFile), '011_add_customers_and_contracts.sql must exist');
    const sql = fs.readFileSync(migrationFile, 'utf8');

    // Setup base bookings table
    await dbQuery.exec(`
      CREATE TABLE bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        customer_type TEXT DEFAULT 'walkin',
        basecamp_sub_type TEXT,
        basecamp_unit TEXT,
        quota_hours_used REAL DEFAULT 0,
        total_amount REAL NOT NULL,
        payment_status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert legacy booking record before migration
    await dbQuery.run(`
      INSERT INTO bookings (customer_name, customer_type, basecamp_sub_type, basecamp_unit, quota_hours_used, total_amount, payment_status)
      VALUES ('Legacy Tenant', 'basecamp', 'office', '401', 2.0, 0, 'paid');
    `);

    // Run migration SQL statements
    const { executeMigrationSql } = require('../migrator');
    await executeMigrationSql(dbQuery, sql);

    // Verify tables exist
    const tables = await dbQuery.all("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.map(r => r.name);
    assert.ok(tableNames.includes('customers'), 'customers table must exist');
    assert.ok(tableNames.includes('customer_contracts'), 'customer_contracts table must exist');
    assert.ok(tableNames.includes('customer_audit_logs'), 'customer_audit_logs table must exist');
  });

  await t.test('2. Table structure and column verification', async () => {
    const customerCols = await dbQuery.all("PRAGMA table_info(customers)");
    const customerColNames = customerCols.map(c => c.name);
    const expectedCustomerCols = [
      'id', 'customer_type', 'name', 'contact_name', 'phone', 'email',
      'tax_id', 'address', 'basecamp_sub_type', 'basecamp_unit', 'status',
      'created_at', 'updated_at'
    ];
    for (const col of expectedCustomerCols) {
      assert.ok(customerColNames.includes(col), `customers table must contain column: ${col}`);
    }

    const contractCols = await dbQuery.all("PRAGMA table_info(customer_contracts)");
    const contractColNames = contractCols.map(c => c.name);
    const expectedContractCols = [
      'id', 'customer_id', 'contract_number', 'start_date', 'end_date',
      'monthly_quota_hours', 'status', 'notes', 'created_at', 'updated_at'
    ];
    for (const col of expectedContractCols) {
      assert.ok(contractColNames.includes(col), `customer_contracts table must contain column: ${col}`);
    }

    const bookingCols = await dbQuery.all("PRAGMA table_info(bookings)");
    const bookingColNames = bookingCols.map(c => c.name);
    assert.ok(bookingColNames.includes('customer_id'), 'bookings must have customer_id column');
    assert.ok(bookingColNames.includes('contract_id'), 'bookings must have contract_id column');
  });

  await t.test('3. Legacy data preservation', async () => {
    const legacy = await dbQuery.get("SELECT * FROM bookings WHERE customer_name = 'Legacy Tenant'");
    assert.ok(legacy, 'Legacy booking record must be preserved');
    assert.equal(legacy.customer_id, null, 'Legacy booking customer_id must be null');
    assert.equal(legacy.contract_id, null, 'Legacy booking contract_id must be null');
    assert.equal(legacy.basecamp_unit, '401', 'Legacy basecamp unit preserved');
    assert.equal(legacy.quota_hours_used, 2.0, 'Legacy quota hours used preserved');
    assert.equal(legacy.payment_status, 'paid', 'Legacy payment status preserved');
  });

  await t.test('4. Insert and link customer and contract', async () => {
    // Insert Basecamp customer
    const cRes = await dbQuery.run(`
      INSERT INTO customers (customer_type, name, contact_name, phone, email, basecamp_sub_type, basecamp_unit, status)
      VALUES ('basecamp', 'Alpha Tech Co., Ltd.', 'John Doe', '0812345678', 'john@alphatech.com', 'office', '401', 'active')
    `);
    const customerId = cRes.id;
    assert.ok(customerId > 0, 'Customer ID should be positive integer');

    // Insert Contract for customer
    const ctrRes = await dbQuery.run(`
      INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
      VALUES (?, 'CTR-BC-401-2026', '2026-10-01', '2027-09-30', 4.0, 'ACTIVE')
    `, [customerId]);
    const contractId = ctrRes.id;
    assert.ok(contractId > 0, 'Contract ID should be positive integer');

    // Insert Shop customer with independent 4.0h quota
    const sRes = await dbQuery.run(`
      INSERT INTO customers (customer_type, name, contact_name, phone, email, status)
      VALUES ('shop', 'Koo.Koo Cafe', 'Jane Barista', '0898765432', 'contact@kookoo.cafe', 'active')
    `);
    const shopId = sRes.id;
    const sCtrRes = await dbQuery.run(`
      INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
      VALUES (?, 'CTR-SHOP-001', '2026-10-01', '2027-09-30', 4.0, 'ACTIVE')
    `, [shopId]);

    // Insert booking linked to customer and contract
    const bRes = await dbQuery.run(`
      INSERT INTO bookings (customer_name, customer_type, customer_id, contract_id, quota_hours_used, total_amount, payment_status)
      VALUES ('Koo.Koo Cafe', 'shop', ?, ?, 2.0, 0, 'paid')
    `, [shopId, sCtrRes.id]);
    assert.ok(bRes.id > 0, 'Linked booking inserted successfully');

    // Query joined booking
    const linked = await dbQuery.get(`
      SELECT b.id, b.customer_name, b.quota_hours_used, c.customer_type, ctr.contract_number, ctr.monthly_quota_hours
      FROM bookings b
      JOIN customers c ON b.customer_id = c.id
      JOIN customer_contracts ctr ON b.contract_id = ctr.id
      WHERE b.id = ?
    `, [bRes.id]);
    assert.equal(linked.customer_type, 'shop');
    assert.equal(linked.monthly_quota_hours, 4.0);
    assert.equal(linked.contract_number, 'CTR-SHOP-001');
  });

  await t.test('5. Customer audit log creation', async () => {
    await dbQuery.run(`
      INSERT INTO customer_audit_logs (customer_id, contract_id, action, details, performed_by)
      VALUES (1, 1, 'CREATE_CONTRACT', '{"monthly_quota_hours":4.0}', 'admin')
    `);
    const log = await dbQuery.get("SELECT * FROM customer_audit_logs WHERE customer_id = 1");
    assert.ok(log, 'Audit log must be created');
    assert.equal(log.action, 'CREATE_CONTRACT');
    assert.equal(log.performed_by, 'admin');
  });

  // Clean up
  db.close();
});
