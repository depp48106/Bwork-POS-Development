'use strict';

// All fixtures are synthetic. No .env, application database, OCR downloads or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const sqlite3 = require('sqlite3');
const {
  extractPreciseAmount, toSatang, analyzeSlipText, verifySlip, commitVerifiedSlip,
  parseThaiBankSlipQR
} = require('../slipVerifier');

const config = {
  accountName: 'B-WORK Test Company', companyName: 'B-WORK Test Company',
  accountNumber: '1234567890', promptpayId: '0123456789012', taxId: '0123456789012',
  bankName: 'ธนาคารกรุงศรีอยุธยา'
};
const settings = {
  payment_bank_account_name: config.accountName, company_name: config.companyName,
  payment_bank_account: config.accountNumber, promptpay_id: config.promptpayId,
  company_tax_id: config.taxId, payment_bank_name: config.bankName
};
function slip(amount, receiver = config.accountName, bank = config.bankName, account = config.accountNumber) {
  return ['From', 'Other Sender', 'SCB', '9999999999', 'TO', receiver, bank,
    account, 'Amount', String(amount) + ' THB', 'Fee', '0.00'].join('\n');
}

function qr(ref = 'SYNTHETIC-REF', amount = null) {
  return { isValidSlipQR: true, isMerchantPaymentQR: false, transRef: ref,
    bankCode: '014', bankName: 'SCB', amount, rawQR: 'synthetic QR fixture' };
}
function tlv(tag, value) { return tag + String(value.length).padStart(2, '0') + value; }
const clientQR = tlv('00', tlv('01', '014') + tlv('02', 'SYNTHETIC-REF'));

async function fixture(t, { status = 'pending', expected = 300, uniqueIndex = true } = {}) {
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve())));
  // Exercise the current transaction implementation without importing database.js
  // (which would read .env and open/init the user's real database).
  const source = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
  const start = source.indexOf('let txLock = Promise.resolve();');
  const end = source.indexOf('\n};', start) + 4;
  assert.ok(start >= 0 && end > start);
  const query = vm.runInNewContext(source.slice(start, end) + '\ndbQuery;', { db, Promise });
  await query.exec(
    'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);' +
    'CREATE TABLE bookings (id INTEGER PRIMARY KEY, total_amount REAL, payment_status TEXT,' +
    ' receipt_number TEXT, contact TEXT, qr_token TEXT, slip_image_url TEXT, slip_trans_ref TEXT,' +
    ' slip_verified_at TEXT, slip_verify_status TEXT, payment_method TEXT, pin_code TEXT);' +
    'CREATE TABLE slip_verifications (id INTEGER PRIMARY KEY, booking_id INTEGER, trans_ref TEXT,' +
    ' bank_code TEXT, bank_name TEXT, amount REAL, is_auto_approved INTEGER, confidence_score INTEGER,' +
    ' raw_qr_data TEXT, ocr_text TEXT, verification_status TEXT, rejection_reason TEXT, created_at TEXT,' +
    ' slip_image_url TEXT);'
  );
  if (uniqueIndex) {
    await query.exec(fs.readFileSync(path.join(__dirname, '../migrations/003_slip_unique_index.sql'), 'utf8'));
  }
  for (const [key, value] of Object.entries(settings)) {
    await query.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  await query.run(
    'INSERT INTO bookings (id, total_amount, payment_status, contact, qr_token) VALUES (1, ?, ?, ?, ?)',
    [expected, status, '0800000000', 'synthetic-public-access']
  );
  return query;
}
async function scan(query, text, expected = 300, reference = 'SYNTHETIC-REF', qrAmount = null) {
  return verifySlip(Buffer.from('synthetic image'), { id: 1, total_amount: expected }, query, null, {
    decodeMiniQR: async () => qr(reference, qrAmount),
    runSlipOCR: async (_image, accountConfig) => analyzeSlipText(text, accountConfig)
  });
}
async function pay(query, result, id = 1) {
  return commitVerifiedSlip(result, { id }, query, () => query.run(
    "UPDATE bookings SET payment_status = 'paid', slip_trans_ref = ? WHERE id = ? AND COALESCE(payment_status, 'pending') NOT IN ('paid', 'cancelled')",
    [result.transRef, id]
  ));
}

for (const tc of [
  { name: 'TC1 expected 300 / OCR 300 / receiver correct -> PASS', expected: 300, amount: '300', pass: true },
  { name: 'TC2 expected 300 / OCR 100 -> REJECT', expected: 300, amount: '100', pass: false },
  { name: 'TC3 expected 300 / OCR 1300 -> REJECT', expected: 300, amount: '1300.00', pass: false },
  { name: 'TC4 expected 30 / OCR 300 -> REJECT', expected: 30, amount: '300.00', pass: false },
  { name: 'TC6 expected 300 / OCR 300.00 / cross-bank sender -> PASS', expected: 300, amount: '300.00', pass: true }
]) {
  test(tc.name, async t => {
    const query = await fixture(t, { expected: tc.expected });
    const result = await scan(query, slip(tc.amount), tc.expected);
    assert.equal(result.detectedAmount, Number(tc.amount));
    assert.equal(result.isValid, tc.pass);
    assert.equal(result.autoApproved, false, 'scan alone cannot approve payment');
    await pay(query, result);
    assert.equal(result.autoApproved, tc.pass);
    assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, tc.pass ? 'paid' : 'pending');
    assert.equal((await query.get('SELECT COUNT(*) AS count FROM slip_verifications')).count, tc.pass ? 1 : 0);
  });
}

test('TC5 B-WORK sender cannot satisfy another receiver -> REJECT', async t => {
  const query = await fixture(t);
  const text = slip('300', 'Another Person', 'SCB', '9999999999').replace('Other Sender', config.accountName);
  const parsed = analyzeSlipText(text, config);
  assert.equal(parsed.hasNameMatch, false);
  assert.equal(parsed.hasCompanyMatch, false);
  const result = await scan(query, text);
  await pay(query, result);
  assert.equal(result.isValid, false);
  assert.equal(result.autoApproved, false);
  assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, 'pending');
});

test('TC7 existing trans_ref -> REJECT, never autoApproved', async t => {
  const query = await fixture(t);
  await query.run("INSERT INTO slip_verifications (booking_id, trans_ref, verification_status) VALUES (2, ?, 'passed')", ['SYNTHETIC-REF']);
  const result = await scan(query, slip('300'));
  await pay(query, result);
  assert.equal(result.isValid, false);
  assert.equal(result.autoApproved, false);
  assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, 'pending');
});

test('TC7 unique constraint during INSERT fails closed, never calls paid update', async t => {
  const query = await fixture(t);
  const result = await scan(query, slip('300'));
  await query.run("INSERT INTO slip_verifications (booking_id, trans_ref, verification_status) VALUES (2, ?, 'passed')", ['SYNTHETIC-REF']);
  let paymentCalled = false;
  // Simulate a stale precheck; the real SQLite unique index is the final defence.
  const stale = { ...query, get: (sql, params) => sql.includes('FROM slip_verifications') ? Promise.resolve(undefined) : query.get(sql, params) };
  await commitVerifiedSlip(result, { id: 1 }, stale, async () => { paymentCalled = true; return { changes: 1 }; });
  assert.equal(paymentCalled, false);
  assert.equal(result.autoApproved, false);
  assert.equal(result.isValid, false);
  assert.match(result.reasons[0], /ใช้ซ้ำ/);
  assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, 'pending');
});

for (const failure of ['insert', 'update', 'zero changes', 'commit']) {
  test('Atomicity: ' + failure + ' failure leaves neither passed verification nor paid booking', async t => {
    const query = await fixture(t);
    const result = await scan(query, slip('300'));
    if (failure === 'insert') {
      await query.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON slip_verifications BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
    }
    if (failure === 'commit') {
      // Deferred foreign key failure exercises failure after both writes, at COMMIT.
      await query.exec('PRAGMA foreign_keys = ON; CREATE TABLE parent_fixture (id INTEGER PRIMARY KEY);' +
        'CREATE TABLE child_fixture (id INTEGER REFERENCES parent_fixture(id) DEFERRABLE INITIALLY DEFERRED);' +
        'CREATE TRIGGER fail_commit AFTER INSERT ON slip_verifications BEGIN INSERT INTO child_fixture VALUES (99); END;');
    }
    await commitVerifiedSlip(result, { id: 1 }, query, async () => {
      if (failure === 'update') throw new Error('synthetic update failure');
      if (failure === 'zero changes') return { changes: 0 };
      return query.run("UPDATE bookings SET payment_status = 'paid' WHERE id = 1");
    });
    assert.equal(result.autoApproved, false);
    assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, 'pending');
    assert.equal((await query.get('SELECT COUNT(*) AS count FROM slip_verifications')).count, 0);
  });
}

for (const uniqueIndex of [true, false]) {
  test('TC7 simultaneous same-ref uploads approve at most once (index=' + uniqueIndex + ')', async t => {
    const query = await fixture(t, { uniqueIndex });
    await query.run("INSERT INTO bookings (id, total_amount, payment_status) VALUES (2, 300, 'pending')");
    const first = await scan(query, slip('300'));
    const second = await scan(query, slip('300'));
    await Promise.all([pay(query, first, 1), pay(query, second, 2)]);
    assert.equal([first, second].filter(result => result.autoApproved).length, 1);
    assert.equal((await query.get("SELECT COUNT(*) AS count FROM bookings WHERE payment_status = 'paid'")).count, 1);
    assert.equal((await query.get('SELECT COUNT(*) AS count FROM slip_verifications')).count, 1);
  });
}

test('Amount normalization, satang precision, independence and malformed/ambiguous fail-safe', () => {
  for (const [text, detected] of [
    ['1300.00', 1300], ['300.00', 300], ['Amount 1,300.00 THB', 1300],
    ['Amount 1.300,00 THB', 1300], ['Amount 1 300.00 THB', 1300], ['จำนวนเงิน ๓๐๐.๕๐ บาท', 300.5],
    ['Amount 300,50 THB', 300.5], ['Amount 300.50 THB', 300.5],
    ['Amount 300.00\nAmount 100.00', null], ['Amount 1,30,0.00', null],
    ['Reference 1300.00\nFee 300.00', null], ['Amount\nFee\n300.00 THB', null]
  ]) {
    assert.equal(extractPreciseAmount(text, 30), detected, text);
    assert.equal(extractPreciseAmount(text, 300), detected, text + ' independent of legacy argument');
  }
  assert.equal(toSatang(300.49), 30049);
  assert.equal(toSatang(300.5), 30050);
  assert.equal(toSatang(300.499), null);
});

test('Amount differs by one satang or QR disagrees with OCR -> REJECT', async t => {
  const query = await fixture(t, { expected: 300.49 });
  const result = await scan(query, slip('300.50'), 300.49);
  assert.equal(result.detectedAmount, 300.5);
  assert.equal(result.isValid, false);
  const qrMismatch = await scan(query, slip('300.49'), 300.49, 'QR-AMOUNT', 300);
  assert.equal(qrMismatch.isValid, false);
});

test('Receiver fail-safe: wrong/missing bank, missing section, aliases, wrong account, sender/footer leakage', () => {
  for (const text of [
    slip('300', config.accountName, 'SCB'),
    slip('300', config.accountName, ''),
    slip('300').replace('\nTO\n', '\n'),
    slip('300', 'built'), slip('300', 'bwork'), slip('300', 'บิลท์'),
    slip('300', config.accountName, config.bankName, '9999997890'),
    slip('300', 'Another Person') + '\nNote\n' + config.accountName,
    ['TO', 'Another Person', 'From', config.accountName, config.bankName, config.accountNumber, 'Amount 300'].join('\n'),
    slip('300') + '\nBeneficiary\nAnother Person'
  ]) {
    assert.equal(analyzeSlipText(text, config).hasCompanyMatch, false, text);
  }
  for (const marker of ['ผู้รับ', 'ไปยัง', 'ถึง', 'TO', 'Beneficiary']) {
    assert.equal(analyzeSlipText(slip('300').replace('\nTO\n', '\n' + marker + '\n'), config).hasCompanyMatch, true);
  }
  assert.equal(analyzeSlipText(slip('300', config.accountName, config.bankName, 'xxx-x-56789-0'), config).hasCompanyMatch, true);
  assert.equal(analyzeSlipText(slip('300', config.accountName, config.bankName, config.promptpayId), config).hasCompanyMatch, true);
});

test('Local client-supplied QR cannot replace missing image QR', async t => {
  const query = await fixture(t);
  const result = await verifySlip(Buffer.from('fixture'), { id: 1, total_amount: 300 }, query, clientQR, {
    decodeMiniQR: async () => null, runSlipOCR: async () => analyzeSlipText(slip('300'), config)
  });
  assert.equal(result.isValid, false);
  assert.equal(result.autoApproved, false);
});

// Execute only the actual Worker upload route, with in-memory SQLite as D1 and mock file storage.
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const routeStart = workerSource.indexOf("      if (pathname.startsWith('/api/public/bookings/') && pathname.endsWith('/upload-slip')");
const routeEnd = workerSource.indexOf("      if ((pathname === '/api/public/bookings/by-phone'", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart);
const route = vm.runInNewContext(
  '(async function(request, env, saveUploadedFile) { const url = new URL(request.url);' +
  'const pathname = url.pathname; const method = request.method; const corsHeaders = {};\n' +
  workerSource.slice(routeStart, routeEnd) + '\n})',
  { URL, Response, TextEncoder, Uint8Array, crypto: webcrypto, parseThaiBankSlipQR, console, btoa }
);
async function workerUpload(query, { access = 'body', beforeUpdate } = {}) {
  let fileWrites = 0;
  let databaseWrites = 0;
  const env = { DB: { prepare(sql) {
    return { bind(...params) {
      return {
        first: () => query.get(sql, params),
        run: async () => {
          databaseWrites++;
          if (beforeUpdate && /UPDATE bookings/.test(sql)) await beforeUpdate();
          const result = await query.run(sql, params);
          return { meta: { changes: result.changes } };
        }
      };
    } };
  } } };
  const body = { slip_image: 'data:image/png;base64,c3ludGhldGlj', qr_data: clientQR };
  const headers = {};
  let url = 'https://test.invalid/api/public/bookings/1/upload-slip';
  let payload;
  if (access === 'body') body.contact = '080-000-0000';
  if (access === 'token') body.access_token = 'synthetic-public-access';
  if (access === 'header') headers['x-booking-contact'] = '0800000000';
  if (access === 'query') url += '?contact=0800000000';
  if (access === 'multipart') {
    payload = new FormData();
    for (const [key, value] of Object.entries(body)) payload.set(key, value);
    payload.set('contact', '0800000000');
  } else {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await route(new Request(url, { method: 'POST', headers, body: payload }), env,
    async () => { fileWrites++; return '/synthetic-slip.png'; });
  return { response, data: await response.json(), fileWrites, databaseWrites };
}

test('TC8 Worker paid booking cannot return to reviewing', async t => {
  const query = await fixture(t, { status: 'paid' });
  const result = await workerUpload(query);
  assert.equal(result.response.status, 409);
  assert.equal(result.data.auto_approved, false);
  assert.equal(result.fileWrites, 0);
  assert.equal(result.databaseWrites, 0);
  assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, 'paid');
});

test('TC9 Worker cancelled booking -> REJECT', async t => {
  const query = await fixture(t, { status: 'cancelled' });
  const result = await workerUpload(query);
  assert.equal(result.response.status, 409);
  assert.equal(result.fileWrites, 0);
  assert.equal(result.databaseWrites, 0);
  assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, 'cancelled');
});

for (const status of ['paid', 'cancelled']) {
  test('Worker concurrent status change to ' + status + ' cannot be overwritten', async t => {
    const query = await fixture(t);
    const result = await workerUpload(query, { beforeUpdate: () => query.run('UPDATE bookings SET payment_status = ? WHERE id = 1', [status]) });
    assert.equal(result.response.status, 409);
    assert.equal(result.data.auto_approved, false);
    assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, status);
    assert.equal((await query.get('SELECT COUNT(*) AS count FROM slip_verifications')).count, 0);
  });
}

test('Worker ownership check denies missing public access before any write', async t => {
  const query = await fixture(t);
  const result = await workerUpload(query, { access: 'none' });
  assert.equal(result.response.status, 403);
  assert.equal(result.fileWrites, 0);
  assert.equal(result.databaseWrites, 0);
});

for (const access of ['body', 'token', 'header', 'query', 'multipart']) {
  test('Worker authorized ' + access + ': reviewing only, client QR unverified', async t => {
    const query = await fixture(t);
    const result = await workerUpload(query, { access });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.auto_approved, false);
    assert.equal(result.data.qr_verified, false);
    assert.equal(result.data.verification_source, 'client_qr_unverified');
    const booking = await query.get('SELECT payment_status, slip_verified_at FROM bookings WHERE id = 1');
    assert.equal(booking.payment_status, 'reviewing');
    assert.equal(booking.slip_verified_at, null);
    const verification = await query.get('SELECT * FROM slip_verifications');
    assert.equal(verification.is_auto_approved, 0);
    assert.equal(verification.confidence_score, 0);
    assert.equal(verification.verification_status, 'pending_manual');
  });
}

test('Worker audit INSERT failure does not return success or approve payment', async t => {
  const query = await fixture(t);
  await query.exec("CREATE TRIGGER fail_worker_insert BEFORE INSERT ON slip_verifications BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: synthetic'); END;");
  const result = await workerUpload(query);
  assert.equal(result.response.status, 503);
  assert.equal(result.data.success, false);
  assert.equal(result.data.auto_approved, false);
  assert.notEqual((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, 'paid');
});

// Check the real Local route's integration, without booting Express or writing images.
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const localStart = serverSource.indexOf("app.post('/api/public/bookings/:id/upload-slip'");
const localEnd = serverSource.indexOf('// Live test slip verification API', localStart);
assert.ok(localStart >= 0 && localEnd > localStart);
async function localUpload(query, ocrText) {
  let handler;
  const files = new Map();
  vm.runInNewContext(serverSource.slice(localStart, localEnd), {
    app: { post: (_path, callback) => { handler = callback; } },
    dbQuery: query, path, __dirname: '/synthetic-backend', Buffer, console,
    fs: {
      existsSync: file => files.has(file),
      mkdirSync: () => {},
      writeFileSync: (file, bytes) => files.set(file, bytes),
      unlinkSync: file => files.delete(file)
    },
    hasPublicBookingAccess: () => true,
    getBangkokLocalISO: date => date.toISOString(),
    generateReceiptNumber: async () => 'SYNTHETIC-RECEIPT',
    generateUniquePinCode: async () => 'SYNTHETIC-ACCESS',
    commitVerifiedSlip,
    verifySlip: (image, booking, database) => verifySlip(image, booking, database, null, {
      decodeMiniQR: async () => qr(),
      runSlipOCR: async (_image, accountConfig) => analyzeSlipText(ocrText, accountConfig)
    })
  });
  const response = {
    statusCode: 200, data: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; }
  };
  await handler({ params: { id: '1' }, body: { slip_image: 'data:image/png;base64,c3ludGhldGlj' } }, response);
  return { ...response, files };
}

for (const scenario of ['pass', 'amount mismatch', 'insert failure', 'duplicate', 'paid', 'cancelled']) {
  test('Local upload route integration: ' + scenario, async t => {
    const query = await fixture(t, { status: ['paid', 'cancelled'].includes(scenario) ? scenario : 'pending' });
    if (scenario === 'insert failure') {
      await query.exec("CREATE TRIGGER fail_local_insert BEFORE INSERT ON slip_verifications BEGIN SELECT RAISE(ABORT, 'synthetic insert failure'); END;");
    }
    if (scenario === 'duplicate') {
      await query.run("INSERT INTO slip_verifications (booking_id, trans_ref, verification_status) VALUES (2, ?, 'passed')", ['SYNTHETIC-REF']);
    }
    const result = await localUpload(query, slip(scenario === 'amount mismatch' ? '1300.00' : '300.00'));
    const pass = scenario === 'pass';
    assert.equal(result.statusCode, pass ? 200 : scenario === 'insert failure' ? 503 : scenario === 'paid' ? 409 : 400);
    assert.equal(Boolean(result.data.auto_approved), pass);
    assert.equal(result.files.size, pass ? 1 : 0);
    const booking = await query.get('SELECT payment_status FROM bookings WHERE id = 1');
    assert.equal(booking.payment_status, pass || scenario === 'paid' ? 'paid' : scenario === 'cancelled' ? 'cancelled' : 'pending');
    if (pass) {
      assert.equal(result.data.verifyResult.autoApproved, true);
      assert.equal((await query.get('SELECT COUNT(*) AS count FROM slip_verifications')).count, 1);
    }
  });
}

test('Thousands separators and legacy expected argument never produce amount suffixes', () => {
  for (let value = 1000; value < 10000; value += 13) {
    for (const formatted of [String(value) + '.00', value.toLocaleString('en-US') + '.00']) {
      assert.equal(extractPreciseAmount('Amount ' + formatted + ' THB', value % 1000), value);
    }
  }
  assert.equal(extractPreciseAmount('Amount 1300 300 THB'), null);
});

test('Tier B Regression: SCB valid name + account without bank text -> PASS Tier B', () => {
  const scbConfig = {
    companyName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountNumber: '999-9-99622-7',
    bankName: 'ธนาคารไทยพาณิชย์',
    taxId: '0125554000401',
    promptpayId: '0125554000401'
  };
  const scbText = [
    'Successful transfer SCB Easy',
    'FROM',
    '@ นาย ผู้โอน',
    'XXX-XXX-1111',
    'TO',
    '5 บริษัท บิลท์ ฮาร์ท จำกัด',
    'XXX-XXX-6227',
    'AMOUNT 300.00'
  ].join('\n');
  const analysis = analyzeSlipText(scbText, scbConfig, { bankCode: '014', bankName: 'SCB' });
  assert.equal(analysis.hasNameMatch, true);
  assert.equal(analysis.hasAccountMatch, true);
  assert.equal(analysis.hasBankMatch, false); // no bank text in receiver box
  assert.equal(analysis.verificationTier, 'template_verified');
  assert.equal(analysis.hasCompanyMatch, true);
});

test('Tier B Regression: SCB name correct but account wrong -> REJECT', () => {
  const scbConfig = {
    companyName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountNumber: '999-9-99622-7',
    bankName: 'ธนาคารไทยพาณิชย์'
  };
  const scbWrongAccountText = [
    'Successful transfer SCB Easy',
    'FROM',
    '@ นาย ผู้โอน',
    'XXX-XXX-1111',
    'TO',
    '5 บริษัท บิลท์ ฮาร์ท จำกัด',
    'XXX-XXX-9999', // wrong account
    'AMOUNT 300.00'
  ].join('\n');
  const analysis = analyzeSlipText(scbWrongAccountText, scbConfig, { bankCode: '014' });
  assert.equal(analysis.hasNameMatch, true);
  assert.equal(analysis.hasAccountMatch, false);
  assert.equal(analysis.verificationTier, 'manual_review');
  assert.equal(analysis.hasCompanyMatch, false);
});

test('Tier B Regression: SCB account correct but name wrong -> REJECT', () => {
  const scbConfig = {
    companyName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountNumber: '999-9-99622-7',
    bankName: 'ธนาคารไทยพาณิชย์'
  };
  const scbWrongNameText = [
    'Successful transfer SCB Easy',
    'FROM',
    '@ นาย ผู้โอน',
    'XXX-XXX-1111',
    'TO',
    '5 นาย สมชาย เข็มกลัด', // wrong name
    'XXX-XXX-6227',
    'AMOUNT 300.00'
  ].join('\n');
  const analysis = analyzeSlipText(scbWrongNameText, scbConfig, { bankCode: '014' });
  assert.equal(analysis.hasNameMatch, false);
  assert.equal(analysis.hasAccountMatch, true);
  assert.equal(analysis.verificationTier, 'manual_review');
  assert.equal(analysis.hasCompanyMatch, false);
});

test('Tier B Regression: SCB sender has company name but receiver wrong -> REJECT', () => {
  const scbConfig = {
    companyName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountNumber: '999-9-99622-7',
    bankName: 'ธนาคารไทยพาณิชย์'
  };
  const scbSenderLeakText = [
    'Successful transfer SCB Easy',
    'FROM',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    'XXX-XXX-6227',
    'TO',
    '5 นาย สมชาย เข็มกลัด',
    'XXX-XXX-9999',
    'AMOUNT 300.00'
  ].join('\n');
  const analysis = analyzeSlipText(scbSenderLeakText, scbConfig, { bankCode: '014' });
  assert.equal(analysis.hasNameMatch, false);
  assert.equal(analysis.verificationTier, 'manual_review');
  assert.equal(analysis.hasCompanyMatch, false);
});

test('Tier B Regression: KBank OCR "ปิลท์ ฮาร์ท" + account correct -> approved uncertainty', () => {
  const kbankConfig = {
    companyName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountNumber: '004-1-23456-7',
    promptpayId: '0125554000401',
    bankName: 'ธนาคารกสิกรไทย'
  };
  const kbankText = [
    'โอนเงินสำเร็จ K+',
    'นาย ผู้โอน',
    'ธ.กสิกรไทย',
    'xxx-x-x111-1',
    'ด ปิลท์ ฮาร์ท',
    '0125554000401',
    'เลขที่รายการ:',
    '016238082106BPM12096',
    'จำนวน:',
    '300.00 บาท'
  ].join('\n');
  const analysis = analyzeSlipText(kbankText, kbankConfig, { bankCode: '004', bankName: 'KBANK' });
  assert.equal(analysis.hasNameMatch, false); // A: no target correction
  assert.equal(analysis.hasPromptPayMatch, true);
  assert.equal(analysis.verificationTier, 'manual_review');
  assert.equal(analysis.hasCompanyMatch, false);
  assert.equal(analysis.receiverOcrUncertain, true);
  assert.equal(analysis.evidence.receiver.rawName, 'ด ปิลท์ ฮาร์ท');
});

test('Tier B Regression: KBank "ปิลท์ ฮาร์ท" but account wrong -> REJECT', () => {
  const kbankConfig = {
    companyName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountNumber: '004-1-23456-7',
    promptpayId: '0125554000401',
    bankName: 'ธนาคารกสิกรไทย'
  };
  const kbankWrongAccountText = [
    'โอนเงินสำเร็จ K+',
    'นาย ผู้โอน',
    'ธ.กสิกรไทย',
    'xxx-x-x111-1',
    'ด ปิลท์ ฮาร์ท',
    '0999999999999', // wrong account/promptpay
    'เลขที่รายการ:',
    '016238082106BPM12096',
    'จำนวน:',
    '300.00 บาท'
  ].join('\n');
  const analysis = analyzeSlipText(kbankWrongAccountText, kbankConfig, { bankCode: '004' });
  assert.equal(analysis.hasNameMatch, false); // A: wrong identifier must still fail
  assert.equal(analysis.receiverOcrUncertain, false);
  assert.equal(analysis.hasAccountMatch, false);
  assert.equal(analysis.hasPromptPayMatch, false);
  assert.equal(analysis.verificationTier, 'manual_review');
  assert.equal(analysis.hasCompanyMatch, false);
});

// Phase2 approved payment deltas; all databases below are isolated in-memory fixtures.
for (const [amountText, recovered, amount, eligible] of [
  ['Amount\nFee 30.00\n300.00 THB', true, 300, false],
  ['Amount\nค่าธรรมเนียม 30.00\n300.00 บาท', true, 300, false],
  ['Amount\nFee\n30.00 THB\n300.00 THB', true, 300, false],
  ['Amount 300.00 THB\nFee 30.00 THB', false, 300, true],
  ['Amount\n300.00 THB\nFee\n30.00 THB', false, 300, true],
  ['Fee 30 THB\nAmount 300 THB', false, 300, true],
  ['Balance 300.00 THB', false, null, false]
]) {
  test('Phase2 fee provenance payment guard: ' + JSON.stringify(amountText), async t => {
    const query = await fixture(t);
    const text = ['From', 'Other Sender', 'TO', config.accountName, config.bankName,
      config.accountNumber, amountText].join('\n');
    const result = await scan(query, text);
    assert.equal(result.detectedAmount, amount);
    assert.equal(result.details.ocr.evidence.amount.evidence.recoveredAcrossFeeContext, recovered);
    assert.equal(result.eligibleForAutoApproval, eligible);
    assert.equal(result.isValid, eligible);
    assert.notEqual(result.manualReviewRequired, true);
    if (!eligible) assert.notEqual(result.verificationTier, 'strict_verified');
    if (recovered) {
      assert.equal(result.details.ocr.evidence.amount.raw, '300.00');
      assert.ok(result.details.ocr.evidence.amount.warnings.includes('amount_recovered_across_fee'));
    }
    const response = await localUpload(query, text);
    assert.equal(response.statusCode, eligible ? 200 : 400);
    assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, eligible ? 'paid' : 'pending');
    assert.equal((await query.get('SELECT COUNT(*) AS count FROM slip_verifications')).count, eligible ? 1 : 0);
  });
}

for (const scenario of ['uncertain', 'amount mismatch', 'wrong receiver', 'wrong bank', 'duplicate', 'insert failure', 'update failure']) {
  test('Phase2 local receiver uncertainty route: ' + scenario, async t => {
    const query = await fixture(t);
    await query.run("UPDATE settings SET value = ? WHERE key = 'payment_bank_account_name'", ['บริษัท บิลท์ ฮาร์ท จำกัด']);
    const name = scenario === 'wrong receiver' ? 'บริษัท อื่น จำกัด' : 'ด ปิลท์ ฮาร์ท';
    const text = ['From', 'Other Sender', 'TO', name,
      scenario === 'wrong bank' ? 'SCB' : config.bankName, config.accountNumber,
      'Amount', scenario === 'amount mismatch' ? '1300 THB' : '300 THB'].join('\n');
    if (scenario === 'duplicate') await query.run("INSERT INTO slip_verifications (booking_id, trans_ref, verification_status) VALUES (2, 'SYNTHETIC-REF', 'pending_manual')");
    if (scenario === 'insert failure') await query.exec("CREATE TRIGGER fail_manual BEFORE INSERT ON slip_verifications BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
    if (scenario === 'update failure') await query.exec("CREATE TRIGGER fail_manual_update BEFORE UPDATE ON bookings BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
    const result = await localUpload(query, text);
    const review = scenario === 'uncertain';
    assert.equal(result.statusCode, review ? 200 : scenario.includes('failure') ? 503 : 400);
    assert.equal(result.data.auto_approved, false);
    const booking = await query.get('SELECT * FROM bookings WHERE id = 1');
    assert.equal(booking.payment_status, review ? 'reviewing' : 'pending');
    assert.equal(booking.pin_code, null);
    assert.equal(booking.receipt_number, null);
    assert.equal(result.files.size, review ? 1 : 0);
    const record = await query.get('SELECT * FROM slip_verifications WHERE booking_id = 1');
    if (review) {
      assert.equal(record.verification_status, 'pending_manual');
      assert.equal(record.is_auto_approved, 0);
      assert.equal(result.data.verifyResult.eligibleForAutoApproval, false);
      assert.equal(result.data.verifyResult.details.ocr.evidence.receiver.rawName, name);
    } else assert.equal(record, undefined);
  });
}
for (const label of ['Balance', 'Fee', 'ยอดคงเหลือ', 'ยอดเงินคงเหลือ', 'ค่าธรรมเนียม']) {
  test('Phase2 non-transfer amount cannot pay or enter review: ' + label, async t => {
    const query = await fixture(t);
    const text = ['From', 'Other Sender', 'TO', config.accountName, config.bankName,
      config.accountNumber, label + ' 300.00 THB'].join('\n');
    const scanned = await scan(query, text);
    assert.equal(scanned.detectedAmount, null);
    assert.notEqual(scanned.verificationTier, 'strict_verified');
    assert.equal(scanned.isValid, false);
    assert.equal(scanned.eligibleForAutoApproval, false);
    assert.notEqual(scanned.manualReviewRequired, true);
    const response = await localUpload(query, text);
    assert.equal(response.statusCode, 400);
    assert.equal((await query.get('SELECT payment_status FROM bookings WHERE id = 1')).payment_status, 'pending');
    assert.equal((await query.get('SELECT COUNT(*) AS count FROM slip_verifications')).count, 0);
  });
}

test('Tier B Regression: Unknown bank/template without bank text -> CANNOT use Tier B (REJECT)', () => {
  const gsbConfig = {
    companyName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountNumber: '1234567890',
    bankName: 'ธนาคารออมสิน'
  };
  const unknownTemplateText = [
    'MyUnknownBank Transfer',
    'FROM',
    'Mr. Sender',
    'xxx-xxx-1111',
    'TO',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    '1234567890',
    'AMOUNT 300.00'
  ].join('\n');
  // Unknown bank code 030 has no verified template without bank text
  const analysis = analyzeSlipText(unknownTemplateText, gsbConfig, { bankCode: '030' });
  assert.equal(analysis.hasNameMatch, true);
  assert.equal(analysis.hasAccountMatch, true);
  assert.equal(analysis.hasBankMatch, false);
  assert.equal(analysis.verificationTier, 'manual_review');
  assert.equal(analysis.hasCompanyMatch, false);
});

test('Tier B Regression: Multiple ambiguous receiver sections -> REJECT/manual', () => {
  const ambiguousText = [
    'TO',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    '1234567890',
    'TO',
    'Another Person',
    '9999999999',
    'AMOUNT 300.00'
  ].join('\n');
  const analysis = analyzeSlipText(ambiguousText, config);
  assert.equal(analysis.receiverText, '');
  assert.equal(analysis.verificationTier, 'manual_review');
  assert.equal(analysis.hasCompanyMatch, false);
});
