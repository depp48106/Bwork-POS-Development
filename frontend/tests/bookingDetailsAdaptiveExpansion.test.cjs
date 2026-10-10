const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const HELPER_PATH = pathToFileURL(path.resolve(__dirname, '../src/utils/bookingScheduleHelper.js')).href;
const PENDING_BOOKINGS_PATH = path.resolve(__dirname, '../src/components/PendingBookings.jsx');
const PENDING_BOOKINGS_CSS_PATH = path.resolve(__dirname, '../src/components/PendingBookings.css');

test('1. bookingScheduleHelper exports all required canonical functions', async () => {
  const helper = await import(HELPER_PATH);
  assert.equal(typeof helper.extractCanonicalDateKey, 'function');
  assert.equal(typeof helper.formatThaiDate, 'function');
  assert.equal(typeof helper.formatThaiFullDate, 'function');
  assert.equal(typeof helper.extractTimeHHMM, 'function');
  assert.equal(typeof helper.formatTimeSlot, 'function');
  assert.equal(typeof helper.normalizeBookingItems, 'function');
  assert.equal(typeof helper.groupBookingItemsByDate, 'function');
});

test('2. extractCanonicalDateKey preserves Bangkok wall clock dates without UTC shift', async () => {
  const { extractCanonicalDateKey } = await import(HELPER_PATH);

  // ISO with T
  assert.equal(extractCanonicalDateKey('2026-10-10T08:00:00'), '2026-10-10');
  // ISO early morning (must not shift to previous day)
  assert.equal(extractCanonicalDateKey('2026-10-10T00:30:00'), '2026-10-10');
  // Space separator from SQLite
  assert.equal(extractCanonicalDateKey('2026-10-10 08:00:00'), '2026-10-10');
  // Date-only string
  assert.equal(extractCanonicalDateKey('2026-10-10'), '2026-10-10');
  // Empty / null safety
  assert.equal(extractCanonicalDateKey(null), '');
  assert.equal(extractCanonicalDateKey(undefined), '');
});

test('3. formatThaiDate and formatThaiFullDate output exact Buddhist Era strings', async () => {
  const { formatThaiDate, formatThaiFullDate } = await import(HELPER_PATH);

  assert.equal(formatThaiDate('2026-10-10'), '10 ต.ค. 2569');
  assert.equal(formatThaiDate('2026-01-05'), '5 ม.ค. 2569');
  assert.ok(formatThaiFullDate('2026-10-10').includes('10 ต.ค. 2569'));
  assert.ok(formatThaiFullDate('2026-10-10').startsWith('วัน'));
});

test('4. Scenario 1 (Rule A): Single Room, Single Day', async () => {
  const { groupBookingItemsByDate } = await import(HELPER_PATH);

  const booking = {
    id: 101,
    items: [
      {
        id: 1,
        room_id: 4,
        room_name: 'Mars (301)',
        start_time: '2026-10-10T08:00:00',
        end_time: '2026-10-10T09:00:00',
        price: 800,
        subtotal: 800,
        pin_code: '123456#'
      }
    ]
  };

  const res = groupBookingItemsByDate(booking);
  assert.equal(res.summary.isMultiDate, false, 'Single date must be isMultiDate: false (Rule A)');
  assert.equal(res.summary.totalItems, 1);
  assert.equal(res.summary.uniqueRoomCount, 1);
  assert.equal(res.summary.uniqueDateCount, 1);
  assert.equal(res.summary.dateRangeStr, '10 ต.ค. 2569');
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].items.length, 1);
  assert.equal(res.groups[0].subtotal, 800);
});

test('5. Scenario 2 (Rule A & C): Multi-Room, Same Day', async () => {
  const { groupBookingItemsByDate } = await import(HELPER_PATH);

  const booking = {
    id: 102,
    items: [
      {
        id: 2,
        room_id: 10,
        room_name: 'Jupiter (300)',
        start_time: '2026-10-10T08:00:00',
        end_time: '2026-10-10T09:00:00',
        price: 500,
        subtotal: 500,
        pin_code: null
      },
      {
        id: 3,
        room_id: 5,
        room_name: 'Mercury (302)',
        start_time: '2026-10-10T08:00:00',
        end_time: '2026-10-10T09:00:00',
        price: 400,
        subtotal: 400,
        pin_code: '654321#'
      }
    ]
  };

  const res = groupBookingItemsByDate(booking);
  assert.equal(res.summary.isMultiDate, false, 'Same day must be isMultiDate: false (Rule A)');
  assert.equal(res.summary.totalItems, 2);
  assert.equal(res.summary.uniqueRoomCount, 2);
  assert.equal(res.summary.uniqueDateCount, 1);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].items.length, 2);
  assert.equal(res.groups[0].subtotal, 900);
});

test('6. Scenario 3 (Rule B & D): Same Room, Multiple Days', async () => {
  const { groupBookingItemsByDate } = await import(HELPER_PATH);

  const booking = {
    id: 103,
    items: [
      {
        id: 4,
        room_id: 7,
        room_name: 'Venus (304)',
        start_time: '2026-10-10T09:00:00',
        end_time: '2026-10-10T12:00:00',
        price: 900,
        subtotal: 900,
        pin_code: '111111#'
      },
      {
        id: 5,
        room_id: 7,
        room_name: 'Venus (304)',
        start_time: '2026-10-11T09:00:00',
        end_time: '2026-10-11T12:00:00',
        price: 900,
        subtotal: 900,
        pin_code: '111111#'
      }
    ]
  };

  const res = groupBookingItemsByDate(booking);
  assert.equal(res.summary.isMultiDate, true, 'Multi-day must be isMultiDate: true (Rule B)');
  assert.equal(res.summary.totalItems, 2);
  assert.equal(res.summary.uniqueRoomCount, 1, 'Same room across dates is 1 unique room');
  assert.equal(res.summary.uniqueDateCount, 2);
  assert.equal(res.summary.dateRangeStr, '10 ต.ค. 2569 - 11 ต.ค. 2569 (2 วัน)');
  assert.equal(res.groups.length, 2);
  assert.equal(res.groups[0].dateKey, '2026-10-10');
  assert.equal(res.groups[0].items.length, 1);
  assert.equal(res.groups[1].dateKey, '2026-10-11');
  assert.equal(res.groups[1].items.length, 1);
  assert.equal(res.groups[0].items[0].id, 4);
  assert.equal(res.groups[1].items[0].id, 5);
});

test('7. Scenario 4 (Rule E): Same Room, Multiple Time Slots on Same Date', async () => {
  const { groupBookingItemsByDate } = await import(HELPER_PATH);

  const booking = {
    id: 104,
    items: [
      {
        id: 6,
        room_id: 2,
        room_name: 'Mars (301)',
        start_time: '2026-10-10T13:00:00',
        end_time: '2026-10-10T14:00:00',
        price: 300,
        subtotal: 300,
        pin_code: '844759'
      },
      {
        id: 7,
        room_id: 2,
        room_name: 'Mars (301)',
        start_time: '2026-10-10T08:00:00',
        end_time: '2026-10-10T09:00:00',
        price: 300,
        subtotal: 300,
        pin_code: '844759'
      }
    ]
  };

  const res = groupBookingItemsByDate(booking);
  assert.equal(res.summary.isMultiDate, false);
  assert.equal(res.summary.totalItems, 2);
  assert.equal(res.summary.uniqueRoomCount, 1);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].items.length, 2);
  // Chronological sort within date: 08:00 must come before 13:00
  assert.equal(res.groups[0].items[0].id, 7, 'Earlier slot (08:00) must appear first');
  assert.equal(res.groups[0].items[1].id, 6, 'Later slot (13:00) must appear second');
});

test('8. Scenario 5: Complex Multi-Room, Multi-Day Mixed Booking', async () => {
  const { groupBookingItemsByDate } = await import(HELPER_PATH);

  const booking = {
    id: 105,
    items: [
      {
        id: 8,
        room_id: 4,
        room_name: 'Mars (301)',
        start_time: '2026-10-10T08:00:00',
        end_time: '2026-10-10T09:00:00',
        price: 800,
        subtotal: 800
      },
      {
        id: 9,
        room_id: 5,
        room_name: 'Mercury (302)',
        start_time: '2026-10-10T10:00:00',
        end_time: '2026-10-10T12:00:00',
        price: 800,
        subtotal: 800
      },
      {
        id: 10,
        room_id: 6,
        room_name: 'Saturn (303)',
        start_time: '2026-10-12T13:00:00',
        end_time: '2026-10-12T15:00:00',
        price: 600,
        subtotal: 600
      }
    ]
  };

  const res = groupBookingItemsByDate(booking);
  assert.equal(res.summary.isMultiDate, true);
  assert.equal(res.summary.totalItems, 3);
  assert.equal(res.summary.uniqueRoomCount, 3);
  assert.equal(res.summary.uniqueDateCount, 2);
  assert.equal(res.summary.dateRangeStr, '10 ต.ค. 2569 - 12 ต.ค. 2569 (2 วัน)');
  assert.equal(res.groups.length, 2);
  assert.equal(res.groups[0].items.length, 2);
  assert.equal(res.groups[1].items.length, 1);
  assert.equal(res.groups[0].subtotal, 1600);
  assert.equal(res.groups[1].subtotal, 600);
});

test('9. Payload Immutability: groupBookingItemsByDate does not mutate input', async () => {
  const { groupBookingItemsByDate } = await import(HELPER_PATH);

  const rawBooking = {
    id: 106,
    items: [
      { id: 11, room_id: 4, start_time: '2026-10-10T10:00:00' },
      { id: 12, room_id: 4, start_time: '2026-10-10T08:00:00' }
    ]
  };
  const cloned = JSON.parse(JSON.stringify(rawBooking));

  groupBookingItemsByDate(rawBooking);
  assert.deepStrictEqual(rawBooking, cloned, 'Input booking and items array must remain identical');
});

test('10. Legacy Booking Fallback: Synthesizes single item when items array is empty', async () => {
  const { groupBookingItemsByDate } = await import(HELPER_PATH);

  const legacyBooking = {
    id: 107,
    room_id: 4,
    room_name: 'Mars (301)',
    start_time: '2026-10-10T08:00:00',
    end_time: '2026-10-10T09:00:00',
    total_amount: 800,
    pin_code: '123456#'
  };

  const res = groupBookingItemsByDate(legacyBooking);
  assert.equal(res.summary.totalItems, 1);
  assert.equal(res.summary.uniqueRoomCount, 1);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].items[0].room_name, 'Mars (301)');
});

test('11. PendingBookings.jsx imports schedule helper and declares expansion state', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  assert.ok(code.includes("from '../utils/bookingScheduleHelper';") && code.includes('groupBookingItemsByDate') && code.includes('formatTimeSlot'), 'Must import bookingScheduleHelper');
  assert.ok(code.includes('const [expandedDatesByBooking, setExpandedDatesByBooking] = useState({});'), 'Must declare expandedDatesByBooking state');
  assert.ok(code.includes('const isDateGroupExpanded ='), 'Must define isDateGroupExpanded helper');
  assert.ok(code.includes('const handleToggleDateGroup ='), 'Must define handleToggleDateGroup helper');
  assert.ok(code.includes('const handleToggleAllDates ='), 'Must define handleToggleAllDates helper');
});

test('12. PendingBookings.jsx modal embeds Option A Adaptive Expansion markup', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  // Summary bar & chips
  assert.ok(code.includes('className="pb-detail-summary-bar"'), 'Must render pb-detail-summary-bar');
  assert.ok(code.includes('className="pb-summary-chips"'), 'Must render pb-summary-chips');
  assert.ok(code.includes('className="pb-btn-toggle-all"'), 'Must render pb-btn-toggle-all');

  // Date groups container and cards
  assert.ok(code.includes('className="pb-detail-date-groups"'), 'Must render pb-detail-date-groups');
  assert.ok(code.includes('className="pb-date-group-card"'), 'Must render pb-date-group-card');
  assert.ok(code.includes('className="pb-room-item-card"'), 'Must render pb-room-item-card');
  assert.ok(code.includes('className="pb-room-item-pin-pill"'), 'Must render pb-room-item-pin-pill');
});

test('13. Per-Item PIN Isolation: revealing one item PIN isolates from other items', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  // Verify isPinRevealed definition uses isolated item check
  assert.ok(
    code.includes('if (itemId != null) {') &&
    code.includes('const itemKey = `${bookingId}_item_${itemId}`;') &&
    code.includes('if (revealedPins[itemKey] !== undefined) return Boolean(revealedPins[itemKey]);') &&
    code.includes('return false;'),
    'isPinRevealed must enforce strict per-item isolation'
  );
});

test('14. Door Access Card (Section 3) and LINE OA dispatch remain strictly intact', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  assert.ok(code.includes('การเข้าใช้งานห้อง (Door Access)'), 'Must retain Door Access section');
  assert.ok(code.includes('handleSendPin(b.id)'), 'Must retain handleSendPin dispatch');
  assert.ok(code.includes('ส่งรหัส PIN ให้ลูกค้าผ่าน LINE OA'), 'Must retain LINE OA send button');
});

test('15. PendingBookings.css defines all required Adaptive Expansion classes', () => {
  const css = fs.readFileSync(PENDING_BOOKINGS_CSS_PATH, 'utf8');

  assert.ok(css.includes('.pb-detail-summary-bar'), 'Must define .pb-detail-summary-bar');
  assert.ok(css.includes('.pb-summary-chips'), 'Must define .pb-summary-chips');
  assert.ok(css.includes('.pb-summary-chip'), 'Must define .pb-summary-chip');
  assert.ok(css.includes('.pb-btn-toggle-all'), 'Must define .pb-btn-toggle-all');
  assert.ok(css.includes('.pb-detail-date-groups'), 'Must define .pb-detail-date-groups');
  assert.ok(css.includes('.pb-date-group-card'), 'Must define .pb-date-group-card');
  assert.ok(css.includes('.pb-date-group-header'), 'Must define .pb-date-group-header');
  assert.ok(css.includes('.pb-date-group-body'), 'Must define .pb-date-group-body');
  assert.ok(css.includes('.pb-room-item-card'), 'Must define .pb-room-item-card');
  assert.ok(css.includes('.pb-room-item-pin-pill'), 'Must define .pb-room-item-pin-pill');
  assert.ok(css.includes('.pb-chevron-icon'), 'Must define .pb-chevron-icon');
});

test('16. Scenario 6: Duplicate-looking legitimate booking items are never silently merged', async () => {
  const { groupBookingItemsByDate } = await import(HELPER_PATH);

  const booking = {
    id: 108,
    items: [
      {
        id: 201,
        room_id: 4,
        room_name: 'Mars (301)',
        start_time: '2026-10-10T08:00:00',
        end_time: '2026-10-10T09:00:00',
        price: 800,
        subtotal: 800
      },
      {
        id: 202,
        room_id: 4,
        room_name: 'Mars (301)',
        start_time: '2026-10-10T08:00:00',
        end_time: '2026-10-10T09:00:00',
        price: 800,
        subtotal: 800
      }
    ]
  };

  const res = groupBookingItemsByDate(booking);
  assert.equal(res.summary.totalItems, 2, 'Must preserve both legitimate duplicate items');
  assert.equal(res.summary.uniqueRoomCount, 1, 'Distinct room count is 1');
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].items.length, 2, 'Both items must exist in group');
  assert.equal(res.groups[0].items[0].id, 201);
  assert.equal(res.groups[0].items[1].id, 202);
  assert.equal(res.groups[0].subtotal, 1600);
});

test('17. Scenario 7: Multiple rooms across multiple days', async () => {
  const { groupBookingItemsByDate } = await import(HELPER_PATH);

  const booking = {
    id: 109,
    items: [
      { id: 301, room_id: 4, room_name: 'Mars', start_time: '2026-10-10T08:00:00', end_time: '2026-10-10T09:00:00' },
      { id: 302, room_id: 5, room_name: 'Mercury', start_time: '2026-10-10T09:00:00', end_time: '2026-10-10T10:00:00' },
      { id: 303, room_id: 5, room_name: 'Mercury', start_time: '2026-10-11T09:00:00', end_time: '2026-10-11T10:00:00' },
      { id: 304, room_id: 6, room_name: 'Saturn', start_time: '2026-10-11T10:00:00', end_time: '2026-10-11T11:00:00' }
    ]
  };

  const res = groupBookingItemsByDate(booking);
  assert.equal(res.summary.isMultiDate, true);
  assert.equal(res.summary.uniqueRoomCount, 3, 'Unique rooms: Mars, Mercury, Saturn');
  assert.equal(res.summary.uniqueDateCount, 2, 'Dates: 2026-10-10, 2026-10-11');
  assert.equal(res.summary.totalItems, 4);
  assert.equal(res.groups.length, 2);
  assert.equal(res.groups[0].items.length, 2);
  assert.equal(res.groups[1].items.length, 2);
});

test('18. Item-to-PIN Association: distinct room items resolve distinct PINs safely', async () => {
  const { resolveRoomPinInfo, roomUsesDoorPin } = await import(pathToFileURL(path.resolve(__dirname, '../src/utils/doorPinHelper.js')).href);

  const rooms = [
    { id: 4, name: 'Mars (301)', pin_code: '111111#', builtland_pin_code: '999111#' },
    { id: 10, name: 'Jupiter (300)', pin_code: null, builtland_pin_code: null }
  ];

  const booking = {
    id: 500,
    customer_type: 'general',
    items: [
      { id: 1, room_id: 4, pin_code: 'snapMars#' },
      { id: 2, room_id: 10, pin_code: null }
    ]
  };

  // Mars has PIN capability
  assert.equal(roomUsesDoorPin(rooms[0]), true);
  const marsPinInfo = resolveRoomPinInfo(booking, 4, rooms[0]);
  assert.equal(marsPinInfo.pin, 'snapMars#');
  assert.equal(marsPinInfo.pinType, 'general');

  // Jupiter has NO PIN capability
  assert.equal(roomUsesDoorPin(rooms[1]), false);
  const jupiterPinInfo = resolveRoomPinInfo(booking, 10, rooms[1]);
  assert.equal(jupiterPinInfo.pin, '');
  assert.equal(jupiterPinInfo.pinType, 'none');
});

test('19. Scenario A: Same room, different dates, different PINs resolve item-specific PINs', async () => {
  const { resolveBookingItemPinInfo } = await import(HELPER_PATH);

  const room = { id: 7, name: 'Venus (303)', pin_code: 'master_room7#' };
  const booking = {
    id: 601,
    customer_type: 'general',
    items: [
      { id: 101, room_id: 7, booking_date: '2026-10-15', pin_code: 'item_day1_pin#' },
      { id: 102, room_id: 7, booking_date: '2026-10-16', pin_code: 'item_day2_pin#' }
    ]
  };

  const item1Pin = resolveBookingItemPinInfo(booking, booking.items[0], room);
  const item2Pin = resolveBookingItemPinInfo(booking, booking.items[1], room);

  assert.equal(item1Pin.pin, 'item_day1_pin#');
  assert.equal(item1Pin.pinType, 'general');
  assert.equal(item2Pin.pin, 'item_day2_pin#');
  assert.equal(item2Pin.pinType, 'general');
  assert.notEqual(item1Pin.pin, item2Pin.pin, 'Items must not have collided PINs');
});

test('20. Scenario B: Same room, same date, different time slots and different PINs retain own PINs', async () => {
  const { resolveBookingItemPinInfo } = await import(HELPER_PATH);

  const room = { id: 7, name: 'Venus (303)', pin_code: 'master_room7#' };
  const booking = {
    id: 602,
    customer_type: 'general',
    items: [
      { id: 201, room_id: 7, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T11:00:00', pin_code: 'slot1_pin#' },
      { id: 202, room_id: 7, start_time: '2026-10-15T13:00:00', end_time: '2026-10-15T15:00:00', pin_code: 'slot2_pin#' }
    ]
  };

  const slot1 = resolveBookingItemPinInfo(booking, booking.items[0], room);
  const slot2 = resolveBookingItemPinInfo(booking, booking.items[1], room);

  assert.equal(slot1.pin, 'slot1_pin#');
  assert.equal(slot2.pin, 'slot2_pin#');
});

test('21. Scenario C: Same room, different dates, same PIN resolve identical PIN', async () => {
  const { resolveBookingItemPinInfo } = await import(HELPER_PATH);

  const room = { id: 7, name: 'Venus (303)', pin_code: 'master_room7#' };
  const booking = {
    id: 603,
    customer_type: 'general',
    items: [
      { id: 301, room_id: 7, booking_date: '2026-10-15', pin_code: 'shared_pin#' },
      { id: 302, room_id: 7, booking_date: '2026-10-16', pin_code: 'shared_pin#' }
    ]
  };

  const res1 = resolveBookingItemPinInfo(booking, booking.items[0], room);
  const res2 = resolveBookingItemPinInfo(booking, booking.items[1], room);

  assert.equal(res1.pin, 'shared_pin#');
  assert.equal(res2.pin, 'shared_pin#');
});

test('22. Scenario D: Second item has no PIN must NOT inherit first item PIN', async () => {
  const { resolveBookingItemPinInfo } = await import(HELPER_PATH);

  const room = { id: 7, name: 'Venus (303)', pin_code: 'master_room7#' };
  const booking = {
    id: 604,
    customer_type: 'general',
    pin_code: 'booking_level_pin#',
    items: [
      { id: 401, room_id: 7, pin_code: 'item1_custom_pin#' },
      { id: 402, room_id: 7, pin_code: null }
    ]
  };

  const res1 = resolveBookingItemPinInfo(booking, booking.items[0], room);
  const res2 = resolveBookingItemPinInfo(booking, booking.items[1], room);

  assert.equal(res1.pin, 'item1_custom_pin#');
  // Second item must NOT inherit item 1's pin; it must fallback to booking-level pin
  assert.equal(res2.pin, 'booking_level_pin#');
  assert.notEqual(res2.pin, res1.pin);

  // If booking has no booking-level pin either, fallback to room master
  const bookingNoFallback = { id: 605, customer_type: 'general', items: booking.items };
  const res2RoomMaster = resolveBookingItemPinInfo(bookingNoFallback, booking.items[1], room);
  assert.equal(res2RoomMaster.pin, 'master_room7#');

  // If room master also has no PIN, return empty
  const res2Empty = resolveBookingItemPinInfo(bookingNoFallback, booking.items[1], { id: 7, name: 'Venus' });
  assert.equal(res2Empty.pin, '');
  assert.equal(res2Empty.pinType, 'none');
});

test('23. Scenario E: First item has no PIN, second item has PIN resolves second item own PIN', async () => {
  const { resolveBookingItemPinInfo } = await import(HELPER_PATH);

  const room = { id: 7, name: 'Venus (303)', pin_code: null };
  const booking = {
    id: 606,
    customer_type: 'general',
    items: [
      { id: 501, room_id: 7, pin_code: null },
      { id: 502, room_id: 7, pin_code: 'item2_authoritative_pin#' }
    ]
  };

  const res1 = resolveBookingItemPinInfo(booking, booking.items[0], room);
  const res2 = resolveBookingItemPinInfo(booking, booking.items[1], room);

  assert.equal(res1.pin, '');
  assert.equal(res1.pinType, 'none');
  assert.equal(res2.pin, 'item2_authoritative_pin#');
  assert.equal(res2.pinType, 'general');
});

test('24. Scenario F: Multiple rooms resolve each room own PIN', async () => {
  const { resolveBookingItemPinInfo } = await import(HELPER_PATH);

  const roomMars = { id: 4, name: 'Mars (301)', pin_code: 'master_mars#' };
  const roomMercury = { id: 5, name: 'Mercury (302)', pin_code: 'master_mercury#' };
  const booking = {
    id: 607,
    customer_type: 'general',
    items: [
      { id: 601, room_id: 4, pin_code: 'pin_mars#' },
      { id: 602, room_id: 5, pin_code: 'pin_mercury#' }
    ]
  };

  const resMars = resolveBookingItemPinInfo(booking, booking.items[0], roomMars);
  const resMercury = resolveBookingItemPinInfo(booking, booking.items[1], roomMercury);

  assert.equal(resMars.pin, 'pin_mars#');
  assert.equal(resMercury.pin, 'pin_mercury#');
});

test('25. Scenario G: Internal/Builtland bookings use staff room PIN and never customer item PIN', async () => {
  const { resolveBookingItemPinInfo } = await import(HELPER_PATH);

  const room = {
    id: 4,
    name: 'Mars (301)',
    builtland_pin_code: 'staff_builtland_pin#',
    pin_code: 'general_room_master_pin#'
  };
  const internalBooking = {
    id: 608,
    customer_type: 'builtland',
    items: [
      { id: 701, room_id: 4, pin_code: 'customer_pin_leak_attempt#' }
    ]
  };

  const res = resolveBookingItemPinInfo(internalBooking, internalBooking.items[0], room);
  assert.equal(res.pin, 'staff_builtland_pin#');
  assert.equal(res.pinType, 'internal');
  assert.notEqual(res.pin, 'customer_pin_leak_attempt#', 'Customer item PIN must never leak into internal booking');

  // Fallback to room master pin_code if builtland_pin_code is missing
  const roomFallback = { id: 4, name: 'Mars (301)', builtland_pin_code: null, pin_code: 'staff_fallback_master#' };
  const resFallback = resolveBookingItemPinInfo(internalBooking, internalBooking.items[0], roomFallback);
  assert.equal(resFallback.pin, 'staff_fallback_master#');
  assert.equal(resFallback.pinType, 'internal');
});

test('26. Scenario H: No-PIN rooms resolve none and disable controls', async () => {
  const { resolveBookingItemPinInfo } = await import(HELPER_PATH);

  const noPinRoom10 = { id: 10, name: 'Jupiter (300)' };
  const noPinRoom12 = { id: 12, name: 'Jupiter (300) & Co-Working' };
  const noPinRoom13 = { id: 13, name: 'เหมาโซน Co-working' };

  for (const r of [noPinRoom10, noPinRoom12, noPinRoom13]) {
    const booking = {
      id: 609,
      customer_type: 'general',
      items: [{ id: 801, room_id: r.id, pin_code: 'should_be_ignored#' }]
    };
    const res = resolveBookingItemPinInfo(booking, booking.items[0], r);
    assert.equal(res.pin, '');
    assert.equal(res.pinType, 'none');
  }
});

test('27. Scenario I & J: PendingBookings.jsx enforces default masking, isolated reveal state, and item copy key', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  // Imports resolveBookingItemPinInfo
  assert.ok(code.includes('resolveBookingItemPinInfo'), 'Must import and use resolveBookingItemPinInfo');

  // Item card calls resolveBookingItemPinInfo
  assert.ok(code.includes('resolveBookingItemPinInfo(b, it, itRoom)'), 'Must call resolveBookingItemPinInfo with b, it, itRoom');

  // Stable item ID and isolated key
  assert.ok(code.includes('const itemStableId = it.id != null ? it.id : `idx_${grpIdx}_${itemIdx}`;'), 'Must derive stable item ID');
  assert.ok(code.includes('const itKey = `${b.id}_item_${itemStableId}`;'), 'Must derive isolated item copy key');

  // Default masking
  assert.ok(code.includes("{isItRevealed ? itPin : '••••••'}"), 'PIN value must be masked with 6 bullets when not revealed');

  // Per-item reveal toggle passing itemStableId
  assert.ok(code.includes('handleToggleRevealPin(b.id, itemStableId)'), 'Reveal toggle must pass itemStableId');

  // Per-item copy passing exact itKey and itPin
  assert.ok(code.includes('handleCopyPin(itKey, itPin)'), 'Copy trigger must pass item-specific key and authoritative item PIN');
});
