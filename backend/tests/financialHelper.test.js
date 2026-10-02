const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  roundMoney,
  calculateDiscount,
  calculateBookingFinancials,
  calculateRescheduleFinancials
} = require('../financialHelper');

describe('financialHelper — Unit Tests', () => {
  describe('roundMoney', () => {
    test('rounds standard decimals correctly', () => {
      assert.strictEqual(roundMoney(10.555), 10.56);
      assert.strictEqual(roundMoney(10.554), 10.55);
      assert.strictEqual(roundMoney('2700.123'), 2700.12);
      assert.strictEqual(roundMoney(null), 0);
      assert.strictEqual(roundMoney(undefined), 0);
      assert.strictEqual(roundMoney(NaN), 0);
    });
  });

  describe('calculateDiscount', () => {
    test('handles none discount type', () => {
      const res = calculateDiscount(3000, 'none', 0);
      assert.deepStrictEqual(res, {
        discount_type: 'none',
        discount_value: 0,
        discount_amount: 0
      });
    });

    test('handles 10% discount', () => {
      const res = calculateDiscount(3000, 'percent', 10);
      assert.deepStrictEqual(res, {
        discount_type: 'percent',
        discount_value: 10,
        discount_amount: 300
      });
    });

    test('handles 100% discount', () => {
      const res = calculateDiscount(3000, 'percent', 100);
      assert.deepStrictEqual(res, {
        discount_type: 'percent',
        discount_value: 100,
        discount_amount: 3000
      });
    });

    test('handles fixed baht discount', () => {
      const res = calculateDiscount(3000, 'amount', 300);
      assert.deepStrictEqual(res, {
        discount_type: 'amount',
        discount_value: 300,
        discount_amount: 300
      });
    });

    test('handles fixed discount equal to subtotal', () => {
      const res = calculateDiscount(3000, 'amount', 3000);
      assert.deepStrictEqual(res, {
        discount_type: 'amount',
        discount_value: 3000,
        discount_amount: 3000
      });
    });

    test('rejects percent > 100', () => {
      assert.throws(() => {
        calculateDiscount(3000, 'percent', 101);
      }, /ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100%/);
    });

    test('rejects negative percent', () => {
      assert.throws(() => {
        calculateDiscount(3000, 'percent', -5);
      }, /ค่าส่วนลดต้องไม่ติดลบ/);
    });

    test('rejects amount > subtotal', () => {
      assert.throws(() => {
        calculateDiscount(3000, 'amount', 3500);
      }, /ต้องไม่เกินยอดรวมก่อนส่วนลด/);
    });

    test('rejects negative amount', () => {
      assert.throws(() => {
        calculateDiscount(3000, 'amount', -100);
      }, /ค่าส่วนลดต้องไม่ติดลบ/);
    });
  });

  describe('calculateBookingFinancials', () => {
    test('Full payment with 10% discount', () => {
      const fin = calculateBookingFinancials({
        subtotal: 3000,
        discount_type: 'percent',
        discount_value: 10,
        payment_mode: 'full'
      });
      assert.strictEqual(fin.subtotal_amount, 3000);
      assert.strictEqual(fin.discount_type, 'percent');
      assert.strictEqual(fin.discount_value, 10);
      assert.strictEqual(fin.discount_amount, 300);
      assert.strictEqual(fin.total_amount, 2700);
      assert.strictEqual(fin.paid_amount, 2700);
      assert.strictEqual(fin.balance_amount, 0);
      assert.strictEqual(fin.payment_status, 'paid');
      assert.strictEqual(fin.transaction_needed, true);
      assert.strictEqual(fin.transaction_type, 'full');
      assert.strictEqual(fin.transaction_amount, 2700);
    });

    test('Deposit payment with fixed discount', () => {
      const fin = calculateBookingFinancials({
        subtotal: 3000,
        discount_type: 'amount',
        discount_value: 300,
        payment_mode: 'deposit',
        deposit_amount: 1000
      });
      assert.strictEqual(fin.subtotal_amount, 3000);
      assert.strictEqual(fin.discount_amount, 300);
      assert.strictEqual(fin.total_amount, 2700);
      assert.strictEqual(fin.paid_amount, 1000);
      assert.strictEqual(fin.balance_amount, 1700);
      assert.strictEqual(fin.payment_status, 'deposit');
      assert.strictEqual(fin.transaction_needed, true);
      assert.strictEqual(fin.transaction_type, 'deposit');
      assert.strictEqual(fin.transaction_amount, 1000);
    });

    test('Deposit equal to total settles as full payment', () => {
      const fin = calculateBookingFinancials({
        subtotal: 3000,
        discount_type: 'none',
        payment_mode: 'deposit',
        deposit_amount: 3000
      });
      assert.strictEqual(fin.total_amount, 3000);
      assert.strictEqual(fin.paid_amount, 3000);
      assert.strictEqual(fin.balance_amount, 0);
      assert.strictEqual(fin.payment_status, 'paid');
      assert.strictEqual(fin.transaction_type, 'full');
    });

    test('Unpaid mode leaves full balance in pending', () => {
      const fin = calculateBookingFinancials({
        subtotal: 3000,
        discount_type: 'percent',
        discount_value: 10,
        payment_mode: 'unpaid'
      });
      assert.strictEqual(fin.total_amount, 2700);
      assert.strictEqual(fin.paid_amount, 0);
      assert.strictEqual(fin.balance_amount, 2700);
      assert.strictEqual(fin.payment_status, 'pending');
      assert.strictEqual(fin.transaction_needed, false);
    });

    test('Builtland internal_free bypasses payment and discount', () => {
      const fin = calculateBookingFinancials({
        subtotal: 3000,
        discount_type: 'percent',
        discount_value: 10,
        customer_type: 'builtland',
        payment_mode: 'deposit',
        deposit_amount: 500
      });
      assert.strictEqual(fin.subtotal_amount, 3000);
      assert.strictEqual(fin.discount_amount, 0);
      assert.strictEqual(fin.total_amount, 0);
      assert.strictEqual(fin.paid_amount, 0);
      assert.strictEqual(fin.balance_amount, 0);
      assert.strictEqual(fin.payment_status, 'internal_free');
      assert.strictEqual(fin.transaction_needed, false);
    });
  });

  describe('calculateRescheduleFinancials', () => {
    test('Preserves percent discount and recalculates new total and balance', () => {
      const oldBooking = {
        subtotal_amount: 3000,
        discount_type: 'percent',
        discount_value: 10,
        discount_amount: 300,
        total_amount: 2700,
        paid_amount: 1000,
        balance_amount: 1700,
        payment_status: 'deposit'
      };
      // Rescheduled to larger room: 3500 gross
      const fin = calculateRescheduleFinancials({
        oldBooking,
        newSubtotal: 3500
      });
      assert.strictEqual(fin.subtotal_amount, 3500);
      assert.strictEqual(fin.discount_type, 'percent');
      assert.strictEqual(fin.discount_value, 10);
      assert.strictEqual(fin.discount_amount, 350); // 10% of 3500
      assert.strictEqual(fin.total_amount, 3150); // 3500 - 350
      assert.strictEqual(fin.paid_amount, 1000); // 1000 preserved!
      assert.strictEqual(fin.balance_amount, 2150); // 3150 - 1000
      assert.strictEqual(fin.payment_status, 'deposit');
    });

    test('Preserves fixed amount discount and adjusts balance', () => {
      const oldBooking = {
        subtotal_amount: 3000,
        discount_type: 'amount',
        discount_value: 300,
        discount_amount: 300,
        total_amount: 2700,
        paid_amount: 1000,
        balance_amount: 1700,
        payment_status: 'deposit'
      };
      const fin = calculateRescheduleFinancials({
        oldBooking,
        newSubtotal: 3500
      });
      assert.strictEqual(fin.subtotal_amount, 3500);
      assert.strictEqual(fin.discount_type, 'amount');
      assert.strictEqual(fin.discount_amount, 300);
      assert.strictEqual(fin.total_amount, 3200);
      assert.strictEqual(fin.paid_amount, 1000);
      assert.strictEqual(fin.balance_amount, 2200);
      assert.strictEqual(fin.payment_status, 'deposit');
    });

    test('Rejects reschedule if new total is less than already paid amount', () => {
      const oldBooking = {
        subtotal_amount: 3000,
        discount_type: 'none',
        total_amount: 3000,
        paid_amount: 2000,
        balance_amount: 1000,
        payment_status: 'deposit'
      };
      // New room is only 1500
      assert.throws(() => {
        calculateRescheduleFinancials({
          oldBooking,
          newSubtotal: 1500
        });
      }, /ต่ำกว่ายอดเงินที่ชำระไปแล้ว/);
    });
  });
});
