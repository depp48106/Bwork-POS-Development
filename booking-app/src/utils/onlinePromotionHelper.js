/**
 * onlinePromotionHelper.js
 * Client-side Promotion Helper for BWORK-POS Online Booking
 */

export const DEFAULT_ONLINE_PROMOTION = {
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
    return {
      ...DEFAULT_ONLINE_PROMOTION,
      ...parsed,
      promotion_code: 'ONLINE_5_PERCENT',
      discount_type: 'percent',
      discount_value: 5,
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
