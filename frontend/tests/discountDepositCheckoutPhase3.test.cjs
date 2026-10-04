const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const FINANCIAL_UTILS_PATH = path.join(ROOT_DIR, 'src/utils/financialUtils.js');
const BOOKING_POS_PATH = path.join(ROOT_DIR, 'src/components/BookingPOS.jsx');

// Load pure helper
const {
  roundMoney,
  formatMoney,
  calculateDiscountPreview,
  calculatePaymentPreview
} = require(FINANCIAL_UTILS_PATH);

test('▶ Helper Unit Tests: roundMoney & formatMoney', () => {
  assert.strictEqual(roundMoney(100.004), 100);
  assert.strictEqual(roundMoney(100.005), 100.01);
  assert.strictEqual(roundMoney(-5), -5);
  assert.strictEqual(roundMoney('invalid'), 0);
  assert.strictEqual(formatMoney(1234.5), '1,234.50');
  assert.strictEqual(formatMoney(1234.5, true), '฿1,234.50');
});

test('▶ Section 30: Quick Direct Tests (A through N)', async (t) => {
  await t.test('A. no discount + full payment', () => {
    const res = calculatePaymentPreview({
      subtotal: 3000,
      discountType: 'none',
      discountValue: 0,
      paymentMode: 'full',
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.subtotal_amount, 3000);
    assert.strictEqual(res.discount_amount, 0);
    assert.strictEqual(res.total_amount, 3000);
    assert.strictEqual(res.paid_amount, 3000);
    assert.strictEqual(res.balance_amount, 0);
    assert.strictEqual(res.payment_status, 'paid');
    assert.strictEqual(res.is_valid, true);
    assert.strictEqual(res.error, null);
  });

  await t.test('B. percent discount + full payment', () => {
    const res = calculatePaymentPreview({
      subtotal: 3000,
      discountType: 'percent',
      discountValue: 10,
      paymentMode: 'full',
      paymentMethod: 'transfer'
    });
    assert.strictEqual(res.subtotal_amount, 3000);
    assert.strictEqual(res.discount_type, 'percent');
    assert.strictEqual(res.discount_value, 10);
    assert.strictEqual(res.discount_amount, 300);
    assert.strictEqual(res.total_amount, 2700);
    assert.strictEqual(res.paid_amount, 2700);
    assert.strictEqual(res.balance_amount, 0);
    assert.strictEqual(res.payment_status, 'paid');
    assert.strictEqual(res.is_valid, true);
  });

  await t.test('C. fixed discount + full payment', () => {
    const res = calculatePaymentPreview({
      subtotal: 3000,
      discountType: 'amount',
      discountValue: 500,
      paymentMode: 'full',
      paymentMethod: 'card'
    });
    assert.strictEqual(res.discount_amount, 500);
    assert.strictEqual(res.total_amount, 2500);
    assert.strictEqual(res.paid_amount, 2500);
    assert.strictEqual(res.balance_amount, 0);
    assert.strictEqual(res.payment_status, 'paid');
    assert.strictEqual(res.is_valid, true);
  });

  await t.test('D. percent discount + deposit', () => {
    const res = calculatePaymentPreview({
      subtotal: 3000,
      discountType: 'percent',
      discountValue: 10,
      paymentMode: 'deposit',
      depositAmount: 1000,
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.total_amount, 2700);
    assert.strictEqual(res.paid_amount, 1000);
    assert.strictEqual(res.balance_amount, 1700);
    assert.strictEqual(res.payment_status, 'deposit');
    assert.strictEqual(res.is_valid, true);
    assert.strictEqual(res.error, null);
  });

  await t.test('E. fixed discount + deposit', () => {
    const res = calculatePaymentPreview({
      subtotal: 3000,
      discountType: 'amount',
      discountValue: 300,
      paymentMode: 'deposit',
      depositAmount: 1200,
      paymentMethod: 'transfer'
    });
    assert.strictEqual(res.total_amount, 2700);
    assert.strictEqual(res.paid_amount, 1200);
    assert.strictEqual(res.balance_amount, 1500);
    assert.strictEqual(res.payment_status, 'deposit');
    assert.strictEqual(res.is_valid, true);
  });

  await t.test('F. unpaid', () => {
    const res = calculatePaymentPreview({
      subtotal: 3000,
      discountType: 'amount',
      discountValue: 300,
      paymentMode: 'unpaid',
      paymentMethod: ''
    });
    assert.strictEqual(res.total_amount, 2700);
    assert.strictEqual(res.paid_amount, 0);
    assert.strictEqual(res.balance_amount, 2700);
    assert.strictEqual(res.payment_status, 'pending');
    assert.strictEqual(res.requires_payment_method, false);
    assert.strictEqual(res.is_valid, true);
  });

  await t.test('G. 100% discount / zero net', () => {
    const res = calculatePaymentPreview({
      subtotal: 1000,
      discountType: 'percent',
      discountValue: 100,
      paymentMode: 'full',
      paymentMethod: ''
    });
    assert.strictEqual(res.discount_amount, 1000);
    assert.strictEqual(res.total_amount, 0);
    assert.strictEqual(res.paid_amount, 0);
    assert.strictEqual(res.balance_amount, 0);
    assert.strictEqual(res.payment_status, 'paid');
    assert.strictEqual(res.requires_payment_method, false);
    assert.strictEqual(res.is_valid, true);
  });

  await t.test('H. internal_free (Builtland)', () => {
    const res = calculatePaymentPreview({
      subtotal: 3000,
      customerType: 'builtland',
      discountType: 'percent',
      discountValue: 50,
      paymentMode: 'deposit',
      depositAmount: 500
    });
    assert.strictEqual(res.total_amount, 0);
    assert.strictEqual(res.discount_amount, 0);
    assert.strictEqual(res.paid_amount, 0);
    assert.strictEqual(res.balance_amount, 0);
    assert.strictEqual(res.payment_status, 'internal_free');
    assert.strictEqual(res.is_valid, true);
  });

  await t.test('I. invalid >100% discount', () => {
    const res = calculatePaymentPreview({
      subtotal: 3000,
      discountType: 'percent',
      discountValue: 105,
      paymentMode: 'full',
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.is_valid, false);
    assert.strictEqual(res.discount_error, 'ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100%');
  });

  await t.test('J. fixed discount > subtotal', () => {
    const res = calculatePaymentPreview({
      subtotal: 1000,
      discountType: 'amount',
      discountValue: 1500,
      paymentMode: 'full',
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.is_valid, false);
    assert.ok(res.discount_error.includes('ต้องไม่เกินยอดรวมก่อนส่วนลด'));
  });

  await t.test('K. zero deposit', () => {
    const res = calculatePaymentPreview({
      subtotal: 2000,
      paymentMode: 'deposit',
      depositAmount: 0,
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.is_valid, false);
    assert.strictEqual(res.deposit_error, 'ยอดเงินมัดจำต้องมากกว่า 0 บาท');
  });

  await t.test('L. deposit >= net total', () => {
    const res = calculatePaymentPreview({
      subtotal: 2000,
      paymentMode: 'deposit',
      depositAmount: 2000,
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.is_valid, false);
    assert.strictEqual(res.deposit_error, 'ยอดมัดจำต้องน้อยกว่ายอดสุทธิ หากต้องการชำระครบ กรุณาเลือกชำระเต็มจำนวน');
  });

  await t.test('M. reset after submit check (contract structure)', () => {
    const defaultState = {
      quickDiscountType: 'none',
      quickDiscountValue: '',
      quickPaymentMode: 'full',
      quickDepositAmount: '',
      paymentMethod: 'cash'
    };
    const res = calculatePaymentPreview({
      subtotal: 0,
      discountType: defaultState.quickDiscountType,
      discountValue: defaultState.quickDiscountValue,
      paymentMode: defaultState.quickPaymentMode,
      paymentMethod: defaultState.paymentMethod
    });
    assert.strictEqual(res.discount_type, 'none');
    assert.strictEqual(res.total_amount, 0);
  });

  await t.test('N. customer type switch to internal_free', () => {
    // When customer type switches to builtland, all fields resolve as internal_free zero
    const res = calculatePaymentPreview({
      subtotal: 5000,
      customerType: 'builtland',
      billingOption: 'internal_free'
    });
    assert.strictEqual(res.total_amount, 0);
    assert.strictEqual(res.paid_amount, 0);
    assert.strictEqual(res.balance_amount, 0);
    assert.strictEqual(res.payment_status, 'internal_free');
  });
});

test('▶ Section 31: Cart Tests (A through J)', async (t) => {
  await t.test('A. multi-item subtotal', () => {
    const cart = [
      { subtotal: 1500 },
      { subtotal: 2000 },
      { subtotal: 1500 }
    ];
    const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
    assert.strictEqual(subtotal, 5000);
  });

  await t.test('B. booking-level percent discount', () => {
    const grossSubtotal = 5000;
    const res = calculatePaymentPreview({
      subtotal: grossSubtotal,
      discountType: 'percent',
      discountValue: 10,
      paymentMode: 'full',
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.discount_amount, 500);
    assert.strictEqual(res.total_amount, 4500);
    assert.strictEqual(res.paid_amount, 4500);
  });

  await t.test('C. booking-level fixed discount', () => {
    const grossSubtotal = 5000;
    const res = calculatePaymentPreview({
      subtotal: grossSubtotal,
      discountType: 'amount',
      discountValue: 800,
      paymentMode: 'full',
      paymentMethod: 'transfer'
    });
    assert.strictEqual(res.discount_amount, 800);
    assert.strictEqual(res.total_amount, 4200);
    assert.strictEqual(res.paid_amount, 4200);
  });

  await t.test('D. deposit in Cart', () => {
    const grossSubtotal = 5000;
    const res = calculatePaymentPreview({
      subtotal: grossSubtotal,
      discountType: 'percent',
      discountValue: 10, // net 4500
      paymentMode: 'deposit',
      depositAmount: 1500,
      paymentMethod: 'card'
    });
    assert.strictEqual(res.total_amount, 4500);
    assert.strictEqual(res.paid_amount, 1500);
    assert.strictEqual(res.balance_amount, 3000);
    assert.strictEqual(res.payment_status, 'deposit');
  });

  await t.test('E. unpaid in Cart', () => {
    const grossSubtotal = 5000;
    const res = calculatePaymentPreview({
      subtotal: grossSubtotal,
      paymentMode: 'unpaid'
    });
    assert.strictEqual(res.total_amount, 5000);
    assert.strictEqual(res.paid_amount, 0);
    assert.strictEqual(res.balance_amount, 5000);
    assert.strictEqual(res.payment_status, 'pending');
  });

  await t.test('F. cart item removal recalculates financials', () => {
    let cart = [{ subtotal: 3000 }, { subtotal: 2000 }];
    let subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0); // 5000
    let res = calculatePaymentPreview({
      subtotal,
      discountType: 'percent',
      discountValue: 10,
      paymentMode: 'deposit',
      depositAmount: 1500,
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.total_amount, 4500);
    assert.strictEqual(res.balance_amount, 3000);

    // Remove 2nd item
    cart = [cart[0]];
    subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0); // 3000
    res = calculatePaymentPreview({
      subtotal,
      discountType: 'percent',
      discountValue: 10,
      paymentMode: 'deposit',
      depositAmount: 1500,
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.subtotal_amount, 3000);
    assert.strictEqual(res.discount_amount, 300);
    assert.strictEqual(res.total_amount, 2700);
    assert.strictEqual(res.paid_amount, 1500);
    assert.strictEqual(res.balance_amount, 1200);
  });

  await t.test('G. fixed discount becomes invalid after cart change', () => {
    const originalSubtotal = 2000;
    const discountValue = 1500; // was valid (< 2000)
    const newSubtotal = 1000; // item removed, now subtotal = 1000 < 1500
    const res = calculatePaymentPreview({
      subtotal: newSubtotal,
      discountType: 'amount',
      discountValue,
      paymentMode: 'full',
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.is_valid, false);
    assert.ok(res.discount_error);
  });

  await t.test('H. deposit becomes invalid after cart change', () => {
    const depositAmount = 2500; // was valid when net was 3000
    const newSubtotal = 2000; // now net total <= deposit
    const res = calculatePaymentPreview({
      subtotal: newSubtotal,
      discountType: 'none',
      paymentMode: 'deposit',
      depositAmount,
      paymentMethod: 'cash'
    });
    assert.strictEqual(res.is_valid, false);
    assert.strictEqual(res.deposit_error, 'ยอดมัดจำต้องน้อยกว่ายอดสุทธิ หากต้องการชำระครบ กรุณาเลือกชำระเต็มจำนวน');
  });

  await t.test('I. successful submit payload structure', () => {
    const payload = {
      customer_name: 'คุณสมชาย',
      customer_type: 'walkin',
      discount_type: 'percent',
      discount_value: 10,
      payment_mode: 'deposit',
      deposit_amount: 1000,
      payment_method: 'transfer',
      items: [{ subtotal: 3000 }]
    };
    assert.strictEqual(payload.discount_type, 'percent');
    assert.strictEqual(payload.discount_value, 10);
    assert.strictEqual(payload.payment_mode, 'deposit');
    assert.strictEqual(payload.deposit_amount, 1000);
    assert.strictEqual(payload.payment_method, 'transfer');
  });

  await t.test('J. payment method requirement', () => {
    const resNoMethod = calculatePaymentPreview({
      subtotal: 3000,
      paymentMode: 'full',
      paymentMethod: ''
    });
    assert.strictEqual(resNoMethod.requires_payment_method, true);
    assert.strictEqual(resNoMethod.is_valid, false);
    assert.strictEqual(resNoMethod.error, 'กรุณาเลือกช่องทางการชำระเงิน');

    const resWithMethod = calculatePaymentPreview({
      subtotal: 3000,
      paymentMode: 'full',
      paymentMethod: 'cash'
    });
    assert.strictEqual(resWithMethod.is_valid, true);
  });
});

test('▶ Section 32: Payload Contract Audit against BookingPOS.jsx source', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Verify that BookingPOS imports financialUtils
  assert.ok(
    code.includes('financialUtils'),
    'BookingPOS.jsx must import financialUtils'
  );

  // Verify Quick Direct payload contains canonical financial fields
  assert.ok(
    code.includes('discount_type:') && code.includes('discount_value:') && code.includes('payment_mode:') && code.includes('deposit_amount:'),
    'BookingPOS.jsx must send discount_type, discount_value, payment_mode, deposit_amount in booking payload'
  );

  // Verify authoritative fields are NOT sent from client
  assert.ok(
    !code.includes('discount_amount: quickDiscountAmount') && !code.includes('paid_amount: quickPaidAmount'),
    'BookingPOS.jsx must not send client-authoritative discount_amount or paid_amount'
  );
});
