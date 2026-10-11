/**
 * bookingScheduleHelper.js
 * Pure presentation & scheduling transformation for BWORK-POS Booking Management.
 *
 * Supports:
 * - Single room on single date
 * - Multiple rooms on single date
 * - Same room on multiple dates
 * - Multiple rooms on multiple dates
 * - Same room with multiple time slots on same date
 * - Legitimate duplicate-looking items preserved with stable identity
 * - Safe Bangkok calendar date extraction without UTC date-shifting
 */
import { roomUsesDoorPin, isInternalBooking } from './doorPinHelper.js';

const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

const THAI_DAYS = [
  'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'
];

/**
 * Safely extracts canonical YYYY-MM-DD from an item's start_time or date string.
 * Strictly adheres to wall-clock date components to prevent UTC date-shifting.
 *
 * @param {string|Date} input
 * @returns {string} 'YYYY-MM-DD' or ''
 */
export function extractCanonicalDateKey(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (input instanceof Date && !isNaN(input.getTime())) {
    const y = input.getFullYear();
    const m = String(input.getMonth() + 1).padStart(2, '0');
    const d = String(input.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

/**
 * Formats a canonical YYYY-MM-DD date key into Thai Buddhist Era: e.g. "10 ต.ค. 2569"
 *
 * @param {string} dateKey - 'YYYY-MM-DD'
 * @returns {string}
 */
export function formatThaiDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return '-';
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(dateKey);

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) return String(dateKey);

  const thaiYear = year + 543;
  const monthStr = THAI_MONTH_SHORT[month - 1];
  return `${day} ${monthStr} ${thaiYear}`;
}

/**
 * Formats a canonical YYYY-MM-DD date key into full Thai Buddhist Era with weekday:
 * e.g. "วันเสาร์ที่ 10 ต.ค. 2569"
 *
 * @param {string} dateKey - 'YYYY-MM-DD'
 * @returns {string}
 */
export function formatThaiFullDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return '-';
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(dateKey);

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) return String(dateKey);

  const d = new Date(year, month - 1, day);
  const thaiYear = year + 543;
  const monthStr = THAI_MONTH_SHORT[month - 1];
  const weekday = !isNaN(d.getTime()) ? `วัน${THAI_DAYS[d.getDay()]}ที่ ` : '';

  return `${weekday}${day} ${monthStr} ${thaiYear}`;
}

/**
 * Extracts HH:mm string from timestamp or time string.
 *
 * @param {string} val
 * @returns {string} 'HH:mm' or ''
 */
export function extractTimeHHMM(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (str.includes('T')) {
    const timePart = str.split('T')[1];
    return timePart.substring(0, 5);
  }
  if (str.includes(' ')) {
    const parts = str.split(' ');
    const timePart = parts[1] || parts[0];
    if (timePart.includes(':')) return timePart.substring(0, 5);
  }
  if (str.includes(':')) {
    return str.substring(0, 5);
  }
  return '';
}

/**
 * Formats start and end times into standard slot label: e.g. "08:00 - 09:00 น."
 *
 * @param {string} startTime
 * @param {string} endTime
 * @returns {string}
 */
export function formatTimeSlot(startTime, endTime) {
  const s = extractTimeHHMM(startTime);
  const e = extractTimeHHMM(endTime);
  if (s && e) return `${s} - ${e} น.`;
  if (s) return `${s} น.`;
  return '-';
}

/**
 * Normalizes booking items into an array of booking item records.
 * If booking.items is non-empty, returns it directly without mutation.
 * If booking.items is missing or empty, synthesizes a single item from parent booking.
 *
 * @param {Object} booking
 * @returns {Array<Object>}
 */
export function normalizeBookingItems(booking) {
  if (!booking) return [];
  if (Array.isArray(booking.items) && booking.items.length > 0) {
    return booking.items;
  }

  // Synthesize single item fallback from booking metadata if available
  const hasSchedule = Boolean(
    booking.start_time ||
    booking.booking_date ||
    booking.room_id ||
    booking.room_name
  );

  if (!hasSchedule && !booking.id) return [];

  return [{
    id: booking.id ? `legacy_${booking.id}` : 'item_0',
    booking_id: booking.id,
    room_id: booking.room_id,
    room_name: booking.room_name,
    start_time: booking.start_time || (booking.booking_date ? `${booking.booking_date}T${booking.startTime || '08:00'}:00` : null),
    end_time: booking.end_time || (booking.booking_date ? `${booking.booking_date}T${booking.endTime || '17:00'}:00` : null),
    layout: booking.layout || 'standard',
    booking_type: booking.booking_type || 'hourly',
    guest_count: booking.guest_count,
    price: booking.total_amount || 0,
    subtotal: booking.subtotal_amount || booking.total_amount || 0,
    pin_code: booking.pin_code
  }];
}

/**
 * Groups booking items by usage date with summary metrics.
 * Pure transformation: never mutates booking or items.
 *
 * @param {Object} booking
 * @param {Array<Object>} roomsList
 * @returns {{
 *   summary: {
 *     totalItems: number,
 *     uniqueRoomCount: number,
 *     uniqueRoomsList: Array<string>,
 *     uniqueDateCount: number,
 *     dateRangeStr: string,
 *     isMultiDate: boolean,
 *     dateKeys: Array<string>
 *   },
 *   groups: Array<{
 *     dateKey: string,
 *     thaiDate: string,
 *     thaiFullDate: string,
 *     items: Array<Object>,
 *     subtotal: number,
 *     itemCount: number
 *   }>
 * }}
 */
export function groupBookingItemsByDate(booking, roomsList = []) {
  const items = normalizeBookingItems(booking);
  if (items.length === 0) {
    return {
      summary: {
        totalItems: 0,
        uniqueRoomCount: 0,
        uniqueRoomsList: [],
        uniqueDateCount: 0,
        dateRangeStr: '-',
        isMultiDate: false,
        dateKeys: []
      },
      groups: []
    };
  }

  // 1. Group items by canonical date key
  const groupsMap = new Map();
  items.forEach((it, originalIndex) => {
    const rawDate = it.start_time || it.booking_date || booking?.booking_date || booking?.created_at;
    const dateKey = extractCanonicalDateKey(rawDate) || 'no_date';

    if (!groupsMap.has(dateKey)) {
      groupsMap.set(dateKey, []);
    }
    groupsMap.get(dateKey).push({ item: it, originalIndex });
  });

  // 2. Sort date keys chronologically
  const dateKeys = Array.from(groupsMap.keys()).sort((a, b) => {
    if (a === 'no_date') return 1;
    if (b === 'no_date') return -1;
    return a.localeCompare(b);
  });

  // 3. Count unique rooms (count distinct authoritative room IDs; fallback to room names)
  const roomKeyMap = new Map();
  items.forEach(it => {
    const roomObj = roomsList?.find(r => r.id === it.room_id);
    const rName = it.room_name || roomObj?.name || (it.room_id ? `ห้อง #${it.room_id}` : (it.service_name || 'ห้องประชุม'));
    const rKey = it.room_id != null ? `id_${it.room_id}` : `name_${rName}`;
    if (!roomKeyMap.has(rKey)) {
      roomKeyMap.set(rKey, rName);
    }
  });

  const uniqueRoomsList = Array.from(roomKeyMap.values());
  const uniqueRoomCount = uniqueRoomsList.length;

  const validDateKeys = dateKeys.filter(k => k !== 'no_date');
  const uniqueDateCount = validDateKeys.length;
  const isMultiDate = uniqueDateCount > 1;

  let dateRangeStr = '-';
  if (uniqueDateCount === 1) {
    dateRangeStr = formatThaiDate(validDateKeys[0]);
  } else if (uniqueDateCount > 1) {
    const dStart = formatThaiDate(validDateKeys[0]);
    const dEnd = formatThaiDate(validDateKeys[validDateKeys.length - 1]);
    dateRangeStr = `${dStart} - ${dEnd} (${uniqueDateCount} วัน)`;
  }

  // 4. Construct sorted date groups
  const groups = dateKeys.map(dateKey => {
    const rawGroupEntries = groupsMap.get(dateKey);

    // Sort items within this date:
    // 1. start_time ASC
    // 2. room_name ASC
    // 3. originalIndex ASC
    const sortedGroupEntries = [...rawGroupEntries].sort((a, b) => {
      const timeA = extractTimeHHMM(a.item.start_time) || '99:99';
      const timeB = extractTimeHHMM(b.item.start_time) || '99:99';
      if (timeA !== timeB) return timeA.localeCompare(timeB);

      const nameA = String(a.item.room_name || a.item.service_name || '');
      const nameB = String(b.item.room_name || b.item.service_name || '');
      const nameDiff = nameA.localeCompare(nameB, 'th');
      if (nameDiff !== 0) return nameDiff;

      return a.originalIndex - b.originalIndex;
    });

    const groupItems = sortedGroupEntries.map(e => e.item);
    const groupSubtotal = groupItems.reduce((sum, it) => {
      const val = it.subtotal !== undefined && it.subtotal !== null
        ? Number(it.subtotal)
        : Number(it.price || 0);
      return sum + (isNaN(val) ? 0 : val);
    }, 0);

    return {
      dateKey,
      thaiDate: dateKey !== 'no_date' ? formatThaiDate(dateKey) : 'ไม่ระบุวันที่',
      thaiFullDate: dateKey !== 'no_date' ? formatThaiFullDate(dateKey) : 'ไม่ระบุวันที่',
      items: groupItems,
      subtotal: groupSubtotal,
      itemCount: groupItems.length
    };
  });

  return {
    summary: {
      totalItems: items.length,
      uniqueRoomCount,
      uniqueRoomsList,
      uniqueDateCount,
      dateRangeStr,
      isMultiDate,
      dateKeys: validDateKeys
    },
    groups
  };
}

/**
 * Resolves authoritative PIN information for an individual booking item card.
 *
 * Guaranteed Rules:
 * 1. If room does not use PIN (IDs 10, 12, 13 or matching No-PIN rules), returns { pin: '', pinType: 'none' }.
 * 2. Internal / Builtland bookings (isInternalBooking):
 *    - Priority 1: Room master builtland_pin_code
 *    - Priority 2: Room master pin_code fallback
 *    - Strictly ignores customer item pin_code snapshots.
 *    - Returns pinType: 'internal' if PIN found, else 'none'.
 * 3. General / Customer bookings:
 *    - Priority 1: Current item's valid pin_code snapshot (item.pin_code)
 *    - Priority 2: Parent booking-level pin_code fallback (booking.pin_code)
 *    - Priority 3: Room master pin_code fallback (room.pin_code, never builtland_pin_code)
 *    - CRITICAL: Never searches or falls back to another item's pin_code snapshot.
 *    - Returns pinType: 'general' if PIN found, else 'none'.
 *
 * @param {Object} booking - Booking parent object
 * @param {Object} item - Specific booking item object
 * @param {Object|null} room - Room master object
 * @returns {{ pin: string, pinType: 'general'|'internal'|'none' }}
 */
export function resolveBookingItemPinInfo(booking, item, room = null) {
  const targetRoom = room || (item?.room_id != null ? { id: item.room_id, name: item?.room_name } : (item || null));
  if (!targetRoom || !roomUsesDoorPin(targetRoom)) {
    return { pin: '', pinType: 'none' };
  }

  const isInternal = isInternalBooking(booking);
  if (isInternal) {
    if (room?.builtland_pin_code && String(room.builtland_pin_code).trim() && String(room.builtland_pin_code).trim() !== '-') {
      return { pin: String(room.builtland_pin_code).trim(), pinType: 'internal' };
    }
    if (room?.pin_code && String(room.pin_code).trim() && String(room.pin_code).trim() !== '-') {
      return { pin: String(room.pin_code).trim(), pinType: 'internal' };
    }
    return { pin: '', pinType: 'none' };
  }

  // General booking:
  // 1. Current item's own authoritative snapshot
  if (item?.pin_code && String(item.pin_code).trim() && String(item.pin_code).trim() !== '-') {
    return { pin: String(item.pin_code).trim(), pinType: 'general' };
  }

  // 2. Booking-level pin_code fallback
  if (booking?.pin_code && String(booking.pin_code).trim() && String(booking.pin_code).trim() !== '-') {
    return { pin: String(booking.pin_code).trim(), pinType: 'general' };
  }

  // 3. Room master pin_code fallback (strictly room.pin_code, NEVER builtland_pin_code)
  if (room?.pin_code && String(room.pin_code).trim() && String(room.pin_code).trim() !== '-') {
    return { pin: String(room.pin_code).trim(), pinType: 'general' };
  }

  return { pin: '', pinType: 'none' };
}

/**
 * Formats multiple canonical YYYY-MM-DD date keys into compact Thai Buddhist Era strings.
 *
 * Rules:
 * - 0 dates: '-'
 * - 1 date: '15 ต.ค. 2569'
 * - 2-3 dates:
 *   - Same month & year: '15, 17 ต.ค. 2569' or '15, 17, 19 ต.ค. 2569'
 *   - Different month, same year: '31 ต.ค., 2 พ.ย. 2569'
 *   - Different years: '31 ธ.ค. 2569, 2 ม.ค. 2570'
 * - 4+ dates:
 *   - Boundary range:
 *   - Same month & year: '15 - 20 ต.ค. 2569 (4 วัน)'
 *   - Different month, same year: '15 ต.ค. - 5 พ.ย. 2569 (4 วัน)'
 *   - Different years: '25 ธ.ค. 2569 - 5 ม.ค. 2570 (4 วัน)'
 *
 * @param {Array<string>} dateKeys - Sorted canonical date keys ['YYYY-MM-DD', ...]
 * @returns {string}
 */
export function formatMultiDatesThai(dateKeys) {
  const validKeys = (dateKeys || []).filter(k => k && k !== 'no_date' && /^\d{4}-\d{2}-\d{2}/.test(String(k)));
  if (validKeys.length === 0) return '-';
  if (validKeys.length === 1) {
    return formatThaiDate(validKeys[0]);
  }

  const parsed = validKeys.map(dk => {
    const m = String(dk).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    const thaiYear = y + 543;
    const monthStr = THAI_MONTH_SHORT[month - 1] || '';
    return { y, m: month, d, thaiYear, monthStr };
  }).filter(Boolean);

  if (parsed.length === 0) return '-';
  const count = parsed.length;

  if (count <= 3) {
    const allSameYear = parsed.every(p => p.y === parsed[0].y);
    const allSameMonth = allSameYear && parsed.every(p => p.m === parsed[0].m);
    if (allSameMonth) {
      const days = parsed.map(p => p.d).join(', ');
      return `${days} ${parsed[0].monthStr} ${parsed[0].thaiYear}`;
    }
    if (allSameYear) {
      return parsed.map(p => `${p.d} ${p.monthStr}`).join(', ') + ` ${parsed[0].thaiYear}`;
    }
    return parsed.map(p => `${p.d} ${p.monthStr} ${p.thaiYear}`).join(', ');
  }

  // 4 or more dates: boundary range
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  if (first.y === last.y && first.m === last.m) {
    return `${first.d} - ${last.d} ${first.monthStr} ${first.thaiYear} (${count} วัน)`;
  }
  if (first.y === last.y) {
    return `${first.d} ${first.monthStr} - ${last.d} ${last.monthStr} ${first.thaiYear} (${count} วัน)`;
  }
  return `${first.d} ${first.monthStr} ${first.thaiYear} - ${last.d} ${last.monthStr} ${last.thaiYear} (${count} วัน)`;
}

/**
 * Computes compact adaptive summary data for the main table "Room & Usage Time" column.
 *
 * Cases:
 * - CASE A (Single item): Preserve compact standard view (Room, Date, Exact Time, Layout/Type).
 * - CASE B (Same room, same date, multiple slots): One room, one date, "N ช่วงเวลา" (badges).
 * - CASE C (Same room, multiple dates): One room, listed dates / range, badges (1 ห้อง, N วัน, N รายการ).
 * - CASE D (Multiple rooms, same date): First 2 rooms (+N), one date, badges (N ห้อง, N รายการ).
 * - CASE E (Multiple rooms, multiple dates): First 2 rooms (+N), dates, badges (N ห้อง, N วัน, N รายการ).
 *
 * @param {Object} booking - Booking record
 * @param {Array<Object>} roomsList - Master rooms catalog
 * @returns {Object} Table summary view model
 */
export function getBookingTableSummary(booking, roomsList = []) {
  const scheduleData = groupBookingItemsByDate(booking, roomsList);
  const { summary, groups } = scheduleData;
  const { totalItems, uniqueRoomCount, uniqueRoomsList, uniqueDateCount, dateKeys } = summary;

  // Case A: 0 or 1 item
  if (totalItems <= 1) {
    const rawItems = Array.isArray(booking?.items) && booking.items.length > 0
      ? booking.items
      : normalizeBookingItems(booking);
    const firstItem = rawItems[0] || {};
    const roomObj = roomsList?.find(r => r.id === (firstItem.room_id || booking?.room_id));
    const roomName = firstItem.room_name || booking?.room_name || roomObj?.name || (firstItem.room_id ? `ห้อง #${firstItem.room_id}` : (firstItem.service_name || 'ห้องประชุม'));
    const rawDate = firstItem.start_time || firstItem.booking_date || booking?.booking_date || booking?.created_at;
    const dateKey = extractCanonicalDateKey(rawDate);
    const usageDateStr = formatThaiDate(dateKey);
    const timeDisplay = formatTimeSlot(firstItem.start_time, firstItem.end_time);
    const layoutLabel = firstItem.layout === 'classroom' ? 'Classroom' : 'Standard';
    const typeLabel = firstItem.booking_type === 'daily'
      ? 'เหมาวัน'
      : (firstItem.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง');

    return {
      caseType: 'single', // Case A
      isMultiItem: false,
      totalItems,
      uniqueRoomCount: uniqueRoomCount || (roomName ? 1 : 0),
      uniqueDateCount: uniqueDateCount || (dateKey ? 1 : 0),
      roomName,
      roomDisplay: roomName,
      displayedRooms: roomName,
      extraRoomCount: 0,
      fullRoomNamesTitle: roomName,
      uniqueRoomsList: uniqueRoomsList.length > 0 ? uniqueRoomsList : [roomName],
      usageDateStr,
      timeDisplay,
      layoutLabel,
      typeLabel,
      badges: [],
      hasCustomSummary: false
    };
  }

  // Multi-item cases: B, C, D, E
  const fullRoomNamesTitle = uniqueRoomsList.join(', ');
  const displayedRooms = uniqueRoomsList.slice(0, 2).join(', ');
  const extraRoomCount = Math.max(0, uniqueRoomCount - 2);
  const roomDisplay = extraRoomCount > 0 ? `${displayedRooms} +${extraRoomCount}` : displayedRooms;
  const multiDateStr = formatMultiDatesThai(dateKeys);

  // Case B: Same Room, Same Date, Multiple slots
  if (uniqueRoomCount === 1 && uniqueDateCount === 1) {
    const singleDateStr = formatThaiDate(dateKeys[0]);
    const firstItem = groups[0]?.items?.[0] || {};
    const layoutLabel = firstItem.layout === 'classroom' ? 'Classroom' : 'Standard';
    const typeLabel = firstItem.booking_type === 'daily'
      ? 'เหมาวัน'
      : (firstItem.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง');

    return {
      caseType: 'same_room_same_date', // Case B
      isMultiItem: true,
      totalItems,
      uniqueRoomCount: 1,
      uniqueDateCount: 1,
      roomName: uniqueRoomsList[0] || 'ห้องประชุม',
      roomDisplay: uniqueRoomsList[0] || 'ห้องประชุม',
      displayedRooms: uniqueRoomsList[0] || 'ห้องประชุม',
      extraRoomCount: 0,
      fullRoomNamesTitle: uniqueRoomsList[0] || 'ห้องประชุม',
      uniqueRoomsList,
      usageDateStr: singleDateStr,
      timeDisplay: `${totalItems} ช่วงเวลา`,
      layoutLabel,
      typeLabel,
      badges: [`${totalItems} ช่วงเวลา`, `${totalItems} รายการ`],
      hasCustomSummary: true
    };
  }

  // Case C: Same Room, Multiple Dates
  if (uniqueRoomCount === 1 && uniqueDateCount > 1) {
    return {
      caseType: 'same_room_multi_date', // Case C
      isMultiItem: true,
      totalItems,
      uniqueRoomCount: 1,
      uniqueDateCount,
      roomName: uniqueRoomsList[0] || 'ห้องประชุม',
      roomDisplay: uniqueRoomsList[0] || 'ห้องประชุม',
      displayedRooms: uniqueRoomsList[0] || 'ห้องประชุม',
      extraRoomCount: 0,
      fullRoomNamesTitle: uniqueRoomsList[0] || 'ห้องประชุม',
      uniqueRoomsList,
      usageDateStr: multiDateStr,
      timeDisplay: '',
      badges: ['1 ห้อง', `${uniqueDateCount} วัน`, `${totalItems} รายการ`],
      hasCustomSummary: true
    };
  }

  // Case D: Multiple Rooms, Same Date
  if (uniqueRoomCount > 1 && uniqueDateCount === 1) {
    const singleDateStr = formatThaiDate(dateKeys[0]);
    return {
      caseType: 'multi_room_same_date', // Case D
      isMultiItem: true,
      totalItems,
      uniqueRoomCount,
      uniqueDateCount: 1,
      roomName: roomDisplay,
      roomDisplay,
      displayedRooms,
      extraRoomCount,
      fullRoomNamesTitle,
      uniqueRoomsList,
      usageDateStr: singleDateStr,
      timeDisplay: '',
      badges: [`${uniqueRoomCount} ห้อง`, `${totalItems} รายการ`],
      hasCustomSummary: true
    };
  }

  // Case E: Multiple Rooms, Multiple Dates
  return {
    caseType: 'multi_room_multi_date', // Case E
    isMultiItem: true,
    totalItems,
    uniqueRoomCount,
    uniqueDateCount,
    roomName: roomDisplay,
    roomDisplay,
    displayedRooms,
    extraRoomCount,
    fullRoomNamesTitle,
    uniqueRoomsList,
    usageDateStr: multiDateStr,
    timeDisplay: '',
    badges: [`${uniqueRoomCount} ห้อง`, `${uniqueDateCount} วัน`, `${totalItems} รายการ`],
    hasCustomSummary: true
  };
}
