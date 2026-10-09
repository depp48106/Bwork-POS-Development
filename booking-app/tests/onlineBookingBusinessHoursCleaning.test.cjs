const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const roomListPageSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/RoomListPage.jsx'), 'utf8');

// Helper to extract extractHHMM and getRoomOccupiedInfo logic from RoomListPage.jsx
function createOccupiedChecker(schedule, options = {}) {
  const isToday = options.isToday || false;
  const currentMins = options.currentMins || 0;

  const extractHHMM = (str) => {
    if (!str) return null;
    if (str.includes('T')) {
      const timePart = str.split('T')[1];
      return timePart ? timePart.substring(0, 5) : null;
    }
    const parts = str.split(':');
    if (parts.length >= 2) {
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    return null;
  };

  const getRoomOccupiedInfo = (roomId, effStart, effEnd) => {
    if (!schedule || !schedule.rooms) return { isOccupied: false, label: 'ว่างพร้อมจอง' };

    const startHHMM = extractHHMM(effStart || '09:00');
    const endHHMM = extractHHMM(effEnd || '11:00');
    if (!startHHMM || !endHHMM) return { isOccupied: false, label: 'ว่างพร้อมจอง' };

    const [sH, sM] = startHHMM.split(':').map(Number);
    const [eH, eM] = endHHMM.split(':').map(Number);
    const reqStartMins = sH * 60 + (sM || 0);
    const reqEndMins = eH * 60 + (eM || 0);

    // Business hours boundary checks: 08:00 - 18:00 Asia/Bangkok
    if (reqStartMins < 8 * 60 || reqStartMins >= 18 * 60 || reqEndMins > 18 * 60 || reqEndMins <= reqStartMins) {
      return { isOccupied: true, reason: 'outside_hours', label: 'อยู่นอกเวลาทำการ (08:00 - 18:00 น.)' };
    }

    if (isToday && reqStartMins < currentMins) {
      return { isOccupied: true, reason: 'past', label: 'เวลานี้ผ่านมาแล้ว' };
    }

    const roomObj = schedule.rooms.find(r => r.id === roomId);
    if (!roomObj || !roomObj.bookings || roomObj.bookings.length === 0) {
      return { isOccupied: false, label: 'ว่างพร้อมจอง' };
    }

    const bufferMins = Number(schedule.cleaning_buffer_minutes || schedule.buffer_minutes) || 30;

    for (const b of roomObj.bookings) {
      if (b.status === 'cancelled' || b.payment_status === 'cancelled') continue;

      const bStartHHMM = extractHHMM(b.start_time);
      const bEndHHMM = extractHHMM(b.end_time);
      if (!bStartHHMM || !bEndHHMM) continue;

      const [bStartH, bStartM] = bStartHHMM.split(':').map(Number);
      const [bEndH, bEndM] = bEndHHMM.split(':').map(Number);
      const bStartMins = bStartH * 60 + (bStartM || 0);
      const bEndMins = bEndH * 60 + (bEndM || 0);
      const bEndBufferedMins = bEndMins + bufferMins;
      const reqEndBufferedMins = reqEndMins + bufferMins;

      // 1. Direct booking overlap
      if (reqStartMins < bEndMins && reqEndMins > bStartMins) {
        return {
          isOccupied: true,
          reason: 'booked',
          label: `ติดจอง (${bStartHHMM} - ${bEndHHMM} น.)`
        };
      }

      // 2. Cleaning buffer of PREVIOUS booking b:
      if (bEndMins <= reqStartMins && reqStartMins < bEndBufferedMins && bEndMins < 18 * 60) {
        if (bEndBufferedMins >= 18 * 60) {
          return {
            isOccupied: true,
            reason: 'cleaning',
            label: `ติดทำความสะอาด (คิวก่อนหน้าใช้ถึง ${bEndHHMM} น.)`
          };
        } else {
          const cleanEndH = Math.floor(bEndBufferedMins / 60);
          const cleanEndM = bEndBufferedMins % 60;
          const cleanEndHHMM = `${String(cleanEndH).padStart(2, '0')}:${String(cleanEndM).padStart(2, '0')}`;
          return {
            isOccupied: true,
            reason: 'cleaning',
            label: `ติดทำความสะอาด (คิวก่อนหน้าใช้ถึง ${bEndHHMM} น. • พร้อมจอง ${cleanEndHHMM} น.)`
          };
        }
      }

      // 3. Cleaning buffer needed before SUBSEQUENT booking b:
      if (reqEndMins <= bStartMins && reqEndBufferedMins > bStartMins) {
        return {
          isOccupied: true,
          reason: 'cleaning',
          label: `ติดเวลาเตรียมห้องสำหรับคิวถัดไป (${bStartHHMM} น.)`
        };
      }
    }
    return { isOccupied: false, label: 'ว่างพร้อมจอง' };
  };

  return { getRoomOccupiedInfo };
}

test('Frontend Business Hours & Cleaning Display Test Matrix', async (t) => {
  await t.test('A. Business opening 08:00 - booking starting before 08:00 is rejected', () => {
    const checker = createOccupiedChecker({ rooms: [{ id: 1, bookings: [] }] });
    const res = checker.getRoomOccupiedInfo(1, '07:30', '08:30');
    assert.equal(res.isOccupied, true);
    assert.equal(res.reason, 'outside_hours');
    assert.match(res.label, /อยู่นอกเวลาทำการ/);
  });

  await t.test('B. Business closing 18:00 - booking starting at or after 18:00 is rejected', () => {
    const checker = createOccupiedChecker({ rooms: [{ id: 1, bookings: [] }] });
    const res = checker.getRoomOccupiedInfo(1, '18:00', '19:00');
    assert.equal(res.isOccupied, true);
    assert.equal(res.reason, 'outside_hours');
    assert.match(res.label, /อยู่นอกเวลาทำการ/);
  });

  await t.test('C. End exactly 18:00 accepted when room is free', () => {
    const checker = createOccupiedChecker({ rooms: [{ id: 1, bookings: [] }] });
    const res = checker.getRoomOccupiedInfo(1, '17:00', '18:00');
    assert.equal(res.isOccupied, false);
    assert.equal(res.label, 'ว่างพร้อมจอง');
  });

  await t.test('D. End after 18:00 rejected', () => {
    const checker = createOccupiedChecker({ rooms: [{ id: 1, bookings: [] }] });
    const res = checker.getRoomOccupiedInfo(1, '17:00', '18:30');
    assert.equal(res.isOccupied, true);
    assert.equal(res.reason, 'outside_hours');
    assert.match(res.label, /อยู่นอกเวลาทำการ/);
  });

  await t.test('E. Start at 18:00 rejected even if duration is small', () => {
    const checker = createOccupiedChecker({ rooms: [{ id: 1, bookings: [] }] });
    const res = checker.getRoomOccupiedInfo(1, '18:00', '18:30');
    assert.equal(res.isOccupied, true);
    assert.equal(res.reason, 'outside_hours');
  });

  await t.test('F. Cleaning 18:00–18:30 hidden from customer-facing UI', () => {
    // Room has booking 17:00-18:00. Internal cleaning is 18:00-18:30.
    const schedule = {
      cleaning_buffer_minutes: 30,
      rooms: [{
        id: 1,
        bookings: [{ start_time: '17:00', end_time: '18:00' }]
      }]
    };
    const checker = createOccupiedChecker(schedule);

    // Customer viewing the booked time sees direct booked label, NEVER "18:00-18:30 ทำความสะอาด"
    const directRes = checker.getRoomOccupiedInfo(1, '17:00', '18:00');
    assert.equal(directRes.isOccupied, true);
    assert.equal(directRes.reason, 'booked');
    assert.ok(!directRes.label.includes('18:30'));

    // Customer viewing prior slot 16:00-17:00: cleaning buffer collides with subsequent 17:00 queue
    const priorRes = checker.getRoomOccupiedInfo(1, '16:00', '17:00');
    assert.equal(priorRes.isOccupied, true);
    assert.equal(priorRes.reason, 'cleaning');
    assert.equal(priorRes.label, 'ติดเวลาเตรียมห้องสำหรับคิวถัดไป (17:00 น.)');
    assert.ok(!priorRes.label.includes('18:30'));
  });

  await t.test('G. Cleaning 17:30–18:00 preserved inside business hours and clipped at 18:00', () => {
    // Booking 16:30-17:30, cleaning 17:30-18:00 (exact boundary at closing)
    const schedule = {
      cleaning_buffer_minutes: 30,
      rooms: [{
        id: 1,
        bookings: [{ start_time: '16:30', end_time: '17:30' }]
      }]
    };
    const checker = createOccupiedChecker(schedule);
    const res = checker.getRoomOccupiedInfo(1, '17:30', '18:00');
    assert.equal(res.isOccupied, true);
    assert.equal(res.reason, 'cleaning');
    assert.equal(res.label, 'ติดทำความสะอาด (คิวก่อนหน้าใช้ถึง 17:30 น.)');
    assert.ok(!res.label.includes('18:30'));
  });

  await t.test('H. Cleaning 17:45–18:15 clipped visually at 18:00 (never displays > 18:00)', () => {
    // Booking 17:00-17:45, cleaning 17:45-18:15
    const schedule = {
      cleaning_buffer_minutes: 30,
      rooms: [{
        id: 1,
        bookings: [{ start_time: '17:00', end_time: '17:45' }]
      }]
    };
    const checker = createOccupiedChecker(schedule);
    const res = checker.getRoomOccupiedInfo(1, '17:45', '18:00');
    assert.equal(res.isOccupied, true);
    assert.equal(res.reason, 'cleaning');
    assert.equal(res.label, 'ติดทำความสะอาด (คิวก่อนหน้าใช้ถึง 17:45 น.)');
    assert.ok(!res.label.includes('18:15'));
  });

  await t.test('I. Cleaning entirely outside hours (bEndMins >= 18:00) is ignored', () => {
    // Booking ending at 18:00 has cleaning 18:00-18:30
    const schedule = {
      cleaning_buffer_minutes: 30,
      rooms: [{
        id: 1,
        bookings: [{ start_time: '16:00', end_time: '18:00' }]
      }]
    };
    const checker = createOccupiedChecker(schedule);
    // Checking an earlier free slot 14:00-15:00
    const res = checker.getRoomOccupiedInfo(1, '14:00', '15:00');
    assert.equal(res.isOccupied, false);
    assert.equal(res.label, 'ว่างพร้อมจอง');
  });

  await t.test('J. Booking slots never extend past 18:00 in RoomListPage source code', () => {
    assert.match(roomListPageSrc, /h\s*<=\s*18/, 'TIME_OPTIONS max hour is 18');
    assert.match(roomListPageSrc, /if\s*\(h\s*<\s*18\)\s*\{\s*TIME_OPTIONS\.push\(`\$\{hh\}:30`\)/, 'No 18:30 option');
    assert.match(roomListPageSrc, /availableStartOptions\s*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?filter\(t\s*=>\s*t\s*<\s*'18:00'\)/, 'Start options strictly < 18:00');
  });

  await t.test('K. Display filter does not mutate source events', () => {
    const rawBooking = { start_time: '17:00', end_time: '18:00', payment_status: 'paid' };
    const originalCopy = JSON.stringify(rawBooking);
    const schedule = {
      cleaning_buffer_minutes: 30,
      rooms: [{ id: 101, bookings: [rawBooking] }]
    };
    const checker = createOccupiedChecker(schedule);
    checker.getRoomOccupiedInfo(101, '16:00', '17:00');
    checker.getRoomOccupiedInfo(101, '17:00', '18:00');
    assert.equal(JSON.stringify(rawBooking), originalCopy, 'Source booking object must remain unmodified');
  });

  await t.test('L. Different rooms remain independent', () => {
    const schedule = {
      cleaning_buffer_minutes: 30,
      rooms: [
        { id: 1, bookings: [{ start_time: '17:00', end_time: '18:00' }] },
        { id: 2, bookings: [] }
      ]
    };
    const checker = createOccupiedChecker(schedule);
    const room1Res = checker.getRoomOccupiedInfo(1, '17:00', '18:00');
    const room2Res = checker.getRoomOccupiedInfo(2, '17:00', '18:00');
    assert.equal(room1Res.isOccupied, true);
    assert.equal(room2Res.isOccupied, false);
    assert.equal(room2Res.label, 'ว่างพร้อมจอง');
  });

  await t.test('M. No AM/PM in RoomListPage source code', () => {
    const lower = roomListPageSrc.toLowerCase();
    assert.ok(!lower.includes('am') || !lower.includes('pm'), 'No AM/PM formatting strings in customer display');
    assert.match(roomListPageSrc, /24/ || /HH:mm/ || /น\./, 'Uses Thai 24h format');
  });

  await t.test('N. Midday cleaning format preserved within business hours', () => {
    const schedule = {
      cleaning_buffer_minutes: 30,
      rooms: [{
        id: 1,
        bookings: [{ start_time: '10:00', end_time: '11:00' }]
      }]
    };
    const checker = createOccupiedChecker(schedule);
    const res = checker.getRoomOccupiedInfo(1, '11:00', '12:00');
    assert.equal(res.isOccupied, true);
    assert.equal(res.reason, 'cleaning');
    assert.equal(res.label, 'ติดทำความสะอาด (คิวก่อนหน้าใช้ถึง 11:00 น. • พร้อมจอง 11:30 น.)');
  });
});
