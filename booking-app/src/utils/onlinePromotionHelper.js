/**
 * onlinePromotionHelper.js
 * Client-side Promotion Helper for BWORK-POS Online Booking
 */

export const DEFAULT_ONLINE_PROMOTION = {
  promotion_name: 'โปรโมชั่นจองออนไลน์',
  promotion_code: 'ONLINE_5_PERCENT',
  discount_type: 'percent',
  discount_value: 5,
  channel: 'online',
  start_at: '2026-10-13T08:00:00+07:00',
  end_at: null,
  is_enabled: false,
  is_active: false
};

export function parsePromotionState(raw) {
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
      channel: 'online'
    };
  } catch (e) {
    return { ...DEFAULT_ONLINE_PROMOTION };
  }
}

export function isPromotionActive(promo, currentTime = Date.now(), channel = 'online') {
  if (channel !== 'online') return false;
  if (!promo) return false;
  // If backend already provided authoritative is_active flag in public response
  if (promo.is_active !== undefined) {
    return Boolean(promo.is_active);
  }
  const promoState = parsePromotionState(promo);
  if (!promoState.is_enabled) return false;
  const nowMs = typeof currentTime === 'number' ? currentTime : (currentTime instanceof Date ? currentTime.getTime() : Date.parse(currentTime));
  const startMs = Date.parse(promoState.start_at || DEFAULT_ONLINE_PROMOTION.start_at);
  if (isNaN(startMs) || nowMs < startMs) return false;
  if (promoState.end_at) {
    const endMs = Date.parse(promoState.end_at);
    if (!isNaN(endMs) && nowMs >= endMs) return false;
  }
  return true;
}

export function calculateOnlineBookingPricing({ subtotal, promo, currentTime = Date.now() }) {
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
