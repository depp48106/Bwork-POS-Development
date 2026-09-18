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
