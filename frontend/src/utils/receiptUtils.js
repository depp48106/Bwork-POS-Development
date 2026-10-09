/**
 * receiptUtils.js
 * Pure presentation & normalization utility for BWORK-POS Receipts.
 *
 * Primary Business Rule:
 * 1 BOOKING = 1 CONSOLIDATED RECEIPT
 *
 * Supports:
 * - Single item / single day (compact)
 * - Same room, multiple days
 * - Same room, multiple time slots
 * - Multi-room, same day
 * - Multi-day, multi-room
 * - Service add-on items
 * - Authoritative total preservation with explicit price adjustment rows
 * - Internal free (Builtland / staff quota)
 */

import { normalizeBookingFinancials } from './financialUtils.js';

export const ROOM_NAME_MAP = {
  4: 'Mars (301)',
  5: 'Mercury (302)',
  6: 'Saturn (303)',
  7: 'Venus (304)',
  8: 'Uranus (305)',
  9: 'Neptune (306)',
  10: 'Jupiter (300)',
  11: 'Pluto (201)',
  12: 'Jupiter (300) & Co-Working',
  13: 'เหมาโซน Co-working'
};

const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

const THAI_DAYS = [
  'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'
];

/**
 * Safely parse wall-clock local date strings without UTC shifting.
 * Supports: '2026-09-23T09:00:00', '2026-09-23 09:00:00', '2026-09-23', or Date objects.
 */
export function parseReceiptLocalDate(input) {
  if (!input) return null;
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input;
  }
  const str = String(input).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = match[4] !== undefined ? parseInt(match[4], 10) : 0;
    const minute = match[5] !== undefined ? parseInt(match[5], 10) : 0;
    const second = match[6] !== undefined ? parseInt(match[6], 10) : 0;
    const d = new Date(year, month, day, hour, minute, second);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Extracts YYYY-MM-DD date key from a date/timestamp string or Date.
 */
export function extractDateKey(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    const match = input.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const d = parseReceiptLocalDate(input);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formats date into Thai Buddhist Era (BE): e.g. "23 ก.ย. 2569" or "วันพุธที่ 23 ก.ย. 2569"
 */
export function formatReceiptDateThai(input, options = {}) {
  const d = parseReceiptLocalDate(input);
  if (!d) return String(input || '-');
  const day = d.getDate();
  const month = THAI_MONTH_SHORT[d.getMonth()];
  const thaiYear = d.getFullYear() + 543;
  if (options.weekday) {
    const weekdayName = THAI_DAYS[d.getDay()];
    return `วัน${weekdayName}ที่ ${day} ${month} ${thaiYear}`;
  }
  return `${day} ${month} ${thaiYear}`;
}

/**
 * Formats time as HH:mm
 */
export function formatReceiptTime(input) {
  const d = parseReceiptLocalDate(input);
  if (!d) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Formats time range: e.g. "09:00 - 12:00 น."
 */
export function formatReceiptPeriod(startTime, endTime) {
  if (!startTime && !endTime) return '';
  const sStr = formatReceiptTime(startTime);
  const eStr = formatReceiptTime(endTime);
  if (sStr && eStr) return `${sStr} - ${eStr} น.`;
  if (sStr) return `ตั้งแต่ ${sStr} น.`;
  return '';
}

/**
 * Calculates hour duration from start and end time.
 */
export function calculateHourDuration(startTime, endTime) {
  const s = parseReceiptLocalDate(startTime);
  const e = parseReceiptLocalDate(endTime);
  if (!s || !e) return null;
  const diffMs = e.getTime() - s.getTime();
  if (diffMs <= 0) return null;
  return Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10;
}

/**
 * Normalizes a single booking item into a structured receipt item.
 */
export function normalizeReceiptItem(item = {}, booking = {}, index = 0) {
  // Classification: service identity takes precedence over generic SQLite schema defaults (layout='standard', booking_type='hourly')
  const hasServiceIdentity = Boolean(item.service_id || item.service_name);
  const hasRoomIdentity = Boolean(item.room_id || item.room_name);

  let isRoom = false;
  if (hasServiceIdentity && !item.room_id) {
    // Pure service or explicit service item
    isRoom = false;
  } else if (hasRoomIdentity) {
    // Explicit room item
    isRoom = true;
  } else if (!hasServiceIdentity && (item.start_time || booking.room_id || booking.room_name || booking.room?.name)) {
    // Legacy fallback: no service identity, but start_time or booking-level room metadata present
    isRoom = true;
  }

  const rId = item.room_id || booking.room_id || booking.room?.id;
  const fallbackRoomName = ROOM_NAME_MAP[rId] || ROOM_NAME_MAP[Number(rId)] || 'ห้องประชุม';

  let rawRoomName = item.room_name || item.name || item.room_title || item.room?.name || booking.room_name || booking.room?.name || fallbackRoomName;
  let serviceName = item.service_name || item.name || 'รายการบริการ';

  // Layout & Classroom detection
  const layout = item.layout || booking.layout || 'standard';
  const isClassroom = isRoom && layout === 'classroom';
  if (isRoom && isClassroom && !rawRoomName.toLowerCase().includes('classroom')) {
    rawRoomName = `${rawRoomName} (Classroom)`;
  }

  // Booking Type: hourly, halfday, daily, or service
  let bookingType = item.booking_type || (isRoom ? (booking.booking_type || 'hourly') : 'service');
  // Avoid fragile heuristics: only default to hourly if missing on a room item
  if (isRoom && !['hourly', 'halfday', 'daily'].includes(bookingType)) {
    bookingType = 'hourly';
  } else if (!isRoom) {
    bookingType = 'service';
  }

  // Timestamps
  const startTime = item.start_time || (isRoom && booking.booking_date ? `${booking.booking_date}T${booking.startTime || '08:00'}:00` : null);
  const endTime = item.end_time || (isRoom && booking.booking_date ? `${booking.booking_date}T${booking.endTime || '17:00'}:00` : null);
  const dateKey = extractDateKey(startTime || (isRoom ? (item.booking_date || booking.booking_date || booking.created_at) : (item.booking_date || null)));
  const timePeriod = isRoom && startTime ? formatReceiptPeriod(startTime, endTime) : '';

  // Quantity & Duration
  let quantity = Number(item.quantity);
  if (!quantity || quantity <= 0) {
    if (isRoom && bookingType === 'hourly' && startTime && endTime) {
      const computedHours = calculateHourDuration(startTime, endTime);
      quantity = computedHours || 1;
    } else {
      quantity = 1;
    }
  }

  // Pricing & Subtotal derivation
  // Priority: explicit item.subtotal -> item.amount -> quantity * price -> item.price
  let subtotal = 0;
  if (item.subtotal !== undefined && item.subtotal !== null && item.subtotal !== '') {
    subtotal = Number(item.subtotal) || 0;
  } else if (item.amount !== undefined && item.amount !== null && item.amount !== '') {
    subtotal = Number(item.amount) || 0;
  } else if (item.price !== undefined && item.price !== null) {
    subtotal = Number(item.price) * quantity;
  }

  const unitPrice = (item.price !== undefined && item.price !== null)
    ? Number(item.price)
    : (quantity > 0 ? subtotal / quantity : subtotal);

  // Type & Duration Labels
  let typeLabel = '';
  let durationLabel = '';
  if (isRoom) {
    if (bookingType === 'daily') {
      typeLabel = 'เหมาวัน (Daily)';
      durationLabel = `${quantity} วัน`;
    } else if (bookingType === 'halfday') {
      typeLabel = 'เหมาครึ่งวัน (Half-day)';
      durationLabel = `${quantity} ช่วง (ครึ่งวัน)`;
    } else {
      typeLabel = 'รายชั่วโมง (Hourly)';
      durationLabel = `${quantity} ชม.`;
    }
  } else {
    typeLabel = 'บริการเสริม';
    durationLabel = `x${quantity}`;
  }

  const displayName = isRoom ? rawRoomName : serviceName;

  // Clean discount artifacts from display name if previously appended
  let cleanName = displayName;
  let detailText = isRoom
    ? (item.room_description || item.description || booking.room_description || '')
    : (item.service_description || item.description || item.detail || item.notes || '');

  if (displayName.includes(' (ส่วนลด')) {
    const parts = displayName.split(' (ส่วนลด');
    cleanName = parts[0];
    if (!detailText) detailText = '(ส่วนลด' + parts[1];
  } else if (displayName.includes('(ส่วนลด')) {
    const parts = displayName.split('(ส่วนลด');
    cleanName = parts[0].trim();
    if (!detailText) detailText = '(ส่วนลด' + parts[1];
  }

  const safeRawItem = { ...item };
  for (const k of Object.keys(safeRawItem)) {
    if (k.toLowerCase().includes('pin')) {
      delete safeRawItem[k];
    }
  }

  return {
    id: item.id || item.booking_item_id || `item-${index}`,
    rawItem: safeRawItem,
    isRoom,
    displayName: cleanName,
    detailText,
    layout,
    isClassroom,
    bookingType,
    typeLabel,
    durationLabel,
    startTime,
    endTime,
    dateKey,
    startTimeStr: startTime ? formatReceiptTime(startTime) : '',
    timePeriod,
    quantity,
    unitPrice,
    subtotal: Math.round(subtotal * 100) / 100,
    guestCount: item.guest_count || null
  };
}

/**
 * Sorts normalized receipt items chronologically:
 * 1. Usage Date ASC (YYYY-MM-DD)
 * 2. Start Time ASC (HH:mm)
 * 3. Stable tie-break by room/service display name
 * 4. Stable tie-break by item ID
 */
export function sortReceiptItems(items = []) {
  return [...items].sort((a, b) => {
    // 1. Date comparison
    const dateA = a.dateKey || '9999-99-99';
    const dateB = b.dateKey || '9999-99-99';
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }

    // 2. Start time comparison (Room items first)
    if (a.isRoom && !b.isRoom) return -1;
    if (!a.isRoom && b.isRoom) return 1;

    const timeA = a.startTimeStr || '99:99';
    const timeB = b.startTimeStr || '99:99';
    if (timeA !== timeB) {
      return timeA.localeCompare(timeB);
    }

    // 3. Name comparison
    const nameDiff = (a.displayName || '').localeCompare(b.displayName || '', 'th');
    if (nameDiff !== 0) return nameDiff;

    // 4. Fallback ID
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Groups items by usage date.
 * If all items are on the same single date, returns isMultiDate: false
 * so that single-day receipts stay clean and compact without redundant headers.
 */
export function groupReceiptItemsByDate(sortedItems = []) {
  if (sortedItems.length === 0) {
    return { isMultiDate: false, dateCount: 0, groups: [] };
  }

  // Count distinct non-empty dates among room items
  const roomDates = new Set(sortedItems.filter(it => it.isRoom && it.dateKey).map(it => it.dateKey));
  const isMultiDate = roomDates.size > 1;

  if (!isMultiDate) {
    // Single day receipt: single group, no multi-date header banner needed
    return {
      isMultiDate: false,
      dateCount: roomDates.size,
      groups: [
        {
          dateKey: roomDates.size === 1 ? Array.from(roomDates)[0] : (sortedItems[0]?.dateKey || ''),
          thaiDate: roomDates.size === 1 ? formatReceiptDateThai(Array.from(roomDates)[0]) : '',
          thaiFullDate: roomDates.size === 1 ? formatReceiptDateThai(Array.from(roomDates)[0], { weekday: true }) : '',
          items: sortedItems
        }
      ]
    };
  }

  // Multi-day receipt: group by date
  const groupsMap = new Map();
  const serviceItemsWithoutDate = [];

  for (const item of sortedItems) {
    if (!item.dateKey) {
      serviceItemsWithoutDate.push(item);
      continue;
    }
    if (!groupsMap.has(item.dateKey)) {
      groupsMap.set(item.dateKey, {
        dateKey: item.dateKey,
        thaiDate: formatReceiptDateThai(item.dateKey),
        thaiFullDate: formatReceiptDateThai(item.dateKey, { weekday: true }),
        items: []
      });
    }
    groupsMap.get(item.dateKey).items.push(item);
  }

  const groups = Array.from(groupsMap.values());

  // If there are general undated services, attach them to the last date group or create a separate group
  if (serviceItemsWithoutDate.length > 0) {
    if (groups.length > 0) {
      groups[groups.length - 1].items.push(...serviceItemsWithoutDate);
    } else {
      groups.push({
        dateKey: '',
        thaiDate: 'รายการบริการเสริม',
        thaiFullDate: 'รายการบริการเสริม',
        items: serviceItemsWithoutDate
      });
    }
  }

  return {
    isMultiDate: true,
    dateCount: roomDates.size,
    groups
  };
}

/**
 * Normalizes all items from a booking object and returns sorted and grouped results.
 */
export function normalizeBookingReceipt(booking = {}) {
  const rawItems = Array.isArray(booking.items) ? booking.items : [];
  let itemsToNormalize = [...rawItems];

  // Fallback: If booking.items is empty, synthesize 1 item from root booking attributes
  if (itemsToNormalize.length === 0 && (booking.room_id || booking.room_name || booking.room)) {
    const rootTotal = Number(booking.total_amount ?? booking.totalAmount ?? 0);
    const startTimeStr = booking.start_time || (booking.booking_date ? `${booking.booking_date}T${booking.startTime || '08:00'}:00` : null);
    const endTimeStr = booking.end_time || (booking.booking_date ? `${booking.booking_date}T${booking.endTime || '17:00'}:00` : null);
    const bType = booking.booking_type || 'hourly';
    const computedHours = calculateHourDuration(startTimeStr, endTimeStr);
    const fallbackQty = (bType === 'hourly' && computedHours) ? computedHours : (Number(booking.quantity || booking.hours) || 1);

    itemsToNormalize = [{
      room_id: booking.room_id || booking.room?.id,
      room_name: booking.room_name || booking.room?.name || 'ห้องประชุม',
      room_description: booking.room_description || booking.room?.description || '',
      price: rootTotal,
      quantity: fallbackQty,
      subtotal: rootTotal,
      start_time: startTimeStr,
      end_time: endTimeStr,
      layout: booking.layout || 'standard',
      booking_type: bType,
      guest_count: booking.guest_count || null
    }];
  }

  const normalizedItems = itemsToNormalize.map((it, idx) => normalizeReceiptItem(it, booking, idx));
  const sortedItems = sortReceiptItems(normalizedItems);
  const groupedResult = groupReceiptItemsByDate(sortedItems);

  return {
    normalizedItems: sortedItems,
    isMultiDate: groupedResult.isMultiDate,
    dateCount: groupedResult.dateCount,
    groups: groupedResult.groups
  };
}

/**
 * Calculates receipt totals while strictly preserving booking.total_amount as authoritative.
 */
export function getReceiptTotals(booking = {}, normalizedItems = []) {
  const fin = normalizeBookingFinancials(booking);
  const authoritativeTotal = fin ? fin.total_amount : Number(booking.total_amount ?? booking.totalAmount ?? 0);
  const itemsSubtotal = normalizedItems.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0);

  const roundedItemsSubtotal = Math.round(itemsSubtotal * 100) / 100;
  const roundedAuthoritativeTotal = Math.round(authoritativeTotal * 100) / 100;
  const diff = Math.round((roundedAuthoritativeTotal - roundedItemsSubtotal) * 100) / 100;

  const hasAdjustment = Math.abs(diff) >= 0.01;
  let adjustmentType = null;
  let adjustmentLabel = '';
  let adjustmentAmount = 0;

  if (hasAdjustment) {
    if (diff < 0) {
      adjustmentType = 'discount';
      adjustmentLabel = 'ส่วนลด / ปรับยอด';
      adjustmentAmount = diff; // Negative value
    } else {
      adjustmentType = 'surcharge';
      adjustmentLabel = 'ปรับยอดเพิ่ม';
      adjustmentAmount = diff; // Positive value
    }
  }

  // Canonical V1 snapshot integration
  const hasV1Discount = Boolean(fin && fin.discount_amount > 0);
  const grossSubtotal = (fin && fin.subtotal_amount > 0)
    ? fin.subtotal_amount
    : (hasAdjustment && adjustmentType === 'discount' ? roundedItemsSubtotal : (roundedItemsSubtotal || roundedAuthoritativeTotal));

  let discountLabel = 'ส่วนลด';
  let discountAmount = 0;
  let hasDiscount = false;

  if (hasV1Discount) {
    hasDiscount = true;
    discountAmount = fin.discount_amount;
    const isOnline = booking?.booking_source === 'online' || booking?.booking_channel === 'line_oa';
    if (isOnline && fin.discount_type === 'percent' && Number(fin.discount_value) > 0) {
      discountLabel = `ส่วนลดจองออนไลน์ ${Number(fin.discount_value)}%`;
    } else if (fin.discount_type === 'percent' && fin.discount_value > 0) {
      discountLabel = `ส่วนลด (${fin.discount_value}%)`;
    } else {
      discountLabel = 'ส่วนลด';
    }
  } else if (hasAdjustment && adjustmentType === 'discount') {
    hasDiscount = true;
    discountAmount = Math.abs(adjustmentAmount);
    discountLabel = adjustmentLabel;
  }

  const paidAmount = fin ? fin.paid_amount : (booking.payment_status === 'paid' ? roundedAuthoritativeTotal : 0);
  const balanceAmount = fin ? fin.balance_amount : (booking.payment_status === 'paid' ? 0 : roundedAuthoritativeTotal);

  return {
    itemsSubtotal: roundedItemsSubtotal,
    grossSubtotal,
    hasDiscount,
    discountLabel,
    discountAmount,
    hasAdjustment,
    adjustmentType,
    adjustmentLabel,
    adjustmentAmount,
    netTotal: roundedAuthoritativeTotal,
    grandTotal: roundedAuthoritativeTotal,
    paidAmount,
    balanceAmount
  };
}

/**
 * Resolves receipt payment information respecting all active system payment statuses.
 */
export function getReceiptPaymentDetails(booking = {}) {
  const fin = normalizeBookingFinancials(booking);
  const pStatus = fin ? fin.payment_status : (booking.payment_status || 'pending');
  const pMethod = booking.payment_method || '';
  const billingOption = booking.billing_option || '';
  const customerType = booking.customer_type || '';
  const hasSlip = Boolean(booking.slip_image_url);

  // 1. Internal Free Check
  const isInternalFree = fin ? fin.is_internal_free : (pStatus === 'internal_free' || billingOption === 'internal_free' || customerType === 'builtland');

  if (isInternalFree) {
    return {
      statusKey: 'internal_free',
      statusLabel: 'สิทธิ์การใช้งานภายใน (ฟรี)',
      methodKey: 'internal_free',
      methodLabel: 'ไม่คิดค่าบริการ (สิทธิ์ภายใน)',
      paidAmount: 0,
      balanceAmount: 0,
      isPaid: true,
      isFree: true,
      isDeposit: false,
      receiptTitle: 'ใบยืนยันการจอง',
      paidLabel: 'ชำระแล้ว',
      transRef: null,
      note: Number(booking.quota_hours_used) > 0 ? `หักโควต้า ${booking.quota_hours_used} ชั่วโมง` : 'สิทธิ์พนักงาน / สมาชิกองค์กร'
    };
  }

  let methodText = 'เงินสด (Cash)';
  if (pMethod === 'transfer' || pMethod === 'bank_transfer' || hasSlip) {
    methodText = 'โอนเงิน (Transfer)';
  } else if (pMethod === 'cash') {
    methodText = 'เงินสด (Cash)';
  } else if (pMethod === 'credit_card' || pMethod === 'card') {
    methodText = 'บัตรเครดิต';
  } else if (pMethod === 'hour_credit') {
    methodText = 'เครดิตชั่วโมง';
  } else if (pMethod) {
    methodText = pMethod;
  }

  // 2. Deposit Check (payment_status === 'deposit' or paid_amount > 0 and balance_amount > 0)
  const isDeposit = fin ? fin.is_deposit : (pStatus === 'deposit');
  if (isDeposit) {
    return {
      statusKey: 'deposit',
      statusLabel: 'ชำระมัดจำแล้ว',
      methodKey: pMethod || 'cash',
      methodLabel: methodText,
      paidAmount: fin ? fin.paid_amount : Number(booking.paid_amount || 0),
      balanceAmount: fin ? fin.balance_amount : Number(booking.balance_amount || 0),
      isPaid: false,
      isFree: false,
      isDeposit: true,
      receiptTitle: 'ใบรับเงินมัดจำ',
      paidLabel: 'มัดจำ/ชำระแล้ว',
      transRef: booking.slip_trans_ref || null,
      note: null
    };
  }

  // 3. Paid Check
  if (pStatus === 'paid') {
    const isZeroNet = (fin && fin.total_amount === 0 && fin.discount_amount > 0) ||
                      (Number(booking.total_amount) === 0 && (Number(booking.discount_amount) > 0 || (booking.discount_type === 'percent' && Number(booking.discount_value) === 100)));
    const title = isZeroNet ? 'ใบยืนยันการจอง' : 'ใบเสร็จรับเงิน';
    return {
      statusKey: 'paid',
      statusLabel: isZeroNet ? 'ยืนยันการจองแล้ว (ส่วนลด 100%)' : 'ชำระเงินแล้ว',
      methodKey: pMethod || 'cash',
      methodLabel: isZeroNet ? 'ไม่คิดค่าบริการ (ส่วนลดเต็มจำนวน)' : methodText,
      paidAmount: fin ? fin.paid_amount : Number(booking.total_amount ?? booking.totalAmount ?? 0),
      balanceAmount: 0,
      isPaid: true,
      isFree: isZeroNet,
      isDeposit: false,
      receiptTitle: title,
      paidLabel: 'ชำระแล้ว',
      transRef: booking.slip_trans_ref || null,
      note: null
    };
  }

  // 4. Reviewing Slip Check
  if (pStatus === 'reviewing' || (hasSlip && pStatus !== 'cancelled' && pStatus !== 'rejected')) {
    return {
      statusKey: 'reviewing',
      statusLabel: 'รอตรวจสอบสลิป',
      methodKey: pMethod || 'transfer',
      methodLabel: 'โอนเงิน (แนบสลิปแล้ว)',
      paidAmount: 0,
      balanceAmount: fin ? fin.balance_amount : Number(booking.total_amount || 0),
      isPaid: false,
      isFree: false,
      isDeposit: false,
      receiptTitle: 'ใบแจ้งยอดการจอง',
      paidLabel: 'ชำระแล้ว',
      transRef: booking.slip_trans_ref || null,
      note: 'รอเจ้าหน้าที่ตรวจสอบสลิป'
    };
  }

  // 5. Rejected Check
  if (pStatus === 'rejected') {
    return {
      statusKey: 'rejected',
      statusLabel: 'ปฏิเสธสลิป / ค้างชำระ',
      methodKey: pMethod || '-',
      methodLabel: 'รอชำระเงินใหม่',
      paidAmount: 0,
      balanceAmount: fin ? fin.balance_amount : Number(booking.total_amount || 0),
      isPaid: false,
      isFree: false,
      isDeposit: false,
      receiptTitle: 'ใบแจ้งยอดการจอง',
      paidLabel: 'ชำระแล้ว',
      transRef: null,
      note: 'สลิปไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่'
    };
  }

  // 6. Cancelled Check
  if (pStatus === 'cancelled' || booking.status === 'cancelled') {
    return {
      statusKey: 'cancelled',
      statusLabel: 'ยกเลิกแล้ว (Cancelled)',
      methodKey: 'cancelled',
      methodLabel: '-',
      paidAmount: 0,
      balanceAmount: fin ? fin.balance_amount : Number(booking.total_amount || 0),
      isPaid: false,
      isFree: false,
      isDeposit: false,
      receiptTitle: 'ใบแจ้งยอดการจอง (ยกเลิก)',
      paidLabel: 'ชำระแล้ว',
      transRef: null,
      note: booking.cancellation_reason ? `เหตุผล: ${booking.cancellation_reason}` : 'รายการจองถูกยกเลิกแล้ว'
    };
  }

  // 7. Default: Pending / Unpaid
  return {
    statusKey: 'pending',
    statusLabel: 'ค้างชำระ (Pending)',
    methodKey: pMethod || 'pending',
    methodLabel: pMethod === 'cash' ? 'เงินสด' : (pMethod === 'transfer' ? 'โอนเงิน' : 'รอการชำระเงิน'),
    paidAmount: 0,
    balanceAmount: fin ? fin.balance_amount : Number(booking.total_amount || 0),
    isPaid: false,
    isFree: false,
    isDeposit: false,
    receiptTitle: 'ใบแจ้งยอดการจอง',
    paidLabel: 'ชำระแล้ว',
    transRef: null,
    note: null
  };
}
