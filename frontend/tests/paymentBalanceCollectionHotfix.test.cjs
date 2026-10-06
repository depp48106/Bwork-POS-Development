const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Import canonical financialUtils
const financialUtils = require('../src/utils/financialUtils');
const {
  normalizeBookingFinancials,
  roundMoney,
  formatMoney,
  getPaymentMethodLabel
} = financialUtils;

// Helper simulating PendingBookings.jsx modal form state validation
function evaluateModalState(booking, enteredAmount, paymentMethod = 'cash') {
  const fin = normalizeBookingFinancials(booking);
  const amountNum = roundMoney(Number(enteredAmount) || 0);
  const remainingAfter = roundMoney(Math.max(0, fin.balance_amount - amountNum));
  const isOverpaying = amountNum > fin.balance_amount;
  const isZeroOrNegative = isNaN(amountNum) || amountNum <= 0;
  const isFormValid = !isZeroOrNegative && !isOverpaying && Boolean(paymentMethod);
  const shortcutAmount = String(fin.balance_amount || 0);

  return {
    fin,
    amountNum,
    remainingAfter,
    isOverpaying,
    isZeroOrNegative,
    isFormValid,
    shortcutAmount,
    confirmEnabled: isFormValid,
    validationError: isOverpaying
      ? `ยอดเงินที่ระบุเกินกว่ายอดคงเหลือ (฿${formatMoney(fin.balance_amount)})`
      : null
  };
}

// ============================================================================
// 1. EXACT SCREENSHOT REPRODUCTION & FIX
// ============================================================================
test('1. Screenshot Bug: total=200, paid=0, balance=0, status=pending derives remaining 200', () => {
  const booking = {
    id: 991,
    customer_name: 'Khun Somchai',
    total_amount: 200,
    paid_amount: 0,
    balance_amount: 0,
    payment_status: 'pending'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.total_amount, 200, 'Display Net Total must be ฿200.00');
  assert.strictEqual(fin.paid_amount, 0, 'Display Paid must be ฿0.00');
  assert.strictEqual(fin.balance_amount, 200, 'Display Remaining Balance must be ฿200.00 (not ฿0.00)');
  assert.strictEqual(fin.is_collectible, true, 'Booking must be marked collectible');
  assert.strictEqual(fin.is_paid, false, 'Booking must not be marked paid');

  // Modal interaction simulation
  const state = evaluateModalState(booking, '200', 'cash');
  assert.strictEqual(state.isOverpaying, false, 'Entering 200 must NOT trigger isOverpaying');
  assert.strictEqual(state.isFormValid, true, 'Form must be valid for ฿200');
  assert.strictEqual(state.confirmEnabled, true, 'Confirm payment button must be ENABLED');
  assert.strictEqual(state.validationError, null, 'No validation error allowed for ฿200');
  assert.strictEqual(state.shortcutAmount, '200', 'Full payment shortcut must fill 200');
});

// ============================================================================
// 2. DEPOSIT CASES (CONSISTENT VS STALE STORED BALANCE)
// ============================================================================
test('2. Deposit: total=1000, paid=300, consistent stored balance=700 derives remaining 700', () => {
  const booking = {
    id: 992,
    total_amount: 1000,
    paid_amount: 300,
    balance_amount: 700,
    payment_status: 'deposit'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.total_amount, 1000);
  assert.strictEqual(fin.paid_amount, 300);
  assert.strictEqual(fin.balance_amount, 700);
  assert.strictEqual(fin.is_deposit, true);
  assert.strictEqual(fin.is_collectible, true);

  const state = evaluateModalState(booking, '700', 'transfer');
  assert.strictEqual(state.isOverpaying, false);
  assert.strictEqual(state.confirmEnabled, true);
  assert.strictEqual(state.shortcutAmount, '700');
});

test('3. Stale Deposit Balance: total=1000, paid=300, stale balance=0 derives authoritative 700', () => {
  const booking = {
    id: 993,
    total_amount: 1000,
    paid_amount: 300,
    balance_amount: 0,
    payment_status: 'deposit'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.total_amount, 1000);
  assert.strictEqual(fin.paid_amount, 300);
  assert.strictEqual(fin.balance_amount, 700, 'Must fallback to derived remaining 700 when stored balance is 0');
  assert.strictEqual(fin.is_deposit, true);
  assert.strictEqual(fin.is_collectible, true);

  const state = evaluateModalState(booking, '700', 'card');
  assert.strictEqual(state.isOverpaying, false);
  assert.strictEqual(state.confirmEnabled, true);
  assert.strictEqual(state.shortcutAmount, '700');
});

// ============================================================================
// 3. FULLY PAID BOOKINGS
// ============================================================================
test('4. Fully Paid: total=200, paid=200, balance=0 leaves remaining 0 and non-collectible', () => {
  const booking = {
    id: 994,
    total_amount: 200,
    paid_amount: 200,
    balance_amount: 0,
    payment_status: 'paid'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.total_amount, 200);
  assert.strictEqual(fin.paid_amount, 200);
  assert.strictEqual(fin.balance_amount, 0);
  assert.strictEqual(fin.is_paid, true);
  assert.strictEqual(fin.is_collectible, false, 'Paid booking must not be collectible');
});

// ============================================================================
// 4. ZERO-NET AND CORPORATE INTERNAL FREE
// ============================================================================
test('5. Zero-net booking: total=0, paid=0, balance=0 leaves remaining 0 and non-collectible', () => {
  const booking = {
    id: 995,
    total_amount: 0,
    paid_amount: 0,
    balance_amount: 0,
    payment_status: 'paid'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.total_amount, 0);
  assert.strictEqual(fin.paid_amount, 0);
  assert.strictEqual(fin.balance_amount, 0);
  assert.strictEqual(fin.is_collectible, false);
});

test('6. Builtland / internal_free: total=0, paid=0, balance=0 leaves remaining 0 and non-collectible', () => {
  const booking = {
    id: 996,
    customer_type: 'builtland',
    billing_option: 'internal_free',
    total_amount: 0,
    paid_amount: 0,
    balance_amount: 0
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.total_amount, 0);
  assert.strictEqual(fin.paid_amount, 0);
  assert.strictEqual(fin.balance_amount, 0);
  assert.strictEqual(fin.is_internal_free, true);
  assert.strictEqual(fin.is_collectible, false);
});

// ============================================================================
// 5. CANCELLED / FAILED BOOKINGS
// ============================================================================
test('7. Cancelled booking: non-collectible even if theoretical balance exists', () => {
  const booking = {
    id: 997,
    total_amount: 500,
    paid_amount: 0,
    balance_amount: 500,
    payment_status: 'cancelled'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.is_cancelled, true);
  assert.strictEqual(fin.balance_amount, 0, 'Cancelled booking remaining must normalize to 0');
  assert.strictEqual(fin.is_collectible, false, 'Cancelled booking must never be collectible');
});

// ============================================================================
// 6. LEGACY AND NULL SNAPSHOT SAFETY (Section 6 Cases A-D)
// ============================================================================
test('8. Section 6 Legacy Rows A, B, C, D evaluate safely without NaN or negative values', () => {
  // Case A: total=200, paid=0, balance=0, status=pending
  const caseA = normalizeBookingFinancials({ total_amount: 200, paid_amount: 0, balance_amount: 0, payment_status: 'pending' });
  assert.strictEqual(caseA.balance_amount, 200);
  assert.strictEqual(caseA.is_collectible, true);

  // Case B: total=200, paid=200, balance=0, status=paid
  const caseB = normalizeBookingFinancials({ total_amount: 200, paid_amount: 200, balance_amount: 0, payment_status: 'paid' });
  assert.strictEqual(caseB.balance_amount, 0);
  assert.strictEqual(caseB.is_collectible, false);

  // Case C: total=1000, paid=300, balance=0, status=deposit
  const caseC = normalizeBookingFinancials({ total_amount: 1000, paid_amount: 300, balance_amount: 0, payment_status: 'deposit' });
  assert.strictEqual(caseC.balance_amount, 700);
  assert.strictEqual(caseC.is_collectible, true);

  // Case D: total=1000, paid=null, balance=null, status=pending
  const caseD = normalizeBookingFinancials({ total_amount: 1000, paid_amount: null, balance_amount: null, payment_status: 'pending' });
  assert.strictEqual(caseD.balance_amount, 1000);
  assert.strictEqual(caseD.is_collectible, true);
});

// ============================================================================
// 7. AMOUNT VALIDATION LIMITS AND SHORTCUTS
// ============================================================================
test('9. Amount validation: valid payments allowed, overpayment rejected', () => {
  const booking = {
    id: 998,
    total_amount: 200,
    paid_amount: 0,
    balance_amount: 0,
    payment_status: 'pending'
  };

  // Valid inputs
  ['1', '50.50', '199.99', '200'].forEach(val => {
    const s = evaluateModalState(booking, val, 'cash');
    assert.strictEqual(s.isOverpaying, false, `Amount ${val} should not be overpaying`);
    assert.strictEqual(s.confirmEnabled, true, `Amount ${val} should enable confirm button`);
  });

  // Overpayment inputs
  ['200.01', '250', '500'].forEach(val => {
    const s = evaluateModalState(booking, val, 'cash');
    assert.strictEqual(s.isOverpaying, true, `Amount ${val} must be flagged as overpaying`);
    assert.strictEqual(s.confirmEnabled, false, `Amount ${val} must disable confirm button`);
    assert.match(s.validationError, /ยอดเงินที่ระบุเกินกว่ายอดคงเหลือ/, 'Validation error message must be present');
  });

  // Zero / negative / empty inputs
  ['0', '-50', '', 'abc'].forEach(val => {
    const s = evaluateModalState(booking, val, 'cash');
    assert.strictEqual(s.confirmEnabled, false, `Invalid amount ${val} must disable confirm button`);
  });
});

test('10. Full-payment shortcut fills canonical remaining balance, not original total', () => {
  const partialBooking = {
    id: 999,
    total_amount: 1000,
    paid_amount: 300,
    balance_amount: 0, // stale
    payment_status: 'deposit'
  };

  const state = evaluateModalState(partialBooking, '700', 'cash');
  assert.strictEqual(state.shortcutAmount, '700', 'Shortcut must calculate remaining 700, not total 1000');
  assert.strictEqual(state.remainingAfter, 0, 'Paying full 700 leaves 0 remaining balance');
});

// ============================================================================
// 8. SOURCE INTEGRATION AUDIT: PendingBookings.jsx
// ============================================================================
test('11. Source Audit: PendingBookings.jsx uses normalizeBookingFinancials for modal state and buttons', () => {
  const componentPath = path.resolve(__dirname, '../src/components/PendingBookings.jsx');
  const src = fs.readFileSync(componentPath, 'utf8');

  // Verify modal imports and usages
  assert.match(src, /import\s*\{[^}]*normalizeBookingFinancials[^}]*\}\s*from\s*['"]\.\.\/utils\/financialUtils['"]/,
    'PendingBookings.jsx must import normalizeBookingFinancials');
  assert.match(src, /const\s+fin\s*=\s*normalizeBookingFinancials\(collectBalanceBooking\)/,
    'submitCollectBalance must normalize collectBalanceBooking financials');
  assert.match(src, /const\s+fin\s*=\s*normalizeBookingFinancials\(b\)/,
    'Collect balance modal render must normalize financials');
  assert.match(src, /ยอดเงินที่ระบุเกินกว่ายอดคงเหลือ/,
    'Modal must present overpayment feedback');
  assert.match(src, /disabled=\{!isFormValid\s*\|\|\s*isCollectingBalance\}/,
    'Confirm button must guard form validity');
});
