export { getAvailabilityMonth } from '../shared/roomAvailability.mjs';

export const ACTIVE_AVAILABILITY_ROOMS_SQL = `
  SELECT id, name, capacity FROM rooms WHERE status = 'active' ORDER BY name ASC
`;

// Booker type resolution helper:
// Builtland Staff vs External Customer vs Unknown
export function resolveBookerType(item) {
  const cType = (item.customer_type || '').toLowerCase().trim();
  const bSource = (item.booking_source || '').toLowerCase().trim();
  const bChannel = (item.booking_channel || '').toLowerCase().trim();
  const dept = (item.internal_department || item.department || '').trim();

  // 1. Builtland Staff:
  // customer_type is 'builtland' OR booking_source is 'staff' OR booking_channel is 'staff_calendar'
  // OR department is specified and not an external placeholder
  if (
    cType === 'builtland' ||
    bSource === 'staff' ||
    bChannel === 'staff_calendar' ||
    (dept && dept !== '-' && !['walkin', 'online', 'general'].includes(dept.toLowerCase()))
  ) {
    return {
      type: 'พนักงาน Builtland',
      code: 'builtland'
    };
  }

  // 2. External Customer:
  const externalTypes = ['walkin', 'basecamp', 'vip_corp', 'general', 'corporate', 'external', 'online', 'customer'];
  const externalSources = ['online', 'pos', 'walkin', 'line', 'pos_web'];
  if (externalTypes.includes(cType) || externalSources.includes(bSource) || externalSources.includes(bChannel)) {
    return {
      type: 'ลูกค้าภายนอก',
      code: 'external'
    };
  }

  // 3. Fallback for unidentifiable legacy records:
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
// Public intervals SQL: STRICTLY ANONYMOUS, ZERO PII (room_id, start_time, end_time, booker_type metadata only).
export const ROOM_AVAILABILITY_INTERVALS_SQL = `
  SELECT bi.room_id, bi.start_time, bi.end_time,
         bi.checkin_status AS item_checkin_status,
         b.checkin_status AS booking_checkin_status,
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

// Anonymous response builder for public endpoint (no customer names, no departments)
export function buildAvailabilityResponse(month, rooms, items, bufferMinutes, normalizeTime) {
  return {
    month: month.month,
    cleaning_buffer_minutes: bufferMinutes,
    rooms,
    intervals: items.map(item => {
      const { type, code } = resolveBookerType(item);
      return {
        room_id: item.room_id,
        start: normalizeTime(item.start_time),
        end: normalizeTime(item.end_time),
        booker_type: type,
        booker_type_code: code,
        checkin_status: resolveCheckinStatus(item)
      };
    })
  };
}

// Staff response builder for authenticated staff endpoint
export function buildStaffAvailabilityResponse(month, rooms, items, bufferMinutes, normalizeTime) {
  return {
    month: month.month,
    cleaning_buffer_minutes: bufferMinutes,
    rooms,
    intervals: items.map(item => {
      const { type, code } = resolveBookerType(item);
      return {
        room_id: item.room_id,
        start: normalizeTime(item.start_time),
        end: normalizeTime(item.end_time),
        booker_type: type,
        booker_type_code: code,
        checkin_status: resolveCheckinStatus(item),
        customer_name: item.customer_name || null,
        internal_department: item.internal_department || null,
        customer_type: item.customer_type || null,
        booking_source: item.booking_source || null
      };
    })
  };
}
