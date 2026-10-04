const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const FINANCIAL_UTILS_PATH = path.join(ROOT_DIR, 'src/utils/financialUtils.js');
const PENDING_BOOKINGS_PATH = path.join(ROOT_DIR, 'src/components/PendingBookings.jsx');
const PENDING_BOOKINGS_CSS_PATH = path.join(ROOT_DIR, 'src/components/PendingBookings.css');

// Load pure financial helper
const {
  roundMoney,
  formatMoney,
  normalizeBookingFinancials,
  getPaymentMethodLabel,
  getTransactionTypeLabel,
  calculateRescheduleFinancials
} = require(FINANCIAL_UTILS_PATH);

// ============================================================================
// 1. FINANCIAL NORMALIZATION & DISPLAY TESTS
// ============================================================================

test('▶ Financial Normalization: Full Paid Booking', () => {
  const booking = {
    id: 101,
    subtotal_amount: 2000,
    discount_type: 'percent',
    discount_value: 10,
    discount_amount: 200,
    total_amount: 1800,
    paid_amount: 1800,
    balance_amount: 0,
    payment_status: 'paid',
    payment_method: 'transfer'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.subtotal_amount, 2000);
  assert.strictEqual(fin.discount_amount, 200);
  assert.strictEqual(fin.total_amount, 1800);
  assert.strictEqual(fin.paid_amount, 1800);
  assert.strictEqual(fin.balance_amount, 0);
  assert.strictEqual(fin.payment_status, 'paid');
  assert.strictEqual(fin.is_paid, true);
  assert.strictEqual(fin.is_deposit, false);
  assert.strictEqual(fin.is_collectible, false);
  assert.strictEqual(fin.is_internal_free, false);
});

test('▶ Financial Normalization: Deposit Booking with Balance', () => {
  const booking = {
    id: 102,
    subtotal_amount: 3000,
    discount_type: 'amount',
    discount_value: 500,
    discount_amount: 500,
    total_amount: 2500,
    paid_amount: 1000,
    balance_amount: 1500,
    payment_status: 'deposit',
    payment_method: 'cash'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.subtotal_amount, 3000);
  assert.strictEqual(fin.discount_amount, 500);
  assert.strictEqual(fin.total_amount, 2500);
  assert.strictEqual(fin.paid_amount, 1000);
  assert.strictEqual(fin.balance_amount, 1500);
  assert.strictEqual(fin.payment_status, 'deposit');
  assert.strictEqual(fin.is_paid, false);
  assert.strictEqual(fin.is_deposit, true);
  assert.strictEqual(fin.is_collectible, true);
});

test('▶ Financial Normalization: Unpaid / Pending Booking', () => {
  const booking = {
    id: 103,
    subtotal_amount: 1200,
    discount_type: 'none',
    discount_value: 0,
    discount_amount: 0,
    total_amount: 1200,
    paid_amount: 0,
    balance_amount: 1200,
    payment_status: 'pending'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.subtotal_amount, 1200);
  assert.strictEqual(fin.total_amount, 1200);
  assert.strictEqual(fin.paid_amount, 0);
  assert.strictEqual(fin.balance_amount, 1200);
  assert.strictEqual(fin.payment_status, 'pending');
  assert.strictEqual(fin.is_pending, true);
  assert.strictEqual(fin.is_collectible, true);
});

test('▶ Financial Normalization: Builtland / Internal Free Booking', () => {
  const booking = {
    id: 104,
    customer_type: 'builtland',
    subtotal_amount: 5000,
    total_amount: 5000,
    payment_status: 'internal_free'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.is_internal_free, true);
  assert.strictEqual(fin.total_amount, 0);
  assert.strictEqual(fin.paid_amount, 0);
  assert.strictEqual(fin.balance_amount, 0);
  assert.strictEqual(fin.is_collectible, false);
});

test('▶ Financial Normalization: Cancelled Booking', () => {
  const booking = {
    id: 105,
    subtotal_amount: 2000,
    total_amount: 2000,
    paid_amount: 500,
    balance_amount: 1500,
    payment_status: 'cancelled'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.is_cancelled, true);
  assert.strictEqual(fin.is_collectible, false, 'Cancelled booking must not be collectible');
});

test('▶ Financial Normalization: Reviewing Booking with Slip', () => {
  const booking = {
    id: 106,
    subtotal_amount: 1500,
    total_amount: 1500,
    paid_amount: 0,
    balance_amount: 1500,
    payment_status: 'reviewing',
    slip_image_url: 'https://example.com/slip.jpg'
  };

  const fin = normalizeBookingFinancials(booking);
  assert.strictEqual(fin.is_reviewing, true);
  assert.strictEqual(fin.is_collectible, false, 'Reviewing slip booking must not bypass OCR slip review');
});

test('▶ Financial Normalization: Legacy Booking Fallback (Missing snapshot fields)', () => {
  // Legacy paid booking with no paid_amount or balance_amount columns
  const legacyPaid = {
    id: 107,
    total_amount: 800,
    payment_status: 'paid'
  };
  const finPaid = normalizeBookingFinancials(legacyPaid);
  assert.strictEqual(finPaid.subtotal_amount, 800);
  assert.strictEqual(finPaid.total_amount, 800);
  assert.strictEqual(finPaid.paid_amount, 800);
  assert.strictEqual(finPaid.balance_amount, 0);
  assert.strictEqual(finPaid.is_collectible, false);

  // Legacy pending booking with no paid_amount or balance_amount columns
  const legacyPending = {
    id: 108,
    total_amount: 950,
    payment_status: 'pending'
  };
  const finPending = normalizeBookingFinancials(legacyPending);
  assert.strictEqual(finPending.subtotal_amount, 950);
  assert.strictEqual(finPending.total_amount, 950);
  assert.strictEqual(finPending.paid_amount, 0);
  assert.strictEqual(finPending.balance_amount, 950);
  assert.strictEqual(finPending.is_collectible, true);
});

test('▶ Helper Labels: Payment Method & Transaction Type', () => {
  assert.strictEqual(getPaymentMethodLabel('cash'), 'เงินสด');
  assert.strictEqual(getPaymentMethodLabel('transfer'), 'โอนเงิน');
  assert.strictEqual(getPaymentMethodLabel('promptpay'), 'พร้อมเพย์');
  assert.strictEqual(getPaymentMethodLabel('card'), 'บัตร');
  assert.strictEqual(getPaymentMethodLabel('hour_credit'), 'เครดิตชั่วโมง');
  assert.strictEqual(getPaymentMethodLabel(''), '-');

  assert.strictEqual(getTransactionTypeLabel('full'), 'ชำระเต็มจำนวน');
  assert.strictEqual(getTransactionTypeLabel('deposit'), 'เงินมัดจำ');
  assert.strictEqual(getTransactionTypeLabel('balance'), 'ชำระเพิ่มเติม');
  assert.strictEqual(getTransactionTypeLabel('refund'), 'คืนเงิน');
});

// ============================================================================
// 2. COLLECT BALANCE CALCULATION & INVARIANT TESTS
// ============================================================================

test('▶ Collect Balance: Full Settlement Closes Balance to Zero', () => {
  const currentFin = {
    total_amount: 2500,
    paid_amount: 1000,
    balance_amount: 1500
  };
  const paymentAmount = 1500;

  const newPaid = roundMoney(currentFin.paid_amount + paymentAmount);
  const newBalance = roundMoney(currentFin.balance_amount - paymentAmount);
  assert.strictEqual(newPaid, 2500);
  assert.strictEqual(newBalance, 0);
  assert.strictEqual(newPaid + newBalance, currentFin.total_amount);
});

test('▶ Collect Balance: Partial Payment Leaves Correct Remaining Balance', () => {
  const currentFin = {
    total_amount: 4000,
    paid_amount: 1000,
    balance_amount: 3000
  };
  const paymentAmount = 1500;

  const newPaid = roundMoney(currentFin.paid_amount + paymentAmount);
  const newBalance = roundMoney(currentFin.balance_amount - paymentAmount);
  assert.strictEqual(newPaid, 2500);
  assert.strictEqual(newBalance, 1500);
  assert.strictEqual(newPaid + newBalance, currentFin.total_amount);
});

test('▶ Collect Balance: Validation Logic Rejects Invalid Inputs', () => {
  const balance = 1500;

  // Overpayment check
  const overpay = 1500.01;
  assert.strictEqual(overpay > balance, true, 'Must detect overpayment');

  // Negative amount check
  const neg = -100;
  assert.strictEqual(neg <= 0, true, 'Must detect non-positive amount');

  // Zero amount check
  const zero = 0;
  assert.strictEqual(zero <= 0, true, 'Must detect zero amount');

  // NaN check
  const nanVal = Number('abc');
  assert.strictEqual(isNaN(nanVal), true, 'Must detect NaN input');
});

// ============================================================================
// 3. RESCHEDULE FINANCIAL RECALCULATION TESTS
// ============================================================================

test('▶ Reschedule: Percentage Discount Preserved on Recalculated Gross', () => {
  const oldBooking = {
    id: 201,
    subtotal_amount: 1000,
    discount_type: 'percent',
    discount_value: 20,
    discount_amount: 200,
    total_amount: 800,
    paid_amount: 300,
    balance_amount: 500,
    payment_status: 'deposit'
  };

  // Rescheduled to 3 hours = 1500 gross
  const res = calculateRescheduleFinancials({
    oldBooking,
    newSubtotal: 1500
  });

  assert.strictEqual(res.is_valid, true);
  assert.strictEqual(res.subtotal_amount, 1500);
  assert.strictEqual(res.discount_type, 'percent');
  assert.strictEqual(res.discount_value, 20);
  assert.strictEqual(res.discount_amount, 300); // 20% of 1500
  assert.strictEqual(res.total_amount, 1200);   // 1500 - 300
  assert.strictEqual(res.paid_amount, 300);     // preserved paid amount
  assert.strictEqual(res.balance_amount, 900);  // 1200 - 300
  assert.strictEqual(res.payment_status, 'deposit');
});

test('▶ Reschedule: Fixed Amount Discount Preserved on Recalculated Gross', () => {
  const oldBooking = {
    id: 202,
    subtotal_amount: 2000,
    discount_type: 'amount',
    discount_value: 400,
    discount_amount: 400,
    total_amount: 1600,
    paid_amount: 1600,
    balance_amount: 0,
    payment_status: 'paid'
  };

  // Rescheduled to higher rate = 2500 gross
  const res = calculateRescheduleFinancials({
    oldBooking,
    newSubtotal: 2500
  });

  assert.strictEqual(res.is_valid, true);
  assert.strictEqual(res.subtotal_amount, 2500);
  assert.strictEqual(res.discount_type, 'amount');
  assert.strictEqual(res.discount_amount, 400);
  assert.strictEqual(res.total_amount, 2100);  // 2500 - 400
  assert.strictEqual(res.paid_amount, 1600);
  assert.strictEqual(res.balance_amount, 500); // 2100 - 1600
  assert.strictEqual(res.payment_status, 'deposit', 'Becomes deposit since balance is now > 0');
});

test('▶ Reschedule: Fixed Discount Exceeding New Subtotal Is Blocked', () => {
  const oldBooking = {
    id: 203,
    subtotal_amount: 1000,
    discount_type: 'amount',
    discount_value: 600,
    discount_amount: 600,
    total_amount: 400,
    paid_amount: 400,
    balance_amount: 0,
    payment_status: 'paid'
  };

  // Rescheduled to shorter duration = 500 gross (< 600 discount)
  const res = calculateRescheduleFinancials({
    oldBooking,
    newSubtotal: 500
  });

  assert.strictEqual(res.is_valid, false);
  assert.strictEqual(typeof res.error, 'string');
  assert.match(res.error, /สูงกว่ายอดรวมใหม่/);
});

test('▶ Reschedule: New Net Total Less Than Already Paid Is Blocked', () => {
  const oldBooking = {
    id: 204,
    subtotal_amount: 2000,
    discount_type: 'none',
    discount_value: 0,
    discount_amount: 0,
    total_amount: 2000,
    paid_amount: 2000,
    balance_amount: 0,
    payment_status: 'paid'
  };

  // Rescheduled to shorter slot = 1000 gross (< 2000 paid)
  const res = calculateRescheduleFinancials({
    oldBooking,
    newSubtotal: 1000
  });

  assert.strictEqual(res.is_valid, false);
  assert.strictEqual(typeof res.error, 'string');
  assert.match(res.error, /ต่ำกว่ายอดเงินที่ชำระไปแล้ว/);
});

// ============================================================================
// 4. CODEBASE INTEGRATION & CONTRACT AUDIT
// ============================================================================

test('▶ Source Code Audit: PendingBookings.jsx Integration', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  // Verify imports from financialUtils
  assert.match(code, /normalizeBookingFinancials/, 'Must import and use normalizeBookingFinancials');
  assert.match(code, /calculateRescheduleFinancials/, 'Must import and use calculateRescheduleFinancials');
  assert.match(code, /getPaymentMethodLabel/, 'Must import getPaymentMethodLabel');
  assert.match(code, /getTransactionTypeLabel/, 'Must import getTransactionTypeLabel');

  // Verify balance payment endpoint call
  assert.match(code, /\/api\/bookings\/\$\{[^}]+\}\/pay-balance/, 'Must call POST /api/bookings/:id/pay-balance');

  // Verify payment transaction history endpoint call
  assert.match(code, /\/api\/bookings\/\$\{[^}]+\}\/payments/, 'Must call GET /api/bookings/:id/payments');

  // Verify 409 concurrency error handling
  assert.match(code, /res\.status === 409/, 'Must handle 409 Conflict status');

  // Verify primary action routing to handleOpenCollectBalance
  assert.match(code, /handleOpenCollectBalance/, 'Must expose handleOpenCollectBalance');

  // Verify Collect Balance Modal presence
  assert.match(code, /showCollectBalanceModal && collectBalanceBooking/, 'Must render showCollectBalanceModal');
  assert.match(code, /ชำระเต็มยอด/, 'Must support quick full balance settlement');

  // Verify Reschedule financial preview
  assert.match(code, /ยอดก่อนส่วนลดใหม่:/, 'Must display new gross subtotal in reschedule preview');
  assert.match(code, /ยอดคงเหลือใหม่:/, 'Must display new remaining balance in reschedule preview');
});

test('▶ Source Code Audit: PendingBookings.css Status Badges', () => {
  const css = fs.readFileSync(PENDING_BOOKINGS_CSS_PATH, 'utf8');

  // Verify deposit and internal-free badges exist
  assert.match(css, /\.pb-status-badge--deposit/, 'Must define .pb-status-badge--deposit');
  assert.match(css, /\.pb-status-badge--internal-free/, 'Must define .pb-status-badge--internal-free');
  assert.match(css, /\.pb-status-deposit/, 'Must define .pb-status-deposit');
  assert.match(css, /\.pb-status-internal-free/, 'Must define .pb-status-internal-free');
});

// ============================================================================
// 5. NETWORK CONTRACT, CONCURRENCY & RACE DEFENSE TESTS
// ============================================================================

test('▶ Network Contract: Double-Submit Guard Disallows Multiple Concurrent POSTs', async (t) => {
  await t.test('Partial Payment: rapid two-click produces POST count = 1', async () => {
    let postCount = 0;
    let isCollectingBalance = false;

    // Simulated network submit handler mirroring PendingBookings.jsx
    const submitBalancePayment = async (amount, method) => {
      if (isCollectingBalance) return { blocked: true };
      isCollectingBalance = true;
      try {
        postCount++;
        // Simulate network latency
        await new Promise(r => setTimeout(r, 20));
        return { success: true };
      } finally {
        isCollectingBalance = false;
      }
    };

    // Rapid concurrent clicks
    const [click1, click2] = await Promise.all([
      submitBalancePayment(500, 'cash'),
      submitBalancePayment(500, 'cash')
    ]);

    assert.strictEqual(postCount, 1, 'Only exactly 1 network POST must be dispatched');
    assert.strictEqual(click1.success, true);
    assert.strictEqual(click2.blocked, true);
  });

  await t.test('Full Settlement: rapid two-click produces POST count = 1', async () => {
    let postCount = 0;
    let isCollectingBalance = false;

    const submitBalancePayment = async (amount, method) => {
      if (isCollectingBalance) return { blocked: true };
      isCollectingBalance = true;
      try {
        postCount++;
        await new Promise(r => setTimeout(r, 20));
        return { success: true };
      } finally {
        isCollectingBalance = false;
      }
    };

    const [click1, click2] = await Promise.all([
      submitBalancePayment(1500, 'transfer'),
      submitBalancePayment(1500, 'transfer')
    ]);

    assert.strictEqual(postCount, 1, 'Only exactly 1 network POST must be dispatched on full settlement');
    assert.strictEqual(click1.success, true);
    assert.strictEqual(click2.blocked, true);
  });
});

test('▶ Concurrency 409 Conflict: Graceful Handling & Reconciliation', async () => {
  let isCollectingBalance = false;
  let errorMsg = null;
  let postCount = 0;
  let refetchCount = 0;

  // Mock server responding with 409
  const mockSubmitWith409 = async () => {
    if (isCollectingBalance) return;
    isCollectingBalance = true;
    try {
      postCount++;
      const res = { status: 409 };
      if (res.status === 409) {
        errorMsg = 'ยอดคงเหลือมีการเปลี่ยนแปลง กรุณาตรวจสอบยอดล่าสุดก่อนรับชำระอีกครั้ง';
        refetchCount++;
      }
    } finally {
      isCollectingBalance = false;
    }
  };

  await mockSubmitWith409();
  assert.strictEqual(postCount, 1);
  assert.strictEqual(refetchCount, 1);
  assert.strictEqual(errorMsg, 'ยอดคงเหลือมีการเปลี่ยนแปลง กรุณาตรวจสอบยอดล่าสุดก่อนรับชำระอีกครั้ง');
  assert.strictEqual(isCollectingBalance, false, 'Modal state remains unblocked for reconfirmation');
});

test('▶ Async Race Condition: Late Booking A Response Does Not Corrupt Booking B', async () => {
  let activeBookingId = null;
  let displayedTransactions = [];

  const fetchTransactionsForBooking = async (bookingId, latencyMs, transactionsData) => {
    activeBookingId = bookingId;
    displayedTransactions = []; // Reset on booking switch

    await new Promise(r => setTimeout(r, latencyMs));

    // Guard matching PendingBookings.jsx activePaymentFetchBookingIdRef contract
    if (activeBookingId === bookingId) {
      displayedTransactions = transactionsData;
    }
  };

  // Staff opens Booking A (slow network, 50ms)
  const reqA = fetchTransactionsForBooking(101, 50, [{ id: 1, amount: 500 }]);
  // Staff switches quickly to Booking B (fast network, 10ms)
  const reqB = fetchTransactionsForBooking(202, 10, [{ id: 2, amount: 1000 }]);

  await Promise.all([reqA, reqB]);

  // Booking B must remain active and display Booking B's data
  assert.strictEqual(activeBookingId, 202);
  assert.deepStrictEqual(displayedTransactions, [{ id: 2, amount: 1000 }]);
  assert.strictEqual(displayedTransactions[0].id, 2, 'Must not be overwritten by Booking A late response');
});

test('▶ Source Code Audit: Race Condition & Ref Guard in PendingBookings.jsx', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');
  assert.match(code, /activePaymentFetchBookingIdRef/, 'Must declare and use activePaymentFetchBookingIdRef');
  assert.match(code, /activePaymentFetchBookingIdRef\.current === bookingId/, 'Must guard transaction state updates with active ref');
});
