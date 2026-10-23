const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { executeMigrationSql } = require('../migrator');
const {
  createTicket,
  listCustomerTickets,
  getCustomerTicketByNumber,
  addStaffMessage,
  getStaffTicketDetail,
  updateTicketStatus
} = require('../supportTickets/service');

function createDbQuery(db) {
  return {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, lastID: this.lastID, changes: this.changes });
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
}

test('Integration Safety Gate: Migrations 011 -> 012 with Existing Data', async () => {
  const db = new sqlite3.Database(':memory:');
  const dbQuery = createDbQuery(db);

  // 1. Initial base schema
  const schemaCore = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_core_schema.sql'), 'utf8');
  await executeMigrationSql(dbQuery, schemaCore);

  // Pre-existing bookings
  await dbQuery.run(`
    INSERT INTO bookings (customer_name, contact, total_amount, payment_status, created_at)
    VALUES ('Old Customer', '0812345678', 500, 'paid', '2026-10-01 10:00:00');
  `);

  // 2. Apply Migration 011
  const mig011 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '011_add_customers_and_contracts.sql'), 'utf8');
  await executeMigrationSql(dbQuery, mig011);

  // Insert customers, contracts, and audit logs
  await dbQuery.run(`
    INSERT INTO customers (customer_type, name, phone, basecamp_sub_type, basecamp_unit, status)
    VALUES ('basecamp', 'Tech Corp', '0899999999', 'office', '401', 'active');
  `);
  await dbQuery.run(`
    INSERT INTO customer_contracts (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status)
    VALUES (1, 'CTR-BC-401-202610', '2026-10-01', '2026-12-31', 4.0, 'ACTIVE');
  `);
  await dbQuery.run(`
    INSERT INTO customer_audit_logs (customer_id, contract_id, action, details, performed_by)
    VALUES (1, 1, 'CREATE_CONTRACT', 'Initial contract', 'admin');
  `);

  // Link booking to customer 1
  await dbQuery.run(`
    UPDATE bookings SET customer_id = 1, contract_id = 1, quota_hours_used = 2.0 WHERE id = 1;
  `);

  // 3. Apply Migration 012 (Support Tickets) via canonical executeMigrationSql
  const mig012 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '012_add_support_tickets.sql'), 'utf8');
  await executeMigrationSql(dbQuery, mig012);

  // 4. Verify existing data preserved
  const booking = await dbQuery.get('SELECT customer_name, customer_id, contract_id, quota_hours_used FROM bookings WHERE id = 1');
  assert.strictEqual(booking.customer_name, 'Old Customer');
  assert.strictEqual(booking.customer_id, 1);
  assert.strictEqual(booking.contract_id, 1);
  assert.strictEqual(booking.quota_hours_used, 2.0);

  const customer = await dbQuery.get('SELECT name, phone, basecamp_unit FROM customers WHERE id = 1');
  assert.strictEqual(customer.name, 'Tech Corp');
  assert.strictEqual(customer.basecamp_unit, '401');

  const contract = await dbQuery.get('SELECT contract_number, status FROM customer_contracts WHERE id = 1');
  assert.strictEqual(contract.contract_number, 'CTR-BC-401-202610');
  assert.strictEqual(contract.status, 'ACTIVE');

  // 5. Test Support Ticket Insertion with category 'other' and other_category
  await dbQuery.run(`
    INSERT INTO support_tickets (
      ticket_number, customer_id, customer_name, customer_phone,
      category, other_category, subject, description, priority, status
    ) VALUES (
      'TCK-20261021-0001', 1, 'Tech Corp', '0899999999',
      'other', 'ปัญหาแอร์เสียงดังผิดปกติ', 'แอร์มีเสียงดัง', 'แอร์ห้องประชุม 1 มีเสียงดังมาก', 'high', 'NEW'
    );
  `);

  const ticket = await dbQuery.get('SELECT ticket_number, customer_id, category, other_category FROM support_tickets WHERE id = 1');
  assert.strictEqual(ticket.ticket_number, 'TCK-20261021-0001');
  assert.strictEqual(ticket.customer_id, 1);
  assert.strictEqual(ticket.category, 'other');
  assert.strictEqual(ticket.other_category, 'ปัญหาแอร์เสียงดังผิดปกติ');

  // 6. Test Idempotency: Re-applying migration 012 does not fail or overwrite data
  await assert.doesNotReject(async () => {
    await executeMigrationSql(dbQuery, mig012);
  });
});

test('Integration Safety Gate: Support Ticket Ownership, IDOR, & Privacy Filtering', async () => {
  const db = new sqlite3.Database(':memory:');
  const dbQuery = createDbQuery(db);

  // Setup schema
  await executeMigrationSql(dbQuery, fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_core_schema.sql'), 'utf8'));
  await executeMigrationSql(dbQuery, fs.readFileSync(path.join(__dirname, '..', 'migrations', '011_add_customers_and_contracts.sql'), 'utf8'));
  await executeMigrationSql(dbQuery, fs.readFileSync(path.join(__dirname, '..', 'migrations', '012_add_support_tickets.sql'), 'utf8'));

  // Create ticket for Customer A
  const ticketA = await createTicket(dbQuery, {
    customer_name: 'Customer A',
    customer_phone: '0811111111',
    line_user_id: 'U_LINE_A',
    category: 'booking',
    subject: 'Cannot book room',
    description: 'Booking button fails'
  });

  // Create ticket for Customer B
  const ticketB = await createTicket(dbQuery, {
    customer_name: 'Customer B',
    customer_phone: '0822222222',
    line_user_id: 'U_LINE_B',
    category: 'facility',
    subject: 'Light broken',
    description: 'Bulb broken in room 2'
  });

  // Staff adds 1 public message and 1 internal note to Ticket A
  await addStaffMessage(dbQuery, ticketA.ticket_id, {
    staff_user: 'reception01',
    message: 'Hello Customer A, we are looking into this.',
    visibility: 'public'
  });
  await addStaffMessage(dbQuery, ticketA.ticket_id, {
    staff_user: 'manager01',
    message: 'INTERNAL NOTE: Tech team check database connection.',
    visibility: 'internal'
  });

  // 1. IDOR Check 1: Customer B lists by their token, must NOT see Ticket A
  const customerBList = await listCustomerTickets(dbQuery, { ticketTokens: [ticketB.access_token] });
  assert.strictEqual(customerBList.length, 1);
  assert.strictEqual(customerBList[0].ticket_number, ticketB.ticket_number);

  // 2. IDOR Check 2: Customer B attempts to view Ticket A with Customer B token -> Rejected with 403
  await assert.rejects(
    async () => {
      await getCustomerTicketByNumber(dbQuery, ticketA.ticket_number, { ticketToken: ticketB.access_token });
    },
    (err) => {
      assert.strictEqual(err.status, 403);
      assert.match(err.message, /ท่านไม่มีสิทธิ์เข้าถึง Ticket นี้/);
      return true;
    }
  );

  // 3. Authorized View: Customer A views Ticket A with Customer A token -> Allowed
  const customerATicketDetail = await getCustomerTicketByNumber(dbQuery, ticketA.ticket_number, { ticketToken: ticketA.access_token });
  assert.strictEqual(customerATicketDetail.ticket.ticket_number, ticketA.ticket_number);
  assert.strictEqual(customerATicketDetail.messages.length, 2); // 1 initial description + 1 staff public reply
  assert.strictEqual(customerATicketDetail.messages.some(m => m.message === 'Hello Customer A, we are looking into this.'), true);
  // Zero internal messages leaked to customer
  assert.strictEqual(customerATicketDetail.messages.some(m => m.visibility === 'internal'), false);

  // 4. Staff views Ticket A detail, must see both public and internal notes
  const staffTicketDetail = await getStaffTicketDetail(dbQuery, ticketA.ticket_id, 'manager01');
  assert.strictEqual(staffTicketDetail.messages.length, 3); // 1 initial + 1 public + 1 internal
  assert.strictEqual(staffTicketDetail.messages.some(m => m.visibility === 'internal'), true);
});
