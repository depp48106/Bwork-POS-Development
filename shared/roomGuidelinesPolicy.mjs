/**
 * shared/roomGuidelinesPolicy.mjs
 *
 * Single Source of Truth for Room Guidelines Policy, Versions, and LINE OA messages.
 */

export const ROOM_GUIDELINES_VERSIONS = {
  MEETING_ROOM: 'v1',
  JUPITER: 'v1'
};

export const GUIDELINES_CUTOVER_ISO = '2026-11-09T00:00:00.000Z';

export const ROOM_GUIDELINES_CONFIG = {
  meeting_room_201_306: {
    rule_set: 'meeting_room_201_306',
    rule_version: ROOM_GUIDELINES_VERSIONS.MEETING_ROOM,
    title: 'ข้อปฏิบัติการใช้ห้องประชุม (201, 301-306)',
    line_title: 'ข้อปฏิบัติการใช้ห้องประชุม (201, 301-306)',
    image_url: 'https://bwork-booking.pages.dev/rules/room301-306.png',
    local_image_src: '/rules/room301-306.png',
    summary_points: [
      'การใช้ห้องเกินเวลา: หากใช้ห้องเกินเวลาที่จองไว้มากกว่า 15 นาที คิดค่าบริการเพิ่ม 1 ชั่วโมง ตามอัตราของห้องนั้น ๆ',
      'อาหารและเครื่องดื่ม: ไม่อนุญาตให้นำอาหารเข้ามารับประทานในห้องประชุม ยกเว้นเครื่องดื่มและเบเกอรี่ หากฝ่าฝืน บริษัทขอสงวนสิทธิ์ยุติการให้บริการทันที โดยไม่คืนเงินทุกกรณี',
      'การรักษาความสะอาด: กรุณารักษาความสะอาดและจัดเก็บพื้นที่หลังใช้งานให้เรียบร้อย',
      'ความเสียหายและทรัพย์สินส่วนตัว: ผู้ใช้บริการต้องรับผิดชอบความเสียหายต่ออุปกรณ์ที่เกิดจากการใช้งานผิดประเภท หรือความประมาท บริษัทไม่รับผิดชอบต่อทรัพย์สินส่วนตัวที่สูญหาย'
    ]
  },
  jupiter_auditorium: {
    rule_set: 'jupiter_auditorium',
    rule_version: ROOM_GUIDELINES_VERSIONS.JUPITER,
    title: 'ข้อปฏิบัติการใช้ห้อง Jupiter Auditorium',
    line_title: 'ข้อปฏิบัติการใช้ห้อง Jupiter Auditorium',
    image_url: 'https://bwork-booking.pages.dev/rules/jupiter.jpg',
    local_image_src: '/rules/jupiter.jpg',
    summary_points: [
      'การใช้ห้องเกินเวลา: กรุณาใช้ห้องประชุมตามเวลาที่จองไว้ หากเกินกว่า 15 นาที คิดค่าบริการเพิ่ม 1 ชั่วโมง (เศษเวลานับเป็น 1 ชั่วโมง)',
      'อาหารและเครื่องดื่ม: ไม่อนุญาตให้นำอาหารเข้ามารับประทานภายในห้องประชุม (ยกเว้นเครื่องดื่มและเบรกที่จัดเตรียมไว้)',
      'การรักษาความสะอาด: ขอความกรุณาช่วยรักษาความสะอาด และดูแลความเรียบร้อยภายในพื้นที่เข้าใช้งาน',
      'ความเสียหายและทรัพย์สิน: หากอุปกรณ์ภายในห้องเกิดความเสียหายจากการติดตั้ง สูญหาย ตกหล่น ใช้งานผิดวิธี หรือเกิดจากความประมาท ผู้ใช้บริการต้องรับผิดชอบค่าเสียหาย และบริษัทไม่รับผิดชอบต่อทรัพย์สินส่วนตัวที่สูญหาย'
    ]
  }
};

const ROOM_301_IDS = [4, 5, 6, 7, 8, 9, 11]; // Mars, Mercury, Saturn, Venus, Uranus, Neptune, Pluto (201)
const ROOM_301_REGEX = /\b(201|30[1-6])\b/;

/**
 * Resolves guidelines metadata based on roomId and roomName.
 * @param {number|string|null} rawRoomId 
 * @param {string|null} rawRoomName 
 * @returns {object} Guidelines policy object or required: false
 */
export function resolveRoomGuidelines(rawRoomId, rawRoomName) {
  const roomId = rawRoomId !== undefined && rawRoomId !== null && rawRoomId !== '' ? Number(rawRoomId) : null;
  const roomName = String(rawRoomName || '').trim().toLowerCase();

  // 1. Jupiter Auditorium (ID 10, 12 or name containing 'jupiter')
  if (roomId === 10 || roomId === 12 || roomName.includes('jupiter')) {
    return {
      required: true,
      ...ROOM_GUIDELINES_CONFIG.jupiter_auditorium
    };
  }

  // 2. Room 201 and 301-306 (IDs 4, 5, 6, 7, 8, 9, 11 or regex match)
  if ((roomId !== null && ROOM_301_IDS.includes(roomId)) || ROOM_301_REGEX.test(roomName)) {
    return {
      required: true,
      ...ROOM_GUIDELINES_CONFIG.meeting_room_201_306
    };
  }

  // 3. Unmapped / non-meeting room (e.g. Co-working zone ID 13)
  return {
    required: false,
    rule_set: null,
    rule_version: null,
    title: null,
    image_url: null,
    local_image_src: null,
    summary_points: []
  };
}

/**
 * Evaluates whether room guidelines enforcement gate should block a booking.
 * Single source of truth for API, Worker, and Web frontend.
 *
 * Requirements:
 * - Setting toggle: guidelines_enforcement_enabled (must be explicitly true)
 * - Room requirement: Room must map to a guidelines rule set (exempt rooms e.g. Co-working are never enforced)
 * - Legacy booking support: Bookings created before cutoverAt are never blocked
 *
 * @param {object} params
 * @param {object} params.guidelinesPolicy - Result of resolveRoomGuidelines(roomId, roomName)
 * @param {boolean|string} [params.enforcementSetting] - Value of 'guidelines_enforcement_enabled'
 * @param {string|number|Date} [params.cutoverAt] - ISO timestamp or ms threshold (default GUIDELINES_CUTOVER_ISO)
 * @param {string|number|Date} [params.bookingCreatedAt] - Created timestamp of booking
 * @returns {boolean} True if enforcement is active and blocks unacknowledged bookings
 */
export function isGuidelinesEnforcedForBooking({
  guidelinesPolicy,
  enforcementSetting,
  cutoverAt = GUIDELINES_CUTOVER_ISO,
  bookingCreatedAt
}) {
  if (!guidelinesPolicy || !guidelinesPolicy.required) {
    return false;
  }

  const isEnabled = enforcementSetting === true || enforcementSetting === 'true' || enforcementSetting === 1 || enforcementSetting === '1';
  if (!isEnabled) {
    return false;
  }

  if (cutoverAt && bookingCreatedAt) {
    const cutoverMs = typeof cutoverAt === 'number' ? cutoverAt : new Date(cutoverAt).getTime();
    const createdMs = typeof bookingCreatedAt === 'number' ? bookingCreatedAt : new Date(bookingCreatedAt).getTime();
    if (!isNaN(cutoverMs) && !isNaN(createdMs) && createdMs < cutoverMs) {
      return false;
    }
  }

  return true;
}

/**
 * Validates whether a LINE user ID is syntactically valid.
 * Must be a string starting with 'U' with length >= 10.
 *
 * @param {string} lineUserId 
 * @returns {boolean}
 */
export function isBoundLineUserId(lineUserId) {
  if (typeof lineUserId !== 'string') return false;
  const trimmed = lineUserId.trim();
  return trimmed.startsWith('U') && trimmed.length >= 10;
}

/**
 * Evaluates whether a LINE user ID is server-confirmed as bound to the customer.
 * NEVER trust an unverified client-supplied ID as evidence of account binding.
 *
 * @param {object} params
 * @param {string} params.lineUserId - The candidate LINE user ID
 * @param {boolean|number|string} [params.isVerified] - Explicit server verification flag
 * @param {string} [params.verifiedTokenUserId] - LINE user ID verified via ID token (LIFF)
 * @param {string} [params.bookingSource] - Booking creation source ('online', 'walkin', 'pos', etc.)
 * @returns {boolean} True if confirmed by server
 */
export function isServerConfirmedLineBinding({
  lineUserId,
  isVerified,
  verifiedTokenUserId,
  bookingSource
} = {}) {
  if (!isBoundLineUserId(lineUserId)) {
    return false;
  }

  // 1. Cryptographically verified via LINE ID token matching this user ID
  if (verifiedTokenUserId && verifiedTokenUserId.trim() === lineUserId.trim()) {
    return true;
  }

  // 2. Explicit server-side verification flag in database (e.g. line_user_id_verified = 1)
  if (isVerified === true || isVerified === 1 || isVerified === '1' || isVerified === 'true') {
    return true;
  }

  // 3. Back-office / POS staff binding (not untrusted public online form)
  if (bookingSource && bookingSource !== 'online' && isVerified !== false && isVerified !== 0 && isVerified !== '0') {
    return true;
  }

  return false;
}

/**
 * Builds standard LINE OA message text for room guidelines.
 * Requirement format:
 * ข้อความขึ้นต้น “ข้อปฏิบัติการใช้ห้อง…” ตามด้วย
 * “กรุณาอ่านข้อปฏิบัติก่อนเข้าใช้บริการ BWORK” พร้อมลิงก์อ่านกฎฉบับเต็ม
 *
 * @param {object} guidelinesConfig - Policy object from resolveRoomGuidelines or ROOM_GUIDELINES_CONFIG
 * @returns {string} Text message to send via LINE
 */
export function buildLineGuidelinesMessage(guidelinesConfig) {
  const title = guidelinesConfig?.line_title || guidelinesConfig?.title || 'ข้อปฏิบัติการใช้ห้องประชุม';
  const fullUrl = guidelinesConfig?.image_url || 'https://bwork-booking.pages.dev/rules/room301-306.png';

  return `${title}\nกรุณาอ่านข้อปฏิบัติก่อนเข้าใช้บริการ BWORK\n\nอ่านข้อปฏิบัติฉบับเต็ม:\n${fullUrl}`;
}
