const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');

// Locate GET /api/public/bookings/:id in worker.js
const routeStart = workerSource.indexOf("      if (pathname.startsWith('/api/public/bookings/') && method === 'GET')");
const routeEnd = workerSource.indexOf("      if (pathname === '/api/public/bookings' && method === 'POST')", routeStart);

assert.ok(routeStart >= 0 && routeEnd > routeStart, 'Failed to locate GET /api/public/bookings/:id route in worker.js');

const routeCode = workerSource.slice(routeStart, routeEnd);

// Compile route runner in isolated VM matching Cloudflare Worker environment
const workerGetBookingRoute = vm.runInNewContext(
  '(async function(request, env) { ' +
  'const url = new URL(request.url); ' +
  'const pathname = url.pathname; ' +
  'const method = request.method; ' +
  'const corsHeaders = { "Content-Type": "application/json" };\n' +
  routeCode + '\n})',
  { URL, Response, TextEncoder, Uint8Array, crypto: webcrypto, console, isNaN, Number, parseInt, Date }
);

function createMockEnv(mockBookings, mockItems = {}, mockRejections = {}) {
  return {
    DB: {
      prepare(sql) {
        const createStatement = (params = []) => ({
          bind(...newParams) {
            return createStatement(newParams);
          },
          async first() {
            if (sql.includes('FROM settings WHERE key')) {
              return { value: '15' };
            }
            if (sql.includes('FROM slip_verifications')) {
              const bookingId = params[0];
              return mockRejections[bookingId] || null;
            }
            if (sql.includes('FROM bookings WHERE')) {
              const idOrCode = params[0];
              const rawCode = params[1];
              return mockBookings.find(b =>
                b.id === idOrCode ||
                b.receipt_number === rawCode ||
                (b.receipt_number && b.receipt_number.toUpperCase() === String(rawCode).toUpperCase())
              ) || null;
            }
            return null;
          },
          async all() {
            if (sql.includes('FROM booking_items')) {
              const bookingId = params[0];
              return { results: mockItems[bookingId] || [] };
            }
            return { results: [] };
          },
          async run() {
            throw new Error('READ-ONLY GET ROUTE MUST NEVER CALL DB.run()');
          }
        });
        return createStatement();
      }
    }
  };
}

const sampleBooking = {
  id: 101,
  receipt_number: 'BK-000101',
  customer_name: 'คุณสมศักดิ์ มั่งมี',
  contact: '0812345678',
  total_amount: 500,
  payment_status: 'pending',
  qr_token: 'secret-valid-token-12345',
  pin_code: '9876',
  line_user_id: 'U1234567890abcdef',
  slip_trans_ref: 'TRANS-REF-PRIVATE',
  slip_image_url: 'https://r2.bwork.invalid/slip101.jpg',
  customer_email: 'somsak@example.com',
  tax_name: 'บริษัท แอบแฝง จำกัด',
  tax_id: '0105559999999',
  tax_phone: '0812345678',
  tax_address: '123 Private Road',
  tax_delivery_method: 'email',
  tax_postal_address: '123 Private Road',
  internal_department: 'SECRET_INTERNAL_DEPT',
  created_at: '2026-09-09T14:00:00.000Z'
};

const sampleItems = {
  101: [{
    id: 201,
    booking_id: 101,
    room_id: 4,
    room_name: 'Mars (301)',
    capacity: 6,
    image_url: '/mars.jpg',
    description: 'ห้องประชุมขนาดกลาง',
    start_time: '2026-09-09T15:00:00',
    end_time: '2026-09-09T16:00:00',
    pin_code: '9876'
  }]
};

// ============================================================================
// 16 REQUIRED WORKER AUTHORIZATION PARITY TESTS
// ============================================================================

test('Worker Auth Parity 1: No credential returns HTTP 403', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET'
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'กรุณายืนยันเบอร์โทรศัพท์หรือสิทธิ์เข้าถึงรายการจอง');
});

test('Worker Auth Parity 2: Wrong contact returns HTTP 403', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Contact': '0999999999' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'กรุณายืนยันเบอร์โทรศัพท์หรือสิทธิ์เข้าถึงรายการจอง');
});

test('Worker Auth Parity 3: Correct X-Booking-Contact returns HTTP 200', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Contact': '0812345678' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.id, 101);
  assert.equal(data.bookingCode, 'BK-000101');
  assert.equal(data.room?.name, 'Mars (301)');
});

test('Worker Auth Parity 4: Correct X-Booking-Token returns HTTP 200', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Token': 'secret-valid-token-12345' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.id, 101);
  assert.equal(data.bookingCode, 'BK-000101');
});

test('Worker Auth Parity 5: Contact is NOT required in URL query', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const url = 'https://worker.bwork.invalid/api/public/bookings/101';
  assert.ok(!url.includes('contact='), 'URL must not contain contact');
  const req = new Request(url, {
    method: 'GET',
    headers: { 'X-Booking-Contact': '081-234-5678' } // punctuation normalized
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
});

test('Worker Auth Parity 6: Token is NOT required in URL query', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const url = 'https://worker.bwork.invalid/api/public/bookings/101';
  assert.ok(!url.includes('token='), 'URL must not contain token');
  const req = new Request(url, {
    method: 'GET',
    headers: { 'X-Booking-Token': 'secret-valid-token-12345' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
});

test('Worker Auth Parity 7: ID-only request CANNOT return booking (blocked by 403)', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET'
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 403, 'Must never return 200 on ID-only access');
});

test('Worker Auth Parity 8: Authorized response is properly sanitized', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Contact': '0812345678' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();

  // Public customer fields must exist
  assert.equal(data.id, 101);
  assert.equal(data.bookingCode, 'BK-000101');
  assert.equal(data.payment_status, 'pending');
  assert.equal(data.has_slip, true);
  assert.ok(data.paymentDeadline);
  assert.ok(data.room);

  // Private fields MUST BE STRIPPED
  assert.equal(data.pin_code, undefined, 'pin_code must be stripped');
  assert.equal(data.qr_token, undefined, 'qr_token must be stripped');
  assert.equal(data.line_user_id, undefined, 'line_user_id must be stripped');
  assert.equal(data.slip_trans_ref, undefined, 'slip_trans_ref must be stripped');
  assert.equal(data.slip_image_url, undefined, 'slip_image_url must be stripped');
  assert.equal(data.customer_email, undefined, 'customer_email must be stripped');
  assert.equal(data.tax_id, undefined, 'tax_id must be stripped');
  assert.equal(data.tax_name, undefined, 'tax_name must be stripped');
  assert.equal(data.tax_address, undefined, 'tax_address must be stripped');
  assert.equal(data.internal_department, undefined, 'internal_department must be stripped');

  // Booking item pin_code must also be stripped
  assert.equal(data.items[0].pin_code, undefined, 'item pin_code must be stripped');
});

test('Worker Auth Parity 9: Unauthorized response leaks zero booking data', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET'
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.deepEqual(Object.keys(data), ['error'], 'Unauthorized response must contain ONLY error');
  assert.equal(data.customer_name, undefined);
  assert.equal(data.id, undefined);
  assert.equal(data.bookingCode, undefined);
});

test('Worker Auth Parity 10: Pending booking authorized correctly', async () => {
  const pendingBooking = { ...sampleBooking, payment_status: 'pending' };
  const env = createMockEnv([pendingBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Contact': '0812345678' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.payment_status, 'pending');
});

test('Worker Auth Parity 11: Rejected booking authorized correctly with rejection_reason', async () => {
  const rejectedBooking = { ...sampleBooking, payment_status: 'rejected' };
  const mockRejections = { 101: { rejection_reason: 'ยอดเงินไม่ตรงกับค่าบริการห้อง' } };
  const env = createMockEnv([rejectedBooking], sampleItems, mockRejections);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Contact': '0812345678' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.payment_status, 'rejected');
  assert.equal(data.rejection_reason, 'ยอดเงินไม่ตรงกับค่าบริการห้อง');
});

test('Worker Auth Parity 12: Paid booking authorized correctly', async () => {
  const paidBooking = { ...sampleBooking, payment_status: 'paid' };
  const env = createMockEnv([paidBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Contact': '0812345678' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.payment_status, 'paid');
});

test('Worker Auth Parity 13: Cancelled booking authorized correctly', async () => {
  const cancelledBooking = { ...sampleBooking, payment_status: 'cancelled' };
  const env = createMockEnv([cancelledBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Contact': '0812345678' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.payment_status, 'cancelled');
});

test('Worker Auth Parity 14: Legacy query credential behavior preserved for backwards compatibility', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101?contact=0812345678', {
    method: 'GET'
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.id, 101);
});

test('Worker Auth Parity 15: Raw DB and private fields absent from response', async () => {
  const env = createMockEnv([sampleBooking], sampleItems);
  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Contact': '0812345678' }
  });
  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();

  const bannedKeys = [
    'pin_code', 'qr_token', 'line_user_id', 'slip_trans_ref', 'slip_image_url',
    'customer_email', 'tax_name', 'tax_address', 'tax_id', 'tax_phone',
    'tax_delivery_method', 'tax_postal_address', 'internal_department'
  ];

  for (const key of bannedKeys) {
    assert.equal(data[key], undefined, `Private key ${key} must not be present`);
  }
});

test('Worker Auth Parity 16: Booking lookup does not create or mutate booking', async () => {
  let dbRunCalled = false;
  const env = {
    DB: {
      prepare(sql) {
        const createStatement = (params = []) => ({
          bind(...newParams) {
            return createStatement(newParams);
          },
          async first() {
            if (sql.includes('FROM settings WHERE key')) return { value: '15' };
            if (sql.includes('FROM bookings WHERE')) return sampleBooking;
            return null;
          },
          async all() {
            return { results: sampleItems[101] || [] };
          },
          async run() {
            dbRunCalled = true;
            throw new Error('GET ROUTE CANNOT MUTATE DB');
          }
        });
        return createStatement();
      }
    }
  };

  const req = new Request('https://worker.bwork.invalid/api/public/bookings/101', {
    method: 'GET',
    headers: { 'X-Booking-Contact': '0812345678' }
  });

  const res = await workerGetBookingRoute(req, env);
  assert.equal(res.status, 200);
  assert.equal(dbRunCalled, false, 'No DB mutations occurred during lookup');
});
