const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const HELPER_PATH = pathToFileURL(path.resolve(__dirname, '../src/utils/bookingScheduleHelper.js')).href;
const PENDING_BOOKINGS_PATH = path.resolve(__dirname, '../src/components/PendingBookings.jsx');
const PENDING_BOOKINGS_CSS_PATH = path.resolve(__dirname, '../src/components/PendingBookings.css');

const mockRooms = [
  { id: 4, name: 'Mars (301)' },
  { id: 5, name: 'Mercury (302)' },
  { id: 6, name: 'Venus (304)' },
  { id: 7, name: 'Uranus (305)' }
];

test('1. Scenario 1: Single item preserves normal compact presentation (Case A)', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 101,
    booking_code: 'BK-000101',
    items: [
      {
        id: 1,
        room_id: 7,
        room_name: 'Uranus (305)',
        start_time: '2026-10-15T09:00:00',
        end_time: '2026-10-15T12:00:00',
        layout: 'standard',
        booking_type: 'hourly'
      }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);

  assert.equal(summary.caseType, 'single');
  assert.equal(summary.isMultiItem, false);
  assert.equal(summary.totalItems, 1);
  assert.equal(summary.uniqueRoomCount, 1);
  assert.equal(summary.uniqueDateCount, 1);
  assert.equal(summary.roomName, 'Uranus (305)');
  assert.equal(summary.usageDateStr, '15 ต.ค. 2569');
  assert.equal(summary.timeDisplay, '09:00 - 12:00 น.');
  assert.equal(summary.layoutLabel, 'Standard');
  assert.equal(summary.typeLabel, 'รายชั่วโมง');
  assert.deepEqual(summary.badges, []);
});

test('2. Scenario 2: Two items, same room, same date (Case B)', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 102,
    items: [
      { id: 11, room_id: 7, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' },
      { id: 12, room_id: 7, start_time: '2026-10-15T13:00:00', end_time: '2026-10-15T17:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);

  assert.equal(summary.caseType, 'same_room_same_date');
  assert.equal(summary.isMultiItem, true);
  assert.equal(summary.totalItems, 2);
  assert.equal(summary.uniqueRoomCount, 1);
  assert.equal(summary.uniqueDateCount, 1);
  assert.equal(summary.roomName, 'Uranus (305)');
  assert.equal(summary.usageDateStr, '15 ต.ค. 2569');
  assert.equal(summary.timeDisplay, '2 ช่วงเวลา');
  assert.ok(summary.badges.includes('2 ช่วงเวลา'));
  assert.ok(summary.badges.includes('2 รายการ'));
});

test('3. Scenario 3: Same room across two dates (Case C, 2 dates)', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 103,
    items: [
      { id: 21, room_id: 7, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' },
      { id: 22, room_id: 7, start_time: '2026-10-17T09:00:00', end_time: '2026-10-17T12:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);

  assert.equal(summary.caseType, 'same_room_multi_date');
  assert.equal(summary.isMultiItem, true);
  assert.equal(summary.totalItems, 2);
  assert.equal(summary.uniqueRoomCount, 1);
  assert.equal(summary.uniqueDateCount, 2);
  assert.equal(summary.roomName, 'Uranus (305)');
  assert.equal(summary.usageDateStr, '15, 17 ต.ค. 2569');
  assert.deepEqual(summary.badges, ['1 ห้อง', '2 วัน', '2 รายการ']);
});

test('4. Scenario 4: Same room across non-consecutive dates (Case C, 3 dates)', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 104,
    items: [
      { id: 31, room_id: 7, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' },
      { id: 32, room_id: 7, start_time: '2026-10-17T09:00:00', end_time: '2026-10-17T12:00:00' },
      { id: 33, room_id: 7, start_time: '2026-10-19T09:00:00', end_time: '2026-10-19T12:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);

  assert.equal(summary.caseType, 'same_room_multi_date');
  assert.equal(summary.usageDateStr, '15, 17, 19 ต.ค. 2569');
  assert.deepEqual(summary.badges, ['1 ห้อง', '3 วัน', '3 รายการ']);
  assert.ok(!summary.usageDateStr.includes('16'), 'Intermediate unbooked date 16 must not be implied');
  assert.ok(!summary.usageDateStr.includes('18'), 'Intermediate unbooked date 18 must not be implied');
});

test('5. Scenario 5: Multiple rooms on one date (Case D)', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 105,
    items: [
      { id: 41, room_id: 5, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' },
      { id: 42, room_id: 6, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' },
      { id: 43, room_id: 4, start_time: '2026-10-15T13:00:00', end_time: '2026-10-15T17:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);

  assert.equal(summary.caseType, 'multi_room_same_date');
  assert.equal(summary.isMultiItem, true);
  assert.equal(summary.uniqueRoomCount, 3);
  assert.equal(summary.uniqueDateCount, 1);
  assert.equal(summary.totalItems, 3);
  assert.equal(summary.displayedRooms, 'Mercury (302), Venus (304)');
  assert.equal(summary.extraRoomCount, 1);
  assert.equal(summary.roomDisplay, 'Mercury (302), Venus (304) +1');
  assert.equal(summary.usageDateStr, '15 ต.ค. 2569');
  assert.deepEqual(summary.badges, ['3 ห้อง', '3 รายการ']);
});

test('6. Scenario 6: Multiple rooms across dates (Case E)', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 106,
    items: [
      { id: 51, room_id: 5, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' },
      { id: 52, room_id: 6, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' },
      { id: 53, room_id: 4, start_time: '2026-10-17T09:00:00', end_time: '2026-10-17T12:00:00' },
      { id: 54, room_id: 5, start_time: '2026-10-19T09:00:00', end_time: '2026-10-19T12:00:00' },
      { id: 55, room_id: 6, start_time: '2026-10-19T13:00:00', end_time: '2026-10-19T17:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);

  assert.equal(summary.caseType, 'multi_room_multi_date');
  assert.equal(summary.uniqueRoomCount, 3);
  assert.equal(summary.uniqueDateCount, 3);
  assert.equal(summary.totalItems, 5);
  assert.equal(summary.displayedRooms, 'Mercury (302), Venus (304)');
  assert.equal(summary.extraRoomCount, 1);
  assert.equal(summary.usageDateStr, '15, 17, 19 ต.ค. 2569');
  assert.deepEqual(summary.badges, ['3 ห้อง', '3 วัน', '5 รายการ']);
});

test('7. Scenario 7: More than two unique room names renders first two rooms', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 107,
    items: [
      { id: 61, room_id: 4, start_time: '2026-10-15T09:00:00' },
      { id: 62, room_id: 5, start_time: '2026-10-15T09:00:00' },
      { id: 63, room_id: 6, start_time: '2026-10-15T09:00:00' },
      { id: 64, room_id: 7, start_time: '2026-10-15T09:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);

  assert.equal(summary.uniqueRoomCount, 4);
  assert.equal(summary.displayedRooms, 'Mars (301), Mercury (302)');
  assert.equal(summary.extraRoomCount, 2);
  assert.equal(summary.roomDisplay, 'Mars (301), Mercury (302) +2');
});

test('8. Scenario 8: Correct "+N" label calculation', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  // 1 room: extra = 0
  const b1 = { id: 1, items: [{ id: 1, room_id: 4 }] };
  assert.equal(getBookingTableSummary(b1, mockRooms).extraRoomCount, 0);

  // 2 rooms: extra = 0
  const b2 = { id: 2, items: [{ id: 1, room_id: 4 }, { id: 2, room_id: 5 }] };
  assert.equal(getBookingTableSummary(b2, mockRooms).extraRoomCount, 0);

  // 3 rooms: extra = 1
  const b3 = { id: 3, items: [{ id: 1, room_id: 4 }, { id: 2, room_id: 5 }, { id: 3, room_id: 6 }] };
  assert.equal(getBookingTableSummary(b3, mockRooms).extraRoomCount, 1);

  // 4 rooms: extra = 2
  const b4 = { id: 4, items: [{ id: 1, room_id: 4 }, { id: 2, room_id: 5 }, { id: 3, room_id: 6 }, { id: 4, room_id: 7 }] };
  assert.equal(getBookingTableSummary(b4, mockRooms).extraRoomCount, 2);
});

test('9. Scenario 9: Correct unique room count by authoritative room ID', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  // Same room booked 3 times must count as exactly 1 unique room
  const booking = {
    id: 109,
    items: [
      { id: 1, room_id: 4, room_name: 'Mars (301)' },
      { id: 2, room_id: 4, room_name: 'Mars' },
      { id: 3, room_id: 4, room_name: 'Mars (301)' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);
  assert.equal(summary.uniqueRoomCount, 1, 'Authoritative room_id must deduplicate unique room count');
});

test('10. Scenario 10: Correct unique date count by canonical date key', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 110,
    items: [
      { id: 1, room_id: 4, start_time: '2026-10-15T08:00:00' },
      { id: 2, room_id: 4, start_time: '2026-10-15T12:00:00' },
      { id: 3, room_id: 5, start_time: '2026-10-15T14:00:00' },
      { id: 4, room_id: 5, start_time: '2026-10-16T09:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);
  assert.equal(summary.uniqueDateCount, 2, '2 distinct canonical date keys must yield count 2');
});

test('11. Scenario 11: Correct total item count', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 111,
    items: [
      { id: 1, room_id: 4 }, { id: 2, room_id: 4 }, { id: 3, room_id: 4 }, { id: 4, room_id: 5 }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);
  assert.equal(summary.totalItems, 4);
});

test('12. Scenario 12: Duplicate-looking legitimate items preserved without silent deduplication', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 112,
    items: [
      { id: 1, room_id: 4, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' },
      { id: 2, room_id: 4, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);
  assert.equal(summary.totalItems, 2);
  assert.equal(summary.badges.includes('2 รายการ'), true);
});

test('13. Scenario 13: Non-contiguous time slots are not merged into fake continuous range', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 113,
    items: [
      { id: 1, room_id: 4, start_time: '2026-10-15T08:00:00', end_time: '2026-10-15T10:00:00' },
      { id: 2, room_id: 4, start_time: '2026-10-15T14:00:00', end_time: '2026-10-15T16:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);
  assert.equal(summary.timeDisplay, '2 ช่วงเวลา');
  assert.ok(!summary.timeDisplay.includes('08:00 - 16:00'), 'Must not create misleading merged continuous range');
});

test('14. Scenario 14: Multiple rooms at overlapping times', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 114,
    items: [
      { id: 1, room_id: 4, start_time: '2026-10-15T09:00:00', end_time: '2026-10-15T12:00:00' },
      { id: 2, room_id: 5, start_time: '2026-10-15T10:00:00', end_time: '2026-10-15T13:00:00' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);
  assert.equal(summary.caseType, 'multi_room_same_date');
  assert.equal(summary.timeDisplay, '', 'Multi-room bookings should not combine overlapping times');
  assert.deepEqual(summary.badges, ['2 ห้อง', '2 รายการ']);
});

test('15. Scenario 15: Bangkok timezone boundary cases', async () => {
  const { extractCanonicalDateKey } = await import(HELPER_PATH);

  // Early morning wall-clock string
  assert.equal(extractCanonicalDateKey('2026-10-15T00:15:00'), '2026-10-15');
  // Late night wall-clock string
  assert.equal(extractCanonicalDateKey('2026-10-15T23:45:00'), '2026-10-15');
});

test('16. Scenario 16: Dates spanning months format clearly in Thai', async () => {
  const { formatMultiDatesThai } = await import(HELPER_PATH);

  const res = formatMultiDatesThai(['2026-10-31', '2026-11-02']);
  assert.equal(res, '31 ต.ค., 2 พ.ย. 2569');
});

test('17. Scenario 17: Dates spanning years format clearly in Thai', async () => {
  const { formatMultiDatesThai } = await import(HELPER_PATH);

  const res = formatMultiDatesThai(['2026-12-31', '2027-01-02']);
  assert.equal(res, '31 ธ.ค. 2569, 2 ม.ค. 2570');
});

test('18. Scenario 18: Missing room IDs or names handle safely', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 118,
    items: [
      { id: 1, room_id: null, room_name: null }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);
  assert.equal(summary.roomName, 'ห้องประชุม');
  assert.equal(summary.totalItems, 1);
});

test('19. Scenario 19: Missing or invalid dates handle safely without crashing', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 119,
    items: [
      { id: 1, room_id: 4, start_time: 'invalid-date' }
    ]
  };

  const summary = getBookingTableSummary(booking, mockRooms);
  assert.equal(summary.usageDateStr, '-');
});

test('20. Scenario 20: Empty items array synthesizes safe fallback', async () => {
  const { getBookingTableSummary } = await import(HELPER_PATH);

  const booking = {
    id: 120,
    room_id: 4,
    room_name: 'Mars (301)',
    start_time: '2026-10-15T09:00:00',
    end_time: '2026-10-15T12:00:00',
    items: []
  };

  const summary = getBookingTableSummary(booking, mockRooms);
  assert.equal(summary.totalItems, 1);
  assert.equal(summary.roomName, 'Mars (301)');
  assert.equal(summary.usageDateStr, '15 ต.ค. 2569');
});

test('21. Scenario 21: Booking Details Modal action preserved in table', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  // Verify modal opening trigger is unchanged
  assert.ok(code.includes('handleOpenBookingDetail') && code.includes('setSelectedBooking('), 'Table row/action menu click must open booking detail');
  assert.ok(code.includes('setShowDetailModal(true)'), 'View Details action must open showDetailModal');
});

test('22. Scenario 22: Phase 2 accordion behavior remains intact in PendingBookings.jsx', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  assert.ok(code.includes('expandedDatesByBooking'), 'Must retain expandedDatesByBooking state');
  assert.ok(code.includes('isDateGroupExpanded'), 'Must retain isDateGroupExpanded helper');
  assert.ok(code.includes('handleToggleDateGroup'), 'Must retain handleToggleDateGroup helper');
  assert.ok(code.includes('handleToggleAllDates'), 'Must retain handleToggleAllDates helper');
});

test('23. Scenario 23: Per-item PIN association remains intact in PendingBookings.jsx', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  assert.ok(code.includes('resolveBookingItemPinInfo(b, it, itRoom)'), 'Must call resolveBookingItemPinInfo per item card');
  assert.ok(code.includes('handleToggleRevealPin(b.id, itemStableId)'), 'Must retain per-item reveal toggle');
  assert.ok(code.includes('handleCopyPin(itKey, itPin)'), 'Must retain per-item copy');
});

test('24. Scenario 24: Search, filter, and pagination logic unchanged', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  assert.ok(code.includes('searchQuery'), 'Must retain search query state');
  assert.ok(code.includes('activeStatusTab'), 'Must retain active status tab filter');
  assert.ok(code.includes('paginatedBookings'), 'Must retain paginated bookings list');
  assert.ok(code.includes('setCurrentPage('), 'Must retain page change handler');
});

test('25. Scenario 25: Payment amounts and receipt printing unchanged', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  assert.ok(code.includes('normalizeBookingFinancials'), 'Must retain financial normalization');
  assert.ok(code.includes('printReceipt'), 'Must retain receipt printing');
});

test('26. Scenario 26: Desktop table and mobile cards both integrate adaptive summary and badges', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');
  const css = fs.readFileSync(PENDING_BOOKINGS_CSS_PATH, 'utf8');

  // PendingBookings.jsx checks
  assert.ok(code.includes('getBookingTableSummary'), 'PendingBookings.jsx must import and use getBookingTableSummary');
  assert.ok(code.includes('pb-room-extra-pill'), 'PendingBookings.jsx must render extra room pill');
  assert.ok(code.includes('pb-summary-mini-badge'), 'PendingBookings.jsx must render summary mini badges');

  // PendingBookings.css checks
  assert.ok(css.includes('.pb-room-name-row'), 'CSS must define .pb-room-name-row');
  assert.ok(css.includes('.pb-room-extra-pill'), 'CSS must define .pb-room-extra-pill');
  assert.ok(css.includes('.pb-summary-badges-row'), 'CSS must define .pb-summary-badges-row');
  assert.ok(css.includes('.pb-summary-mini-badge'), 'CSS must define .pb-summary-mini-badge');
  assert.ok(css.includes('.pb-mobile-room-name-row'), 'CSS must define .pb-mobile-room-name-row');
});
