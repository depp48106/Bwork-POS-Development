/**
 * onlinePromotionHelper.js
 * Canonical Promotion Engine for BWORK-POS Online Booking 5% Promotion
 *
 * Rules:
 * 1. Online / LINE OA bookings only receive 5% discount.
 * 2. Admin / POS bookings must remain full price.
 * 3. Authoritative server start_at: 2026-10-13T08:00:00+07:00 (Asia/Bangkok).
 * 4. Activation requires manual action by Admin at or after start_at.
 * 5. end_at supports null / no end date.
 * 6. Deactivation sets is_enabled = false.
 * 7. Existing bookings retain their stored snapshot; no retroactive repricing.
 */

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

  // Active status check: editing strictly blocked while active
  if (currentPromoState && Boolean(currentPromoState.is_enabled)) {
    return {
      valid: false,
      error: 'กรุณาหยุดโปรโมชั่นก่อนแก้ไขการตั้งค่า'
    };
  }

  // Promotion name (admin metadata only)
  let promotionName = DEFAULT_ONLINE_PROMOTION.promotion_name;
  if (payload.promotion_name !== undefined) {
    if (typeof payload.promotion_name === 'string' && payload.promotion_name.trim()) {
      promotionName = payload.promotion_name.trim();
    }
  } else if (currentPromoState?.promotion_name) {
    promotionName = currentPromoState.promotion_name;
  }

  // Discount percentage validation
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

  // Start date validation
  if (!payload.start_at || typeof payload.start_at !== 'string' || !payload.start_at.trim()) {
    return { valid: false, error: 'กรุณาระบุวันและเวลาเริ่มต้นโปรโมชั่น' };
  }
  const startMs = Date.parse(payload.start_at.trim());
  if (isNaN(startMs)) {
    return { valid: false, error: 'วันและเวลาเริ่มต้นโปรโมชั่นไม่ถูกต้อง' };
  }
  const cleanStartAt = payload.start_at.trim();

  // End date validation
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_ONLINE_PROMOTION,
    formatBangkokDateTime,
    parsePromotionState,
    resolveTimestampMs,
    isPromotionActive,
    canActivatePromotion,
    getPromotionStatus,
    getPublicPromotionPayload,
    calculateOnlineBookingPricing,
    validatePromotionUpdatePayload
  };
}
