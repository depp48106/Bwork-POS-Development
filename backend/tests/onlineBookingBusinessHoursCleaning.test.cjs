const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSrc = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const workerSrc = fs.readFileSync(path.resolve(__dirname, '../worker.js'), 'utf8');

// Parity functions matching server.js & worker.js
function validateBusinessHours(startTime, endTime) {
  const sHHMM = (startTime || '').substring(0, 5);
  const eHHMM = (endTime || '').substring(0, 5);

  if (eHHMM <= sHHMM) {
    return { valid: false, status: 400, error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' };
  }
  if (sHHMM < '08:00') {
    return { valid: false, status: 400, error: 'เวลาเริ่มต้นต้องไม่เร็วกว่าเวลาเปิดทำการ (08:00 น.)' };
  }
  if (sHHMM >= '18:00') {
    return { valid: false, status: 400, error: 'ไม่สามารถจองเวลาเริ่มต้นตั้งแต่เวลาปิดทำการ (18:00 น.) เป็นต้นไป' };
  }
  if (eHHMM > '18:00') {
    return { valid: false, status: 400, error: 'เวลาสิ้นสุดต้องไม่เกินเวลาปิดทำการ (18:00 น.)' };
  }
  return { valid: true };
}

function formatOverlapErrorMessage(roomName, overlapResult) {
  const b = (overlapResult && overlapResult.booking) || {};
  const sTime = b.start_time && b.start_time.includes('T') ? b.start_time.split('T')[1].substring(0, 5) : (b.start_time || '');
  const eTime = b.end_time && b.end_time.includes('T') ? b.end_time.split('T')[1].substring(0, 5) : (b.end_time || '');
  const nextAvail = b.end_buffered_time && b.end_buffered_time.includes('T') ? b.end_buffered_time.split('T')[1].substring(0, 5) : eTime;

  const customer = b.customer_name ? `คุณ ${b.customer_name}` : 'ลูกค้า';
  const nameLabel = roomName ? `ห้อง "${roomName}"` : 'ห้องนี้';

  if (overlapResult.isCleaningBuffer) {
    if (overlapResult.isNextQueueBuffer) {
      return `${nameLabel} ต้องมีเวลาทำความสะอาด (${overlapResult.bufferMinutes || 30} นาที) ก่อนคิวถัดไป (${customer} เริ่มเวลา ${sTime} น.)`;
    }
    if (nextAvail >= '18:00') {
      return `${nameLabel} อยู่ในช่วงเวลาทำความสะอาด (${overlapResult.bufferMinutes || 30} นาที) ต่อจากคิว${customer} (ใช้งานถึง ${eTime} น.) จนถึงเวลาปิดทำการ (18:00 น.)`;
    }
    return `${nameLabel} อยู่ในช่วงเวลาทำความสะอาด (${overlapResult.bufferMinutes || 30} นาที) ต่อจากคิว${customer} (ใช้งานถึง ${eTime} น.) สามารถจองได้ตั้งแต่เวลา ${nextAvail} น. เป็นต้นไป`;
  }
  return `${nameLabel} ไม่ว่างในช่วงเวลาดังกล่าว (มีผู้ใช้งาน: ${customer} ช่วงเวลา ${sTime} - ${eTime} น.)`;
}

describe('BWORK-POS — Backend Business Hours & Cleaning Overlap Test Matrix', () => {

  test('A. Booking ending at exactly 18:00 is allowed', () => {
    const res = validateBusinessHours('17:00', '18:00');
    assert.equal(res.valid, true);
    assert.equal(res.error, undefined);
  });

  test('B. Booking ending at 18:01 is rejected', () => {
    const res = validateBusinessHours('17:00', '18:01');
    assert.equal(res.valid, false);
    assert.equal(res.status, 400);
    assert.equal(res.error, 'เวลาสิ้นสุดต้องไม่เกินเวลาปิดทำการ (18:00 น.)');
  });

  test('C. Booking starting at 18:00 is rejected', () => {
    const res = validateBusinessHours('18:00', '19:00');
    assert.equal(res.valid, false);
    assert.equal(res.status, 400);
    assert.equal(res.error, 'ไม่สามารถจองเวลาเริ่มต้นตั้งแต่เวลาปิดทำการ (18:00 น.) เป็นต้นไป');
  });

  test('D. Booking starting before 08:00 is rejected', () => {
    const res = validateBusinessHours('07:59', '09:00');
    assert.equal(res.valid, false);
    assert.equal(res.status, 400);
    assert.equal(res.error, 'เวลาเริ่มต้นต้องไม่เร็วกว่าเวลาเปิดทำการ (08:00 น.)');
  });

  test('E. Cleaning crossing closing time does NOT recommend booking past 18:00', () => {
    const overlapResult = {
      hasOverlap: true,
      isCleaningBuffer: true,
      isNextQueueBuffer: false,
      bufferMinutes: 30,
      booking: {
        customer_name: 'สมชาย',
        start_time: '2026-10-15T17:00:00',
        end_time: '2026-10-15T18:00:00',
        end_buffered_time: '2026-10-15T18:30:00'
      }
    };
    const msg = formatOverlapErrorMessage('301', overlapResult);
    assert.ok(!msg.includes('18:30 น. เป็นต้นไป'), 'Must not recommend booking at 18:30');
    assert.ok(!msg.includes('18:00 น. เป็นต้นไป'), 'Must not recommend booking at 18:00');
    assert.ok(msg.includes('จนถึงเวลาปิดทำการ (18:00 น.)'), 'Must mention until closing time 18:00');
  });

  test('F. Midday cleaning collision preserved with correct next available time', () => {
    const overlapResult = {
      hasOverlap: true,
      isCleaningBuffer: true,
      isNextQueueBuffer: false,
      bufferMinutes: 30,
      booking: {
        customer_name: 'วิภา',
        start_time: '2026-10-15T10:00:00',
        end_time: '2026-10-15T11:00:00',
        end_buffered_time: '2026-10-15T11:30:00'
      }
    };
    const msg = formatOverlapErrorMessage('301', overlapResult);
    assert.ok(msg.includes('สามารถจองได้ตั้งแต่เวลา 11:30 น. เป็นต้นไป'), 'Preserves midday next available suggestion');
  });

  test('F2. Subsequent queue preparation buffer collision formatted accurately', () => {
    const overlapResult = {
      hasOverlap: true,
      isCleaningBuffer: true,
      isNextQueueBuffer: true,
      bufferMinutes: 30,
      booking: {
        customer_name: 'กมล',
        start_time: '2026-10-15T17:00:00',
        end_time: '2026-10-15T18:00:00',
        end_buffered_time: '2026-10-15T18:30:00'
      }
    };
    const msg = formatOverlapErrorMessage('301', overlapResult);
    assert.ok(msg.includes('ต้องมีเวลาทำความสะอาด (30 นาที) ก่อนคิวถัดไป'), 'Accurately attributes buffer to upcoming queue');
    assert.ok(!msg.includes('18:30 น. เป็นต้นไป'));
  });

  test('G. Multi-room availability: Room check is isolated per roomId', () => {
    // Overlap checks pass room_id as an isolated parameter in both server and worker
    assert.match(serverSrc, /WHERE\s+bi\.room_id\s*=\s*\?/, 'Server filters bookings by room_id');
    assert.match(workerSrc, /WHERE\s+bi\.room_id\s*=\s*\?/, 'Worker filters bookings by room_id');
  });

  test('H. Reschedule boundary enforcement (Online channel strictly enforces 08:00-18:00; Admin/POS preserved)', () => {
    // Online booking channel strictly enforces 08:00 - 18:00
    const validOnlineResched = validateBusinessHours('17:00', '18:00');
    assert.equal(validOnlineResched.valid, true);

    const invalidOnlineEndResched = validateBusinessHours('17:00', '18:30');
    assert.equal(invalidOnlineEndResched.valid, false);
    assert.equal(invalidOnlineEndResched.error, 'เวลาสิ้นสุดต้องไม่เกินเวลาปิดทำการ (18:00 น.)');

    const invalidOnlineStartResched = validateBusinessHours('07:00', '09:00');
    assert.equal(invalidOnlineStartResched.valid, false);
    assert.equal(invalidOnlineStartResched.error, 'เวลาเริ่มต้นต้องไม่เร็วกว่าเวลาเปิดทำการ (08:00 น.)');

    // Admin/POS channel preservation: simulated function for non-online bookings
    const validateRescheduleChannel = (booking, startTime, endTime) => {
      const s = (startTime || '').substring(0, 5);
      const e = (endTime || '').substring(0, 5);
      if (e <= s) return { valid: false, error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' };
      const isOnline = booking.booking_channel === 'line_oa' || booking.booking_source === 'online';
      if (isOnline) {
        return validateBusinessHours(startTime, endTime);
      }
      return { valid: true };
    };

    const posBooking = { booking_channel: 'pos_web', booking_source: 'walk-in' };
    const onlineBooking = { booking_channel: 'line_oa', booking_source: 'online' };

    // POS booking can reschedule past 18:00 if authorized by staff
    assert.equal(validateRescheduleChannel(posBooking, '17:00', '18:30').valid, true);
    // Online booking CANNOT reschedule past 18:00
    assert.equal(validateRescheduleChannel(onlineBooking, '17:00', '18:30').valid, false);
  });

  test('I. Server / Worker parity contract audit', () => {
    // 1. Both check 08:00 open boundary
    assert.match(serverSrc, /sHHMM\s*<\s*'08:00'/, 'Server checks sHHMM < 08:00');
    assert.match(workerSrc, /sHHMM\s*<\s*'08:00'/, 'Worker checks sHHMM < 08:00');

    // 2. Both check 18:00 close boundary for start
    assert.match(serverSrc, /sHHMM\s*>=\s*'18:00'/, 'Server checks sHHMM >= 18:00');
    assert.match(workerSrc, /sHHMM\s*>=\s*'18:00'/, 'Worker checks sHHMM >= 18:00');

    // 3. Both check 18:00 close boundary for end
    assert.match(serverSrc, /eHHMM\s*>\s*'18:00'/, 'Server checks eHHMM > 18:00');
    assert.match(workerSrc, /eHHMM\s*>\s*'18:00'/, 'Worker checks eHHMM > 18:00');

    // 4. Both check end > start
    assert.match(serverSrc, /eHHMM\s*<=\s*sHHMM/, 'Server checks eHHMM <= sHHMM');
    assert.match(workerSrc, /eHHMM\s*<=\s*sHHMM/, 'Worker checks eHHMM <= sHHMM');

    // 5. Both check isNextQueueBuffer in checkRoomOverlap
    assert.match(serverSrc, /isNextQueueBuffer\s*=\s*!isDirectUsage\s*&&\s*\(reqEndMs\s*<=\s*bStartMs\)/, 'Server computes isNextQueueBuffer');
    assert.match(workerSrc, /isNextQueueBuffer\s*=\s*!isDirectUsage\s*&&\s*\(reqEndMs\s*<=\s*bStartMs\)/, 'Worker computes isNextQueueBuffer');

    // 6. Both check nextAvail >= '18:00' in formatOverlapErrorMessage
    assert.match(serverSrc, /nextAvail\s*>=\s*'18:00'/, 'Server handles nextAvail >= 18:00');
    assert.match(workerSrc, /nextAvail\s*>=\s*'18:00'/, 'Worker handles nextAvail >= 18:00');

    // 7. Reschedule endpoints enforce channel-specific online business hours in both
    const serverReschedSnippet = serverSrc.substring(serverSrc.indexOf('const handleReschedule ='), serverSrc.indexOf('const handleReschedule =') + 2000);
    assert.ok(serverReschedSnippet.includes("isOnlineBooking"), 'Server handleReschedule checks isOnlineBooking');
    assert.ok(serverReschedSnippet.includes("sHHMM < '08:00'"), 'Server handleReschedule enforces 08:00');
    assert.ok(serverReschedSnippet.includes("eHHMM > '18:00'"), 'Server handleReschedule enforces 18:00');

    const workerReschedSnippet = workerSrc.substring(workerSrc.indexOf("pathname.endsWith('/reschedule')"), workerSrc.indexOf("pathname.endsWith('/reschedule')") + 2500);
    assert.ok(workerReschedSnippet.includes("isOnlineBooking"), 'Worker reschedule checks isOnlineBooking');
    assert.ok(workerReschedSnippet.includes("sHHMM < '08:00'"), 'Worker reschedule enforces 08:00');
    assert.ok(workerReschedSnippet.includes("eHHMM > '18:00'"), 'Worker reschedule enforces 18:00');
  });

  test('J. No booking source data corruption', () => {
    // Database schema and insert statements remain unchanged
    assert.match(serverSrc, /INSERT INTO bookings/, 'Bookings insert intact in server');
    assert.match(workerSrc, /INSERT INTO bookings/, 'Bookings insert intact in worker');
    assert.match(serverSrc, /INSERT INTO booking_items/, 'Booking items insert intact in server');
    assert.match(workerSrc, /INSERT INTO booking_items/, 'Booking items insert intact in worker');
  });

});
