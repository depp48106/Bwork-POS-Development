/**
 * financialUtils.js
 * Frontend Financial Engine & Validation for BWORK-POS Checkout (Phase 3)
 *
 * Adheres strictly to the Canonical Financial Engine rules defined in:
 * backend/financialHelper.js
 */

export function roundMoney(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value, includeSymbol = false) {
  const num = roundMoney(value);
  const formatted = num.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return includeSymbol ? `฿${formatted}` : formatted;
}

export function calculateDiscountPreview(subtotal = 0, type = 'none', value = 0) {
  const cleanSubtotal = roundMoney(Math.max(0, Number(subtotal) || 0));
  const normType = String(type || 'none').toLowerCase().trim();

  if (normType === 'none' || !normType) {
    return {
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      error: null
    };
  }

  // Raw string / empty handling
  if (value === '' || value === null || value === undefined) {
    return {
      discount_type: normType,
      discount_value: 0,
      discount_amount: 0,
      error: null
    };
  }

  const numVal = Number(value);
  if (isNaN(numVal)) {
    return {
      discount_type: normType,
      discount_value: value,
      discount_amount: 0,
      error: 'ค่าส่วนลดต้องเป็นตัวเลขที่ถูกต้อง'
    };
  }

  if (numVal < 0) {
    return {
      discount_type: normType,
      discount_value: numVal,
      discount_amount: 0,
      error: 'ค่าส่วนลดต้องไม่ติดลบ'
    };
  }

  if (normType === 'percent') {
    if (numVal > 100) {
      return {
        discount_type: 'percent',
        discount_value: numVal,
        discount_amount: 0,
        error: 'ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100%'
      };
    }
    const discountAmount = roundMoney((cleanSubtotal * numVal) / 100);
    return {
      discount_type: 'percent',
      discount_value: roundMoney(numVal),
      discount_amount: Math.min(cleanSubtotal, Math.max(0, discountAmount)),
      error: null
    };
  }

  if (normType === 'amount') {
    const cleanAmount = roundMoney(numVal);
    if (cleanAmount > cleanSubtotal) {
      return {
        discount_type: 'amount',
        discount_value: cleanAmount,
        discount_amount: cleanSubtotal,
        error: `ส่วนลดจำนวนเงิน (฿${formatMoney(cleanAmount)}) ต้องไม่เกินยอดรวมก่อนส่วนลด (฿${formatMoney(cleanSubtotal)})`
      };
    }
    return {
      discount_type: 'amount',
      discount_value: cleanAmount,
      discount_amount: cleanAmount,
      error: null
    };
  }

  return {
    discount_type: 'none',
    discount_value: 0,
    discount_amount: 0,
    error: `ประเภทส่วนลดไม่ถูกต้อง: '${type}'`
  };
}

export function calculatePaymentPreview({
  subtotal = 0,
  discountType = 'none',
  discountValue = 0,
  paymentMode = 'full',
  depositAmount = 0,
  customerType = 'walkin',
  billingOption = 'paid',
  paymentMethod = ''
}) {
  const cleanSubtotal = roundMoney(Math.max(0, Number(subtotal) || 0));
  const isBuiltland = customerType === 'builtland';
  const isInternalFree = isBuiltland || billingOption === 'internal_free';

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
      payment_mode: 'full',
      requires_payment_method: false,
      is_valid: true,
      error: null,
      deposit_error: null,
      discount_error: null
    };
  }

  // 2. Discount Preview
  const discountRes = calculateDiscountPreview(cleanSubtotal, discountType, discountValue);
  const totalAmount = roundMoney(Math.max(0, cleanSubtotal - discountRes.discount_amount));

  // 3. Payment Mode & Resolution
  const normMode = String(paymentMode || 'full').toLowerCase().trim();
  let paidAmount = 0;
  let balanceAmount = 0;
  let paymentStatus = 'paid';
  let requiresPaymentMethod = false;
  let depositError = null;

  if (totalAmount === 0) {
    // Zero-net booking (e.g. 100% discount)
    paidAmount = 0;
    balanceAmount = 0;
    paymentStatus = 'paid';
    requiresPaymentMethod = false;
  } else if (normMode === 'deposit') {
    requiresPaymentMethod = true;
    paymentStatus = 'deposit';

    const depRaw = Number(depositAmount);
    if (depositAmount === '' || depositAmount === null || depositAmount === undefined || isNaN(depRaw)) {
      depositError = 'กรุณาระบุยอดเงินมัดจำ';
      paidAmount = 0;
      balanceAmount = totalAmount;
    } else {
      const depVal = roundMoney(depRaw);
      if (depVal <= 0) {
        depositError = 'ยอดเงินมัดจำต้องมากกว่า 0 บาท';
        paidAmount = 0;
        balanceAmount = totalAmount;
      } else if (depVal >= totalAmount) {
        depositError = 'ยอดมัดจำต้องน้อยกว่ายอดสุทธิ หากต้องการชำระครบ กรุณาเลือกชำระเต็มจำนวน';
        paidAmount = depVal;
        balanceAmount = roundMoney(Math.max(0, totalAmount - depVal));
      } else {
        paidAmount = depVal;
        balanceAmount = roundMoney(totalAmount - depVal);
      }
    }
  } else if (normMode === 'unpaid' || normMode === 'pending') {
    paidAmount = 0;
    balanceAmount = totalAmount;
    paymentStatus = 'pending';
    requiresPaymentMethod = false;
  } else {
    // Default: 'full'
    paidAmount = totalAmount;
    balanceAmount = 0;
    paymentStatus = 'paid';
    requiresPaymentMethod = totalAmount > 0;
  }

  // 4. Overarching Validation
  let generalError = discountRes.error || depositError;
  if (!generalError && requiresPaymentMethod && !paymentMethod) {
    generalError = 'กรุณาเลือกช่องทางการชำระเงิน';
  }

  const isValid = !discountRes.error && !depositError && (!requiresPaymentMethod || !!paymentMethod);

  return {
    subtotal_amount: cleanSubtotal,
    discount_type: discountRes.discount_type,
    discount_value: discountRes.discount_value,
    discount_amount: discountRes.discount_amount,
    total_amount: totalAmount,
    paid_amount: paidAmount,
    balance_amount: balanceAmount,
    payment_status: paymentStatus,
    payment_mode: normMode,
    requires_payment_method: requiresPaymentMethod,
    is_valid: isValid,
    error: generalError,
    discount_error: discountRes.error,
    deposit_error: depositError
  };
}

// Support CommonJS imports for Node.js test runners
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    roundMoney,
    formatMoney,
    calculateDiscountPreview,
    calculatePaymentPreview
  };
}
