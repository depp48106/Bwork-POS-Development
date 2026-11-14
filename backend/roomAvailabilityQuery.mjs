export { getAvailabilityMonth } from '../shared/roomAvailability.mjs';

export const ACTIVE_AVAILABILITY_ROOMS_SQL = `
  SELECT id, name, capacity FROM rooms WHERE status = 'active' ORDER BY name ASC
`;

// These status exclusions match checkRoomOverlap in both backends. Allow for
// legacy UTC timestamps as well as the Bangkok wall-clock values written today.
// Public intervals SQL: STRICTLY ANONYMOUS, ZERO PII (room_id, start_time, end_time only).
export const ROOM_AVAILABILITY_INTERVALS_SQL = `
  SELECT bi.room_id, bi.start_time, bi.end_time
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
         b.customer_name,
         COALESCE(b.internal_department, b.department) AS internal_department,
         b.customer_type,
         b.booking_source
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
    intervals: items.map(item => ({
      room_id: item.room_id,
      start: normalizeTime(item.start_time),
      end: normalizeTime(item.end_time)
    }))
  };
}

// Staff response builder for authenticated staff endpoint
export function buildStaffAvailabilityResponse(month, rooms, items, bufferMinutes, normalizeTime) {
  return {
    month: month.month,
    cleaning_buffer_minutes: bufferMinutes,
    rooms,
    intervals: items.map(item => ({
      room_id: item.room_id,
      start: normalizeTime(item.start_time),
      end: normalizeTime(item.end_time),
      customer_name: item.customer_name || null,
      internal_department: item.internal_department || null,
      customer_type: item.customer_type || null,
      booking_source: item.booking_source || null
    }))
  };
}
