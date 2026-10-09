/**
 * onlinePromotionHelper.js
 * Admin & POS Promotion Helper for BWORK-POS
 */

export const DEFAULT_ONLINE_PROMOTION = {
  promotion_code: 'ONLINE_5_PERCENT',
  discount_type: 'percent',
  discount_value: 5,
  channel: 'online',
  start_at: '2026-10-13T08:00:00+07:00',
  end_at: null,
  is_enabled: false,
  activated_at: null,
  activated_by: null,
  deactivated_at: null,
  deactivated_by: null
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
      channel: 'online',
      start_at: parsed.start_at || DEFAULT_ONLINE_PROMOTION.start_at,
      end_at: parsed.end_at !== undefined ? parsed.end_at : null,
      is_enabled: Boolean(parsed.is_enabled)
    };
  } catch (e) {
    return { ...DEFAULT_ONLINE_PROMOTION };
  }
}

export function isPromotionActive(promo, currentTime = Date.now(), channel = 'online') {
  if (channel !== 'online') return false;
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

export function canActivatePromotion(promo, currentTime = Date.now()) {
  const promoState = parsePromotionState(promo);
  const nowMs = typeof currentTime === 'number' ? currentTime : (currentTime instanceof Date ? currentTime.getTime() : Date.parse(currentTime));
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

export function getPromotionStatus(promo, currentTime = Date.now()) {
  const promoState = parsePromotionState(promo);
  const nowMs = typeof currentTime === 'number' ? currentTime : (currentTime instanceof Date ? currentTime.getTime() : Date.parse(currentTime));
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
