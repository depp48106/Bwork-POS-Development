const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const staffPageSrc = fs.readFileSync(path.join(ROOT, 'booking-app', 'src', 'pages', 'StaffAvailabilityPage.jsx'), 'utf8');
const staffCssSrc = fs.readFileSync(path.join(ROOT, 'booking-app', 'src', 'pages', 'StaffAvailabilityPage.css'), 'utf8');
const workerSrc = fs.readFileSync(path.join(ROOT, 'backend', 'worker.js'), 'utf8');

test('Staff Booking Rules: Booker Type Priority, Zero-PII Public API, Simplified Modal, Unified 409', async (t) => {
  const {
    resolveBookerType,
    ROOM_AVAILABILITY_INTERVALS_SQL,
    STAFF_ROOM_AVAILABILITY_INTERVALS_SQL,
    buildAvailabilityResponse,
    buildStaffAvailabilityResponse
  } = await import('file:///' + path.join(ROOT, 'backend', 'roomAvailabilityQuery.mjs').replace(/\\/g, '/'));

  await t.test('1. customer_type takes strict priority over booking_channel / booking_source', () => {
    assert.deepEqual(
      resolveBookerType({ customer_type: 'basecamp', booking_channel: 'pos', booking_source: 'pos' }),
      { type: 'ลูกค้าชั้น 4', code: 'basecamp' }
    );
    assert.deepEqual(
      resolveBookerType({ customer_type: 'shop', booking_channel: 'pos' }),
      { type: 'ลูกค้าห้อง Shop', code: 'shop' }
    );
    assert.deepEqual(
      resolveBookerType({ customer_type: 'ondemand', booking_channel: 'pos' }),
      { type: 'ลูกค้า Ondemand', code: 'ondemand' }
    );
    assert.deepEqual(
      resolveBookerType({ customer_type: 'builtland', booking_channel: 'pos', customer_name: 'สมชาย ใจดี' }),
      { type: 'พนักงาน Builtland', code: 'builtland' }
    );
    assert.deepEqual(
      resolveBookerType({ customer_type: 'builtland', booking_channel: 'staff_calendar', customer_name: 'สุดา ฝ่ายขาย' }),
      { type: 'พนักงาน Builtland', code: 'builtland' }
    );
    assert.deepEqual(
      resolveBookerType({ customer_type: 'general', booking_channel: 'line_oa' }),
      { type: 'ลูกค้าภายนอก', code: 'external' }
    );
    assert.deepEqual(
      resolveBookerType({ customer_type: 'walkin', booking_channel: 'pos' }),
      { type: 'ลูกค้าภายนอก', code: 'external' }
    );
    // Legacy/incomplete record without customer_type or recognizable channel -> never guesses
    assert.deepEqual(
      resolveBookerType({ customer_type: '', booking_channel: 'pos', booking_source: 'pos' }),
      { type: 'ไม่ระบุประเภท', code: 'unknown' }
    );
  });

  await t.test('2. Public availability API is strictly zero-PII; Staff API returns Builtland real name', () => {
    assert.ok(!ROOM_AVAILABILITY_INTERVALS_SQL.includes('customer_name'), 'Public SQL must NEVER select customer_name');
    assert.ok(!ROOM_AVAILABILITY_INTERVALS_SQL.includes('staff_booker_name'), 'Public SQL must NEVER select staff_booker_name');
    assert.ok(STAFF_ROOM_AVAILABILITY_INTERVALS_SQL.includes('b.customer_name'), 'Staff SQL must select customer_name');

    const sampleItems = [
      {
        room_id: 1,
        start_time: '2026-11-28T08:00:00',
        end_time: '2026-11-28T12:00:00',
        customer_type: 'builtland',
        booking_source: 'staff',
        booking_channel: 'staff_calendar',
        customer_name: 'สมชาย ใจดี'
      },
      {
        room_id: 2,
        start_time: '2026-11-28T09:00:00',
        end_time: '2026-11-28T11:00:00',
        customer_type: 'general',
        booking_channel: 'line_oa',
        customer_name: 'คุณลูกค้า ภายนอก'
      }
    ];
    const pubRes = buildAvailabilityResponse({ month: '2026-11' }, [], sampleItems, 30, (s) => s);
    for (const iv of pubRes.intervals) {
      assert.equal('customer_name' in iv, false, 'Public interval must not include customer_name key');
    }

    const staffRes = buildStaffAvailabilityResponse({ month: '2026-11' }, [], sampleItems, 30, (s) => s);
    assert.equal(staffRes.intervals[0].customer_name, 'สมชาย ใจดี');
  });

  await t.test('3. "ดูเพิ่มเติม" modal uses "ห้องที่มีการจอง", hides cleaning/buffer rows and removes "จองแล้ว" / "ไม่สามารถจองได้"', () => {
    assert.ok(!staffPageSrc.includes('ทำความสะอาด'), 'Must hide cleaning wording from /staff-booking');
    assert.ok(!staffPageSrc.includes('เว้นทำความสะอาด'), 'Must hide cleaning buffer wording from /staff-booking');
    assert.ok(!staffPageSrc.includes('isReservedBuffer'), 'Modal must not generate buffer rows');
    assert.ok(!staffPageSrc.includes('staff-booked-tag'), 'Modal must not render จองแล้ว badge');
    assert.ok(!staffPageSrc.includes('staff-reserved-tag'), 'Modal must not render ไม่สามารถจองได้ badge');
    assert.match(staffPageSrc, /ห้องที่มีการจอง/);
    assert.match(staffPageSrc, /\{item\.start_time\}–\{item\.end_time\} น\./);
  });

  await t.test('4. Past dates use disabled full-cell corner-to-corner X behind date number', () => {
    assert.match(staffPageSrc, /disabled=\{isPast\}/);
    assert.match(staffPageSrc, /staff-cal-day__past-x/);
    assert.match(staffCssSrc, /\.staff-cal-day__past-x/);
  });

  await t.test('5. Monthly calendar uses read-only chips and shows ดูเพิ่มเติม only when uniqueRoomCount >= 2', () => {
    assert.match(staffPageSrc, /const uniqueRoomCount = new Set\(dayEvents\.map\(ev => ev\.room_id\)\)\.size;/);
    assert.match(staffPageSrc, /const showMoreBtn = uniqueRoomCount >= 2;/);
    assert.match(staffPageSrc, /staff-pos-event-chip--readonly/);
    assert.match(staffPageSrc, /`\$\{ev\.room_name\} · \$\{ev\.start_time\}–\$\{ev\.end_time\} น\.`/);
  });

  await t.test('6. Overlap and 30-min buffer conflict returns unified message on both backend 409 and client', () => {
    assert.match(workerSrc, /ไม่สามารถจองช่วงเวลานี้ได้ กรุณาเลือกเวลาอื่น/);
    assert.match(staffPageSrc, /ไม่สามารถจองช่วงเวลานี้ได้ กรุณาเลือกเวลาอื่น/);
    assert.ok(!staffPageSrc.includes('ห้องไม่ว่างในช่วงเวลานี้'), 'Staff page should use unified 409 message');
  });
});
