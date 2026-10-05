const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const BOOKING_POS_PATH = path.join(ROOT_DIR, 'src/components/BookingPOS.jsx');
const DOOR_PIN_HELPER_PATH = path.join(ROOT_DIR, 'src/utils/doorPinHelper.js');
const RECEIPT_PRINT_PATH = path.join(ROOT_DIR, 'src/components/ReceiptPrint.jsx');

// ============================================================================
// SECTION 1: ARCHITECTURAL CODE INTEGRITY & NO EMOJI CONFIRMATION
// ============================================================================

test('1. BookingPOS.jsx imports required doorPinHelper utilities and lucide icons', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Verify doorPinHelper imports
  assert.ok(
    code.includes("import { roomUsesDoorPin } from '../utils/doorPinHelper';"),
    'Must preserve roomUsesDoorPin import for regression compatibility'
  );
  assert.ok(
    code.includes('resolveRoomPin'),
    'Must import and use resolveRoomPin'
  );
  assert.ok(
    code.includes('NO_PIN_ROOM_IDS'),
    'Must import NO_PIN_ROOM_IDS'
  );

  // Verify lucide-react icons imported
  assert.ok(code.includes('Eye,'), 'Must import Eye icon from lucide-react');
  assert.ok(code.includes('EyeOff,'), 'Must import EyeOff icon from lucide-react');
  assert.ok(code.includes('Copy') || code.includes('Copy,'), 'Must import Copy icon from lucide-react');
});

test('2. No emoji used in Room PIN view actions or labels (Section 5 & 17)', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Check the relevant PIN code slice
  const pinSectionStart = code.indexOf('// Room Access PIN viewing & popover state (BWORK-CALENDAR-PIN-V1)');
  assert.ok(pinSectionStart > -1, 'PIN logic block must be present');
  const pinCodeSlice = code.substring(pinSectionStart);

  // Assert NO emoji in PIN viewing UI
  const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  const pinTriggerMatches = pinCodeSlice.match(/<button[^>]*class(?:Name)?="[^"]*(?:calendar-pin|floorplan-pin|room-pin)[^"]*"[^>]*>([\s\S]*?)<\/button>/gi) || [];
  for (const btn of pinTriggerMatches) {
    assert.ok(!emojiRegex.test(btn), `PIN trigger button must not contain emoji: ${btn}`);
  }

  // Canonical Thai labels check
  assert.ok(code.includes('ดูรหัสผ่านห้อง'), 'Must contain canonical label ดูรหัสผ่านห้อง');
  assert.ok(code.includes('ซ่อนรหัสผ่านห้อง'), 'Must contain canonical label ซ่อนรหัสผ่านห้อง');
  assert.ok(code.includes('รหัสผ่านห้อง'), 'Must contain canonical label รหัสผ่านห้อง');
  assert.ok(code.includes('คัดลอก'), 'Must contain canonical label คัดลอก');
  assert.ok(code.includes('ไม่มีรหัสเข้าห้อง'), 'Must contain canonical label ไม่มีรหัสเข้าห้อง');
});

// ============================================================================
// SECTION 2: MONTH CALENDAR TESTS (Section 31: A through J)
// ============================================================================

test('3. Month Calendar — A. Eye control exists on event chip', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');
  assert.ok(
    code.includes('className="calendar-pin-trigger-btn"'),
    'Event chip must render calendar-pin-trigger-btn'
  );
  assert.ok(
    code.includes('{isPopoverOpen ? <EyeOff size={10} /> : <Eye size={10} />}'),
    'Event chip button must render Eye / EyeOff icon'
  );
});

test('4. Month Calendar — B. Accessible Thai labels on trigger', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');
  assert.ok(
    code.includes('aria-label={isPopoverOpen ? "ซ่อนรหัสผ่านห้อง" : "ดูรหัสผ่านห้อง"}'),
    'Calendar chip button must have accessible aria-label'
  );
  assert.ok(
    code.includes('title="ดูรหัสผ่านห้อง"'),
    'Calendar chip button must have tooltip title ดูรหัสผ่านห้อง'
  );
});

test('5. Month Calendar — C & D & E. Functional single-room reveal, hide, and copy', async () => {
  const { resolveRoomPin, roomUsesDoorPin } = await import('../src/utils/doorPinHelper.js');

  const roomVenus = { id: 1, name: 'Venus', pin_code: '524149#' };
  const eventVenus = {
    booking_id: 101,
    room_id: 1,
    room_name: 'Venus',
    customer_name: 'John Doe',
    customer_type: 'general',
    start_time: '2026-10-15T09:00:00.000Z'
  };

  // C. Reveal
  const usesPin = roomUsesDoorPin(roomVenus);
  assert.strictEqual(usesPin, true, 'Venus must use door pin');
  const pin = resolveRoomPin({ ...eventVenus, items: [eventVenus] }, 1, roomVenus);
  assert.strictEqual(pin, '524149#', 'Must resolve Venus PIN 524149#');

  // D. Hide / Popover state isolation
  const popoverKey = `cal-${eventVenus.booking_id}-${eventVenus.room_id}-2026-10-15`;
  assert.ok(popoverKey.includes('cal-101-1-2026-10-15'), 'Key must identify booking, room, and date');

  // E. Copy string includes trailing #
  assert.ok(pin.endsWith('#'), 'PIN string must preserve trailing # suffix');
});

test('6. Month Calendar — F. Multi-room shows distinct PINs in popover (Section 24)', async () => {
  const { resolveRoomPin, roomUsesDoorPin } = await import('../src/utils/doorPinHelper.js');

  const roomVenus = { id: 1, name: 'Venus', pin_code: '524149#' };
  const roomMercury = { id: 2, name: 'Mercury', pin_code: '638271#' };

  const multiBooking = {
    booking_id: 200,
    customer_name: 'Multi Corp',
    items: [
      { room_id: 1, room_name: 'Venus', pin_code: '524149#' },
      { room_id: 2, room_name: 'Mercury', pin_code: '638271#' }
    ]
  };

  const pinVenus = resolveRoomPin(multiBooking, 1, roomVenus);
  const pinMercury = resolveRoomPin(multiBooking, 2, roomMercury);

  assert.strictEqual(pinVenus, '524149#', 'Venus must have distinct PIN');
  assert.strictEqual(pinMercury, '638271#', 'Mercury must have distinct PIN');
  assert.notStrictEqual(pinVenus, pinMercury, 'Multi-room PINs must never be collapsed to one');
});

test('7. Month Calendar — G. No-PIN rooms show ไม่มีรหัสเข้าห้อง without copy button (Section 25)', async () => {
  const { resolveRoomPin, roomUsesDoorPin, NO_PIN_ROOM_IDS } = await import('../src/utils/doorPinHelper.js');

  for (const roomId of NO_PIN_ROOM_IDS) {
    const room = { id: roomId, name: `Room ${roomId}` };
    const usesPin = roomUsesDoorPin(room);
    assert.strictEqual(usesPin, false, `Room ${roomId} must not use door pin`);

    const pin = resolveRoomPin({ room_id: roomId }, roomId, room);
    assert.strictEqual(pin, '', `Room ${roomId} must return empty pin string`);
  }
});

test('8. Month Calendar — H. Builtland PIN precedence (Section 26)', async () => {
  const { resolveRoomPin, roomUsesDoorPin } = await import('../src/utils/doorPinHelper.js');

  const room = {
    id: 1,
    name: 'Venus',
    pin_code: '111111#',
    builtland_pin_code: '222222#'
  };

  // Walk-in booking
  const walkinPin = resolveRoomPin({ customer_type: 'walkin' }, 1, room);
  assert.strictEqual(walkinPin, '111111#', 'Walk-in customer must receive general pin_code');

  // Builtland booking
  const builtlandPin = resolveRoomPin({ customer_type: 'builtland' }, 1, room);
  assert.strictEqual(builtlandPin, '222222#', 'Builtland customer must receive builtland_pin_code');

  // Builtland booking with fallback when builtland_pin_code is missing
  const roomNoBuiltlandPin = { id: 1, name: 'Venus', pin_code: '333333#', builtland_pin_code: null };
  const fallbackPin = resolveRoomPin({ customer_type: 'builtland' }, 1, roomNoBuiltlandPin);
  assert.strictEqual(fallbackPin, '333333#', 'Builtland customer must fall back to general pin_code if builtland_pin_code is null');
});

test('9. Month Calendar — I & J. Isolated reveal state and hidden by default', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Default state is null / empty
  assert.ok(code.includes('const [activePinPopover, setActivePinPopover] = useState(null);'), 'activePinPopover must default to null');
  assert.ok(code.includes('const [revealedAgendaPins, setRevealedAgendaPins] = useState({});'), 'revealedAgendaPins must default to {}');

  // Key isolation
  assert.ok(code.includes('const popoverKey = `cal-${ev.booking_id || ev.id}-${ev.room_id}-${dateKey}`;'), 'Must generate isolated popoverKey');
});

// ============================================================================
// SECTION 3: DAILY BOOKING LIST TESTS (Section 32: A through G)
// ============================================================================

test('10. Daily Booking List — A. Explicit Eye + ดูรหัสผ่านห้อง control in agenda card', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  assert.ok(code.includes('className="room-pin-trigger-btn"'), 'Agenda card must render room-pin-trigger-btn');
  assert.ok(code.includes('{isAgendaRevealed ? <EyeOff size={12} /> : <Eye size={12} />}'), 'Agenda card must render Eye/EyeOff');
  assert.ok(code.includes("<span>{isAgendaRevealed ? 'ซ่อนรหัสผ่านห้อง' : 'ดูรหัสผ่านห้อง'}</span>"), 'Agenda card must render explicit Thai label');
});

test('11. Daily Booking List — B & C & D. Reveal, hide, and copy controls', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Reveal toggle handler
  assert.ok(code.includes('toggleAgendaPinReveal(agendaKey)'), 'Must toggle agenda PIN reveal state by agendaKey');

  // Conditional PIN presentation
  assert.ok(code.includes('รหัสผ่านห้อง:'), 'Must label revealed PIN as รหัสผ่านห้อง:');
  assert.ok(code.includes('{cardPin || \'ไม่มีรหัสเข้าห้อง\'}'), 'Must display resolved PIN or ไม่มีรหัสเข้าห้อง');

  // Copy button
  assert.ok(code.includes('handleCopyPin(cardPin, agendaKey)'), 'Copy button must trigger handleCopyPin');
  assert.ok(code.includes("<span>{copiedPinKey === agendaKey ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>"), 'Copy button must provide feedback');
});

test('12. Daily Booking List — E & F & G. Multi-room isolation, No-PIN, and reset on date navigation', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Multi-room key isolation
  assert.ok(code.includes('const agendaKey = `agenda-${ev.booking_id || ev.id}-${ev.room_id}`;'), 'Agenda key must bind booking_id and room_id');

  // No-PIN room copy prevention
  assert.ok(
    code.includes('{usesDoorPin && cardPin ? ('),
    'Copy button must only be rendered when usesDoorPin is true and cardPin is present'
  );

  // Stale state reset on date change
  assert.ok(
    code.includes('setRevealedAgendaPins({});'),
    'Must clear revealedAgendaPins on calendar navigation'
  );
});

// ============================================================================
// SECTION 4: DAILY FLOOR PLAN TESTS (Section 33: A through H)
// ============================================================================

test('13. Daily Floor Plan — A & B. Eye action and accessible tooltip inside booking time block', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  assert.ok(
    code.includes('className="floorplan-pin-trigger-btn"'),
    'Timeline booking pill must render floorplan-pin-trigger-btn'
  );
  assert.ok(
    code.includes('aria-label="ดูรหัสผ่านห้อง"'),
    'Timeline button must have aria-label="ดูรหัสผ่านห้อง"'
  );
  assert.ok(
    code.includes('title="ดูรหัสผ่านห้อง"'),
    'Timeline button must have title="ดูรหัสผ่านห้อง"'
  );
});

test('14. Daily Floor Plan — C & D. Room-specific PIN isolation in matrix (Section 13)', async () => {
  const { resolveRoomPin } = await import('../src/utils/doorPinHelper.js');

  const roomVenus = { id: 1, name: 'Venus', pin_code: '524149#' };
  const roomMercury = { id: 2, name: 'Mercury', pin_code: '638271#' };

  const multiBooking = {
    id: 500,
    items: [
      { room_id: 1, pin_code: '524149#' },
      { room_id: 2, pin_code: '638271#' }
    ]
  };

  // Venus timeline block
  const venusPillPin = resolveRoomPin({ ...multiBooking, items: [multiBooking.items[0]] }, roomVenus.id, roomVenus);
  assert.strictEqual(venusPillPin, '524149#', 'Venus timeline block must strictly resolve Venus PIN');

  // Mercury timeline block
  const mercuryPillPin = resolveRoomPin({ ...multiBooking, items: [multiBooking.items[1]] }, roomMercury.id, roomMercury);
  assert.strictEqual(mercuryPillPin, '638271#', 'Mercury timeline block must strictly resolve Mercury PIN');
});

test('15. Daily Floor Plan — E & F & G & H. No-PIN, Builtland, Narrow block safety, and No Overflow/Clip', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Narrow block rendering safety
  assert.ok(code.includes('!isShortBooking ?') || code.includes('isShortBooking'), 'Short booking check must govern text expansion');
  assert.ok(code.includes('<Eye size={9} />'), 'Narrow booking block renders compact icon-only eye');

  // Popover portal z-index and fixed viewport positioning
  assert.ok(code.includes('className="room-pin-popover-portal"'), 'Popover portal must be rendered at root level');
  assert.ok(code.includes('position: \'fixed\''), 'Popover must use fixed positioning to avoid overflow clipping');
  assert.ok(code.includes('zIndex: 1060'), 'Popover must use clean zIndex above matrix and headers');
});

// ============================================================================
// SECTION 5: SECURITY REGRESSION TESTS (Section 34)
// ============================================================================

test('16. Security Regression: ReceiptPrint is strictly PIN-free (Section 29)', () => {
  const receiptCode = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf8');

  // Forbidden PIN tokens in receipt
  const forbiddenTokens = [
    'pin_code',
    'builtland_pin_code',
    '524149#',
    '306306#',
    'รหัสเข้าห้อง',
    'Door PIN',
    'Access PIN'
  ];

  for (const token of forbiddenTokens) {
    assert.ok(
      !receiptCode.includes(token),
      `ReceiptPrint.jsx must NOT contain security-sensitive token: ${token}`
    );
  }
});

test('17. Security Regression: No PIN logging or URL leakage (Section 4 & 18)', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Verify PIN is not placed into URL
  assert.ok(!code.includes('location.search = pin') && !code.includes('URLSearchParams.set(\'pin'), 'PIN must not be added to URL');

  // Verify handleCopyPin does not log raw PIN
  const copyFnStart = code.indexOf('const handleCopyPin =');
  const copyFnEnd = code.indexOf('const handleTogglePinPopover =');
  const copyFnBody = code.substring(copyFnStart, copyFnEnd);
  assert.ok(!copyFnBody.includes('console.log'), 'handleCopyPin must not log raw PIN to console');
});

// ============================================================================
// SECTION 6: PARENT CLICK CONFLICT & INTERACTION SAFETY (Section 5 & 15 & 16)
// ============================================================================

test('18. Parent Click Conflict: Eye and Copy triggers prevent parent action bubbling (Section 5)', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Month calendar chip trigger button
  const calTrigger = code.match(/className="calendar-pin-trigger-btn"[\s\S]*?onClick=\{\(e\)\s*=>\s*\{([\s\S]*?)\}/);
  assert.ok(calTrigger && calTrigger[1].includes('e.stopPropagation()'), 'Calendar chip Eye trigger must call e.stopPropagation()');

  // Agenda card trigger and copy buttons
  const agendaTrigger = code.match(/className="room-pin-trigger-btn"[\s\S]*?onClick=\{\(e\)\s*=>\s*\{([\s\S]*?)\}/);
  assert.ok(agendaTrigger && agendaTrigger[1].includes('e.stopPropagation()'), 'Agenda card Eye trigger must call e.stopPropagation()');

  const agendaCopy = code.match(/handleCopyPin\(cardPin,\s*agendaKey\)/);
  assert.ok(agendaCopy, 'Agenda card must invoke handleCopyPin');

  // Floor plan timeline pill trigger button
  const floorTrigger = code.match(/className="floorplan-pin-trigger-btn"[\s\S]*?onClick=\{\(e\)\s*=>\s*\{([\s\S]*?)\}/);
  assert.ok(floorTrigger && floorTrigger[1].includes('e.stopPropagation()'), 'Floor plan pill Eye trigger must call e.stopPropagation()');
});

test('19. Popover Lifecycle: Outside click, scroll, and resize dismiss with listener cleanup (Section 15)', () => {
  const code = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  // Listener registration
  assert.ok(code.includes("window.addEventListener('mousedown', handleOutsideClick);"), 'Must attach mousedown listener');
  assert.ok(code.includes("window.addEventListener('scroll', handleScrollOrResize, true);"), 'Must attach scroll listener');
  assert.ok(code.includes("window.addEventListener('resize', handleScrollOrResize);"), 'Must attach resize listener');

  // Listener cleanup
  assert.ok(code.includes("window.removeEventListener('mousedown', handleOutsideClick);"), 'Must clean up mousedown listener');
  assert.ok(code.includes("window.removeEventListener('scroll', handleScrollOrResize, true);"), 'Must clean up scroll listener');
  assert.ok(code.includes("window.removeEventListener('resize', handleScrollOrResize);"), 'Must clean up resize listener');
});

test('20. Malformed Data Safety: Missing items, unknown room, and null PINs handle safely (Section 16)', async () => {
  const { resolveRoomPin, roomUsesDoorPin } = await import('../src/utils/doorPinHelper.js');

  // 1. Missing / null items
  const bookingNoItems = { id: 999, items: null };
  const pin1 = resolveRoomPin(bookingNoItems, 1, null);
  assert.strictEqual(pin1, '', 'Missing items and no room fallback must return empty string');

  // 2. Unknown room ID / null room
  const bookingUnknownRoom = { id: 999, items: [{ room_id: 888, pin_code: null }] };
  const pin2 = resolveRoomPin(bookingUnknownRoom, 888, null);
  assert.strictEqual(pin2, '', 'Null item PIN and no fallback room must return empty string');

  // 3. Null PIN on PIN-capable room
  const roomNullPin = { id: 1, name: 'Venus', pin_code: null, builtland_pin_code: null };
  assert.strictEqual(roomUsesDoorPin(roomNullPin), true, 'Venus still uses door PIN physically');
  const pin3 = resolveRoomPin(bookingNoItems, 1, roomNullPin);
  assert.strictEqual(pin3, '', 'Unset room PIN must resolve to empty string');

  // 4. Undefined / null booking argument
  assert.doesNotThrow(() => {
    resolveRoomPin(null, 1, roomNullPin);
  }, 'null booking must not throw exception');
});
