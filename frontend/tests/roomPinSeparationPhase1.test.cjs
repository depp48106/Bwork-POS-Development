const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOOR_PIN_HELPER_PATH = path.join(ROOT_DIR, 'src/utils/doorPinHelper.js');
const PENDING_BOOKINGS_PATH = path.join(ROOT_DIR, 'src/components/PendingBookings.jsx');
const BOOKING_POS_PATH = path.join(ROOT_DIR, 'src/components/BookingPOS.jsx');
const RECEIPT_PRINT_PATH = path.join(ROOT_DIR, 'src/components/ReceiptPrint.jsx');

// ============================================================================
// SECTION 1: HELPER EXPORTS & CONTRACT INTEGRITY (Section 27: M)
// ============================================================================

test('1. doorPinHelper.js exports all canonical resolution functions', async () => {
  const helper = await import('../src/utils/doorPinHelper.js');

  assert.strictEqual(typeof helper.isInternalBooking, 'function', 'Must export isInternalBooking');
  assert.strictEqual(typeof helper.resolveInternalRoomPin, 'function', 'Must export resolveInternalRoomPin');
  assert.strictEqual(typeof helper.resolveGeneralRoomPin, 'function', 'Must export resolveGeneralRoomPin');
  assert.strictEqual(typeof helper.resolveRoomPinInfo, 'function', 'Must export resolveRoomPinInfo');
  assert.strictEqual(typeof helper.resolveRoomPin, 'function', 'Must export resolveRoomPin');
  assert.strictEqual(typeof helper.getRoomPinLabel, 'function', 'Must export getRoomPinLabel');
  assert.strictEqual(typeof helper.roomUsesDoorPin, 'function', 'Must export roomUsesDoorPin');
  assert.ok(Array.isArray(helper.NO_PIN_ROOM_IDS), 'Must export NO_PIN_ROOM_IDS array');
});

// ============================================================================
// SECTION 2: INTERNAL BOOKING IDENTIFICATION (Section 27: O)
// ============================================================================

test('2. isInternalBooking correctly detects Builtland and internal bookings', async () => {
  const { isInternalBooking } = await import('../src/utils/doorPinHelper.js');

  // Customer type builtland
  assert.strictEqual(isInternalBooking({ customer_type: 'builtland' }), true);
  assert.strictEqual(isInternalBooking({ customer_type: 'Builtland' }), true);
  assert.strictEqual(isInternalBooking({ customer_type: 'BUITLAND' }), false); // strict lowercase check or exact

  // Billing option internal_free
  assert.strictEqual(isInternalBooking({ billing_option: 'internal_free' }), true);

  // Payment status internal_free
  assert.strictEqual(isInternalBooking({ payment_status: 'internal_free' }), true);

  // is_internal_free boolean flag
  assert.strictEqual(isInternalBooking({ is_internal_free: true }), true);

  // General customer cases
  assert.strictEqual(isInternalBooking({ customer_type: 'walkin' }), false);
  assert.strictEqual(isInternalBooking({ customer_type: 'general' }), false);
  assert.strictEqual(isInternalBooking({ customer_type: 'member' }), false);
  assert.strictEqual(isInternalBooking({}), false);
  assert.strictEqual(isInternalBooking(null), false);
  assert.strictEqual(isInternalBooking(undefined), false);
});

// ============================================================================
// SECTION 3: GENERAL BOOKING PIN RESOLUTION (Section 27: A, E)
// ============================================================================

test('3. General booking: uses booking_items snapshot first, never uses builtland_pin_code', async () => {
  const { resolveRoomPinInfo, resolveRoomPin } = await import('../src/utils/doorPinHelper.js');

  const roomVenus = {
    id: 1,
    name: 'Venus',
    pin_code: '111111#',
    builtland_pin_code: '999999#'
  };

  const generalBooking = {
    id: 100,
    customer_name: 'Customer A',
    customer_type: 'walkin',
    pin_code: '222222#', // booking-level snapshot
    items: [
      { room_id: 1, room_name: 'Venus', pin_code: '333333#' } // item-level snapshot
    ]
  };

  // 1. Should use item snapshot 333333#
  const info1 = resolveRoomPinInfo(generalBooking, 1, roomVenus);
  assert.strictEqual(info1.pin, '333333#', 'General booking must use item snapshot');
  assert.strictEqual(info1.pinType, 'general', 'General booking pinType must be general');
  assert.strictEqual(resolveRoomPin(generalBooking, 1, roomVenus), '333333#');

  // 2. Fallback to booking-level pin_code if item snapshot missing
  const bookingNoItemPin = {
    id: 101,
    customer_type: 'walkin',
    pin_code: '222222#',
    items: [{ room_id: 1, room_name: 'Venus' }]
  };
  const info2 = resolveRoomPinInfo(bookingNoItemPin, 1, roomVenus);
  assert.strictEqual(info2.pin, '222222#', 'General booking must fall back to booking-level pin_code');
  assert.strictEqual(info2.pinType, 'general');

  // 3. Fallback to room.pin_code if neither snapshot exists
  const bookingNoSnapshots = {
    id: 102,
    customer_type: 'walkin',
    items: [{ room_id: 1, room_name: 'Venus' }]
  };
  const info3 = resolveRoomPinInfo(bookingNoSnapshots, 1, roomVenus);
  assert.strictEqual(info3.pin, '111111#', 'General booking must fall back to room.pin_code');
  assert.strictEqual(info3.pinType, 'general');

  // 4. Must NEVER use builtland_pin_code even if room.pin_code is missing
  const roomNoGeneralPin = {
    id: 1,
    name: 'Venus',
    pin_code: null,
    builtland_pin_code: '999999#'
  };
  const info4 = resolveRoomPinInfo(bookingNoSnapshots, 1, roomNoGeneralPin);
  assert.strictEqual(info4.pin, '', 'General booking must never use builtland_pin_code');
  assert.strictEqual(info4.pinType, 'none');
});

// ============================================================================
// SECTION 4: INTERNAL / BUILTLAND BOOKING PIN RESOLUTION (Section 27: B, C, D)
// ============================================================================

test('4. Internal / Builtland booking: ignores general snapshot, uses builtland_pin_code first', async () => {
  const { resolveRoomPinInfo, resolveRoomPin } = await import('../src/utils/doorPinHelper.js');

  const roomVenus = {
    id: 1,
    name: 'Venus',
    pin_code: '111111#',
    builtland_pin_code: '999999#'
  };

  const builtlandBooking = {
    id: 200,
    customer_name: 'Builtland Staff',
    customer_type: 'builtland',
    pin_code: 'general_snap#', // stale parent booking general snapshot
    items: [
      { room_id: 1, room_name: 'Venus', pin_code: 'general_item_snap#' } // item general snapshot
    ]
  };

  // Must completely ignore general_item_snap# and general_snap#
  const info = resolveRoomPinInfo(builtlandBooking, 1, roomVenus);
  assert.strictEqual(info.pin, '999999#', 'Internal booking must use room.builtland_pin_code, ignoring general snapshots');
  assert.strictEqual(info.pinType, 'internal', 'Internal booking pinType must be internal');
  assert.strictEqual(resolveRoomPin(builtlandBooking, 1, roomVenus), '999999#');
});

test('5. Internal / Builtland booking: falls back to room.pin_code if builtland_pin_code is null/empty', async () => {
  const { resolveRoomPinInfo, resolveRoomPin } = await import('../src/utils/doorPinHelper.js');

  const roomWithoutBuiltland = {
    id: 1,
    name: 'Venus',
    pin_code: '111111#',
    builtland_pin_code: null
  };

  const builtlandBooking = {
    id: 201,
    customer_type: 'builtland',
    items: [
      { room_id: 1, room_name: 'Venus', pin_code: 'general_snapshot#' }
    ]
  };

  const info = resolveRoomPinInfo(builtlandBooking, 1, roomWithoutBuiltland);
  assert.strictEqual(info.pin, '111111#', 'Internal booking falls back to room.pin_code when builtland_pin_code is null');
  assert.strictEqual(info.pinType, 'internal', 'pinType remains internal for internal booking');
  assert.strictEqual(resolveRoomPin(builtlandBooking, 1, roomWithoutBuiltland), '111111#');
});

test('6. Internal / Builtland booking: returns empty if both builtland_pin_code and pin_code are empty', async () => {
  const { resolveRoomPinInfo, resolveRoomPin } = await import('../src/utils/doorPinHelper.js');

  const roomNoPins = {
    id: 1,
    name: 'Venus',
    pin_code: '',
    builtland_pin_code: ''
  };

  const builtlandBooking = {
    id: 202,
    customer_type: 'builtland',
    items: [{ room_id: 1, room_name: 'Venus', pin_code: 'snapshot#' }]
  };

  const info = resolveRoomPinInfo(builtlandBooking, 1, roomNoPins);
  assert.strictEqual(info.pin, '', 'Must be empty when no room pins configured');
  assert.strictEqual(info.pinType, 'none');
  assert.strictEqual(resolveRoomPin(builtlandBooking, 1, roomNoPins), '');
});

// ============================================================================
// SECTION 5: MULTI-ROOM ISOLATION (Section 27: F, G)
// ============================================================================

test('7. Multi-room: Internal booking resolves distinct builtland_pin_code for each room', async () => {
  const { resolveRoomPinInfo } = await import('../src/utils/doorPinHelper.js');

  const roomVenus = { id: 1, name: 'Venus', pin_code: '111111#', builtland_pin_code: '999111#' };
  const roomMars = { id: 2, name: 'Mars', pin_code: '222222#', builtland_pin_code: '999222#' };

  const multiInternalBooking = {
    id: 300,
    customer_type: 'builtland',
    items: [
      { room_id: 1, room_name: 'Venus', pin_code: 'snap1#' },
      { room_id: 2, room_name: 'Mars', pin_code: 'snap2#' }
    ]
  };

  const infoVenus = resolveRoomPinInfo(multiInternalBooking, 1, roomVenus);
  const infoMars = resolveRoomPinInfo(multiInternalBooking, 2, roomMars);

  assert.strictEqual(infoVenus.pin, '999111#');
  assert.strictEqual(infoVenus.pinType, 'internal');
  assert.strictEqual(infoMars.pin, '999222#');
  assert.strictEqual(infoMars.pinType, 'internal');
  assert.notStrictEqual(infoVenus.pin, infoMars.pin);
});

test('8. Multi-room: General booking resolves distinct item snapshot for each room', async () => {
  const { resolveRoomPinInfo } = await import('../src/utils/doorPinHelper.js');

  const roomVenus = { id: 1, name: 'Venus', pin_code: '111111#', builtland_pin_code: '999111#' };
  const roomMars = { id: 2, name: 'Mars', pin_code: '222222#', builtland_pin_code: '999222#' };

  const multiGeneralBooking = {
    id: 301,
    customer_type: 'general',
    items: [
      { room_id: 1, room_name: 'Venus', pin_code: 'snapVenus#' },
      { room_id: 2, room_name: 'Mars', pin_code: 'snapMars#' }
    ]
  };

  const infoVenus = resolveRoomPinInfo(multiGeneralBooking, 1, roomVenus);
  const infoMars = resolveRoomPinInfo(multiGeneralBooking, 2, roomMars);

  assert.strictEqual(infoVenus.pin, 'snapVenus#');
  assert.strictEqual(infoVenus.pinType, 'general');
  assert.strictEqual(infoMars.pin, 'snapMars#');
  assert.strictEqual(infoMars.pinType, 'general');
  assert.notStrictEqual(infoVenus.pin, infoMars.pin);
});

// ============================================================================
// SECTION 6: NO-PIN ROOM SAFETY (Section 27: H)
// ============================================================================

test('9. No-PIN rooms return empty PIN and type none for all booking types', async () => {
  const { resolveRoomPinInfo, roomUsesDoorPin, NO_PIN_ROOM_IDS } = await import('../src/utils/doorPinHelper.js');

  for (const roomId of NO_PIN_ROOM_IDS) {
    const room = {
      id: roomId,
      name: `Room ${roomId}`,
      pin_code: '123456#',
      builtland_pin_code: '999999#'
    };

    assert.strictEqual(roomUsesDoorPin(room), false, `Room ${roomId} must not use door pin`);

    const infoGeneral = resolveRoomPinInfo({ customer_type: 'general', pin_code: '999999#' }, roomId, room);
    assert.strictEqual(infoGeneral.pin, '', `No-PIN room ${roomId} must have empty general PIN`);
    assert.strictEqual(infoGeneral.pinType, 'none');

    const infoInternal = resolveRoomPinInfo({ customer_type: 'builtland' }, roomId, room);
    assert.strictEqual(infoInternal.pin, '', `No-PIN room ${roomId} must have empty internal PIN`);
    assert.strictEqual(infoInternal.pinType, 'none');
  }
});

// ============================================================================
// SECTION 7: CANONICAL THAI LABELS & FORMATTING (Section 27: J, K)
// ============================================================================

test('10. getRoomPinLabel returns exact canonical Thai labels', async () => {
  const { getRoomPinLabel } = await import('../src/utils/doorPinHelper.js');

  assert.strictEqual(getRoomPinLabel('internal'), 'รหัสผ่านห้อง (ภายใน)');
  assert.strictEqual(getRoomPinLabel('general'), 'รหัสผ่านห้อง (ลูกค้าทั่วไป)');
  assert.strictEqual(getRoomPinLabel('none'), 'ไม่มีรหัสเข้าห้อง');
  assert.strictEqual(getRoomPinLabel('unknown'), 'ไม่มีรหัสเข้าห้อง');
});

test('11. PIN codes preserve trailing # suffix for lock pad entry', async () => {
  const { resolveRoomPin } = await import('../src/utils/doorPinHelper.js');

  const room = { id: 1, name: 'Venus', pin_code: '123456#', builtland_pin_code: '654321#' };

  const pinGen = resolveRoomPin({ customer_type: 'general' }, 1, room);
  const pinInt = resolveRoomPin({ customer_type: 'builtland' }, 1, room);

  assert.ok(pinGen.endsWith('#'), 'General PIN must end with #');
  assert.ok(pinInt.endsWith('#'), 'Internal PIN must end with #');
});

// ============================================================================
// SECTION 8: MALFORMED & CORNER CASE DATA SAFETY (Section 27: N)
// ============================================================================

test('12. Malformed booking and room shapes resolve safely without crashing', async () => {
  const { resolveRoomPinInfo, resolveRoomPin } = await import('../src/utils/doorPinHelper.js');

  // Null booking and null room
  const res1 = resolveRoomPinInfo(null, 1, null);
  assert.strictEqual(res1.pin, '');
  assert.strictEqual(res1.pinType, 'none');

  // Undefined room id
  const res2 = resolveRoomPinInfo({ customer_type: 'builtland' }, null, null);
  assert.strictEqual(res2.pin, '');
  assert.strictEqual(res2.pinType, 'none');

  // Items as non-array
  const res3 = resolveRoomPinInfo({ customer_type: 'general', items: 'invalid' }, 1, { id: 1, pin_code: '555#' });
  assert.strictEqual(res3.pin, '555#');
  assert.strictEqual(res3.pinType, 'general');

  // Items item with mismatched room_id
  const res4 = resolveRoomPinInfo({ customer_type: 'general', items: [{ room_id: 999, pin_code: '999#' }] }, 1, { id: 1, pin_code: '111#' });
  assert.strictEqual(res4.pin, '111#');
  assert.strictEqual(res4.pinType, 'general');
});

// ============================================================================
// SECTION 9: PARITY ACROSS PENDING BOOKINGS & CALENDAR (Section 27: I)
// ============================================================================

test('13. PendingBookings.jsx source verifies separated PIN resolution & canonical labels', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  // Must import resolveRoomPinInfo and isInternalBooking
  assert.ok(code.includes('resolveRoomPinInfo'), 'Must import resolveRoomPinInfo');
  assert.ok(code.includes('isInternalBooking'), 'Must import isInternalBooking');

  // Must contain canonical labels
  assert.ok(code.includes('รหัสผ่านห้อง (ภายใน)'), 'Must contain label รหัสผ่านห้อง (ภายใน)');
  assert.ok(code.includes('รหัสผ่านห้อง (ลูกค้าทั่วไป)'), 'Must contain label รหัสผ่านห้อง (ลูกค้าทั่วไป)');
  assert.ok(code.includes('ไม่มีรหัสเข้าห้อง'), 'Must contain label ไม่มีรหัสเข้าห้อง');
  assert.ok(code.includes('PIN ภายใน'), 'Desktop/Mobile badge contains PIN ภายใน');
});

test('14. BookingPOS.jsx source verifies separated PIN resolution & canonical labels across all calendar views', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Must import resolveRoomPinInfo and isInternalBooking
  assert.ok(code.includes('resolveRoomPinInfo'), 'Must import resolveRoomPinInfo in BookingPOS');
  assert.ok(code.includes('isInternalBooking'), 'Must import isInternalBooking in BookingPOS');

  // Popover modal labels
  assert.ok(code.includes("activePinPopover.isInternal ? 'รหัสผ่านห้อง (ภายใน)' : 'รหัสผ่านห้อง (ลูกค้าทั่วไป)'"), 'Popover must render dynamic internal vs general header');

  // Agenda card labels
  assert.ok(code.includes("isInternal ? 'รหัสผ่านห้อง (ภายใน):' : 'รหัสผ่านห้อง (ลูกค้าทั่วไป):'"), 'Agenda card must use differentiated pinLabel');

  // Floor plan room data preserves pinType
  assert.ok(code.includes('pinType: pinInfo.pinType'), 'Floor plan room data must capture pinType');

  // Calendar event rooms data captures pinType
  assert.ok(code.includes('pinType: pinInfo.pinType'), 'Calendar event rooms data must capture pinType');
});

// ============================================================================
// SECTION 10: SECURITY REGRESSION — RECEIPT PRINT IS STRICTLY PIN-FREE (Section 27: L)
// ============================================================================

test('15. ReceiptPrint.jsx is strictly PIN-free: zero PIN leakage in receipts', () => {
  const receiptCode = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf8');

  // Must not import or reference doorPinHelper
  assert.ok(!receiptCode.includes('doorPinHelper'), 'ReceiptPrint must not import doorPinHelper');
  assert.ok(!receiptCode.includes('pin_code'), 'ReceiptPrint must not render pin_code');
  assert.ok(!receiptCode.includes('builtland_pin_code'), 'ReceiptPrint must not render builtland_pin_code');
  assert.ok(!receiptCode.includes('รหัสผ่านห้อง'), 'ReceiptPrint must not render รหัสผ่านห้อง');
});

// ============================================================================
// SECTION 11: MANDATORY FINAL LOCK TESTS (Sections 5, 6, 7, 9, 10, 13, 14, 17)
// ============================================================================

test('16. Mandatory Contrast Test (Section 5): exact values contrast between general and internal', async () => {
  const { resolveRoomPinInfo } = await import('../src/utils/doorPinHelper.js');

  const room = {
    id: 1,
    name: 'Venus',
    pin_code: '111111#',
    builtland_pin_code: '222222#'
  };

  const bookingBase = {
    id: 999,
    pin_code: '444444#',
    items: [
      { room_id: 1, room_name: 'Venus', pin_code: '333333#' }
    ]
  };

  // General booking expected: 333333#
  const generalBooking = { ...bookingBase, customer_type: 'general' };
  const generalRes = resolveRoomPinInfo(generalBooking, 1, room);
  assert.strictEqual(generalRes.pin, '333333#', 'General booking must resolve item snapshot 333333#');
  assert.strictEqual(generalRes.pinType, 'general');

  // Internal booking expected: 222222#
  const internalBooking = { ...bookingBase, customer_type: 'builtland' };
  const internalRes = resolveRoomPinInfo(internalBooking, 1, room);
  assert.strictEqual(internalRes.pin, '222222#', 'Internal booking must resolve builtland master 222222#');
  assert.strictEqual(internalRes.pinType, 'internal');
});

test('17. Internal Fallback & pinType (Section 6 & 7): fallback to room.pin_code preserves internal pinType and label', async () => {
  const { resolveRoomPinInfo, getRoomPinLabel } = await import('../src/utils/doorPinHelper.js');

  const room = {
    id: 1,
    name: 'Venus',
    pin_code: '111111#',
    builtland_pin_code: null
  };

  const internalBooking = {
    id: 998,
    customer_type: 'builtland',
    items: [{ room_id: 1, room_name: 'Venus', pin_code: '333333#' }]
  };

  const res = resolveRoomPinInfo(internalBooking, 1, room);
  assert.strictEqual(res.pin, '111111#', 'Internal booking must fall back to room.pin_code 111111#');
  assert.strictEqual(res.pinType, 'internal', 'pinType must remain internal');
  assert.strictEqual(getRoomPinLabel(res.pinType), 'รหัสผ่านห้อง (ภายใน)', 'Label must remain รหัสผ่านห้อง (ภายใน)');
});

test('18. Multi-Room Isolation Contrast (Section 9 & 10): Room A vs Room B exact contrast', async () => {
  const { resolveRoomPinInfo } = await import('../src/utils/doorPinHelper.js');

  const roomA = { id: 1, name: 'Venus', pin_code: '111111#', builtland_pin_code: '211111#' };
  const roomB = { id: 2, name: 'Mars', pin_code: '122222#', builtland_pin_code: '222222#' };

  const items = [
    { room_id: 1, room_name: 'Venus', pin_code: '311111#' },
    { room_id: 2, room_name: 'Mars', pin_code: '322222#' }
  ];

  // Internal booking
  const internalBooking = { id: 501, customer_type: 'builtland', items };
  const intA = resolveRoomPinInfo(internalBooking, 1, roomA);
  const intB = resolveRoomPinInfo(internalBooking, 2, roomB);
  assert.strictEqual(intA.pin, '211111#', 'Internal Room A must resolve 211111#');
  assert.strictEqual(intB.pin, '222222#', 'Internal Room B must resolve 222222#');

  // General booking
  const generalBooking = { id: 502, customer_type: 'general', items };
  const genA = resolveRoomPinInfo(generalBooking, 1, roomA);
  const genB = resolveRoomPinInfo(generalBooking, 2, roomB);
  assert.strictEqual(genA.pin, '311111#', 'General Room A must resolve 311111#');
  assert.strictEqual(genB.pin, '322222#', 'General Room B must resolve 322222#');
});

test('19. UI displays only ONE PIN per booking / room (Section 13)', () => {
  const pendingCode = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');
  const posCode = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // In PendingBookings desktop view, verify it renders single pin tag based on isInternal
  assert.ok(
    pendingCode.includes('{isInternal ? (') && pendingCode.includes('PIN ภายใน') && pendingCode.includes('ลูกค้าทั่วไป'),
    'PendingBookings must conditionally render either internal tag OR general tag, never both'
  );

  // In BookingPOS popover, verify single header based on isInternal
  assert.ok(
    posCode.includes("activePinPopover.isInternal ? 'รหัสผ่านห้อง (ภายใน)' : 'รหัสผ่านห้อง (ลูกค้าทั่วไป)'"),
    'BookingPOS popover must show single relevant header'
  );

  // In BookingPOS daily agenda, verify single pinLabel
  assert.ok(
    posCode.includes("const pinLabel = isInternal ? 'รหัสผ่านห้อง (ภายใน):' : 'รหัสผ่านห้อง (ลูกค้าทั่วไป):';"),
    'Daily agenda must select single pinLabel'
  );
});

test('20. Copy Contract (Section 14): copies exact resolved PIN matching booking type', async () => {
  const { resolveRoomPinInfo } = await import('../src/utils/doorPinHelper.js');

  const room = { id: 1, name: 'Venus', pin_code: '111111#', builtland_pin_code: '222222#' };
  const bookingItems = [{ room_id: 1, room_name: 'Venus', pin_code: '333333#' }];

  // General booking copy target
  const genInfo = resolveRoomPinInfo({ customer_type: 'walkin', items: bookingItems }, 1, room);
  assert.strictEqual(genInfo.pin, '333333#');
  assert.strictEqual(genInfo.pinType, 'general');

  // Internal booking copy target
  const intInfo = resolveRoomPinInfo({ customer_type: 'builtland', items: bookingItems }, 1, room);
  assert.strictEqual(intInfo.pin, '222222#');
  assert.strictEqual(intInfo.pinType, 'internal');
  assert.notStrictEqual(intInfo.pin, genInfo.pin);
});

test('21. Receipt Security (Section 17): strictly absent of all PIN tokens and labels', () => {
  const receiptCode = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf8');

  const forbiddenTokens = [
    '333333#',
    '222222#',
    'pin_code',
    'builtland_pin_code',
    'รหัสผ่านห้อง',
    'รหัสเข้าห้อง',
    'Door PIN',
    'Access PIN'
  ];

  for (const token of forbiddenTokens) {
    assert.ok(!receiptCode.includes(token), `ReceiptPrint must never contain "${token}"`);
  }
});
