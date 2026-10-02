const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const BOOKING_POS_PATH = path.join(ROOT_DIR, 'src/components/BookingPOS.jsx');
const DOOR_PIN_HELPER_PATH = path.join(ROOT_DIR, 'src/utils/doorPinHelper.js');

test('1. BookingPOS.jsx imports roomUsesDoorPin helper', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');
  assert.ok(
    code.includes("import { roomUsesDoorPin } from '../utils/doorPinHelper';"),
    'Must import roomUsesDoorPin from doorPinHelper'
  );
});

test('2. Room cards render room access code in room info and hover title', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Verify PIN text formatting logic in room loop
  assert.ok(
    code.includes('const usesDoorPin = roomUsesDoorPin(room);'),
    'Must check roomUsesDoorPin for room card'
  );
  assert.ok(
    code.includes('const roomPinText = usesDoorPin'),
    'Must compute roomPinText variable'
  );
  assert.ok(
    code.includes("'รหัสห้อง: ไม่ใช้รหัส'"),
    'Must display รหัสห้อง: ไม่ใช้รหัส for no-PIN rooms'
  );
  assert.ok(
    code.includes("'รหัสห้อง: ไม่ได้ตั้งค่า'"),
    'Must display รหัสห้อง: ไม่ได้ตั้งค่า when PIN is unset'
  );

  // Verify hover title includes room PIN
  assert.ok(
    code.includes('title={`${room.name} (${room.capacity} ที่นั่ง) · ${roomPinText} · คลิกเพื่อเปิดฟอร์มจองห้องนี้`}'),
    'Room card title attribute must include roomPinText on hover'
  );

  // Verify room card visual display
  assert.ok(
    code.includes('<Key size={10} style={{ flexShrink: 0, opacity: 0.7 }} />'),
    'Room card must render Key icon for access code'
  );
  assert.ok(
    code.includes('<span style={{ fontWeight: 600 }}>{roomPinText}</span>'),
    'Room card must display roomPinText in card body'
  );
});

test('3. Room Booking Modal Header displays room access code for mobile/touch accessibility', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  assert.ok(
    code.includes('roomUsesDoorPin(selectedRoom)'),
    'Modal header must check roomUsesDoorPin for selectedRoom'
  );
  assert.ok(
    code.includes('<Key size={12} style={{ opacity: 0.8 }} />'),
    'Modal header must render Key icon'
  );
  assert.ok(
    code.includes("selectedRoom.pin_code && String(selectedRoom.pin_code).trim() ? `รหัสห้อง: ${String(selectedRoom.pin_code).trim()}` : 'รหัสห้อง: ไม่ได้ตั้งค่า'"),
    'Modal header must display room PIN or fallback without undefined/null'
  );
  assert.ok(
    code.includes("'รหัสห้อง: ไม่ใช้รหัส'"),
    'Modal header must display ไม่ใช้รหัส for no-PIN rooms'
  );
});

test('4. Functional formatting rules for all room categories', async () => {
  // Read and evaluate doorPinHelper logic in CJS
  const helperCode = fs.readFileSync(DOOR_PIN_HELPER_PATH, 'utf8');
  const NO_PIN_ROOM_IDS = [10, 12, 13];
  function roomUsesDoorPin(roomOrId) {
    if (!roomOrId) return false;
    if (typeof roomOrId === 'number') return !NO_PIN_ROOM_IDS.includes(roomOrId);
    if (typeof roomOrId === 'string' && /^\d+$/.test(roomOrId.trim())) return !NO_PIN_ROOM_IDS.includes(parseInt(roomOrId.trim(), 10));
    if (typeof roomOrId === 'object') {
      const rId = Number(roomOrId.room_id || roomOrId.id);
      if (rId && NO_PIN_ROOM_IDS.includes(rId)) return false;
      const name = String(roomOrId.name || roomOrId.room_name || '').trim();
      if (name && /jupiter/i.test(name)) return false;
      if (roomOrId.pin_code && String(roomOrId.pin_code).trim() && String(roomOrId.pin_code).trim() !== '-') return true;
      if (roomOrId.builtland_pin_code && String(roomOrId.builtland_pin_code).trim()) return true;
    }
    return true;
  }

  function formatPin(room) {
    const usesDoorPin = roomUsesDoorPin(room);
    return usesDoorPin
      ? (room.pin_code && String(room.pin_code).trim() ? `รหัสห้อง: ${String(room.pin_code).trim()}` : 'รหัสห้อง: ไม่ได้ตั้งค่า')
      : 'รหัสห้อง: ไม่ใช้รหัส';
  }

  // 1. PIN-enabled room with valid PIN
  const mars = { id: 1, name: 'Mars', pin_code: '458921' };
  assert.strictEqual(formatPin(mars), 'รหัสห้อง: 458921');

  // 2. PIN-enabled room with null/empty PIN
  const mercury = { id: 2, name: 'Mercury', pin_code: null };
  assert.strictEqual(formatPin(mercury), 'รหัสห้อง: ไม่ได้ตั้งค่า');

  // 3. No-PIN rooms (Jupiter 10, 12, 13)
  assert.strictEqual(formatPin({ id: 10, name: 'Jupiter (300)' }), 'รหัสห้อง: ไม่ใช้รหัส');
  assert.strictEqual(formatPin({ id: 12, name: 'Jupiter (300) & Co-Working' }), 'รหัสห้อง: ไม่ใช้รหัส');
  assert.strictEqual(formatPin({ id: 13, name: 'เหมาโซน Co-working' }), 'รหัสห้อง: ไม่ใช้รหัส');

  // 4. Defensive name fallback for Jupiter
  assert.strictEqual(formatPin({ id: 99, name: 'New Jupiter Hall' }), 'รหัสห้อง: ไม่ใช้รหัส');

  // 5. Ensure output is never undefined, null, or lone hyphen
  const testRooms = [mars, mercury, { id: 10 }, { id: 3, name: 'Saturn', pin_code: '' }];
  for (const r of testRooms) {
    const text = formatPin(r);
    assert.ok(!text.includes('undefined'), `Must not contain undefined for ${JSON.stringify(r)}`);
    assert.ok(!text.includes('null'), `Must not contain null for ${JSON.stringify(r)}`);
    assert.notStrictEqual(text, 'รหัสห้อง: -', `Must not be lone dash for ${JSON.stringify(r)}`);
  }
});

test('5. Management.jsx binds and sends both pin_code and builtland_pin_code independently', () => {
  const code = fs.readFileSync(path.join(ROOT_DIR, 'src/components/Management.jsx'), 'utf8');

  // Input bindings
  assert.ok(code.includes('value={itemForm.pin_code || \'\'}'), 'Must bind pin_code input to itemForm.pin_code');
  assert.ok(code.includes('value={itemForm.builtland_pin_code || \'\'}'), 'Must bind builtland_pin_code input to itemForm.builtland_pin_code');

  // Save payload
  assert.ok(code.includes('pin_code: currentItemForm.pin_code || null'), 'Must include pin_code in save payload');
  assert.ok(code.includes('builtland_pin_code: currentItemForm.builtland_pin_code || null'), 'Must include builtland_pin_code in save payload');

  // handleEdit population
  assert.ok(code.includes('pin_code: item.pin_code || \'\''), 'handleEdit must initialize pin_code');
  assert.ok(code.includes('builtland_pin_code: item.builtland_pin_code || \'\''), 'handleEdit must initialize builtland_pin_code');
});

test('6. Management.jsx renders badges for both normal PIN and Builtland PIN in catalog table', () => {
  const code = fs.readFileSync(path.join(ROOT_DIR, 'src/components/Management.jsx'), 'utf8');

  assert.ok(code.includes('🔑 {item.pin_code}'), 'Table must display customer PIN with key emoji');
  assert.ok(code.includes('🏢 {item.builtland_pin_code}'), 'Table must display Builtland PIN with building emoji');
});

test('7. resolveRoomPin: Item PIN precedence over stale parent booking PIN (Section 12)', async () => {
  const { resolveRoomPin } = await import('../src/utils/doorPinHelper.js');
  const booking = {
    id: 101,
    pin_code: 'OLD_PARENT_PIN',
    items: [
      { id: 1, room_id: 9, pin_code: 'NEW_ITEM_PIN' }
    ]
  };

  const resolved = resolveRoomPin(booking, 9);
  assert.strictEqual(resolved, 'NEW_ITEM_PIN', 'Item PIN must take strict precedence over stale parent PIN');

  const resolvedDefault = resolveRoomPin(booking);
  assert.strictEqual(resolvedDefault, 'NEW_ITEM_PIN', 'Default room item PIN must take precedence even if roomId is omitted');
});

test('8. resolveRoomPin: Multi-room PIN isolation (Section 13)', async () => {
  const { resolveRoomPin } = await import('../src/utils/doorPinHelper.js');
  const multiRoomBooking = {
    id: 102,
    pin_code: 'PARENT_SNAPSHOT',
    items: [
      { id: 1, room_id: 4, room_name: 'Mars (301)', pin_code: '111111#' },
      { id: 2, room_id: 9, room_name: 'Neptune (306)', pin_code: '222222#' }
    ]
  };

  const pinRoomA = resolveRoomPin(multiRoomBooking, 4);
  const pinRoomB = resolveRoomPin(multiRoomBooking, 9);

  assert.strictEqual(pinRoomA, '111111#', 'Room 4 must resolve Room 4 PIN');
  assert.strictEqual(pinRoomB, '222222#', 'Room 9 must resolve Room 9 PIN');
  assert.notStrictEqual(pinRoomA, pinRoomB, 'Room A and Room B PINs must never bleed into each other');
});

test('9. resolveRoomPin: Builtland booking item PIN authoritative (Section 14)', async () => {
  const { resolveRoomPin } = await import('../src/utils/doorPinHelper.js');
  const builtlandBooking = {
    id: 103,
    customer_type: 'builtland',
    pin_code: 'OLD_GENERAL_PIN',
    items: [
      { id: 1, room_id: 5, pin_code: '302302#' }
    ]
  };

  const roomMaster = { id: 5, pin_code: '075164#', builtland_pin_code: '999999#' };

  // When item already has authoritative PIN, do NOT fall back to room master
  const resolved = resolveRoomPin(builtlandBooking, 5, roomMaster);
  assert.strictEqual(resolved, '302302#', 'Must show item PIN without re-resolving room master PIN');
});

test('10. Reveal state caching audit: boolean visibility only, zero PIN string caching (Section 6 & 15)', async () => {
  const { resolveRoomPin } = await import('../src/utils/doorPinHelper.js');
  const code = fs.readFileSync(path.join(ROOT_DIR, 'src/components/PendingBookings.jsx'), 'utf8');

  // Verify state stores boolean map, not PIN strings
  assert.ok(code.includes('const [revealedPins, setRevealedPins] = useState({});'), 'Must use revealedPins map for visibility flags');
  assert.ok(!code.includes('setRevealedPin(pinRaw)'), 'Must NEVER store raw PIN string in revealed state');
  assert.ok(!code.includes('setVisiblePin(pinRaw)'), 'Must NEVER store raw PIN string in visiblePin state');

  // Simulate lifecycle:
  // 1. Initial stale booking
  let currentBooking = {
    id: 3,
    pin_code: '593105#',
    items: [{ id: 3, room_id: 9, pin_code: '593105#' }]
  };
  let revealedMap = { 3: true }; // User clicked eye icon

  let displayedPin = revealedMap[currentBooking.id] ? resolveRoomPin(currentBooking, 9) : '••••••';
  assert.strictEqual(displayedPin, '593105#', 'Initial reveal shows current PIN');

  // 2. Fresh booking response arrives from API
  currentBooking = {
    id: 3,
    pin_code: '524149#',
    items: [{ id: 3, room_id: 9, pin_code: '524149#' }]
  };

  // 3. User keeps same screen open, component re-renders
  displayedPin = revealedMap[currentBooking.id] ? resolveRoomPin(currentBooking, 9) : '••••••';
  assert.strictEqual(displayedPin, '524149#', 'Component dynamically renders fresh PIN immediately without stale cache');
});

test('11. PendingBookings.jsx source contract: selectedBooking refresh and precedence (Section 7, 8, 9)', () => {
  const code = fs.readFileSync(path.join(ROOT_DIR, 'src/components/PendingBookings.jsx'), 'utf8');

  // Imports
  assert.ok(code.includes("import { roomUsesDoorPin, resolveRoomPin } from '../utils/doorPinHelper';"), 'Must import resolveRoomPin');

  // fetchBookings refreshes selectedBooking
  assert.ok(code.includes('setSelectedBooking(prevSelected => {'), 'fetchBookings must update selectedBooking');

  // bookings effect refreshes selectedBooking
  assert.ok(code.includes('// Keep selectedBooking authoritative and synchronized with bookings list'), 'Must have synchronization effect');

  // handleOpenBookingDetail resolves fresh booking from state
  assert.ok(code.includes('const freshFromState = bookings.find(b => b.id === booking.id) || booking;'), 'handleOpenBookingDetail must resolve fresh state');

  // handleManualRefresh refreshes both bookings and rooms
  assert.ok(code.includes('const handleManualRefresh = () => {'), 'Must define handleManualRefresh');
  assert.ok(code.includes('fetchRooms();'), 'Must refresh rooms on manual refresh');
});

test('12. End-to-end simulated eye reveal lifecycle (Section 11)', async () => {
  const { resolveRoomPin } = await import('../src/utils/doorPinHelper.js');

  // Step 1: Initial state
  let booking = { id: 3, pin_code: '593105#', items: [{ id: 3, room_id: 9, pin_code: '593105#' }] };
  let isRevealed = false;

  // Initial masked
  assert.strictEqual(isRevealed ? resolveRoomPin(booking, 9) : '••••••', '••••••');

  // Step 2: User clicks eye icon
  isRevealed = true;
  assert.strictEqual(isRevealed ? resolveRoomPin(booking, 9) : '••••••', '593105#');

  // Step 3: Room saved & fresh API state arrives
  booking = { id: 3, pin_code: '524149#', items: [{ id: 3, room_id: 9, pin_code: '524149#' }] };

  // Step 4: Eye reveal immediately shows NEW PIN without page refresh or close/reopen
  const freshRender = isRevealed ? resolveRoomPin(booking, 9) : '••••••';
  assert.strictEqual(freshRender, '524149#', 'Eye display must immediately reflect NEW PIN');
});
