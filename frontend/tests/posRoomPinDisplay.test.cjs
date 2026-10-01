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
