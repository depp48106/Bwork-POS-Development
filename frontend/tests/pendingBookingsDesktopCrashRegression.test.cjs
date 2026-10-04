const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PENDING_BOOKINGS_FILE = path.join(__dirname, '../src/components/PendingBookings.jsx');
const financialUtils = require('../src/utils/financialUtils.js');

test('Regression: Desktop table row mapping must declare "const fin = normalizeBookingFinancials(b)"', () => {
  const content = fs.readFileSync(PENDING_BOOKINGS_FILE, 'utf8');

  // Locate the desktop table paginatedBookings.map((b) => { block (around line 2324)
  const desktopMapRegex = /paginatedBookings\.map\(\(b\)\s*=>\s*\{([\s\S]*?)(?:<tr[\s\S]*?<\/tr>[\s\S]*?\)\s*;\s*\})/m;
  const match = content.match(desktopMapRegex);

  assert.ok(match, 'Desktop paginatedBookings.map block must exist in PendingBookings.jsx');
  const desktopBlock = match[1];

  // The desktop block uses fin.is_paid, fin.total_amount, etc.
  // It MUST declare `fin = normalizeBookingFinancials(b)` before using `fin`
  const hasFinDeclaration = /const\s+fin\s*=\s*normalizeBookingFinancials\(b\)/.test(desktopBlock);
  assert.strictEqual(
    hasFinDeclaration,
    true,
    'CRITICAL: Desktop table paginatedBookings.map MUST declare "const fin = normalizeBookingFinancials(b)" to prevent ReferenceError: fin is not defined'
  );
});

test('Regression: Desktop table row evaluates without ReferenceError for all production booking shapes', () => {
  const content = fs.readFileSync(PENDING_BOOKINGS_FILE, 'utf8');

  // Verify that inside the desktop table row block, every occurrence of `fin` is in scope
  const desktopMapStart = content.indexOf('paginatedBookings.map((b) => {');
  assert.ok(desktopMapStart > -1, 'Must find paginatedBookings.map start');

  const mobileMapStart = content.indexOf('paginatedBookings.map((b) => {', desktopMapStart + 30);
  assert.ok(mobileMapStart > -1, 'Must find mobile paginatedBookings.map start');

  // Extract the desktop map block
  const desktopBlock = content.substring(desktopMapStart, mobileMapStart);

  // If fin is referenced, it must be declared at the top of the block
  const firstFinUsage = desktopBlock.search(/\bfin(?:\.|\?\.)/);
  const finDeclaration = desktopBlock.indexOf('const fin = normalizeBookingFinancials(b)');

  assert.ok(finDeclaration > -1, 'const fin = normalizeBookingFinancials(b) must be present in desktop block');
  assert.ok(
    finDeclaration < firstFinUsage,
    `const fin must be declared before any fin property access (decl=${finDeclaration}, usage=${firstFinUsage})`
  );
});

test('Regression: Mobile card mapping must declare "const fin = normalizeBookingFinancials(b)"', () => {
  const content = fs.readFileSync(PENDING_BOOKINGS_FILE, 'utf8');
  const desktopMapStart = content.indexOf('paginatedBookings.map((b) => {');
  const mobileMapStart = content.indexOf('paginatedBookings.map((b) => {', desktopMapStart + 30);
  assert.ok(mobileMapStart > -1, 'Must find mobile paginatedBookings.map start');

  const mobileBlock = content.substring(mobileMapStart);
  const firstFinUsage = mobileBlock.search(/\bfin(?:\.|\?\.)/);
  const finDeclaration = mobileBlock.indexOf('const fin = normalizeBookingFinancials(b)');

  assert.ok(finDeclaration > -1, 'const fin = normalizeBookingFinancials(b) must be present in mobile block');
  assert.ok(
    finDeclaration < firstFinUsage,
    `const fin must be declared before any mobile fin property access (decl=${finDeclaration}, usage=${firstFinUsage})`
  );
});

test('Regression: normalizeBookingFinancials evaluates correctly across all 5 production booking shapes', () => {
  const { normalizeBookingFinancials } = financialUtils;

  // 1. Legacy paid booking
  const legacyPaid = { id: 1, total_amount: 1500, payment_status: 'paid' };
  const fin1 = normalizeBookingFinancials(legacyPaid);
  assert.strictEqual(fin1.is_paid, true);
  assert.strictEqual(fin1.balance_amount, 0);
  assert.strictEqual(fin1.paid_amount, 1500);

  // 2. Legacy pending booking
  const legacyPending = { id: 2, total_amount: 2000, payment_status: 'pending' };
  const fin2 = normalizeBookingFinancials(legacyPending);
  assert.strictEqual(fin2.is_paid, false);
  assert.strictEqual(fin2.balance_amount, 2000);
  assert.strictEqual(fin2.paid_amount, 0);

  // 3. V1 deposit booking
  const v1Deposit = { id: 3, subtotal_amount: 3000, discount_amount: 500, total_amount: 2500, is_deposit: 1, deposit_amount: 1000, paid_amount: 1000, balance_amount: 1500, payment_status: 'deposit' };
  const fin3 = normalizeBookingFinancials(v1Deposit);
  assert.strictEqual(fin3.is_deposit, true);
  assert.strictEqual(fin3.is_paid, false);
  assert.strictEqual(fin3.paid_amount, 1000);
  assert.strictEqual(fin3.balance_amount, 1500);

  // 4. V1 fully settled booking with discount
  const v1FullPaid = { id: 4, original_total_amount: 3000, discount_amount: 500, total_amount: 2500, is_deposit: 0, deposit_amount: 0, payment_status: 'paid' };
  const fin4 = normalizeBookingFinancials(v1FullPaid);
  assert.strictEqual(fin4.is_paid, true);
  assert.strictEqual(fin4.paid_amount, 2500);
  assert.strictEqual(fin4.balance_amount, 0);

  // 5. Internal free booking
  const internalFree = { id: 5, total_amount: 0, payment_status: 'internal_free' };
  const fin5 = normalizeBookingFinancials(internalFree);
  assert.strictEqual(fin5.is_internal_free, true);
  assert.strictEqual(fin5.is_paid, true);
  assert.strictEqual(fin5.balance_amount, 0);
});

