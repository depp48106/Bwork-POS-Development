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
    if (roomOrId.builtland_pin_code && String(roomOrId.builtland_pin_code).trim()) {
      return true;
    }
  }

  // All other meeting rooms are PIN-enabled by default
  return true;
}

/**
 * Resolves the authoritative door PIN for a booking / room.
 *
 * Precedence rule:
 * 1. matchingItem.pin_code (if targetRoomId specified)
 * 2. firstRoomItem.pin_code
 * 3. booking.pin_code
 * 4. fallbackRoom.builtland_pin_code / fallbackRoom.pin_code (only if room uses door PIN)
 *
 * @param {Object} booking - Booking object containing items
 * @param {number|string|null} targetRoomId - Specific room id to match
 * @param {Object|null} fallbackRoom - Room master record fallback
 * @returns {string} The resolved PIN string or ''
 */
export function resolveRoomPin(booking, targetRoomId = null, fallbackRoom = null) {
  if (!booking) return '';
  const items = Array.isArray(booking.items) ? booking.items : [];

  // 1. matchingItem.pin_code (if targetRoomId provided)
  if (targetRoomId !== null && targetRoomId !== undefined) {
    const matching = items.find(it => String(it.room_id) === String(targetRoomId));
    if (matching && matching.pin_code && String(matching.pin_code).trim() && String(matching.pin_code).trim() !== '-') {
      return String(matching.pin_code).trim();
    }
  }

  // 2. firstItem.pin_code (first item that is a room item, or first item)
  const firstRoomItem = items.find(it => it.room_id != null) || items[0];
  if (firstRoomItem && firstRoomItem.pin_code && String(firstRoomItem.pin_code).trim() && String(firstRoomItem.pin_code).trim() !== '-') {
    return String(firstRoomItem.pin_code).trim();
  }

  // 3. booking.pin_code
  if (booking.pin_code && String(booking.pin_code).trim() && String(booking.pin_code).trim() !== '-') {
    return String(booking.pin_code).trim();
  }

  // 4. Fallback to room master PIN if room uses door PIN
  if (fallbackRoom && roomUsesDoorPin(fallbackRoom)) {
    const isBuiltland = booking.customer_type === 'builtland';
    if (isBuiltland && fallbackRoom.builtland_pin_code && String(fallbackRoom.builtland_pin_code).trim() && String(fallbackRoom.builtland_pin_code).trim() !== '-') {
      return String(fallbackRoom.builtland_pin_code).trim();
    }
    if (fallbackRoom.pin_code && String(fallbackRoom.pin_code).trim() && String(fallbackRoom.pin_code).trim() !== '-') {
      return String(fallbackRoom.pin_code).trim();
    }
  }

  return '';
}
