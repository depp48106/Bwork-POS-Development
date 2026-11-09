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
      'ตรงต่อเวลา: เข้าและออกจากห้องประชุมตามเวลาที่จอง เพื่อไม่ให้กระทบผู้ใช้บริการรอบถัดไป',
      'รักษาความสะอาด: กรุณาช่วยกันรักษาความสะอาด และนำขยะทิ้งในจุดที่จัดเตรียมไว้',
      'งดนำสัตว์เลี้ยง สิ่งเสพติด และอาหารที่มีกลิ่นแรงเข้ามาภายในห้องประชุม',
      'ดูแลรักษาอุปกรณ์: ปิดไฟ เครื่องปรับอากาศ และอุปกรณ์ทุกครั้งหลังใช้งานเสร็จสิ้น'
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
      'ตรงต่อเวลา: เข้าและออกจากห้อง Jupiter Auditorium ตามเวลาที่ระบุในรายการจอง',
      'การใช้อุปกรณ์: ใช้งานระบบแสง สี เสียง และจอภาพตามคำแนะนำของเจ้าหน้าที่อย่างระมัดระวัง',
      'งดนำอาหารที่มีกลิ่นแรง สารเสพติด และเครื่องดื่มที่อาจทำให้เกิดความเสียหายเข้าห้อง',
      'ตรวจสอบความเรียบร้อยและปิดระบบอุปกรณ์ทุกครั้งก่อนส่งมอบห้อง'
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
