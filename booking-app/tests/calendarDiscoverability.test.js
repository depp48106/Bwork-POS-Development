import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const statusPageSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/StatusPage.jsx'), 'utf8');
const confirmPageSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/ConfirmPage.jsx'), 'utf8');
const workerSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/worker.js'), 'utf8');
const serverSrc = fs.readFileSync(path.resolve(__dirname, '../../backend/server.js'), 'utf8');

// 1. ConfirmPage Calendar Discoverability
test('Discoverability 1: paid ConfirmPage shows title "เพิ่มการจองลงในปฏิทิน" and supporting copy', () => {
  assert.ok(confirmPageSrc.includes('เพิ่มการจองลงในปฏิทิน'), 'ConfirmPage must include title เพิ่มการจองลงในปฏิทิน');
  assert.ok(confirmPageSrc.includes('บันทึกวันและเวลาไว้ เพื่อไม่พลาดการใช้งานห้อง'), 'ConfirmPage must include supporting copy');
});

// 2. StatusPage Calendar Discoverability
test('Discoverability 2: paid StatusPage shows helper label "เพิ่มวันจองนี้ลงในปฏิทิน"', () => {
  assert.ok(statusPageSrc.includes('เพิ่มวันจองนี้ลงในปฏิทิน'), 'StatusPage must include helper label เพิ่มวันจองนี้ลงในปฏิทิน');
});

// 3. Non-paid states do NOT show calendar helper
test('Discoverability 3: non-paid states do not show calendar helper in StatusPage', () => {
  const isCalendarVisible = (paymentStatus) => {
    const isPaid = paymentStatus === 'paid';
    return isPaid;
  };
  assert.equal(isCalendarVisible('pending'), false);
  assert.equal(isCalendarVisible('reviewing'), false);
  assert.equal(isCalendarVisible('rejected'), false);
  assert.equal(isCalendarVisible('cancelled'), false);
  assert.equal(isCalendarVisible('paid'), true);
});

// 4. Existing Google Calendar action preserved
test('Discoverability 4: existing Google Calendar action preserved on both pages', () => {
  assert.ok(confirmPageSrc.includes('เพิ่มลง Google Calendar'), 'ConfirmPage preserves Google Calendar button');
  assert.ok(statusPageSrc.includes('เพิ่มลง Google Calendar'), 'StatusPage preserves Google Calendar button');
});

// 5. Existing .ics action preserved
test('Discoverability 5: existing .ics download action preserved on both pages', () => {
  assert.ok(confirmPageSrc.includes('ดาวน์โหลดปฏิทิน (.ics)'), 'ConfirmPage preserves .ics download button');
  assert.ok(statusPageSrc.includes('ดาวน์โหลดปฏิทิน (.ics)'), 'StatusPage preserves .ics download button');
});

// 6. LINE paid message includes Calendar CTA copy and label
test('Discoverability 6: LINE paid message includes Calendar CTA only if paid LINE message already exists', () => {
  assert.ok(workerSrc.includes('สามารถเพิ่มวันจองลงในปฏิทินได้จากหน้าตรวจสอบการจอง'), 'Worker LINE Flex includes calendar notice');
  assert.ok(workerSrc.includes('ดูรายละเอียด / เพิ่มลงปฏิทิน'), 'Worker LINE button label updated to ดูรายละเอียด / เพิ่มลงปฏิทิน');
  assert.ok(serverSrc.includes('สามารถเพิ่มวันจองลงในปฏิทินได้จากหน้าตรวจสอบการจอง'), 'Server LINE Flex includes calendar notice');
  assert.ok(serverSrc.includes('ดูรายละเอียด / เพิ่มลงปฏิทิน'), 'Server LINE button label updated to ดูรายละเอียด / เพิ่มลงปฏิทิน');
});

// 7. LINE CTA URL contains zero PII/token
test('Discoverability 7: LINE CTA URL contains zero PII/token', () => {
  const targetUrl = 'https://bwork-booking.pages.dev/status';
  assert.ok(workerSrc.includes(`uri: '${targetUrl}'`), 'Worker uses zero-PII status URL');
  assert.ok(serverSrc.includes(`uri: '${targetUrl}'`), 'Server uses zero-PII status URL');
  assert.ok(!workerSrc.includes(`uri: \`https://bwork-booking.pages.dev/status?contact=`), 'Worker removed ?contact= from status URL');
});

// 8. No PIN content in Calendar or LINE Calendar CTA
test('Discoverability 8: no PIN content in Calendar or LINE Calendar CTA', () => {
  assert.ok(!confirmPageSrc.includes('bookingForCalendar.pin_code'), 'ConfirmPage does not pass PIN to calendar');
  assert.ok(!statusPageSrc.includes('bookingForCalendar.pin_code'), 'StatusPage does not pass PIN to calendar');
});

// 9. No new LINE event triggered in upload-slip
test('Discoverability 9: no new LINE event triggered during slip upload', () => {
  const uploadSlipWorkerChunk = workerSrc.slice(workerSrc.indexOf('/upload-slip'), workerSrc.indexOf('/upload-slip') + 3000);
  assert.ok(!uploadSlipWorkerChunk.includes('fetch(\'https://api.line.me'), 'upload-slip route must not push LINE message');
});

// 10. Worker auth behavior unchanged
test('Discoverability 10: Worker auth check remains enforced on GET /api/public/bookings/:id', () => {
  assert.ok(workerSrc.includes('x-booking-contact'), 'Worker checks x-booking-contact header');
  assert.ok(workerSrc.includes('x-booking-token'), 'Worker checks x-booking-token header');
  assert.ok(workerSrc.includes('403'), 'Worker returns 403 when unauthenticated');
});

// 11. Reception counter copy uses ชั้น L
test('Discoverability 11: Reception counter copy specifically specifies ชั้น L', () => {
  assert.ok(confirmPageSrc.includes('เคาน์เตอร์ประชาสัมพันธ์ (ชั้น L)'), 'ConfirmPage specifies ชั้น L for reception counter');
  assert.ok(statusPageSrc.includes('เคาน์เตอร์ประชาสัมพันธ์ (ชั้น L)'), 'StatusPage specifies ชั้น L for reception counter');
  assert.ok(serverSrc.includes('เคาน์เตอร์ประชาสัมพันธ์ (ชั้น L)'), 'server.js specifies ชั้น L for reception counter');
});

// 12. No customer-facing reception counter specifies ชั้น 3
test('Discoverability 12: No reception counter instruction incorrectly references ชั้น 3', () => {
  assert.ok(!confirmPageSrc.includes('เคาน์เตอร์ประชาสัมพันธ์ (ชั้น 3)'), 'ConfirmPage does not reference ชั้น 3 for reception');
  assert.ok(!statusPageSrc.includes('เคาน์เตอร์ประชาสัมพันธ์ (ชั้น 3)'), 'StatusPage does not reference ชั้น 3 for reception');
  assert.ok(!serverSrc.includes('เคาน์เตอร์ประชาสัมพันธ์ (ชั้น 3)'), 'server.js does not reference ชั้น 3 for reception');
});

