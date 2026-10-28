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

export function normalizeBookingFinancials(booking = {}) {
  if (!booking) return null;
  const isBuiltland = booking.customer_type === 'builtland' || booking.billing_option === 'internal_free' || booking.payment_status === 'internal_free';
  if (isBuiltland) {
    return {
      subtotal_amount: 0,
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      total_amount: 0,
      paid_amount: 0,
      balance_amount: 0,
      payment_status: 'internal_free',
      is_internal_free: true,
      is_collectible: false,
      is_paid: true,
      is_deposit: false,
      is_pending: false,
      is_cancelled: false,
      is_reviewing: false,
      is_rejected: false
    };
  }

  const rawTotal = roundMoney(Math.max(0, Number(booking.total_amount) || 0));
  const rawSubtotal = booking.subtotal_amount !== undefined && booking.subtotal_amount !== null
    ? roundMoney(Math.max(0, Number(booking.subtotal_amount) || 0))
    : rawTotal;

  const discountType = String(booking.discount_type || 'none').toLowerCase().trim();
  const discountValue = Number(booking.discount_value || 0);
  const discountAmount = roundMoney(Math.max(0, Number(booking.discount_amount || 0)));

  // Fallbacks for legacy paid / pending
  let paidAmount = 0;
  if (booking.paid_amount !== undefined && booking.paid_amount !== null && !(Number(booking.paid_amount) === 0 && booking.payment_status === 'paid' && rawTotal > 0)) {
    paidAmount = roundMoney(Math.max(0, Number(booking.paid_amount) || 0));
  } else if (booking.payment_status === 'paid') {
    paidAmount = rawTotal;
  } else {
    paidAmount = 0;
  }

  const status = booking.payment_status || 'pending';
  const isCancelled = status === 'cancelled';
  const isFailed = status === 'failed';
  const isPaid = status === 'paid';
  const isDeposit = status === 'deposit';
  const isApprovedSlip = [
    'approved_manual',
    'manual_approved',
    'auto_approved',
    'approved',
    'verified'
  ].includes(booking.slip_verify_status);
  const isRejectedSlip = booking.slip_verify_status === 'rejected';

  // Reviewing strictly requires that payment has NOT been fully settled and is not cancelled or failed
  const isReviewing = !isPaid && !isCancelled && !isFailed && (
    status === 'reviewing' ||
    booking.slip_verify_status === 'pending_manual' ||
    (Boolean(booking.slip_image_url) && !isRejectedSlip && !isApprovedSlip)
  );
  const isRejected = status === 'rejected' || booking.slip_verify_status === 'rejected';
  const isPending = !isPaid && !isCancelled && !isDeposit && !isReviewing && !isRejected;

  // Authoritative derived remaining balance
  const derivedRemaining = roundMoney(Math.max(0, rawTotal - paidAmount));

  let balanceAmount = 0;
  if (isPaid || isCancelled || isFailed || rawTotal === 0) {
    balanceAmount = 0;
  } else if (booking.balance_amount !== undefined && booking.balance_amount !== null) {
    const candidateBalance = roundMoney(Math.max(0, Number(booking.balance_amount) || 0));
    // Stored balance_amount may only be used when consistent with authoritative derived remaining
    if (candidateBalance === derivedRemaining && candidateBalance > 0) {
      balanceAmount = candidateBalance;
    } else {
      balanceAmount = derivedRemaining;
    }
  } else {
    balanceAmount = derivedRemaining;
  }

  // Collectible if balance > 0 and status is collectible (deposit or pending; non-cancelled, non-reviewing, non-paid)
  const isCollectible = balanceAmount > 0 && !isCancelled && !isFailed && !isPaid && !isReviewing;

  return {
    subtotal_amount: rawSubtotal,
    discount_type: discountType,
    discount_value: discountValue,
    discount_amount: discountAmount,
    total_amount: rawTotal,
    paid_amount: paidAmount,
    balance_amount: balanceAmount,
    payment_status: status,
    is_internal_free: false,
    is_collectible: isCollectible,
    is_paid: isPaid,
    is_deposit: isDeposit,
    is_pending: isPending,
    is_cancelled: isCancelled,
    is_reviewing: isReviewing,
    is_rejected: isRejected
  };
}

export function getPaymentMethodLabel(method) {
  if (!method) return '-';
  switch (String(method).toLowerCase().trim()) {
    case 'cash': return 'เงินสด';
    case 'transfer': return 'โอนเงิน';
    case 'promptpay': return 'พร้อมเพย์';
    case 'card': return 'บัตร';
    case 'hour_credit': return 'เครดิตชั่วโมง';
    default: return method;
  }
}

export function getTransactionTypeLabel(type) {
  switch (String(type).toLowerCase().trim()) {
    case 'full': return 'ชำระเต็มจำนวน';
    case 'deposit': return 'เงินมัดจำ';
    case 'balance': return 'ชำระเพิ่มเติม';
    case 'refund': return 'คืนเงิน';
    default: return type || '-';
  }
}

export function calculateRescheduleFinancials({
  oldBooking,
  newSubtotal = 0
}) {
  if (!oldBooking) return { error: 'Missing booking data for reschedule', is_valid: false };
  const cleanNewSubtotal = roundMoney(Math.max(0, Number(newSubtotal) || 0));
  const isBuiltland = oldBooking.customer_type === 'builtland' || oldBooking.billing_option === 'internal_free' || oldBooking.payment_status === 'internal_free';

  if (isBuiltland) {
    return {
      subtotal_amount: cleanNewSubtotal,
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      total_amount: 0,
      paid_amount: 0,
      balance_amount: 0,
      payment_status: 'internal_free',
      is_valid: true,
      error: null
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
      return {
        subtotal_amount: cleanNewSubtotal,
        discount_type: finalDiscountType,
        discount_value: fixedAmount,
        discount_amount: fixedAmount,
        total_amount: 0,
        paid_amount: roundMoney(Math.max(0, Number(oldBooking.paid_amount || 0))),
        balance_amount: 0,
        payment_status: oldBooking.payment_status || 'pending',
        is_valid: false,
        error: `ส่วนลดเดิม (฿${formatMoney(fixedAmount)}) สูงกว่ายอดรวมใหม่ (฿${formatMoney(cleanNewSubtotal)}) กรุณาปรับเปลี่ยนส่วนลดก่อนทำรายการ`
      };
    }
    newDiscountValue = fixedAmount;
    newDiscountAmount = fixedAmount;
  }

  const newTotalAmount = roundMoney(Math.max(0, cleanNewSubtotal - newDiscountAmount));
  const currentPaid = roundMoney(Math.max(0, Number(oldBooking.paid_amount || 0)));

  if (newTotalAmount < currentPaid) {
    return {
      subtotal_amount: cleanNewSubtotal,
      discount_type: finalDiscountType,
      discount_value: newDiscountValue,
      discount_amount: newDiscountAmount,
      total_amount: newTotalAmount,
      paid_amount: currentPaid,
      balance_amount: 0,
      payment_status: oldBooking.payment_status || 'pending',
      is_valid: false,
      error: `ยอดสุทธิใหม่ (฿${formatMoney(newTotalAmount)}) ต่ำกว่ายอดเงินที่ชำระไปแล้ว (฿${formatMoney(currentPaid)}) ไม่สามารถเปลี่ยนเวลาได้`
    };
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
    payment_status: newPaymentStatus,
    is_valid: true,
    error: null
  };
}

export function getBookingUsageLifecycle(booking, now = new Date()) {
  if (!booking) {
    return { key: 'unknown', label: '-', is_active: false, is_completed: false, is_upcoming: false };
  }

  const items = Array.isArray(booking.items) && booking.items.length > 0
    ? booking.items
    : (booking.start_time && booking.end_time ? [booking] : []);

  if (items.length === 0) {
    return { key: 'unknown', label: '-', is_active: false, is_completed: false, is_upcoming: false };
  }

  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const it of items) {
    if (it.start_time) {
      const t = new Date(it.start_time).getTime();
      if (!isNaN(t) && t < minStart) minStart = t;
    }
    if (it.end_time) {
      const t = new Date(it.end_time).getTime();
      if (!isNaN(t) && t > maxEnd) maxEnd = t;
    }
  }

  if (!isFinite(minStart) || !isFinite(maxEnd)) {
    return { key: 'unknown', label: '-', is_active: false, is_completed: false, is_upcoming: false };
  }

  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();

  if (nowMs > maxEnd) {
    return {
      key: 'completed',
      label: 'สิ้นสุดเวลาการจองแล้ว',
      color: 'var(--text-muted, #64748b)',
      bg: 'var(--bg-subtle, #f1f5f9)',
      badgeClass: 'pb-usage-completed',
      is_active: false,
      is_completed: true,
      is_upcoming: false
    };
  }

  if (nowMs >= minStart && nowMs <= maxEnd) {
    return {
      key: 'active',
      label: 'กำลังใช้งานขณะนี้',
      color: '#ea580c',
      bg: 'rgba(234, 88, 12, 0.08)',
      badgeClass: 'pb-usage-active',
      is_active: true,
      is_completed: false,
      is_upcoming: false
    };
  }

  return {
    key: 'upcoming',
    label: 'รอเริ่มการใช้งาน',
    color: 'var(--primary-color, #2563eb)',
    bg: 'rgba(37, 99, 235, 0.08)',
    badgeClass: 'pb-usage-upcoming',
    is_active: false,
    is_completed: false,
    is_upcoming: true
  };
}

// Support CommonJS imports for Node.js test runners
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    roundMoney,
    formatMoney,
    calculateDiscountPreview,
    calculatePaymentPreview,
    normalizeBookingFinancials,
    getBookingUsageLifecycle,
    getPaymentMethodLabel,
    getTransactionTypeLabel,
    calculateRescheduleFinancials
  };
}
