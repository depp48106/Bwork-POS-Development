const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const staffPageSrc = fs.readFileSync(path.join(ROOT, 'booking-app', 'src', 'pages', 'StaffAvailabilityPage.jsx'), 'utf8');
const staffCssSrc = fs.readFileSync(path.join(ROOT, 'booking-app', 'src', 'pages', 'StaffAvailabilityPage.css'), 'utf8');

test('Staff Booking Rules: Booker Type Priority, Read-Only Calendar, Hidden Cleaning Text, Past X', async (t) => {
  const { resolveBookerType } = await import('file:///' + path.join(ROOT, 'backend', 'roomAvailabilityQuery.mjs').replace(/\\/g, '/'));

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

  await t.test('2. Staff page hides cleaning wording and uses จองแล้ว / ไม่สามารถจองได้', () => {
    assert.ok(!staffPageSrc.includes('ทำความสะอาด'), 'Must hide cleaning wording from /staff-booking');
    assert.ok(!staffPageSrc.includes('เว้นทำความสะอาด'), 'Must hide cleaning buffer wording from /staff-booking');
    assert.match(staffPageSrc, /จองแล้ว/);
    assert.match(staffPageSrc, /ไม่สามารถจองได้/);
  });

  await t.test('3. Past dates use disabled full-cell corner-to-corner X behind date number', () => {
    assert.match(staffPageSrc, /disabled=\{isPast\}/);
    assert.match(staffPageSrc, /staff-cal-day__past-x/);
    assert.match(staffCssSrc, /\.staff-cal-day__past-x/);
  });

  await t.test('4. Monthly calendar uses read-only chips and shows ดูเพิ่มเติม only when uniqueRoomCount >= 2', () => {
    assert.match(staffPageSrc, /const uniqueRoomCount = new Set\(dayEvents\.map\(ev => ev\.room_id\)\)\.size;/);
    assert.match(staffPageSrc, /const showMoreBtn = uniqueRoomCount >= 2;/);
    assert.match(staffPageSrc, /staff-pos-event-chip--readonly/);
    assert.match(staffPageSrc, /`\$\{ev\.room_name\} · \$\{ev\.start_time\}–\$\{ev\.end_time\} น\.`/);
  });
});
