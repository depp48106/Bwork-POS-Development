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
  deactivated_by: null
};

function parsePromotionState(raw) {
  if (!raw) return { ...DEFAULT_ONLINE_PROMOTION };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      ...DEFAULT_ONLINE_PROMOTION,
      ...parsed,
      promotion_code: 'ONLINE_5_PERCENT',
      discount_type: 'percent',
      discount_value: 5,
      channel: 'online',
      start_at: parsed.start_at || DEFAULT_ONLINE_PROMOTION.start_at,
      end_at: parsed.end_at !== undefined ? parsed.end_at : null,
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
    return {
      allowed: false,
      reason: 'ยังไม่ถึงเวลาเปิดใช้งานโปรโมชั่น (เปิดใช้งานได้ตั้งแต่ 13 ต.ค. 2026 เวลา 08:00)'
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
    discount_value: 5,
    start_at: promoState.start_at,
    end_at: promoState.end_at || null,
    channel: 'online'
  };
}

function calculateOnlineBookingPricing({ subtotal, promo, currentTime = Date.now() }) {
  const num = Number(subtotal);
  const cleanSubtotal = isNaN(num) ? 0 : Math.round((Math.max(0, num) + Number.EPSILON) * 100) / 100;
  const active = isPromotionActive(promo, currentTime, 'online');

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

  const rawDiscount = (cleanSubtotal * 5) / 100;
  const discountAmount = Math.round((rawDiscount + Number.EPSILON) * 100) / 100;
  const totalAmount = Math.round((Math.max(0, cleanSubtotal - discountAmount) + Number.EPSILON) * 100) / 100;

  return {
    subtotal_amount: cleanSubtotal,
    discount_type: 'percent',
    discount_value: 5,
    discount_amount: discountAmount,
    total_amount: totalAmount,
    is_promotion_applied: true
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_ONLINE_PROMOTION,
    parsePromotionState,
    resolveTimestampMs,
    isPromotionActive,
    canActivatePromotion,
    getPromotionStatus,
    getPublicPromotionPayload,
    calculateOnlineBookingPricing
  };
}
