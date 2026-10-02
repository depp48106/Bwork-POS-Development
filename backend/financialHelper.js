/**
 * financialHelper.js
 * Canonical Financial Calculation Engine for BWORK-POS
 *
 * Strict Invariants:
 * 1. All money values rounded to 2 decimal places.
 * 2. subtotal_amount >= 0
 * 3. discount_amount >= 0 && discount_amount <= subtotal_amount
 * 4. total_amount = subtotal_amount - discount_amount (>= 0)
 * 5. paid_amount >= 0 && paid_amount <= total_amount
 * 6. balance_amount = total_amount - paid_amount (>= 0)
 * 7. Never allow negative financial values.
 */

function roundMoney(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function calculateDiscount(subtotal, type = 'none', value = 0) {
  const cleanSubtotal = roundMoney(Math.max(0, subtotal));
  const normType = String(type || 'none').toLowerCase().trim();

  if (normType === 'none' || !normType) {
    return {
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0
    };
  }

  const numVal = roundMoney(value);
  if (numVal < 0) {
    throw new Error('ค่าส่วนลดต้องไม่ติดลบ');
  }

  if (normType === 'percent') {
    if (numVal > 100) {
      throw new Error('ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100%');
    }
    const discountAmount = roundMoney((cleanSubtotal * numVal) / 100);
    return {
      discount_type: 'percent',
      discount_value: numVal,
      discount_amount: Math.min(cleanSubtotal, Math.max(0, discountAmount))
    };
  }

  if (normType === 'amount') {
    if (numVal > cleanSubtotal) {
      throw new Error(`ส่วนลดจำนวนเงิน (฿${numVal}) ต้องไม่เกินยอดรวมก่อนส่วนลด (฿${cleanSubtotal})`);
    }
    return {
      discount_type: 'amount',
      discount_value: numVal,
      discount_amount: Math.min(cleanSubtotal, Math.max(0, numVal))
    };
  }

  throw new Error(`ประเภทส่วนลดไม่ถูกต้อง: '${type}' (รองรับ: none, percent, amount)`);
}

function calculateBookingFinancials({
  subtotal = 0,
  discount_type = 'none',
  discount_value = 0,
  payment_mode = 'full',
  deposit_amount = 0,
  customer_type = 'walkin',
  billing_option = 'paid'
}) {
  const cleanSubtotal = roundMoney(Math.max(0, subtotal));
  const isBuiltland = customer_type === 'builtland';
  const isInternalFree = isBuiltland || billing_option === 'internal_free';

  // 1. Corporate Internal Free Bypass
  if (isInternalFree) {
    return {
      subtotal_amount: cleanSubtotal,
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      total_amount: 0,
      paid_amount: 0,
      balance_amount: 0,
      payment_status: 'internal_free',
      transaction_needed: false,
      transaction_type: null,
      transaction_amount: 0
    };
  }

  // 2. Calculate Discount
  const {
    discount_type: dt,
    discount_value: dv,
    discount_amount: da
  } = calculateDiscount(cleanSubtotal, discount_type, discount_value);

  // 3. Net Total
  const totalAmount = roundMoney(Math.max(0, cleanSubtotal - da));

  // 4. Payment Mode and Status Resolution
  const normMode = String(payment_mode || 'full').toLowerCase().trim();
  let paidAmount = 0;
  let balanceAmount = 0;
  let paymentStatus = 'paid';
  let transactionNeeded = false;
  let transactionType = null;

  if (totalAmount === 0) {
    // 100% discount or 0 price booking
    paidAmount = 0;
    balanceAmount = 0;
    paymentStatus = 'paid';
    transactionNeeded = false;
  } else if (normMode === 'deposit') {
    const depVal = roundMoney(deposit_amount);
    if (depVal <= 0) {
      throw new Error('ยอดเงินมัดจำต้องมากกว่า 0 บาท');
    }
    if (depVal >= totalAmount) {
      // Deposit equal to or exceeding total settles as full payment
      paidAmount = totalAmount;
      balanceAmount = 0;
      paymentStatus = 'paid';
      transactionNeeded = true;
      transactionType = 'full';
    } else {
      paidAmount = depVal;
      balanceAmount = roundMoney(totalAmount - paidAmount);
      paymentStatus = 'deposit';
      transactionNeeded = true;
      transactionType = 'deposit';
    }
  } else if (normMode === 'unpaid' || normMode === 'pending') {
    paidAmount = 0;
    balanceAmount = totalAmount;
    paymentStatus = 'pending';
    transactionNeeded = false;
  } else {
    // Default: 'full'
    paidAmount = totalAmount;
    balanceAmount = 0;
    paymentStatus = 'paid';
    transactionNeeded = true;
    transactionType = 'full';
  }

  // Enforce Invariants
  const diffDiscount = roundMoney(cleanSubtotal - da);
  if (totalAmount !== diffDiscount) {
    throw new Error(`Invariant Violation: total_amount (${totalAmount}) != subtotal (${cleanSubtotal}) - discount (${da})`);
  }
  const sumPaidBalance = roundMoney(paidAmount + balanceAmount);
  if (totalAmount !== sumPaidBalance) {
    throw new Error(`Invariant Violation: total_amount (${totalAmount}) != paid (${paidAmount}) + balance (${balanceAmount})`);
  }

  return {
    subtotal_amount: cleanSubtotal,
    discount_type: dt,
    discount_value: dv,
    discount_amount: da,
    total_amount: totalAmount,
    paid_amount: paidAmount,
    balance_amount: balanceAmount,
    payment_status: paymentStatus,
    transaction_needed: transactionNeeded,
    transaction_type: transactionType,
    transaction_amount: paidAmount
  };
}

function calculateRescheduleFinancials({
  oldBooking,
  newSubtotal = 0
}) {
  if (!oldBooking) throw new Error('Missing booking data for reschedule');
  const cleanNewSubtotal = roundMoney(Math.max(0, newSubtotal));
  const isBuiltland = oldBooking.customer_type === 'builtland' || oldBooking.billing_option === 'internal_free';

  if (isBuiltland) {
    return {
      subtotal_amount: cleanNewSubtotal,
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      total_amount: 0,
      paid_amount: 0,
      balance_amount: 0,
      payment_status: 'internal_free'
    };
  }

  const oldDiscountType = String(oldBooking.discount_type || 'none').toLowerCase().trim();
  const oldDiscountValue = Number(oldBooking.discount_value) || 0;
  const oldDiscountAmount = Number(oldBooking.discount_amount) || 0;

  let newDiscountAmount = 0;
  let newDiscountValue = 0;
  let finalDiscountType = 'none';

  if (oldDiscountType === 'percent') {
    finalDiscountType = 'percent';
    newDiscountValue = oldDiscountValue;
    newDiscountAmount = roundMoney((cleanNewSubtotal * oldDiscountValue) / 100);
  } else if (oldDiscountType === 'amount') {
    finalDiscountType = 'amount';
    const fixedAmount = oldDiscountAmount > 0 ? oldDiscountAmount : oldDiscountValue;
    if (fixedAmount > cleanNewSubtotal) {
      throw new Error(`ส่วนลดเดิม (฿${fixedAmount}) สูงกว่ายอดรวมใหม่ (฿${cleanNewSubtotal}) กรุณาปรับเปลี่ยนส่วนลดก่อนทำรายการ`);
    }
    newDiscountValue = fixedAmount;
    newDiscountAmount = fixedAmount;
  }

  const newTotalAmount = roundMoney(Math.max(0, cleanNewSubtotal - newDiscountAmount));
  const currentPaid = roundMoney(Math.max(0, Number(oldBooking.paid_amount || 0)));

  if (newTotalAmount < currentPaid) {
    throw new Error(`ยอดสุทธิใหม่ (฿${newTotalAmount}) ต่ำกว่ายอดเงินที่ชำระไปแล้ว (฿${currentPaid}) ไม่สามารถเปลี่ยนเวลาได้`);
  }

  const newBalanceAmount = roundMoney(newTotalAmount - currentPaid);
  let newPaymentStatus = 'pending';
  if (newBalanceAmount === 0) {
    newPaymentStatus = 'paid';
  } else if (currentPaid > 0) {
    newPaymentStatus = 'deposit';
  } else {
    newPaymentStatus = oldBooking.payment_status || 'pending';
  }

  return {
    subtotal_amount: cleanNewSubtotal,
    discount_type: finalDiscountType,
    discount_value: newDiscountValue,
    discount_amount: newDiscountAmount,
    total_amount: newTotalAmount,
    paid_amount: currentPaid,
    balance_amount: newBalanceAmount,
    payment_status: newPaymentStatus
  };
}

module.exports = {
  roundMoney,
  calculateDiscount,
  calculateBookingFinancials,
  calculateRescheduleFinancials
};
