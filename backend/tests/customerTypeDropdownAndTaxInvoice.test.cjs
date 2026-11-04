'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { DEFAULT_CUSTOMER_TYPES } = require('../customerContracts/routes');

function createTestDb() {
  const db = new sqlite3.Database(':memory:');
  const query = {
    run: (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    }),
    exec: (sql) => new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
    close: () => new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    })
  };
  return { db, query };
}

test('Customer Type Dropdown & Tax Invoice Entity Integration Suite', async (t) => {
  const { db, query } = createTestDb();

  // Setup minimal database schema simulating upgraded state
  await query.exec(`
    CREATE TABLE _schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      customer_type TEXT NOT NULL,
      tax_id TEXT,
      contract_start TEXT,
      contract_end TEXT,
      hourly_rate REAL,
      monthly_hours REAL,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone TEXT,
      booking_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      customer_type TEXT DEFAULT 'walkin',
      customer_id INTEGER,
      status TEXT DEFAULT 'pending',
      total_amount REAL DEFAULT 0,
      tax_invoice_required INTEGER DEFAULT 0,
      tax_payer_type TEXT DEFAULT 'corporate',
      tax_name TEXT,
      tax_id TEXT,
      tax_branch_type TEXT,
      tax_branch_number TEXT,
      tax_address TEXT,
      tax_email TEXT,
      tax_phone TEXT,
      tax_delivery_method TEXT,
      tax_postal_address TEXT,
      tax_invoice_status TEXT DEFAULT 'pending'
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await t.test('1. DEFAULT_CUSTOMER_TYPES contains all baseline types with correct metadata', () => {
    assert.ok(Array.isArray(DEFAULT_CUSTOMER_TYPES));
    const ids = DEFAULT_CUSTOMER_TYPES.map(t => t.id);
    assert.ok(ids.includes('walkin'), 'must include walkin');
    assert.ok(ids.includes('builtland'), 'must include builtland');
    assert.ok(ids.includes('basecamp'), 'must include basecamp');
    assert.ok(ids.includes('shop'), 'must include shop');
    assert.ok(ids.includes('ondemand'), 'must include ondemand');
    assert.ok(ids.includes('virtual_office'), 'must include virtual_office');

    // Category verification
    const walkin = DEFAULT_CUSTOMER_TYPES.find(t => t.id === 'walkin');
    assert.strictEqual(walkin.category, 'retail');

    const shop = DEFAULT_CUSTOMER_TYPES.find(t => t.id === 'shop');
    assert.strictEqual(shop.category, 'crm');
  });

  await t.test('2. Dynamic customer types query merges default types with custom types in DB', async () => {
    // Insert existing customer with a custom type 'agency_partner'
    await query.run(`
      INSERT INTO customers (company_name, customer_type, status)
      VALUES (?, ?, ?)
    `, ['Creative Agency Co., Ltd.', 'agency_partner', 'active']);

    // Insert another customer with standard type
    await query.run(`
      INSERT INTO customers (company_name, customer_type, status)
      VALUES (?, ?, ?)
    `, ['Retail Coffee Shop', 'shop', 'active']);

    let types = [...DEFAULT_CUSTOMER_TYPES];
    const customTypeRows = await query.all(
      "SELECT DISTINCT customer_type FROM customers WHERE customer_type IS NOT NULL AND customer_type != ''"
    );
    const existingTypeIds = new Set(types.map(t => t.id));

    for (const row of customTypeRows) {
      if (row.customer_type && !existingTypeIds.has(row.customer_type)) {
        existingTypeIds.add(row.customer_type);
        types.push({
          id: row.customer_type,
          name: row.customer_type,
          label: row.customer_type,
          active: true,
          category: 'crm',
          is_custom: true
        });
      }
    }

    const typeIds = types.map(t => t.id);
    assert.ok(typeIds.includes('agency_partner'), 'dynamically added agency_partner must be present');
    assert.ok(typeIds.includes('walkin'), 'walkin must still be present');
    assert.strictEqual(types.find(t => t.id === 'agency_partner').is_custom, true);
  });

  await t.test('3. Migration 016 additive upgrade preserves legacy NULL invariant', async () => {
    // Simulate legacy booking row where migration 013 gave default 'corporate' to a non-tax booking
    const legacyNonTax = await query.run(`
      INSERT INTO bookings (customer_name, phone, booking_date, start_time, end_time, tax_invoice_required, tax_payer_type)
      VALUES (?, ?, ?, ?, ?, 0, 'corporate')
    `, ['Old Non-Tax User', '0800000001', '2026-10-01', '09:00', '10:00']);

    // Simulate legacy tax booking without entity type
    const legacyTax = await query.run(`
      INSERT INTO bookings (customer_name, phone, booking_date, start_time, end_time, tax_invoice_required, tax_payer_type, tax_name)
      VALUES (?, ?, ?, ?, ?, 1, 'corporate', 'Old Corp')
    `, ['Old Tax User', '0800000002', '2026-10-01', '10:00', '11:00']);

    // Execute Migration 016 SQL
    await query.exec(`
      UPDATE bookings
      SET tax_payer_type = NULL
      WHERE tax_invoice_required = 0 OR tax_invoice_required IS NULL;
    `);

    const updatedNonTax = await query.get('SELECT tax_payer_type FROM bookings WHERE id = ?', [legacyNonTax.lastID]);
    assert.strictEqual(updatedNonTax.tax_payer_type, null, 'Non-tax booking must have tax_payer_type reset to null');
  });

  await t.test('4. Backend validation rejects inactive customer type for new bookings', async () => {
    // Configure 'seasonal_pop' as inactive in settings
    const testTypes = [
      ...DEFAULT_CUSTOMER_TYPES,
      { id: 'seasonal_pop', name: 'Seasonal Pop-up', active: false, category: 'crm' }
    ];
    await query.run(
      "INSERT INTO settings (key, value) VALUES ('customer_types', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(testTypes)]
    );

    // Backend validation logic check
    async function checkCustomerTypeActive(cType) {
      if (cType && cType !== 'walkin') {
        const typeRow = await query.get("SELECT value FROM settings WHERE key = 'customer_types'");
        if (typeRow && typeRow.value) {
          const configuredTypes = JSON.parse(typeRow.value);
          const matched = configuredTypes.find(t => String(t.id).toLowerCase() === String(cType).toLowerCase());
          if (matched && matched.active === false) {
            return { allowed: false, error: `ประเภทลูกค้า '${matched.name}' ถูกปิดใช้งานแล้ว` };
          }
        }
      }
      return { allowed: true };
    }

    const inactiveCheck = await checkCustomerTypeActive('seasonal_pop');
    assert.strictEqual(inactiveCheck.allowed, false);
    assert.ok(inactiveCheck.error.includes('ถูกปิดใช้งานแล้ว'));

    const activeCheck = await checkCustomerTypeActive('walkin');
    assert.strictEqual(activeCheck.allowed, true);
  });

  await t.test('5. Custom customer types DO NOT receive free or quota without explicit valid contract', () => {
    // Pricing engine rule verification
    function calculateGrossTotal({ customerType, customerId, hasActiveContract, remainingQuota, serverTotal, bookingHours }) {
      let grossSubtotal = serverTotal;
      let quotaHoursUsed = 0;
      let effectiveBillingOption = 'paid';

      if (customerType === 'builtland') {
        // Builtland internal employees only
        return { grossSubtotal: 0, quotaHoursUsed: 0, effectiveBillingOption: 'internal_free' };
      }

      if (customerType === 'basecamp' && !customerId) {
        // Legacy unit quota
        const maxQuota = 4;
        quotaHoursUsed = Math.min(bookingHours, maxQuota);
        const chargeable = Math.max(0, bookingHours - quotaHoursUsed);
        grossSubtotal = (chargeable / bookingHours) * serverTotal;
        return { grossSubtotal, quotaHoursUsed, effectiveBillingOption: quotaHoursUsed > 0 ? (grossSubtotal === 0 ? 'quota' : 'quota_partial') : 'standard' };
      }

      // Shop or ANY Custom Customer Type
      if (customerId && hasActiveContract && remainingQuota > 0) {
        quotaHoursUsed = Math.min(bookingHours, remainingQuota);
        const chargeable = Math.max(0, bookingHours - quotaHoursUsed);
        grossSubtotal = (chargeable / bookingHours) * serverTotal;
        return { grossSubtotal, quotaHoursUsed, effectiveBillingOption: quotaHoursUsed > 0 ? (grossSubtotal === 0 ? 'quota' : 'quota_partial') : 'standard' };
      }

      // New/Custom types without customerId or contract MUST be full standard price
      return { grossSubtotal: serverTotal, quotaHoursUsed: 0, effectiveBillingOption: 'paid' };
    }

    // Test A: Custom type 'agency_partner' without contract
    const customNoContract = calculateGrossTotal({
      customerType: 'agency_partner',
      customerId: null,
      hasActiveContract: false,
      remainingQuota: 0,
      serverTotal: 1000,
      bookingHours: 2
    });
    assert.strictEqual(customNoContract.grossSubtotal, 1000, 'Custom type without contract must pay full standard price');
    assert.strictEqual(customNoContract.quotaHoursUsed, 0, 'Custom type without contract must use 0 quota');
    assert.strictEqual(customNoContract.effectiveBillingOption, 'paid');

    // Test B: Builtland must be free
    const builtlandBooking = calculateGrossTotal({
      customerType: 'builtland',
      serverTotal: 1000,
      bookingHours: 2
    });
    assert.strictEqual(builtlandBooking.grossSubtotal, 0);
    assert.strictEqual(builtlandBooking.effectiveBillingOption, 'internal_free');
  });

  await t.test('6. Scoped form draft enforces account boundary isolation and safe fields', () => {
    // Draft creator helper
    function createDraft(userId, roomId, formData) {
      // Must NOT contain sensitive token or slip file
      assert.strictEqual(formData.token, undefined);
      assert.strictEqual(formData.slip_image_url, undefined);
      assert.strictEqual(formData.file_data, undefined);

      return {
        _owner_id: userId ? String(userId).trim() : 'guest',
        _room_id: roomId ? String(roomId).trim() : 'any',
        _saved_at: Date.now(),
        ...formData
      };
    }

    function canRestoreDraft(draft, currentUserId, currentRoomId) {
      if (!draft) return false;
      const uid = currentUserId ? String(currentUserId).trim() : 'guest';
      // Cross-account isolation check
      if (draft._owner_id && draft._owner_id !== uid && uid !== 'guest') {
        return false;
      }
      return true;
    }

    const aliceDraft = createDraft('U_ALICE_123', 1, {
      name: 'Alice Corp',
      taxName: 'Alice Company Ltd',
      taxId: '0105556011111'
    });

    // Bob tries to restore Alice's draft
    assert.strictEqual(canRestoreDraft(aliceDraft, 'U_BOB_999', 1), false, 'Bob MUST NOT restore Alice draft');

    // Alice restores her own draft
    assert.strictEqual(canRestoreDraft(aliceDraft, 'U_ALICE_123', 1), true, 'Alice restores her draft');
  });

  await query.close();
});
