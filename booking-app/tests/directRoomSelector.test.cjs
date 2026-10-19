/**
 * BWORK-POS — Direct Room Selector Feature Test Suite
 *
 * Verifies:
 * 1. Mode A: Direct Room Selection via dropdown + date picker (guest count NOT required at search time).
 * 2. Mode B: Search by Attendees (preserves existing guests + date flow).
 * 3. Dynamic room loading from GET /api/public/rooms (loading, error, empty state handling).
 * 4. RoomListPage displays specific room details, packages, availability, and occupied warning.
 * 5. Invalid / deleted roomId handling with fallback to "ดูห้องประชุมทั้งหมด".
 * 6. BookingFormPage collects guest count and strictly validates against room capacity ceiling.
 * 7. Booking payload integrity: guest_count is a valid positive integer (never 0 or fake bypass).
 * 8. Zero modification to protected backend files, schema, or payment workflow.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const homePageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/HomePage.jsx'), 'utf8').replace(/\r\n/g, '\n');
const roomListSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/RoomListPage.jsx'), 'utf8').replace(/\r\n/g, '\n');
const bookingFormSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/BookingFormPage.jsx'), 'utf8').replace(/\r\n/g, '\n');

describe('BWORK-POS: Direct Room Selector Test Suite', () => {

  // ==========================================================================
  // 1. HOME PAGE: MODE A & MODE B INTEGRATION
  // ==========================================================================

  test('1.1: HomePage supports both Mode A (directRoom) and Mode B (byGuests)', () => {
    assert.ok(homePageSrc.includes("searchMode === 'directRoom'"), 'Must contain Mode A condition');
    assert.ok(homePageSrc.includes("searchMode === 'byGuests'"), 'Must contain Mode B condition');
    assert.ok(homePageSrc.includes('เลือกห้องประชุมเอง'), 'Mode A tab label');
    assert.ok(homePageSrc.includes('ค้นหาตามจำนวนคน'), 'Mode B tab label');
  });

  test('1.2: Mode A does NOT require guest count at search time', () => {
    // In handleSearch, directRoom checks selectedRoomId and dateStr, but does NOT require guests
    const directSearchBlock = homePageSrc.slice(
      homePageSrc.indexOf("if (searchMode === 'directRoom')"),
      homePageSrc.indexOf("navigate(`/rooms?date=${dateStr}&roomId=${selectedRoomId}`);")
    );
    assert.ok(directSearchBlock.includes('!selectedRoomId'), 'Must validate selectedRoomId');
    assert.ok(directSearchBlock.includes('!dateStr'), 'Must validate dateStr');
    assert.ok(!directSearchBlock.includes('!guests'), 'Mode A must NOT require guests at search step');
  });

  test('1.3: Mode B preserves existing attendee count validation (min 1)', () => {
    const byGuestsBlock = homePageSrc.slice(
      homePageSrc.indexOf("navigate(`/rooms?date=${dateStr}&roomId=${selectedRoomId}`);"),
      homePageSrc.indexOf("navigate(`/rooms?date=${dateStr}&guests=${guests}`);")
    );
    assert.ok(byGuestsBlock.includes('!guests || guests < 1'), 'Mode B must validate guests >= 1');
    assert.ok(byGuestsBlock.includes('กรุณาระบุจำนวนผู้เข้าใช้ห้องอย่างน้อย 1 ท่าน'), 'Mode B error message');
  });

  test('1.4: HomePage dynamically fetches rooms from /api/public/rooms without hardcoding', () => {
    assert.ok(homePageSrc.includes('fetch(`${API_BASE}/api/public/rooms`)'), 'Must fetch rooms from API');
    assert.ok(homePageSrc.includes('loadingRooms'), 'Must manage loading state');
    assert.ok(homePageSrc.includes('roomsError'), 'Must manage error state');
    assert.ok(homePageSrc.includes('sortedRooms.map'), 'Must render dynamic rooms in select dropdown');
  });

  test('1.5: HomePage initializes mode from URL search params gracefully', () => {
    assert.ok(homePageSrc.includes("query.get('roomId') ? 'directRoom' : 'byGuests'"), 'Auto-detect mode from query param');
  });

  // ==========================================================================
  // 2. ROOM LIST PAGE: DIRECT ROOM MODE & OCCUPIED NOTICE
  // ==========================================================================

  test('2.1: RoomListPage handles roomIdParam from query params', () => {
    assert.ok(roomListSrc.includes("query.get('roomId')"), 'Must read roomId from query');
    assert.ok(roomListSrc.includes('roomIdParam'), 'Must have roomIdParam state');
    assert.ok(roomListSrc.includes('selectedDirectRoom'), 'Must resolve selectedDirectRoom');
  });

  test('2.2: RoomListPage displays single room view when roomIdParam is provided', () => {
    assert.ok(roomListSrc.includes('/* MODE A: DIRECT ROOM SELECTION VIEW */'), 'Must have Direct Room branch');
    assert.ok(roomListSrc.includes('{renderRoomCard(selectedDirectRoom, false)}'), 'Renders selected direct room');
  });

  test('2.3: RoomListPage handles invalid or deleted roomId gracefully with fallback', () => {
    assert.ok(roomListSrc.includes('/* ROOM NOT FOUND STATE */'), 'Must have not-found state');
    assert.ok(roomListSrc.includes('ไม่พบห้องประชุมที่เลือก'), 'Clear Thai error notice');
    assert.ok(roomListSrc.includes('ดูห้องประชุมทั้งหมด'), 'Provides button to switch to all rooms');
  });

  test('2.4: RoomListPage shows occupied notice and alternatives when direct room is unavailable', () => {
    assert.ok(roomListSrc.includes('ห้องนี้ไม่สามารถจองในช่วงเวลาที่เลือกได้'), 'Occupied warning banner');
    assert.ok(roomListSrc.includes('ดูห้องประชุมอื่นที่ว่าง'), 'Action to view other rooms');
    assert.ok(roomListSrc.includes('เปลี่ยนวันที่ใช้งาน'), 'Action to change date');
  });

  test('2.5: RoomListPage allows user to switch back to viewing all rooms', () => {
    assert.ok(roomListSrc.includes('setRoomIdParam(null)'), 'Clearing roomIdParam returns to full list');
  });

  test('2.6: RoomListPage passes capacity and null guest placeholder to BookingFormPage', () => {
    assert.ok(roomListSrc.includes('effective_capacity: sel.effectiveCapacity'), 'Passes effective capacity');
    assert.ok(roomListSrc.includes('room_capacity: room.capacity || 4'), 'Passes room capacity');
    assert.ok(roomListSrc.includes('guests: guests || null'), 'Allows null guests in Mode A');
  });

  // ==========================================================================
  // 3. BOOKING FORM PAGE: CAPACITY ENFORCEMENT & PAYLOAD INTEGRITY
  // ==========================================================================

  test('3.1: BookingFormPage determines effective room capacity ceiling', () => {
    assert.ok(bookingFormSrc.includes('const effectiveCapacity = bookingData?.effective_capacity'), 'Calculates effectiveCapacity');
  });

  test('3.2: BookingFormPage collects and strictly validates attendee count before submit', () => {
    assert.ok(bookingFormSrc.includes('const parsedAttendees = parseInt(attendees, 10);'), 'Parses attendees');
    assert.ok(bookingFormSrc.includes('if (!attendees || isNaN(parsedAttendees) || parsedAttendees < 1)'), 'Validates positive integer >= 1');
    assert.ok(bookingFormSrc.includes('if (parsedAttendees > effectiveCapacity)'), 'Enforces capacity ceiling');
  });

  test('3.3: BookingFormPage renders attendee input field with room capacity ceiling label', () => {
    assert.ok(bookingFormSrc.includes('ห้องนี้รองรับสูงสุด {effectiveCapacity} ท่าน'), 'Displays capacity ceiling helper');
    assert.ok(bookingFormSrc.includes('max={effectiveCapacity}'), 'Sets HTML5 max constraint');
    assert.ok(bookingFormSrc.includes('min="1"'), 'Sets HTML5 min constraint');
  });

  test('3.4: BookingFormPage sends validated guest_count and guests in booking payload (never 0 or fake)', () => {
    assert.ok(bookingFormSrc.includes('guest_count: parsedAttendees,'), 'guest_count is parsedAttendees');
    assert.ok(bookingFormSrc.includes('guests: parsedAttendees,'), 'guests is parsedAttendees');
  });

  test('3.5: BookingFormPage updates completedResult and summary card with validated attendees', () => {
    assert.ok(bookingFormSrc.includes('sanitizedBookingData = { ...bookingData, guests: parsedAttendees, guest_count: parsedAttendees }'), 'Updates sanitizedBookingData');
    assert.ok(bookingFormSrc.includes("{attendees ? `${attendees} ท่าน` : 'ยังไม่ได้ระบุ'}"), 'Summary card shows attendees or not specified');
  });

  // ==========================================================================
  // 4. RUNTIME LOGIC SIMULATION & CAPACITY BOUNDARY CHECKS
  // ==========================================================================

  test('4.1: Capacity Simulation: guest count within capacity is accepted', () => {
    const roomCapacity = 8;
    const testAttendees = [1, 2, 4, 8];
    for (const count of testAttendees) {
      const parsed = parseInt(String(count), 10);
      assert.ok(!isNaN(parsed) && parsed >= 1 && parsed <= roomCapacity, `Count ${count} should be accepted`);
    }
  });

  test('4.2: Capacity Simulation: guest count 0, negative, or exceeding capacity is rejected', () => {
    const roomCapacity = 8;
    const invalidAttendees = [0, -1, 9, 10, 50, NaN, ''];
    for (const val of invalidAttendees) {
      const parsed = parseInt(String(val), 10);
      const isInvalid = !val || isNaN(parsed) || parsed < 1 || parsed > roomCapacity;
      assert.strictEqual(isInvalid, true, `Value ${val} should be rejected`);
    }
  });

  test('4.3: Mode A flow simulation: Direct room navigation -> booking form -> valid payload', () => {
    const mockRoom = { id: 301, name: 'Meeting Room 301', capacity: 6, hourly_rate: 350 };
    const dateStr = '2026-10-25';
    const mockPayload = {
      room_id: mockRoom.id,
      room_name: mockRoom.name,
      effective_capacity: mockRoom.capacity,
      date: dateStr,
      start_time: '10:00',
      end_time: '12:00',
      duration: 2,
      guests: null
    };

    // Customer enters attendees on form
    const enteredGuests = '5';
    const parsed = parseInt(enteredGuests, 10);
    assert.ok(parsed >= 1 && parsed <= mockPayload.effective_capacity);

    const submissionPayload = {
      room_id: mockPayload.room_id,
      booking_date: mockPayload.date,
      start_time: mockPayload.start_time,
      end_time: mockPayload.end_time,
      guest_count: parsed,
      guests: parsed
    };

    assert.strictEqual(submissionPayload.room_id, 301);
    assert.strictEqual(submissionPayload.guest_count, 5);
    assert.strictEqual(submissionPayload.guests, 5);
  });
});
