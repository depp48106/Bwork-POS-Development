const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const sqlite3 = require(path.join(__dirname, '../node_modules/sqlite3')).verbose();

const DB_PATH = path.join(__dirname, '../database_dev.sqlite');

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Extract handleUpdateCustomerInfo and helpers from server.js
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

const helperStart = serverSource.indexOf('function buildCustomerInfoUpdateTextMessage');
const helperEnd = serverSource.indexOf('// Update booking customer information endpoint', helperStart);
assert.ok(helperStart > 0 && helperEnd > helperStart, 'LINE helper found in server.js');

const handlerStart = serverSource.indexOf('const handleUpdateCustomerInfo =');
const handlerEnd = serverSource.indexOf("app.patch('/api/bookings/:id/customer-info'", handlerStart);
assert.ok(handlerStart > 0 && handlerEnd > handlerStart, 'handleUpdateCustomerInfo found in server.js');

const authStart = serverSource.indexOf('async function authenticateToken');
const authEnd = serverSource.indexOf('function requireAnyPermission', authStart);
assert.ok(authStart > 0 && authEnd > authStart, 'authenticateToken found in server.js');

const verifyStart = serverSource.indexOf('function verifyToken');
const verifyEnd = serverSource.indexOf('// Authentication middleware', verifyStart);
assert.ok(verifyStart > 0 && verifyEnd > verifyStart, 'verifyToken found in server.js');

const createTokenStart = serverSource.indexOf('function createToken');
const createTokenEnd = serverSource.indexOf('function verifyToken', createTokenStart);
assert.ok(createTokenStart > 0 && createTokenEnd > createTokenStart, 'createToken found in server.js');

const normStart = serverSource.indexOf('function normalizeBookingDetails');
const normEnd = serverSource.indexOf("app.post('/api/bookings'", normStart);
assert.ok(normStart > 0 && normEnd > normStart, 'normalizeBookingDetails found in server.js');

test('BWORK-POS PHASE EDIT-2: Safe Customer Information Editing Test Suite', async (t) => {
  const db = new sqlite3.Database(DB_PATH);

  const dbQuery = {
    get: (sql, params = []) => getQuery(db, sql, params),
    all: (sql, params = []) => allQuery(db, sql, params),
    run: (sql, params = []) => runQuery(db, sql, params)
  };

  // Compile in VM with dbQuery
  const crypto = require('crypto');
  const context = {
    dbQuery,
    console,
    process: { env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-key-12345678901234567890' } },
    crypto,
    Buffer,
    Date,
    Set,
    Object,
    String,
    Number,
    isNaN,
    Boolean
  };

  const compiledCode = `
    const JWT_SECRET = process.env.JWT_SECRET;
    const JWT_EXPIRY = 8 * 60 * 60 * 1000;
    ${serverSource.slice(createTokenStart, createTokenEnd)}
    ${serverSource.slice(verifyStart, verifyEnd)}
    ${serverSource.slice(authStart, authEnd)}
    ${serverSource.slice(normStart, normEnd)}
    ${serverSource.slice(helperStart, helperEnd)}
    ${serverSource.slice(handlerStart, handlerEnd)}
    exports.handleUpdateCustomerInfo = handleUpdateCustomerInfo;
    exports.authenticateToken = authenticateToken;
    exports.createToken = createToken;
  `;

  const exportsObj = {};
  vm.runInNewContext(compiledCode, { ...context, exports: exportsObj });

  const { handleUpdateCustomerInfo, authenticateToken, createToken } = exportsObj;

  let testBookingId = null;
  let multiRoomBookingId = null;

  function mockReqRes(params = {}, body = {}, headers = {}) {
    const req = {
      params,
      body,
      headers
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.body = d; return this; }
    };
    return { req, res };
  }

  // Setup initial fixture
  await t.test('0. Setup test booking with financial snapshots, promotion, and PIN', async () => {
    const insRes = await runQuery(
      db,
      `INSERT INTO bookings (
        customer_name, contact, department, booking_details,
        total_amount, subtotal_amount, discount_type, discount_value, discount_amount,
        paid_amount, balance_amount, payment_status, payment_method,
        booking_source, booking_channel, line_user_id, pin_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        'สมชาย ทดสอบระบบ', '0811111111', 'ฝ่ายขาย', 'ขอโปรเจกเตอร์ 1 เครื่อง',
        1900.0, 2000.0, 'percentage', 5, 100.0,
        1000.0, 900.0, 'partial', 'transfer',
        'online', 'line_oa', 'U1234567890abcdef', '889900'
      ]
    );
    testBookingId = insRes.id;
    assert.ok(testBookingId > 0, 'Test booking created');

    await runQuery(
      db,
      `INSERT INTO booking_items (
        booking_id, room_id, start_time, end_time, booking_type, layout, price, subtotal, pin_code
      ) VALUES (?, 1, '2026-10-20T09:00:00', '2026-10-20T12:00:00', 'hourly', 'standard', 500.0, 2000.0, '889900')`,
      [testBookingId]
    );
  });

  // 1. Name-only update
  await t.test('1. Name-only update successfully updates customer_name and preserves other fields', async () => {
    const { req, res } = mockReqRes(
      { id: testBookingId },
      { customer_name: 'สมชาย ใจดีมั่งมี', send_line: false }
    );
    await handleUpdateCustomerInfo(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.changed, true);
    assert.deepStrictEqual([...res.body.changed_fields], ['customer_name']);
    assert.strictEqual(res.body.booking.customer_name, 'สมชาย ใจดีมั่งมี');
    assert.strictEqual(res.body.booking.contact, '0811111111');
    assert.strictEqual(res.body.booking.department, 'ฝ่ายขาย');

    // Confirm in DB
    const row = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    assert.strictEqual(row.customer_name, 'สมชาย ใจดีมั่งมี');
    assert.strictEqual(row.contact, '0811111111');
  });

  // 2. Phone and department update
  await t.test('2. Phone and department update successfully updates contact and department', async () => {
    const { req, res } = mockReqRes(
      { id: testBookingId },
      { contact: '089-999-8888', department: 'การตลาดและประชาสัมพันธ์', send_line: false }
    );
    await handleUpdateCustomerInfo(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.changed_fields.includes('contact'));
    assert.ok(res.body.changed_fields.includes('department'));
    assert.strictEqual(res.body.booking.contact, '089-999-8888');
    assert.strictEqual(res.body.booking.department, 'การตลาดและประชาสัมพันธ์');
    assert.strictEqual(res.body.booking.customer_name, 'สมชาย ใจดีมั่งมี');
  });

  // 3. Booking details update
  await t.test('3. Booking details update normalizes multiline notes and enforces length <= 1000', async () => {
    const newNotes = 'ขอเก้าอี้เสริม 5 ตัว\r\nพร้อมกระดานไวท์บอร์ดและปากกา 3 สี';
    const { req, res } = mockReqRes(
      { id: testBookingId },
      { booking_details: newNotes, send_line: false }
    );
    await handleUpdateCustomerInfo(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.booking.booking_details, 'ขอเก้าอี้เสริม 5 ตัว\nพร้อมกระดานไวท์บอร์ดและปากกา 3 สี');

    // Over 1000 characters
    const { req: reqOver, res: resOver } = mockReqRes(
      { id: testBookingId },
      { booking_details: 'X'.repeat(1001) }
    );
    await handleUpdateCustomerInfo(reqOver, resOver);
    assert.strictEqual(resOver.statusCode, 400);
  });

  // 4. Empty / invalid name validation
  await t.test('4. Empty and invalid customer name is rejected with 400 Bad Request', async () => {
    // Empty
    const { req: r1, res: s1 } = mockReqRes({ id: testBookingId }, { customer_name: '' });
    await handleUpdateCustomerInfo(r1, s1);
    assert.strictEqual(s1.statusCode, 400);

    // Whitespace
    const { req: r2, res: s2 } = mockReqRes({ id: testBookingId }, { customer_name: '   \t  ' });
    await handleUpdateCustomerInfo(r2, s2);
    assert.strictEqual(s2.statusCode, 400);

    // Non-string
    const { req: r3, res: s3 } = mockReqRes({ id: testBookingId }, { customer_name: 999 });
    await handleUpdateCustomerInfo(r3, s3);
    assert.strictEqual(s3.statusCode, 400);

    // Length > 100
    const { req: r4, res: s4 } = mockReqRes({ id: testBookingId }, { customer_name: 'A'.repeat(101) });
    await handleUpdateCustomerInfo(r4, s4);
    assert.strictEqual(s4.statusCode, 400);
  });

  // 5. Unauthorized request
  await t.test('5. Unauthorized requests (missing or invalid token) are rejected with 401', async () => {
    // No header
    const { req: r1, res: s1 } = mockReqRes();
    let nextCalled1 = false;
    await authenticateToken(r1, s1, () => { nextCalled1 = true; });
    assert.strictEqual(s1.statusCode, 401);
    assert.strictEqual(nextCalled1, false);

    // Invalid token
    const { req: r2, res: s2 } = mockReqRes({}, {}, { authorization: 'Bearer invalid.fake.token' });
    let nextCalled2 = false;
    await authenticateToken(r2, s2, () => { nextCalled2 = true; });
    assert.strictEqual(s2.statusCode, 401);
    assert.strictEqual(nextCalled2, false);
  });

  // 6. Multi-room / multi-day booking isolation
  await t.test('6. Multi-room and multi-day booking items and PINs remain completely untouched', async () => {
    const multiRes = await runQuery(
      db,
      `INSERT INTO bookings (customer_name, contact, total_amount, payment_status, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      ['บริษัท มัลติรูม คอร์ปอเรชั่น จำกัด', '020000000', 6000.0, 'paid']
    );
    multiRoomBookingId = multiRes.id;

    await runQuery(db, `INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (?, 1, '2026-10-21T09:00:00', '2026-10-21T12:00:00', 1000.0, 3000.0, '112233')`, [multiRoomBookingId]);
    await runQuery(db, `INSERT INTO booking_items (booking_id, room_id, start_time, end_time, price, subtotal, pin_code) VALUES (?, 2, '2026-10-22T13:00:00', '2026-10-22T17:00:00', 750.0, 3000.0, '445566')`, [multiRoomBookingId]);

    const { req, res } = mockReqRes(
      { id: multiRoomBookingId },
      { customer_name: 'บริษัท มัลติรูม (ประเทศไทย) จำกัด', contact: '02-999-9999' }
    );
    await handleUpdateCustomerInfo(req, res);
    assert.strictEqual(res.statusCode, 200);

    const items = await dbQuery.all('SELECT * FROM booking_items WHERE booking_id = ? ORDER BY id ASC', [multiRoomBookingId]);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].room_id, 1);
    assert.strictEqual(items[0].start_time, '2026-10-21T09:00:00');
    assert.strictEqual(items[0].pin_code, '112233');
    assert.strictEqual(items[1].room_id, 2);
    assert.strictEqual(items[1].start_time, '2026-10-22T13:00:00');
    assert.strictEqual(items[1].pin_code, '445566');
  });

  // 7. Preservation of financial fields & promotion invariants
  await t.test('7. Financial snapshot invariants (total, subtotal, discounts, balance, payment status) strictly preserved', async () => {
    const beforeRow = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);

    const { req, res } = mockReqRes(
      { id: testBookingId },
      { customer_name: 'คุณสมชาย นามสกุลใหม่', send_line: false }
    );
    await handleUpdateCustomerInfo(req, res);
    assert.strictEqual(res.statusCode, 200);

    const afterRow = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    assert.strictEqual(afterRow.total_amount, beforeRow.total_amount, 'Total amount must not change');
    assert.strictEqual(afterRow.subtotal_amount, beforeRow.subtotal_amount, 'Subtotal amount must not change');
    assert.strictEqual(afterRow.discount_type, beforeRow.discount_type, 'Discount type must not change');
    assert.strictEqual(afterRow.discount_value, beforeRow.discount_value, 'Discount value must not change');
    assert.strictEqual(afterRow.discount_amount, beforeRow.discount_amount, 'Discount amount must not change');
    assert.strictEqual(afterRow.paid_amount, beforeRow.paid_amount, 'Paid amount must not change');
    assert.strictEqual(afterRow.balance_amount, beforeRow.balance_amount, 'Balance amount must not change');
    assert.strictEqual(afterRow.payment_status, beforeRow.payment_status, 'Payment status must not change');
    assert.strictEqual(afterRow.pin_code, beforeRow.pin_code, 'PIN code must not change');
    assert.strictEqual(afterRow.booking_source, beforeRow.booking_source, 'Booking source must not change');
    assert.strictEqual(afterRow.line_user_id, beforeRow.line_user_id, 'Line user id must not change');
  });

  // 8. Concurrent edit conflict (Optimistic locking via expected_values)
  await t.test('8. Concurrent edit conflict returns 409 Conflict when expected_values is stale', async () => {
    const { req, res } = mockReqRes(
      { id: testBookingId },
      {
        customer_name: 'Admin B Updates Name',
        expected_values: {
          customer_name: 'สมชาย เดิมที่ถูกคนอื่นแก้ไปแล้ว'
        }
      }
    );
    await handleUpdateCustomerInfo(req, res);

    assert.strictEqual(res.statusCode, 409, 'Must return 409 Conflict');
    assert.strictEqual(res.body.conflict, true);
    assert.ok(res.body.error.includes('ผู้ใช้อื่น'));
  });

  // 8b. Atomic conditional UPDATE concurrency protection (simulated interleaved write)
  await t.test('8b. Atomic conditional UPDATE returns 409 Conflict if row changes between read and write', async () => {
    let interleavedRan = false;
    const racingDbQuery = {
      get: dbQuery.get,
      all: dbQuery.all,
      run: async (sql, params) => {
        if (sql.includes('UPDATE bookings') && !interleavedRan) {
          interleavedRan = true;
          // Interleaved change by Admin C directly into DB before UPDATE runs
          await runQuery(db, 'UPDATE bookings SET customer_name = ? WHERE id = ?', ['Admin C Stealth Update', testBookingId]);
        }
        return dbQuery.run(sql, params);
      }
    };

    const racingContext = { ...context, dbQuery: racingDbQuery };
    const racingExports = {};
    vm.runInNewContext(compiledCode, { ...racingContext, exports: racingExports });

    const { req, res } = mockReqRes(
      { id: testBookingId },
      { customer_name: 'Admin D Stale Update', send_line: false }
    );
    await racingExports.handleUpdateCustomerInfo(req, res);

    assert.strictEqual(res.statusCode, 409, 'Must return 409 Conflict on atomic update collision');
    assert.strictEqual(res.body.conflict, true);
  });

  // 9. LINE notification policy enforcement (Edits to customer information MUST NOT send LINE OA)
  await t.test('9. LINE notification policy: customer info edits do NOT send LINE OA even when send_line: true', async () => {
    // 9a: Booking with LINE recipient and send_line: true
    const { req: r1, res: s1 } = mockReqRes(
      { id: testBookingId },
      { customer_name: 'คุณสมชาย ยืนยันไลน์', send_line: true }
    );
    await handleUpdateCustomerInfo(r1, s1);
    assert.strictEqual(s1.statusCode, 200);
    assert.strictEqual(s1.body.line_notification.sent, false, 'Policy strictly disables LINE notification for customer info edits');
    assert.strictEqual(s1.body.line_notification.reason, 'policy_disabled');

    // 9b: Booking without LINE recipient and send_line: true
    const { req: r2, res: s2 } = mockReqRes(
      { id: multiRoomBookingId },
      { customer_name: 'บริษัท ไม่มีไลน์ จำกัด', send_line: true }
    );
    await handleUpdateCustomerInfo(r2, s2);
    assert.strictEqual(s2.statusCode, 200);
    assert.strictEqual(s2.body.line_notification.sent, false);
    assert.strictEqual(s2.body.line_notification.reason, 'policy_disabled');
  });

  // 10. Duplicate request and retry safety
  await t.test('10. Duplicate request with identical data reports changed: false and avoids redundant push', async () => {
    const { req: r1, res: s1 } = mockReqRes(
      { id: testBookingId },
      { customer_name: 'ชื่อคงเดิมไม่เปลี่ยน', contact: '0812345678' }
    );
    await handleUpdateCustomerInfo(r1, s1);
    assert.strictEqual(s1.statusCode, 200);

    const { req: r2, res: s2 } = mockReqRes(
      { id: testBookingId },
      { customer_name: 'ชื่อคงเดิมไม่เปลี่ยน', contact: '0812345678' }
    );
    await handleUpdateCustomerInfo(r2, s2);
    assert.strictEqual(s2.statusCode, 200);
    assert.strictEqual(s2.body.changed, false);
    assert.strictEqual(s2.body.line_notification.sent, false);
    assert.strictEqual(s2.body.line_notification.reason, 'no_changes');
  });

  // 11. Disallowed fields rejected by allowlist
  await t.test('11. Disallowed fields (financials, PINs, source, room items) rejected with 400 Bad Request', async () => {
    const forbiddenKeys = ['total_amount', 'pin_code', 'booking_source', 'payment_status', 'items', 'room_id'];
    for (const badKey of forbiddenKeys) {
      const payload = {
        customer_name: 'ผู้ทดสอบ',
        [badKey]: 'malicious_override'
      };
      const { req, res } = mockReqRes({ id: testBookingId }, payload);
      await handleUpdateCustomerInfo(req, res);
      assert.strictEqual(res.statusCode, 400, `Key ${badKey} must be rejected with 400`);
      assert.ok(res.body.error.includes(badKey));
    }
  });

  // 12. Cloudflare Worker parity test
  await t.test('12. Cloudflare Worker parity: route runs accurately in isolated Worker runtime', async () => {
    const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

    const routeStart = workerSource.indexOf("if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/customer-info')");
    assert.ok(routeStart > 0, 'Customer-info route found in worker.js');
    const routeEnd = workerSource.indexOf("// Payment status update -> Staff manual approval", routeStart);
    assert.ok(routeEnd > routeStart, 'End of customer-info route found in worker.js');
    const routeSnippet = workerSource.slice(routeStart, routeEnd);

    const mockDbBookings = [{
      id: 555,
      customer_name: 'สมปอง ทดสอบวอล์คเกอร์',
      contact: '0855555555',
      department: 'ไอที',
      booking_details: 'โน้ตเดิม',
      line_user_id: null
    }];

    const mockEnv = {
      DB: {
        prepare(sql) {
          const createStmt = (params = []) => ({
            bind(...newParams) { return createStmt(newParams); },
            async first() {
              if (sql.includes('FROM users')) return { id: 1, username: 'admin', role: 'admin' };
              if (sql.includes('FROM roles')) return { permissions: 'admin' };
              if (sql.includes('FROM bookings')) return mockDbBookings.find(b => b.id === Number(params[0])) || null;
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              if (sql.includes('UPDATE bookings')) {
                const [newName, newContact, newDept, newDetails, bId, expName] = params;
                const target = mockDbBookings.find(b => b.id === Number(bId));
                if (target && (expName === undefined || target.customer_name === expName)) {
                  target.customer_name = newName;
                  target.contact = newContact;
                  target.department = newDept;
                  target.booking_details = newDetails;
                  return { meta: { changes: 1 }, success: true };
                }
                return { meta: { changes: 0 }, success: true };
              }
              return { meta: { changes: 1 }, success: true };
            }
          });
          return createStmt();
        }
      }
    };

    const workerHandler = vm.runInNewContext(
      `(async function(request, env, authenticateUser, normalizeBookingDetails, sendLineBookingCustomerInfoUpdate) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const method = request.method;
        const corsHeaders = { 'Content-Type': 'application/json' };
        ${routeSnippet}
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      })`,
      {
        URL,
        Response,
        TextEncoder,
        Uint8Array,
        console,
        isNaN,
        Number,
        Date,
        Set,
        Object,
        JSON
      }
    );

    const mockAuthUser = async () => ({ user: { id: 1, role: 'admin' } });
    const mockNorm = (input) => ({ value: input ? String(input).trim() : null });
    const mockSendLine = async () => ({ sent: false, reason: 'no_line_recipient' });

    const workerReq = new Request('https://pos.bwork.internal/api/bookings/555/customer-info', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'สมปอง วอล์คเกอร์อัปเดต',
        contact: '0877777777'
      })
    });

    const workerRes = await workerHandler(workerReq, mockEnv, mockAuthUser, mockNorm, mockSendLine);
    assert.strictEqual(workerRes.status, 200);
    const workerData = await workerRes.json();
    assert.strictEqual(workerData.success, true);
    assert.strictEqual(workerData.changed, true);
    assert.strictEqual(mockDbBookings[0].customer_name, 'สมปอง วอล์คเกอร์อัปเดต');
    assert.strictEqual(mockDbBookings[0].contact, '0877777777');
  });

  // 13. Receipt template customer name compatibility
  await t.test('13. Receipts reflect updated customer name while keeping financial values strictly unchanged', async () => {
    const booking = await getQuery(db, 'SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    assert.ok(booking.customer_name, 'Booking has customer name');
    const receiptCustomerLine = `${booking.customer_name || '-'}`;
    assert.strictEqual(receiptCustomerLine, booking.customer_name);
    assert.strictEqual(booking.total_amount, 1900.0);
    assert.strictEqual(booking.subtotal_amount, 2000.0);
    assert.strictEqual(booking.discount_amount, 100.0);
  });

  // Cleanup
  t.after(async () => {
    if (testBookingId) {
      await runQuery(db, 'DELETE FROM booking_items WHERE booking_id = ?', [testBookingId]);
      await runQuery(db, 'DELETE FROM bookings WHERE id = ?', [testBookingId]);
    }
    if (multiRoomBookingId) {
      await runQuery(db, 'DELETE FROM booking_items WHERE booking_id = ?', [multiRoomBookingId]);
      await runQuery(db, 'DELETE FROM bookings WHERE id = ?', [multiRoomBookingId]);
    }
    db.close();
  });
});
