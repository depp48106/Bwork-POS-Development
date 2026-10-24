// Cloudflare Worker API for Bwork-POS & Booking App
// Unified single source of truth for Local & Production environments
// Features: Robust Auth, Sequential Receipts, Overlap Checking, Secure PINs, LINE Push, and R2 Slip Management

const JWT_SECRET = 'bwork-pos-secret-key-change-in-production';
const JWT_EXPIRY = 8 * 60 * 60 * 1000; // 8 hours

// ==========================================
// 1. CRYPTO & AUTH HELPERS
// ==========================================
async function hashPassword(password) {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ==========================================
// 1.15 ROOM WI-FI CREDENTIAL ENCRYPTION (WEB CRYPTO)
// ==========================================
const WIFI_PAYLOAD_REGEX = /^v1:([0-9a-fA-F]{24}):([0-9a-fA-F]{32}):([0-9a-fA-F]+)$/;

function parseWifiKeyWebCrypto(keyInput) {
  if (!keyInput || typeof keyInput !== 'string') {
    const err = new Error('WIFI_CREDENTIAL_ENCRYPTION_KEY is missing');
    err.code = 'ERR_WIFI_KEY_MISSING';
    throw err;
  }
  const trimmed = keyInput.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const match = trimmed.match(/.{1,2}/g) || [];
    return new Uint8Array(match.map(byte => parseInt(byte, 16)));
  }
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    if (bytes.length === 32) return bytes;
  }
  const err = new Error('WIFI_CREDENTIAL_ENCRYPTION_KEY must be a 256-bit key (64 hex characters or 44 base64 characters)');
  err.code = 'ERR_WIFI_KEY_INVALID';
  throw err;
}

async function encryptWifiPasswordWebCrypto(plaintext, rawKey, roomId) {
  if (plaintext === null || plaintext === undefined || typeof plaintext !== 'string') {
    throw new Error('Plaintext password must be a string');
  }
  if (!roomId && roomId !== 0) {
    throw new Error('roomId is required for room-specific AAD binding');
  }
  const keyBytes = rawKey instanceof Uint8Array ? rawKey : parseWifiKeyWebCrypto(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const aad = new TextEncoder().encode(`room:${roomId}`);
  const plainBytes = new TextEncoder().encode(plaintext);

  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    cryptoKey,
    plainBytes
  );

  const encryptedBytes = new Uint8Array(encryptedBuf);
  const ctBytes = encryptedBytes.slice(0, encryptedBytes.length - 16);
  const tagBytes = encryptedBytes.slice(encryptedBytes.length - 16);

  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  const tagHex = Array.from(tagBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const ctHex = Array.from(ctBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  return `v1:${ivHex}:${tagHex}:${ctHex}`;
}

async function decryptWifiPasswordWebCrypto(payload, rawKey, roomId) {
  if (!payload || typeof payload !== 'string') {
    const err = new Error('Invalid payload string');
    err.code = 'ERR_WIFI_BAD_PAYLOAD';
    throw err;
  }
  if (!roomId && roomId !== 0) {
    throw new Error('roomId is required for room-specific AAD verification');
  }
  const match = payload.trim().match(WIFI_PAYLOAD_REGEX);
  if (!match) {
    const err = new Error('Invalid ciphertext payload format (expected v1:<iv>:<tag>:<ct>)');
    err.code = 'ERR_WIFI_BAD_FORMAT';
    throw err;
  }
  const [, ivHex, tagHex, ctHex] = match;
  const keyBytes = rawKey instanceof Uint8Array ? rawKey : parseWifiKeyWebCrypto(rawKey);

  const ivMatch = ivHex.match(/.{1,2}/g) || [];
  const iv = new Uint8Array(ivMatch.map(b => parseInt(b, 16)));

  const tagMatch = tagHex.match(/.{1,2}/g) || [];
  const tag = new Uint8Array(tagMatch.map(b => parseInt(b, 16)));

  const ctMatch = ctHex.match(/.{1,2}/g) || [];
  const ct = new Uint8Array(ctMatch.map(b => parseInt(b, 16)));

  const aad = new TextEncoder().encode(`room:${roomId}`);

  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct, 0);
  combined.set(tag, ct.length);

  try {
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      cryptoKey,
      combined
    );
    return new TextDecoder().decode(decryptedBuf);
  } catch (err) {
    const authErr = new Error('Wi-Fi credential authentication failed (wrong key, wrong room, or tampered payload)');
    authErr.code = 'ERR_WIFI_AUTH_FAILED';
    authErr.originalError = err.message;
    throw authErr;
  }
}

// ==========================================
// 1.1 FINANCIAL & DISCOUNT/DEPOSIT HELPERS
// ==========================================
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

  const {
    discount_type: dt,
    discount_value: dv,
    discount_amount: da
  } = calculateDiscount(cleanSubtotal, discount_type, discount_value);

  const totalAmount = roundMoney(Math.max(0, cleanSubtotal - da));
  const normMode = String(payment_mode || 'full').toLowerCase().trim();
  let paidAmount = 0;
  let balanceAmount = 0;
  let paymentStatus = 'paid';
  let transactionNeeded = false;
  let transactionType = null;

  if (totalAmount === 0) {
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
    paidAmount = totalAmount;
    balanceAmount = 0;
    paymentStatus = 'paid';
    transactionNeeded = true;
    transactionType = 'full';
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

// ==========================================
// 1.2 ONLINE BOOKING PROMOTION HELPERS
// ==========================================
const DEFAULT_ONLINE_PROMOTION = {
  promotion_name: 'โปรโมชั่นจองออนไลน์',
  promotion_code: 'ONLINE_5_PERCENT',
  discount_type: 'percent',
  discount_value: 5,
  channel: 'online',
  start_at: '2026-10-13T08:00:00+07:00', // Asia/Bangkok
  end_at: null,
  is_enabled: false,
  activated_at: null,
  activated_by: null,
  deactivated_at: null,
  deactivated_by: null,
  updated_at: null,
  updated_by: null
};

function formatBangkokDateTime(iso) {
  try {
    const d = new Date(iso);
    const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const bkkMs = d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60 * 1000;
    const bkk = new Date(bkkMs);
    const day = bkk.getDate();
    const month = thMonths[bkk.getMonth()];
    const year = bkk.getFullYear();
    const h = String(bkk.getHours()).padStart(2, '0');
    const m = String(bkk.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} เวลา ${h}:${m}`;
  } catch (e) {
    return '13 ต.ค. 2026 เวลา 08:00';
  }
}

function getBangkokLocalISO(d = new Date()) {
  const now = (d instanceof Date) ? d : new Date(d);
  const bkkMs = now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60 * 1000;
  const bkk = new Date(bkkMs);
  const y = bkk.getFullYear();
  const m = String(bkk.getMonth() + 1).padStart(2, '0');
  const day = String(bkk.getDate()).padStart(2, '0');
  const h = String(bkk.getHours()).padStart(2, '0');
  const min = String(bkk.getMinutes()).padStart(2, '0');
  const sec = String(bkk.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}:${sec}`;
}

function parsePromotionState(raw) {
  if (!raw) return { ...DEFAULT_ONLINE_PROMOTION };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const discountVal = (parsed.discount_value !== undefined && parsed.discount_value !== null && !isNaN(Number(parsed.discount_value)))
      ? Math.round((Number(parsed.discount_value) + Number.EPSILON) * 100) / 100
      : DEFAULT_ONLINE_PROMOTION.discount_value;

    return {
      ...DEFAULT_ONLINE_PROMOTION,
      ...parsed,
      promotion_name: (typeof parsed.promotion_name === 'string' && parsed.promotion_name.trim())
        ? parsed.promotion_name.trim()
        : DEFAULT_ONLINE_PROMOTION.promotion_name,
      promotion_code: 'ONLINE_5_PERCENT',
      discount_type: 'percent',
      discount_value: discountVal,
      channel: 'online',
      start_at: parsed.start_at || DEFAULT_ONLINE_PROMOTION.start_at,
      end_at: (parsed.end_at !== undefined && parsed.end_at !== null && String(parsed.end_at).trim() !== '')
        ? parsed.end_at
        : null,
      is_enabled: Boolean(parsed.is_enabled)
    };
  } catch (e) {
    return { ...DEFAULT_ONLINE_PROMOTION };
  }
}

function resolveTimestampMs(input) {
  if (input === undefined || input === null) return Date.now();
  if (typeof input === 'number') return input;
  if (input instanceof Date) return input.getTime();
  const parsed = Date.parse(input);
  return isNaN(parsed) ? Date.now() : parsed;
}

function isPromotionActive(promo, currentTime = Date.now(), channel = 'online') {
  if (channel !== 'online') return false;
  const promoState = parsePromotionState(promo);
  if (!promoState.is_enabled) return false;

  const nowMs = resolveTimestampMs(currentTime);
  const startMs = Date.parse(promoState.start_at || DEFAULT_ONLINE_PROMOTION.start_at);
  if (isNaN(startMs) || nowMs < startMs) return false;

  if (promoState.end_at) {
    const endMs = Date.parse(promoState.end_at);
    if (!isNaN(endMs) && nowMs >= endMs) return false;
  }

  return true;
}

function canActivatePromotion(promo, currentTime = Date.now()) {
  const promoState = parsePromotionState(promo);
  const nowMs = resolveTimestampMs(currentTime);
  const startMs = Date.parse(promoState.start_at || DEFAULT_ONLINE_PROMOTION.start_at);

  if (isNaN(startMs) || nowMs < startMs) {
    const dateFormatted = formatBangkokDateTime(promoState.start_at || DEFAULT_ONLINE_PROMOTION.start_at);
    return {
      allowed: false,
      reason: `ยังไม่ถึงเวลาเปิดใช้งานโปรโมชั่น (เปิดใช้งานได้ตั้งแต่ ${dateFormatted})`
    };
  }

  if (promoState.end_at) {
    const endMs = Date.parse(promoState.end_at);
    if (!isNaN(endMs) && nowMs >= endMs) {
      return {
        allowed: false,
        reason: 'โปรโมชั่นสิ้นสุดระยะเวลาแล้ว'
      };
    }
  }

  return { allowed: true };
}

function getPromotionStatus(promo, currentTime = Date.now()) {
  const promoState = parsePromotionState(promo);
  const nowMs = resolveTimestampMs(currentTime);
  const startMs = Date.parse(promoState.start_at || DEFAULT_ONLINE_PROMOTION.start_at);

  if (promoState.end_at) {
    const endMs = Date.parse(promoState.end_at);
    if (!isNaN(endMs) && nowMs >= endMs) {
      return { status: 'ended', label: 'สิ้นสุดแล้ว' };
    }
  }

  if (isNaN(startMs) || nowMs < startMs) {
    return { status: 'upcoming', label: 'รอเปิดใช้งาน' };
  }

  if (promoState.is_enabled) {
    return { status: 'active', label: 'กำลังใช้งาน' };
  }

  return { status: 'ready', label: 'พร้อมเปิดใช้งาน' };
}

function getPublicPromotionPayload(promo, currentTime = Date.now()) {
  const promoState = parsePromotionState(promo);
  const active = isPromotionActive(promoState, currentTime, 'online');
  return {
    is_active: active,
    discount_type: 'percent',
    discount_value: promoState.discount_value,
    start_at: promoState.start_at,
    end_at: promoState.end_at || null,
    channel: 'online',
    promotion_name: promoState.promotion_name || 'โปรโมชั่นจองออนไลน์'
  };
}

function calculateOnlineBookingPricing({ subtotal, promo, currentTime = Date.now() }) {
  const num = Number(subtotal);
  const cleanSubtotal = isNaN(num) ? 0 : Math.round((Math.max(0, num) + Number.EPSILON) * 100) / 100;
  const active = isPromotionActive(promo, currentTime, 'online');
  const promoState = parsePromotionState(promo);

  if (!active) {
    return {
      subtotal_amount: cleanSubtotal,
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      total_amount: cleanSubtotal,
      is_promotion_applied: false
    };
  }

  const discountVal = promoState.discount_value;
  const rawDiscount = (cleanSubtotal * discountVal) / 100;
  const discountAmount = Math.round((rawDiscount + Number.EPSILON) * 100) / 100;
  const totalAmount = Math.round((Math.max(0, cleanSubtotal - discountAmount) + Number.EPSILON) * 100) / 100;

  return {
    subtotal_amount: cleanSubtotal,
    discount_type: 'percent',
    discount_value: discountVal,
    discount_amount: discountAmount,
    total_amount: totalAmount,
    is_promotion_applied: true
  };
}

function validatePromotionUpdatePayload(payload, currentPromoState) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'ข้อมูลการตั้งค่าโปรโมชั่นไม่ถูกต้อง' };
  }

  if (currentPromoState && Boolean(currentPromoState.is_enabled)) {
    return {
      valid: false,
      error: 'กรุณาหยุดโปรโมชั่นก่อนแก้ไขการตั้งค่า'
    };
  }

  let promotionName = DEFAULT_ONLINE_PROMOTION.promotion_name;
  if (payload.promotion_name !== undefined) {
    if (typeof payload.promotion_name === 'string' && payload.promotion_name.trim()) {
      promotionName = payload.promotion_name.trim();
    }
  } else if (currentPromoState?.promotion_name) {
    promotionName = currentPromoState.promotion_name;
  }

  if (payload.discount_value === undefined || payload.discount_value === null || String(payload.discount_value).trim() === '') {
    return { valid: false, error: 'กรุณาระบุเปอร์เซ็นต์ส่วนลด' };
  }
  const discountNum = Number(payload.discount_value);
  if (isNaN(discountNum) || !isFinite(discountNum)) {
    return { valid: false, error: 'ส่วนลดต้องเป็นตัวเลขที่ถูกต้อง' };
  }
  if (discountNum < 0.01 || discountNum > 100) {
    return { valid: false, error: 'ส่วนลดต้องอยู่ระหว่าง 0.01% ถึง 100%' };
  }
  const roundedDiscount = Math.round((discountNum + Number.EPSILON) * 100) / 100;

  if (!payload.start_at || typeof payload.start_at !== 'string' || !payload.start_at.trim()) {
    return { valid: false, error: 'กรุณาระบุวันและเวลาเริ่มต้นโปรโมชั่น' };
  }
  const startMs = Date.parse(payload.start_at.trim());
  if (isNaN(startMs)) {
    return { valid: false, error: 'วันและเวลาเริ่มต้นโปรโมชั่นไม่ถูกต้อง' };
  }
  const cleanStartAt = payload.start_at.trim();

  let cleanEndAt = null;
  if (payload.end_at !== undefined && payload.end_at !== null && String(payload.end_at).trim() !== '') {
    const endMs = Date.parse(String(payload.end_at).trim());
    if (isNaN(endMs)) {
      return { valid: false, error: 'วันและเวลาสิ้นสุดโปรโมชั่นไม่ถูกต้อง' };
    }
    if (endMs <= startMs) {
      return { valid: false, error: 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้นโปรโมชั่น' };
    }
    cleanEndAt = String(payload.end_at).trim();
  }

  return {
    valid: true,
    data: {
      promotion_name: promotionName,
      discount_value: roundedDiscount,
      start_at: cleanStartAt,
      end_at: cleanEndAt
    }
  };
}

function base64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

async function createToken(payload) {
  try {
    const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64urlEncode(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + JWT_EXPIRY }));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${header}.${body}`)
    );
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const signatureBinary = String.fromCharCode(...signatureArray);
    const signature = btoa(signatureBinary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${header}.${body}.${signature}`;
  } catch (e) {
    return 'token_' + Date.now();
  }
}

async function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    let sigStr = signature.replace(/-/g, '+').replace(/_/g, '/');
    while (sigStr.length % 4) sigStr += '=';
    const sigBinary = atob(sigStr);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      encoder.encode(`${header}.${body}`)
    );
    if (!isValid) return null;
    const payload = JSON.parse(base64urlDecode(body));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function safeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
async function authenticateUser(request, env, requiredRole = null) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return { error: 'กรุณาเข้าสู่ระบบ (Token not provided)', status: 401 };
  }
  const payload = await verifyToken(token);
  if (!payload || !payload.id) {
    return { error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', status: 401 };
  }
  const user = await env.DB.prepare("SELECT id, username, role, permissions, fullname FROM users WHERE id = ?").bind(payload.id).first();
  if (!user) {
    return { error: 'ไม่พบข้อมูลผู้ใช้นี้ในระบบ', status: 401 };
  }
  if (user.role) {
    const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(user.role).first();
    if (roleRecord && typeof roleRecord.permissions === 'string') {
      user.permissions = roleRecord.permissions;
    }
  }
  if (user.permissions === null || user.permissions === undefined) {
    user.permissions = user.role === 'admin'
      ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation'
      : 'pos,pending,layout,manage,history,quotations';
  }
  if (requiredRole && user.role !== requiredRole) {
    return { error: 'ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (สำหรับผู้ดูแลระบบเท่านั้น)', status: 403 };
  }
  return { user };
}

// ==========================================
// 2. TIMESTAMPS & OVERLAP HELPERS
// ==========================================
function normalizeToLocalISO(dateStr, timeStr) {
  if (!dateStr) return '';
  if (timeStr) {
    let cleanTime = String(timeStr).trim();
    if (cleanTime.length === 5) cleanTime += ':00';
    const cleanDate = String(dateStr).trim().split('T')[0].split(' ')[0];
    return `${cleanDate}T${cleanTime}`;
  }
  if (typeof dateStr === 'string') {
    let s = dateStr.trim();
    // YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD HH:MM:SS format without timezone
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      s = s.replace(' ', 'T');
      if (s.length === 16) s += ':00';
      return s;
    }
    // Has timezone offset (e.g. Z or +07:00)
    if (s.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const bkkMs = d.getTime() + 7 * 60 * 60 * 1000;
        const bkk = new Date(bkkMs);
        const y = bkk.getUTCFullYear();
        const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
        const day = String(bkk.getUTCDate()).padStart(2, '0');
        const h = String(bkk.getUTCHours()).padStart(2, '0');
        const min = String(bkk.getUTCMinutes()).padStart(2, '0');
        const sec = String(bkk.getUTCSeconds()).padStart(2, '0');
        return `${y}-${m}-${day}T${h}:${min}:${sec}`;
      }
    }
    if (s.includes('T')) {
      const parts = s.split('T');
      const timePart = parts[1].split('.')[0];
      const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
      return `${parts[0]}T${cleanTime}`;
    }
    if (s.includes(' ')) {
      const parts = s.split(' ');
      const timePart = parts[1].split('.')[0];
      const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
      return `${parts[0]}T${cleanTime}`;
    }
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const bkkMs = d.getTime() + 7 * 60 * 60 * 1000;
  const bkk = new Date(bkkMs);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bkk.getUTCDate()).padStart(2, '0');
  const h = String(bkk.getUTCHours()).padStart(2, '0');
  const min = String(bkk.getUTCMinutes()).padStart(2, '0');
  const sec = String(bkk.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}:${sec}`;
}

async function getCleaningBufferMinutes(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cleaning_buffer_minutes'").first();
    if (row && row.value) {
      const val = parseInt(row.value, 10);
      if (!isNaN(val)) return val;
    }
  } catch (e) {}
  return 30;
}

async function checkRoomOverlap(env, roomId, startISO, endISO, excludeBookingId = null, excludeBookingItemId = null) {
  const normStart = normalizeToLocalISO(startISO);
  const normEnd = normalizeToLocalISO(endISO);
  const bufferMins = await getCleaningBufferMinutes(env);
  const bufferMs = bufferMins * 60 * 1000;

  const reqStartMs = new Date(normStart.replace(' ', 'T')).getTime();
  const reqEndMs = new Date(normEnd.replace(' ', 'T')).getTime();
  const reqEndBufferedMs = reqEndMs + bufferMs;

  let query = `
    SELECT bi.id, bi.booking_id, bi.start_time, bi.end_time, b.customer_name, b.payment_status
    FROM booking_items bi
    JOIN bookings b ON bi.booking_id = b.id
    WHERE bi.room_id = ?
      AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
  `;
  const params = [roomId];
  if (excludeBookingItemId) {
    query += " AND bi.id != ?";
    params.push(excludeBookingItemId);
  } else if (excludeBookingId) {
    query += " AND b.id != ?";
    params.push(excludeBookingId);
  }

  const { results: bookings } = await env.DB.prepare(query).bind(...params).all();
  for (const b of (bookings || [])) {
    if (!b.start_time || !b.end_time) continue;
    const bStartNorm = normalizeToLocalISO(b.start_time);
    const bEndNorm = normalizeToLocalISO(b.end_time);
    const bStartMs = new Date(bStartNorm.replace(' ', 'T')).getTime();
    const bEndMs = new Date(bEndNorm.replace(' ', 'T')).getTime();
    const bEndBufferedMs = bEndMs + bufferMs;

    const [bEndDate, bEndTime] = bEndNorm.split('T');
    const [bEndH, bEndM] = (bEndTime || '00:00').substring(0, 5).split(':').map(Number);
    const totalBufferedMins = bEndH * 60 + bEndM + bufferMins;
    const bufH = Math.floor(totalBufferedMins / 60) % 24;
    const bufM = totalBufferedMins % 60;
    const bufHHMM = `${String(bufH).padStart(2, '0')}:${String(bufM).padStart(2, '0')}`;
    const endBufferedISO = `${bEndDate}T${bufHHMM}:00`;

    // Overlap condition taking 30-min cleaning buffer into account:
    // (Requested Start < Existing End + Buffer) AND (Requested End + Buffer > Existing Start)
    if (reqStartMs < bEndBufferedMs && reqEndBufferedMs > bStartMs) {
      const isDirectUsage = (reqStartMs < bEndMs && reqEndMs > bStartMs);
      const isNextQueueBuffer = !isDirectUsage && (reqEndMs <= bStartMs);
      return {
        hasOverlap: true,
        overlap: true,
        isCleaningBuffer: !isDirectUsage,
        isNextQueueBuffer,
        bufferMinutes: bufferMins,
        booking: {
          ...b,
          start_time: bStartNorm,
          end_time: bEndNorm,
          end_buffered_time: endBufferedISO
        }
      };
    }
  }
  return { hasOverlap: false, overlap: false, bufferMinutes: bufferMins };
}

function formatOverlapErrorMessage(roomName, overlapResult) {
  const b = (overlapResult && overlapResult.booking) || {};
  const sTime = b.start_time && b.start_time.includes('T') ? b.start_time.split('T')[1].substring(0, 5) : (b.start_time || '');
  const eTime = b.end_time && b.end_time.includes('T') ? b.end_time.split('T')[1].substring(0, 5) : (b.end_time || '');
  const nextAvail = b.end_buffered_time && b.end_buffered_time.includes('T') ? b.end_buffered_time.split('T')[1].substring(0, 5) : eTime;

  const customer = b.customer_name ? `คุณ ${b.customer_name}` : 'ลูกค้า';
  const nameLabel = roomName ? `ห้อง "${roomName}"` : 'ห้องนี้';

  if (overlapResult.isCleaningBuffer) {
    if (overlapResult.isNextQueueBuffer) {
      return `${nameLabel} ต้องมีเวลาทำความสะอาด (${overlapResult.bufferMinutes || 30} นาที) ก่อนคิวถัดไป (${customer} เริ่มเวลา ${sTime} น.)`;
    }
    if (nextAvail >= '18:00') {
      return `${nameLabel} อยู่ในช่วงเวลาทำความสะอาด (${overlapResult.bufferMinutes || 30} นาที) ต่อจากคิว${customer} (ใช้งานถึง ${eTime} น.) จนถึงเวลาปิดทำการ (18:00 น.)`;
    }
    return `${nameLabel} อยู่ในช่วงเวลาทำความสะอาด (${overlapResult.bufferMinutes || 30} นาที) ต่อจากคิว${customer} (ใช้งานถึง ${eTime} น.) สามารถจองได้ตั้งแต่เวลา ${nextAvail} น. เป็นต้นไป`;
  }
  return `${nameLabel} ไม่ว่างในช่วงเวลาดังกล่าว (มีผู้ใช้งาน: ${customer} ช่วงเวลา ${sTime} - ${eTime} น.)`;
}

// ==========================================
// 3. SEQUENTIAL RECEIPT & QUOTATION NUMBER GENERATORS
// ==========================================
async function generateReceiptNumber(env) {
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bkkDate = new Date(Date.now() + bangkokOffsetMs);
  const yy = String(bkkDate.getUTCFullYear()).slice(-2);
  const mm = String(bkkDate.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `BK-${yy}${mm}`;

  const lastRow = await env.DB.prepare(
    "SELECT receipt_number FROM bookings WHERE receipt_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).bind(`${prefix}%`).first();

  let seq = 1;
  if (lastRow && lastRow.receipt_number) {
    const rawSeq = lastRow.receipt_number.replace(prefix, '').replace(/^-/, '');
    const lastNum = parseInt(rawSeq, 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

async function generateQuotationNumber(env) {
  const now = new Date();
  const year2 = String(now.getFullYear()).slice(-2);
  const month2 = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `QT-${year2}${month2}-`;

  const lastRow = await env.DB.prepare(
    "SELECT quotation_no FROM quotations WHERE quotation_no LIKE ? ORDER BY id DESC LIMIT 1"
  ).bind(`${prefix}%`).first();

  let seq = 1;
  if (lastRow && lastRow.quotation_no) {
    const match = lastRow.quotation_no.match(/(\d+)$/);
    if (match) {
      const lastNum = parseInt(match[1], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function generateUniquePinCode(env) {
  let pin = String(Math.floor(100000 + Math.random() * 900000));
  let existing = await env.DB.prepare(
    "SELECT id FROM bookings WHERE pin_code = ? AND (checkin_status IS NULL OR checkin_status != 'expired')"
  ).bind(pin).first();
  let tries = 0;
  while (existing && tries < 10) {
    pin = String(Math.floor(100000 + Math.random() * 900000));
    existing = await env.DB.prepare(
      "SELECT id FROM bookings WHERE pin_code = ? AND (checkin_status IS NULL OR checkin_status != 'expired')"
    ).bind(pin).first();
    tries++;
  }
  return pin;
}

// Stable no-PIN room IDs (ID 10: Jupiter (300), ID 12: Jupiter (300) & Co-Working, ID 13: เหมาโซน Co-working)
const NO_PIN_ROOM_IDS = [10, 12, 13];
const JUPITER_ROOM_IDS = NO_PIN_ROOM_IDS;

/**
 * Returns whether a room physically uses/requires a door lock PIN.
 * Rooms 10, 12, and 13 do NOT have a door keypad or PIN lock mechanism.
 * Primary rule: Check stable no-PIN room IDs (10, 12, 13).
 * Defensive fallback: Check if room name includes 'jupiter' (case-insensitive).
 */
function roomUsesDoorPin(roomOrId) {
  if (!roomOrId) return false;
  if (typeof roomOrId === 'number') {
    return !NO_PIN_ROOM_IDS.includes(roomOrId);
  }
  if (typeof roomOrId === 'string' && /^\d+$/.test(roomOrId.trim())) {
    const parsedId = parseInt(roomOrId.trim(), 10);
    return !NO_PIN_ROOM_IDS.includes(parsedId);
  }
  if (typeof roomOrId === 'object') {
    const rId = Number(roomOrId.room_id || roomOrId.id);
    if (rId && NO_PIN_ROOM_IDS.includes(rId)) {
      return false;
    }
    const name = String(roomOrId.name || roomOrId.room_name || '').trim();
    if (name && /jupiter/i.test(name)) {
      return false;
    }
    if (roomOrId.pin_code && String(roomOrId.pin_code).trim() && String(roomOrId.pin_code).trim() !== '-') {
      return true;
    }
    if (roomOrId.builtland_pin_code && String(roomOrId.builtland_pin_code).trim()) {
      return true;
    }
  }
  return true;
}

// ==========================================
// 3.5 ROOM HOUR CREDIT HELPERS
// ==========================================
const formatHourCreditDurationThai = minutes => {
  const m = Math.abs(Number(minutes) || 0);
  return `${Math.floor(m / 60)} ชั่วโมง ${m % 60} นาที`;
};

function parseHourCreditTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::00)?$/.test(value)) {
    throw Object.assign(new Error('Use Bangkok wall time YYYY-MM-DDTHH:mm, whole minutes'), { statusCode: 400 });
  }
  const local = value.replace(' ', 'T').slice(0, 16) + ':00';
  const ms = Date.parse(local + '+07:00');
  if (!Number.isFinite(ms) || new Date(ms + 7 * 3600000).toISOString().slice(0, 19) !== local) {
    throw Object.assign(new Error('Invalid date/time'), { statusCode: 400 });
  }
  return { local, ms };
}

function buildHourCreditVoucherFlex({ credit_id, room_name, remaining_minutes, sent_at }) {
  const remainingText = typeof formatHourCreditDurationThai === 'function'
    ? formatHourCreditDurationThai(remaining_minutes)
    : formatDurationThai(remaining_minutes);

  const rawSent = sent_at || new Date(Date.now() + 7 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
  const sentMatch = String(rawSent).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  const sentDisplay = sentMatch ? `${sentMatch[3]}/${sentMatch[2]}/${sentMatch[1]} ${sentMatch[4]}:${sentMatch[5]}` : rawSent;

  return {
    type: 'flex',
    altText: `เครดิตชั่วโมงคงเหลือ ${credit_id} - ${remainingText}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-hour-credit-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'เครดิตชั่วโมง',
            size: 'xl',
            weight: 'bold',
            color: '#0f172a'
          },
          {
            type: 'text',
            text: 'สิทธิ์ชั่วโมงคงเหลือสำหรับใช้บริการห้องประชุม',
            size: 'xs',
            color: '#64748b',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'Credit ID', size: 'sm', color: '#64748b', flex: 3 },
                  { type: 'text', text: String(credit_id), size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end', wrap: true }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ห้องอ้างอิง', size: 'sm', color: '#64748b', flex: 3 },
                  { type: 'text', text: String(room_name || '-'), size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'เวลาที่ส่ง', size: 'sm', color: '#64748b', flex: 3 },
                  { type: 'text', text: `${sentDisplay} (เวลาไทย)`, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            backgroundColor: '#f0fdf4',
            cornerRadius: '10px',
            borderWidth: '1px',
            borderColor: '#bbf7d0',
            paddingAll: '16px',
            alignItems: 'center',
            contents: [
              { type: 'text', text: 'จำนวนชั่วโมงคงเหลือ', size: 'xs', color: '#166534', weight: 'bold', align: 'center' },
              { type: 'text', text: remainingText, size: 'xxl', weight: 'bold', color: '#15803d', align: 'center', margin: 'xs' }
            ]
          },
          {
            type: 'text',
            text: 'สามารถใช้กับห้องที่เข้าเงื่อนไขอัตราค่าบริการเดียวกัน',
            size: 'xxs',
            color: '#64748b',
            wrap: true,
            margin: 'sm',
            align: 'center'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#312e81',
            height: 'md',
            action: {
              type: 'message',
              label: 'แสดง Credit ID',
              text: String(credit_id)
            }
          }
        ]
      }
    }
  };
}

async function createHourCreditFingerprint(kind, creditId, input, actor, allowed) {
  if (!Number.isSafeInteger(actor) || actor <= 0) {
    throw Object.assign(new Error('Staff identity required'), { statusCode: 403 });
  }
  if (!input || typeof input !== 'object' || Object.keys(input).some(k => !allowed.includes(k))) {
    throw Object.assign(new Error('Unsupported credit fields'), { statusCode: 400 });
  }
  if (typeof input.idempotency_key !== 'string' || !/^[\w:-]{8,120}$/.test(input.idempotency_key)) {
    throw Object.assign(new Error('Idempotency key required (8-120 characters)'), { statusCode: 400 });
  }
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) {
    throw Object.assign(new Error('Reason required'), { statusCode: 400 });
  }
  const payload = Object.fromEntries(Object.keys(input).sort().map(k => [k, input[k]]));
  const raw = JSON.stringify({ kind, creditId, actor, payload });
  const msgUint8 = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function nextWorkerHourCreditId(db, createdAt) {
  const dateCode = String(createdAt).slice(2, 10).replace(/-/g, '');
  if (!/^\d{6}$/.test(dateCode)) throw Object.assign(new Error('Cannot generate Credit ID'), { statusCode: 500 });
  const prefix = `HC-${dateCode}-`;
  const row = await db.prepare(`SELECT MAX(CAST(substr(credit_id, 11, 4) AS INTEGER)) AS max_suffix
    FROM room_hour_credits WHERE credit_id GLOB ?`).bind(`${prefix}[0-9][0-9][0-9][0-9]`).first();
  const suffix = Number(row?.max_suffix || 0) + 1;
  if (suffix > 9999) throw Object.assign(new Error('Daily Credit ID limit reached'), { statusCode: 503 });
  return prefix + String(suffix).padStart(4, '0');
}

async function getWorkerHourCreditDetail(db, id) {
  const c = await db.prepare(`SELECT c.credit_id, c.source_booking_id, c.source_item_id, c.customer_name, c.customer_phone, c.line_user_id, c.room_id, c.created_by, c.created_at,
    b.receipt_number AS source_reference, r.name AS room_name, r.hourly_rate AS source_hourly_rate
    FROM room_hour_credits c JOIN bookings b ON b.id = c.source_booking_id JOIN rooms r ON r.id = c.room_id WHERE c.credit_id = ?`).bind(id).first();
  if (!c) return null;

  const historyRes = await db.prepare(`SELECT e.id, e.entry_type, e.minutes_delta, e.booking_item_id, e.reverses_entry_id, e.reason, e.created_by, e.created_at,
    i.start_time, i.end_time, i.room_id, r.name AS room_name, b.id AS booking_id, b.receipt_number AS booking_reference, b.payment_status
    FROM room_hour_credit_entries e LEFT JOIN booking_items i ON i.id = e.booking_item_id
    LEFT JOIN rooms r ON r.id = i.room_id LEFT JOIN bookings b ON b.id = i.booking_id WHERE e.credit_id = ? ORDER BY e.id`).bind(id).all();
  const history = historyRes?.results || [];

  const total = type => history.filter(e => e.entry_type === type).reduce((n, e) => n + e.minutes_delta, 0);
  const remaining = history.reduce((n, e) => n + e.minutes_delta, 0);
  const has_line = Boolean(c.line_user_id && c.line_user_id.trim());
  delete c.line_user_id;

  return {
    ...c,
    has_line,
    original_granted_minutes: total('grant'),
    redeemed_minutes: -total('redeem') - total('reversal'),
    remaining_minutes: remaining,
    status: remaining === 0 ? 'exhausted' : remaining === total('grant') ? 'available' : 'partially_used',
    history
  };
}

async function replayHourCreditEntry(db, key, fingerprint) {
  const e = await db.prepare('SELECT * FROM room_hour_credit_entries WHERE idempotency_key = ?').bind(key).first();
  if (!e) return null;
  if (e.request_fingerprint !== fingerprint) {
    throw Object.assign(new Error('Idempotency key already used with a different request'), { statusCode: 409 });
  }
  let bookingId = null;
  if (e.booking_item_id) {
    const item = await db.prepare('SELECT booking_id FROM booking_items WHERE id = ?').bind(e.booking_item_id).first();
    bookingId = item?.booking_id ?? null;
  }
  return {
    credit_id: e.credit_id,
    entry_id: e.id,
    entry_type: e.entry_type,
    minutes_delta: e.minutes_delta,
    booking_id: bookingId,
    booking_item_id: e.booking_item_id
  };
}

async function checkHourCreditMutationGuard(env, pathname, method) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return null;
  if (method === 'POST' && pathname.endsWith('/send-pin')) return null;

  try {
    const tableExists = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='room_hour_credits'").first();
    if (!tableExists) return null;

    if (pathname === '/api/admin/clear-history') {
      const hasCredit = await env.DB.prepare('SELECT credit_id FROM room_hour_credits LIMIT 1').first();
      if (hasCredit) {
        return { error: 'History contains hour credit; clearing is disabled', status: 409 };
      }
      return null;
    }

    if (pathname.startsWith('/api/bookings/')) {
      const parts = pathname.replace('/api/bookings/', '').split('/');
      const ref = decodeURIComponent(parts[0] || '');
      if (!ref) return null;

      const b = await env.DB.prepare('SELECT id, billing_option, payment_method FROM bookings WHERE id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)').bind(ref, ref, ref).first();
      if (!b) return null;

      const linked = await env.DB.prepare('SELECT e.id FROM room_hour_credit_entries e JOIN booking_items i ON i.id = e.booking_item_id WHERE i.booking_id = ? LIMIT 1').bind(b.id).first();
      if (linked || b.billing_option === 'hour_credit' || b.payment_method === 'hour_credit') {
        return { error: 'Use hour-credit reversal; generic booking mutations are disabled', status: 409 };
      }

      if (method === 'DELETE') {
        const sourceLinked = await env.DB.prepare('SELECT credit_id FROM room_hour_credits WHERE source_booking_id = ?').bind(b.id).first();
        if (sourceLinked) {
          return { error: 'Source booking is linked to hour credit', status: 409 };
        }
      }
    }
  } catch (err) {
    return { error: 'Unable to verify hour-credit mutation safety', status: 503 };
  }
  return null;
}

function checkStaffPosAuth(auth) {
  if (auth.error) return { error: auth.error, status: auth.status };
  const user = auth.user;
  if (!user || (!Number.isSafeInteger(user.id)) || user.id <= 0) {
    return { error: 'Staff identity required', status: 403 };
  }
  if (user.role !== 'admin' && user.username !== 'admin') {
    const perms = (user.permissions || '').split(',').map(p => p.trim());
    if (!perms.includes('hour-credits')) {
      return { error: 'ไม่มีสิทธิ์เข้าถึงระบบเครดิตชั่วโมง', status: 403 };
    }
  }
  return null;
}

function checkAdminSystemAuth(auth) {
  if (auth.error) return { error: auth.error, status: auth.status };
  const user = auth.user;
  if (!user || (!Number.isSafeInteger(user.id)) || user.id <= 0) {
    return { error: 'กรุณาเข้าสู่ระบบ', status: 401 };
  }
  if (user.role === 'admin') return null;
  const perms = (user.permissions || '').split(',').map(p => p.trim());
  if (perms.includes('admin-system') || perms.includes('admin-management') || perms.includes('admin-users')) {
    return null;
  }
  return { error: 'ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (สำหรับผู้ดูแลระบบเท่านั้น)', status: 403 };
}

function checkAdminPromotionAuth(auth) {
  if (auth.error) return { error: auth.error, status: auth.status };
  const user = auth.user;
  if (!user || (!Number.isSafeInteger(user.id)) || user.id <= 0) {
    return { error: 'กรุณาเข้าสู่ระบบ', status: 401 };
  }
  if (user.role === 'admin') return null;
  const perms = (user.permissions || '').split(',').map(p => p.trim());
  if (perms.includes('admin-promotion') || perms.includes('admin-promotions') || perms.includes('admin-management')) {
    return null;
  }
  return { error: 'ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (สำหรับผู้ดูแลระบบหรือผู้ได้รับสิทธิ์ตั้งค่าโปรโมชั่นเท่านั้น)', status: 403 };
}

// ==========================================
// 4. FILE UPLOAD & R2 HELPERS
// ==========================================
function validateFileMagicBytes(bytes, contentType) {
  if (!bytes || bytes.length < 4) return false;
  // JPEG: FF D8 FF
  if (contentType.includes('jpeg') || contentType.includes('jpg')) {
    return bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  }
  // PNG: 89 50 4E 47
  if (contentType.includes('png')) {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  }
  // WEBP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
  if (contentType.includes('webp')) {
    if (bytes.length < 12) return false;
    const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    return isRiff && isWebp;
  }
  // PDF: %PDF (25 50 44 46)
  if (contentType.includes('pdf')) {
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }
  return true;
}

async function saveUploadedFile(env, fileData, folder = 'uploads', metadata = {}) {
  if (!fileData) return null;
  if (typeof fileData === 'string' && fileData.startsWith('data:')) {
    const matches = fileData.match(/^data:([A-Za-z0-9\-\+\/\.]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 data URL format');
    }
    const contentType = matches[1].toLowerCase();
    const base64Data = matches[2];
    const binaryStr = atob(base64Data);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Magic Bytes Validation
    if (!validateFileMagicBytes(bytes, contentType)) {
      throw new Error('File content corrupted or does not match declared MIME type (' + contentType + ')');
    }

    const ext = contentType.includes('pdf') ? 'pdf' : (contentType.includes('webp') ? 'webp' : (contentType.includes('png') ? 'png' : ((contentType.includes('jpeg') || contentType.includes('jpg')) ? 'jpeg' : 'bin')));
    const uniqueId = String(Date.now()) + '_' + Math.random().toString(36).substring(2, 8);

    // Structured Object Key Design
    let filename;
    if (folder === 'slips' || folder === 'payment-slips') {
      const bId = metadata.bookingId || metadata.booking_id;
      const pId = metadata.paymentId || metadata.payment_id || 'initial';
      if (bId) {
        filename = 'payment-slips/' + bId + '/' + pId + '/' + uniqueId + '.' + ext;
      } else {
        filename = 'payment-slips/' + uniqueId + '.' + ext;
      }
    } else if (folder === 'tax-invoices' || folder === 'tax_invoices') {
      const bId = metadata.bookingId || metadata.booking_id;
      if (bId) {
        filename = 'tax-invoices/' + bId + '/' + uniqueId + '.' + ext;
      } else {
        filename = 'tax-invoices/' + uniqueId + '.' + ext;
      }
    } else {
      const sanitizedFolder = String(folder).replace(/[^a-zA-Z0-9_\-]/g, '');
      filename = (sanitizedFolder || 'uploads') + '/' + uniqueId + '.' + ext;
    }

    const r2Bucket = env.BUCKET || env.SLIP_BUCKET;
    if (r2Bucket) {
      const customMetadata = {
        uploaded_at: new Date().toISOString(),
        file_size: String(bytes.byteLength),
        content_type: contentType
      };
      if (metadata.bookingId || metadata.booking_id) customMetadata.booking_id = String(metadata.bookingId || metadata.booking_id);
      if (metadata.paymentId || metadata.payment_id) customMetadata.payment_id = String(metadata.paymentId || metadata.payment_id);
      if (metadata.uploadedBy || metadata.uploaded_by) customMetadata.uploaded_by = String(metadata.uploadedBy || metadata.uploaded_by);
      if (metadata.invoiceNumber || metadata.invoice_number) customMetadata.invoice_number = String(metadata.invoiceNumber || metadata.invoice_number);

      await r2Bucket.put(filename, bytes.buffer, {
        httpMetadata: {
          contentType,
          contentDisposition: metadata.download ? 'attachment' : 'inline'
        },
        customMetadata
      });
      return '/uploads/' + filename;
    } else {
      const isFinancial = folder.includes('slip') || folder.includes('tax');
      if (isFinancial) {
        throw new Error('R2 storage bucket is not configured. Financial documents cannot be stored as raw base64.');
      }
      return fileData;
    }
  }
  return fileData;
}

// ==========================================
// THAI BANK SLIP MINI QR VERIFIER & PARSER
// ==========================================
const BANK_CODES = {
  '002': { code: '002', name: 'ธนาคารกรุงเทพ', shortName: 'BBL' },
  '004': { code: '004', name: 'ธนาคารกสิกรไทย', shortName: 'KBANK' },
  '006': { code: '006', name: 'ธนาคารกรุงไทย', shortName: 'KTB' },
  '011': { code: '011', name: 'ธนาคารทหารไทยธนชาต', shortName: 'TTB' },
  '014': { code: '014', name: 'ธนาคารไทยพาณิชย์', shortName: 'SCB' },
  '025': { code: '025', name: 'ธนาคารกรุงศรีอยุธยา', shortName: 'BAY' },
  '030': { code: '030', name: 'ธนาคารออมสิน', shortName: 'GSB' },
  '034': { code: '034', name: 'ธ.ก.ส.', shortName: 'BAAC' },
  '065': { code: '065', name: 'ธนาคารธนชาต', shortName: 'TBANK' },
  '069': { code: '069', name: 'ธนาคารเกียรตินาคินภัทร', shortName: 'KKP' },
  '073': { code: '073', name: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', shortName: 'LHBANK' },
  '098': { code: '098', name: 'SME D Bank', shortName: 'SME' }
};
const KNOWN_BANK_CODES = Object.keys(BANK_CODES);

function parseTLV(str) {
  const result = {};
  let i = 0;
  while (i < str.length) {
    const tag = str.substring(i, i + 2);
    const len = parseInt(str.substring(i + 2, i + 4), 10);
    if (isNaN(len) || len < 0) break;
    const val = str.substring(i + 4, i + 4 + len);
    result[tag] = val;
    i += 4 + len;
  }
  return result;
}

function parseThaiBankSlipQR(qrString) {
  if (!qrString || typeof qrString !== 'string') return null;

  try {
    const root = parseTLV(qrString);

    // Format A: ITMX / SCB / Thai Bank Transfer Slip Mini QR
    if (root['00'] && root['00'].length > 10) {
      const sub00 = parseTLV(root['00']);
      const bankCode = sub00['01'];
      const transRef = sub00['02'];

      if (bankCode && KNOWN_BANK_CODES.includes(bankCode) && transRef) {
        return {
          isValidSlipQR: true,
          isMerchantPaymentQR: false,
          bankCode: bankCode,
          bankName: BANK_CODES[bankCode]?.name || 'ธนาคารไทย',
          transRef: transRef,
          countryCode: root['51'] || 'TH',
          rawQR: qrString
        };
      }
    }

    // Format B: EMVCo PromptPay Standard Slip Mini QR
    if (root['00'] === '01') {
      const isStaticPaymentQR = root['01'] === '11';
      const hasMerchantInfo = !!(root['59'] || root['60'] || root['52']);

      if (isStaticPaymentQR || hasMerchantInfo) {
        return {
          isValidSlipQR: false,
          isMerchantPaymentQR: true,
          rejectionReason: 'รูปภาพที่อัปโหลดคือ QR Code สำหรับสแกนจ่ายเงิน (Payment QR) ไม่ใช่สลิปหลักฐานการโอนเงินสำเร็จของธนาคาร'
        };
      }

      for (let tag = 26; tag <= 50; tag++) {
        const tagStr = String(tag).padStart(2, '0');
        if (root[tagStr]) {
          const sub = parseTLV(root[tagStr]);
          if (sub['00'] && sub['00'].toUpperCase().includes('ITMX') && sub['02']) {
            return {
              isValidSlipQR: true,
              isMerchantPaymentQR: false,
              bankCode: sub['01'] || '004',
              bankName: BANK_CODES[sub['01']]?.name || 'ธนาคารกสิกรไทย',
              transRef: sub['02'],
              rawQR: qrString
            };
          }
        }
      }
    }

    return { isValidSlipQR: false, isMerchantPaymentQR: false, rawQR: qrString };
  } catch (e) {
    return { isValidSlipQR: false, isMerchantPaymentQR: false, error: e.message };
  }
}

// ==========================================
// 5. LINE OA FLEX MESSAGE BUILDERS
// ==========================================

function formatRescheduleTimeDisplay(startTime, endTime) {
  if (!startTime) return '-';
  try {
    const sStr = String(startTime).replace(' ', 'T');
    const dateStr = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = endTime ? String(endTime).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    const timeStr = (sTime && eTime) ? `${sTime} - ${eTime} น.` : (sTime ? `${sTime} น.` : '');
    return timeStr ? `${dateStr} (${timeStr})` : dateStr;
  } catch (e) {
    return String(startTime);
  }
}

function formatThaiDateDisplay(isoString) {
  if (!isoString) return '-';
  try {
    const cleanStr = String(isoString).replace(' ', 'T');
    const [datePart] = cleanStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const months = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiYear = y + 543;
    return `${d} ${months[m - 1]} ${thaiYear}`;
  } catch (e) {
    return String(isoString);
  }
}

// 1. Flex Message: ยืนยันการจองห้องประชุมสำเร็จ (ไม่แสดงรหัสผ่านในขั้นตอนนี้)
function buildLineBookingConfirmationFlex(booking, item, room) {
  const customerName = booking?.customer_name || 'ลูกค้าคนพิเศษ';
  const roomName = room?.name || 'ห้องประชุม B-WORK';
  const receiptNo = booking?.receipt_number || `BK-${String(booking?.id || 0).padStart(6, '0')}`;

  let dateDisplay = '-';
  let timeDisplay = '-';
  if (item?.start_time) {
    const sStr = String(item.start_time).replace(' ', 'T');
    dateDisplay = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = item?.end_time ? String(item.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = (sTime && eTime) ? `${sTime} - ${eTime} น.` : (sTime ? `${sTime} น.` : '-');
  } else if (booking?.date) {
    dateDisplay = formatThaiDateDisplay(booking.date);
    if (booking?.start_time) {
      timeDisplay = `${booking.start_time} - ${booking.end_time || ''} น.`.trim();
    }
  }

  return {
    type: 'flex',
    altText: `ยืนยันการจองสำเร็จ - ${roomName} - ${receiptNo}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-confirmation-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'ยืนยันการจอง',
            size: 'xl',
            weight: 'bold',
            color: '#0f172a'
          },
          {
            type: 'text',
            text: 'การจองห้องประชุมของคุณเสร็จสมบูรณ์',
            size: 'xs',
            color: '#64748b',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'รหัสการจอง', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: receiptNo, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ชื่อลูกค้า', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: customerName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ห้องประชุม', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: roomName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'วันที่ใช้งาน', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: dateDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'เวลา', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: timeDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            paddingAll: '14px',
            backgroundColor: '#ecfdf5',
            cornerRadius: '10px',
            borderWidth: '1px',
            borderColor: '#a7f3d0',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'สถานะการชำระเงิน', size: 'xs', color: '#065f46', flex: 3 },
                  { type: 'text', text: 'ชำระแล้ว', size: 'xs', weight: 'bold', color: '#059669', align: 'end', flex: 2 }
                ]
              },
              {
                type: 'text',
                text: 'สามารถรับรหัสเข้าห้องเมื่อถึงเวลาใช้งาน หรือติดต่อเคาน์เตอร์ประชาสัมพันธ์',
                size: 'xxs',
                color: '#047857',
                wrap: true,
                margin: 'sm'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: 'ดูรายละเอียดการจอง',
              uri: 'https://bwork-booking.pages.dev/status'
            },
            style: 'primary',
            color: '#065f46',
            height: 'md'
          }
        ]
      }
    }
  };
}

// 2. Flex Message: ส่งรหัสผ่านเปิดประตูห้องประชุม (Door PIN Dispatch)
function buildLineDoorPinFlex(booking, item, room) {
  const roomName = room?.name || item?.room_name || 'ห้องประชุม B-WORK';
  // LINE OA must ALWAYS send Customer Access Code only
  const pinCode = (room && room.pin_code && room.pin_code.trim()) ? room.pin_code.trim() : (booking?.pin_code || '------');

  let dateDisplay = '-';
  let timeDisplay = '-';
  if (item?.start_time) {
    const sStr = String(item.start_time).replace(' ', 'T');
    dateDisplay = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = item?.end_time ? String(item.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = (sTime && eTime) ? `${sTime} - ${eTime} น.` : (sTime ? `${sTime} น.` : '-');
  } else if (booking?.created_at || booking?.date) {
    const sStr = String(booking.date || booking.created_at).replace(' ', 'T');
    dateDisplay = formatThaiDateDisplay(sStr);
    if (booking?.start_time) {
      timeDisplay = `${booking.start_time} - ${booking.end_time || ''} น.`.trim();
    }
  }

  return {
    type: 'flex',
    altText: `รหัสเข้าห้อง ${roomName}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-door-pin-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'รหัสเข้าห้อง',
            size: 'xl',
            weight: 'bold',
            color: '#0f172a'
          },
          {
            type: 'text',
            text: 'กดรหัสผ่านที่ประตูก่อนเข้าใช้งานห้องประชุม',
            size: 'xs',
            color: '#64748b',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ห้องประชุม', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: roomName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'วันที่ใช้งาน', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: dateDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'เวลา', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: timeDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            paddingAll: '16px',
            backgroundColor: '#f0f9ff',
            cornerRadius: '12px',
            borderWidth: '1px',
            borderColor: '#bae6fd',
            alignItems: 'center',
            contents: [
              { type: 'text', text: 'รหัสเข้าห้อง (PIN)', size: 'xs', weight: 'bold', color: '#0369a1', align: 'center' },
              { type: 'text', text: pinCode, size: '3xl', weight: 'bold', color: '#0f172a', align: 'center', margin: 'xs' },
              { type: 'text', text: 'กดรหัส 6 หลัก ตามด้วย #', size: 'xs', weight: 'bold', color: '#0f172a', align: 'center', margin: 'xs' },
              { type: 'text', text: 'รหัสนี้ใช้ได้เฉพาะในวันและเวลาที่จอง', size: 'xxs', color: '#64748b', align: 'center', margin: 'xs' }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: 'ดูรายละเอียดการจอง',
              uri: 'https://bwork-booking.pages.dev/status'
            },
            style: 'primary',
            color: '#0284c7',
            height: 'md'
          }
        ]
      }
    }
  };
}

/**
 * Lowest reliable dispatch helper for LINE push messages.
 * HARD-BLOCK IN STAGING: When env.ENVIRONMENT === 'staging', zero HTTP requests are issued to LINE APIs.
 * Returns { sent: false, mocked: true, status: 200, success: true, ok: true }.
 * Never logs tokens or customer PII.
 */
async function dispatchLineMessagePush(env, channelAccessToken, { to, messages }) {
  if (env && (env.ENVIRONMENT === 'staging' || env.DISABLE_LIVE_LINE === 'true')) {
    return {
      sent: false,
      mocked: true,
      status: 200,
      ok: true,
      success: true,
      reason: 'staging_environment_mock'
    };
  }

  if (!channelAccessToken) {
    return {
      sent: false,
      mocked: false,
      status: 401,
      ok: false,
      success: false,
      reason: 'no_channel_access_token'
    };
  }

  const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelAccessToken}`
    },
    body: JSON.stringify({ to, messages })
  });

  return {
    sent: lineRes.ok,
    mocked: false,
    status: lineRes.status,
    ok: lineRes.ok,
    success: lineRes.ok,
    response: lineRes
  };
}

async function sendLineBookingConfirmation(env, bookingId) {
  try {
    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;

    const item = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first() : null;

    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;

    const flexCard = buildLineBookingConfirmationFlex(booking, item, room);

    const dispatch = await dispatchLineMessagePush(env, channelAccessToken, {
      to: booking.line_user_id,
      messages: [flexCard]
    });

    if (dispatch.mocked) {
      return { success: true, sent: false, mocked: true, status: 200 };
    }
    if (!dispatch.ok) return null;
    return { success: dispatch.ok, status: dispatch.status, sent: dispatch.sent };
  } catch (err) {
    console.error('Error sending confirmation message:', err);
    return null;
  }
}

async function sendLineDoorPin(env, bookingId) {
  try {
    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;

    const item = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first() : null;

    if (!roomUsesDoorPin(room || item?.room_id)) return null;

    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;

    const flexCard = buildLineDoorPinFlex(booking, item, room);

    const dispatch = await dispatchLineMessagePush(env, channelAccessToken, {
      to: booking.line_user_id,
      messages: [flexCard]
    });

    if (dispatch.mocked) {
      return { success: true, sent: false, mocked: true, status: 200 };
    }
    if (!dispatch.ok) return null;
    return { success: dispatch.ok, status: dispatch.status, sent: dispatch.sent };
  } catch (err) {
    console.error('Error sending door pin message:', err);
    return null;
  }
}

// 3. Flex Message: แจ้งยกเลิกการจองห้องประชุม
function buildLineBookingCancellationFlex(booking, roomNameOrItem, reasonOrRoom, itemOrReason) {
  let item = null;
  let roomName = '';
  let reason = '';

  if (roomNameOrItem && typeof roomNameOrItem === 'object') {
    item = roomNameOrItem;
    roomName = (reasonOrRoom && typeof reasonOrRoom === 'object') ? reasonOrRoom?.name : (typeof reasonOrRoom === 'string' ? reasonOrRoom : (booking?.room_name || 'ห้องประชุม B-WORK'));
    reason = (typeof itemOrReason === 'string') ? itemOrReason : '';
  } else {
    roomName = (typeof roomNameOrItem === 'string' && roomNameOrItem) ? roomNameOrItem : (booking?.room_name || 'ห้องประชุม B-WORK');
    reason = (typeof reasonOrRoom === 'string') ? reasonOrRoom : (typeof itemOrReason === 'string' ? itemOrReason : '');
    item = (itemOrReason && typeof itemOrReason === 'object') ? itemOrReason : null;
  }

  const bookingCode = booking?.receipt_number || `#BK-${String(booking?.id || 0).padStart(6, '0')}`;
  const cancelReason = reason || 'ไม่ได้ทำการชำระเงินภายในเวลาที่กำหนด (15 นาที)';

  let dateDisplay = '-';
  let timeDisplay = '-';
  const timeSource = item?.start_time ? item : booking;
  if (timeSource?.start_time) {
    const sStr = String(timeSource.start_time).replace(' ', 'T');
    dateDisplay = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = timeSource.end_time ? String(timeSource.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = (sTime && eTime) ? `${sTime} - ${eTime} น.` : (sTime ? `${sTime} น.` : '-');
  } else if (booking?.date) {
    dateDisplay = formatThaiDateDisplay(booking.date);
    if (booking?.start_time) {
      timeDisplay = `${booking.start_time} - ${booking.end_time || ''} น.`.trim();
    }
  }

  return {
    type: 'flex',
    altText: `แจ้งยกเลิกการจอง ${roomName} - ${bookingCode}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-cancel-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'ยกเลิกการจอง',
            size: 'xl',
            weight: 'bold',
            color: '#0f172a'
          },
          {
            type: 'text',
            text: 'รายการจองห้องประชุมถูกยกเลิกเรียบร้อย',
            size: 'xs',
            color: '#64748b',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'รหัสการจอง', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: bookingCode, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ห้องประชุม', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: roomName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'วันที่ใช้งาน', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: dateDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'เวลา', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: timeDisplay, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '14px',
            backgroundColor: '#fef2f2',
            cornerRadius: '10px',
            borderWidth: '1px',
            borderColor: '#fecaca',
            contents: [
              { type: 'text', text: 'เหตุผลในการยกเลิก', size: 'xs', weight: 'bold', color: '#991b1b' },
              { type: 'text', text: cancelReason, size: 'sm', weight: 'bold', color: '#991b1b', margin: 'xs', wrap: true }
            ]
          },
          {
            type: 'text',
            text: 'หากต้องการจองห้องประชุมใหม่ เรายินดีให้บริการเสมอ',
            size: 'xxs',
            color: '#64748b',
            margin: 'sm',
            align: 'center',
            wrap: true
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: 'จองห้องใหม่',
              uri: 'https://bwork-booking.pages.dev'
            },
            style: 'primary',
            color: '#991b1b',
            height: 'md'
          }
        ]
      }
    }
  };
}

async function sendLineBookingCancellation(env, bookingId, reason = '') {
  try {
    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;

    const item = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first() : null;

    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;

    const flexCard = buildLineBookingCancellationFlex(booking, item, room, reason);

    const dispatch = await dispatchLineMessagePush(env, channelAccessToken, {
      to: booking.line_user_id,
      messages: [flexCard]
    });

    if (dispatch.mocked) {
      return { success: true, sent: false, mocked: true, status: 200 };
    }
    if (!dispatch.ok) return null;
    return { success: dispatch.ok, status: dispatch.status, sent: dispatch.sent };
  } catch (err) {
    console.error('Error sending cancellation message:', err);
    return null;
  }
}

function buildLineSlipRejectedFlex(booking, roomNameOrItem, displayReason, paymentDeadlineIso, isStillEligible) {
  let roomName = (typeof roomNameOrItem === 'string' && roomNameOrItem) ? roomNameOrItem : (booking?.room_name || 'ห้องประชุม B-WORK');
  const bookingCode = booking?.receipt_number || `#BK-${String(booking?.id || 0).padStart(6, '0')}`;
  const reasonText = displayReason || 'สลิปการโอนเงินไม่ถูกต้อง';

  let deadlineDisplay = '-';
  if (paymentDeadlineIso) {
    try {
      const d = new Date(paymentDeadlineIso);
      const bkkHours = d.getHours().toString().padStart(2, '0');
      const bkkMinutes = d.getMinutes().toString().padStart(2, '0');
      deadlineDisplay = `${formatThaiDateDisplay(paymentDeadlineIso)} เวลา ${bkkHours}:${bkkMinutes} น.`;
    } catch (_) {
      deadlineDisplay = String(paymentDeadlineIso);
    }
  }

  const contactParam = encodeURIComponent(booking?.contact || '');
  const resubmitUrl = `https://bwork-booking.pages.dev/confirm?booking_id=${booking?.id}&contact=${contactParam}`;

  const bodyContents = [
    {
      type: 'text',
      text: 'สลิปไม่ผ่านการตรวจสอบ',
      size: 'xl',
      weight: 'bold',
      color: '#0f172a'
    },
    {
      type: 'text',
      text: isStillEligible ? 'กรุณาตรวจสอบและแนบสลิปใหม่ก่อนหมดเวลา' : 'รายการจองหมดเวลาชำระเงินแล้ว',
      size: 'xs',
      color: '#64748b',
      margin: 'xs'
    },
    {
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      spacing: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'baseline',
          contents: [
            { type: 'text', text: 'รหัสการจอง', color: '#64748b', size: 'sm', flex: 3 },
            { type: 'text', text: bookingCode, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
          ]
        },
        {
          type: 'box',
          layout: 'baseline',
          contents: [
            { type: 'text', text: 'ห้องประชุม', color: '#64748b', size: 'sm', flex: 3 },
            { type: 'text', text: roomName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
          ]
        }
      ]
    },
    {
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      paddingAll: '14px',
      backgroundColor: '#fffbeb',
      cornerRadius: '10px',
      borderWidth: '1px',
      borderColor: '#fde68a',
      contents: [
        { type: 'text', text: 'เหตุผลที่ปฏิเสธสลิป', size: 'xs', weight: 'bold', color: '#b45309' },
        { type: 'text', text: reasonText, size: 'sm', weight: 'bold', color: '#b45309', margin: 'xs', wrap: true }
      ]
    }
  ];

  if (isStillEligible && deadlineDisplay !== '-') {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'sm',
      paddingAll: '12px',
      backgroundColor: '#f8fafc',
      cornerRadius: '8px',
      borderWidth: '1px',
      borderColor: '#e2e8f0',
      contents: [
        { type: 'text', text: 'กำหนดเวลาชำระเงินเดิม', size: 'xs', color: '#64748b' },
        { type: 'text', text: deadlineDisplay, size: 'sm', weight: 'bold', color: '#0f172a', margin: 'xs' },
        { type: 'text', text: 'ระบบไม่ขยายเวลาชำระเงิน กรุณาแนบสลิปใหม่ก่อนหมดเวลา', size: 'xxs', color: '#dc2626', margin: 'xs', wrap: true }
      ]
    });
  }

  const footerContents = [];
  if (isStillEligible) {
    footerContents.push({
      type: 'button',
      action: {
        type: 'uri',
        label: 'แนบสลิปใหม่',
        uri: resubmitUrl
      },
      style: 'primary',
      color: '#d97706',
      height: 'md'
    });
  } else {
    footerContents.push({
      type: 'button',
      action: {
        type: 'uri',
        label: 'จองห้องใหม่',
        uri: 'https://bwork-booking.pages.dev'
      },
      style: 'primary',
      color: '#64748b',
      height: 'md'
    });
  }

  return {
    type: 'flex',
    altText: `แจ้งผลการตรวจสอบสลิป - ${bookingCode}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-cancel-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: bodyContents
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: footerContents
      }
    }
  };
}

async function sendLineSlipRejectedNotification(env, bookingId, displayReason, paymentDeadlineIso, isStillEligible) {
  try {
    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;

    const item = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first() : null;

    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;

    const flexCard = buildLineSlipRejectedFlex(booking, room?.name, displayReason, paymentDeadlineIso, isStillEligible);

    const dispatch = await dispatchLineMessagePush(env, channelAccessToken, {
      to: booking.line_user_id,
      messages: [flexCard]
    });

    if (dispatch.mocked) {
      return { success: true, sent: false, mocked: true, status: 200 };
    }
    if (!dispatch.ok) return null;
    return { success: dispatch.ok, status: dispatch.status, sent: dispatch.sent };
  } catch (err) {
    console.error('Error sending slip rejection message in worker:', err);
    return null;
  }
}

// 4. Flex Message: แจ้งเปลี่ยนแปลงวัน/เวลาการจองสำเร็จ
function buildLineBookingRescheduleFlex(booking, item, room, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal) {
  const roomName = room ? (room.room_number && !room.name.includes(`(${room.room_number})`) ? `${room.name} (${room.room_number})` : room.name) : (item?.room_name || 'ห้องประชุม B-WORK');
  const bookingCode = booking?.receipt_number || `#BK-${String(booking?.id || 0).padStart(6, '0')}`;
  const totalAmount = Number(newTotal !== undefined ? newTotal : (booking?.total_amount || 0));

  const oldTimeDisplay = formatRescheduleTimeDisplay(oldStartTime, oldEndTime);
  const newTimeDisplay = formatRescheduleTimeDisplay(newStartTime, newEndTime);

  return {
    type: 'flex',
    altText: `แจ้งเปลี่ยนแปลงการจอง ${roomName} - ${bookingCode}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-update-banner.png',
        size: 'full',
        aspectRatio: '3:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'เปลี่ยนแปลงการจอง',
            size: 'xl',
            weight: 'bold',
            color: '#0f172a'
          },
          {
            type: 'text',
            text: 'รายละเอียดวันและเวลาใช้งานใหม่ของคุณ',
            size: 'xs',
            color: '#64748b',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'รหัสการจอง', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: bookingCode, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: 'ห้องประชุม', color: '#64748b', size: 'sm', flex: 3 },
                  { type: 'text', text: roomName, color: '#0f172a', size: 'sm', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '14px',
            backgroundColor: '#f8fafc',
            cornerRadius: '10px',
            borderWidth: '1px',
            borderColor: '#e2e8f0',
            contents: [
              { type: 'text', text: 'เดิม', size: 'xs', color: '#94a3b8', weight: 'bold' },
              { type: 'text', text: oldTimeDisplay, size: 'xs', color: '#94a3b8', decoration: 'line-through', margin: 'xs', wrap: true },
              { type: 'separator', margin: 'sm' },
              { type: 'text', text: 'ใหม่', size: 'xs', weight: 'bold', color: '#1e3a8a', margin: 'sm' },
              { type: 'text', text: newTimeDisplay, size: 'sm', weight: 'bold', color: '#1e3a8a', margin: 'xs', wrap: true },
              { type: 'separator', margin: 'sm' },
              {
                type: 'box',
                layout: 'baseline',
                margin: 'sm',
                contents: [
                  { type: 'text', text: 'ยอดชำระใหม่', size: 'xs', color: '#64748b', flex: 3 },
                  { type: 'text', text: `฿${totalAmount.toLocaleString()}`, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
                ]
              }
            ]
          },
          {
            type: 'text',
            text: 'กรุณารับรหัสเข้าห้องใหม่สำหรับช่วงเวลาที่เปลี่ยนแปลง',
            size: 'xxs',
            color: '#1e40af',
            margin: 'sm',
            align: 'center',
            wrap: true
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: 'ดูรายละเอียดการจอง',
              uri: 'https://bwork-booking.pages.dev/status'
            },
            style: 'primary',
            color: '#1e3a8a',
            height: 'md'
          }
        ]
      }
    }
  };
}

async function sendLineBookingReschedule(env, bookingId, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal, bookingItemId = null) {
  try {
    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;

    let item;
    if (bookingItemId) {
      item = await env.DB.prepare('SELECT * FROM booking_items WHERE id = ? AND booking_id = ?').bind(bookingItemId, bookingId).first();
    } else {
      item = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
    }
    const room = item?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first() : null;

    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;

    const flexCard = buildLineBookingRescheduleFlex(booking, item, room, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal);

    const dispatch = await dispatchLineMessagePush(env, channelAccessToken, {
      to: booking.line_user_id,
      messages: [flexCard]
    });

    if (dispatch.mocked) {
      return { success: true, sent: false, mocked: true, status: 200 };
    }
    if (!dispatch.ok) return null;
    return { success: dispatch.ok, status: dispatch.status, sent: dispatch.sent };
  } catch (err) {
    console.error('Error sending reschedule message:', err);
    return null;
  }
}

// Build text message for customer info updates (concise text, no reschedule banner)
function buildCustomerInfoUpdateTextMessage(booking, newCustomerName, newContact) {
  const code = booking?.receipt_number || `#BK-${String(booking?.id || 0).padStart(6, '0')}`;
  let text = `แจ้งอัปเดตข้อมูลการจอง ${code}\n`;
  text += `ชื่อผู้จอง: ${newCustomerName}\n`;
  if (newContact) {
    text += `เบอร์ติดต่อ: ${newContact}\n`;
  }
  text += `ข้อมูลการจองของท่านได้รับการอัปเดตเรียบร้อยแล้วค่ะ\nหากมีข้อสงสัย กรุณาติดต่อเจ้าหน้าที่ได้ทันทีค่ะ`;
  return text;
}

async function sendLineBookingCustomerInfoUpdate(env, booking, newCustomerName, newContact) {
  try {
    if (!booking || !booking.line_user_id) return { sent: false, reason: 'no_line_recipient' };

    const channelAccessToken = env.LINE_CHANNEL_ACCESS_TOKEN;
    const textContent = buildCustomerInfoUpdateTextMessage(booking, newCustomerName, newContact);

    const dispatch = await dispatchLineMessagePush(env, channelAccessToken, {
      to: booking.line_user_id,
      messages: [{ type: 'text', text: textContent }]
    });

    if (dispatch.mocked) {
      return { success: true, sent: false, mocked: true, status: 200 };
    }
    if (!dispatch.ok) return { sent: false, reason: dispatch.reason || 'dispatch_failed' };
    return { sent: dispatch.sent, status: dispatch.status };
  } catch (err) {
    console.error('Error sending customer info update LINE message:', err);
    return { sent: false, error: err.message };
  }
}

function normalizeBookingDetails(input) {
  if (input === undefined || input === null) return { value: null };
  if (typeof input !== 'string') {
    input = String(input);
  }
  const cleaned = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!cleaned) {
    return { value: null };
  }
  if (cleaned.length > 1000) {
    return { error: 'รายละเอียดเพิ่มเติมต้องมีความยาวไม่เกิน 1,000 ตัวอักษร' };
  }
  return { value: cleaned };
}

let schemaInitialized = false;
async function ensureD1Schema(env) {
  if (schemaInitialized || !env || !env.DB) return;
  const migrations = [
    "ALTER TABLE bookings ADD COLUMN tax_invoice_required INTEGER DEFAULT 0",
    "ALTER TABLE bookings ADD COLUMN tax_name TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_address TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_id TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_phone TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_delivery_method TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_postal_address TEXT",
    "ALTER TABLE bookings ADD COLUMN guest_count INTEGER",
    "ALTER TABLE bookings ADD COLUMN booking_source TEXT DEFAULT 'online'",
    "ALTER TABLE bookings ADD COLUMN customer_email TEXT",
    "ALTER TABLE bookings ADD COLUMN booking_details TEXT",
    "ALTER TABLE bookings ADD COLUMN slip_image_url TEXT",
    "ALTER TABLE payment_transactions ADD COLUMN slip_url TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_payer_type TEXT DEFAULT 'corporate'",
    "ALTER TABLE bookings ADD COLUMN tax_branch_type TEXT DEFAULT 'head'",
    "ALTER TABLE bookings ADD COLUMN tax_branch_number TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_email TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_invoice_status TEXT DEFAULT 'pending'",
    "ALTER TABLE bookings ADD COLUMN line_user_id TEXT",
    "ALTER TABLE bookings ADD COLUMN pin_code TEXT",
    "ALTER TABLE bookings ADD COLUMN qr_token TEXT",
    "ALTER TABLE bookings ADD COLUMN receipt_number TEXT",
    "ALTER TABLE bookings ADD COLUMN checkin_status TEXT DEFAULT 'pending'",
    "ALTER TABLE bookings ADD COLUMN checkin_at DATETIME",
    "ALTER TABLE booking_items ADD COLUMN layout TEXT DEFAULT 'standard'",
    "ALTER TABLE booking_items ADD COLUMN booking_type TEXT DEFAULT 'hourly'",
    "ALTER TABLE booking_items ADD COLUMN guest_count INTEGER",
    "ALTER TABLE booking_items ADD COLUMN pin_code TEXT",
    "ALTER TABLE booking_items ADD COLUMN checkin_status TEXT DEFAULT 'pending'",
    "ALTER TABLE booking_items ADD COLUMN checkin_at DATETIME",
    "ALTER TABLE rooms ADD COLUMN daily_rate REAL DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN half_day_rate REAL DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN has_classroom INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN classroom_hourly_rate REAL DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN classroom_daily_rate REAL DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN classroom_capacity INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN classroom_image_url TEXT",
    "ALTER TABLE rooms ADD COLUMN has_hourly INTEGER DEFAULT 1",
    "ALTER TABLE rooms ADD COLUMN has_halfday INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN has_daily INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN pin_code TEXT",
    "ALTER TABLE rooms ADD COLUMN category TEXT DEFAULT 'Meeting Room'"
  ];

  for (const sql of migrations) {
    try {
      await env.DB.prepare(sql).run();
    } catch (e) {
      // Ignored: column already exists
    }
  }

  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS booking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      performed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_booking_history_booking_id ON booking_history(booking_id)`).run(); } catch (_) {}

    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tax_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      invoice_number TEXT,
      tax_payer_type TEXT DEFAULT 'corporate',
      tax_name TEXT NOT NULL,
      tax_id TEXT NOT NULL,
      tax_branch_type TEXT DEFAULT 'head',
      tax_branch_number TEXT,
      tax_address TEXT,
      tax_email TEXT,
      tax_phone TEXT,
      file_url TEXT,
      r2_object_key TEXT,
      file_name TEXT,
      content_type TEXT,
      file_size INTEGER,
      status TEXT DEFAULT 'issued',
      notes TEXT,
      uploaded_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
  } catch (e) {}

  schemaInitialized = true;
}


function generateWorkerTicketToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'tkt_sec_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function verifyWorkerLineIdToken(tokenString, expectedAudience = null) {
  if (!tokenString || typeof tokenString !== 'string') return null;
  const parts = tokenString.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(atob(b64));
    if (payload.iss !== 'https://access.line.me') return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || typeof payload.exp !== 'number' || payload.exp < (nowSec - 60)) return null;
    if (!payload.sub || typeof payload.sub !== 'string' || !payload.sub.trim()) return null;
    if (expectedAudience && payload.aud && payload.aud !== expectedAudience && !String(expectedAudience).includes(payload.aud)) {
      return null;
    }
    return { userId: payload.sub.trim(), name: payload.name || null };
  } catch (e) {
    return null;
  }
}

function extractWorkerCustomerAuth(request, url) {
  const ticketToken = request.headers.get('x-ticket-token') || url.searchParams.get('ticket_token');
  const bookingToken = request.headers.get('x-booking-token') || url.searchParams.get('booking_token');

  let ticketTokens = [];
  const rawTokens = request.headers.get('x-ticket-tokens') || url.searchParams.get('ticket_tokens');
  if (rawTokens) {
    try {
      const parsed = JSON.parse(rawTokens);
      if (Array.isArray(parsed)) ticketTokens = parsed.map(t => String(t).trim()).filter(Boolean);
    } catch (e) {
      ticketTokens = rawTokens.split(',').map(t => t.trim()).filter(Boolean);
    }
  }
  if (ticketToken && !ticketTokens.includes(ticketToken)) {
    ticketTokens.push(String(ticketToken).trim());
  }

  let lineUserId = null;
  const authHeader = request.headers.get('authorization');
  const lineIdToken = request.headers.get('x-line-id-token') || (
    authHeader && authHeader.startsWith('Bearer ') && authHeader.split(' ')[1].includes('.')
      ? authHeader.split(' ')[1]
      : null
  );

  if (lineIdToken) {
    const verified = verifyWorkerLineIdToken(lineIdToken);
    if (verified) lineUserId = verified.userId;
  }

  return {
    ticketToken: ticketToken ? String(ticketToken).trim() : null,
    ticketTokens,
    bookingToken: bookingToken ? String(bookingToken).trim() : null,
    lineUserId: lineUserId || null
  };
}

async function verifyWorkerTicketOwnership(env, ticket, auth = {}) {
  if (!ticket) return false;
  if (auth.is_staff) return true;

  if (auth.ticketToken && ticket.access_token) {
    if (safeEqualString(auth.ticketToken, ticket.access_token)) return true;
  }
  if (auth.lineUserId && ticket.line_user_id) {
    if (safeEqualString(auth.lineUserId, ticket.line_user_id)) return true;
  }
  if (auth.bookingToken && (ticket.booking_id || ticket.booking_code)) {
    const booking = await env.DB.prepare(
      'SELECT qr_token FROM bookings WHERE id = ? OR receipt_number = ?'
    ).bind(ticket.booking_id, ticket.booking_code).first();
    if (booking && booking.qr_token && safeEqualString(auth.bookingToken, booking.qr_token)) {
      return true;
    }
  }
  return false;
}

async function generateWorkerUniqueTicketNumber(env) {
  const now = new Date();
  const ym = getBangkokLocalISO(now).slice(0, 7).replace('-', '');
  const prefix = `TKT-${ym}-`;
  const row = await env.DB.prepare(
    "SELECT ticket_number FROM support_tickets WHERE ticket_number LIKE ? ORDER BY ticket_number DESC LIMIT 1"
  ).bind(`${prefix}%`).first();

  let nextSeq = 1;
  if (row && row.ticket_number) {
    const parts = row.ticket_number.split('-');
    if (parts.length >= 3) {
      const currentSeq = parseInt(parts[2], 10);
      if (!isNaN(currentSeq)) {
        nextSeq = currentSeq + 1;
      }
    }
  }
  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
}

async function recordWorkerTicketEvent(env, { ticketId, actorType, actorId, actorName, eventType, oldValue, newValue, notes }) {
  try {
    await env.DB.prepare(
      `INSERT INTO support_ticket_events
       (ticket_id, actor_type, actor_id, actor_name, event_type, old_value, new_value, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      ticketId,
      actorType,
      actorId || null,
      actorName || actorType,
      eventType,
      oldValue || null,
      newValue || null,
      notes || null
    ).run();
  } catch (err) {
    console.warn('[WorkerTicketEvent] Failed:', err.message);
  }
}

// ==========================================
// 6. MAIN WORKER ROUTER
// ==========================================
export default {
  async fetch(request, env, ctx) {
    // Ensure compatibility with both env.BUCKET and env.SLIP_BUCKET
    if (!env.BUCKET && env.SLIP_BUCKET) env.BUCKET = env.SLIP_BUCKET;
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Standard CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Booking-Contact, X-Booking-Token, X-Ticket-Token, X-Ticket-Tokens, X-Line-ID-Token',
      'Content-Type': 'application/json'
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Ensure D1 database schema has all latest columns
      await ensureD1Schema(env);

      // Generic Hour-Credit mutation safety guard
      const mutationGuard = await checkHourCreditMutationGuard(env, pathname, method);
      if (mutationGuard) {
        return new Response(JSON.stringify({ error: mutationGuard.error }), { status: mutationGuard.status, headers: corsHeaders });
      }

      // ----------------------------------------------------
      // SERVE R2 UPLOADS / STATIC IMAGES (/uploads/*) WITH ACCESS CONTROL
      // ----------------------------------------------------
      if (pathname.startsWith('/uploads/') && method === 'GET') {
        // 1. Path Traversal & Sanity Check
        const rawFilePath = pathname.slice('/uploads/'.length);
        let decodedFilePath;
        try {
          decodedFilePath = decodeURIComponent(rawFilePath);
        } catch (_) {
          return new Response(JSON.stringify({ error: 'Invalid path encoding' }), { status: 400, headers: corsHeaders });
        }

        // Strict rejection of path traversal, backslashes, null bytes, and root paths
        if (decodedFilePath.includes('..') || decodedFilePath.includes('\\') || decodedFilePath.includes('\0') || decodedFilePath.startsWith('/')) {
          return new Response(JSON.stringify({ error: 'Path traversal detected' }), { status: 400, headers: corsHeaders });
        }

        const filePath = decodedFilePath;
        const isFinancialOrSensitive = (
          filePath.startsWith('slips/') ||
          filePath.startsWith('payment-slips/') ||
          filePath.startsWith('tax-invoices/') ||
          filePath.startsWith('tax_invoices/')
        );

        // 2. Access Control for Financial / Sensitive Documents
        if (isFinancialOrSensitive) {
          let isAuthorizedStaff = false;
          let isAuthorizedCustomer = false;

          // Check Staff / Admin Authorization via Bearer token or ?token= param
          const authHeader = request.headers.get('authorization');
          const token = (authHeader && authHeader.split(' ')[1]) || url.searchParams.get('token');
          if (token) {
            const payload = await verifyToken(token);
            if (payload && payload.id) {
              const user = await env.DB.prepare("SELECT id, username, role, permissions FROM users WHERE id = ?").bind(payload.id).first();
              if (user) {
                if (user.role) {
                  const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(user.role).first();
                  if (roleRecord && typeof roleRecord.permissions === 'string') {
                    user.permissions = roleRecord.permissions;
                  }
                }
                const perms = (user.permissions || '').split(',');
                if (
                  user.role === 'admin' ||
                  perms.includes('pos') ||
                  perms.includes('history') ||
                  perms.includes('manage') ||
                  perms.includes('admin-system')
                ) {
                  isAuthorizedStaff = true;
                }
              }
            }
          }

          // If not staff, check customer ownership
          if (!isAuthorizedStaff) {
            let associatedBookingId = null;
            const segments = filePath.split('/');
            if ((segments[0] === 'payment-slips' || segments[0] === 'tax-invoices') && segments.length >= 3) {
              const candidateId = Number(segments[1]);
              if (!isNaN(candidateId) && candidateId > 0) {
                associatedBookingId = candidateId;
              }
            }

            let bookingRow = null;
            if (associatedBookingId) {
              bookingRow = await env.DB.prepare(
                "SELECT id, qr_token, contact, line_user_id FROM bookings WHERE id = ?"
              ).bind(associatedBookingId).first();
            } else {
              const fullUrl = `/uploads/${filePath}`;
              bookingRow = await env.DB.prepare(
                `SELECT id, qr_token, contact, line_user_id FROM bookings
                 WHERE slip_image_url = ?
                    OR id IN (SELECT booking_id FROM payment_transactions WHERE slip_url = ?)
                    OR id IN (SELECT booking_id FROM tax_invoices WHERE file_url = ?)
                 LIMIT 1`
              ).bind(fullUrl, fullUrl, fullUrl).first();
            }

            if (!bookingRow) {
              return new Response(JSON.stringify({ error: 'Authentication required' }), {
                status: token ? 403 : 401,
                headers: corsHeaders
              });
            }

            // Task 8: Require authenticated credentials for customer document retrieval
            // NEVER trust self-asserted x-booking-contact or raw x-line-user-id without verification
            const customerBookingToken = request.headers.get('x-booking-token') || url.searchParams.get('booking_token');
            const lineIdToken = request.headers.get('x-line-id-token');

            let hasSuppliedCredentials = false;
            if (customerBookingToken && bookingRow.qr_token) {
              hasSuppliedCredentials = true;
              if (safeEqualString(customerBookingToken.trim(), bookingRow.qr_token.trim())) {
                isAuthorizedCustomer = true;
              }
            }

            if (!isAuthorizedCustomer && lineIdToken && bookingRow.line_user_id) {
              hasSuppliedCredentials = true;
              const verifiedLine = verifyWorkerLineIdToken(lineIdToken);
              if (verifiedLine && verifiedLine.userId && safeEqualString(verifiedLine.userId, bookingRow.line_user_id.trim())) {
                isAuthorizedCustomer = true;
              }
            }

            if (!isAuthorizedCustomer) {
              if (hasSuppliedCredentials || token) {
                return new Response(JSON.stringify({ error: 'Access denied: You do not own this document' }), { status: 403, headers: corsHeaders });
              } else {
                return new Response(JSON.stringify({ error: 'Authentication required to view this document' }), { status: 401, headers: corsHeaders });
              }
            }
          }
        }

        // 3. Fetch from R2 Bucket
        if (!env.BUCKET) {
          return new Response(JSON.stringify({ error: 'Storage service unavailable' }), { status: 503, headers: corsHeaders });
        }

        const object = await env.BUCKET.get(filePath);
        if (!object) {
          return new Response(JSON.stringify({ error: 'File Not Found' }), { status: 404, headers: corsHeaders });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('Access-Control-Allow-Origin', '*');

        if (isFinancialOrSensitive) {
          headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
          const isDownload = url.searchParams.get('download') === '1' || request.headers.get('accept') === 'application/octet-stream';
          const filename = filePath.split('/').pop() || 'document';
          if (isDownload) {
            headers.set('Content-Disposition', `attachment; filename="${filename}"`);
          } else {
            headers.set('Content-Disposition', `inline; filename="${filename}"`);
          }
        } else {
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        }

        return new Response(object.body, { headers });
      }

      // ----------------------------------------------------
      // 0. AUTHENTICATION ENDPOINTS
      // ----------------------------------------------------
      if (pathname === '/api/auth/login' && method === 'POST') {
        const { username, password } = await request.json();
        if (!username || !password) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' }), { status: 400, headers: corsHeaders });
        }

        const passHash = await hashPassword(password);
        let user = await env.DB.prepare(
          "SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND password_hash = ?"
        ).bind(username, passHash).first();

        // Fallback for default admin (disabled in staging so dedicated Staging Admin password hash is enforced)
        if (!user && !(env && env.ENVIRONMENT === 'staging') && (username === 'admin' && password === 'admin123')) {
          user = await env.DB.prepare("SELECT * FROM users WHERE LOWER(username) = 'admin'").first();
        }

        if (user) {
          const { password_hash, ...safeUser } = user;
          if (safeUser.role) {
            const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(safeUser.role).first();
            if (roleRecord && typeof roleRecord.permissions === 'string') {
              safeUser.permissions = roleRecord.permissions;
            }
          }
          if (safeUser.permissions === null || safeUser.permissions === undefined) {
            safeUser.permissions = safeUser.role === 'admin'
              ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation'
              : 'pos,pending,layout,manage,history,quotations';
          }
          const token = await createToken({ id: safeUser.id, username: safeUser.username, role: safeUser.role, permissions: safeUser.permissions, fullname: safeUser.fullname });
          return new Response(JSON.stringify({ success: true, token, user: safeUser }), { headers: corsHeaders });
        } else {
          return new Response(JSON.stringify({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }), { status: 401, headers: corsHeaders });
        }
      }

      if (pathname === '/api/auth/login-pin' && method === 'POST') {
        const { pin_code } = await request.json();
        if (!pin_code) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกรหัส PIN' }), { status: 400, headers: corsHeaders });
        }
        const user = await env.DB.prepare("SELECT id, username, role, permissions, fullname FROM users WHERE pin_code = ?").bind(pin_code.trim()).first();
        if (user) {
          const safeUser = { ...user };
          if (safeUser.role) {
            const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(safeUser.role).first();
            if (roleRecord && typeof roleRecord.permissions === 'string') {
              safeUser.permissions = roleRecord.permissions;
            }
          }
          if (safeUser.permissions === null || safeUser.permissions === undefined) {
            safeUser.permissions = safeUser.role === 'admin'
              ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation'
              : 'pos,pending,layout,manage,history,quotations';
          }
          const token = await createToken({ id: safeUser.id, username: safeUser.username, role: safeUser.role, permissions: safeUser.permissions, fullname: safeUser.fullname });
          return new Response(JSON.stringify({ success: true, token, user: safeUser }), { headers: corsHeaders });
        }
        return new Response(JSON.stringify({ error: 'รหัส PIN ไม่ถูกต้อง' }), { status: 401, headers: corsHeaders });
      }

      if (pathname === '/api/auth/me' && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        return new Response(JSON.stringify({ success: true, user: auth.user }), { headers: corsHeaders });
      }

      if ((pathname === '/api/auth/change-password' || pathname === '/api/users/change-password') && method === 'POST') {
        const body = await request.json();
        const { username, oldPassword, newPassword } = body;
        if (!oldPassword || !newPassword) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' }), { status: 400, headers: corsHeaders });
        }
        let targetUsername = username;
        if (!targetUsername) {
          const auth = await authenticateUser(request, env);
          if (auth.user) targetUsername = auth.user.username;
        }
        if (!targetUsername) {
          return new Response(JSON.stringify({ error: 'กรุณาระบุชื่อผู้ใช้งาน' }), { status: 400, headers: corsHeaders });
        }
        const oldHash = await hashPassword(oldPassword.trim());
        const user = await env.DB.prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND password_hash = ?").bind(targetUsername.trim(), oldHash).first();
        if (!user) {
          return new Response(JSON.stringify({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }
        const newHash = await hashPassword(newPassword.trim());
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, user.id).run();
        return new Response(JSON.stringify({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' }), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 1. DASHBOARD & OCCUPANCY
      // ----------------------------------------------------
      if (pathname === '/api/dashboard/summary' && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const startDate = url.searchParams.get('start_date');
        const endDate = url.searchParams.get('end_date');

        let dateFilterBookings = "";
        let dateFilterItems = "";
        const paramsBookings = [];
        const paramsItems = [];

        if (startDate && endDate) {
          dateFilterBookings = " AND DATE(b.created_at) >= ? AND DATE(b.created_at) <= ?";
          paramsBookings.push(startDate, endDate);
          dateFilterItems = " AND DATE(b.created_at) >= ? AND DATE(b.created_at) <= ?";
          paramsItems.push(startDate, endDate);
        }

        // Total revenue from paid bookings
        const paidRes = await env.DB.prepare(`SELECT SUM(b.total_amount) as total FROM bookings b WHERE b.payment_status = 'paid'${dateFilterBookings}`).bind(...paramsBookings).first();
        const revenue = paidRes?.total || 0;

        // Total bookings count
        const countRes = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE (b.payment_status IS NULL OR b.payment_status != 'cancelled')${dateFilterBookings}`).bind(...paramsBookings).first();
        const bookingsCount = countRes?.count || 0;

        // Paid bookings count
        const paidCountRes = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE b.payment_status = 'paid'${dateFilterBookings}`).bind(...paramsBookings).first();
        const paidCount = paidCountRes?.count || 0;

        // Pending bookings count
        const pendingCountRes = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE (b.payment_status = 'pending' OR b.payment_status = 'reviewing')${dateFilterBookings}`).bind(...paramsBookings).first();
        const pendingCount = pendingCountRes?.count || 0;

        // Trend (revenue by date)
        const { results: trendResults } = await env.DB.prepare(`
          SELECT DATE(b.created_at) as date, SUM(b.total_amount) as revenue
          FROM bookings b
          WHERE b.payment_status = 'paid'${dateFilterBookings}
          GROUP BY DATE(b.created_at)
          ORDER BY DATE(b.created_at) ASC
        `).bind(...paramsBookings).all();

        // Popular Rooms
        const { results: popularRooms } = await env.DB.prepare(`
          SELECT r.name, SUM(bi.subtotal) as total_revenue, COUNT(bi.id) as bookings_count
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          JOIN rooms r ON bi.room_id = r.id
          WHERE (b.payment_status IS NULL OR b.payment_status != 'cancelled')${dateFilterItems}
          GROUP BY r.id, r.name
          ORDER BY total_revenue DESC
        `).bind(...paramsItems).all();

        // Popular Services
        const { results: popularServices } = await env.DB.prepare(`
          SELECT s.name, SUM(bi.quantity) as total_quantity, SUM(bi.subtotal) as total_revenue
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          JOIN services s ON bi.service_id = s.id
          WHERE (b.payment_status IS NULL OR b.payment_status != 'cancelled')${dateFilterItems}
          GROUP BY s.id, s.name
          ORDER BY total_quantity DESC
        `).bind(...paramsItems).all();

        return new Response(JSON.stringify({
          revenue,
          totalSales: revenue,
          bookingsCount,
          roomBookingsCount: bookingsCount,
          paidCount,
          pendingCount,
          trend: trendResults || [],
          popularRooms: popularRooms || [],
          popularServices: popularServices || []
        }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/rooms/occupancy') && method === 'GET') {
        const { current_time } = Object.fromEntries(url.searchParams);
        const { results: rooms } = await env.DB.prepare("SELECT * FROM rooms WHERE status = 'active'").all();
        const roomsOccupancy = [];

        const currentTimeISO = current_time ? normalizeToLocalISO(current_time) : normalizeToLocalISO(new Date().toISOString());
        for (const room of (rooms || [])) {
          let currentBooking = null;
          if (currentTimeISO) {
            currentBooking = await env.DB.prepare(`
              SELECT bi.id as item_id, b.id as booking_id, bi.room_id, bi.start_time, bi.end_time,
                     b.customer_name, b.department, b.booking_source, b.payment_status, b.pin_code
              FROM booking_items bi
              JOIN bookings b ON bi.booking_id = b.id
              WHERE bi.room_id = ?
                AND replace(bi.start_time, ' ', 'T') <= ?
                AND replace(bi.end_time, ' ', 'T') > ?
                AND b.payment_status IN ('paid', 'internal_free', 'pending', 'reviewing', 'rejected', 'unpaid')
                AND b.payment_status != 'cancelled'
                AND (b.checkin_status IS NULL OR b.checkin_status != 'cancelled')
                AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
              ORDER BY
                CASE
                  WHEN b.payment_status IN ('paid', 'internal_free') THEN 1
                  WHEN b.payment_status = 'reviewing' THEN 2
                  WHEN b.payment_status IN ('pending', 'unpaid') THEN 3
                  WHEN b.payment_status = 'rejected' THEN 4
                  ELSE 5
                END ASC,
                bi.id DESC
              LIMIT 1
            `).bind(room.id, currentTimeISO, currentTimeISO).first();
          }
          roomsOccupancy.push({
            ...room,
            is_occupied: !!currentBooking,
            isOccupied: !!currentBooking,
            current_booking: currentBooking || null,
            currentBooking: currentBooking || null
          });
        }
        return new Response(JSON.stringify(roomsOccupancy), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 2. ROOMS & SERVICES CRUD
      // ----------------------------------------------------
      if (pathname === '/api/rooms' || pathname === '/api/public/rooms') {
        if (method === 'GET') {
          const isPublic = pathname === '/api/public/rooms';
          const statusParam = url.searchParams.get('status');
          let query = "SELECT * FROM rooms";
          const params = [];
          if (statusParam) {
            query += " WHERE status = ?";
            params.push(statusParam);
          } else if (isPublic) {
            query += " WHERE status = 'active'";
          }
          query += " ORDER BY name ASC";
          const { results } = await env.DB.prepare(query).bind(...params).all();
          if (Array.isArray(results)) {
            for (const r of results) {
              if (isPublic) {
                delete r.pin_code;
                delete r.builtland_pin_code;
                delete r.wifi_username;
              }
              r.has_wifi_credentials = Boolean(r.wifi_username && r.wifi_password_enc);
              delete r.wifi_password_enc;
            }
          }
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, 'rooms');
          const classroomImageUrl = await saveUploadedFile(env, body.classroom_image_url, 'rooms');


          const cleanPosX = (body.image_position_x !== undefined && body.image_position_x !== null && !isNaN(body.image_position_x))
            ? Math.max(0, Math.min(100, Math.round(Number(body.image_position_x))))
            : 50;
          const cleanPosY = (body.image_position_y !== undefined && body.image_position_y !== null && !isNaN(body.image_position_y))
            ? Math.max(0, Math.min(100, Math.round(Number(body.image_position_y))))
            : 50;

          const ins = await env.DB.prepare(
            `INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, half_day_rate, has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url, description, image_url, category, pin_code, builtland_pin_code, image_position_x, image_position_y, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
          ).bind(
            body.name, body.capacity || 0, body.hourly_rate || 0, body.daily_rate || 0, body.half_day_rate || 0,
            body.has_classroom || 0, body.classroom_hourly_rate || 0, body.classroom_daily_rate || 0, body.classroom_capacity || 0,
            classroomImageUrl || null, body.description || '', imageUrl || null, body.category || 'Meeting Room', body.pin_code || null, body.builtland_pin_code || null,
            cleanPosX, cleanPosY
          ).run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'บันทึกห้องสำเร็จ' }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/rooms/') && !pathname.includes('occupancy')) {
        const parts = pathname.split('/');
        const roomId = parseInt(parts[3], 10);
        if (isNaN(roomId)) {
          return new Response(JSON.stringify({ error: 'รหัสห้องไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        if (method === 'PUT') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, 'rooms');
          const classroomImageUrl = await saveUploadedFile(env, body.classroom_image_url, 'rooms');

          const existingRoom = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first();
          if (!existingRoom) {
            return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลห้องประชุม' }), { status: 404, headers: corsHeaders });
          }

          let cleanPosX;
          if (body.image_position_x === undefined) {
            cleanPosX = existingRoom.image_position_x !== undefined && existingRoom.image_position_x !== null ? existingRoom.image_position_x : 50;
          } else if (body.image_position_x === null || isNaN(body.image_position_x)) {
            cleanPosX = 50;
          } else {
            cleanPosX = Math.max(0, Math.min(100, Math.round(Number(body.image_position_x))));
          }

          let cleanPosY;
          if (body.image_position_y === undefined) {
            cleanPosY = existingRoom.image_position_y !== undefined && existingRoom.image_position_y !== null ? existingRoom.image_position_y : 50;
          } else if (body.image_position_y === null || isNaN(body.image_position_y)) {
            cleanPosY = 50;
          } else {
            cleanPosY = Math.max(0, Math.min(100, Math.round(Number(body.image_position_y))));
          }

          const isPinCapable = roomUsesDoorPin(existingRoom);

          // Rule 7: Preservation of omitted values, explicit clear on empty string/null
          let cleanPin;
          if (!isPinCapable) {
            cleanPin = null;
          } else if (body.pin_code === undefined) {
            cleanPin = existingRoom.pin_code !== undefined ? existingRoom.pin_code : null;
          } else if (body.pin_code === null || String(body.pin_code).trim() === '') {
            cleanPin = null;
          } else {
            cleanPin = String(body.pin_code).trim();
          }

          let cleanBuiltlandPin;
          if (!isPinCapable) {
            cleanBuiltlandPin = null;
          } else if (body.builtland_pin_code === undefined) {
            cleanBuiltlandPin = existingRoom.builtland_pin_code !== undefined ? existingRoom.builtland_pin_code : null;
          } else if (body.builtland_pin_code === null || String(body.builtland_pin_code).trim() === '') {
            cleanBuiltlandPin = null;
          } else {
            cleanBuiltlandPin = String(body.builtland_pin_code).trim();
          }

          const effectiveBuiltlandPin = cleanBuiltlandPin || cleanPin;

          const updateRoomStmt = env.DB.prepare(
            `UPDATE rooms SET name=?, capacity=?, hourly_rate=?, daily_rate=?, half_day_rate=?, has_classroom=?, classroom_hourly_rate=?, classroom_daily_rate=?, classroom_capacity=?, classroom_image_url=?, description=?, image_url=?, category=?, pin_code=?, builtland_pin_code=?, image_position_x=?, image_position_y=?, status=? WHERE id=?`
          ).bind(
            body.name !== undefined ? body.name : existingRoom.name,
            body.capacity !== undefined ? (body.capacity || 0) : existingRoom.capacity,
            body.hourly_rate !== undefined ? (body.hourly_rate || 0) : existingRoom.hourly_rate,
            body.daily_rate !== undefined ? (body.daily_rate || 0) : (existingRoom.daily_rate || 0),
            body.half_day_rate !== undefined ? (body.half_day_rate || 0) : (existingRoom.half_day_rate || 0),
            body.has_classroom !== undefined ? (body.has_classroom || 0) : (existingRoom.has_classroom || 0),
            body.classroom_hourly_rate !== undefined ? (body.classroom_hourly_rate || 0) : (existingRoom.classroom_hourly_rate || 0),
            body.classroom_daily_rate !== undefined ? (body.classroom_daily_rate || 0) : (existingRoom.classroom_daily_rate || 0),
            body.classroom_capacity !== undefined ? (body.classroom_capacity || 0) : (existingRoom.classroom_capacity || 0),
            classroomImageUrl !== undefined ? classroomImageUrl : existingRoom.classroom_image_url,
            body.description !== undefined ? body.description : existingRoom.description,
            imageUrl !== undefined ? imageUrl : existingRoom.image_url,
            body.category || existingRoom.category || 'Meeting Room',
            cleanPin,
            cleanBuiltlandPin,
            cleanPosX,
            cleanPosY,
            body.status || existingRoom.status || 'active',
            roomId
          );

          let syncedGeneralCount = 0;
          let syncedBuiltlandCount = 0;
          const batchStatements = [updateRoomStmt];

          // 2. If room uses door PIN, idempotently sync to current & future eligible bookings
          if (isPinCapable) {
            const bkkMs = Date.now() + 7 * 60 * 60 * 1000;
            const bkk = new Date(bkkMs);
            const currentBkkIso = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, '0')}-${String(bkk.getUTCDate()).padStart(2, '0')}T${String(bkk.getUTCHours()).padStart(2, '0')}:${String(bkk.getUTCMinutes()).padStart(2, '0')}:${String(bkk.getUTCSeconds()).padStart(2, '0')}`;

            // 2a. Sync General / Walk-in / Basecamp bookings to current cleanPin
            const { results: eligibleGeneral } = await env.DB.prepare(
              `SELECT DISTINCT b.id
               FROM bookings b
               JOIN booking_items bi ON bi.booking_id = b.id
               WHERE bi.room_id = ?
                 AND COALESCE(b.payment_status, '') NOT IN ('cancelled', 'failed')
                 AND COALESCE(b.checkin_status, '') != 'cancelled'
                 AND COALESCE(bi.checkin_status, '') != 'cancelled'
                 AND (CASE WHEN length(bi.end_time) = 16 THEN REPLACE(bi.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi.end_time, ' ', 'T') END) >= ?
                 AND (b.customer_type != 'builtland' OR b.customer_type IS NULL)`
            ).bind(roomId, currentBkkIso).all();

            syncedGeneralCount = eligibleGeneral ? eligibleGeneral.length : 0;

            if (syncedGeneralCount > 0) {
              batchStatements.push(
                env.DB.prepare(
                  `UPDATE booking_items
                   SET pin_code = ?
                   WHERE room_id = ?
                     AND (CASE WHEN length(end_time) = 16 THEN REPLACE(end_time, ' ', 'T') || ':00' ELSE REPLACE(end_time, ' ', 'T') END) >= ?
                     AND COALESCE(checkin_status, '') != 'cancelled'
                     AND booking_id IN (
                       SELECT id FROM bookings
                       WHERE COALESCE(payment_status, '') NOT IN ('cancelled', 'failed')
                         AND COALESCE(checkin_status, '') != 'cancelled'
                         AND (customer_type != 'builtland' OR customer_type IS NULL)
                     )`
                ).bind(cleanPin, roomId, currentBkkIso),

                env.DB.prepare(
                  `UPDATE bookings
                   SET pin_code = ?
                   WHERE COALESCE(payment_status, '') NOT IN ('cancelled', 'failed')
                     AND COALESCE(checkin_status, '') != 'cancelled'
                     AND (customer_type != 'builtland' OR customer_type IS NULL)
                     AND id IN (
                       SELECT bi1.booking_id
                       FROM booking_items bi1
                       WHERE bi1.room_id = ?
                         AND bi1.id = (
                           SELECT MIN(bi2.id)
                           FROM booking_items bi2
                           WHERE bi2.booking_id = bi1.booking_id
                             AND bi2.room_id IS NOT NULL
                             AND (CASE WHEN length(bi2.end_time) = 16 THEN REPLACE(bi2.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi2.end_time, ' ', 'T') END) >= ?
                             AND COALESCE(bi2.checkin_status, '') != 'cancelled'
                         )
                         AND (CASE WHEN length(bi1.end_time) = 16 THEN REPLACE(bi1.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi1.end_time, ' ', 'T') END) >= ?
                         AND COALESCE(bi1.checkin_status, '') != 'cancelled'
                     )`
                ).bind(cleanPin, roomId, currentBkkIso, currentBkkIso)
              );
            }

            // 2b. Sync Builtland bookings to current effectiveBuiltlandPin
            const { results: eligibleBuiltland } = await env.DB.prepare(
              `SELECT DISTINCT b.id
               FROM bookings b
               JOIN booking_items bi ON bi.booking_id = b.id
               WHERE bi.room_id = ?
                 AND COALESCE(b.payment_status, '') NOT IN ('cancelled', 'failed')
                 AND COALESCE(b.checkin_status, '') != 'cancelled'
                 AND COALESCE(bi.checkin_status, '') != 'cancelled'
                 AND (CASE WHEN length(bi.end_time) = 16 THEN REPLACE(bi.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi.end_time, ' ', 'T') END) >= ?
                 AND b.customer_type = 'builtland'`
            ).bind(roomId, currentBkkIso).all();

            syncedBuiltlandCount = eligibleBuiltland ? eligibleBuiltland.length : 0;

            if (syncedBuiltlandCount > 0) {
              batchStatements.push(
                env.DB.prepare(
                  `UPDATE booking_items
                   SET pin_code = ?
                   WHERE room_id = ?
                     AND (CASE WHEN length(end_time) = 16 THEN REPLACE(end_time, ' ', 'T') || ':00' ELSE REPLACE(end_time, ' ', 'T') END) >= ?
                     AND COALESCE(checkin_status, '') != 'cancelled'
                     AND booking_id IN (
                       SELECT id FROM bookings
                       WHERE COALESCE(payment_status, '') NOT IN ('cancelled', 'failed')
                         AND COALESCE(checkin_status, '') != 'cancelled'
                         AND customer_type = 'builtland'
                     )`
                ).bind(effectiveBuiltlandPin, roomId, currentBkkIso),

                env.DB.prepare(
                  `UPDATE bookings
                   SET pin_code = ?
                   WHERE COALESCE(payment_status, '') NOT IN ('cancelled', 'failed')
                     AND COALESCE(checkin_status, '') != 'cancelled'
                     AND customer_type = 'builtland'
                     AND id IN (
                       SELECT bi1.booking_id
                       FROM booking_items bi1
                       WHERE bi1.room_id = ?
                         AND bi1.id = (
                           SELECT MIN(bi2.id)
                           FROM booking_items bi2
                           WHERE bi2.booking_id = bi1.booking_id
                             AND bi2.room_id IS NOT NULL
                             AND (CASE WHEN length(bi2.end_time) = 16 THEN REPLACE(bi2.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi2.end_time, ' ', 'T') END) >= ?
                             AND COALESCE(bi2.checkin_status, '') != 'cancelled'
                         )
                         AND (CASE WHEN length(bi1.end_time) = 16 THEN REPLACE(bi1.end_time, ' ', 'T') || ':00' ELSE REPLACE(bi1.end_time, ' ', 'T') END) >= ?
                         AND COALESCE(bi1.checkin_status, '') != 'cancelled'
                     )`
                ).bind(effectiveBuiltlandPin, roomId, currentBkkIso, currentBkkIso)
              );
            }
          }

          await env.DB.batch(batchStatements);

          return new Response(JSON.stringify({
            success: true,
            message: 'แก้ไขข้อมูลห้องสำเร็จ',
            synced_bookings_count: syncedGeneralCount + syncedBuiltlandCount,
            synced_general_bookings_count: syncedGeneralCount,
            synced_builtland_bookings_count: syncedBuiltlandCount,
            room: {
              id: Number(roomId),
              name: body.name !== undefined ? body.name : existingRoom.name,
              pin_code: cleanPin,
              builtland_pin_code: cleanBuiltlandPin
            }
          }), { headers: corsHeaders });
        }

        if (method === 'DELETE') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          await env.DB.prepare("UPDATE rooms SET status = 'inactive' WHERE id = ?").bind(roomId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบห้องสำเร็จ' }), { headers: corsHeaders });
        }

        if (method === 'GET' && pathname.endsWith('/bookings')) {
          const { results } = await env.DB.prepare(
            "SELECT bi.* FROM booking_items bi JOIN bookings b ON bi.booking_id = b.id WHERE bi.room_id = ? AND b.payment_status != 'cancelled'"
          ).bind(roomId).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
      }

      // ----------------------------------------------------
      // 2.2 ROOM WI-FI CREDENTIAL MANAGEMENT
      // ----------------------------------------------------
      if ((pathname.startsWith('/api/rooms/') || pathname.startsWith('/api/admin/rooms/')) && pathname.endsWith('/wifi')) {
        const parts = pathname.split('/');
        const roomId = parseInt(parts[parts.length - 2], 10);
        if (isNaN(roomId)) {
          return new Response(JSON.stringify({ error: 'รหัสห้องไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        if (auth.user?.role !== 'admin' && auth.user?.username !== 'admin' && !auth.user?.permissions?.includes('manage') && !auth.user?.permissions?.includes('admin-management')) {
          return new Response(JSON.stringify({ error: 'ไม่มีสิทธิ์ดำเนินการนี้' }), { status: 403, headers: corsHeaders });
        }

        const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first();
        if (!room) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลห้องประชุม' }), { status: 404, headers: corsHeaders });
        }

        const secureHeaders = { ...corsHeaders, 'Cache-Control': 'no-store, private' };

        if (method === 'GET') {
          if (room.wifi_username === undefined && room.wifi_password_enc === undefined) {
            return new Response(JSON.stringify({
              room_id: room.id,
              room_name: room.name,
              wifi_username: null,
              wifi_password: null,
              has_password: false,
              wifi_configured: false,
              migration_pending: true
            }), { headers: secureHeaders });
          }

          let plainPassword = '';
          let hasPassword = false;

          if (room.wifi_password_enc) {
            try {
              plainPassword = await decryptWifiPasswordWebCrypto(room.wifi_password_enc, env.WIFI_CREDENTIAL_ENCRYPTION_KEY, room.id);
              hasPassword = true;
            } catch (decErr) {
              return new Response(JSON.stringify({
                error: 'ไม่สามารถถอดรหัสรหัสผ่าน Wi-Fi ได้ (กุญแจเข้ารหัสไม่ถูกต้องหรือสูญหาย)',
                code: decErr.code || 'ERR_WIFI_DECRYPT_FAILED'
              }), { status: 500, headers: secureHeaders });
            }
          }

          return new Response(JSON.stringify({
            room_id: room.id,
            room_name: room.name,
            wifi_username: room.wifi_username || '',
            wifi_password: plainPassword,
            has_password: hasPassword,
            wifi_configured: Boolean(room.wifi_username && hasPassword)
          }), { headers: secureHeaders });
        }

        if (method === 'PUT') {
          const body = await request.json();
          const { wifi_username, wifi_password, clear_credentials } = body || {};

          if (clear_credentials === true) {
            try {
              await env.DB.prepare('UPDATE rooms SET wifi_username = NULL, wifi_password_enc = NULL WHERE id = ?').bind(room.id).run();
              return new Response(JSON.stringify({
                success: true,
                message: 'ล้างข้อมูลการเชื่อมต่อ Wi-Fi ของห้องเรียบร้อยแล้ว',
                room_id: room.id,
                wifi_username: null,
                has_password: false,
                wifi_configured: false
              }), { headers: secureHeaders });
            } catch (clearErr) {
              return new Response(JSON.stringify({ error: 'Wi-Fi schema migration pending approval', code: 'MIGRATION_PENDING' }), { status: 503, headers: secureHeaders });
            }
          }

          const newUsername = wifi_username !== undefined ? (String(wifi_username).trim() || null) : (room.wifi_username || null);
          let newPasswordEnc = room.wifi_password_enc || null;
          let passwordUpdated = false;

          if (wifi_password !== undefined && wifi_password !== null && String(wifi_password).trim() !== '') {
            const plain = String(wifi_password).trim();
            try {
              newPasswordEnc = await encryptWifiPasswordWebCrypto(plain, env.WIFI_CREDENTIAL_ENCRYPTION_KEY, room.id);
              passwordUpdated = true;
            } catch (encErr) {
              return new Response(JSON.stringify({
                error: 'ไม่สามารถเข้ารหัสรหัสผ่าน Wi-Fi ได้ กรุณาตรวจสอบการตั้งค่ากุญแจความปลอดภัย',
                code: encErr.code || 'ERR_WIFI_ENCRYPT_FAILED'
              }), { status: 500, headers: secureHeaders });
            }
          }

          try {
            await env.DB.prepare('UPDATE rooms SET wifi_username = ?, wifi_password_enc = ? WHERE id = ?').bind(newUsername, newPasswordEnc, room.id).run();
            return new Response(JSON.stringify({
              success: true,
              message: 'บันทึกข้อมูลการเชื่อมต่อ Wi-Fi สำเร็จ',
              room_id: room.id,
              wifi_username: newUsername,
              has_password: Boolean(newPasswordEnc),
              wifi_configured: Boolean(newUsername && newPasswordEnc),
              password_updated: passwordUpdated
            }), { headers: secureHeaders });
          } catch (updateErr) {
            return new Response(JSON.stringify({ error: 'Wi-Fi schema migration pending approval', code: 'MIGRATION_PENDING' }), { status: 503, headers: secureHeaders });
          }
        }
      }

      if (pathname === '/api/services') {
        if (method === 'GET') {
          const statusParam = url.searchParams.get('status');
          let query = "SELECT * FROM services";
          const params = [];
          if (statusParam) {
            query += " WHERE status = ?";
            params.push(statusParam);
          }
          query += " ORDER BY name ASC";
          const { results } = await env.DB.prepare(query).bind(...params).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, 'services');
          const ins = await env.DB.prepare(
            "INSERT INTO services (name, price, category, image_url, description, status) VALUES (?, ?, ?, ?, ?, 'active')"
          ).bind(body.name, body.price || 0, body.category || 'catering', imageUrl || null, body.description || '').run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'บันทึกบริการสำเร็จ' }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/services/')) {
        const serviceId = pathname.replace('/api/services/', '');
        if (method === 'PUT') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, 'services');
          await env.DB.prepare(
            "UPDATE services SET name=?, price=?, category=?, image_url=?, description=?, status=? WHERE id=?"
          ).bind(body.name, body.price || 0, body.category || 'catering', imageUrl || null, body.description || '', body.status || 'active', serviceId).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขบริการสำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          await env.DB.prepare("UPDATE services SET status = 'inactive' WHERE id = ?").bind(serviceId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบบริการสำเร็จ' }), { headers: corsHeaders });
        }
      }

      if (pathname === '/api/categories' || pathname.startsWith('/api/categories/')) {
        return new Response(JSON.stringify(['Meeting Room', 'Co-Working Space', 'Event Hall', 'catering', 'equipment', 'staff']), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 3. PUBLIC ROOMS & SCHEDULE
      // ----------------------------------------------------
      if (pathname === '/api/public/rooms/schedule') {
        const date = url.searchParams.get('date');
        const { results: rooms } = await env.DB.prepare("SELECT * FROM rooms WHERE status = 'active' ORDER BY name ASC").all();

        let query = `
          SELECT bi.*, b.customer_name, b.payment_status
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          WHERE b.payment_status != 'cancelled'
        `;
        const params = [];
        if (date) {
          query += " AND bi.start_time LIKE ?";
          params.push(`${date}%`);
        }

        const { results: bookings } = await env.DB.prepare(query).bind(...params).all();

        const scheduleMap = (rooms || []).map(room => {
          const safeRoom = { ...room };
          delete safeRoom.pin_code;
          delete safeRoom.builtland_pin_code;
          return {
            ...safeRoom,
            bookings: (bookings || [])
              .filter(b => b.room_id === room.id)
              .map(b => {
                const safeB = { ...b };
                delete safeB.pin_code;
                return safeB;
              })
          };
        });

        const bufferMins = await getCleaningBufferMinutes(env);
        return new Response(JSON.stringify({ date, cleaning_buffer_minutes: bufferMins, buffer_minutes: bufferMins, rooms: scheduleMap }), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings/check-overlap') {
        const roomId = url.searchParams.get('room_id');
        const startTime = url.searchParams.get('start_time');
        const endTime = url.searchParams.get('end_time');
        const excludeBookingId = url.searchParams.get('exclude_booking_id');
        const overlapResult = await checkRoomOverlap(env, roomId, startTime, endTime, excludeBookingId);
        return new Response(JSON.stringify(overlapResult), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings/calendar' && method === 'GET') {
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');

        let query = `
          SELECT bi.start_time, bi.end_time, bi.room_id, bi.subtotal, bi.price, bi.quantity, bi.layout, bi.booking_type,
                 bi.guest_count as item_guest_count,
                 r.name as room_name,
                 b.id as booking_id, b.customer_name, b.payment_status, b.booking_source, b.department, b.contact, b.guest_count
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          LEFT JOIN rooms r ON bi.room_id = r.id
          WHERE bi.room_id IS NOT NULL AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
        `;
        const params = [];
        if (month && year) {
          const mStr = String(month).padStart(2, '0');
          query += ` AND bi.start_time LIKE ?`;
          params.push(`${year}-${mStr}%`);
        }
        query += ` ORDER BY bi.start_time ASC`;

        const { results } = await env.DB.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results || []), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings/upcoming-alerts' && method === 'GET') {
        const alertSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'room_alert_minutes'").first();
        const alertMinutes = alertSetting && alertSetting.value ? parseInt(alertSetting.value, 10) : 15;

        // Current time in Bangkok timezone (UTC+7)
        const bangkokNow = new Date(Date.now() + 7 * 3600 * 1000);

        // Window: strictly starting soon (from 2 mins ago up to alertMinutes into the future)
        const startWindow = new Date(bangkokNow.getTime() - 2 * 60 * 1000);
        const endWindow = new Date(bangkokNow.getTime() + alertMinutes * 60 * 1000);

        const formatISO = (d) => {
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, '0');
          const day = String(d.getUTCDate()).padStart(2, '0');
          const h = String(d.getUTCHours()).padStart(2, '0');
          const min = String(d.getUTCMinutes()).padStart(2, '0');
          const s = String(d.getUTCSeconds()).padStart(2, '0');
          return `${y}-${m}-${day}T${h}:${min}:${s}`;
        };

        const startWindowStr = formatISO(startWindow);
        const endWindowStr = formatISO(endWindow);

        // 1. Upcoming bookings nearing start time (within 15 mins)
        const { results: upcoming } = await env.DB.prepare(`
          SELECT bi.start_time, bi.end_time, bi.room_id, bi.layout, bi.booking_type,
                 r.name as room_name,
                 b.id as booking_id, b.customer_name, b.payment_status
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          LEFT JOIN rooms r ON bi.room_id = r.id
          WHERE bi.room_id IS NOT NULL
            AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
            AND bi.start_time >= ?
            AND bi.start_time <= ?
          ORDER BY bi.start_time ASC LIMIT 10
        `).bind(startWindowStr, endWindowStr).all();

        // 2. Today's full schedule for notification history in bell
        const todayPrefix = formatISO(bangkokNow).split('T')[0];
        const { results: todayBookings } = await env.DB.prepare(`
          SELECT bi.start_time, bi.end_time, bi.room_id, bi.layout, bi.booking_type,
                 r.name as room_name,
                 b.id as booking_id, b.customer_name, b.payment_status
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          LEFT JOIN rooms r ON bi.room_id = r.id
          WHERE bi.room_id IS NOT NULL
            AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
            AND bi.start_time LIKE ?
          ORDER BY bi.start_time ASC LIMIT 30
        `).bind(`${todayPrefix}%`).all();

        // 3. Incoming LINE OA / Online bookings (pending or reviewing)
        const { results: incomingList } = await env.DB.prepare(`
          SELECT b.id as booking_id, b.customer_name, b.total_amount, b.payment_status, b.created_at, b.booking_source,
                 (CASE WHEN b.slip_image_url IS NOT NULL AND b.slip_image_url != '' THEN 'uploaded' ELSE NULL END) as slip_image_url,
                 r.name as room_name, bi.start_time, bi.end_time
          FROM bookings b
          LEFT JOIN booking_items bi ON bi.booking_id = b.id
          LEFT JOIN rooms r ON bi.room_id = r.id
          WHERE b.payment_status IN ('pending', 'reviewing')
          ORDER BY b.id DESC LIMIT 20
        `).all();

        const pendingCountRes = await env.DB.prepare("SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'pending'").first();
        const reviewingCountRes = await env.DB.prepare("SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'reviewing'").first();

        return new Response(JSON.stringify({
          upcoming: upcoming || [],
          todayBookings: todayBookings || [],
          incomingBookings: incomingList || [],
          pendingCount: (pendingCountRes?.count || 0) + (reviewingCountRes?.count || 0),
          reviewingCount: reviewingCountRes?.count || 0
        }), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 4. POS BOOKINGS (STAFF SIDE - REQUIRES AUTH)
      // ----------------------------------------------------

      // ----------------------------------------------------
      // BASECAMP QUOTA HUB ENDPOINTS
      // ----------------------------------------------------
      if (pathname.startsWith('/api/basecamp')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) {
          return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        }
        const user = auth.user;
        if (user && user.role !== 'admin') {
          const perms = (user.permissions || '').split(',').map(p => p.trim());
          if (!perms.some(p => ['pos', 'manage', 'pending', 'history'].includes(p))) {
            return new Response(JSON.stringify({ error: 'ไม่มีสิทธิ์เข้าถึงข้อมูลโควตา Basecamp' }), { status: 403, headers: corsHeaders });
          }
        }
      }

      if (pathname === '/api/basecamp/quota' && method === 'GET') {
        const subType = url.searchParams.get('sub_type') || 'office';
        const unit = url.searchParams.get('unit') || '401';
        const now = new Date();
        const month = url.searchParams.get('month') || String(now.getMonth() + 1);
        const year = url.searchParams.get('year') || String(now.getFullYear());
        const targetMonthStr = `${year}-${String(month).padStart(2, '0')}`;
        const maxQuota = subType === 'office' ? 4 : 2;

        try {
          const quotaRow = await env.DB.prepare(
            `SELECT COALESCE(SUM(b.quota_hours_used), 0) as used_hours
             FROM bookings b
             WHERE b.customer_type = 'basecamp'
               AND b.basecamp_sub_type = ?
               AND b.basecamp_unit = ?
               AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
               AND (
                 EXISTS (
                   SELECT 1 FROM booking_items bi
                   WHERE bi.booking_id = b.id
                     AND strftime('%Y-%m', bi.start_time) = ?
                 )
                 OR (
                   NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id)
                   AND strftime('%Y-%m', b.created_at) = ?
                 )
               )`
          ).bind(subType, unit, targetMonthStr, targetMonthStr).first();

          const usedQuota = quotaRow ? Number(quotaRow.used_hours) : 0;
          const remainingQuota = Math.max(0, maxQuota - usedQuota);

          return new Response(JSON.stringify({
            sub_type: subType,
            unit: unit,
            target_month: targetMonthStr,
            max_quota: maxQuota,
            used_quota: usedQuota,
            remaining_quota: remainingQuota
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({
            sub_type: subType,
            unit: unit,
            target_month: targetMonthStr,
            max_quota: maxQuota,
            used_quota: 0,
            remaining_quota: maxQuota
          }), { headers: corsHeaders });
        }
      }

      if (pathname === '/api/basecamp/quota/overview' && method === 'GET') {
        const now = new Date();
        const month = url.searchParams.get('month') || String(now.getMonth() + 1);
        const year = url.searchParams.get('year') || String(now.getFullYear());
        const targetMonthStr = `${year}-${String(month).padStart(2, '0')}`;

        const OFFICE_UNITS = ['401','402','403','404','405','406','407','408','409','410','411','412','413','414'];
        const HOTDESK_UNITS = ['419','420','421','422','427','428','429','430'];

        try {
          const { results: rows } = await env.DB.prepare(
            `SELECT b.basecamp_sub_type, b.basecamp_unit, COALESCE(SUM(b.quota_hours_used), 0) as used_hours, COUNT(DISTINCT b.id) as booking_count
             FROM bookings b
             WHERE b.customer_type = 'basecamp'
               AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
               AND (
                 EXISTS (
                   SELECT 1 FROM booking_items bi
                   WHERE bi.booking_id = b.id
                     AND strftime('%Y-%m', bi.start_time) = ?
                 )
                 OR (
                   NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id)
                   AND strftime('%Y-%m', b.created_at) = ?
                 )
               )
             GROUP BY b.basecamp_sub_type, b.basecamp_unit`
          ).bind(targetMonthStr, targetMonthStr).all();

          const usageMap = {};
          (rows || []).forEach(r => {
            usageMap[`${r.basecamp_sub_type}_${r.basecamp_unit}`] = {
              used_quota: Number(r.used_hours),
              booking_count: Number(r.booking_count)
            };
          });

          const units = [];
          OFFICE_UNITS.forEach(u => {
            const usage = usageMap[`office_${u}`] || { used_quota: 0, booking_count: 0 };
            const maxQuota = 4;
            units.push({
              sub_type: 'office',
              unit: u,
              label: `Office ${u}`,
              max_quota: maxQuota,
              used_quota: usage.used_quota,
              remaining_quota: Math.max(0, maxQuota - usage.used_quota),
              used_count: usage.booking_count
            });
          });

          HOTDESK_UNITS.forEach(u => {
            const usage = usageMap[`hotdesk_${u}`] || { used_quota: 0, booking_count: 0 };
            const maxQuota = 2;
            units.push({
              sub_type: 'hotdesk',
              unit: u,
              label: `Hotdesk ${u}`,
              max_quota: maxQuota,
              used_quota: usage.used_quota,
              remaining_quota: Math.max(0, maxQuota - usage.used_quota),
              used_count: usage.booking_count
            });
          });

          return new Response(JSON.stringify({
            success: true,
            target_month: targetMonthStr,
            units
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      if (pathname === '/api/basecamp/quota/history' && method === 'GET') {
        const subType = url.searchParams.get('sub_type');
        const unit = url.searchParams.get('unit');
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');
        const targetMonthStr = (month && year) ? `${year}-${String(month).padStart(2, '0')}` : null;

        try {
          let sql = `
            SELECT b.id, b.receipt_number, b.customer_name, b.created_at, b.quota_hours_used,
                   bi.start_time, bi.end_time, bi.price, bi.subtotal, r.name as room_name
            FROM bookings b
            LEFT JOIN booking_items bi ON b.id = bi.booking_id
            LEFT JOIN rooms r ON bi.room_id = r.id
            WHERE b.customer_type = 'basecamp'
              AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
          `;
          const params = [];
          if (subType) { sql += ` AND b.basecamp_sub_type = ?`; params.push(subType); }
          if (unit) { sql += ` AND b.basecamp_unit = ?`; params.push(unit); }
          if (targetMonthStr) {
            sql += ` AND (strftime('%Y-%m', bi.start_time) = ? OR strftime('%Y-%m', b.created_at) = ?)`;
            params.push(targetMonthStr, targetMonthStr);
          }
          sql += ` ORDER BY b.created_at DESC`;

          const { results: bookings } = await env.DB.prepare(sql).bind(...params).all();
          return new Response(JSON.stringify({ success: true, bookings: bookings || [] }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // ----------------------------------------------------
      // CUSTOMER, SHOP & CONTRACT MANAGEMENT HELPERS
      // ----------------------------------------------------
      function calculateWorkerDaysDiff(targetDateStr, baseDateStr) {
        if (!targetDateStr) return 0;
        const target = new Date(`${targetDateStr}T00:00:00+07:00`);
        const base = new Date(`${baseDateStr}T00:00:00+07:00`);
        const diffMs = target.getTime() - base.getTime();
        return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      }

      function evaluateWorkerContractStatus(contract, baseDateStr) {
        if (!contract) return null;
        const today = baseDateStr || getBangkokLocalISO(new Date()).slice(0, 10);
        if (contract.status === 'TERMINATED') {
          return {
            status: 'TERMINATED',
            days_left: calculateWorkerDaysDiff(contract.end_date, today),
            urgency: 'terminated',
            is_active_or_expiring: false
          };
        }

        const daysLeft = calculateWorkerDaysDiff(contract.end_date, today);
        let status = 'ACTIVE';
        let urgency = 'normal';

        if (daysLeft < 0) {
          status = 'EXPIRED';
          urgency = 'expired';
        } else if (daysLeft <= 7) {
          status = 'EXPIRING';
          urgency = 'danger';
        } else if (daysLeft <= 15) {
          status = 'EXPIRING';
          urgency = 'warning';
        } else if (daysLeft <= 30) {
          status = 'EXPIRING';
          urgency = 'info';
        }

        return {
          status,
          days_left: daysLeft,
          urgency,
          is_active_or_expiring: status === 'ACTIVE' || status === 'EXPIRING'
        };
      }

      function verifyWorkerContractEligibility(contract, serviceDateStr) {
        if (!contract) return { eligible: false, reason: 'NO_CONTRACT' };
        if (contract.status === 'TERMINATED') return { eligible: false, reason: 'CONTRACT_TERMINATED' };
        const today = getBangkokLocalISO(new Date()).slice(0, 10);
        const serviceDate = serviceDateStr ? serviceDateStr.slice(0, 10) : today;
        if (contract.start_date && serviceDate < contract.start_date) {
          return { eligible: false, reason: 'SERVICE_DATE_BEFORE_CONTRACT_START' };
        }
        if (contract.end_date && serviceDate > contract.end_date) {
          return { eligible: false, reason: 'SERVICE_DATE_AFTER_CONTRACT_EXPIRATION' };
        }
        return { eligible: true };
      }

      async function recordWorkerCustomerAudit(env, { customerId, contractId, action, details, performedBy }) {
        try {
          await env.DB.prepare(
            `INSERT INTO customer_audit_logs (customer_id, contract_id, action, details, performed_by)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(customerId || null, contractId || null, action, JSON.stringify(details || {}), performedBy || 'system').run();
        } catch (e) {
          console.warn('[WorkerCustomerAudit] Failed to write log:', e.message);
        }
      }

      async function generateWorkerUniqueContractNumber(env, prefix) {
        let candidate = prefix;
        let counter = 1;
        while (true) {
          const existing = await env.DB.prepare(
            'SELECT id FROM customer_contracts WHERE contract_number = ?'
          ).bind(candidate).first();
          if (!existing) return candidate;
          candidate = `${prefix}-${String(counter++).padStart(2, '0')}`;
        }
      }

      async function calculateWorkerCustomerQuota(env, { customerId, customerType, basecampSubType, basecampUnit, serviceDate, month, year }) {
        const today = getBangkokLocalISO(new Date()).slice(0, 10);
        const targetDate = serviceDate ? serviceDate.slice(0, 10) : today;
        const targetYear = year ? String(year) : targetDate.slice(0, 4);
        const targetMonth = month ? String(month).padStart(2, '0') : targetDate.slice(5, 7);
        const targetMonthStr = `${targetYear}-${targetMonth}`;

        let customer = null;
        let activeContract = null;
        let maxQuota = 0;

        if (customerId) {
          customer = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first();
          const { results: contracts } = await env.DB.prepare(
            `SELECT * FROM customer_contracts
             WHERE customer_id = ?
             ORDER BY CASE WHEN ? BETWEEN start_date AND end_date THEN 0
                           WHEN status IN ('ACTIVE', 'EXPIRING') THEN 1
                           ELSE 2 END, end_date DESC`
          ).bind(customerId, targetDate).all();

          if (contracts && contracts.length > 0) {
            activeContract = contracts[0];
            const evaluation = evaluateWorkerContractStatus(activeContract, targetDate);
            activeContract.evaluated_status = evaluation.status;
            activeContract.days_left = evaluation.days_left;
            activeContract.urgency = evaluation.urgency;
          }
        }

        const effectiveType = customer ? customer.customer_type : (customerType || 'walkin');
        const effectiveSubType = customer ? customer.basecamp_sub_type : basecampSubType;
        const effectiveUnit = customer ? customer.basecamp_unit : basecampUnit;

        if (effectiveType === 'shop') {
          maxQuota = activeContract ? Number(activeContract.monthly_quota_hours || 4.0) : 4.0;
        } else if (effectiveType === 'basecamp') {
          if (activeContract && activeContract.monthly_quota_hours) {
            maxQuota = Number(activeContract.monthly_quota_hours);
          } else {
            maxQuota = effectiveSubType === 'office' ? 4.0 : 2.0;
          }
        } else {
          maxQuota = 0;
        }

        let contractEligible = true;
        let ineligibilityReason = null;
        if (activeContract) {
          const eligibility = verifyWorkerContractEligibility(activeContract, targetDate);
          if (!eligibility.eligible) {
            contractEligible = false;
            ineligibilityReason = eligibility.reason;
          }
        } else if (effectiveType === 'shop') {
          contractEligible = false;
          ineligibilityReason = 'NO_CONTRACT';
        }

        let usedQuota = 0;
        let bookingCount = 0;

        if (customer && customer.id) {
          const row = await env.DB.prepare(
            `SELECT COALESCE(SUM(b.quota_hours_used), 0) AS used_hours, COUNT(DISTINCT b.id) AS booking_count
             FROM bookings b
             WHERE b.customer_id = ?
               AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
               AND (
                 EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id AND strftime('%Y-%m', bi.start_time) = ?)
                 OR (NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id) AND strftime('%Y-%m', b.created_at) = ?)
               )`
          ).bind(customer.id, targetMonthStr, targetMonthStr).first();
          usedQuota = row ? Number(row.used_hours) : 0;
          bookingCount = row ? Number(row.booking_count) : 0;
        } else if (effectiveType === 'basecamp' && effectiveSubType && effectiveUnit) {
          const row = await env.DB.prepare(
            `SELECT COALESCE(SUM(b.quota_hours_used), 0) AS used_hours, COUNT(DISTINCT b.id) AS booking_count
             FROM bookings b
             WHERE b.customer_type = 'basecamp'
               AND b.basecamp_sub_type = ?
               AND b.basecamp_unit = ?
               AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
               AND (
                 EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id AND strftime('%Y-%m', bi.start_time) = ?)
                 OR (NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id) AND strftime('%Y-%m', b.created_at) = ?)
               )`
          ).bind(effectiveSubType, effectiveUnit, targetMonthStr, targetMonthStr).first();
          usedQuota = row ? Number(row.used_hours) : 0;
          bookingCount = row ? Number(row.booking_count) : 0;
        }

        const effectiveMaxQuota = contractEligible ? maxQuota : 0;
        const remainingQuota = Math.max(0, effectiveMaxQuota - usedQuota);

        return {
          customer_id: customer ? customer.id : null,
          customer_name: customer ? customer.name : null,
          customer_type: effectiveType,
          basecamp_sub_type: effectiveSubType,
          basecamp_unit: effectiveUnit,
          target_month: targetMonthStr,
          service_date: targetDate,
          max_quota: maxQuota,
          used_quota: usedQuota,
          remaining_quota: remainingQuota,
          booking_count: bookingCount,
          contract: activeContract,
          contract_eligible: contractEligible,
          ineligibility_reason: ineligibilityReason
        };
      }

      // ----------------------------------------------------
      // CUSTOMER, SHOP & CONTRACT MANAGEMENT ENDPOINTS
      // ----------------------------------------------------
      if (pathname.startsWith('/api/customers')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) {
          return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        }
        const user = auth.user;
        if (user && user.role !== 'admin') {
          const perms = (user.permissions || '').split(',').map(p => p.trim());
          if (!perms.some(p => ['customers', 'admin-management'].includes(p))) {
            return new Response(JSON.stringify({ error: 'ไม่มีสิทธิ์เข้าถึงข้อมูลลูกค้า' }), { status: 403, headers: corsHeaders });
          }
        }
      }

      // 1. GET /api/customers/contracts/alerts
      if (pathname === '/api/customers/contracts/alerts' && method === 'GET') {
        try {
          const today = url.searchParams.get('date') || getBangkokLocalISO(new Date()).slice(0, 10);
          const { results: rows } = await env.DB.prepare(`
            SELECT ctr.id AS contract_id, ctr.contract_number, ctr.start_date, ctr.end_date,
                   ctr.monthly_quota_hours, ctr.status AS db_status, ctr.notes,
                   c.id AS customer_id, c.name AS customer_name, c.customer_type,
                   c.basecamp_sub_type, c.basecamp_unit, c.contact_name, c.phone, c.email
            FROM customer_contracts ctr
            JOIN customers c ON ctr.customer_id = c.id
            WHERE ctr.status != 'TERMINATED'
            ORDER BY ctr.end_date ASC
          `).all();

          const alerts = [];
          const summary = {
            expiring_30_days: 0,
            expiring_15_days: 0,
            expiring_7_days: 0,
            expired: 0,
            total_active: 0
          };

          for (const row of rows || []) {
            const evaluation = evaluateWorkerContractStatus(row, today);
            const item = {
              ...row,
              days_left: evaluation.days_left,
              status: evaluation.status,
              urgency: evaluation.urgency
            };

            if (item.status === 'EXPIRED') {
              summary.expired++;
              alerts.push(item);
            } else if (item.status === 'EXPIRING') {
              if (item.days_left <= 7) summary.expiring_7_days++;
              else if (item.days_left <= 15) summary.expiring_15_days++;
              else summary.expiring_30_days++;
              alerts.push(item);
            } else {
              summary.total_active++;
            }
          }

          return new Response(JSON.stringify({
            success: true,
            base_date: today,
            summary,
            alerts
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 2. GET /api/customers
      if (pathname === '/api/customers' && method === 'GET') {
        const type = url.searchParams.get('type');
        const status = url.searchParams.get('status');
        const q = url.searchParams.get('q');
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');

        try {
          let sql = 'SELECT * FROM customers WHERE 1=1';
          const params = [];
          if (type && type !== 'all') {
            sql += ' AND customer_type = ?';
            params.push(type);
          }
          if (status && status !== 'all') {
            sql += ' AND status = ?';
            params.push(status);
          }
          if (q && q.trim()) {
            sql += ' AND (name LIKE ? OR contact_name LIKE ? OR phone LIKE ? OR basecamp_unit LIKE ?)';
            const term = `%${q.trim()}%`;
            params.push(term, term, term, term);
          }
          sql += ' ORDER BY CASE customer_type WHEN \'basecamp\' THEN 0 ELSE 1 END, basecamp_unit ASC, name ASC';

          const { results: customers } = await env.DB.prepare(sql).bind(...params).all();

          const enriched = await Promise.all((customers || []).map(async (c) => {
            const { results: contracts } = await env.DB.prepare(
              `SELECT * FROM customer_contracts
               WHERE customer_id = ?
               ORDER BY CASE WHEN status IN ('ACTIVE', 'EXPIRING') THEN 0 ELSE 1 END, end_date DESC`
            ).bind(c.id).all();

            const activeContract = contracts && contracts.length > 0 ? contracts[0] : null;
            if (activeContract) {
              const evalRes = evaluateWorkerContractStatus(activeContract);
              activeContract.evaluated_status = evalRes.status;
              activeContract.days_left = evalRes.days_left;
              activeContract.urgency = evalRes.urgency;
            }

            const quota = await calculateWorkerCustomerQuota(env, {
              customerId: c.id,
              month,
              year
            });

            return {
              ...c,
              active_contract: activeContract,
              contracts: contracts || [],
              quota
            };
          }));

          return new Response(JSON.stringify({ success: true, customers: enriched }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 3. POST /api/customers
      if (pathname === '/api/customers' && method === 'POST') {
        try {
          const body = await request.json();
          const {
            customer_type,
            name,
            contact_name,
            phone,
            email,
            tax_id,
            address,
            basecamp_sub_type,
            basecamp_unit,
            start_date,
            end_date,
            monthly_quota_hours,
            contract_number,
            notes
          } = body;

          if (!name || !name.trim()) {
            return new Response(JSON.stringify({ error: 'ชื่อลูกค้าหรือชื่อร้านค้าจำเป็นต้องระบุ' }), { status: 400, headers: corsHeaders });
          }
          if (start_date && end_date && start_date > end_date) {
            return new Response(JSON.stringify({ error: 'วันเริ่มสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา' }), { status: 400, headers: corsHeaders });
          }
          const cleanType = customer_type === 'shop' ? 'shop' : 'basecamp';

          if (cleanType === 'basecamp' && basecamp_unit) {
            const existingActive = await env.DB.prepare(
              `SELECT id, name FROM customers
               WHERE customer_type = 'basecamp' AND basecamp_unit = ? AND status = 'active'`
            ).bind(basecamp_unit).first();
            if (existingActive) {
              return new Response(JSON.stringify({
                error: `ยูนิต ${basecamp_unit} มีผู้เช่าที่ใช้งานอยู่แล้ว (${existingActive.name}) กรุณาใช้ฟังก์ชันเปลี่ยนผู้เช่าหรือปิดสถานะผู้เช่าเดิมก่อน`
              }), { status: 400, headers: corsHeaders });
            }
          }

          const insertRes = await env.DB.prepare(
            `INSERT INTO customers
             (customer_type, name, contact_name, phone, email, tax_id, address, basecamp_sub_type, basecamp_unit, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          ).bind(
            cleanType,
            name.trim(),
            contact_name ? contact_name.trim() : null,
            phone ? phone.trim() : null,
            email ? email.trim() : null,
            tax_id ? tax_id.trim() : null,
            address ? address.trim() : null,
            cleanType === 'basecamp' ? (basecamp_sub_type || 'office') : null,
            cleanType === 'basecamp' ? (basecamp_unit || null) : null
          ).run();

          const customerId = insertRes.meta?.last_row_id;
          let contractId = null;
          let effectiveContractNumber = null;

          if (start_date && end_date) {
            const defaultQuota = cleanType === 'shop' ? 4.0 : (basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0);
            const quotaVal = monthly_quota_hours !== undefined ? Number(monthly_quota_hours) : defaultQuota;
            const baseCtr = contract_number && contract_number.trim()
              ? contract_number.trim()
              : (cleanType === 'basecamp'
                  ? `CTR-BC-${basecamp_unit || 'UNIT'}-${start_date.slice(0, 7).replace('-', '')}`
                  : `CTR-SHOP-${customerId}-${start_date.slice(0, 7).replace('-', '')}`);

            let ctrRes = null;
            for (let attempt = 0; attempt < 5; attempt++) {
              effectiveContractNumber = contract_number && contract_number.trim()
                ? contract_number.trim()
                : await generateWorkerUniqueContractNumber(env, baseCtr);
              try {
                ctrRes = await env.DB.prepare(
                  `INSERT INTO customer_contracts
                   (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status, notes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
                ).bind(customerId, effectiveContractNumber, start_date, end_date, quotaVal, notes || null).run();
                break;
              } catch (insertErr) {
                const isUniqueErr = insertErr && (
                  String(insertErr.message || '').includes('UNIQUE constraint failed') ||
                  String(insertErr.message || '').includes('customer_contracts.contract_number') ||
                  String(insertErr.cause || '').includes('UNIQUE')
                );
                if (isUniqueErr && (!contract_number || !contract_number.trim()) && attempt < 4) {
                  continue;
                }
                if (isUniqueErr && contract_number && contract_number.trim()) {
                  return new Response(JSON.stringify({ error: `หมายเลขสัญญา "${contract_number.trim()}" มีอยู่ในระบบแล้ว กรุณาระบุหมายเลขสัญญาใหม่` }), { status: 400, headers: corsHeaders });
                }
                throw insertErr;
              }
            }
            contractId = ctrRes.meta?.last_row_id;
          }

          const auth = await authenticateUser(request, env);
          const performedBy = auth.user?.username || 'staff';
          await recordWorkerCustomerAudit(env, {
            customerId,
            contractId,
            action: 'CREATE_CUSTOMER',
            details: { customer_type: cleanType, name, basecamp_unit, contract_number: effectiveContractNumber, start_date, end_date },
            performedBy
          });

          return new Response(JSON.stringify({
            success: true,
            customer_id: customerId,
            contract_id: contractId,
            message: 'สร้างข้อมูลลูกค้าเรียบร้อยแล้ว'
          }), { status: 201, headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 4. POST /api/customers/transfer-unit
      if (pathname === '/api/customers/transfer-unit' && method === 'POST') {
        try {
          const body = await request.json();
          const { basecamp_unit, new_tenant, new_contract } = body;
          if (!basecamp_unit || !new_tenant || !new_tenant.name) {
            return new Response(JSON.stringify({ error: 'กรุณาระบุเลขยูนิตและข้อมูลผู้เช่ารายใหม่' }), { status: 400, headers: corsHeaders });
          }
          if (new_contract && new_contract.start_date && new_contract.end_date && new_contract.start_date > new_contract.end_date) {
            return new Response(JSON.stringify({ error: 'วันเริ่มสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา' }), { status: 400, headers: corsHeaders });
          }

          const { results: oldTenants } = await env.DB.prepare(
            `SELECT id, name FROM customers
             WHERE customer_type = 'basecamp' AND basecamp_unit = ? AND status = 'active'`
          ).bind(basecamp_unit).all();

          for (const old of (oldTenants || [])) {
            await env.DB.prepare("UPDATE customers SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(old.id).run();
            await env.DB.prepare("UPDATE customer_contracts SET status = 'TERMINATED', updated_at = CURRENT_TIMESTAMP WHERE customer_id = ? AND status IN ('ACTIVE', 'EXPIRING')").bind(old.id).run();
          }

          const subType = new_tenant.basecamp_sub_type || (['419', '420', '421', '422', '427', '428', '429', '430'].includes(basecamp_unit) ? 'hotdesk' : 'office');
          const insRes = await env.DB.prepare(
            `INSERT INTO customers
             (customer_type, name, contact_name, phone, email, tax_id, address, basecamp_sub_type, basecamp_unit, status, created_at, updated_at)
             VALUES ('basecamp', ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          ).bind(
            new_tenant.name.trim(),
            new_tenant.contact_name ? new_tenant.contact_name.trim() : null,
            new_tenant.phone ? new_tenant.phone.trim() : null,
            new_tenant.email ? new_tenant.email.trim() : null,
            new_tenant.tax_id ? new_tenant.tax_id.trim() : null,
            new_tenant.address ? new_tenant.address.trim() : null,
            subType,
            basecamp_unit
          ).run();
          const newCustomerId = insRes.meta?.last_row_id;

          let newContractId = null;
          let ctrNum = null;
          if (new_contract && new_contract.start_date && new_contract.end_date) {
            const quotaVal = new_contract.monthly_quota_hours !== undefined
              ? Number(new_contract.monthly_quota_hours)
              : (subType === 'hotdesk' ? 2.0 : 4.0);
            const baseCtr = new_contract.contract_number && new_contract.contract_number.trim()
              ? new_contract.contract_number.trim()
              : `CTR-BC-${basecamp_unit}-${new_contract.start_date.slice(0, 7).replace('-', '')}`;

            let ctrRes = null;
            for (let attempt = 0; attempt < 5; attempt++) {
              ctrNum = new_contract.contract_number && new_contract.contract_number.trim()
                ? new_contract.contract_number.trim()
                : await generateWorkerUniqueContractNumber(env, baseCtr);
              try {
                ctrRes = await env.DB.prepare(
                  `INSERT INTO customer_contracts
                   (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status, notes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
                ).bind(newCustomerId, ctrNum, new_contract.start_date, new_contract.end_date, quotaVal, new_contract.notes || null).run();
                break;
              } catch (insertErr) {
                const isUniqueErr = insertErr && (
                  String(insertErr.message || '').includes('UNIQUE constraint failed') ||
                  String(insertErr.message || '').includes('customer_contracts.contract_number') ||
                  String(insertErr.cause || '').includes('UNIQUE')
                );
                if (isUniqueErr && (!new_contract.contract_number || !new_contract.contract_number.trim()) && attempt < 4) {
                  continue;
                }
                if (isUniqueErr && new_contract.contract_number && new_contract.contract_number.trim()) {
                  return new Response(JSON.stringify({ error: `หมายเลขสัญญา "${new_contract.contract_number.trim()}" มีอยู่ในระบบแล้ว กรุณาระบุหมายเลขสัญญาใหม่` }), { status: 400, headers: corsHeaders });
                }
                throw insertErr;
              }
            }
            newContractId = ctrRes.meta?.last_row_id;
          }

          const auth = await authenticateUser(request, env);
          const performedBy = auth.user?.username || 'staff';
          await recordWorkerCustomerAudit(env, {
            customerId: newCustomerId,
            contractId: newContractId,
            action: 'TRANSFER_UNIT',
            details: {
              basecamp_unit,
              previous_tenants: oldTenants ? oldTenants.map(t => ({ id: t.id, name: t.name })) : [],
              new_tenant_name: new_tenant.name
            },
            performedBy
          });

          return new Response(JSON.stringify({
            success: true,
            customer_id: newCustomerId,
            contract_id: newContractId,
            message: `เปลี่ยนผู้เช่ายูนิต ${basecamp_unit} เรียบร้อยแล้ว ประวัติของผู้เช่าเดิมถูกแยกเก็บอย่างปลอดภัย`
          }), { status: 201, headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 5. GET /api/customers/:id/quota
      const quotaMatch = pathname.match(/^\/api\/customers\/(\d+)\/quota$/);
      if (quotaMatch && method === 'GET') {
        const customerId = parseInt(quotaMatch[1], 10);
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');
        const date = url.searchParams.get('date');
        try {
          const quota = await calculateWorkerCustomerQuota(env, {
            customerId,
            serviceDate: date,
            month,
            year
          });
          return new Response(JSON.stringify({ success: true, ...quota }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 6. POST /api/customers/:id/contracts
      const addContractMatch = pathname.match(/^\/api\/customers\/(\d+)\/contracts$/);
      if (addContractMatch && method === 'POST') {
        const customerId = parseInt(addContractMatch[1], 10);
        try {
          const body = await request.json();
          const { contract_number, start_date, end_date, monthly_quota_hours, notes } = body;
          if (!start_date || !end_date) {
            return new Response(JSON.stringify({ error: 'วันเริ่มสัญญาและวันสิ้นสุดสัญญาจำเป็นต้องระบุ' }), { status: 400, headers: corsHeaders });
          }

          if (start_date > end_date) {
            return new Response(JSON.stringify({ error: 'วันเริ่มสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา' }), { status: 400, headers: corsHeaders });
          }

          const customer = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first();
          if (!customer) {
            return new Response(JSON.stringify({ error: 'Customer not found' }), { status: 404, headers: corsHeaders });
          }

          // Check for overlapping active contracts
          const overlapping = await env.DB.prepare(
            `SELECT id, contract_number, start_date, end_date FROM customer_contracts
             WHERE customer_id = ?
               AND status != 'TERMINATED'
               AND start_date <= ?
               AND end_date >= ?
             LIMIT 1`
          ).bind(customerId, end_date, start_date).first();

          if (overlapping) {
            return new Response(JSON.stringify({
              error: `ช่วงเวลาของสัญญานี้ซ้อนทับกับสัญญาที่มีอยู่ (${overlapping.contract_number}: ${overlapping.start_date} ถึง ${overlapping.end_date})`
            }), { status: 400, headers: corsHeaders });
          }

          const defaultQuota = customer.customer_type === 'shop' ? 4.0 : (customer.basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0);
          const quotaVal = monthly_quota_hours !== undefined ? Number(monthly_quota_hours) : defaultQuota;
          const baseCtr = contract_number && contract_number.trim()
            ? contract_number.trim()
            : (customer.customer_type === 'basecamp'
                ? `CTR-BC-${customer.basecamp_unit || 'UNIT'}-${start_date.slice(0, 7).replace('-', '')}`
                : `CTR-SHOP-${customerId}-${start_date.slice(0, 7).replace('-', '')}`);
          let ctrRes = null;
          let ctrNum = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            ctrNum = contract_number && contract_number.trim()
              ? contract_number.trim()
              : await generateWorkerUniqueContractNumber(env, baseCtr);
            try {
              ctrRes = await env.DB.prepare(
                `INSERT INTO customer_contracts
                 (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status, notes, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
              ).bind(customerId, ctrNum, start_date, end_date, quotaVal, notes || null).run();
              break;
            } catch (insertErr) {
              const isUniqueErr = insertErr && (
                String(insertErr.message || '').includes('UNIQUE constraint failed') ||
                String(insertErr.message || '').includes('customer_contracts.contract_number') ||
                String(insertErr.cause || '').includes('UNIQUE')
              );
              if (isUniqueErr && (!contract_number || !contract_number.trim()) && attempt < 4) {
                continue;
              }
              if (isUniqueErr && contract_number && contract_number.trim()) {
                return new Response(JSON.stringify({ error: `หมายเลขสัญญา "${contract_number.trim()}" มีอยู่ในระบบแล้ว กรุณาระบุหมายเลขสัญญาใหม่` }), { status: 400, headers: corsHeaders });
              }
              throw insertErr;
            }
          }

          const auth = await authenticateUser(request, env);
          const performedBy = auth.user?.username || 'staff';
          await recordWorkerCustomerAudit(env, {
            customerId,
            contractId: ctrRes.meta?.last_row_id,
            action: 'RENEW_CONTRACT',
            details: { contract_number: ctrNum, start_date, end_date, monthly_quota_hours: quotaVal, notes },
            performedBy
          });

          return new Response(JSON.stringify({
            success: true,
            contract_id: ctrRes.meta?.last_row_id,
            message: 'บันทึกสัญญาใหม่/ต่อสัญญาเรียบร้อยแล้ว'
          }), { status: 201, headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 7. PATCH /api/customers/contracts/:contractId/terminate
      const termContractMatch = pathname.match(/^\/api\/customers\/contracts\/(\d+)\/terminate$/);
      if (termContractMatch && method === 'PATCH') {
        const contractId = parseInt(termContractMatch[1], 10);
        try {
          const body = await request.json();
          const { termination_date, reason } = body;
          const today = getBangkokLocalISO(new Date()).slice(0, 10);
          const effectiveTermDate = termination_date || today;

          const contract = await env.DB.prepare('SELECT * FROM customer_contracts WHERE id = ?').bind(contractId).first();
          if (!contract) {
            return new Response(JSON.stringify({ error: 'Contract not found' }), { status: 404, headers: corsHeaders });
          }

          const updatedNotes = contract.notes
            ? `${contract.notes}\n[TERMINATED ${effectiveTermDate}]: ${reason || 'ยกเลิกสัญญาก่อนกำหนด'}`
            : `[TERMINATED ${effectiveTermDate}]: ${reason || 'ยกเลิกสัญญาก่อนกำหนด'}`;

          await env.DB.prepare(
            `UPDATE customer_contracts
             SET status = 'TERMINATED', end_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).bind(effectiveTermDate, updatedNotes, contractId).run();

          const auth = await authenticateUser(request, env);
          const performedBy = auth.user?.username || 'staff';
          await recordWorkerCustomerAudit(env, {
            customerId: contract.customer_id,
            contractId,
            action: 'TERMINATE_CONTRACT',
            details: { termination_date: effectiveTermDate, reason },
            performedBy
          });

          return new Response(JSON.stringify({ success: true, message: 'ยกเลิกสัญญาเรียบร้อยแล้ว' }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

// 7.1. PUT & PATCH /api/customers/contracts/:contractId/dates
      const editContractDatesMatch = pathname.match(/^\/api\/customers\/contracts\/(\d+)\/dates$/);
      if (editContractDatesMatch && (method === 'PUT' || method === 'PATCH')) {
        const contractId = parseInt(editContractDatesMatch[1], 10);
        const hasContractManagePermission = user && (
          user.role === 'admin' ||
          user.username === 'admin' ||
          String(user.permissions || '').split(',').map(p => p.trim()).includes('manage') ||
          String(user.permissions || '').split(',').map(p => p.trim()).includes('admin-management')
        );

        if (!hasContractManagePermission) {
          return new Response(JSON.stringify({ error: 'สิทธิ์ไม่เพียงพอ ท่านไม่มีสิทธิ์ในการแก้ไขข้อมูลสัญญา' }), { status: 403, headers: corsHeaders });
        }

        try {
          const body = await request.json();
          const { start_date, end_date, reason } = body || {};

          if (!start_date || !end_date) {
            return new Response(JSON.stringify({ error: 'วันเริ่มสัญญาและวันสิ้นสุดสัญญาจำเป็นต้องระบุ' }), { status: 400, headers: corsHeaders });
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
            return new Response(JSON.stringify({ error: 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)' }), { status: 400, headers: corsHeaders });
          }
          if (start_date > end_date) {
            return new Response(JSON.stringify({ error: 'วันเริ่มสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา' }), { status: 400, headers: corsHeaders });
          }
          if (!reason || !String(reason).trim()) {
            return new Response(JSON.stringify({ error: 'กรุณาระบุเหตุผลในการแก้ไขวันที่สัญญา (Change reason is required)' }), { status: 400, headers: corsHeaders });
          }

          const contract = await env.DB.prepare('SELECT * FROM customer_contracts WHERE id = ?').bind(contractId).first();
          if (!contract) {
            return new Response(JSON.stringify({ error: 'ไม่พบสัญญาที่ระบุ' }), { status: 404, headers: corsHeaders });
          }

          if (contract.status === 'TERMINATED') {
            return new Response(JSON.stringify({
              error: 'ไม่สามารถแก้ไขวันที่ของสัญญาที่ถูกยกเลิก (TERMINATED) แล้วได้ หากต้องการเปิดสัญญาใหม่ กรุณาใช้ฟังก์ชันต่อสัญญา (Renew)'
            }), { status: 400, headers: corsHeaders });
          }

          // Overlap check with other active contracts for the same customer
          const overlapping = await env.DB.prepare(
            `SELECT id, contract_number, start_date, end_date FROM customer_contracts
             WHERE customer_id = ?
               AND id != ?
               AND status != 'TERMINATED'
               AND start_date <= ?
               AND end_date >= ?
             LIMIT 1`
          ).bind(contract.customer_id, contractId, end_date, start_date).first();

          if (overlapping) {
            return new Response(JSON.stringify({
              error: `ช่วงเวลาของสัญญานี้ซ้อนทับกับสัญญาที่มีอยู่ (${overlapping.contract_number}: ${overlapping.start_date} ถึง ${overlapping.end_date})`
            }), { status: 400, headers: corsHeaders });
          }

          // Check if affected bookings / quota usage fall outside new range
          const isWindowShrunk = start_date > contract.start_date || end_date < contract.end_date;
          if (isWindowShrunk) {
            const { results: affectedBookings } = await env.DB.prepare(
              `SELECT b.id FROM bookings b
               LEFT JOIN booking_items bi ON bi.booking_id = b.id
               WHERE (b.contract_id = ? OR (b.customer_id = ? AND b.quota_hours_used > 0))
                 AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
                 AND (
                   (bi.start_time IS NOT NULL AND (substr(bi.start_time, 1, 10) < ? OR substr(bi.start_time, 1, 10) > ?))
                   OR (bi.start_time IS NULL AND (substr(b.created_at, 1, 10) < ? OR substr(b.created_at, 1, 10) > ?))
                 )`
            ).bind(contractId, contract.customer_id, start_date, end_date, start_date, end_date).all();

            if (affectedBookings && affectedBookings.length > 0) {
              return new Response(JSON.stringify({
                error: `ไม่สามารถปรับลดช่วงเวลาสัญญาได้ เนื่องจากมีรายการจองที่ใช้สิทธิ์โควต้าสัญญาอยู่นอกช่วงเวลาใหม่ (${affectedBookings.length} รายการจอง)`
              }), { status: 400, headers: corsHeaders });
            }
          }

          const performedBy = user?.username || 'staff';
          const auditDetails = {
            contract_id: contract.id,
            customer_id: contract.customer_id,
            contract_number: contract.contract_number,
            old_start_date: contract.start_date,
            new_start_date: start_date,
            old_end_date: contract.end_date,
            new_end_date: end_date,
            change_reason: String(reason).trim(),
            updated_by: performedBy,
            updated_at: new Date().toISOString()
          };

          // Atomic execution via Cloudflare D1 batch
          await env.DB.batch([
            env.DB.prepare(
              `UPDATE customer_contracts
               SET start_date = ?,
                   end_date = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`
            ).bind(start_date, end_date, contractId),
            env.DB.prepare(
              `INSERT INTO customer_audit_logs (customer_id, contract_id, action, details, performed_by)
               VALUES (?, ?, 'EDIT_CONTRACT_DATES', ?, ?)`
            ).bind(contract.customer_id, contract.id, JSON.stringify(auditDetails), performedBy)
          ]);

          const updatedContract = await env.DB.prepare('SELECT * FROM customer_contracts WHERE id = ?').bind(contractId).first();

          return new Response(JSON.stringify({
            success: true,
            contract: updatedContract,
            audit: auditDetails,
            message: 'แก้ไขวันที่สัญญาและบันทึกประวัติเรียบร้อยแล้ว'
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

            // 8. PATCH /api/customers/:id/status
      const statusMatch = pathname.match(/^\/api\/customers\/(\d+)\/status$/);
      if (statusMatch && method === 'PATCH') {
        const customerId = parseInt(statusMatch[1], 10);
        try {
          const body = await request.json();
          const { status } = body;
          if (!['active', 'inactive'].includes(status)) {
            return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400, headers: corsHeaders });
          }

          await env.DB.prepare('UPDATE customers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, customerId).run();

          const auth = await authenticateUser(request, env);
          const performedBy = auth.user?.username || 'staff';
          await recordWorkerCustomerAudit(env, {
            customerId,
            action: 'UPDATE_STATUS',
            details: { status },
            performedBy
          });

          return new Response(JSON.stringify({ success: true, message: `เปลี่ยนสถานะเป็น ${status} เรียบร้อยแล้ว` }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 9. GET /api/customers/:id
      const customerDetailMatch = pathname.match(/^\/api\/customers\/(\d+)$/);
      if (customerDetailMatch && method === 'GET') {
        const customerId = parseInt(customerDetailMatch[1], 10);
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');
        try {
          const customer = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first();
          if (!customer) {
            return new Response(JSON.stringify({ error: 'Customer not found' }), { status: 404, headers: corsHeaders });
          }

          const { results: contracts } = await env.DB.prepare(
            'SELECT * FROM customer_contracts WHERE customer_id = ? ORDER BY start_date DESC, id DESC'
          ).bind(customerId).all();

          const evaluatedContracts = (contracts || []).map(ctr => {
            const evalRes = evaluateWorkerContractStatus(ctr);
            return {
              ...ctr,
              evaluated_status: evalRes.status,
              days_left: evalRes.days_left,
              urgency: evalRes.urgency
            };
          });

          // Security Gate: Non-admin users must NEVER receive audit logs in Customer Detail API
          const isAdmin = user && (user.role === 'admin' || user.username === 'admin');
          let auditLogs = [];
          if (isAdmin) {
            const { results } = await env.DB.prepare(
              'SELECT * FROM customer_audit_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50'
            ).bind(customerId).all();
            auditLogs = results || [];
          }

          const quota = await calculateWorkerCustomerQuota(env, {
            customerId,
            month,
            year
          });

          return new Response(JSON.stringify({
            success: true,
            customer: {
              ...customer,
              contracts: evaluatedContracts,
              audit_logs: auditLogs || [],
              quota
            }
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 9.1. GET /api/customers/:id/audit-logs (Strictly Admin Only)
      const customerAuditLogsMatch = pathname.match(/^\/api\/customers\/(\d+)\/audit-logs$/);
      if (customerAuditLogsMatch && method === 'GET') {
        const customerId = parseInt(customerAuditLogsMatch[1], 10);
        const isAdmin = user && (user.role === 'admin' || user.username === 'admin');
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: 'สิทธิ์ไม่เพียงพอ เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถดูประวัติ Audit Log ได้' }), { status: 403, headers: corsHeaders });
        }

        try {
          const { results: logs } = await env.DB.prepare(
            'SELECT * FROM customer_audit_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100'
          ).bind(customerId).all();

          return new Response(JSON.stringify({
            success: true,
            audit_logs: logs || []
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // 10. PUT /api/customers/:id
      if (customerDetailMatch && method === 'PUT') {
        const customerId = parseInt(customerDetailMatch[1], 10);
        try {
          const body = await request.json();
          const { name, contact_name, phone, email, tax_id, address, basecamp_sub_type, basecamp_unit } = body;
          if (!name || !name.trim()) {
            return new Response(JSON.stringify({ error: 'ชื่อลูกค้าหรือร้านค้าจำเป็นต้องระบุ' }), { status: 400, headers: corsHeaders });
          }

          const existing = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first();
          if (!existing) {
            return new Response(JSON.stringify({ error: 'Customer not found' }), { status: 404, headers: corsHeaders });
          }

          await env.DB.prepare(
            `UPDATE customers
             SET name = ?, contact_name = ?, phone = ?, email = ?, tax_id = ?, address = ?,
                 basecamp_sub_type = ?, basecamp_unit = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).bind(
            name.trim(),
            contact_name !== undefined ? contact_name : existing.contact_name,
            phone !== undefined ? phone : existing.phone,
            email !== undefined ? email : existing.email,
            tax_id !== undefined ? tax_id : existing.tax_id,
            address !== undefined ? address : existing.address,
            existing.customer_type === 'basecamp' ? (basecamp_sub_type || existing.basecamp_sub_type) : null,
            existing.customer_type === 'basecamp' ? (basecamp_unit || existing.basecamp_unit) : null,
            customerId
          ).run();

          const auth = await authenticateUser(request, env);
          const performedBy = auth.user?.username || 'staff';
          await recordWorkerCustomerAudit(env, {
            customerId,
            action: 'UPDATE_CUSTOMER',
            details: {
              previous: { name: existing.name, contact_name: existing.contact_name, phone: existing.phone },
              updated: { name, contact_name, phone }
            },
            performedBy
          });

          return new Response(JSON.stringify({ success: true, message: 'บันทึกการแก้ไขข้อมูลลูกค้าเรียบร้อยแล้ว' }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      if (pathname === '/api/bookings' && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const status = url.searchParams.get('payment_status') || url.searchParams.get('status');
        const startDate = url.searchParams.get('start_date');
        const endDate = url.searchParams.get('end_date');
        const search = url.searchParams.get('search');

        let query = `SELECT DISTINCT b.* FROM bookings b LEFT JOIN booking_items bi ON b.id = bi.booking_id LEFT JOIN rooms r ON bi.room_id = r.id WHERE 1=1`;
        const params = [];

        if (startDate) {
          query += ` AND (datetime(b.created_at) >= datetime(?) OR bi.start_time >= ? OR b.booking_date >= ?)`;
          params.push(startDate + ' 00:00:00', startDate, startDate);
        }
        if (endDate) {
          query += ` AND (datetime(b.created_at) <= datetime(?) OR bi.start_time <= ? OR b.booking_date <= ?)`;
          params.push(endDate + ' 23:59:59', endDate + ' 23:59:59', endDate);
        }
        if (search) {
          const q = `%${search}%`;
          query += ` AND (b.customer_name LIKE ? OR b.contact LIKE ? OR b.department LIKE ? OR b.receipt_number LIKE ? OR CAST(b.id AS TEXT) LIKE ? OR b.pin_code LIKE ? OR r.name LIKE ? OR r.category LIKE ?)`;
          params.push(q, q, q, q, q, q, q, q);
        }
        if (status) {
          if (status === 'pending' || status === 'unpaid') {
            query += ` AND (b.payment_status IN ('pending', 'reviewing', 'unpaid') OR b.payment_status IS NULL)`;
          } else if (status !== 'all') {
            query += ` AND b.payment_status = ?`;
            params.push(status);
          }
        }
        query += ` ORDER BY b.created_at DESC LIMIT 150`;

        const { results: bookings } = await env.DB.prepare(query).bind(...params).all();

        if (bookings && bookings.length > 0) {
          const bookingIds = bookings.map(b => b.id);
          const placeholders = bookingIds.map(() => '?').join(',');
          const { results: items } = await env.DB.prepare(
            `SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.category as service_category
             FROM booking_items bi
             LEFT JOIN rooms r ON bi.room_id = r.id
             LEFT JOIN services s ON bi.service_id = s.id
             WHERE bi.booking_id IN (${placeholders})
             ORDER BY bi.id ASC`
          ).bind(...bookingIds).all();

          const itemsMap = {};
          (items || []).forEach(it => {
            if (!itemsMap[it.booking_id]) itemsMap[it.booking_id] = [];
            itemsMap[it.booking_id].push(it);
          });

          try {
            const { results: slipRows } = await env.DB.prepare(
              `SELECT booking_id, slip_image_url, trans_ref, verification_status, amount, bank_name, rejection_reason, created_at as rejection_time
               FROM slip_verifications
               WHERE booking_id IN (${placeholders})
               ORDER BY id DESC`
            ).bind(...bookingIds).all();

            const slipByBookingId = {};
            (slipRows || []).forEach(s => {
              if (!slipByBookingId[s.booking_id]) slipByBookingId[s.booking_id] = s;
            });

            bookings.forEach(b => {
              const s = slipByBookingId[b.id];
              if (s) {
                if (!b.slip_image_url) b.slip_image_url = s.slip_image_url;
                if (!b.slip_trans_ref) b.slip_trans_ref = s.trans_ref;
                if (!b.slip_verify_status) b.slip_verify_status = s.verification_status;
                b.rejection_reason = s.rejection_reason || null;
                b.rejection_time = s.rejection_time || null;
              }
            });
          } catch (_) {}

          bookings.forEach(b => {
            b.items = itemsMap[b.id] || [];
            if (b.items.length > 0) {
              const first = b.items[0];
              b.room_name = first.room_name;
              b.room_capacity = first.room_capacity;
              b.booking_type = first.booking_type;
              b.layout = first.layout;
              b.start_time = first.start_time;
              b.end_time = first.end_time;
            }
          });
        }

        return new Response(JSON.stringify(bookings || []), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings' && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const body = await request.json();
        const {
          customer_name, department, contact, payment_status, payment_method, items, line_user_id, booking_source,
          customer_type = 'walkin',
          basecamp_sub_type = null,
          basecamp_unit = null,
          internal_department = null,
          billing_option = 'paid',
          booking_details = null,
          slip_image = null,
          tax_invoice_required = 0,
          tax_payer_type = 'corporate',
          tax_name = null,
          tax_id = null,
          tax_branch_type = 'head',
          tax_branch_number = null,
          tax_address = null,
          tax_email = null,
          tax_phone = null,
          tax_delivery_method = 'email',
          tax_postal_address = null
        } = body;

        if (!customer_name || !items || !items.length) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกข้อมูลผู้จองและเลือกรายการอย่างน้อย 1 รายการ' }), { status: 400, headers: corsHeaders });
        }

        const normalizedDetails = normalizeBookingDetails(booking_details);
        if (normalizedDetails.error) {
          return new Response(JSON.stringify({ error: normalizedDetails.error }), { status: 400, headers: corsHeaders });
        }

        // 1. Verify Overlap for all room items
        for (const item of items) {
          if (item.room_id && item.start_time && item.end_time) {
            const overlapResult = await checkRoomOverlap(env, item.room_id, item.start_time, item.end_time);
            if (overlapResult.hasOverlap) {
              const rObj = await env.DB.prepare('SELECT name FROM rooms WHERE id = ?').bind(item.room_id).first();
              const rName = rObj ? rObj.name : `ID: ${item.room_id}`;
              return new Response(JSON.stringify({ error: formatOverlapErrorMessage(rName, overlapResult) }), { status: 409, headers: corsHeaders });
            }
          }
        }

        // 2. Server-side price calculation
        let serverTotal = 0;
        let totalBookingHours = 0;
        for (const item of items) {
          if (item.room_id) {
            const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first();
            if (room) {
              let itemPrice = room.hourly_rate;
              const bType = item.booking_type || 'hourly';
              const bLayout = item.layout || 'standard';
              if (bType === 'daily') {
                itemPrice = bLayout === 'classroom' ? (room.classroom_daily_rate || room.daily_rate) : room.daily_rate;
              } else if (bType === 'halfday') {
                itemPrice = room.half_day_rate;
              } else {
                itemPrice = bLayout === 'classroom' ? (room.classroom_hourly_rate || room.hourly_rate) : room.hourly_rate;
              }
              const qty = item.quantity || 1;
              item.price = itemPrice;
              item.subtotal = Math.round(itemPrice * qty * 100) / 100;
              serverTotal += item.subtotal;
            }
            if (item.start_time && item.end_time) {
              const s = new Date(item.start_time);
              const e = new Date(item.end_time);
              const diffHours = Math.max(0, (e.getTime() - s.getTime()) / (1000 * 60 * 60));
              totalBookingHours += diffHours;
            } else if (item.quantity) {
              totalBookingHours += item.quantity;
            }
          } else if (item.service_id) {
            const service = await env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(item.service_id).first();
            if (service) {
              const qty = item.quantity || 1;
              item.price = service.price;
              item.subtotal = Math.round(service.price * qty * 100) / 100;
              serverTotal += item.subtotal;
            }
          }
        }

        let verifiedTotal = body.total_amount !== undefined ? body.total_amount : Math.round(serverTotal * 100) / 100;
        let quotaHoursUsed = 0;
        let effectiveBillingOption = billing_option || 'paid';
        const customerId = body.customer_id ? parseInt(body.customer_id, 10) : null;
        let contractId = body.contract_id ? parseInt(body.contract_id, 10) : null;

        if (customer_type === 'shop') {
          const firstItemDate = items[0]?.start_time || new Date().toISOString();
          let remainingQuota = 0;
          let contractEligible = true;

          if (customerId) {
            const quotaCalc = await calculateWorkerCustomerQuota(env, {
              customerId,
              customerType: 'shop',
              serviceDate: firstItemDate
            });
            remainingQuota = quotaCalc.remaining_quota;
            contractEligible = quotaCalc.contract_eligible;
            if (quotaCalc.contract && !contractId) {
              contractId = quotaCalc.contract.id;
            }
          } else {
            contractEligible = false;
          }

          if (!contractEligible) {
            quotaHoursUsed = 0;
            verifiedTotal = Math.round(serverTotal * 100) / 100;
            effectiveBillingOption = 'paid';
          } else {
            quotaHoursUsed = Math.min(totalBookingHours, remainingQuota);
            const chargeableHours = Math.max(0, totalBookingHours - quotaHoursUsed);
            verifiedTotal = totalBookingHours > 0
              ? Math.round((chargeableHours / totalBookingHours) * serverTotal * 100) / 100
              : 0;

            if (quotaHoursUsed > 0 && verifiedTotal === 0) {
              effectiveBillingOption = 'quota';
            } else if (quotaHoursUsed > 0 && verifiedTotal > 0) {
              effectiveBillingOption = 'quota_partial';
            } else {
              effectiveBillingOption = 'standard';
            }
          }
        } else if (customer_type === 'basecamp') {
          const firstItemDate = items[0]?.start_time || new Date().toISOString();
          let remainingQuota = 0;
          let contractEligible = true;

          if (customerId) {
            const quotaCalc = await calculateWorkerCustomerQuota(env, {
              customerId,
              customerType: 'basecamp',
              basecampSubType: basecamp_sub_type,
              basecampUnit: basecamp_unit,
              serviceDate: firstItemDate
            });
            remainingQuota = quotaCalc.remaining_quota;
            contractEligible = quotaCalc.contract_eligible;
            if (quotaCalc.contract && !contractId) {
              contractId = quotaCalc.contract.id;
            }
          } else {
            const maxQuota = basecamp_sub_type === 'office' ? 4 : 2;
            const targetMonthStr = normalizeToLocalISO(firstItemDate).substring(0, 7);

            try {
              const quotaRow = await env.DB.prepare(
                `SELECT COALESCE(SUM(b.quota_hours_used), 0) as used_hours
                 FROM bookings b
                 WHERE b.customer_type = 'basecamp'
                   AND b.basecamp_sub_type = ?
                   AND b.basecamp_unit = ?
                   AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
                   AND (
                     EXISTS (
                       SELECT 1 FROM booking_items bi
                       WHERE bi.booking_id = b.id
                         AND strftime('%Y-%m', bi.start_time) = ?
                     )
                     OR (
                       NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id)
                       AND strftime('%Y-%m', b.created_at) = ?
                     )
                   )`
              ).bind(basecamp_sub_type, basecamp_unit, targetMonthStr, targetMonthStr).first();

              const usedQuota = quotaRow ? Number(quotaRow.used_hours) : 0;
              remainingQuota = Math.max(0, maxQuota - usedQuota);
            } catch (qErr) {
              console.error('Error fetching quota in worker:', qErr);
            }
          }

          if (!contractEligible) {
            quotaHoursUsed = 0;
            verifiedTotal = Math.round(serverTotal * 100) / 100;
            effectiveBillingOption = 'standard';
          } else {
            quotaHoursUsed = Math.min(totalBookingHours, remainingQuota);
            const chargeableHours = Math.max(0, totalBookingHours - quotaHoursUsed);
            verifiedTotal = totalBookingHours > 0
              ? Math.round((chargeableHours / totalBookingHours) * serverTotal * 100) / 100
              : 0;

            if (quotaHoursUsed > 0 && verifiedTotal === 0) {
              effectiveBillingOption = 'quota';
            } else if (quotaHoursUsed > 0 && verifiedTotal > 0) {
              effectiveBillingOption = 'quota_partial';
            } else {
              effectiveBillingOption = 'standard';
            }
          }
        } else if (customer_type === 'builtland') {
          verifiedTotal = 0;
          quotaHoursUsed = 0;
          effectiveBillingOption = 'internal_free';
        }

        // Financial Calculation Engine
        const effectivePaymentMode = body.payment_mode
          ? body.payment_mode
          : (payment_status === 'pending' ? 'unpaid' : 'full');

        const fin = calculateBookingFinancials({
          subtotal: verifiedTotal,
          discount_type: body.discount_type || 'none',
          discount_value: body.discount_value || 0,
          payment_mode: effectivePaymentMode,
          deposit_amount: body.deposit_amount || 0,
          customer_type: customer_type || 'walkin',
          billing_option: effectiveBillingOption
        });

        const receiptNumber = await generateReceiptNumber(env);
        const roomItem = items.find(it => !!it.room_id);
        let pinCode = null;

        if (roomItem) {
          const roomDb = await env.DB.prepare('SELECT id, name, pin_code, builtland_pin_code FROM rooms WHERE id = ?').bind(roomItem.room_id).first();
          if (!roomUsesDoorPin(roomDb || roomItem.room_id)) {
            pinCode = null;
          } else if (customer_type === 'builtland') {
            if (roomDb && roomDb.builtland_pin_code && roomDb.builtland_pin_code.trim()) {
              pinCode = roomDb.builtland_pin_code.trim();
            } else if (roomDb && roomDb.pin_code && roomDb.pin_code.trim()) {
              pinCode = roomDb.pin_code.trim();
            } else {
              pinCode = await generateUniquePinCode(env);
            }
          } else {
            // General / Walk-in / Basecamp / Shop: Customer Access Code only
            if (roomDb && roomDb.pin_code && roomDb.pin_code.trim()) {
              pinCode = roomDb.pin_code.trim();
            } else {
              pinCode = await generateUniquePinCode(env);
            }
          }
        }

        // Extract optional guest count for Walk-in
        const effectiveGuestCount = (body.guest_count !== undefined && body.guest_count !== null && body.guest_count !== '')
          ? parseInt(body.guest_count, 10)
          : (items.find(it => it.guest_count)?.guest_count ? parseInt(items.find(it => it.guest_count).guest_count, 10) : null);

        const nowIso = new Date().toISOString();

        // Process optional slip_image for walk-in checkout
        let slipUrl = null;
        if (slip_image && typeof slip_image === 'string' && slip_image.startsWith('data:image/')) {
          if (slip_image.length <= 10 * 1024 * 1024 * 1.37) {
            try {
              slipUrl = await saveUploadedFile(env, slip_image, 'payment-slips', { bookingId: booking.id, paymentId: 'balance', uploadedBy: auth.user?.username || 'staff' });
            } catch (sErr) {
              console.error('[Worker Checkout] Error saving slip to R2:', sErr);
            }
          }
        }

        const isTaxReq = Number(tax_invoice_required) === 1 ? 1 : 0;
        const cleanTaxName = String(tax_name || '').trim();
        const cleanTaxId = String(tax_id || '').trim();
        const cleanBranchType = tax_branch_type === 'branch' ? 'branch' : 'head';
        const cleanBranchNo = cleanBranchType === 'branch' ? String(tax_branch_number || '').trim() : '';
        const cleanTaxAddress = String(tax_address || '').trim();
        const cleanTaxEmail = String(tax_email || '').trim();
        const cleanTaxPhone = String(tax_phone || '').trim();
        const cleanDeliveryMethod = String(tax_delivery_method || 'email').trim();
        const cleanPostalAddress = String(tax_postal_address || '').trim();

        if (isTaxReq) {
          if (!cleanTaxName) {
            return new Response(JSON.stringify({ error: 'กรุณากรอกชื่อสำหรับออกใบกำกับภาษี' }), { status: 400, headers: corsHeaders });
          }
          if (cleanTaxId && !/^\d{13}$/.test(cleanTaxId.replace(/[-\s]/g, ''))) {
            return new Response(JSON.stringify({ error: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' }), { status: 400, headers: corsHeaders });
          }
          if (cleanBranchType === 'branch' && !cleanBranchNo) {
            return new Response(JSON.stringify({ error: 'กรุณาระบุเลขที่สาขา' }), { status: 400, headers: corsHeaders });
          }
        }
        const initialTaxStatus = isTaxReq ? 'pending' : 'not_required';

        let insBooking;
        try {
          insBooking = await env.DB.prepare(
            `INSERT INTO bookings
             (customer_name, department, contact,
              subtotal_amount, discount_type, discount_value, discount_amount,
              total_amount, paid_amount, balance_amount, payment_status, payment_method,
              receipt_number, pin_code, booking_source, line_user_id, guest_count, checkin_status,
              customer_type, customer_id, contract_id, basecamp_sub_type, basecamp_unit, internal_department,
              billing_option, quota_hours_used, booking_details,
              slip_image_url, tax_invoice_required, tax_payer_type, tax_name, tax_id, tax_branch_type, tax_branch_number, tax_address, tax_email, tax_phone, tax_delivery_method, tax_postal_address, tax_invoice_status,
              created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            customer_name,
            department || internal_department || '',
            contact || '',
            fin.subtotal_amount,
            fin.discount_type,
            fin.discount_value,
            fin.discount_amount,
            fin.total_amount,
            fin.paid_amount,
            fin.balance_amount,
            fin.payment_status,
            customer_type === 'builtland' ? '' : (payment_method || 'cash'),
            receiptNumber,
            pinCode,
            booking_source || 'walkin',
            line_user_id || null,
            effectiveGuestCount,
            customer_type || 'walkin',
            customerId,
            contractId,
            basecamp_sub_type || null,
            basecamp_unit || null,
            internal_department || null,
            effectiveBillingOption,
            quotaHoursUsed,
            normalizedDetails.value,
            slipUrl,
            isTaxReq,
            tax_payer_type === 'individual' ? 'individual' : 'corporate',
            cleanTaxName,
            cleanTaxId,
            cleanBranchType,
            cleanBranchNo,
            cleanTaxAddress,
            cleanTaxEmail,
            cleanTaxPhone,
            cleanDeliveryMethod,
            cleanPostalAddress,
            initialTaxStatus,
            nowIso
          ).run();
        } catch (dbErr) {
          insBooking = await env.DB.prepare(
            `INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, booking_source, line_user_id, checkin_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
          ).bind(customer_name, department || '', contact || '', fin.total_amount, fin.payment_status, payment_method || 'cash', receiptNumber, pinCode, booking_source || 'walkin', line_user_id || null, nowIso).run();
        }

        const bookingId = insBooking.meta.last_row_id;

        // Insert initial payment transaction if funds were collected
        if (fin.transaction_needed) {
          try {
            await env.DB.prepare(
              `INSERT INTO payment_transactions
               (booking_id, amount, payment_method, slip_url, transaction_type, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'completed', ?)`
            ).bind(
              bookingId,
              fin.transaction_amount,
              customer_type === 'builtland' ? '' : (payment_method || 'cash'),
              slipUrl,
              fin.transaction_type,
              nowIso
            ).run();
          } catch (txErr) {
            console.error('Error inserting initial payment transaction in worker:', txErr);
          }
        }

        for (let item of items) {
          const normStart = (item.room_id && item.start_time) ? normalizeToLocalISO(item.start_time) : null;
          const normEnd = (item.room_id && item.end_time) ? normalizeToLocalISO(item.end_time) : null;
          const itemGuestCount = item.guest_count ? parseInt(item.guest_count, 10) : effectiveGuestCount;

          let itemPin = pinCode;
          if (item.room_id && item.room_id !== roomItem?.room_id) {
            const thisRoom = await env.DB.prepare('SELECT id, name, pin_code, builtland_pin_code FROM rooms WHERE id = ?').bind(item.room_id).first();
            if (!roomUsesDoorPin(thisRoom || item.room_id)) {
              itemPin = null;
            } else if (customer_type === 'builtland') {
              itemPin = (thisRoom?.builtland_pin_code?.trim()) || (thisRoom?.pin_code?.trim()) || (await generateUniquePinCode(env));
            } else {
              itemPin = (thisRoom?.pin_code?.trim()) || (await generateUniquePinCode(env));
            }
          }

          try {
            await env.DB.prepare(
              `INSERT INTO booking_items (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, guest_count, pin_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              bookingId,
              item.room_id || null,
              item.service_id || null,
              item.quantity || 1,
              item.price || 0,
              normStart,
              normEnd,
              item.subtotal || 0,
              item.layout || 'standard',
              item.booking_type || 'hourly',
              itemGuestCount,
              item.room_id ? itemPin : null
            ).run();
          } catch (itemErr) {
            await env.DB.prepare(
              `INSERT INTO booking_items (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, pin_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              bookingId,
              item.room_id || null,
              item.service_id || null,
              item.quantity || 1,
              item.price || 0,
              normStart,
              normEnd,
              item.subtotal || 0,
              item.layout || 'standard',
              item.booking_type || 'hourly',
              item.room_id ? itemPin : null
            ).run();
          }
        }

        const savedBooking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        const { results: savedItems } = await env.DB.prepare(`
          SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.category as service_category
          FROM booking_items bi
          LEFT JOIN rooms r ON bi.room_id = r.id
          LEFT JOIN services s ON bi.service_id = s.id
          WHERE bi.booking_id = ?
        `).bind(bookingId).all();

        return new Response(JSON.stringify({
          success: true,
          bookingId,
          booking_id: bookingId,
          id: bookingId,
          receiptNumber,
          receipt_number: receiptNumber,
          booking_code: receiptNumber,
          bookingCode: receiptNumber,
          pinCode,
          pin_code: pinCode,
          ...(savedBooking || {}),
          items: savedItems || [],
          message: 'บันทึกการจองสำเร็จ'
        }), { status: 201, headers: corsHeaders });
      }

      // Send Door Access PIN (Staff in POS or Reception triggers this manually)
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/send-pin') && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        if (booking.payment_status === 'cancelled' || booking.payment_status === 'rejected') {
          return new Response(JSON.stringify({
            error: 'ไม่สามารถส่ง PIN ได้ เนื่องจากรายการจองนี้ถูกยกเลิกหรือปฏิเสธแล้ว'
          }), { status: 400, headers: corsHeaders });
        }

        const bItem = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? AND room_id IS NOT NULL ORDER BY id ASC LIMIT 1').bind(bookingId).first();
        const room = bItem?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(bItem.room_id).first() : null;
        if (!roomUsesDoorPin(room || bItem?.room_id)) {
          return new Response(JSON.stringify({ error: 'ห้องนี้ไม่ใช้รหัสผ่านประตู' }), { status: 400, headers: corsHeaders });
        }

        let pinCode = booking.pin_code;
        if (!pinCode) {
          pinCode = await generateUniquePinCode(env);
          await env.DB.prepare('UPDATE bookings SET pin_code = ? WHERE id = ?').bind(pinCode, bookingId).run();
          if (bItem) {
            await env.DB.prepare('UPDATE booking_items SET pin_code = ? WHERE id = ?').bind(pinCode, bItem.id).run();
          }
          booking.pin_code = pinCode;
        }

        if (booking.line_user_id) {
          const res = await sendLineDoorPin(env, bookingId);
          if (res && res.success) {
            return new Response(JSON.stringify({
              success: true,
              line_sent: true,
              pin_code: pinCode,
              message: 'ส่งรหัสผ่านเข้าห้องไปยัง LINE OA ของลูกค้าเรียบร้อยแล้ว'
            }), { headers: corsHeaders });
          } else {
            return new Response(JSON.stringify({
              success: false,
              line_sent: false,
              pin_code: pinCode,
              error: 'เกิดข้อผิดพลาดในการเชื่อมต่อ LINE API'
            }), { status: 500, headers: corsHeaders });
          }
        } else {
          return new Response(JSON.stringify({
            success: true,
            line_sent: false,
            pin_code: pinCode,
            message: 'ลูกค้ารายนี้ไม่ได้เชื่อมต่อ LINE OA (จองผ่านหน้าเว็บทั่วไป)'
          }), { headers: corsHeaders });
        }
      }

      // Reason code mapping for slip rejection
      const REJECT_REASON_MAP = {
        AMOUNT_MISMATCH: 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ',
        WRONG_RECEIVER: 'บัญชีผู้รับเงินไม่ถูกต้อง',
        UNREADABLE_SLIP: 'รูปภาพสลิปไม่ชัดเจนหรือข้อมูลไม่ครบถ้วน',
        DUPLICATE_SLIP: 'สลิปซ้ำหรือเคยใช้งานแล้วในระบบ',
        INVALID_DATETIME: 'วันที่หรือเวลาในการโอนไม่ถูกต้อง',
        NOT_BANK_SLIP: 'ไม่ใช่สลิปการโอนเงินของธนาคาร',
        OTHER: 'อื่นๆ'
      };

      // Dedicated Reject Slip endpoint (Staff rejects slip, preserves booking & room block)
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/reject-slip') && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const body = await request.json().catch(() => ({}));
        const { reason_code, custom_note } = body;

        // Reason code validation
        if (!reason_code || !REJECT_REASON_MAP[reason_code]) {
          return new Response(JSON.stringify({ error: 'กรุณาระบุรหัสเหตุผลการปฏิเสธสลิปที่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        let displayReason = REJECT_REASON_MAP[reason_code];
        const sanitizedNote = custom_note
          ? String(custom_note).trim().replace(/[<>'"&]/g, '').replace(/[\x00-\x1F\x7F]/g, '').substring(0, 150)
          : '';

        if (reason_code === 'OTHER') {
          if (!sanitizedNote) {
            return new Response(JSON.stringify({ error: 'กรณีเลือกอื่นๆ กรุณาระบุรายละเอียดเหตุผลเพิ่มเติม (ไม่เกิน 150 ตัวอักษร)' }), { status: 400, headers: corsHeaders });
          }
          displayReason = sanitizedNote;
        } else if (sanitizedNote) {
          displayReason = `${displayReason} (${sanitizedNote})`;
        }

        // Fetch booking to verify current state
        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        // Precondition: current payment_status must be 'reviewing' only
        if (booking.payment_status !== 'reviewing') {
          return new Response(JSON.stringify({
            error: `ไม่สามารถปฏิเสธสลิปได้เนื่องจากรายการจองอยู่ในสถานะ '${booking.payment_status}' (อนุญาตเฉพาะสถานะรอตรวจสอบ 'reviewing' เท่านั้น)`
          }), { status: 409, headers: corsHeaders });
        }

        // Atomic conditional update
        const updateResult = await env.DB.prepare(`
          UPDATE bookings
          SET payment_status = 'rejected',
              slip_verify_status = 'rejected'
          WHERE id = ? AND payment_status = 'reviewing'
        `).bind(bookingId).run();

        if (updateResult.meta?.changes !== 1) {
          return new Response(JSON.stringify({
            error: 'สถานะรายการจองถูกเปลี่ยนแปลงไปแล้ว ไม่สามารถดำเนินการได้'
          }), { status: 409, headers: corsHeaders });
        }

        const staffName = auth.user?.username || auth.user?.name || auth.user?.role || 'staff';
        const nowIso = new Date().toISOString();

        // Audit: Update latest slip_verifications row for this booking
        try {
          const latestSv = await env.DB.prepare(
            'SELECT id FROM slip_verifications WHERE booking_id = ? ORDER BY id DESC LIMIT 1'
          ).bind(bookingId).first();

          if (latestSv) {
            await env.DB.prepare(`
              UPDATE slip_verifications
              SET verification_status = 'rejected',
                  rejection_reason = ?
              WHERE id = ?
            `).bind(displayReason, latestSv.id).run();
          } else {
            await env.DB.prepare(`
              INSERT INTO slip_verifications (
                booking_id, trans_ref, bank_code, bank_name, slip_image_url,
                is_auto_approved, confidence_score, raw_qr_data, verification_status,
                rejection_reason, created_at
              ) VALUES (?, ?, '000', 'ธนาคาร', ?, 0, 0, '', 'rejected', ?, ?)
            `).bind(bookingId, booking.slip_trans_ref || `REJ_${bookingId}_${Date.now()}`, booking.slip_image_url || 'uploaded', displayReason, nowIso).run();
          }
        } catch (svErr) {
          console.error('Audit update error on slip rejection:', svErr);
        }

        // Audit log in booking_history
        try {
          await env.DB.prepare(
            `INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
             VALUES (?, 'reject_slip', ?, ?, ?)`
          ).bind(bookingId, displayReason, staffName, nowIso).run();
        } catch (hErr) {
          console.warn('Booking history audit log error in worker:', hErr.message);
        }

        // Calculate original payment deadline for eligibility check and LINE notification
        let windowMins = 15;
        try {
          const pwRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'payment_window_minutes'").first();
          if (pwRow && pwRow.value) {
            const parsed = parseInt(pwRow.value, 10);
            if (!isNaN(parsed) && parsed >= 1) windowMins = parsed;
          }
        } catch (_) {}

        const createdAtMs = Date.parse(booking.created_at);
        const deadlineMs = Number.isFinite(createdAtMs) ? createdAtMs + windowMins * 60 * 1000 : Date.now();
        const isStillEligible = Date.now() < deadlineMs;
        const paymentDeadlineIso = new Date(deadlineMs).toISOString();

        // Push LINE Notification if eligible and not already notified
        let lineNotified = false;
        if (booking.line_user_id && env.DISABLE_LIVE_LINE !== 'true') {
          try {
            const prevNotif = await env.DB.prepare(
              "SELECT id FROM booking_history WHERE booking_id = ? AND action = 'line_reject_notified' AND details = ? LIMIT 1"
            ).bind(bookingId, displayReason).first();

            if (!prevNotif) {
              const notifRes = await sendLineSlipRejectedNotification(env, bookingId, displayReason, paymentDeadlineIso, isStillEligible);
              if (notifRes) {
                lineNotified = true;
                await env.DB.prepare(
                  `INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
                   VALUES (?, 'line_reject_notified', ?, 'system', ?)`
                ).bind(bookingId, displayReason, nowIso).run();
              }
            }
          } catch (lineErr) {
            console.warn('[Reject Slip] LINE notification delivery warning in worker:', lineErr.message);
          }
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'ปฏิเสธสลิปการโอนเงินเรียบร้อยแล้ว (การจองยังคงอยู่เพื่อให้ลูกค้าแนบสลิปใหม่)',
          payment_status: 'rejected',
          slip_verify_status: 'rejected',
          rejection_reason: displayReason,
          rejected_by: staffName,
          rejected_at: nowIso,
          paymentDeadline: paymentDeadlineIso,
          isStillEligible,
          line_notified: lineNotified
        }), { headers: corsHeaders });
      }

      // Booking details update endpoint
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/details') && (method === 'PATCH' || method === 'PUT')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        if (!bookingId || isNaN(Number(bookingId))) {
          return new Response(JSON.stringify({ error: 'รหัสการจองไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        const existingBooking = await env.DB.prepare('SELECT id, booking_details FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!existingBooking) {
          return new Response(JSON.stringify({ error: 'ไม่พบรายการจอง' }), { status: 404, headers: corsHeaders });
        }

        let body = {};
        try {
          body = await request.json();
        } catch (e) {
          return new Response(JSON.stringify({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        const normalized = normalizeBookingDetails(body.booking_details);
        if (normalized.error) {
          return new Response(JSON.stringify({ error: normalized.error }), { status: 400, headers: corsHeaders });
        }

        await env.DB.prepare('UPDATE bookings SET booking_details = ? WHERE id = ?').bind(normalized.value, bookingId).run();

        return new Response(JSON.stringify({
          success: true,
          message: 'บันทึกรายละเอียดเพิ่มเติมเรียบร้อยแล้ว',
          id: Number(bookingId),
          booking_details: normalized.value
        }), { headers: corsHeaders });
      }

      // Customer information update endpoint (Safe allowlist, concurrency-safe, financial-isolated)
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/customer-info') && (method === 'PATCH' || method === 'PUT')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        if (!bookingId || isNaN(Number(bookingId))) {
          return new Response(JSON.stringify({ error: 'รหัสการจองไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        const existingBooking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!existingBooking) {
          return new Response(JSON.stringify({ error: 'ไม่พบรายการจอง' }), { status: 404, headers: corsHeaders });
        }

        let body = {};
        try {
          body = await request.json();
        } catch (e) {
          return new Response(JSON.stringify({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        const ALLOWED_KEYS = new Set([
          'customer_name',
          'contact',
          'department',
          'booking_details',
          'send_line',
          'send_line_notification',
          'expected_values'
        ]);

        for (const key of Object.keys(body)) {
          if (!ALLOWED_KEYS.has(key)) {
            return new Response(JSON.stringify({ error: `ไม่อนุญาตให้แก้ไขข้อมูลที่ไม่ได้รับอนุญาต (${key})` }), { status: 400, headers: corsHeaders });
          }
        }

        const {
          customer_name,
          contact,
          department,
          booking_details,
          send_line,
          send_line_notification,
          expected_values
        } = body;

        if (
          customer_name === undefined &&
          contact === undefined &&
          department === undefined &&
          booking_details === undefined
        ) {
          return new Response(JSON.stringify({ error: 'ไม่มีข้อมูลที่ต้องการอัปเดต' }), { status: 400, headers: corsHeaders });
        }

        // Validate customer_name
        let finalCustomerName = existingBooking.customer_name;
        if (customer_name !== undefined) {
          if (typeof customer_name !== 'string') {
            return new Response(JSON.stringify({ error: 'ชื่อผู้จองต้องเป็นข้อความ' }), { status: 400, headers: corsHeaders });
          }
          const trimmedName = customer_name.trim();
          if (!trimmedName || trimmedName.length > 100) {
            return new Response(JSON.stringify({ error: 'กรุณาระบุชื่อผู้จอง (ความยาว 1-100 ตัวอักษร)' }), { status: 400, headers: corsHeaders });
          }
          finalCustomerName = trimmedName;
        }

        // Validate contact
        let finalContact = existingBooking.contact;
        if (contact !== undefined) {
          if (contact === null || contact === '') {
            finalContact = null;
          } else if (typeof contact === 'string') {
            const trimmedContact = contact.trim();
            if (trimmedContact.length > 50) {
              return new Response(JSON.stringify({ error: 'เบอร์ติดต่อต้องมีความยาวไม่เกิน 50 ตัวอักษร' }), { status: 400, headers: corsHeaders });
            }
            finalContact = trimmedContact || null;
          } else {
            return new Response(JSON.stringify({ error: 'รูปแบบเบอร์ติดต่อไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
          }
        }

        // Validate department
        let finalDepartment = existingBooking.department;
        if (department !== undefined) {
          if (department === null || department === '') {
            finalDepartment = null;
          } else if (typeof department === 'string') {
            const trimmedDept = department.trim();
            if (trimmedDept.length > 100) {
              return new Response(JSON.stringify({ error: 'แผนก/วัตถุประสงค์ต้องมีความยาวไม่เกิน 100 ตัวอักษร' }), { status: 400, headers: corsHeaders });
            }
            finalDepartment = trimmedDept || null;
          } else {
            return new Response(JSON.stringify({ error: 'รูปแบบแผนก/วัตถุประสงค์ไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
          }
        }

        // Validate booking_details
        let finalDetails = existingBooking.booking_details;
        if (booking_details !== undefined) {
          const norm = normalizeBookingDetails(booking_details);
          if (norm.error) {
            return new Response(JSON.stringify({ error: norm.error }), { status: 400, headers: corsHeaders });
          }
          finalDetails = norm.value;
        }

        const normalizeEmpty = val => (val === null || val === undefined ? '' : String(val).trim());

        // Concurrency / optimistic conflict check
        if (expected_values && typeof expected_values === 'object') {
          const isConflict =
            (expected_values.customer_name !== undefined && normalizeEmpty(expected_values.customer_name) !== normalizeEmpty(existingBooking.customer_name)) ||
            (expected_values.contact !== undefined && normalizeEmpty(expected_values.contact) !== normalizeEmpty(existingBooking.contact)) ||
            (expected_values.department !== undefined && normalizeEmpty(expected_values.department) !== normalizeEmpty(existingBooking.department)) ||
            (expected_values.booking_details !== undefined && normalizeEmpty(expected_values.booking_details) !== normalizeEmpty(existingBooking.booking_details));

          if (isConflict) {
            return new Response(JSON.stringify({
              error: 'ข้อมูลการจองได้รับการแก้ไขโดยผู้ใช้อื่นแล้ว กรุณารีเฟรชหน้าจอเพื่อดูข้อมูลล่าสุด',
              conflict: true
            }), { status: 409, headers: corsHeaders });
          }
        }

        // Compute diff
        const changedFields = [];
        if (normalizeEmpty(finalCustomerName) !== normalizeEmpty(existingBooking.customer_name)) changedFields.push('customer_name');
        if (normalizeEmpty(finalContact) !== normalizeEmpty(existingBooking.contact)) changedFields.push('contact');
        if (normalizeEmpty(finalDepartment) !== normalizeEmpty(existingBooking.department)) changedFields.push('department');
        if (normalizeEmpty(finalDetails) !== normalizeEmpty(existingBooking.booking_details)) changedFields.push('booking_details');

        if (changedFields.length === 0) {
          const { results: currentItems } = await env.DB.prepare(
            'SELECT bi.*, r.name as room_name FROM booking_items bi LEFT JOIN rooms r ON bi.room_id = r.id WHERE bi.booking_id = ?'
          ).bind(bookingId).all();
          existingBooking.items = currentItems || [];
          return new Response(JSON.stringify({
            success: true,
            message: 'ไม่มีข้อมูลที่เปลี่ยนแปลง',
            changed: false,
            changed_fields: [],
            line_notification: { sent: false, reason: 'no_changes' },
            booking: existingBooking
          }), { headers: corsHeaders });
        }

        // Safe atomic conditional database update - STRICTLY preserves financial, PIN, availability and status invariants
        // and guarantees optimistic concurrency control against race conditions
        const updateResult = await env.DB.prepare(
          `UPDATE bookings
           SET customer_name = ?,
               contact = ?,
               department = ?,
               booking_details = ?
           WHERE id = ?
             AND customer_name = ?
             AND COALESCE(contact, '') = ?
             AND COALESCE(department, '') = ?
             AND COALESCE(booking_details, '') = ?`
        ).bind(
          finalCustomerName, finalContact, finalDepartment, finalDetails,
          bookingId,
          existingBooking.customer_name,
          existingBooking.contact || '',
          existingBooking.department || '',
          existingBooking.booking_details || ''
        ).run();

        const changes = updateResult?.meta?.changes ?? updateResult?.changes ?? 0;
        if (changes === 0) {
          const stillExists = await env.DB.prepare('SELECT id FROM bookings WHERE id = ?').bind(bookingId).first();
          if (!stillExists) {
            return new Response(JSON.stringify({ error: 'ไม่พบรายการจอง' }), { status: 404, headers: corsHeaders });
          }
          return new Response(JSON.stringify({
            error: 'ข้อมูลการจองได้รับการแก้ไขโดยผู้ใช้อื่นแล้ว กรุณารีเฟรชหน้าจอเพื่อดูข้อมูลล่าสุด',
            conflict: true
          }), { status: 409, headers: corsHeaders });
        }

        const updatedBooking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        const { results: updatedItems } = await env.DB.prepare(
          'SELECT bi.*, r.name as room_name FROM booking_items bi LEFT JOIN rooms r ON bi.room_id = r.id WHERE bi.booking_id = ?'
        ).bind(bookingId).all();
        if (updatedBooking) {
          updatedBooking.items = updatedItems || [];
        }

        // LINE Notification policy: Edits to customer information MUST NOT send LINE OA
        const lineOutcome = { sent: false, reason: 'policy_disabled' };

        return new Response(JSON.stringify({
          success: true,
          message: 'อัปเดตข้อมูลลูกค้าเรียบร้อยแล้ว',
          changed: true,
          changed_fields: changedFields,
          line_notification: lineOutcome,
          booking: updatedBooking
        }), { headers: corsHeaders });
      }

      // Payment status update -> Staff manual approval / rejection endpoint
      if (pathname.startsWith('/api/bookings/') && (pathname.endsWith('/payment-status') || pathname.endsWith('/payment')) && (method === 'PUT' || method === 'PATCH' || method === 'POST')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const body = await request.json();
        const paymentStatus = body.payment_status || 'paid';
        const paymentMethod = body.payment_method || 'transfer';

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        const nowIso = new Date().toISOString();

        if (paymentStatus === 'paid') {
          const hasV1Snapshots = (booking.balance_amount !== null && booking.balance_amount !== undefined) ||
                                 (booking.paid_amount !== null && booking.paid_amount !== undefined);
          if (hasV1Snapshots) {
            const balance = Number(booking.balance_amount || 0);
            const paid = Number(booking.paid_amount || 0);
            const total = Number(booking.total_amount || 0);

            if (balance > 0) {
              return new Response(JSON.stringify({
                error: 'ไม่สามารถเปลี่ยนสถานะเป็นชำระแล้วโดยตรงสำหรับรายการที่มีเงินคงค้าง กรุณาใช้ระบบรับชำระเงินคงเหลือ (POST /api/bookings/:id/pay-balance)',
                code: 'PAYMENT_BALANCE_REMAINING',
                balance_amount: balance
              }), { status: 409, headers: corsHeaders });
            }

            if (Math.round((paid - total) * 100) / 100 !== 0) {
              return new Response(JSON.stringify({
                error: 'ไม่สามารถเปลี่ยนสถานะเป็นชำระแล้วโดยตรงสำหรับรายการที่ยอดชำระไม่ตรงกับยอดสุทธิ กรุณาใช้ระบบรับชำระเงินคงเหลือ (POST /api/bookings/:id/pay-balance)',
                code: 'PAYMENT_STATE_INCONSISTENT',
                paid_amount: paid,
                total_amount: total
              }), { status: 409, headers: corsHeaders });
            }
          }

          let receiptNumber = booking.receipt_number;
          if (!receiptNumber) {
            receiptNumber = await generateReceiptNumber(env);
          }
          const bItem = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? AND room_id IS NOT NULL ORDER BY id ASC LIMIT 1').bind(bookingId).first();
          let pinCode = booking.pin_code;
          if (!roomUsesDoorPin(bItem?.room_id)) {
            pinCode = null;
          } else if (!pinCode) {
            pinCode = await generateUniquePinCode(env);
          }

          await env.DB.prepare(`
            UPDATE bookings
            SET payment_status = 'paid',
                payment_method = ?,
                receipt_number = ?,
                pin_code = ?,
                slip_verify_status = 'manual_approved',
                slip_verified_at = ?,
                paid_amount = total_amount,
                balance_amount = 0
            WHERE id = ?
          `).bind(paymentMethod, receiptNumber, pinCode, nowIso, bookingId).run();

          if (pinCode) {
            await env.DB.prepare(`
              UPDATE booking_items
              SET pin_code = ?
              WHERE booking_id = ?
                AND room_id IS NOT NULL
                AND id = (
                  SELECT MIN(bi2.id) FROM booking_items bi2
                  WHERE bi2.booking_id = ? AND bi2.room_id IS NOT NULL
                )
            `).bind(pinCode, bookingId, bookingId).run();
          }

          // Record payment transaction for balance if needed
          const remainingToPay = roundMoney(booking.total_amount - (booking.paid_amount || 0));
          if (remainingToPay > 0) {
            const txType = (booking.paid_amount > 0) ? 'balance' : 'full';
            try {
              await env.DB.prepare(
                `INSERT INTO payment_transactions
                 (booking_id, amount, payment_method, transaction_type, status, created_at)
                 VALUES (?, ?, ?, ?, 'completed', ?)`
              ).bind(booking.id, remainingToPay, paymentMethod || booking.payment_method || 'cash', txType, nowIso).run();
            } catch (txErr) {}
          }

          // Update slip_verifications record
          try {
            await env.DB.prepare(`
              UPDATE slip_verifications
              SET verification_status = 'approved',
                  is_auto_approved = 0,
                  confidence_score = 100
              WHERE booking_id = ?
            `).bind(bookingId).run();
          } catch (svErr) {}

          let lineData = null;
          if (booking.line_user_id) {
            try {
              lineData = await sendLineBookingConfirmation(env, bookingId);
            } catch (lineErr) {}
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'อนุมัติการชำระเงินสำเร็จ' + (lineData?.success ? ' และส่งการแจ้งเตือนยืนยันการจองผ่าน LINE OA แล้ว' : ''),
            receiptNumber,
            pinCode,
            line_notification_sent: lineData?.success || false
          }), { headers: corsHeaders });
        } else if (paymentStatus === 'rejected') {
          // Precondition: current payment_status must be 'reviewing' only
          if (booking.payment_status !== 'reviewing') {
            return new Response(JSON.stringify({
              error: `ไม่สามารถปฏิเสธสลิปได้เนื่องจากรายการจองอยู่ในสถานะ '${booking.payment_status}' (อนุญาตเฉพาะสถานะรอตรวจสอบ 'reviewing' เท่านั้น)`
            }), { status: 409, headers: corsHeaders });
          }

          const updateResult = await env.DB.prepare(`
            UPDATE bookings
            SET payment_status = 'rejected',
                slip_verify_status = 'rejected'
            WHERE id = ? AND payment_status = 'reviewing'
          `).bind(bookingId).run();

          if (updateResult.meta?.changes !== 1) {
            return new Response(JSON.stringify({
              error: 'สถานะรายการจองถูกเปลี่ยนแปลงไปแล้ว ไม่สามารถดำเนินการได้'
            }), { status: 409, headers: corsHeaders });
          }

          const fallbackReason = body.reason || 'เจ้าหน้าที่ตรวจสอบแล้วพบว่าสลิปไม่ถูกต้อง';
          try {
            const latestSv = await env.DB.prepare(
              'SELECT id FROM slip_verifications WHERE booking_id = ? ORDER BY id DESC LIMIT 1'
            ).bind(bookingId).first();
            if (latestSv) {
              await env.DB.prepare(`
                UPDATE slip_verifications
                SET verification_status = 'rejected',
                    rejection_reason = ?
                WHERE id = ?
              `).bind(fallbackReason, latestSv.id).run();
            }
          } catch (svErr) {}

          return new Response(JSON.stringify({
            success: true,
            message: 'ปฏิเสธสลิปการโอนเงินเรียบร้อยแล้ว (การจองยังคงอยู่เพื่อให้ลูกค้าแนบสลิปใหม่)'
          }), { headers: corsHeaders });
        } else {
          await env.DB.prepare('UPDATE bookings SET payment_status = ?, payment_method = ? WHERE id = ?')
            .bind(paymentStatus, paymentMethod, bookingId).run();

          return new Response(JSON.stringify({
            success: true,
            message: 'อัปเดตสถานะการชำระเงินสำเร็จ'
          }), { headers: corsHeaders });
        }
      }

      // Read payment ledger transactions
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/payments') && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const { results: payments } = await env.DB.prepare(
          'SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY created_at ASC, id ASC'
        ).bind(bookingId).all();

        return new Response(JSON.stringify({
          success: true,
          booking_id: Number(bookingId),
          payments: payments || []
        }), { headers: corsHeaders });
      }

      // Pay balance endpoint
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/pay-balance') && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const body = await request.json().catch(() => ({}));
        const { amount, payment_method, slip_image } = body;

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        if (booking.payment_status === 'cancelled' || booking.payment_status === 'failed' || booking.payment_status === 'rejected') {
          return new Response(JSON.stringify({ error: 'ไม่สามารถรับชำระเงินสำหรับรายการที่ถูกยกเลิกหรือไม่สมบูรณ์' }), { status: 400, headers: corsHeaders });
        }

        if (booking.customer_type === 'builtland' || booking.payment_status === 'internal_free' || booking.billing_option === 'internal_free') {
          return new Response(JSON.stringify({ error: 'รายการใช้งานภายใน (Builtland) ไม่มีการเรียกเก็บเงิน' }), { status: 400, headers: corsHeaders });
        }

        if (booking.payment_status === 'paid') {
          return new Response(JSON.stringify({ error: 'รายการนี้ชำระเงินครบถ้วนแล้ว ไม่มีเงินคงค้าง' }), { status: 400, headers: corsHeaders });
        }

        const netTotal = roundMoney(Math.max(0, Number(booking.total_amount) || 0));
        const currentPaid = roundMoney(Math.max(0, Number(booking.paid_amount) || 0));
        const currentBalance = roundMoney(Math.max(0, netTotal - currentPaid));

        if (netTotal <= 0 || currentBalance <= 0) {
          return new Response(JSON.stringify({ error: 'รายการนี้ชำระเงินครบถ้วนแล้ว ไม่มีเงินคงค้าง' }), { status: 400, headers: corsHeaders });
        }

        const payAmount = roundMoney(amount);
        if (isNaN(payAmount) || payAmount <= 0) {
          return new Response(JSON.stringify({ error: 'ยอดเงินชำระต้องมากกว่า 0 บาท' }), { status: 400, headers: corsHeaders });
        }

        if (payAmount > currentBalance) {
          return new Response(JSON.stringify({
            error: `ยอดเงินที่ชำระ (฿${payAmount}) เกินกว่ายอดคงเหลือที่ต้องชำระ (฿${currentBalance})`
          }), { status: 400, headers: corsHeaders });
        }

        const newPaid = roundMoney(currentPaid + payAmount);
        const newBalance = roundMoney(Math.max(0, netTotal - newPaid));
        const newStatus = newBalance <= 0 ? 'paid' : 'deposit';
        const method = payment_method || 'cash';
        const nowIso = new Date().toISOString();

        let receiptNumber = booking.receipt_number;
        if (newStatus === 'paid' && !receiptNumber) {
          receiptNumber = await generateReceiptNumber(env);
        }

        let slipUrl = null;
        if (slip_image) {
          if (typeof slip_image !== 'string' || !slip_image.startsWith('data:image/')) {
            return new Response(JSON.stringify({ error: 'รูปแบบไฟล์รูปภาพไม่ถูกต้อง กรุณาอัปโหลดรูปภาพ PNG, JPG หรือ WEBP' }), { status: 400, headers: corsHeaders });
          }
          if (slip_image.length > 10 * 1024 * 1024 * 1.37) {
            return new Response(JSON.stringify({ error: 'ไฟล์สลิปมีขนาดใหญ่เกินไป (จำกัดไม่เกิน 10MB)' }), { status: 400, headers: corsHeaders });
          }
          if (!env.BUCKET) {
            return new Response(JSON.stringify({ error: 'ระบบจัดเก็บไฟล์ (R2) ไม่พร้อมใช้งาน ไม่สามารถบันทึกสลิปได้' }), { status: 500, headers: corsHeaders });
          }
          try {
            slipUrl = await saveUploadedFile(env, slip_image, 'payment-slips', { bookingId, paymentId: transaction ? transaction.id : 'attach', uploadedBy: staffName });
            if (!slipUrl || slipUrl.startsWith('data:')) {
              return new Response(JSON.stringify({ error: 'ไม่สามารถบันทึกไฟล์สลิปลง R2 ได้ การชำระเงินไม่ถูกบันทึก' }), { status: 500, headers: corsHeaders });
            }
          } catch (r2Err) {
            console.error('[Pay-Balance] R2 upload error in worker:', r2Err);
            return new Response(JSON.stringify({ error: 'ไม่สามารถบันทึกไฟล์สลิปลงระบบจัดเก็บได้ กรุณาลองใหม่อีกครั้ง' }), { status: 500, headers: corsHeaders });
          }
        }

        // Concurrency-safe atomic update guard
        const updateRes = await env.DB.prepare(
          `UPDATE bookings
           SET paid_amount = ?, balance_amount = ?, payment_status = ?, payment_method = ?,
               receipt_number = COALESCE(receipt_number, ?),
               slip_image_url = COALESCE(slip_image_url, ?)
           WHERE id = ?
             AND payment_status NOT IN ('cancelled', 'failed', 'rejected', 'internal_free')
             AND ROUND(MAX(0, COALESCE(total_amount, 0) - COALESCE(paid_amount, 0)), 2) >= ?`
        ).bind(newPaid, newBalance, newStatus, method, receiptNumber, slipUrl, booking.id, payAmount).run();

        if (updateRes.meta?.changes !== 1) {
          return new Response(JSON.stringify({
            error: 'ยอดคงเหลือถูกเปลี่ยนแปลงไปแล้ว กรุณารีเฟรชและลองใหม่อีกครั้ง'
          }), { status: 409, headers: corsHeaders });
        }

        await env.DB.prepare(
          `INSERT INTO payment_transactions
           (booking_id, amount, payment_method, slip_url, transaction_type, status, created_at)
           VALUES (?, ?, ?, ?, 'balance', 'completed', ?)`
        ).bind(booking.id, payAmount, method, slipUrl, nowIso).run();

        const updatedBooking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        return new Response(JSON.stringify({
          success: true,
          message: newStatus === 'paid' ? 'ชำระเงินครบถ้วนเรียบร้อยแล้ว' : 'บันทึกการชำระเงินคงเหลือสำเร็จ',
          paid_amount: newPaid,
          balance_amount: newBalance,
          payment_status: newStatus,
          payment_method: method,
          slip_url: slipUrl,
          booking: updatedBooking
        }), { headers: corsHeaders });
      }

      // Dedicated endpoint to attach slip evidence to a payment transaction (Walk-in payment evidence)
      if (pathname.startsWith('/api/bookings/') && (pathname.includes('/payments/') && pathname.endsWith('/slip') || pathname.endsWith('/attach-slip')) && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = Number(parts[3]);
        const body = await request.json().catch(() => ({}));
        let paymentId = null;
        if (pathname.includes('/payments/') && pathname.endsWith('/slip')) {
          paymentId = Number(parts[5]);
        } else if (body.payment_id) {
          paymentId = Number(body.payment_id);
        }
        const { slip_image } = body;

        if (!slip_image) {
          return new Response(JSON.stringify({ error: 'กรุณาแนบไฟล์รูปภาพสลิป' }), { status: 400, headers: corsHeaders });
        }

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        let transaction = null;
        if (paymentId) {
          transaction = await env.DB.prepare('SELECT * FROM payment_transactions WHERE id = ? AND booking_id = ?').bind(paymentId, bookingId).first();
          if (!transaction) {
            return new Response(JSON.stringify({ error: 'ไม่พบรายการธุรกรรมชำระเงินที่ระบุสำหรับการจองนี้' }), { status: 404, headers: corsHeaders });
          }
        } else {
          transaction = await env.DB.prepare('SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY id DESC LIMIT 1').bind(bookingId).first();
        }

        if (typeof slip_image !== 'string' || !slip_image.startsWith('data:image/')) {
          return new Response(JSON.stringify({ error: 'รูปแบบไฟล์รูปภาพไม่ถูกต้อง กรุณาอัปโหลดรูปภาพ PNG, JPG หรือ WEBP' }), { status: 400, headers: corsHeaders });
        }

        if (slip_image.length > 10 * 1024 * 1024 * 1.37) {
          return new Response(JSON.stringify({ error: 'ไฟล์สลิปมีขนาดใหญ่เกินไป (จำกัดไม่เกิน 10MB)' }), { status: 400, headers: corsHeaders });
        }

        if (!env.BUCKET) {
          return new Response(JSON.stringify({ error: 'ระบบจัดเก็บไฟล์ (R2) ไม่พร้อมใช้งาน ไม่สามารถบันทึกสลิปได้' }), { status: 500, headers: corsHeaders });
        }

        let slipUrl = null;
        try {
          slipUrl = await saveUploadedFile(env, slip_image, 'slips');
          if (!slipUrl || slipUrl.startsWith('data:')) {
            return new Response(JSON.stringify({ error: 'ไม่สามารถบันทึกไฟล์สลิปลง R2 ได้' }), { status: 500, headers: corsHeaders });
          }
        } catch (r2Err) {
          console.error('[Attach Slip] R2 upload error in worker:', r2Err);
          return new Response(JSON.stringify({ error: 'ไม่สามารถบันทึกไฟล์สลิปลงระบบจัดเก็บได้ กรุณาลองใหม่อีกครั้ง' }), { status: 500, headers: corsHeaders });
        }

        const previousSlip = transaction ? transaction.slip_url : booking.slip_image_url;
        const isReplacement = Boolean(previousSlip && previousSlip !== 'uploaded');
        const action = isReplacement ? 'replace_slip' : 'attach_slip';
        const replacementReason = (body.replacement_reason || body.reason || (isReplacement ? 'เปลี่ยนสลิปหลักฐาน' : 'แนบสลิปหลักฐาน')).trim();

        const staffName = auth.user?.username || auth.user?.name || auth.user?.role || 'staff';
        const nowIso = new Date().toISOString();

        const auditPayload = {
          action,
          booking_id: bookingId,
          payment_transaction_id: transaction ? transaction.id : null,
          previous_slip_reference: previousSlip || null,
          new_slip_reference: slipUrl,
          uploaded_by: staffName,
          timestamp: nowIso,
          replacement_reason: isReplacement ? replacementReason : null,
          attachment_reason: !isReplacement ? replacementReason : null,
          description: isReplacement
            ? `เปลี่ยนสลิป ${transaction ? 'ธุรกรรม #' + transaction.id : 'การจองเดิม (Legacy)'}: ${replacementReason} (เดิม: ${previousSlip} -> ใหม่: ${slipUrl})`
            : `แนบสลิป ${transaction ? 'ธุรกรรม #' + transaction.id : 'การจองเดิม (Legacy)'} (${slipUrl})`
        };
        const auditDetailsJson = JSON.stringify(auditPayload);

        try {
          const statements = [];
          if (transaction) {
            statements.push(env.DB.prepare('UPDATE payment_transactions SET slip_url = ? WHERE id = ? AND booking_id = ?').bind(slipUrl, transaction.id, bookingId));
            statements.push(env.DB.prepare('UPDATE bookings SET slip_image_url = ? WHERE id = ?').bind(slipUrl, bookingId));
          } else {
            // Legacy booking without transaction: only update bookings.slip_image_url
            statements.push(env.DB.prepare('UPDATE bookings SET slip_image_url = ? WHERE id = ?').bind(slipUrl, bookingId));
          }
          statements.push(
            env.DB.prepare(
              `INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
               VALUES (?, ?, ?, ?, ?)`
            ).bind(bookingId, action, auditDetailsJson, staffName, nowIso)
          );

          await env.DB.batch(statements);
        } catch (d1Err) {
          console.error('[Attach Slip] D1 batch audit error:', d1Err);
          return new Response(JSON.stringify({
            error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลหรือประวัติการแนบสลิป (Audit Trail Failure) การดำเนินการถูกยกเลิกเพื่อความปลอดภัย',
            details: d1Err.message
          }), { status: 500, headers: corsHeaders });
        }

        return new Response(JSON.stringify({
          success: true,
          message: isReplacement ? 'เปลี่ยนหลักฐานสลิปการชำระเงินและบันทึกประวัติเรียบร้อยแล้ว' : 'แนบหลักฐานสลิปการชำระเงินเรียบร้อยแล้ว',
          slip_url: slipUrl,
          payment_id: transaction ? transaction.id : null,
          booking_id: bookingId,
          action,
          is_replacement: isReplacement
        }), { headers: corsHeaders });
      }

      // Cancel booking endpoint (Soft cancel + LINE Notification)
      
      // ----------------------------------------------------
      // TAX INVOICE & ATTACHMENT MANAGEMENT ENDPOINTS (PARITY)
      // ----------------------------------------------------
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/tax-invoice') && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = Number(parts[3]);
        if (!bookingId || isNaN(bookingId)) {
          return new Response(JSON.stringify({ error: 'รหัสการจองไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        const booking = await env.DB.prepare(
          `SELECT id, customer_name, customer_id, receipt_number, total_amount, paid_amount, payment_status,
                  tax_invoice_required, tax_payer_type, tax_name, tax_id, tax_branch_type, tax_branch_number,
                  tax_address, tax_email, tax_phone, tax_delivery_method, tax_postal_address, tax_invoice_status
           FROM bookings WHERE id = ?`
        ).bind(bookingId).first();

        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        let invoices = [];
        try {
          const invRes = await env.DB.prepare(
            `SELECT id, booking_id, invoice_number, tax_payer_type, tax_name, tax_id,
                    tax_branch_type, tax_branch_number, tax_address, tax_email, tax_phone,
                    file_url, file_name, content_type, file_size, status, notes, uploaded_by, created_at, updated_at
             FROM tax_invoices WHERE booking_id = ? ORDER BY id DESC`
          ).bind(bookingId).all();
          invoices = invRes?.results || [];
        } catch (_) {}

        return new Response(JSON.stringify({
          success: true,
          booking_id: bookingId,
          tax_data: {
            tax_invoice_required: Number(booking.tax_invoice_required) || 0,
            tax_payer_type: booking.tax_payer_type || 'corporate',
            tax_name: booking.tax_name || '',
            tax_id: booking.tax_id || '',
            tax_branch_type: booking.tax_branch_type || 'head',
            tax_branch_number: booking.tax_branch_number || '',
            tax_address: booking.tax_address || '',
            tax_email: booking.tax_email || '',
            tax_phone: booking.tax_phone || '',
            tax_delivery_method: booking.tax_delivery_method || 'email',
            tax_postal_address: booking.tax_postal_address || '',
            tax_invoice_status: booking.tax_invoice_status || (booking.tax_invoice_required ? 'pending' : 'not_required')
          },
          invoices
        }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/tax-invoice') && method === 'PUT') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = Number(parts[3]);
        if (!bookingId || isNaN(bookingId)) {
          return new Response(JSON.stringify({ error: 'รหัสการจองไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        const body = await request.json().catch(() => ({}));
        const {
          tax_invoice_required,
          tax_payer_type,
          tax_name,
          tax_id,
          tax_branch_type,
          tax_branch_number,
          tax_address,
          tax_email,
          tax_phone,
          tax_delivery_method,
          tax_postal_address
        } = body;

        const isRequired = Number(tax_invoice_required) === 1 ? 1 : 0;
        const payerType = tax_payer_type === 'individual' ? 'individual' : 'corporate';
        const branchType = tax_branch_type === 'branch' ? 'branch' : 'head';
        const cleanTaxName = String(tax_name || '').trim();
        const cleanTaxId = String(tax_id || '').trim();
        const cleanBranchNo = branchType === 'branch' ? String(tax_branch_number || '').trim() : '';
        const cleanAddress = String(tax_address || '').trim();
        const cleanEmail = String(tax_email || '').trim();
        const cleanPhone = String(tax_phone || '').trim();
        const deliveryMethod = String(tax_delivery_method || 'email').trim();
        const cleanPostalAddress = String(tax_postal_address || '').trim();

        if (isRequired) {
          if (!cleanTaxName) {
            return new Response(JSON.stringify({ error: 'กรุณากรอกชื่อสำหรับออกใบกำกับภาษี' }), { status: 400, headers: corsHeaders });
          }
          if (cleanTaxId && !/^\d{13}$/.test(cleanTaxId.replace(/[-\s]/g, ''))) {
            return new Response(JSON.stringify({ error: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' }), { status: 400, headers: corsHeaders });
          }
          if (branchType === 'branch' && !cleanBranchNo) {
            return new Response(JSON.stringify({ error: 'กรุณาระบุเลขที่สาขา' }), { status: 400, headers: corsHeaders });
          }
        }

        let existingInvoices = [];
        try {
          const invRes = await env.DB.prepare('SELECT id FROM tax_invoices WHERE booking_id = ?').bind(bookingId).all();
          existingInvoices = invRes?.results || [];
        } catch (_) {}

        const currentStatus = !isRequired
          ? 'not_required'
          : (existingInvoices.length > 0 ? 'issued' : 'pending');

        await env.DB.prepare(
          `UPDATE bookings
           SET tax_invoice_required = ?,
               tax_payer_type = ?,
               tax_name = ?,
               tax_id = ?,
               tax_branch_type = ?,
               tax_branch_number = ?,
               tax_address = ?,
               tax_email = ?,
               tax_phone = ?,
               tax_delivery_method = ?,
               tax_postal_address = ?,
               tax_invoice_status = ?
           WHERE id = ?`
        ).bind(
          isRequired,
          payerType,
          cleanTaxName,
          cleanTaxId,
          branchType,
          cleanBranchNo,
          cleanAddress,
          cleanEmail,
          cleanPhone,
          deliveryMethod,
          cleanPostalAddress,
          currentStatus,
          bookingId
        ).run();

        const staffName = auth.user?.username || auth.user?.name || auth.user?.role || 'staff';
        const nowIso = new Date().toISOString();
        try {
          await env.DB.prepare(
            `INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
             VALUES (?, 'update_tax_invoice', ?, ?, ?)`
          ).bind(bookingId, `อัปเดตข้อมูลใบกำกับภาษี: ${isRequired ? cleanTaxName : 'ยกเลิกคำขอ'}`, staffName, nowIso).run();
        } catch (_) {}

        return new Response(JSON.stringify({
          success: true,
          message: 'บันทึกข้อมูลใบกำกับภาษีเรียบร้อยแล้ว',
          tax_data: {
            tax_invoice_required: isRequired,
            tax_payer_type: payerType,
            tax_name: cleanTaxName,
            tax_id: cleanTaxId,
            tax_branch_type: branchType,
            tax_branch_number: cleanBranchNo,
            tax_address: cleanAddress,
            tax_email: cleanEmail,
            tax_phone: cleanPhone,
            tax_delivery_method: deliveryMethod,
            tax_postal_address: cleanPostalAddress,
            tax_invoice_status: currentStatus
          }
        }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/tax-invoice/attachment') && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = Number(parts[3]);
        if (!bookingId || isNaN(bookingId)) {
          return new Response(JSON.stringify({ error: 'รหัสการจองไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        const body = await request.json().catch(() => ({}));
        const { file_data, file_name, invoice_number, notes } = body;
        if (!file_data) {
          return new Response(JSON.stringify({ error: 'กรุณาแนบไฟล์เอกสารใบกำกับภาษี' }), { status: 400, headers: corsHeaders });
        }

        if (typeof file_data !== 'string' || (!file_data.startsWith('data:application/pdf') && !file_data.startsWith('data:image/'))) {
          return new Response(JSON.stringify({ error: 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาอัปโหลดไฟล์ PDF, JPG, PNG หรือ WEBP' }), { status: 400, headers: corsHeaders });
        }

        if (file_data.length > 10 * 1024 * 1024 * 1.37) {
          return new Response(JSON.stringify({ error: 'ขนาดไฟล์เกิน 10MB กรุณาอัปโหลดไฟล์ที่มีขนาดเล็กลง' }), { status: 400, headers: corsHeaders });
        }

        if (!env.BUCKET) {
          return new Response(JSON.stringify({ error: 'ระบบจัดเก็บไฟล์ (R2) ไม่พร้อมใช้งาน' }), { status: 500, headers: corsHeaders });
        }

        let fileUrl = null;
        try {
          fileUrl = await saveUploadedFile(env, file_data, 'tax-invoices', { bookingId, uploadedBy: staffName, invoiceNumber: invoice_number });
          if (!fileUrl || fileUrl.startsWith('data:')) {
            return new Response(JSON.stringify({ error: 'ไม่สามารถบันทึกเอกสารลง R2 ได้' }), { status: 500, headers: corsHeaders });
          }
        } catch (r2Err) {
          console.error('[Tax Invoice] Error saving to R2:', r2Err);
          return new Response(JSON.stringify({ error: 'ไม่สามารถบันทึกไฟล์ลงระบบจัดเก็บได้' }), { status: 500, headers: corsHeaders });
        }

        const staffName = auth.user?.username || auth.user?.name || auth.user?.role || 'staff';
        const nowIso = new Date().toISOString();

        const insRes = await env.DB.prepare(
          `INSERT INTO tax_invoices
           (booking_id, invoice_number, tax_payer_type, tax_name, tax_id,
            tax_branch_type, tax_branch_number, tax_address, tax_email, tax_phone,
            file_url, file_name, content_type, file_size, status, notes, uploaded_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?)`
        ).bind(
          bookingId,
          invoice_number || null,
          booking.tax_payer_type || 'corporate',
          booking.tax_name || booking.customer_name || 'ลูกค้า',
          booking.tax_id || '',
          booking.tax_branch_type || 'head',
          booking.tax_branch_number || '',
          booking.tax_address || '',
          booking.tax_email || '',
          booking.tax_phone || booking.contact || '',
          fileUrl,
          file_name || 'tax_invoice',
          file_data.substring(5, file_data.indexOf(';')),
          Math.round(file_data.length * 0.75),
          notes || null,
          staffName,
          nowIso,
          nowIso
        ).run();

        await env.DB.prepare("UPDATE bookings SET tax_invoice_status = 'issued', tax_invoice_required = 1 WHERE id = ?").bind(bookingId).run();

        try {
          await env.DB.prepare(
            `INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
             VALUES (?, 'attach_tax_invoice', ?, ?, ?)`
          ).bind(bookingId, `แนบไฟล์ใบกำกับภาษี #${invoice_number || insRes.meta.last_row_id}: ${fileUrl}`, staffName, nowIso).run();
        } catch (_) {}

        const newInvoice = await env.DB.prepare('SELECT * FROM tax_invoices WHERE id = ?').bind(insRes.meta.last_row_id).first();

        return new Response(JSON.stringify({
          success: true,
          message: 'แนบไฟล์ใบกำกับภาษีเรียบร้อยแล้ว',
          invoice: newInvoice
        }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/bookings/') && pathname.includes('/tax-invoice/attachment/') && method === 'DELETE') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = Number(parts[3]);
        const invoiceId = Number(parts[6]);
        if (!bookingId || !invoiceId) {
          return new Response(JSON.stringify({ error: 'พารามิเตอร์ไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }

        const invoice = await env.DB.prepare('SELECT * FROM tax_invoices WHERE id = ? AND booking_id = ?').bind(invoiceId, bookingId).first();
        if (!invoice) {
          return new Response(JSON.stringify({ error: 'ไม่พบเอกสารใบกำกับภาษีที่ระบุ' }), { status: 404, headers: corsHeaders });
        }

        if (invoice.file_url && invoice.file_url.startsWith('/uploads/') && env.BUCKET) {
          const r2Key = invoice.file_url.replace('/uploads/', '');
          try { await env.BUCKET.delete(r2Key); } catch (_) {}
        }

        await env.DB.prepare('DELETE FROM tax_invoices WHERE id = ?').bind(invoiceId).run();

        let remaining = [];
        try {
          const remRes = await env.DB.prepare('SELECT id FROM tax_invoices WHERE booking_id = ?').bind(bookingId).all();
          remaining = remRes?.results || [];
        } catch (_) {}
        const newStatus = remaining.length > 0 ? 'issued' : 'pending';
        await env.DB.prepare('UPDATE bookings SET tax_invoice_status = ? WHERE id = ?').bind(newStatus, bookingId).run();

        const staffName = auth.user?.username || auth.user?.name || auth.user?.role || 'staff';
        const nowIso = new Date().toISOString();
        try {
          await env.DB.prepare(
            `INSERT INTO booking_history (booking_id, action, details, performed_by, created_at)
             VALUES (?, 'delete_tax_invoice', ?, ?, ?)`
          ).bind(bookingId, `ลบเอกสารใบกำกับภาษี #${invoice.invoice_number || invoiceId}`, staffName, nowIso).run();
        } catch (_) {}

        return new Response(JSON.stringify({
          success: true,
          message: 'ลบเอกสารใบกำกับภาษีเรียบร้อยแล้ว',
          tax_invoice_status: newStatus
        }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/cancel') && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const body = await request.json().catch(() => ({}));
        const reason = body.reason || 'ลูกค้าแจ้งยกเลิก / เจ้าหน้าที่ทำรายการ';

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });

        await env.DB.prepare("UPDATE bookings SET payment_status = 'cancelled' WHERE id = ?").bind(bookingId).run();

        try {
          await env.DB.prepare(`
            UPDATE slip_verifications
            SET verification_status = 'rejected',
                rejection_reason = ?
            WHERE booking_id = ?
          `).bind(reason, bookingId).run();
        } catch (svErr) {}

        let lineData = null;
        if (booking.line_user_id) {
          lineData = await sendLineBookingCancellation(env, bookingId, reason);
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'ยกเลิกการจองสำเร็จ' + (lineData?.success ? ' และส่งข้อความแจ้งเตือนผ่าน LINE OA เรียบร้อย' : ''),
          line_sent: lineData?.success || false
        }), { headers: corsHeaders });
      }

      // Reschedule booking date/time endpoint (Overlap check + Update + LINE Notification)
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/reschedule') && (method === 'PUT' || method === 'POST')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const body = await request.json();
        const { date, start_time, end_time, booking_type, layout, total_amount, send_line, room_id, booking_details, booking_item_id } = body;

        if (!date || !start_time || !end_time) {
          return new Response(JSON.stringify({ error: 'กรุณาระบุ วันที่, เวลาเริ่มต้น และเวลาสิ้นสุด ให้ครบถ้วน' }), { status: 400, headers: corsHeaders });
        }

        const sHHMM = start_time.substring(0, 5);
        const eHHMM = end_time.substring(0, 5);

        if (eHHMM <= sHHMM) {
          return new Response(JSON.stringify({ error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' }), { status: 400, headers: corsHeaders });
        }

        let updateDetails = false;
        let normalizedDetailsValue = null;
        if (booking_details !== undefined) {
          const norm = normalizeBookingDetails(booking_details);
          if (norm.error) {
            return new Response(JSON.stringify({ error: norm.error }), { status: 400, headers: corsHeaders });
          }
          updateDetails = true;
          normalizedDetailsValue = norm.value;
        }

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });

        // Business hours boundary (08:00 - 18:00) applies to Online Booking channel
        const isOnlineBooking = booking.booking_channel === 'line_oa' || booking.booking_source === 'online';
        if (isOnlineBooking) {
          if (sHHMM < '08:00') {
            return new Response(JSON.stringify({ error: 'เวลาเริ่มต้นต้องไม่เร็วกว่าเวลาเปิดทำการ (08:00 น.)' }), { status: 400, headers: corsHeaders });
          }
          if (sHHMM >= '18:00') {
            return new Response(JSON.stringify({ error: 'ไม่สามารถจองเวลาเริ่มต้นตั้งแต่เวลาปิดทำการ (18:00 น.) เป็นต้นไป' }), { status: 400, headers: corsHeaders });
          }
          if (eHHMM > '18:00') {
            return new Response(JSON.stringify({ error: 'เวลาสิ้นสุดต้องไม่เกินเวลาปิดทำการ (18:00 น.)' }), { status: 400, headers: corsHeaders });
          }
        }

        const { results: allItems } = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? ORDER BY id ASC').bind(bookingId).all();
        if (!allItems || allItems.length === 0) return new Response(JSON.stringify({ error: 'ไม่พบรายการห้องในการจองนี้' }), { status: 404, headers: corsHeaders });

        const primaryItem = allItems[0];
        let currentItem = null;

        if (allItems.length > 1) {
          if (!booking_item_id) {
            return new Response(JSON.stringify({
              error: 'กรุณาระบุ booking_item_id สำหรับการจองที่มีหลายรายการ',
              code: 'ERR_BOOKING_ITEM_ID_REQUIRED'
            }), { status: 400, headers: corsHeaders });
          }
          currentItem = allItems.find(it => String(it.id) === String(booking_item_id));
          if (!currentItem) {
            return new Response(JSON.stringify({
              error: 'ไม่พบรายการที่ระบุในข้อมูลการจองนี้',
              code: 'ERR_ITEM_NOT_FOUND'
            }), { status: 400, headers: corsHeaders });
          }
        } else {
          if (booking_item_id !== undefined && booking_item_id !== null && String(allItems[0].id) !== String(booking_item_id)) {
            return new Response(JSON.stringify({
              error: 'ไม่พบรายการที่ระบุในข้อมูลการจองนี้',
              code: 'ERR_ITEM_NOT_FOUND'
            }), { status: 400, headers: corsHeaders });
          }
          currentItem = allItems[0];
        }

        const isPrimaryItem = (primaryItem && currentItem.id === primaryItem.id);

        const targetRoomId = room_id || currentItem.room_id;
        const targetRoomObj = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(targetRoomId).first();

        const cleanStart = start_time.length === 5 ? `${start_time}:00` : start_time;
        const cleanEnd = end_time.length === 5 ? `${end_time}:00` : end_time;
        const newStartISO = `${date}T${cleanStart}`;
        const newEndISO = `${date}T${cleanEnd}`;

        // Overlap check (excludes ONLY the selected booking item ID)
        const overlapResult = await checkRoomOverlap(env, targetRoomId, newStartISO, newEndISO, null, currentItem.id);
        if (overlapResult.hasOverlap) {
          const targetRoomName = targetRoomObj ? targetRoomObj.name : `ID: ${targetRoomId}`;
          return new Response(JSON.stringify({
            error: formatOverlapErrorMessage(targetRoomName, overlapResult),
            code: 'ERR_ROOM_OVERLAP'
          }), { status: 400, headers: corsHeaders });
        }

        const oldStart = currentItem.start_time;
        const oldEnd = currentItem.end_time;

        // Synchronize PIN code with the target room based on customer_type
        let newPinCode = null;
        if (!roomUsesDoorPin(targetRoomObj || targetRoomId)) {
          newPinCode = null;
        } else if (booking.customer_type === 'builtland') {
          if (targetRoomObj && targetRoomObj.builtland_pin_code && targetRoomObj.builtland_pin_code.trim()) {
            newPinCode = targetRoomObj.builtland_pin_code.trim();
          } else if (targetRoomObj && targetRoomObj.pin_code && targetRoomObj.pin_code.trim()) {
            newPinCode = targetRoomObj.pin_code.trim();
          } else {
            newPinCode = currentItem.pin_code || booking.pin_code || await generateUniquePinCode(env);
          }
        } else {
          // General / Walk-in / Basecamp: Customer Access Code only
          if (targetRoomObj && targetRoomObj.pin_code && targetRoomObj.pin_code.trim()) {
            newPinCode = targetRoomObj.pin_code.trim();
          } else {
            newPinCode = currentItem.pin_code || booking.pin_code || await generateUniquePinCode(env);
          }
        }

        const bType = booking_type || currentItem.booking_type || 'hourly';
        const bLayout = layout || currentItem.layout || 'standard';
        let itemPrice = currentItem.price;
        let itemSubtotal = currentItem.subtotal;

        if (targetRoomObj) {
          if (bType === 'daily') {
            itemPrice = bLayout === 'classroom' ? (targetRoomObj.classroom_daily_rate || targetRoomObj.daily_rate) : targetRoomObj.daily_rate;
            itemSubtotal = itemPrice;
          } else if (bType === 'halfday') {
            itemPrice = targetRoomObj.half_day_rate;
            itemSubtotal = itemPrice;
          } else {
            itemPrice = bLayout === 'classroom' ? (targetRoomObj.classroom_hourly_rate || targetRoomObj.hourly_rate) : targetRoomObj.hourly_rate;
            const sDate = new Date(newStartISO);
            const eDate = new Date(newEndISO);
            const hours = Math.max(1, Math.ceil((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60)));
            itemSubtotal = roundMoney(itemPrice * hours);
          }
        }

        // Query other items if multi-item booking
        const otherItems = allItems.filter(it => it.id !== currentItem.id);
        const otherSubtotal = otherItems.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0);
        const fullNewGross = roundMoney(otherSubtotal + itemSubtotal);

        let newFin;
        try {
          newFin = calculateRescheduleFinancials({
            oldBooking: booking,
            newSubtotal: fullNewGross
          });
        } catch (fErr) {
          return new Response(JSON.stringify({
            error: fErr.message,
            code: fErr.code || (fErr.message.includes('ต่ำกว่ายอดเงินที่ชำระไปแล้ว') ? 'ERR_RESCHEDULE_BELOW_PAID' : 'ERR_FINANCIAL_CALCULATION')
          }), { status: 400, headers: corsHeaders });
        }

        const updateItemStmt = env.DB.prepare(
          `UPDATE booking_items
           SET room_id = ?, start_time = ?, end_time = ?, subtotal = ?, price = ?, booking_type = ?, layout = ?, pin_code = ?
           WHERE id = ? AND booking_id = ? AND start_time = ? AND end_time = ? AND room_id = ?
             AND (SELECT subtotal_amount FROM bookings WHERE id = ?) = ?`
        ).bind(
          targetRoomId,
          newStartISO,
          newEndISO,
          itemSubtotal,
          itemPrice,
          bType,
          bLayout,
          newPinCode,
          currentItem.id,
          bookingId,
          currentItem.start_time,
          currentItem.end_time,
          currentItem.room_id,
          bookingId,
          booking.subtotal_amount
        );

        const updateBookingSql = isPrimaryItem
          ? `UPDATE bookings
             SET pin_code = ?,
                 subtotal_amount = CASE
                   WHEN subtotal_amount = ? AND (SELECT start_time FROM booking_items WHERE id = ?) = ?
                   THEN ?
                   ELSE json_extract('abort', '$.stale_concurrency')
                 END,
                 discount_type = ?,
                 discount_value = ?,
                 discount_amount = ?,
                 total_amount = ?,
                 paid_amount = ?,
                 balance_amount = ?,
                 payment_status = ?,
                 booking_details = COALESCE(?, booking_details)
             WHERE id = ?`
          : `UPDATE bookings
             SET subtotal_amount = CASE
                   WHEN subtotal_amount = ? AND (SELECT start_time FROM booking_items WHERE id = ?) = ?
                   THEN ?
                   ELSE json_extract('abort', '$.stale_concurrency')
                 END,
                 discount_type = ?,
                 discount_value = ?,
                 discount_amount = ?,
                 total_amount = ?,
                 paid_amount = ?,
                 balance_amount = ?,
                 payment_status = ?,
                 booking_details = COALESCE(?, booking_details)
             WHERE id = ?`;

        const updateBookingStmt = isPrimaryItem
          ? env.DB.prepare(updateBookingSql).bind(
              newPinCode,
              booking.subtotal_amount,
              currentItem.id,
              newStartISO,
              newFin.subtotal_amount,
              newFin.discount_type,
              newFin.discount_value,
              newFin.discount_amount,
              newFin.total_amount,
              newFin.paid_amount,
              newFin.balance_amount,
              newFin.payment_status,
              updateDetails ? normalizedDetailsValue : null,
              bookingId
            )
          : env.DB.prepare(updateBookingSql).bind(
              booking.subtotal_amount,
              currentItem.id,
              newStartISO,
              newFin.subtotal_amount,
              newFin.discount_type,
              newFin.discount_value,
              newFin.discount_amount,
              newFin.total_amount,
              newFin.paid_amount,
              newFin.balance_amount,
              newFin.payment_status,
              updateDetails ? normalizedDetailsValue : null,
              bookingId
            );

        let batchResults;
        try {
          batchResults = await env.DB.batch([updateItemStmt, updateBookingStmt]);
        } catch (bErr) {
          if (bErr.message && (bErr.message.includes('stale') || bErr.message.includes('malformed JSON'))) {
            return new Response(JSON.stringify({
              error: 'ข้อมูลการจองถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชและลองใหม่อีกครั้ง',
              code: 'ERR_CONCURRENT_MODIFICATION'
            }), { status: 409, headers: corsHeaders });
          }
          throw bErr;
        }

        const itemChanges = batchResults[0]?.meta?.changes ?? batchResults[0]?.changes ?? 0;
        const bookingChanges = batchResults[1]?.meta?.changes ?? batchResults[1]?.changes ?? 0;
        if (itemChanges === 0 || bookingChanges === 0) {
          return new Response(JSON.stringify({
            error: 'ข้อมูลการจองถูกแก้ไขโดยผู้ใช้อื่น กรุณารีเฟรชและลองใหม่อีกครั้ง',
            code: 'ERR_CONCURRENT_MODIFICATION'
          }), { status: 409, headers: corsHeaders });
        }

        const updatedBooking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        const { results: updatedItems } = await env.DB.prepare(`
          SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.category as service_category
          FROM booking_items bi
          LEFT JOIN rooms r ON bi.room_id = r.id
          LEFT JOIN services s ON bi.service_id = s.id
          WHERE bi.booking_id = ?
        `).bind(bookingId).all();
        if (updatedBooking) {
          updatedBooking.items = updatedItems || [];
        }

        const normOldStart = normalizeToLocalISO(oldStart).substring(0, 16);
        const normNewStart = normalizeToLocalISO(newStartISO).substring(0, 16);
        const normOldEnd = normalizeToLocalISO(oldEnd).substring(0, 16);
        const normNewEnd = normalizeToLocalISO(newEndISO).substring(0, 16);

        const scheduleChanged = (
          String(currentItem.room_id) !== String(targetRoomId) ||
          normOldStart !== normNewStart ||
          normOldEnd !== normNewEnd
        );

        let lineOutcome = { sent: false };
        let lineData = null;

        if (!scheduleChanged) {
          lineOutcome = { sent: false, reason: 'no_schedule_change' };
        } else if (!booking.line_user_id) {
          lineOutcome = { sent: false, reason: 'no_line_recipient' };
        } else if (send_line === false) {
          lineOutcome = { sent: false, reason: 'disabled_by_user' };
        } else {
          lineData = await sendLineBookingReschedule(env, bookingId, oldStart, oldEnd, newStartISO, newEndISO, total_amount, currentItem.id);
          lineOutcome = { sent: lineData?.success || false, status: lineData?.status };
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'เปลี่ยนแปลงข้อมูลการจองสำเร็จ' + (lineOutcome?.sent ? ' และส่งข้อความแจ้งเตือนผ่าน LINE OA เรียบร้อย' : ''),
          line_sent: lineOutcome?.sent || false,
          line_notification: lineOutcome,
          pin_code: updatedBooking?.pin_code || newPinCode,
          booking: updatedBooking
        }), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 3.5 CUSTOMER WI-FI CARD DATA ENDPOINT
      // ----------------------------------------------------
      if (pathname.startsWith('/api/bookings/') && (pathname.endsWith('/wifi-card') || pathname.endsWith('/confirmation-card')) && method === 'GET') {
        const secureHeaders = { ...corsHeaders, 'Cache-Control': 'private, no-store' };
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: secureHeaders });

        const isStaffAuthorized = auth.user?.role === 'admin'
          || auth.user?.username === 'admin'
          || auth.user?.permissions?.includes('pos')
          || auth.user?.permissions?.includes('pending')
          || auth.user?.permissions?.includes('manage')
          || auth.user?.permissions?.includes('admin-management');

        if (!isStaffAuthorized) {
          return new Response(JSON.stringify({ error: 'ไม่มีสิทธิ์ดำเนินการนี้' }), { status: 403, headers: secureHeaders });
        }

        const parts = pathname.split('/');
        const rawId = parts[3];
        let numericId = null;
        if (!isNaN(rawId)) {
          numericId = parseInt(rawId, 10);
        } else if (typeof rawId === 'string' && rawId.startsWith('BK-')) {
          const stripped = rawId.replace('BK-', '');
          if (!isNaN(stripped)) numericId = parseInt(stripped, 10);
        }

        const booking = await env.DB.prepare(
          'SELECT * FROM bookings WHERE id = ? OR id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)'
        ).bind(numericId, rawId, rawId, rawId).first();

        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจองนี้' }), { status: 404, headers: secureHeaders });
        }

        if (booking.payment_status === 'cancelled') {
          return new Response(JSON.stringify({ error: 'รายการจองนี้ถูกยกเลิกแล้ว ไม่สามารถดูข้อมูลบัตร Wi-Fi ได้' }), { status: 400, headers: secureHeaders });
        }

        const ssidRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'wifi_ssid'").first();
        const rawSsid = (ssidRow?.value || '').trim();
        const sharedSsid = rawSsid || '@BWORK';

        const sanitizeRoomImageUrl = (rawUrl) => {
          if (!rawUrl || typeof rawUrl !== 'string') return null;
          const trimmed = rawUrl.trim();
          if (!trimmed) return null;
          if (/^(https?:|\/\/|javascript:|vbscript:|file:)/i.test(trimmed)) return null;
          if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
          if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed)) return trimmed;
          return null;
        };

        const resolveConfirmationItemDoorPin = ({ item, booking: bkg, primaryRoomId, totalRoomItemsCount }) => {
          const usesPin = roomUsesDoorPin({
            id: item.room_id,
            room_id: item.room_id,
            name: item.room_name,
            room_name: item.room_name,
            pin_code: item.room_pin_code,
            builtland_pin_code: item.room_builtland_pin_code
          });
          if (!usesPin) return { uses_door_pin: false, door_pin: null };

          const currentBooking = bkg || booking;
          const cleanPinStr = (val) => {
            if (val === null || val === undefined) return null;
            const s = String(val).trim();
            return (s !== '' && s !== '-') ? s : null;
          };

          const isBuiltland = currentBooking.customer_type === 'builtland'
            || currentBooking.billing_option === 'internal_free'
            || currentBooking.payment_status === 'internal_free'
            || currentBooking.is_internal_free === true;

          const itemPin = cleanPinStr(item.pin_code);
          const roomPin = cleanPinStr(item.room_pin_code);
          const builtlandRoomPin = cleanPinStr(item.room_builtland_pin_code);
          const bookingPin = cleanPinStr(currentBooking.pin_code);
          const canFallbackToBookingPin = totalRoomItemsCount === 1 || Number(item.room_id) === Number(primaryRoomId);

          const resolvedPin = isBuiltland
            ? (builtlandRoomPin || roomPin || itemPin || (canFallbackToBookingPin ? bookingPin : null))
            : (itemPin || (canFallbackToBookingPin ? bookingPin : null) || roomPin);

          return { uses_door_pin: true, door_pin: resolvedPin };
        };

        let items = [];
        try {
          const { results } = await env.DB.prepare(
            `SELECT bi.*,
                    r.name as room_name,
                    r.image_url as room_image_url,
                    r.classroom_image_url as room_classroom_image_url,
                    r.image_position_x as room_image_position_x,
                    r.image_position_y as room_image_position_y,
                    r.pin_code as room_pin_code,
                    r.builtland_pin_code as room_builtland_pin_code,
                    r.wifi_username,
                    r.wifi_password_enc
             FROM booking_items bi
             LEFT JOIN rooms r ON bi.room_id = r.id
             WHERE bi.booking_id = ?
               AND bi.room_id IS NOT NULL
               AND COALESCE(bi.checkin_status, '') != 'cancelled'
             ORDER BY bi.start_time ASC, bi.id ASC`
          ).bind(booking.id).all();
          items = results || [];
        } catch (queryErr) {
          try {
            const { results } = await env.DB.prepare(
              `SELECT bi.*,
                      r.name as room_name,
                      r.image_url as room_image_url,
                      r.pin_code as room_pin_code,
                      r.builtland_pin_code as room_builtland_pin_code
               FROM booking_items bi
               LEFT JOIN rooms r ON bi.room_id = r.id
               WHERE bi.booking_id = ?
                 AND bi.room_id IS NOT NULL
                 AND COALESCE(bi.checkin_status, '') != 'cancelled'
               ORDER BY bi.start_time ASC, bi.id ASC`
            ).bind(booking.id).all();
            items = results || [];
          } catch (innerErr) {
            items = [];
          }
        }

        const primaryRoomId = items.length > 0 ? items[0].room_id : null;

        const roomMap = new Map();
        for (const item of items) {
          if (!item.room_id || roomMap.has(item.room_id)) continue;

          let plainWifiPassword = null;
          if (item.wifi_password_enc) {
            try {
              plainWifiPassword = await decryptWifiPasswordWebCrypto(item.wifi_password_enc, env.WIFI_CREDENTIAL_ENCRYPTION_KEY, item.room_id);
            } catch (decErr) {
              if (decErr.code === 'ERR_WIFI_KEY_MISSING' || decErr.code === 'ERR_WIFI_KEY_INVALID') {
                return new Response(JSON.stringify({
                  error: 'ไม่สามารถสร้างข้อมูลบัตร Wi-Fi ได้เนื่องจากกุญแจความปลอดภัยไม่พร้อมใช้งาน',
                  code: decErr.code
                }), { status: 500, headers: secureHeaders });
              }
            }
          }

          const preferredImage = item.layout === 'classroom'
            ? (sanitizeRoomImageUrl(item.room_classroom_image_url) || sanitizeRoomImageUrl(item.room_image_url))
            : (sanitizeRoomImageUrl(item.room_image_url) || sanitizeRoomImageUrl(item.room_classroom_image_url));

          const pinInfo = resolveConfirmationItemDoorPin({
            item,
            booking,
            primaryRoomId,
            totalRoomItemsCount: items.length
          });

          const posX = (typeof item.room_image_position_x === 'number' && !isNaN(item.room_image_position_x))
            ? Math.max(0, Math.min(100, Math.round(item.room_image_position_x)))
            : 50;
          const posY = (typeof item.room_image_position_y === 'number' && !isNaN(item.room_image_position_y))
            ? Math.max(0, Math.min(100, Math.round(item.room_image_position_y)))
            : 50;

          roomMap.set(item.room_id, {
            room_id: item.room_id,
            room_name: item.room_name || `ห้อง ${item.room_id}`,
            image_url: preferredImage,
            image_position_x: posX,
            image_position_y: posY,
            uses_door_pin: pinInfo.uses_door_pin,
            door_pin: pinInfo.door_pin,
            wifi_username: item.wifi_username || null,
            wifi_password: plainWifiPassword,
            is_configured: Boolean(item.wifi_username && plainWifiPassword)
          });
        }

        const extractTime = (str) => {
          if (!str) return '';
          if (str.includes('T')) return str.split('T')[1].slice(0, 5);
          if (str.includes(' ') && str.length >= 16) return str.split(' ')[1].slice(0, 5);
          return str.slice(0, 5);
        };

        const scheduleList = items.map(item => {
          const rawStart = item.start_time ? String(item.start_time).trim() : '';
          const rawEnd = item.end_time ? String(item.end_time).trim() : '';
          const bDate = item.booking_date || ((rawStart.includes('T') || rawStart.includes(' ')) ? rawStart.slice(0, 10) : '');
          const sTime = extractTime(rawStart);
          const eTime = extractTime(rawEnd);
          const slot = item.time_slot || ((sTime && eTime) ? `${sTime} - ${eTime}` : '');

          const roomEntry = roomMap.get(item.room_id) || {};
          const preferredItemImage = item.layout === 'classroom'
            ? (sanitizeRoomImageUrl(item.room_classroom_image_url) || sanitizeRoomImageUrl(item.room_image_url))
            : (sanitizeRoomImageUrl(item.room_image_url) || sanitizeRoomImageUrl(item.room_classroom_image_url));

          const pinInfo = resolveConfirmationItemDoorPin({
            item,
            booking,
            primaryRoomId,
            totalRoomItemsCount: items.length
          });

          return {
            booking_item_id: item.id,
            room_id: item.room_id,
            room_name: item.room_name || `ห้อง ${item.room_id}`,
            room_image_url: preferredItemImage || roomEntry.image_url || null,
            image_position_x: roomEntry.image_position_x !== undefined ? roomEntry.image_position_x : 50,
            image_position_y: roomEntry.image_position_y !== undefined ? roomEntry.image_position_y : 50,
            booking_date: bDate,
            start_time: sTime,
            end_time: eTime,
            time_slot: slot,
            uses_door_pin: pinInfo.uses_door_pin,
            door_pin: pinInfo.door_pin,
            wifi_ssid: sharedSsid,
            wifi_username: roomEntry.wifi_username || null,
            wifi_password: roomEntry.wifi_password || null,
            wifi_configured: Boolean(roomEntry.is_configured)
          };
        });

        const distinctRooms = Array.from(roomMap.values());
        const isMultiRoom = distinctRooms.length > 1;
        const singleRoomImage = distinctRooms.length === 1 ? (distinctRooms[0].image_url || null) : null;
        const customerPhone = (booking.contact !== null && booking.contact !== undefined && String(booking.contact).trim() !== '' && String(booking.contact).trim() !== '-')
          ? String(booking.contact).trim()
          : null;

        const cardPayload = {
          document_title: 'ใบยืนยันการจองห้องประชุม',
          document_subtitle: 'Meeting Room Booking Confirmation',
          booking_id: booking.id,
          booking_number: booking.receipt_number || `BK-${String(booking.id).padStart(6, '0')}`,
          customer_name: booking.customer_name || 'ลูกค้า',
          customer_phone: customerPhone,
          is_multi_room: isMultiRoom,
          is_multi_item: scheduleList.length > 1,
          banner_type: isMultiRoom ? 'brand' : (singleRoomImage ? 'room' : 'placeholder'),
          banner_image_url: isMultiRoom ? '/Bworktower.jpg' : singleRoomImage,
          single_room_focal_x: distinctRooms.length === 1 ? (distinctRooms[0].image_position_x ?? 50) : 50,
          single_room_focal_y: distinctRooms.length === 1 ? (distinctRooms[0].image_position_y ?? 50) : 50,
          rooms: distinctRooms,
          schedules: scheduleList,
          items: scheduleList,
          wifi: {
            ssid: sharedSsid,
            login_instructions: 'เชื่อมต่อเครือข่าย Wi-Fi และเปิดเว็บเบราว์เซอร์เพื่อเข้าสู่ระบบ MikroTik Hotspot ด้วยชื่อผู้ใช้และรหัสผ่านของห้อง'
          },
          beverage_perk: {
            heading: 'สิทธิประโยชน์สำหรับผู้ใช้บริการห้องประชุม',
            message: 'ได้รับส่วนลด 20% จากร้าน koo.koo เฉพาะเมนูเครื่องดื่มเท่านั้น',
            discount_percent: 20,
            shop_name: 'koo.koo',
            items: [
              'Free WiFi',
              'Free Co-working Space',
              'ได้รับส่วนลด 20% จากร้าน koo.koo เฉพาะเมนูเครื่องดื่มเท่านั้น',
              'ได้สิทธิจอดรถฟรี ตามการใช้งานห้องประชุม'
            ]
          },
          benefits: {
            heading: 'สิทธิประโยชน์สำหรับผู้ใช้บริการห้องประชุม',
            items: [
              'Free WiFi',
              'Free Co-working Space',
              'ได้รับส่วนลด 20% จากร้าน koo.koo เฉพาะเมนูเครื่องดื่มเท่านั้น',
              'ได้สิทธิจอดรถฟรี ตามการใช้งานห้องประชุม'
            ]
          }
        };

        return new Response(JSON.stringify(cardPayload), { headers: secureHeaders });
      }

      if (pathname.startsWith('/api/bookings/') && (method === 'GET' || method === 'PUT' || method === 'DELETE')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];

        if (method === 'GET') {
          const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
          if (!booking) return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
          const { results: items } = await env.DB.prepare(`
            SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.category as service_category
            FROM booking_items bi
            LEFT JOIN rooms r ON bi.room_id = r.id
            LEFT JOIN services s ON bi.service_id = s.id
            WHERE bi.booking_id = ?
          `).bind(bookingId).all();

          let slipVerification = null;
          try {
            slipVerification = await env.DB.prepare(
              'SELECT * FROM slip_verifications WHERE booking_id = ? ORDER BY id DESC LIMIT 1'
            ).bind(bookingId).first();
            if (slipVerification) {
              if (!booking.slip_image_url) booking.slip_image_url = slipVerification.slip_image_url;
              if (!booking.slip_trans_ref) booking.slip_trans_ref = slipVerification.trans_ref;
              if (!booking.slip_verify_status) booking.slip_verify_status = slipVerification.verification_status;
              booking.rejection_reason = slipVerification.rejection_reason || null;
              booking.rejection_time = slipVerification.created_at || null;
            }
          } catch (_) {}

          return new Response(JSON.stringify({ ...booking, slip_verification: slipVerification || null, items: items || [] }), { headers: corsHeaders });
        }

        if (method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare(
            `UPDATE bookings SET customer_name=?, department=?, contact=?, total_amount=?, payment_status=?, payment_method=? WHERE id=?`
          ).bind(
            body.customer_name, body.department || '', body.contact || '', body.total_amount || 0, body.payment_status || 'pending', body.payment_method || 'cash', bookingId
          ).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขข้อมูลการจองสำเร็จ' }), { headers: corsHeaders });
        }

        // Hard permanent delete: Delete booking items first, then booking record
        if (method === 'DELETE') {
          await env.DB.prepare("DELETE FROM booking_items WHERE booking_id = ?").bind(bookingId).run();
          await env.DB.prepare("DELETE FROM bookings WHERE id = ?").bind(bookingId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบรายการจองออกจากระบบอย่างถาวรสำเร็จ' }), { headers: corsHeaders });
        }
      }

      // ----------------------------------------------------
      // 4.5 ROOM HOUR CREDITS ENDPOINTS
      // ----------------------------------------------------
      if (pathname === '/api/hour-credits' && method === 'GET') {
        const auth = await authenticateUser(request, env);
        const authErr = checkStaffPosAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const term = String(url.searchParams.get('search') || '').trim().slice(0, 120);
        const digits = term.replace(/\D/g, '').replace(/^66(?=\d{9}$)/, '0');
        const rowsRes = await env.DB.prepare(`SELECT credit_id FROM room_hour_credits WHERE instr(lower(credit_id), lower(?)) > 0 OR (? != '' AND instr(customer_phone, ?) > 0) ORDER BY created_at DESC, credit_id LIMIT 100`).bind(term, digits, digits).all();
        const rows = rowsRes?.results || [];
        const details = await Promise.all(rows.map(r => getWorkerHourCreditDetail(env.DB, r.credit_id)));
        return new Response(JSON.stringify(details.filter(Boolean)), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/hour-credits/source/') && method === 'GET') {
        const auth = await authenticateUser(request, env);
        const authErr = checkStaffPosAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const ref = decodeURIComponent(pathname.replace('/api/hour-credits/source/', ''));
        const b = await env.DB.prepare("SELECT id, receipt_number, customer_name, contact, payment_status, total_amount FROM bookings WHERE id = ? OR receipt_number = ?").bind(ref, ref).first();
        if (!b) return new Response(JSON.stringify({ error: 'Source booking not found' }), { status: 404, headers: corsHeaders });

        const items = await env.DB.prepare(`SELECT i.id, i.room_id, r.name AS room_name, r.hourly_rate, i.booking_type, i.start_time, i.end_time, i.checkin_status,
          c.credit_id AS existing_credit_id FROM booking_items i LEFT JOIN rooms r ON r.id = i.room_id
          LEFT JOIN room_hour_credits c ON c.source_item_id = i.id WHERE i.booking_id = ?`).bind(b.id).all();
        return new Response(JSON.stringify({ ...b, items: items?.results || [] }), { headers: corsHeaders });
      }

      if (pathname === '/api/hour-credits' && method === 'POST') {
        const auth = await authenticateUser(request, env);
        const authErr = checkStaffPosAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const body = await request.json().catch(() => null);
        const actor = auth.user.id;
        let fp;
        try {
          fp = await createHourCreditFingerprint('grant', null, body, actor, ['source_booking_id', 'source_item_id', 'minutes', 'reason', 'idempotency_key']);
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: err.statusCode || 400, headers: corsHeaders });
        }

        if (!Number.isSafeInteger(body.minutes) || body.minutes <= 0) {
          return new Response(JSON.stringify({ error: 'Positive integer minutes required' }), { status: 400, headers: corsHeaders });
        }

        try {
          const old = await replayHourCreditEntry(env.DB, body.idempotency_key, fp);
          if (old) return new Response(JSON.stringify(old), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: err.statusCode || 409, headers: corsHeaders });
        }

        const source = await env.DB.prepare(`SELECT b.id, b.customer_name, b.contact, b.line_user_id, b.payment_status, b.total_amount, b.billing_option,
          i.room_id, i.booking_type, i.start_time, i.end_time, i.checkin_status FROM bookings b JOIN booking_items i ON i.booking_id = b.id WHERE b.id = ? AND i.id = ?`).bind(body.source_booking_id, body.source_item_id).first();
        if (!source) {
          return new Response(JSON.stringify({ error: 'Source booking/item not found' }), { status: 404, headers: corsHeaders });
        }
        if (!source.room_id || source.booking_type !== 'hourly' || source.payment_status !== 'paid' || source.total_amount <= 0 || source.billing_option === 'hour_credit' || source.checkin_status === 'cancelled') {
          return new Response(JSON.stringify({ error: 'Source must be a paid hourly room item' }), { status: 409, headers: corsHeaders });
        }

        let duration;
        try {
          duration = (parseHourCreditTimestamp(source.end_time).ms - parseHourCreditTimestamp(source.start_time).ms) / 60000;
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: corsHeaders });
        }

        if (body.minutes > duration) {
          return new Response(JSON.stringify({ error: 'Grant exceeds original duration' }), { status: 409, headers: corsHeaders });
        }

        const existingCredit = await env.DB.prepare('SELECT credit_id FROM room_hour_credits WHERE source_item_id = ?').bind(body.source_item_id).first();
        if (existingCredit) {
          return new Response(JSON.stringify({ error: 'Source item already has credit' }), { status: 409, headers: corsHeaders });
        }

        const created = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 19);
        const cleanPhone = String(source.contact || '').replace(/\D/g, '').replace(/^66(?=\d{9}$)/, '0');

        let id = null;
        try {
          for (let attempt = 0; attempt < 5; attempt++) {
            id = await nextWorkerHourCreditId(env.DB, created);
            try {
              await env.DB.prepare(`INSERT INTO room_hour_credits (credit_id, source_booking_id, source_item_id, customer_name, customer_phone, line_user_id, room_id, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, source.id, body.source_item_id, source.customer_name, cleanPhone, source.line_user_id || null, source.room_id, actor, created).run();
              break;
            } catch (insertError) {
              const creditIdCollision = /room_hour_credits\.credit_id/i.test(insertError.message || '');
              if (!creditIdCollision || attempt === 4) throw insertError;
            }
          }
          if (!id) throw new Error('Cannot generate Credit ID');

          const insEntry = await env.DB.prepare(`INSERT INTO room_hour_credit_entries
            (credit_id, entry_type, minutes_delta, booking_item_id, reverses_entry_id, reason, created_by, created_at, idempotency_key, request_fingerprint)
            VALUES (?, 'grant', ?, NULL, NULL, ?, ?, ?, ?, ?)`).bind(id, body.minutes, body.reason.trim(), actor, created, body.idempotency_key, fp).run();

          const entryId = insEntry.meta.last_row_id;
          return new Response(JSON.stringify({
            credit_id: id,
            entry_id: entryId,
            entry_type: 'grant',
            minutes_delta: body.minutes,
            booking_id: null,
            booking_item_id: null
          }), { headers: corsHeaders });
        } catch (err) {
          if (err.message?.includes('UNIQUE constraint failed') || err.message?.includes('already')) {
            return new Response(JSON.stringify({ error: 'Credit constraint conflict' }), { status: 409, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ error: err.message || 'Hour credit operation failed' }), { status: 409, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/hour-credits/') && pathname.endsWith('/eligible-rooms') && method === 'GET') {
        const auth = await authenticateUser(request, env);
        const authErr = checkStaffPosAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const creditId = decodeURIComponent(pathname.replace('/api/hour-credits/', '').replace('/eligible-rooms', ''));
        const source = await env.DB.prepare(`SELECT r.hourly_rate FROM room_hour_credits c JOIN rooms r ON r.id = c.room_id WHERE c.credit_id = ?`).bind(creditId).first();
        if (!source) return new Response(JSON.stringify({ error: 'Credit not found' }), { status: 404, headers: corsHeaders });
        const rooms = await env.DB.prepare(`SELECT id, name, hourly_rate, status, has_hourly FROM rooms WHERE status = 'active'
          AND COALESCE(has_hourly, 1) = 1 AND hourly_rate = ? ORDER BY name, id`).bind(source.hourly_rate).all();
        return new Response(JSON.stringify(rooms?.results || []), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/hour-credits/') && pathname.endsWith('/blocked-ranges') && method === 'GET') {
        const auth = await authenticateUser(request, env);
        const authErr = checkStaffPosAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const creditId = decodeURIComponent(pathname.replace('/api/hour-credits/', '').replace('/blocked-ranges', ''));
        const roomId = Number(url.searchParams.get('room_id'));
        const date = String(url.searchParams.get('date') || '');
        if (!Number.isSafeInteger(roomId) || roomId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return new Response(JSON.stringify({ error: 'Room and date required' }), { status: 400, headers: corsHeaders });
        }
        const eligible = await env.DB.prepare(`SELECT selected.id FROM room_hour_credits c JOIN rooms source ON source.id = c.room_id
          JOIN rooms selected ON selected.id = ? WHERE c.credit_id = ? AND selected.status = 'active'
          AND COALESCE(selected.has_hourly, 1) = 1 AND selected.hourly_rate = source.hourly_rate`).bind(roomId, creditId).first();
        if (!eligible) return new Response(JSON.stringify({ error: 'ห้องที่เลือกมีอัตราค่าบริการไม่ตรงกับเครดิตนี้' }), { status: 409, headers: corsHeaders });
        const setting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cleaning_buffer_minutes'").first();
        const configuredBuffer = Number.parseInt(setting?.value, 10);
        const rows = await env.DB.prepare(`SELECT bi.start_time, bi.end_time FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
          WHERE bi.room_id = ? AND substr(replace(bi.start_time, ' ', 'T'), 1, 10) = ?
          AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed'))
          AND (b.checkin_status IS NULL OR b.checkin_status != 'cancelled')
          AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled') ORDER BY bi.start_time`).bind(roomId, date).all();
        return new Response(JSON.stringify({ room_id: roomId, date,
          cleaning_buffer_minutes: Number.isFinite(configuredBuffer) ? Math.max(0, configuredBuffer) : 30,
          ranges: rows?.results || [] }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/hour-credits/') && pathname.endsWith('/redeem') && method === 'POST') {
        const creditId = decodeURIComponent(pathname.replace('/api/hour-credits/', '').replace('/redeem', ''));
        const auth = await authenticateUser(request, env);
        const authErr = checkStaffPosAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const body = await request.json().catch(() => null);
        const actor = auth.user.id;
        let fp;
        try {
          fp = await createHourCreditFingerprint('redeem', creditId, body, actor, ['room_id', 'minutes', 'start_time', 'end_time', 'reason', 'idempotency_key']);
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: err.statusCode || 400, headers: corsHeaders });
        }

        let start, end;
        try {
          start = parseHourCreditTimestamp(body.start_time);
          end = parseHourCreditTimestamp(body.end_time);
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: corsHeaders });
        }

        if (!Number.isSafeInteger(body.minutes) || body.minutes <= 0 || (end.ms - start.ms) !== body.minutes * 60000) {
          return new Response(JSON.stringify({ error: 'Duration must equal positive integer minutes' }), { status: 400, headers: corsHeaders });
        }

        try {
          const old = await replayHourCreditEntry(env.DB, body.idempotency_key, fp);
          if (old) return new Response(JSON.stringify(old), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: err.statusCode || 409, headers: corsHeaders });
        }

        if (start.ms <= Date.now()) {
          return new Response(JSON.stringify({ error: 'Booking must start in the future' }), { status: 409, headers: corsHeaders });
        }

        const c = await env.DB.prepare(`SELECT c.*, source.hourly_rate AS source_hourly_rate FROM room_hour_credits c
          JOIN rooms source ON source.id = c.room_id WHERE c.credit_id = ?`).bind(creditId).first();
        if (!c) {
          return new Response(JSON.stringify({ error: 'Credit not found' }), { status: 404, headers: corsHeaders });
        }

        const balance = await env.DB.prepare('SELECT COALESCE(SUM(minutes_delta), 0) AS minutes FROM room_hour_credit_entries WHERE credit_id = ?').bind(creditId).first();
        if (!balance || balance.minutes < body.minutes) {
          return new Response(JSON.stringify({ error: 'Insufficient credit' }), { status: 409, headers: corsHeaders });
        }

        const selectedRoomId = body.room_id === undefined ? c.room_id : Number(body.room_id);
        if (!Number.isSafeInteger(selectedRoomId) || selectedRoomId <= 0) {
          return new Response(JSON.stringify({ error: 'Eligible room required' }), { status: 400, headers: corsHeaders });
        }
        const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(selectedRoomId).first();
        if (!room || room.status !== 'active' || Number(room.has_hourly ?? 1) !== 1) {
          return new Response(JSON.stringify({ error: 'Room unavailable' }), { status: 409, headers: corsHeaders });
        }
        if (Number(room.hourly_rate) !== Number(c.source_hourly_rate)) {
          return new Response(JSON.stringify({ error: 'ห้องที่เลือกมีอัตราค่าบริการไม่ตรงกับเครดิตนี้' }), { status: 409, headers: corsHeaders });
        }

        const overlapResult = await checkRoomOverlap(env, selectedRoomId, start.local, end.local, null);
        if (overlapResult.hasOverlap) {
          return new Response(JSON.stringify({ error: 'ช่วงเวลานี้มีการจองแล้ว กรุณาเลือกเวลาอื่น' }), { status: 409, headers: corsHeaders });
        }

        const receiptNumber = await generateReceiptNumber(env);
        const pinCode = !roomUsesDoorPin(room || selectedRoomId) ? null : (room.pin_code?.trim() || await generateUniquePinCode(env));
        const created = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 19);

        let bookingId = null;
        let itemId = null;
        try {
          const insBooking = await env.DB.prepare(`INSERT INTO bookings (customer_name, contact, total_amount, payment_status, payment_method, billing_option, receipt_number, pin_code, booking_source, customer_type, checkin_status, created_at)
            VALUES (?, ?, 0, 'paid', 'hour_credit', 'hour_credit', ?, ?, 'walk-in', 'walkin', 'pending', ?)`).bind(
            c.customer_name, c.customer_phone, receiptNumber, pinCode, created
          ).run();
          bookingId = insBooking.meta.last_row_id;

          const insItem = await env.DB.prepare(`INSERT INTO booking_items (booking_id, room_id, quantity, price, subtotal, start_time, end_time, booking_type, layout, pin_code, checkin_status)
            VALUES (?, ?, ?, 0, 0, ?, ?, 'hourly', 'standard', ?, 'pending')`).bind(
            bookingId, selectedRoomId, body.minutes / 60, start.local, end.local, pinCode
          ).run();
          itemId = insItem.meta.last_row_id;

          const insEntry = await env.DB.prepare(`INSERT INTO room_hour_credit_entries
            (credit_id, entry_type, minutes_delta, booking_item_id, reverses_entry_id, reason, created_by, created_at, idempotency_key, request_fingerprint)
            VALUES (?, 'redeem', ?, ?, NULL, ?, ?, ?, ?, ?)`).bind(
            creditId, -body.minutes, itemId, body.reason.trim(), actor, created, body.idempotency_key, fp
          ).run();
          const entryId = insEntry.meta.last_row_id;

          return new Response(JSON.stringify({
            credit_id: creditId,
            entry_id: entryId,
            entry_type: 'redeem',
            minutes_delta: -body.minutes,
            booking_id: bookingId,
            booking_item_id: itemId
          }), { headers: corsHeaders });
        } catch (err) {
          if (bookingId) {
            await env.DB.prepare('DELETE FROM booking_items WHERE booking_id = ?').bind(bookingId).run().catch(() => {});
            await env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(bookingId).run().catch(() => {});
          }
          if (err.message?.includes('insufficient balance')) {
            return new Response(JSON.stringify({ error: 'Insufficient credit' }), { status: 409, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ error: err.message || 'Hour credit operation failed' }), { status: 409, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/hour-credits/') && pathname.endsWith('/reversals') && method === 'POST') {
        const creditId = decodeURIComponent(pathname.replace('/api/hour-credits/', '').replace('/reversals', ''));
        const auth = await authenticateUser(request, env);
        const authErr = checkStaffPosAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const body = await request.json().catch(() => null);
        const actor = auth.user.id;
        let fp;
        try {
          fp = await createHourCreditFingerprint('reverse', creditId, body, actor, ['entry_id', 'reason', 'idempotency_key']);
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: err.statusCode || 400, headers: corsHeaders });
        }

        try {
          const old = await replayHourCreditEntry(env.DB, body.idempotency_key, fp);
          if (old) return new Response(JSON.stringify(old), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: err.statusCode || 409, headers: corsHeaders });
        }

        const e = await env.DB.prepare("SELECT * FROM room_hour_credit_entries WHERE id = ? AND credit_id = ? AND entry_type = 'redeem'").bind(body.entry_id, creditId).first();
        if (!e) {
          return new Response(JSON.stringify({ error: 'Redeem entry not found' }), { status: 404, headers: corsHeaders });
        }
        const alreadyReversed = await env.DB.prepare('SELECT id FROM room_hour_credit_entries WHERE reverses_entry_id = ?').bind(e.id).first();
        if (alreadyReversed) {
          return new Response(JSON.stringify({ error: 'Redeem already reversed' }), { status: 409, headers: corsHeaders });
        }

        const item = await env.DB.prepare('SELECT * FROM booking_items WHERE id = ?').bind(e.booking_item_id).first();
        let itemStartMs;
        try {
          itemStartMs = parseHourCreditTimestamp(item?.start_time).ms;
        } catch {
          itemStartMs = 0;
        }
        if (!item || itemStartMs <= Date.now()) {
          return new Response(JSON.stringify({ error: 'Reversal allowed only before booking start' }), { status: 409, headers: corsHeaders });
        }

        const created = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 19);

        await env.DB.prepare("UPDATE bookings SET payment_status = 'cancelled', checkin_status = 'cancelled', cancellation_reason = ? WHERE id = ?").bind(body.reason.trim(), item.booking_id).run();
        await env.DB.prepare("UPDATE booking_items SET checkin_status = 'cancelled' WHERE booking_id = ?").bind(item.booking_id).run();

        try {
          const insEntry = await env.DB.prepare(`INSERT INTO room_hour_credit_entries
            (credit_id, entry_type, minutes_delta, booking_item_id, reverses_entry_id, reason, created_by, created_at, idempotency_key, request_fingerprint)
            VALUES (?, 'reversal', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
            creditId, -e.minutes_delta, item.id, e.id, body.reason.trim(), actor, created, body.idempotency_key, fp
          ).run();
          const entryId = insEntry.meta.last_row_id;

          return new Response(JSON.stringify({
            credit_id: creditId,
            entry_id: entryId,
            entry_type: 'reversal',
            minutes_delta: -e.minutes_delta,
            booking_id: item.booking_id,
            booking_item_id: item.id
          }), { headers: corsHeaders });
        } catch (err) {
          await env.DB.prepare("UPDATE bookings SET payment_status = 'paid', checkin_status = 'pending', cancellation_reason = NULL WHERE id = ?").bind(item.booking_id).run().catch(() => {});
          await env.DB.prepare("UPDATE booking_items SET checkin_status = 'pending' WHERE booking_id = ?").bind(item.booking_id).run().catch(() => {});
          return new Response(JSON.stringify({ error: err.message || 'Hour credit operation failed' }), { status: 409, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/hour-credits/') && pathname.endsWith('/send-line') && method === 'POST') {
        const creditId = decodeURIComponent(pathname.replace('/api/hour-credits/', '').replace('/send-line', ''));
        const auth = await authenticateUser(request, env);
        const authErr = checkStaffPosAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const body = await request.json().catch(() => ({}));
        if (body && (body.to || body.line_user_id)) {
          return new Response(JSON.stringify({ error: 'Client cannot specify LINE recipient' }), { status: 400, headers: corsHeaders });
        }

        const c = await env.DB.prepare(`SELECT c.credit_id, c.line_user_id, c.room_id, r.name AS room_name
          FROM room_hour_credits c JOIN rooms r ON r.id = c.room_id WHERE c.credit_id = ?`).bind(creditId).first();
        if (!c) {
          return new Response(JSON.stringify({ error: 'Credit not found' }), { status: 404, headers: corsHeaders });
        }
        if (!c.line_user_id || !c.line_user_id.trim()) {
          return new Response(JSON.stringify({ error: 'เครดิตนี้ไม่มีข้อมูล LINE ของลูกค้า' }), { status: 400, headers: corsHeaders });
        }

        const balanceRow = await env.DB.prepare('SELECT COALESCE(SUM(minutes_delta), 0) AS minutes FROM room_hour_credit_entries WHERE credit_id = ?').bind(creditId).first();
        const remaining = balanceRow ? balanceRow.minutes : 0;

        const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
        const channelAccessToken = tokenSetting?.value?.trim() || env.LINE_CHANNEL_ACCESS_TOKEN;

        const sentAt = new Date(Date.now() + 7 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
        const flexMessage = buildHourCreditVoucherFlex({
          credit_id: c.credit_id,
          room_name: c.room_name,
          remaining_minutes: remaining,
          sent_at: sentAt
        });

        const dispatch = await dispatchLineMessagePush(env, channelAccessToken, {
          to: c.line_user_id.trim(),
          messages: [flexMessage]
        });

        if (dispatch.mocked) {
          return new Response(JSON.stringify({
            success: true,
            sent: false,
            mocked: true,
            message: '[Staging Mode] จำลองการส่งใบยืนยันชั่วโมงคงเหลือเข้า LINE OA สำเร็จ (Mocked; No Live Dispatch)',
            credit_id: c.credit_id
          }), { headers: corsHeaders });
        }

        if (!dispatch.ok) {
          if (!channelAccessToken) {
            return new Response(JSON.stringify({ error: 'ไม่ได้ตั้งค่า LINE Channel Access Token ในระบบ' }), { status: 503, headers: corsHeaders });
          }
          const errText = await dispatch.response?.text().catch(() => '');
          return new Response(JSON.stringify({ error: `LINE API ตอบกลับผิดพลาด (${dispatch.status}): ${errText || 'ส่งข้อความไม่สำเร็จ'}` }), { status: 502, headers: corsHeaders });
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'ส่งใบยืนยันชั่วโมงคงเหลือเข้า LINE OA ลูกค้าสำเร็จ',
          credit_id: c.credit_id
        }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/hour-credits/') && method === 'GET') {
        const creditId = decodeURIComponent(pathname.replace('/api/hour-credits/', ''));
        const auth = await authenticateUser(request, env);
        const authErr = checkStaffPosAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const detail = await getWorkerHourCreditDetail(env.DB, creditId);
        if (!detail) {
          return new Response(JSON.stringify({ error: 'Credit not found' }), { status: 404, headers: corsHeaders });
        }
        return new Response(JSON.stringify(detail), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 5. PUBLIC BOOKINGS (CUSTOMER SIDE - NO AUTH REQUIRED)
      // ----------------------------------------------------
      if (pathname.startsWith('/api/public/bookings/') && pathname.endsWith('/upload-slip') && method === 'POST') {
        const parts = pathname.split('/');
        const idParam = parts[4];

        let slip_image = null;
        let qr_data = null;
        let bodyAccessToken = null;
        let bodyContact = null;

        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            const body = await request.json();
            slip_image = body.slip_image || body.slip || body.image;
            qr_data = body.qr_data || body.qrData || body.qr;
            bodyAccessToken = body.access_token;
            bodyContact = body.contact;
          } catch (e) {}
        } else if (contentType.includes('multipart/form-data')) {
          try {
            const formData = await request.formData();
            const file = formData.get('slip') || formData.get('slip_image') || formData.get('image');
            qr_data = formData.get('qr_data') || formData.get('qrData');
            bodyAccessToken = formData.get('access_token');
            bodyContact = formData.get('contact');
            if (file && typeof file === 'object' && typeof file.arrayBuffer === 'function') {
              const arrayBuffer = await file.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);
              const mime = file.type || 'image/jpeg';
              slip_image = `data:${mime};base64,${base64}`;
            } else if (typeof file === 'string') {
              slip_image = file;
            }
          } catch (e) {}
        }

        let bookingId = isNaN(Number(idParam)) ? null : Number(idParam);
        if (!bookingId && typeof idParam === 'string' && idParam.startsWith('BK-')) {
          const raw = idParam.replace('BK-', '');
          if (raw.length <= 6 && !isNaN(Number(raw))) {
            bookingId = parseInt(raw, 10);
          }
        }

        const booking = await env.DB.prepare(
          'SELECT * FROM bookings WHERE id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)'
        ).bind(bookingId || 0, idParam, idParam).first();

        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        // Same public access inputs and token OR normalized contact rule as Local.
        const suppliedToken = request.headers.get('x-booking-token') || url.searchParams.get('access_token') || bodyAccessToken;
        const suppliedContact = request.headers.get('x-booking-contact') || url.searchParams.get('contact') || bodyContact;
        const normalizedContact = String(suppliedContact || '').replace(/\D/g, '');
        const safeEqual = async (left, right) => {
          if (!left || !right) return false;
          const encoder = new TextEncoder();
          const [a, b] = await Promise.all([left, right].map(value =>
            crypto.subtle.digest('SHA-256', encoder.encode(String(value)))));
          const bytesA = new Uint8Array(a);
          const bytesB = new Uint8Array(b);
          let difference = 0;
          for (let i = 0; i < bytesA.length; i++) difference |= bytesA[i] ^ bytesB[i];
          return difference === 0;
        };
        const tokenMatches = await safeEqual(suppliedToken, booking.qr_token);
        const contactMatches = normalizedContact.length >= 9 &&
          await safeEqual(normalizedContact, String(booking.contact || '').replace(/\D/g, ''));
        if (!tokenMatches && !contactMatches) {
          return new Response(JSON.stringify({ success: false, auto_approved: false, error: 'กรุณายืนยันเบอร์โทรศัพท์หรือสิทธิ์เข้าถึงรายการจอง' }), { status: 403, headers: corsHeaders });
        }
        let windowMins = 15;
        try {
          const pwRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'payment_window_minutes'").first();
          if (pwRow && pwRow.value) {
            const parsed = parseInt(pwRow.value, 10);
            if (!isNaN(parsed) && parsed >= 1) windowMins = parsed;
          }
        } catch (_) {}

        const createdAtMs = Date.parse(booking.created_at);
        const isExpiredByTime = Number.isFinite(createdAtMs) && (Date.now() - createdAtMs >= windowMins * 60 * 1000);

        if (booking.payment_status === 'paid') {
          return new Response(JSON.stringify({ success: false, auto_approved: false, error: 'รายการจองนี้ชำระเงินแล้ว ไม่สามารถแนบสลิปซ้ำได้' }), { status: 409, headers: corsHeaders });
        }

        if (booking.payment_status === 'cancelled' || isExpiredByTime) {
          if (booking.payment_status !== 'cancelled') {
            const cancelReasonMsg = `ไม่ได้ทำการชำระเงินภายในเวลาที่กำหนด (${windowMins} นาที)`;
            await env.DB.prepare(
              "UPDATE bookings SET payment_status = 'cancelled', checkin_status = 'cancelled', cancellation_reason = ? WHERE id = ? AND payment_status NOT IN ('paid', 'reviewing')"
            ).bind(cancelReasonMsg, booking.id).run();
            await env.DB.prepare("UPDATE booking_items SET checkin_status = 'cancelled' WHERE booking_id = ?").bind(booking.id).run();
          }
          return new Response(JSON.stringify({ success: false, auto_approved: false, error: `รายการจองนี้หมดเวลาชำระเงินแล้ว (${windowMins} นาที) ไม่สามารถแนบสลิปได้ กรุณาทำรายการจองใหม่` }), { status: 400, headers: corsHeaders });
        }

        if (!slip_image) {
          return new Response(JSON.stringify({ error: 'ไม่พบไฟล์รูปภาพสลิปที่ส่งมา กรุณาลองใหม่อีกครั้ง' }), { status: 400, headers: corsHeaders });
        }

        const nowIso = new Date().toISOString();

        // ----------------------------------------------------
        // Client QR is an UNVERIFIED hint, not proof decoded from this image.
        // Syntax/duplicate checks do not verify payment, amount or recipient.
        // ----------------------------------------------------
        const parsedQR = typeof qr_data === 'string' ? parseThaiBankSlipQR(qr_data) : null;

        // 1. REJECT if no QR, invalid QR, unreadable, or Merchant Payment QR
        if (!qr_data || !parsedQR || !parsedQR.isValidSlipQR || !parsedQR.transRef || parsedQR.isMerchantPaymentQR) {
          return new Response(JSON.stringify({
            success: false,
            auto_approved: false,
            error: parsedQR?.rejectionReason || 'ไม่สามารถตรวจสอบ QR Code จากสลิปได้ กรุณาอัปโหลดสลิปโอนเงินที่ถูกต้อง'
          }), { status: 400, headers: corsHeaders });
        }

        // 2. ANTI-FRAUD: Check duplicate slip by transRef
        // 2A. Prevent customer from re-uploading the same rejected slip for this booking
        const rejectedOnSameBooking = await env.DB.prepare(
          "SELECT id FROM slip_verifications WHERE booking_id = ? AND trans_ref = ? AND verification_status = 'rejected' LIMIT 1"
        ).bind(booking.id, parsedQR.transRef).first();

        if (rejectedOnSameBooking || (booking.payment_status === 'rejected' && booking.slip_trans_ref === parsedQR.transRef)) {
          return new Response(JSON.stringify({
            success: false,
            auto_approved: false,
            error: 'สลิปนี้เคยถูกปฏิเสธแล้ว กรุณาแนบสลิปใหม่ที่มีการโอนเงินถูกต้อง'
          }), { status: 400, headers: corsHeaders });
        }

        // 2B. Check duplicate across other bookings
        const duplicate = await env.DB.prepare(
          'SELECT id, receipt_number FROM bookings WHERE slip_trans_ref = ? AND id != ?'
        ).bind(parsedQR.transRef, booking.id).first();

        if (duplicate) {
          return new Response(JSON.stringify({
            success: false,
            auto_approved: false,
            error: `สลิปนี้เคยถูกนำมาใช้งานในระบบแล้ว (รหัสการจอง: ${duplicate.receipt_number || duplicate.id}) ไม่สามารถใช้ซ้ำได้`
          }), { status: 400, headers: corsHeaders });
        }

        // 3. ENTER MANUAL REVIEW (NEVER auto-approve as paid on Worker without OCR/amount verification)
        if (!env.BUCKET) {
          return new Response(JSON.stringify({ error: 'ระบบจัดเก็บไฟล์ (R2) ไม่พร้อมใช้งาน ไม่สามารถบันทึกสลิปได้' }), { status: 500, headers: corsHeaders });
        }
        let savedSlipUrl = await saveUploadedFile(env, slip_image, 'payment-slips', { bookingId: booking.id, uploadedBy: 'customer' });
        // Guard against Cloudflare D1 SQLITE_TOOBIG (1MB limit)
        if (savedSlipUrl && typeof savedSlipUrl === 'string' && savedSlipUrl.length > 700000) {
          savedSlipUrl = savedSlipUrl.substring(0, 650000);
        }
        const updated = await env.DB.prepare(`
          UPDATE bookings
          SET slip_image_url = ?,
              payment_status = 'reviewing',
              slip_trans_ref = ?,
              slip_verified_at = NULL,
              slip_verify_status = 'pending_manual'
          WHERE id = ? AND COALESCE(payment_status, 'pending') NOT IN ('paid', 'cancelled')
        `).bind(savedSlipUrl || 'uploaded', parsedQR.transRef, booking.id).run();
        if (updated.meta?.changes !== 1) {
          return new Response(JSON.stringify({ success: false, auto_approved: false, error: 'สถานะรายการจองเปลี่ยนแล้ว กรุณาตรวจสอบรายการอีกครั้ง' }), { status: 409, headers: corsHeaders });
        }

        // 4. Record in slip_verifications table for audit trail
        try {
          await env.DB.prepare(`
            INSERT INTO slip_verifications (
              booking_id, trans_ref, bank_code, bank_name, slip_image_url,
              is_auto_approved, confidence_score, raw_qr_data, verification_status,
              rejection_reason, created_at
            ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'pending_manual', 'QR จาก client ยังไม่ยืนยันกับภาพ รอเจ้าหน้าที่ตรวจสอบยอดเงินและบัญชีผู้รับ', ?)
          `).bind(
            booking.id,
            parsedQR.transRef,
            parsedQR.bankCode || '000',
            parsedQR.bankName || 'ธนาคารพาณิชย์',
            savedSlipUrl || 'uploaded',
            qr_data || '',
            nowIso
          ).run();
        } catch (svErr) {
          return new Response(JSON.stringify({
            success: false,
            auto_approved: false,
            error: 'ระบบไม่สามารถบันทึกผลตรวจสอบสลิปได้ กรุณาลองใหม่อีกครั้ง'
          }), { status: 503, headers: corsHeaders });
        }

        return new Response(JSON.stringify({
          success: true,
          auto_approved: false,
          status: 'reviewing',
          qr_verified: false,
          verification_source: 'client_qr_unverified',
          slipUrl: savedSlipUrl,
          transRef: parsedQR.transRef,
          bankName: parsedQR.bankName,
          message: 'ระบบได้รับหลักฐานการโอนเงินแล้ว กรุณารอเจ้าหน้าที่ตรวจสอบยอดเงินก่อนยืนยันการจอง'
        }), { headers: corsHeaders });
      }

      if ((pathname === '/api/public/bookings/by-phone' || pathname === '/api/public/bookings/lookup') && method === 'GET') {
        const phone = url.searchParams.get('phone') || url.searchParams.get('contact');
        if (!phone || !phone.trim()) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกเบอร์โทรศัพท์' }), { status: 400, headers: corsHeaders });
        }

        const cleanPhone = String(phone).replace(/\D/g, '');
        const { results: bookings } = await env.DB.prepare(
          `SELECT * FROM bookings
           WHERE (REPLACE(REPLACE(REPLACE(contact, '-', ''), ' ', ''), '+', '') = ?
              OR contact = ?
              OR contact LIKE ?)
           ORDER BY id DESC LIMIT 10`
        ).bind(cleanPhone, phone, `%${cleanPhone}%`).all();

        if (!bookings || !bookings.length) {
          return new Response(JSON.stringify({ error: 'ไม่พบรายการจองสำหรับเบอร์โทรศัพท์นี้ กรุณาตรวจสอบเบอร์อีกครั้ง' }), { status: 404, headers: corsHeaders });
        }

        const bookingIds = bookings.map(b => b.id);
        const placeholders = bookingIds.map(() => '?').join(',');
        const { results: items } = await env.DB.prepare(
          `SELECT bi.*, r.name as room_name, r.capacity, r.image_url, r.description
           FROM booking_items bi
           LEFT JOIN rooms r ON bi.room_id = r.id
           WHERE bi.booking_id IN (${placeholders})
           ORDER BY bi.id ASC`
        ).bind(...bookingIds).all();

        const itemsMap = {};
        (items || []).forEach(it => {
          if (!itemsMap[it.booking_id]) itemsMap[it.booking_id] = [];
          itemsMap[it.booking_id].push(it);
        });

        for (const b of bookings) {
          const bItems = itemsMap[b.id] || [];
          b.items = bItems;
          b.bookingCode = `BK-${String(b.id).padStart(6, '0')}`;
          if (bItems.length > 0 && bItems[0].room_name) {
            b.room_name = bItems[0].room_name;
            b.start_time = bItems[0].start_time?.includes('T') ? bItems[0].start_time.split('T')[1].substring(0, 5) : bItems[0].start_time;
            b.end_time = bItems[0].end_time?.includes('T') ? bItems[0].end_time.split('T')[1].substring(0, 5) : bItems[0].end_time;
            b.booking_date = bItems[0].start_time?.includes('T') ? bItems[0].start_time.split('T')[0] : b.created_at?.split('T')[0];
          }
          if (b.payment_status === 'rejected' || b.slip_verify_status === 'rejected') {
            const rejRow = await env.DB.prepare(
              "SELECT rejection_reason FROM slip_verifications WHERE booking_id = ? AND verification_status = 'rejected' ORDER BY id DESC LIMIT 1"
            ).bind(b.id).first();
            b.rejection_reason = rejRow?.rejection_reason || null;
          } else {
            b.rejection_reason = null;
          }
        }

        return new Response(JSON.stringify({ success: true, bookings }), { headers: corsHeaders });
      }

      // Customer requests Door PIN via Web / LIFF
      if (pathname.startsWith('/api/public/bookings/') && pathname.endsWith('/request-pin') && method === 'POST') {
        const parts = pathname.split('/');
        const idParam = parts[4];

        let bookingId = idParam;
        if (typeof idParam === 'string' && idParam.startsWith('BK-')) {
          const raw = idParam.replace('BK-', '');
          if (raw.length <= 6 && !isNaN(raw)) {
            bookingId = parseInt(raw, 10);
          }
        }

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ? OR receipt_number = ?').bind(bookingId, idParam).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        if (booking.payment_status !== 'paid') {
          return new Response(JSON.stringify({ error: 'รายการจองนี้ยังไม่ได้รับการยืนยันชำระเงิน กรุณาติดต่อพนักงาน' }), { status: 400, headers: corsHeaders });
        }

        const bItem = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? AND room_id IS NOT NULL ORDER BY id ASC LIMIT 1').bind(booking.id).first();
        const room = bItem?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(bItem.room_id).first() : null;
        if (!roomUsesDoorPin(room || bItem?.room_id)) {
          return new Response(JSON.stringify({ error: 'ห้องนี้ไม่ใช้รหัสผ่านประตู' }), { status: 400, headers: corsHeaders });
        }

        const res = await sendLineDoorPin(env, booking.id);
        if (res && res.success) {
          return new Response(JSON.stringify({ success: true, message: 'ส่งรหัสผ่านเข้าห้องไปยัง LINE เรียบร้อยแล้ว' }), { headers: corsHeaders });
        } else {
          return new Response(JSON.stringify({ success: true, pin_code: booking.pin_code, message: `รหัสผ่านเปิดประตูคือ ${booking.pin_code}` }), { headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/public/bookings/') && method === 'GET') {
        const idParam = pathname.replace('/api/public/bookings/', '');

        let bookingId = isNaN(Number(idParam)) ? null : Number(idParam);
        if (!bookingId && typeof idParam === 'string' && idParam.startsWith('BK-')) {
          const raw = idParam.replace('BK-', '');
          if (raw.length <= 6 && !isNaN(Number(raw))) {
            bookingId = parseInt(raw, 10);
          }
        }

        const booking = await env.DB.prepare(
          'SELECT * FROM bookings WHERE id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)'
        ).bind(bookingId || 0, idParam, idParam).first();

        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        // Public booking authorization check (Headers primary, legacy query fallback)
        const suppliedToken = request.headers.get('x-booking-token') || url.searchParams.get('access_token');
        const suppliedContact = request.headers.get('x-booking-contact') || url.searchParams.get('contact');
        const normalizedContact = String(suppliedContact || '').replace(/\D/g, '');

        const safeEqual = async (left, right) => {
          if (!left || !right) return false;
          const encoder = new TextEncoder();
          const [a, b] = await Promise.all([left, right].map(value =>
            crypto.subtle.digest('SHA-256', encoder.encode(String(value)))));
          const bytesA = new Uint8Array(a);
          const bytesB = new Uint8Array(b);
          let difference = 0;
          for (let i = 0; i < bytesA.length; i++) difference |= bytesA[i] ^ bytesB[i];
          return difference === 0;
        };

        const tokenMatches = booking.qr_token && await safeEqual(suppliedToken, booking.qr_token);
        const contactMatches = normalizedContact.length >= 9 &&
          await safeEqual(normalizedContact, String(booking.contact || '').replace(/\D/g, ''));

        if (!tokenMatches && !contactMatches) {
          return new Response(JSON.stringify({ error: 'กรุณายืนยันเบอร์โทรศัพท์หรือสิทธิ์เข้าถึงรายการจอง' }), { status: 403, headers: corsHeaders });
        }

        const { results: items } = await env.DB.prepare(
          `SELECT bi.*, r.name as room_name, r.capacity, r.image_url, r.description
           FROM booking_items bi
           LEFT JOIN rooms r ON bi.room_id = r.id
           WHERE bi.booking_id = ?`
        ).bind(booking.id).all();

        const bookingCode = `BK-${String(booking.id).padStart(6, '0')}`;
        let roomInfo = null;
        if (items && items.length) {
          roomInfo = {
            id: items[0].room_id,
            name: items[0].room_name,
            capacity: items[0].capacity,
            image_url: items[0].image_url,
            description: items[0].description
          };
        }

        let rejectionReason = null;
        if (booking.payment_status === 'rejected' || booking.slip_verify_status === 'rejected') {
          const rejRow = await env.DB.prepare(
            "SELECT rejection_reason FROM slip_verifications WHERE booking_id = ? AND verification_status = 'rejected' ORDER BY id DESC LIMIT 1"
          ).bind(booking.id).first();
          rejectionReason = rejRow?.rejection_reason || null;
        }

        const pwRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'payment_window_minutes'").first();
        const windowMins = Math.max(1, parseInt(pwRow?.value || '15', 10) || 15);

        // Sanitize public response: strip private credentials, PIN, tax secrets, internal notes
        const {
          pin_code,
          qr_token,
          line_user_id,
          slip_trans_ref,
          slip_image_url,
          customer_email,
          tax_name,
          tax_address,
          tax_id,
          tax_phone,
          tax_delivery_method,
          tax_postal_address,
          internal_department,
          ...safeBooking
        } = booking;

        const safeItems = (items || []).map(item => {
          const { pin_code: itemPin, ...safeItem } = item;
          return safeItem;
        });

        return new Response(JSON.stringify({
          ...safeBooking,
          has_slip: Boolean(slip_image_url),
          rejection_reason: rejectionReason,
          bookingCode,
          items: safeItems,
          room: roomInfo,
          start_time: items && items.length ? (items[0].start_time?.includes('T') ? items[0].start_time.split('T')[1].substring(0, 5) : items[0].start_time) : null,
          end_time: items && items.length ? (items[0].end_time?.includes('T') ? items[0].end_time.split('T')[1].substring(0, 5) : items[0].end_time) : null,
          booking_date: items && items.length ? (items[0].start_time?.includes('T') ? items[0].start_time.split('T')[0] : booking.created_at?.split('T')[0]) : null,
          paymentDeadline: new Date(new Date(booking.created_at).getTime() + windowMins * 60 * 1000).toISOString(),
          payment_window_minutes: windowMins
        }), { headers: corsHeaders });
      }

      if (pathname === '/api/public/bookings' && method === 'POST') {
        const body = await request.json();
        const {
          customer_name, contact, email, department, note, room_id, booking_date,
          start_time, end_time, booking_type, layout, total_amount, line_user_id,
          tax_invoice_required, tax_name, tax_address, tax_id, tax_phone,
          tax_delivery_method, tax_postal_address, guest_count, guests
        } = body;

        if (!customer_name || !contact || !room_id || !booking_date || !start_time || !end_time) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน (ชื่อ, เบอร์โทร, ห้อง, วันที่, เวลา)' }), { status: 400, headers: corsHeaders });
        }

        // Mandatory guest_count validation for online bookings
        const parsedGuests = parseInt(guest_count || guests, 10);
        if (isNaN(parsedGuests) || parsedGuests < 1) {
          return new Response(JSON.stringify({ error: 'กรุณาระบุจำนวนผู้เข้าใช้งาน (อย่างน้อย 1 ท่าน)' }), { status: 400, headers: corsHeaders });
        }

        const sHHMM = start_time.substring(0, 5);
        const eHHMM = end_time.substring(0, 5);

        if (eHHMM <= sHHMM) {
          return new Response(JSON.stringify({ error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' }), { status: 400, headers: corsHeaders });
        }
        if (sHHMM < '08:00') {
          return new Response(JSON.stringify({ error: 'เวลาเริ่มต้นต้องไม่เร็วกว่าเวลาเปิดทำการ (08:00 น.)' }), { status: 400, headers: corsHeaders });
        }
        if (sHHMM >= '18:00') {
          return new Response(JSON.stringify({ error: 'ไม่สามารถจองเวลาเริ่มต้นตั้งแต่เวลาปิดทำการ (18:00 น.) เป็นต้นไป' }), { status: 400, headers: corsHeaders });
        }
        if (eHHMM > '18:00') {
          return new Response(JSON.stringify({ error: 'เวลาสิ้นสุดต้องไม่เกินเวลาปิดทำการ (18:00 น.)' }), { status: 400, headers: corsHeaders });
        }

        // Validate past time for today's booking
        const [by, bm, bd] = booking_date.split('-').map(Number);
        const [bsh, bsm] = start_time.split(':').map(Number);
        const bookingStartUtc = new Date(Date.UTC(by, bm - 1, bd, bsh - 7, bsm));
        if (bookingStartUtc.getTime() < Date.now() - 5 * 60 * 1000) {
          return new Response(JSON.stringify({ error: 'ขออภัย ไม่สามารถจองช่วงเวลาในอดีตได้ กรุณาเลือกช่วงเวลาใหม่' }), { status: 400, headers: corsHeaders });
        }

        const room = await env.DB.prepare("SELECT * FROM rooms WHERE id = ? AND status = 'active'").bind(room_id).first();
        if (!room) {
          return new Response(JSON.stringify({ error: 'ไม่พบห้องที่เลือก หรือห้องไม่พร้อมใช้งาน' }), { status: 404, headers: corsHeaders });
        }

        const fullStart = normalizeToLocalISO(booking_date, start_time);
        const fullEnd = normalizeToLocalISO(booking_date, end_time);

        const overlapResult = await checkRoomOverlap(env, room_id, fullStart, fullEnd);
        if (overlapResult.hasOverlap) {
          return new Response(JSON.stringify({ error: formatOverlapErrorMessage(room.name, overlapResult) }), { status: 409, headers: corsHeaders });
        }

        // Server-side price calculation
        let price = room.hourly_rate;
        let quantity = 1;
        const bType = booking_type || 'hourly';
        const bLayout = layout || 'standard';

        if (bType === 'daily') {
          price = bLayout === 'classroom' ? (room.classroom_daily_rate || room.daily_rate) : room.daily_rate;
          quantity = 1;
        } else if (bType === 'halfday') {
          price = room.half_day_rate;
          quantity = 1;
        } else {
          price = bLayout === 'classroom' ? (room.classroom_hourly_rate || room.hourly_rate) : room.hourly_rate;
          const startParts = start_time.split(':');
          const endParts = end_time.split(':');
          const startMinutes = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
          const endMinutes = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);
          quantity = Math.max(1, Math.ceil((endMinutes - startMinutes) / 60));
        }

        // The server, not the browser, is the source of truth for public pricing.
        const subtotal = Math.round(price * quantity * 100) / 100;

        // Authoritative promotion pricing evaluation
        const promoRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'online_promotion'").first();
        const promoPricing = calculateOnlineBookingPricing({
          subtotal,
          promo: promoRow?.value,
          currentTime: Date.now()
        });

        const receiptNumber = await generateReceiptNumber(env);
        const pinCode = !roomUsesDoorPin(room || room_id) ? null : (room.pin_code?.trim() || await generateUniquePinCode(env));

        const nowIso = new Date().toISOString();
        let insBooking;
        try {
          insBooking = await env.DB.prepare(
            `INSERT INTO bookings (
               customer_name, department, contact,
               subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount,
               payment_status, payment_method,
               receipt_number, pin_code, booking_source, customer_email, checkin_status, line_user_id,
               tax_invoice_required, tax_name, tax_address, tax_id, tax_phone, tax_delivery_method, tax_postal_address,
               guest_count,
               created_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', 'transfer', ?, ?, 'online', ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            customer_name, department || note || '', contact,
            promoPricing.subtotal_amount, promoPricing.discount_type, promoPricing.discount_value, promoPricing.discount_amount, promoPricing.total_amount, promoPricing.total_amount,
            receiptNumber, pinCode,
            email || null, line_user_id || null,
            tax_invoice_required ? 1 : 0, tax_name || null, tax_address || null, tax_id || null, tax_phone || null,
            tax_delivery_method || null, tax_postal_address || null,
            parsedGuests,
            nowIso
          ).run();
        } catch (dbErr) {
          console.warn('Extended booking insert failed, falling back to core schema:', dbErr);
          insBooking = await env.DB.prepare(
            `INSERT INTO bookings (
               customer_name, department, contact,
               subtotal_amount, discount_type, discount_value, discount_amount, total_amount, paid_amount, balance_amount,
               payment_status, payment_method,
               receipt_number, pin_code, booking_source, customer_email, checkin_status, line_user_id,
               created_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', 'transfer', ?, ?, 'online', ?, 'pending', ?, ?)`
          ).bind(
            customer_name, department || note || '', contact,
            promoPricing.subtotal_amount, promoPricing.discount_type, promoPricing.discount_value, promoPricing.discount_amount, promoPricing.total_amount, promoPricing.total_amount,
            receiptNumber, pinCode,
            email || null, line_user_id || null,
            nowIso
          ).run();
        }

        const bookingId = insBooking.meta.last_row_id;

        try {
          await env.DB.prepare(
            `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, guest_count, pin_code)
             VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(bookingId, room_id, subtotal, fullStart, fullEnd, subtotal, bLayout, bType, parsedGuests, pinCode).run();
        } catch (itemErr) {
          console.warn('Extended item insert failed, falling back to core item schema:', itemErr);
          await env.DB.prepare(
            `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal)
             VALUES (?, ?, 1, ?, ?, ?, ?)`
          ).bind(bookingId, room_id, subtotal, fullStart, fullEnd, subtotal).run();
        }

        const bookingCode = `BK-${String(bookingId).padStart(6, '0')}`;

        const pwRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'payment_window_minutes'").first();
        const windowMins = Math.max(1, parseInt(pwRow?.value || '15', 10) || 15);

        // Return clean response WITHOUT exposing the PIN code to unverified customer
        return new Response(JSON.stringify({
          success: true,
          booking_id: bookingId,
          bookingId: bookingId,
          id: bookingId,
          booking_code: receiptNumber || bookingCode,
          bookingCode: receiptNumber || bookingCode,
          receipt_number: receiptNumber,
          receiptNumber: receiptNumber,
          total_amount: promoPricing.total_amount,
          totalAmount: promoPricing.total_amount,
          subtotalAmount: promoPricing.subtotal_amount,
          discountAmount: promoPricing.discount_amount,
          discountType: promoPricing.discount_type,
          discountValue: promoPricing.discount_value,
          paymentDeadline: new Date(Date.now() + windowMins * 60 * 1000).toISOString(),
          payment_window_minutes: windowMins,
          message: `บันทึกการจองสำเร็จ! กรุณาแนบสลิปชำระเงินภายใน ${windowMins} นาทีเพื่อยืนยันการจอง`
        }), { status: 201, headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 6. QUOTATIONS CRUD (REQUIRES AUTH)
      // ----------------------------------------------------
      if (pathname === '/api/quotations/next-number' && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const nextNum = await generateQuotationNumber(env);
        return new Response(JSON.stringify({ quotationNo: nextNum, quotation_no: nextNum }), { headers: corsHeaders });
      }

      if (pathname === '/api/quotations') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        if (method === 'GET') {
          const { results } = await env.DB.prepare("SELECT * FROM quotations ORDER BY created_at DESC").all();
          return new Response(JSON.stringify(results || []), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const body = await request.json();
          const qNo = body.quotation_no || await generateQuotationNumber(env);
          const ins = await env.DB.prepare(
            "INSERT INTO quotations (customer_name, department, contact, total_amount, status, quotation_no, valid_until, seller_name, job_name, customer_address) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)"
          ).bind(body.customer_name, body.department || '', body.contact || '', body.total_amount || 0, qNo, body.valid_until || '', body.seller_name || '', body.job_name || '', body.customer_address || '').run();

          const qId = ins.meta.last_row_id;
          if (body.items && body.items.length) {
            for (const item of body.items) {
              await env.DB.prepare(
                `INSERT INTO quotation_items
                 (quotation_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, discount, item_date, discount_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                qId,
                item.room_id || null,
                item.service_id || null,
                item.quantity || 1,
                item.price || 0,
                item.start_time || null,
                item.end_time || null,
                item.subtotal || 0,
                item.layout || 'standard',
                item.booking_type || 'hourly',
                item.discount || 0,
                item.item_date || null,
                item.discount_type || 'amount'
              ).run();
            }
          }

          return new Response(JSON.stringify({ success: true, id: qId, quotation_no: qNo }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/quotations/')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const qId = pathname.replace('/api/quotations/', '').split('/')[0];
        if (method === 'GET') {
          const q = await env.DB.prepare("SELECT * FROM quotations WHERE id = ?").bind(qId).first();
          if (!q) {
            return new Response(JSON.stringify({ error: 'ไม่พบใบเสนอราคา' }), { status: 404, headers: corsHeaders });
          }

          const { results: items } = await env.DB.prepare(
            `SELECT qi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name
             FROM quotation_items qi
             LEFT JOIN rooms r ON qi.room_id = r.id
             LEFT JOIN services s ON qi.service_id = s.id
             WHERE qi.quotation_id = ?`
          ).bind(qId).all();

          return new Response(JSON.stringify({ ...q, items: items || [] }), { headers: corsHeaders });
        }
        if (method === 'PUT') {
          const body = await request.json();
          if (body.status === 'approved') {
            await env.DB.prepare("UPDATE quotations SET status = 'approved', approved_at = ? WHERE id = ?").bind(new Date().toISOString(), qId).run();
          } else {
            await env.DB.prepare(
              "UPDATE quotations SET customer_name=?, department=?, contact=?, total_amount=?, status=?, valid_until=?, seller_name=?, job_name=?, customer_address=?, quotation_no=? WHERE id=?"
            ).bind(body.customer_name, body.department || '', body.contact || '', body.total_amount || 0, body.status || 'draft', body.valid_until || '', body.seller_name || '', body.job_name || '', body.customer_address || '', body.quotation_no || '', qId).run();

            if (body.items) {
              await env.DB.prepare("DELETE FROM quotation_items WHERE quotation_id = ?").bind(qId).run();
              for (const item of body.items) {
                await env.DB.prepare(
                  `INSERT INTO quotation_items
                   (quotation_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, discount, item_date, discount_type)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                  qId,
                  item.room_id || null,
                  item.service_id || null,
                  item.quantity || 1,
                  item.price || 0,
                  item.start_time || null,
                  item.end_time || null,
                  item.subtotal || 0,
                  item.layout || 'standard',
                  item.booking_type || 'hourly',
                  item.discount || 0,
                  item.item_date || null,
                  item.discount_type || 'amount'
                ).run();
              }
            }
          }
          return new Response(JSON.stringify({ success: true, message: 'อัปเดตใบเสนอราคาสำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          await env.DB.prepare("DELETE FROM quotation_items WHERE quotation_id = ?").bind(qId).run();
          await env.DB.prepare("DELETE FROM quotations WHERE id = ?").bind(qId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบใบเสนอราคาสำเร็จ' }), { headers: corsHeaders });
        }
      }

      // ----------------------------------------------------
      // 7. SETTINGS, PROMOTION, USERS & ROLES CRUD (REQUIRES AUTH)
      // ----------------------------------------------------
      if (pathname === '/api/public/promotion' && method === 'GET') {
        const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'online_promotion'").first();
        const promoState = parsePromotionState(row?.value);
        return new Response(JSON.stringify(getPublicPromotionPayload(promoState, Date.now())), { headers: corsHeaders });
      }

      if (pathname === '/api/public/settings/payment' && method === 'GET') {
        const { results: settings } = await env.DB.prepare("SELECT key, value FROM settings").all();
        const map = {};
        (settings || []).forEach(s => map[s.key] = s.value);
        const windowMins = Math.max(1, parseInt(map.payment_window_minutes || '15', 10) || 15);
        const deadlineHours = Math.round((windowMins / 60) * 100) / 100;
        const promoState = parsePromotionState(map.online_promotion);
        return new Response(JSON.stringify({
          company_name: map.company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)',
          promptpay_id: map.promptpay_id || '0125554000401',
          payment_bank_name: map.payment_bank_name || map.bank_name || 'ธนาคารกรุงศรีอยุธยา (Krungsri)',
          payment_bank_account: map.payment_bank_account || map.bank_account || '329-1-38429-0',
          payment_bank_account_name: map.payment_bank_account_name || map.bank_account_name || 'บริษัท บิลท์ ฮาร์ท จำกัด',
          payment_deadline_hours: deadlineHours,
          payment_window_minutes: windowMins,
          cleaning_buffer_minutes: parseInt(map.cleaning_buffer_minutes || '30', 10),
          line_liff_id: map.line_liff_id || '2011136579-c1TeSWNs',
          promotion: getPublicPromotionPayload(promoState, Date.now())
        }), { headers: corsHeaders });
      }

      if ((pathname === '/api/admin/promotion' || pathname === '/api/settings/promotion') && method === 'GET') {
        const auth = await authenticateUser(request, env);
        const authErr = checkAdminPromotionAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'online_promotion'").first();
        const promoState = parsePromotionState(row?.value);
        const statusInfo = getPromotionStatus(promoState, Date.now());
        return new Response(JSON.stringify({
          success: true,
          promotion: {
            ...promoState,
            status: statusInfo.status,
            status_label: statusInfo.label
          }
        }), { headers: corsHeaders });
      }

      if ((pathname === '/api/admin/promotion' || pathname === '/api/settings/promotion') && (method === 'PUT' || method === 'POST')) {
        const auth = await authenticateUser(request, env);
        const authErr = checkAdminPromotionAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'online_promotion'").first();
        const currentPromoState = parsePromotionState(row?.value);

        let body = {};
        try {
          body = await request.json();
        } catch (e) {
          body = {};
        }

        const validation = validatePromotionUpdatePayload(body, currentPromoState);
        if (!validation.valid) {
          return new Response(JSON.stringify({ error: validation.error }), { status: 400, headers: corsHeaders });
        }

        const adminName = auth.user.fullname || auth.user.username || 'admin';
        const updatedState = {
          ...currentPromoState,
          promotion_name: validation.data.promotion_name,
          discount_value: validation.data.discount_value,
          start_at: validation.data.start_at,
          end_at: validation.data.end_at,
          updated_at: getBangkokLocalISO(new Date()),
          updated_by: adminName
        };

        await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('online_promotion', ?) ON CONFLICT(key) DO UPDATE SET value = ?")
          .bind(JSON.stringify(updatedState), JSON.stringify(updatedState)).run();

        const now = Date.now();
        const statusInfo = getPromotionStatus(updatedState, now);
        const eligibility = canActivatePromotion(updatedState, now);

        return new Response(JSON.stringify({
          success: true,
          message: 'บันทึกการตั้งค่าโปรโมชั่นเรียบร้อยแล้ว',
          promotion: {
            ...updatedState,
            status: statusInfo.status,
            status_label: statusInfo.label,
            can_activate: eligibility.allowed,
            activation_blocked_reason: eligibility.allowed ? null : eligibility.reason
          }
        }), { headers: corsHeaders });
      }

      if ((pathname === '/api/admin/promotion/activate' || pathname === '/api/settings/promotion/activate') && method === 'POST') {
        const auth = await authenticateUser(request, env);
        const authErr = checkAdminPromotionAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'online_promotion'").first();
        const promoState = parsePromotionState(row?.value);
        const now = Date.now();
        const eligibility = canActivatePromotion(promoState, now);
        if (!eligibility.allowed) {
          return new Response(JSON.stringify({ error: eligibility.reason }), { status: 400, headers: corsHeaders });
        }

        const adminName = auth.user.fullname || auth.user.username || 'admin';
        const updatedState = {
          ...promoState,
          is_enabled: true,
          activated_at: getBangkokLocalISO(new Date()),
          activated_by: adminName
        };

        await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('online_promotion', ?) ON CONFLICT(key) DO UPDATE SET value = ?")
          .bind(JSON.stringify(updatedState), JSON.stringify(updatedState)).run();

        const statusInfo = getPromotionStatus(updatedState, now);
        return new Response(JSON.stringify({
          success: true,
          message: 'เปิดใช้งานโปรโมชั่นจองออนไลน์ 5% สำเร็จ',
          promotion: {
            ...updatedState,
            status: statusInfo.status,
            status_label: statusInfo.label
          }
        }), { headers: corsHeaders });
      }

      if ((pathname === '/api/admin/promotion/deactivate' || pathname === '/api/settings/promotion/deactivate') && method === 'POST') {
        const auth = await authenticateUser(request, env);
        const authErr = checkAdminPromotionAuth(auth);
        if (authErr) return new Response(JSON.stringify({ error: authErr.error }), { status: authErr.status, headers: corsHeaders });

        const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'online_promotion'").first();
        const promoState = parsePromotionState(row?.value);
        const now = Date.now();
        const adminName = auth.user.fullname || auth.user.username || 'admin';
        const updatedState = {
          ...promoState,
          is_enabled: false,
          deactivated_at: getBangkokLocalISO(new Date()),
          deactivated_by: adminName
        };

        await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('online_promotion', ?) ON CONFLICT(key) DO UPDATE SET value = ?")
          .bind(JSON.stringify(updatedState), JSON.stringify(updatedState)).run();

        const statusInfo = getPromotionStatus(updatedState, now);
        return new Response(JSON.stringify({
          success: true,
          message: 'หยุดการใช้งานโปรโมชั่นเรียบร้อยแล้ว',
          promotion: {
            ...updatedState,
            status: statusInfo.status,
            status_label: statusInfo.label
          }
        }), { headers: corsHeaders });
      }

      if (pathname === '/api/settings') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        if (method === 'POST') {
          const user = auth.user;
          const isAdmin = user && (user.role === 'admin' || user.username === 'admin');
          const perms = new Set((user?.permissions || '').split(',').map(p => p.trim()).filter(Boolean));
          const hasSettingPerm = isAdmin || perms.has('admin-management') || perms.has('admin-system') || perms.has('admin-quotation') || perms.has('admin-backup') || perms.has('admin-dooraccess') || perms.has('admin-general');
          if (!hasSettingPerm) {
            return new Response(JSON.stringify({ error: 'ไม่มีสิทธิ์ดำเนินการนี้' }), { status: 403, headers: corsHeaders });
          }
          const body = await request.json();
          let writableEntries = Object.entries(body);
          if (!isAdmin && !perms.has('admin-management') && !perms.has('admin-system')) {
            writableEntries = writableEntries.filter(([k]) =>
              (perms.has('admin-quotation') && k.startsWith('quotation_')) ||
              (perms.has('admin-backup') && k.startsWith('onedrive_')) ||
              (perms.has('admin-dooraccess') && (k.includes('line_') || k.includes('door_') || k.includes('access_') || k.includes('pin_'))) ||
              (perms.has('admin-general') && [
                'company_name', 'company_address', 'company_tax_id', 'logo_image',
                'receipt_header', 'receipt_footer', 'room_alert_minutes', 'cleaning_buffer_minutes',
                'promptpay_id', 'payment_bank_name', 'payment_bank_account', 'payment_bank_account_name',
                'payment_window_minutes', 'wifi_ssid'
              ].includes(k))
            );
          }
          if (writableEntries.length === 0) {
            return new Response(JSON.stringify({ error: 'ไม่มีการตั้งค่าที่ได้รับอนุญาตให้แก้ไข' }), { status: 403, headers: corsHeaders });
          }
          for (let [k, v] of writableEntries) {
            // Guard against overwriting real secrets with mask string or empty string
            if ((k === 'line_channel_access_token' || k === 'line_channel_secret') && (
              !v ||
              String(v).trim() === '' ||
              String(v).includes('•') ||
              String(v).includes('****')
            )) {
              continue;
            }
            let valToSave = v;
            if (k === 'payment_window_minutes') {
              const parsed = parseInt(v, 10);
              valToSave = (isNaN(parsed) || parsed < 1) ? '15' : String(parsed);
            }
            await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?")
              .bind(k, String(valToSave), String(valToSave)).run();
          }
          return new Response(JSON.stringify({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ' }), { headers: corsHeaders });
        }

        const { results: settings } = await env.DB.prepare("SELECT key, value FROM settings").all();
        const map = {};
        (settings || []).forEach(s => {
          if (s.key === 'line_channel_access_token') {
            map[s.key] = s.value ? '••••••••••••••••••••••••' : '';
            map.has_line_channel_access_token = !!(s.value && s.value.trim());
          } else if (s.key === 'line_channel_secret') {
            map[s.key] = s.value ? '••••••••••••••••' : '';
            map.has_line_channel_secret = !!(s.value && s.value.trim());
          } else {
            map[s.key] = s.value;
          }
        });

        if (!map.wifi_ssid || !String(map.wifi_ssid).trim()) {
          map.wifi_ssid = '@BWORK';
        }

        return new Response(JSON.stringify({
          company_name: map.company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)',
          receipt_header: map.receipt_header || 'ใบเสร็จรับเงิน / ใบรับจองบริการ',
          receipt_footer: map.receipt_footer || 'ขอบคุณที่ใช้บริการห้องประชุมของเรา',
          promptpay_id: map.promptpay_id || '0125554000401',
          payment_bank_name: map.payment_bank_name || map.bank_name || 'ธนาคารกรุงศรีอยุธยา (Krungsri)',
          payment_bank_account: map.payment_bank_account || map.bank_account || '329-1-38429-0',
          payment_bank_account_name: map.payment_bank_account_name || map.bank_account_name || 'บริษัท บิลท์ ฮาร์ท จำกัด',
          payment_deadline_hours: 24,
          wifi_ssid: '@BWORK',
          ...map
        }), { headers: corsHeaders });
      }

      if (pathname === '/api/settings/line/test' && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const user = auth.user;
        const isAdmin = user && (user.role === 'admin' || user.username === 'admin');
        const perms = new Set((user?.permissions || '').split(',').map(p => p.trim()).filter(Boolean));
        if (!isAdmin && !perms.has('admin-management') && !perms.has('admin-system') && !perms.has('admin-dooraccess')) {
          return new Response(JSON.stringify({ error: 'ไม่มีสิทธิ์ดำเนินการนี้' }), { status: 403, headers: corsHeaders });
        }

        try {
          const body = await request.json().catch(() => ({}));
          const { channel_access_token, channel_secret, liff_id } = body;

          let tokenToTest = channel_access_token;
          if (!tokenToTest || String(tokenToTest).includes('•') || String(tokenToTest).trim() === '') {
            const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
            tokenToTest = row?.value || '';
          }

          let secretStatus = 'not_configured';
          if (channel_secret && !String(channel_secret).includes('•') && String(channel_secret).trim() !== '') {
            secretStatus = 'configured';
          } else {
            const rowSec = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_secret'").first();
            if (rowSec?.value && rowSec.value.trim().length > 0) {
              secretStatus = 'configured';
            }
          }

          let liffIdToCheck = liff_id;
          if (!liffIdToCheck || String(liffIdToCheck).trim() === '') {
            const rowLiff = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_liff_id'").first();
            liffIdToCheck = rowLiff?.value || '';
          }
          let liffIdStatus = 'not_configured';
          if (liffIdToCheck && liffIdToCheck.trim()) {
            const liffRegex = /^\d{10}-[A-Za-z0-9_-]+$/;
            if (liffRegex.test(liffIdToCheck.trim())) {
              liffIdStatus = 'valid_format';
            } else {
              liffIdStatus = 'invalid_format';
            }
          }

          if (!tokenToTest || String(tokenToTest).trim() === '') {
            return new Response(JSON.stringify({
              success: false,
              connected: false,
              error: 'ยังไม่ได้ระบุหรือบันทึก LINE Channel Access Token ในระบบ',
              channelSecretStatus: secretStatus,
              liffIdStatus: liffIdStatus
            }), { headers: corsHeaders });
          }

          if (env && (env.ENVIRONMENT === 'staging' || env.DISABLE_LIVE_LINE === 'true')) {
            return new Response(JSON.stringify({
              success: true,
              connected: true,
              sent: false,
              mocked: true,
              bot: {
                name: 'LINE Official Account (Staging Mock)',
                basicId: '@bwork-staging'
              },
              channelSecretStatus: secretStatus,
              liffIdStatus: liffIdStatus,
              message: '[Staging Mode] การเชื่อมต่อกับ LINE Messaging API ถูกจำลอง (Mocked; No Live Dispatch)'
            }), { headers: corsHeaders });
          }

          const lineRes = await fetch('https://api.line.me/v2/bot/info', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${tokenToTest.trim()}`
            }
          });

          if (lineRes.ok) {
            const botData = await lineRes.json();
            return new Response(JSON.stringify({
              success: true,
              connected: true,
              bot: {
                name: botData.displayName || 'LINE Official Account',
                basicId: botData.basicId || ''
              },
              channelSecretStatus: secretStatus,
              liffIdStatus: liffIdStatus,
              message: 'เชื่อมต่อกับ LINE Messaging API สำเร็จ'
            }), { headers: corsHeaders });
          } else {
            let errDetail = 'ไม่สามารถเชื่อมต่อกับ LINE API ได้';
            if (lineRes.status === 401) {
              errDetail = 'LINE Channel Access Token ไม่ถูกต้อง หรือหมดอายุแล้ว (401 Unauthorized)';
            } else if (lineRes.status === 403) {
              errDetail = 'LINE Channel Access Token ไม่มีสิทธิ์เข้าถึง (403 Forbidden)';
            } else {
              errDetail = `เกิดข้อผิดพลาดจาก LINE API (HTTP ${lineRes.status})`;
            }

            return new Response(JSON.stringify({
              success: false,
              connected: false,
              error: errDetail,
              channelSecretStatus: secretStatus,
              liffIdStatus: liffIdStatus
            }), { headers: corsHeaders });
          }
        } catch (err) {
          return new Response(JSON.stringify({
            success: false,
            connected: false,
            error: `เกิดข้อผิดพลาดในการเชื่อมต่อ (${err.message})`,
            channelSecretStatus: 'unknown',
            liffIdStatus: 'unknown'
          }), { headers: corsHeaders });
        }
      }

      if (pathname === '/api/users' || pathname === '/api/admin/users') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        if (method === 'GET') {
          const { results: users } = await env.DB.prepare("SELECT id, username, role, permissions, fullname, created_at FROM users").all();
          const cleanUsers = (users || []).map(u => ({
            ...u,
            permissions: (u.permissions && u.permissions.trim()) ? u.permissions : (u.role === 'admin' ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation' : 'pos,pending,layout,manage,history,quotations')
          }));
          return new Response(JSON.stringify(cleanUsers), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const body = await request.json();
          const defaultPerms = body.role === 'admin'
            ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation'
            : 'pos,pending,layout,manage,history,quotations';
          const passHash = await hashPassword(body.password || '123456');
          const ins = await env.DB.prepare(
            "INSERT INTO users (username, password_hash, role, permissions, fullname) VALUES (?, ?, ?, ?, ?)"
          ).bind(body.username, passHash, body.role || 'staff', body.permissions || defaultPerms, body.fullname || '').run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'เพิ่มผู้ใช้งานสำเร็จ' }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/users/')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const uId = pathname.replace('/api/users/', '').split('/')[0];
        if (pathname.endsWith('/reset-password') && method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) {}
          const newPass = (body.newPassword || body.password || '123456').trim();
          if (newPass.length < 1) {
            return new Response(JSON.stringify({ error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 1 ตัวอักษร' }), { status: 400, headers: corsHeaders });
          }
          const newHash = await hashPassword(newPass);
          await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, uId).run();
          return new Response(JSON.stringify({ success: true, message: `รีเซ็ตรหัสผ่านเป็น "${newPass}" เรียบร้อยแล้ว` }), { headers: corsHeaders });
        }
        if (method === 'PUT') {
          const body = await request.json();
          const defaultPerms = body.role === 'admin'
            ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation'
            : 'pos,pending,layout,manage,history,quotations';
          let query = "UPDATE users SET username=?, role=?, permissions=?, fullname=? WHERE id=?";
          let params = [body.username, body.role || 'staff', body.permissions || defaultPerms, body.fullname || '', uId];
          if (body.password) {
            const passHash = await hashPassword(body.password);
            query = "UPDATE users SET username=?, role=?, permissions=?, fullname=?, password_hash=? WHERE id=?";
            params = [body.username, body.role || 'staff', body.permissions || defaultPerms, body.fullname || '', passHash, uId];
          }
          await env.DB.prepare(query).bind(...params).run();
          return new Response(JSON.stringify({ success: true, message: 'อัปเดตผู้ใช้งานสำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบผู้ใช้งานสำเร็จ' }), { headers: corsHeaders });
        }
      }

      if (pathname === '/api/roles' || pathname.startsWith('/api/roles/')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const rId = pathname.replace('/api/roles/', '');
        if (method === 'POST') {
          const body = await request.json();
          const ins = await env.DB.prepare("INSERT INTO roles (name, label, permissions) VALUES (?, ?, ?)").bind(body.name, body.label || body.name, body.permissions || '').run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'เพิ่มสิทธิ์สำเร็จ' }), { status: 201, headers: corsHeaders });
        }
        if (method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare("UPDATE roles SET name=?, label=?, permissions=? WHERE id=?").bind(body.name, body.label || body.name, body.permissions || '', rId).run();
          await env.DB.prepare("UPDATE users SET permissions=? WHERE role=?").bind(body.permissions || '', body.name).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขสิทธิ์สำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          await env.DB.prepare("DELETE FROM roles WHERE id=?").bind(rId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบสิทธิ์สำเร็จ' }), { headers: corsHeaders });
        }
        const { results: roles } = await env.DB.prepare("SELECT * FROM roles").all();
        return new Response(JSON.stringify(roles && roles.length ? roles : [
          { id: 1, name: 'admin', label: 'ผู้ดูแลระบบ (Admin)', permissions: 'pos,dashboard,pending,layout,history,quotations,hour-credits,customers,tickets,manage,admin-users,admin-system,admin-promotion,admin-quotation,admin-backup,admin-dooraccess,admin-general' },
          { id: 2, name: 'staff', label: 'พนักงานต้อนรับ (Reception)', permissions: 'pos,pending,layout,history,quotations,hour-credits,customers,tickets' }
        ]), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 8. FILE UPLOADS, HARDWARE ACCESS & ADMIN TOOLS
      // ----------------------------------------------------
      if (pathname === '/api/upload' && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const body = await request.json();
        const rawImageData = body.base64Data || body.image || body.image_url;
        if (!rawImageData) {
          return new Response(JSON.stringify({ error: 'กรุณาส่งข้อมูลรูปภาพ' }), { status: 400, headers: corsHeaders });
        }
        const savedUrl = await saveUploadedFile(env, rawImageData, 'uploads');
        return new Response(JSON.stringify({ success: true, url: savedUrl || '/uploads/img_default.png' }), { headers: corsHeaders });
      }

      // Door Access Tablet PIN Verification Endpoint
      if (pathname === '/api/access/verify-pin' && method === 'POST') {
        const { room_id, pin_code } = await request.json();
        if (!pin_code || !pin_code.trim()) {
          return new Response(JSON.stringify({ success: false, valid: false, error: 'กรุณากรอกรหัส PIN 6 หลัก' }), { status: 400, headers: corsHeaders });
        }
        const trimmedPin = pin_code.trim();

        let query = `
          SELECT bi.id as item_id, bi.start_time, bi.end_time, bi.checkin_status,
                 b.id as booking_id, b.customer_name, b.payment_status, b.pin_code,
                 r.id as room_id, r.name as room_name
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          JOIN rooms r ON bi.room_id = r.id
          WHERE (b.pin_code = ? OR bi.pin_code = ? OR r.pin_code = ?)
        `;
        const params = [trimmedPin, trimmedPin, trimmedPin];
        if (room_id) {
          query += " AND bi.room_id = ?";
          params.push(room_id);
        }

        const bookingRow = await env.DB.prepare(query).bind(...params).first();
        if (!bookingRow) {
          return new Response(JSON.stringify({ success: false, valid: false, error: 'ไม่พบข้อมูลการจองด้วยรหัส PIN นี้' }), { status: 404, headers: corsHeaders });
        }

        if (bookingRow.payment_status !== 'paid') {
          return new Response(JSON.stringify({ success: false, valid: false, error: 'รายการจองนี้ยังไม่ได้ชำระเงิน กรุณาชำระเงินที่เคาน์เตอร์ก่อน' }), { status: 400, headers: corsHeaders });
        }

        return new Response(JSON.stringify({
          success: true,
          valid: true,
          message: 'รหัสถูกต้อง ประตูเปิดแล้ว',
          booking: {
            id: bookingRow.booking_id,
            customer_name: bookingRow.customer_name,
            room_name: bookingRow.room_name,
            start_time: bookingRow.start_time,
            end_time: bookingRow.end_time
          }
        }), { headers: corsHeaders });
      }

      // Direct Full Database SQL Dump Download
      if (pathname === '/api/backup/download-sql' && method === 'GET') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const sql = await generateD1DumpSql(env);
        const now = new Date();
        const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `bwork_pos_backup_${dStr}.sql`;

        return new Response(sql, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${fileName}"`
          }
        });
      }

      // Restore Full Database from SQL Dump
      if (pathname === '/api/backup/restore-sql' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const { sqlContent } = await request.json();
        if (!sqlContent || typeof sqlContent !== 'string' || !sqlContent.trim()) {
          return new Response(JSON.stringify({ error: 'ไม่พบเนื้อหาไฟล์ SQL สำหรับกู้คืน' }), { status: 400, headers: corsHeaders });
        }

        try {
          await env.DB.exec(sqlContent);
          return new Response(JSON.stringify({
            success: true,
            message: 'กู้คืนฐานข้อมูลจากไฟล์ .sql สำเร็จเรียบร้อยแล้ว'
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: 'การกู้คืนล้มเหลว: ' + err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // OneDrive Status
      if (pathname === '/api/backup/onedrive/status' && method === 'GET') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const refTokenRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_refresh_token'").first();
        const emailRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_user_email'").first();
        const lastBackupRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_last_backup'").first();
        const lastFileRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_last_file'").first();

        return new Response(JSON.stringify({
          connected: !!(refTokenRow && refTokenRow.value),
          userEmail: emailRow ? emailRow.value : '',
          lastBackup: lastBackupRow ? lastBackupRow.value : null,
          lastFile: lastFileRow ? lastFileRow.value : ''
        }), { headers: corsHeaders });
      }

      // Get OneDrive OAuth URL
      if (pathname === '/api/backup/onedrive/auth-url' && method === 'GET') {
        const clientIdRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_id'").first();
        const cId = clientIdRow?.value || 'd3590ed6-52b3-4102-aeff-aad2292ab01c';
        const redirectUri = url.searchParams.get('redirect_uri') || `${url.origin}/api/backup/onedrive/callback`;
        const scopes = encodeURIComponent('offline_access Files.ReadWrite Files.ReadWrite.All User.Read');
        const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${cId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_mode=query&prompt=consent`;
        return new Response(JSON.stringify({ authUrl, clientId: cId, redirectUri }), { headers: corsHeaders });
      }

      // OneDrive OAuth Callback Endpoint
      if (pathname === '/api/backup/onedrive/callback' && method === 'GET') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error_description') || url.searchParams.get('error');

        if (error || !code) {
          return new Response(`
            <!DOCTYPE html>
            <html>
            <body style="font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#f8fafc;">
              <div style="text-align:center; padding:30px; background:#fff; border-radius:16px; border:1px solid #e2e8f0; max-width:420px;">
                <h3 style="color:#ef4444;">❌ การเชื่อมต่อไม่สำเร็จ</h3>
                <p style="color:#64748b; font-size:14px;">${error || 'ไม่พบ Authorization Code'}</p>
                <button onclick="window.close()" style="margin-top:12px; padding:8px 16px; background:#e2e8f0; border:none; border-radius:8px; cursor:pointer;">ปิดหน้าต่าง</button>
              </div>
            </body>
            </html>
          `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        try {
          const clientIdRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_id'").first();
          const clientSecretRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_secret'").first();
          const cId = clientIdRow?.value || 'd3590ed6-52b3-4102-aeff-aad2292ab01c';
          const redirectUri = `${url.origin}/api/backup/onedrive/callback`;

          const params = new URLSearchParams();
          params.append('client_id', cId);
          if (clientSecretRow?.value) params.append('client_secret', clientSecretRow.value);
          params.append('code', code);
          params.append('redirect_uri', redirectUri);
          params.append('grant_type', 'authorization_code');

          const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
          });
          const tokenData = await tokenRes.json();
          if (tokenData.error) {
            throw new Error(tokenData.error_description || tokenData.error);
          }

          let userEmail = 'OneDrive User';
          try {
            const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
              headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });
            const profile = await profileRes.json();
            userEmail = profile.userPrincipalName || profile.mail || profile.displayName || 'OneDrive User';
          } catch (e) {}

          await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_refresh_token', ?)").bind(tokenData.refresh_token).run();
          await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_user_email', ?)").bind(userEmail).run();

          return new Response(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><title>เชื่อมต่อ OneDrive สำเร็จ</title></head>
            <body style="font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#f0fdf4;">
              <div style="text-align:center; padding:36px; background:#fff; border-radius:20px; box-shadow:0 10px 30px rgba(0,0,0,0.06); max-width:440px; border:1px solid #bbf7d0;">
                <div style="font-size:42px; margin-bottom:12px;">✅</div>
                <h2 style="color:#16a34a; margin:0 0 8px 0; font-size:20px;">เชื่อมต่อบัญชี OneDrive สำเร็จ!</h2>
                <p style="color:#475569; font-size:14px; margin:0 0 16px 0;">เชื่อมต่อกับ: <strong>${userEmail}</strong></p>
                <p style="color:#94a3b8; font-size:12px;">กำลังปิดหน้าต่างนี้และกลับสู่ระบบ POS...</p>
                <script>
                  if (window.opener) {
                    window.opener.postMessage({ type: 'ONEDRIVE_AUTH_SUCCESS', email: '${userEmail}' }, '*');
                  }
                  setTimeout(() => window.close(), 1500);
                </script>
              </div>
            </body>
            </html>
          `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        } catch (err) {
          return new Response(`
            <!DOCTYPE html>
            <html>
            <body style="font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#fef2f2;">
              <div style="text-align:center; padding:30px; background:#fff; border-radius:16px; border:1px solid #fecaca; max-width:420px;">
                <h3 style="color:#ef4444; margin-top:0;">❌ การแลกเปลี่ยน Token ล้มเหลว</h3>
                <p style="color:#64748b; font-size:13px; word-break:break-all;">${err.message}</p>
                <button onclick="window.close()" style="margin-top:12px; padding:8px 16px; background:#fee2e2; color:#ef4444; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">ปิดหน้าต่าง</button>
              </div>
            </body>
            </html>
          `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      }

      // Connect OneDrive Token
      if (pathname === '/api/backup/onedrive/connect' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const body = await request.json();
        const { code, client_id, client_secret, redirect_uri } = body;

        const cId = client_id || 'd3590ed6-52b3-4102-aeff-aad2292ab01c';
        const params = new URLSearchParams();
        params.append('client_id', cId);
        if (client_secret) params.append('client_secret', client_secret);
        params.append('code', code);
        params.append('redirect_uri', redirect_uri || 'https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/backup/onedrive/callback');
        params.append('grant_type', 'authorization_code');

        const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
          return new Response(JSON.stringify({ error: tokenData.error_description || tokenData.error }), { status: 400, headers: corsHeaders });
        }

        let userEmail = 'OneDrive User';
        try {
          const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const profile = await profileRes.json();
          userEmail = profile.userPrincipalName || profile.mail || profile.displayName || 'OneDrive User';
        } catch (e) {}

        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_refresh_token', ?)").bind(tokenData.refresh_token).run();
        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_user_email', ?)").bind(userEmail).run();

        return new Response(JSON.stringify({
          success: true,
          message: `เชื่อมต่อบัญชี OneDrive (${userEmail}) สำเร็จ`,
          userEmail
        }), { headers: corsHeaders });
      }

      // Trigger Manual OneDrive Cloud Backup
      if (pathname === '/api/backup/onedrive/trigger' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const sql = await generateD1DumpSql(env);
        const now = new Date();
        const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `bwork_backup_${dStr}.sql`;

        const fileData = await uploadToOneDriveFromWorker(env, sql, fileName);

        return new Response(JSON.stringify({
          success: true,
          message: 'สำรองข้อมูลและอัปโหลดขึ้น OneDrive สำเร็จแล้ว',
          file: fileData
        }), { headers: corsHeaders });
      }

      // Disconnect OneDrive
      if (pathname === '/api/backup/onedrive/disconnect' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        await env.DB.prepare("DELETE FROM settings WHERE key IN ('onedrive_refresh_token', 'onedrive_user_email', 'onedrive_last_backup', 'onedrive_last_file')").run();
        return new Response(JSON.stringify({ success: true, message: 'ยกเลิกการเชื่อมต่อ OneDrive เรียบร้อยแล้ว' }), { headers: corsHeaders });
      }

      if (pathname === '/api/backup/trigger' && (method === 'POST' || method === 'GET')) {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        return new Response(JSON.stringify({ success: true, message: 'ฐานข้อมูล D1 สำรองข้อมูลอัตโนมัติบน Cloudflare เรียบร้อยแล้ว' }), { headers: corsHeaders });
      }

      // Clear all history (Admin Only with Auth)
      if (pathname === '/api/admin/clear-history' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        await env.DB.prepare("DELETE FROM booking_items").run();
        await env.DB.prepare("DELETE FROM bookings").run();
        await env.DB.prepare("DELETE FROM quotation_items").run().catch(() => {});
        await env.DB.prepare("DELETE FROM quotations").run().catch(() => {});
        await env.DB.prepare("DELETE FROM sqlite_sequence WHERE name IN ('bookings', 'booking_items', 'quotations', 'quotation_items')").run().catch(() => {});

        // Delete test slips from R2 if bucket exists
        if (env.BUCKET) {
          try {
            const list = await env.BUCKET.list({ prefix: 'slips/' });
            for (const obj of list.objects) {
              await env.BUCKET.delete(obj.key);
            }
          } catch (r2Err) {
            console.warn('R2 clear error:', r2Err);
          }
        }

        return new Response(JSON.stringify({ success: true, message: 'ล้างประวัติการใช้งานและรูปภาพสลิปทดสอบทั้งหมดเรียบร้อยแล้ว' }), { headers: corsHeaders });
      }

      // ==========================================
      // CUSTOMER SUPPORT TICKETS & NOTIFICATIONS - DISABLED IN THIS PRODUCTION RELEASE
      // ==========================================
      if (pathname.startsWith('/api/public/support') || pathname.startsWith('/api/pos/support')) {
        return new Response(JSON.stringify({ error: 'Support tickets feature is disabled in this release' }), { status: 404, headers: corsHeaders });
      }

      // LINE Webhook Endpoint
      if (pathname === '/api/line/webhook') {
        return new Response(JSON.stringify({ success: true, message: 'LINE Webhook Received' }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error('Worker runtime error:', err);
      return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), { status: 500, headers: corsHeaders });
    }
  },

  // Scheduled Trigger (Cloudflare Cron)
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      // 1. Auto-Cancel Expired Online Bookings (runs on every cron tick)
      try {
        await cancelExpiredBookings(env);
      } catch (cancelErr) {
        console.error('[Auto-Cancel] Scheduled auto-cancel error:', cancelErr);
      }

      // 2. Daily Midnight Auto-Backup Trigger (Cloudflare Cron: 0 17 * * *)
      if (event.cron === '0 17 * * *') {
        try {
          console.log('Daily midnight Cloudflare D1 to OneDrive backup started...');
          const refTokenRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_refresh_token'").first();
          if (refTokenRow && refTokenRow.value) {
            const sql = await generateD1DumpSql(env);
            const now = new Date();
            const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const fileName = `bwork_backup_${dStr}.sql`;
            await uploadToOneDriveFromWorker(env, sql, fileName);
            console.log('Daily midnight OneDrive backup completed successfully:', fileName);
          }
        } catch (err) {
          console.error('Scheduled daily backup error:', err);
        }
      }
    })());
  }
};

/**
 * Automatically cancels expired online bookings where:
 * - payment_status = 'pending' (strict explicit equality, never NULL)
 * - booking_source = 'online'
 * - slip_image_url is NULL or empty string ''
 * - created_at is valid and nowMs >= deadlineMs (created_at + payment_window_minutes * 60 * 1000)
 *
 * @param {object} env - Cloudflare Worker environment containing env.DB
 * @param {object} [options] - Optional overrides (e.g. nowMs for unit testing)
 * @returns {Promise<{ scanned: number, cancelled: number, skipped: number, results: Array }>}
 */
async function cancelExpiredBookings(env, options = {}) {
  try {
    let windowMins = 15;
    try {
      const pwRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'payment_window_minutes'").first();
      if (pwRow && pwRow.value) {
        const parsed = parseInt(pwRow.value, 10);
        if (!isNaN(parsed) && parsed >= 1) {
          windowMins = parsed;
        }
      }
    } catch (sErr) {
      console.warn('[Auto-Cancel] Failed to load payment_window_minutes from settings, fallback to 15:', sErr.message);
    }

    const windowMs = windowMins * 60 * 1000;
    const nowMs = typeof options.nowMs === 'number' && Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const cancelReasonMsg = `ไม่ได้ทำการชำระเงินภายในเวลาที่กำหนด (${windowMins} นาที)`;

    // Strict eligibility query: explicit payment_status = 'pending' (no slip) OR payment_status = 'rejected'
    const { results: candidates } = await env.DB.prepare(`
      SELECT id, receipt_number, created_at, payment_status, booking_source, slip_image_url
      FROM bookings
      WHERE (
        (payment_status = 'pending' AND (slip_image_url IS NULL OR slip_image_url = ''))
        OR payment_status = 'rejected'
      )
      AND booking_source = 'online'
    `).all();

    let scanned = 0;
    let cancelled = 0;
    let skipped = 0;
    const actionResults = [];

    for (const b of (candidates || [])) {
      scanned++;
      if (!b.created_at) {
        skipped++;
        actionResults.push({ id: b.id, action: 'skipped', reason: 'missing_created_at' });
        continue;
      }

      const createdAtMs = Date.parse(b.created_at);
      if (!Number.isFinite(createdAtMs)) {
        skipped++;
        actionResults.push({ id: b.id, action: 'skipped', reason: 'malformed_created_at' });
        continue;
      }

      const deadlineMs = createdAtMs + windowMs;
      // If nowMs < deadlineMs, not expired yet -> skip
      if (nowMs < deadlineMs) {
        skipped++;
        actionResults.push({ id: b.id, action: 'skipped', reason: 'not_expired' });
        continue;
      }

      // Atomic conditional update on bookings
      const updateRes = await env.DB.prepare(`
        UPDATE bookings
        SET payment_status = 'cancelled',
            checkin_status = 'cancelled',
            cancellation_reason = ?
        WHERE id = ?
          AND (
            (payment_status = 'pending' AND (slip_image_url IS NULL OR slip_image_url = ''))
            OR payment_status = 'rejected'
          )
          AND booking_source = 'online'
      `).bind(cancelReasonMsg, b.id).run();

      if (updateRes.meta?.changes !== 1) {
        // Race condition or status changed (e.g. user uploaded slip, staff approved, or already cancelled)
        skipped++;
        actionResults.push({ id: b.id, action: 'skipped', reason: 'race_or_already_changed' });
        continue;
      }

      cancelled++;
      actionResults.push({ id: b.id, action: 'cancelled' });

      // Secondary consistency update on booking_items
      try {
        await env.DB.prepare(`
          UPDATE booking_items
          SET checkin_status = 'cancelled'
          WHERE booking_id = ?
        `).bind(b.id).run();
      } catch (itemErr) {
        console.warn(`[Auto-Cancel] Warning: failed to update booking_items for booking #${b.id}:`, itemErr.message);
      }
    }

    return { scanned, cancelled, skipped, results: actionResults };
  } catch (err) {
    console.error('[Auto-Cancel] Error in cancelExpiredBookings:', err);
    throw err;
  }
}

const BACKUP_TABLES = [
  'rooms', 'categories', 'items', 'users', 'roles',
  'customers', 'departments', 'settings', 'bookings',
  'booking_items', 'quotations', 'quotation_items',
  'payment_transactions', 'timeline_notes', 'booking_history',
  'cash_shifts', 'cash_drawer_logs'
];

async function generateD1DumpSql(env) {
  const lines = [
    '--',
    '-- =========================================================',
    '-- BWORK POS DATABASE BACKUP (SQL DUMP)',
    `-- Export Timestamp: ${new Date().toISOString()}`,
    '-- Target: Microsoft OneDrive Cloud Backup',
    '-- =========================================================',
    '',
    'PRAGMA foreign_keys = OFF;',
    'BEGIN TRANSACTION;'
  ];

  for (const table of BACKUP_TABLES) {
    try {
      const { results: rows } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      if (!rows || !rows.length) continue;

      lines.push('');
      lines.push(`-- Table: ${table} (${rows.length} rows)`);
      lines.push(`DELETE FROM ${table};`);

      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return val;
          if (typeof val === 'boolean') return val ? 1 : 0;
          const str = String(val).replace(/'/g, "''");
          return `'${str}'`;
        });
        lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`);
      }
    } catch (e) {}
  }

  lines.push('');
  lines.push('COMMIT;');
  lines.push('PRAGMA foreign_keys = ON;');
  lines.push('');

  return lines.join('\n');
}

async function uploadToOneDriveFromWorker(env, sqlContent, fileName) {
  const refTokenRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_refresh_token'").first();
  if (!refTokenRow || !refTokenRow.value) {
    throw new Error('ยังไม่ได้เชื่อมต่อบัญชี OneDrive');
  }

  const clientIdRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_id'").first();
  const clientSecretRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_secret'").first();

  const cId = clientIdRow?.value || 'd3590ed6-52b3-4102-aeff-aad2292ab01c';
  const params = new URLSearchParams();
  params.append('client_id', cId);
  if (clientSecretRow?.value) params.append('client_secret', clientSecretRow.value);
  params.append('refresh_token', refTokenRow.value);
  params.append('grant_type', 'refresh_token');

  const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new Error(tokenData.error_description || tokenData.error);
  }

  if (tokenData.refresh_token && tokenData.refresh_token !== refTokenRow.value) {
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_refresh_token', ?)").bind(tokenData.refresh_token).run();
  }

  const endpoint = `https://graph.microsoft.com/v1.0/me/drive/root:/Bwork_POS_Backups/${encodeURIComponent(fileName)}:/content`;
  const uploadRes = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'text/plain; charset=utf-8'
    },
    body: sqlContent
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`OneDrive upload failed (${uploadRes.status}): ${errText}`);
  }

  const fileData = await uploadRes.json();
  const nowIso = new Date().toISOString();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_last_backup', ?)").bind(nowIso).run();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_last_file', ?)").bind(fileName).run();

  return fileData;
}

const buildLineConfirmationFlex = buildLineBookingConfirmationFlex;
const buildLineBookingCancelledFlex = buildLineBookingCancellationFlex;
