/**
 * booking-app/src/utils/roomGuidelines.js
 *
 * Re-exports shared room guidelines policy for booking-app.
 */
import {
  ROOM_GUIDELINES_VERSIONS,
  ROOM_GUIDELINES_CONFIG,
  GUIDELINES_CUTOVER_ISO,
  resolveRoomGuidelines,
  isGuidelinesEnforcedForBooking,
  isBoundLineUserId,
  buildLineGuidelinesMessage
} from '../../../shared/roomGuidelinesPolicy.mjs';

export {
  ROOM_GUIDELINES_VERSIONS,
  ROOM_GUIDELINES_CONFIG,
  GUIDELINES_CUTOVER_ISO,
  resolveRoomGuidelines,
  isGuidelinesEnforcedForBooking,
  isBoundLineUserId,
  buildLineGuidelinesMessage
};

/**
 * Helper specifically for ConfirmPage that inspects a booking object.
 */
export function getBookingRoomGuidelines(booking) {
  if (!booking) return resolveRoomGuidelines(null, null);
  const rawId = booking.room_id || booking.room?.id || booking.roomId;
  const roomName = booking.room_name || booking.room?.name || '';
  return resolveRoomGuidelines(rawId, roomName);
}
