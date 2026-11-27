export { getAvailabilityMonth, getConflictingRoomIds, ROOM_CONFLICT_MAP } from '../shared/roomAvailability.mjs';
import { getConflictingRoomIds } from '../shared/roomAvailability.mjs';

export const ACTIVE_AVAILABILITY_ROOMS_SQL = `
  SELECT id, name, capacity FROM rooms WHERE status = 'active' ORDER BY name ASC
`;

// Booker type resolution helper (customer_type takes strict priority over booking_channel/source)
export function resolveBookerType(item) {
  const cType = (item.customer_type || '').toLowerCase().trim();
  const bSource = (item.booking_source || '').toLowerCase().trim();
  const bChannel = (item.booking_channel || '').toLowerCase().trim();
  const dept = (item.internal_department || item.department || '').trim();

  // 1. Check explicit system customer_type FIRST (e.g. Basecamp booked via POS stays "ลูกค้าชั้น 4")
  if (cType === 'builtland') {
    return { type: 'พนักงาน Builtland', code: 'builtland' };
  }
  if (cType === 'basecamp') {
    return { type: 'ลูกค้าชั้น 4', code: 'basecamp' };
  }
  if (cType === 'shop') {
    return { type: 'ลูกค้าห้อง Shop', code: 'shop' };
  }
  if (cType === 'ondemand' || cType === 'on_demand' || cType === 'on-demand') {
    return { type: 'ลูกค้า Ondemand', code: 'ondemand' };
  }
  const externalTypes = ['general', 'walkin', 'walk_in', 'vip_corp', 'corporate', 'external', 'online', 'customer'];
  if (externalTypes.includes(cType)) {
    return { type: 'ลูกค้าภายนอก', code: 'external' };
  }

  // 2. Fallback to booking_source / booking_channel only when customer_type is missing/unrecognized
  if (bSource === 'staff' || bChannel === 'staff_calendar') {
    return { type: 'พนักงาน Builtland', code: 'builtland' };
  }
  const externalChannels = ['line_oa', 'line', 'walkin', 'walk_in', 'online'];
  if (externalChannels.includes(bChannel) || externalChannels.includes(bSource)) {
    return { type: 'ลูกค้าภายนอก', code: 'external' };
  }
  if (dept && dept !== '-' && !['walkin', 'online', 'general'].includes(dept.toLowerCase())) {
    return { type: 'พนักงาน Builtland', code: 'builtland' };
  }

  // 3. Fallback for legacy/incomplete records without guessing
  return {
    type: 'ไม่ระบุประเภท',
    code: 'unknown'
  };
}

export function resolveCheckinStatus(item) {
  const s = (item.item_checkin_status || item.booking_checkin_status || '').toLowerCase().trim();
  if (s === 'checked_in') return 'checked_in';
  if (s === 'checked_out' || s === 'completed') return 'checked_out';
  return 'pending';
}

// These status exclusions match checkRoomOverlap in both backends. Allow for
// legacy UTC timestamps as well as the Bangkok wall-clock values written today.
// Public intervals SQL: external customer PII is NEVER returned; internal Builtland staff name is returned only for Builtland records.
export const ROOM_AVAILABILITY_INTERVALS_SQL = `
  SELECT bi.room_id, bi.start_time, bi.end_time,
         bi.checkin_status AS item_checkin_status,
         b.checkin_status AS booking_checkin_status,
         CASE
           WHEN LOWER(TRIM(COALESCE(b.customer_type, ''))) = 'builtland'
             OR LOWER(TRIM(COALESCE(b.booking_source, ''))) = 'staff'
             OR LOWER(TRIM(COALESCE(b.booking_channel, ''))) = 'staff_calendar'
           THEN b.customer_name
           ELSE NULL
         END AS staff_booker_name,
         b.customer_type,
         b.booking_source,
         b.booking_channel,
         b.department,
         b.internal_department
  FROM booking_items bi
  JOIN bookings b ON b.id = bi.booking_id
  JOIN rooms r ON r.id = bi.room_id AND r.status = 'active'
  WHERE (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
    AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
    AND datetime(bi.start_time) < datetime(?, '+7 hours', ?)
    AND datetime(bi.end_time) > datetime(?, '-7 hours', ?)
`;

// Staff intervals SQL: Authenticated staff endpoint with booking metadata (customer_name, internal_department).
export const STAFF_ROOM_AVAILABILITY_INTERVALS_SQL = `
  SELECT bi.room_id, bi.start_time, bi.end_time,
         bi.checkin_status AS item_checkin_status,
         b.checkin_status AS booking_checkin_status,
         b.customer_name,
         COALESCE(b.internal_department, b.department) AS internal_department,
         b.customer_type,
         b.booking_source,
         b.booking_channel
  FROM booking_items bi
  JOIN bookings b ON b.id = bi.booking_id
  JOIN rooms r ON r.id = bi.room_id AND r.status = 'active'
  WHERE (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
    AND (bi.checkin_status IS NULL OR bi.checkin_status != 'cancelled')
    AND datetime(bi.start_time) < datetime(?, '+7 hours', ?)
    AND datetime(bi.end_time) > datetime(?, '-7 hours', ?)
`;

export function getAvailabilityQueryParams(month, bufferMinutes) {
  return [month.end, `+${bufferMinutes} minutes`, month.start, `-${bufferMinutes} minutes`];
}

// Anonymous response builder for public endpoint (zero external customer PII; Builtland staff name included only for Builtland bookings)
export function buildAvailabilityResponse(month, rooms, items, bufferMinutes, normalizeTime) {
  const intervals = [];
  for (const item of items) {
    const { type, code } = resolveBookerType(item);
    const checkin = resolveCheckinStatus(item);
    const normStart = normalizeTime(item.start_time);
    const normEnd = normalizeTime(item.end_time);
    const conflictIds = getConflictingRoomIds(item.room_id);
    for (const rid of conflictIds) {
      intervals.push({
        room_id: rid,
        start: normStart,
        end: normEnd,
        booker_type: type,
        booker_type_code: code,
        customer_type: item.customer_type || null,
        customer_name: code === 'builtland' ? (item.staff_booker_name || null) : null,
        checkin_status: checkin
      });
    }
  }
  return {
    month: month.month,
    cleaning_buffer_minutes: bufferMinutes,
    rooms,
    intervals
  };
}

// Staff response builder for authenticated staff endpoint
export function buildStaffAvailabilityResponse(month, rooms, items, bufferMinutes, normalizeTime) {
  const intervals = [];
  for (const item of items) {
    const { type, code } = resolveBookerType(item);
    const checkin = resolveCheckinStatus(item);
    const normStart = normalizeTime(item.start_time);
    const normEnd = normalizeTime(item.end_time);
    const conflictIds = getConflictingRoomIds(item.room_id);
    for (const rid of conflictIds) {
      intervals.push({
        room_id: rid,
        start: normStart,
        end: normEnd,
        booker_type: type,
        booker_type_code: code,
        checkin_status: checkin,
        customer_name: item.customer_name || null,
        internal_department: item.internal_department || null,
        customer_type: item.customer_type || null,
        booking_source: item.booking_source || null,
        booking_channel: item.booking_channel || null
      });
    }
  }
  return {
    month: month.month,
    cleaning_buffer_minutes: bufferMinutes,
    rooms,
    intervals
  };
}
