/**
 * Centralized Door PIN Capability Compatibility Module
 *
 * Business Rule:
 * Physical rooms without a door keypad / PIN lock mechanism:
 * - ID 10: Jupiter (300)
 * - ID 12: Jupiter (300) & Co-Working
 * - ID 13: เหมาโซน Co-working
 *
 * All other meeting rooms (Mars, Mercury, Saturn, Venus, Uranus, Neptune, Pluto)
 * are PIN-enabled with physical keypads.
 *
 * Primary Rule: Stable room IDs (10, 12, 13).
 * Defensive Fallback: Room name matching /jupiter/i.
 * (Global 'coworking' / 'co-working' substring matching is explicitly disallowed).
 */

export const NO_PIN_ROOM_IDS = [10, 12, 13];
export const JUPITER_ROOM_IDS = NO_PIN_ROOM_IDS;

/**
 * Returns whether a room physically uses/requires a door lock PIN.
 *
 * @param {Object|number|string} roomOrId - Room object, booking item with room info, or roomId
 * @returns {boolean} true if room uses a door PIN, false if room is no-PIN (10, 12, 13)
 */
export function roomUsesDoorPin(roomOrId) {
  if (!roomOrId) return false;

  // 1. Direct numeric/string ID check
  if (typeof roomOrId === 'number') {
    return !NO_PIN_ROOM_IDS.includes(roomOrId);
  }
  if (typeof roomOrId === 'string' && /^\d+$/.test(roomOrId.trim())) {
    const parsedId = parseInt(roomOrId.trim(), 10);
    return !NO_PIN_ROOM_IDS.includes(parsedId);
  }

  // 2. Room object check
  if (typeof roomOrId === 'object') {
    const rId = Number(roomOrId.room_id || roomOrId.id);
    if (rId && NO_PIN_ROOM_IDS.includes(rId)) {
      return false;
    }

    const name = String(roomOrId.name || roomOrId.room_name || '').trim();
    if (name && /jupiter/i.test(name)) {
      return false;
    }

    // If room object has explicit pin_code or builtland_pin_code configured
    if (roomOrId.pin_code && String(roomOrId.pin_code).trim() && String(roomOrId.pin_code).trim() !== '-') {
      return true;
    }
    if (roomOrId.builtland_pin_code && String(roomOrId.builtland_pin_code).trim() && String(roomOrId.builtland_pin_code).trim() !== '-') {
      return true;
    }
  }

  // All other meeting rooms are PIN-enabled by default
  return true;
}

/**
 * Canonical check for internal/Builtland bookings.
 * An internal booking is identified by:
 * - customer_type === 'builtland'
 * - billing_option === 'internal_free'
 * - payment_status === 'internal_free' (or is_internal_free === true)
 *
 * @param {Object} booking
 * @returns {boolean}
 */
export function isInternalBooking(booking) {
  if (!booking) return false;
  const cType = String(booking.customer_type || '').toLowerCase();
  return cType === 'builtland' ||
         booking.billing_option === 'internal_free' ||
         booking.payment_status === 'internal_free' ||
         booking.is_internal_free === true;
}

/**
 * Resolves the Internal / Builtland door PIN for a booking / room.
 *
 * Canonical Internal Precedence:
 * 1. target room master builtland_pin_code
 * 2. target room master pin_code as fallback (only when builtland_pin_code is missing/empty)
 * 3. empty string if canonical no-PIN room or no PIN configured
 *
 * Architectural Note:
 * Internal bookings currently have NO separate internal snapshot field in booking_items.
 * General item snapshot (booking_items.pin_code) and parent snapshot (bookings.pin_code)
 * MUST NOT be resolved as the primary value for internal bookings.
 *
 * @param {Object} booking - Booking object
 * @param {number|string|null} targetRoomId - Specific room id to match
 * @param {Object|null} fallbackRoom - Room master record
 * @returns {string} The resolved internal PIN string or ''
 */
export function resolveInternalRoomPin(booking, targetRoomId = null, fallbackRoom = null) {
  const targetRoom = fallbackRoom || (targetRoomId != null ? { id: targetRoomId } : null);
  if (targetRoom && !roomUsesDoorPin(targetRoom)) {
    return '';
  }

  // 1. Authoritative internal master PIN from room record
  if (fallbackRoom && fallbackRoom.builtland_pin_code && String(fallbackRoom.builtland_pin_code).trim() && String(fallbackRoom.builtland_pin_code).trim() !== '-') {
    return String(fallbackRoom.builtland_pin_code).trim();
  }

  // Check matching item / booking builtland_pin_code if present (defensive)
  if (booking) {
    const items = Array.isArray(booking.items) ? booking.items : [];
    const matching = targetRoomId != null ? items.find(it => String(it.room_id) === String(targetRoomId)) : items[0];
    if (matching && matching.builtland_pin_code && String(matching.builtland_pin_code).trim() && String(matching.builtland_pin_code).trim() !== '-') {
      return String(matching.builtland_pin_code).trim();
    }
    if (booking.builtland_pin_code && String(booking.builtland_pin_code).trim() && String(booking.builtland_pin_code).trim() !== '-') {
      return String(booking.builtland_pin_code).trim();
    }
  }

  // 2. Master general PIN fallback when builtland_pin_code is missing/empty
  if (fallbackRoom && fallbackRoom.pin_code && String(fallbackRoom.pin_code).trim() && String(fallbackRoom.pin_code).trim() !== '-') {
    return String(fallbackRoom.pin_code).trim();
  }

  return '';
}

/**
 * Resolves the General / External Customer door PIN for a booking / room.
 *
 * Canonical General Precedence:
 * 1. matching booking_items.pin_code for target room
 * 2. first relevant room item snapshot when no target room exists
 * 3. bookings.pin_code fallback
 * 4. rooms.pin_code current master fallback
 *
 * Must NEVER use rooms.builtland_pin_code.
 *
 * @param {Object} booking - Booking object containing items
 * @param {number|string|null} targetRoomId - Specific room id to match
 * @param {Object|null} fallbackRoom - Room master record
 * @returns {string} The resolved general PIN string or ''
 */
export function resolveGeneralRoomPin(booking, targetRoomId = null, fallbackRoom = null) {
  const targetRoom = fallbackRoom || (targetRoomId != null ? { id: targetRoomId } : null);
  if (targetRoom && !roomUsesDoorPin(targetRoom)) {
    return '';
  }

  if (!booking) return '';
  const items = Array.isArray(booking.items) ? booking.items : [];

  // 1. matchingItem.pin_code (if targetRoomId provided)
  if (targetRoomId !== null && targetRoomId !== undefined) {
    const matching = items.find(it => String(it.room_id) === String(targetRoomId));
    if (matching && matching.pin_code && String(matching.pin_code).trim() && String(matching.pin_code).trim() !== '-') {
      return String(matching.pin_code).trim();
    }
  }

  // 2. firstRoomItem.pin_code (first item that is a room item, or first item)
  if (targetRoomId === null || targetRoomId === undefined) {
    const firstRoomItem = items.find(it => it.room_id != null) || items[0];
    if (firstRoomItem && firstRoomItem.pin_code && String(firstRoomItem.pin_code).trim() && String(firstRoomItem.pin_code).trim() !== '-') {
      return String(firstRoomItem.pin_code).trim();
    }
  }

  // 3. bookings.pin_code fallback
  if (booking.pin_code && String(booking.pin_code).trim() && String(booking.pin_code).trim() !== '-') {
    return String(booking.pin_code).trim();
  }

  // 4. Fallback to room master general PIN (NEVER builtland_pin_code)
  if (fallbackRoom && roomUsesDoorPin(fallbackRoom)) {
    if (fallbackRoom.pin_code && String(fallbackRoom.pin_code).trim() && String(fallbackRoom.pin_code).trim() !== '-') {
      return String(fallbackRoom.pin_code).trim();
    }
  }

  return '';
}

/**
 * Resolves full room PIN details including pin string and pinType.
 *
 * @param {Object} booking - Booking object
 * @param {number|string|null} targetRoomId - Specific room id to match
 * @param {Object|null} fallbackRoom - Room master record fallback
 * @returns {{ pin: string, pinType: 'general'|'internal'|'none' }}
 */
export function resolveRoomPinInfo(booking, targetRoomId = null, fallbackRoom = null) {
  const targetRoom = fallbackRoom || (targetRoomId != null ? { id: targetRoomId } : null);
  if (targetRoom && !roomUsesDoorPin(targetRoom)) {
    return { pin: '', pinType: 'none' };
  }

  const isInternal = isInternalBooking(booking);
  if (isInternal) {
    const pin = resolveInternalRoomPin(booking, targetRoomId, fallbackRoom);
    return { pin, pinType: pin ? 'internal' : 'none' };
  }

  const pin = resolveGeneralRoomPin(booking, targetRoomId, fallbackRoom);
  return { pin, pinType: pin ? 'general' : 'none' };
}

/**
 * Resolves the authoritative door PIN string for a booking / room.
 * Backward compatible string return.
 *
 * @param {Object} booking - Booking object
 * @param {number|string|null} targetRoomId - Specific room id to match
 * @param {Object|null} fallbackRoom - Room master record fallback
 * @returns {string} The resolved PIN string or ''
 */
export function resolveRoomPin(booking, targetRoomId = null, fallbackRoom = null) {
  return resolveRoomPinInfo(booking, targetRoomId, fallbackRoom).pin;
}

/**
 * Returns canonical Thai UI label based on pinType.
 *
 * @param {'general'|'internal'|'none'|string} pinType
 * @returns {string}
 */
export function getRoomPinLabel(pinType) {
  if (pinType === 'internal') {
    return 'รหัสผ่านห้อง (ภายใน)';
  }
  if (pinType === 'general') {
    return 'รหัสผ่านห้อง (ลูกค้าทั่วไป)';
  }
  return 'ไม่มีรหัสเข้าห้อง';
}
