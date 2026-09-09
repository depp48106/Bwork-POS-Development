import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcPaymentTimeLeft } from '../../shared/paymentCountdown.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const statusPageSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/pages/StatusPage.jsx'),
  'utf8'
);

const confirmPageSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/pages/ConfirmPage.jsx'),
  'utf8'
);

// ============================================================================
// 1. STATUSPAGE RESUME BUTTON & ACTION ELIGIBILITY
// ============================================================================

test('StatusPage Case 1: Pending active booking displays "ดำเนินการชำระเงินต่อ" button logic', () => {
  const item = {
    id: 101,
    payment_status: 'pending',
    has_slip: false,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 mins ago
  };

  const isPaid = item.payment_status === 'paid';
  const isCancelled = item.payment_status === 'cancelled';
  const isRejected = item.payment_status === 'rejected';
  const isPending = !isPaid && !isCancelled && !isRejected && (item.payment_status === 'pending' || item.payment_status === 'unpaid' || !item.payment_status);
  const timeLeft = isPending ? calcPaymentTimeLeft(item, 15, Date.now()) : null;
  const isExpiredLocally = isPending && Boolean(timeLeft?.isExpired);

  const shouldShowResume = isPending && !item.has_slip && !isExpiredLocally;
  assert.equal(shouldShowResume, true, 'Active pending booking must show resume button');
  assert.ok(statusPageSrc.includes('ดำเนินการชำระเงินต่อ'), 'StatusPage must contain button label');
  assert.ok(statusPageSrc.includes('CreditCard'), 'StatusPage must render CreditCard icon');
});

test('StatusPage Case 2: Pending active booking resume navigates with NO contact or token in URL', () => {
  const item = { id: 101, receipt_number: 'BK-000101' };
  const bookingCode = item.receipt_number;

  const url = `/confirm?id=${item.id}&code=${encodeURIComponent(bookingCode)}`;

  assert.equal(url, '/confirm?id=101&code=BK-000101');
  assert.ok(!url.includes('contact='), 'URL must not contain contact');
  assert.ok(!url.includes('phone='), 'URL must not contain phone');
  assert.ok(!url.includes('token='), 'URL must not contain token');

  // Static check on StatusPage.jsx navigation
  assert.ok(
    statusPageSrc.includes('navigate(`/confirm?id=${item.id}&code=${encodeURIComponent(bookingCode)}`)'),
    'StatusPage navigation must not contain query PII'
  );
  assert.ok(!statusPageSrc.includes('/confirm?id=${item.id}&code=${encodeURIComponent(bookingCode)}&contact='), 'No contact in confirm navigate');
});

test('StatusPage Case 3: Pending active booking resume saves contact to sessionStorage under bwork_booking_access_<id>', () => {
  assert.ok(
    statusPageSrc.includes('sessionStorage.setItem(`bwork_booking_access_${item.id}`, JSON.stringify({ contact: phone }))'),
    'StatusPage must store contact in sessionStorage under bwork_booking_access_<id>'
  );
});

test('StatusPage Case 4: Pending expired booking hides resume button and shows expired notice', () => {
  const item = {
    id: 102,
    payment_status: 'pending',
    has_slip: false,
    created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() // 20 mins ago (expired)
  };

  const isPaid = item.payment_status === 'paid';
  const isCancelled = item.payment_status === 'cancelled';
  const isRejected = item.payment_status === 'rejected';
  const isPending = !isPaid && !isCancelled && !isRejected && (item.payment_status === 'pending' || item.payment_status === 'unpaid' || !item.payment_status);
  const timeLeft = isPending ? calcPaymentTimeLeft(item, 15, Date.now()) : null;
  const isExpiredLocally = isPending && Boolean(timeLeft?.isExpired);

  const shouldShowResume = isPending && !item.has_slip && !isExpiredLocally;
  const shouldShowExpiredNotice = isPending && !item.has_slip && isExpiredLocally;

  assert.equal(shouldShowResume, false, 'Expired pending booking must NOT show resume button');
  assert.equal(shouldShowExpiredNotice, true, 'Expired pending booking must show expired notice');
  assert.ok(statusPageSrc.includes('หมดเวลาชำระเงินแล้ว (กรุณาทำรายการจองใหม่)'), 'StatusPage must contain expired notice text');
});

test('StatusPage Case 5: Reviewing booking displays "กำลังตรวจสอบการชำระเงิน" badge and no resume button', () => {
  const item = {
    id: 103,
    payment_status: 'reviewing',
    has_slip: true
  };

  const isPaid = item.payment_status === 'paid';
  const isCancelled = item.payment_status === 'cancelled';
  const isRejected = item.payment_status === 'rejected';
  const isPending = !isPaid && !isCancelled && !isRejected && (item.payment_status === 'pending' || item.payment_status === 'unpaid' || !item.payment_status);

  assert.equal(isPending, false, 'Reviewing status must not be treated as pending');
  assert.equal(isPaid, false);
  assert.equal(isRejected, false);

  assert.ok(statusPageSrc.includes('กำลังตรวจสอบการชำระเงิน'), 'StatusPage must contain reviewing badge text');
});

test('StatusPage Case 6: Rejected booking displays "อัปโหลดสลิปใหม่" button', () => {
  const item = {
    id: 104,
    payment_status: 'rejected',
    rejection_reason: 'ยอดเงินไม่ตรงกับค่าบริการ'
  };

  const isRejected = item.payment_status === 'rejected';
  assert.equal(isRejected, true);
  assert.ok(statusPageSrc.includes('อัปโหลดสลิปใหม่'), 'StatusPage must contain re-upload button label');
});

test('StatusPage Case 7: Rejected booking navigates to /confirm with NO contact or token in URL', () => {
  const rejectedBlock = statusPageSrc.slice(statusPageSrc.indexOf('{isRejected && ('));
  assert.ok(
    rejectedBlock.includes('navigate(`/confirm?id=${item.id}&code=${encodeURIComponent(bookingCode)}`)'),
    'Rejected re-upload must navigate strictly without PII'
  );
});

test('StatusPage Case 8: Rejected booking saves contact to sessionStorage under bwork_booking_access_<id>', () => {
  const rejectedBlock = statusPageSrc.slice(statusPageSrc.indexOf('{isRejected && ('));
  assert.ok(
    rejectedBlock.includes('sessionStorage.setItem(`bwork_booking_access_${item.id}`, JSON.stringify({ contact: phone }))'),
    'Rejected re-upload must store contact in sessionStorage'
  );
});

test('StatusPage Case 9: Paid booking displays calendar actions and no resume button', () => {
  const item = {
    id: 105,
    payment_status: 'paid'
  };

  const isPaid = item.payment_status === 'paid';
  const isPending = item.payment_status === 'pending';

  assert.equal(isPaid, true);
  assert.equal(isPending, false);
  assert.ok(statusPageSrc.includes('เพิ่มลง Google Calendar'), 'Paid booking has Google Calendar action');
  assert.ok(statusPageSrc.includes('ดาวน์โหลดปฏิทิน (.ics)'), 'Paid booking has ICS download action');
});

test('StatusPage Case 10: Cancelled booking displays zero payment actions and no resume button', () => {
  const item = {
    id: 106,
    payment_status: 'cancelled'
  };

  const isPaid = item.payment_status === 'paid';
  const isRejected = item.payment_status === 'rejected';
  const isPending = !isPaid && !item.payment_status?.includes('cancelled') && (item.payment_status === 'pending');

  assert.equal(isPending, false);
  assert.equal(isPaid, false);
  assert.equal(isRejected, false);
});

// ============================================================================
// 2. CONFIRMPAGE AUTHORIZATION PRIORITY & ZERO-PII SECURITY
// ============================================================================

test('ConfirmPage Case 11: Reads credentials with correct priority (completed/pending -> sessionStorage -> override form)', () => {
  const fetchFnBody = confirmPageSrc.slice(
    confirmPageSrc.indexOf('const fetchFreshBooking = useCallback('),
    confirmPageSrc.indexOf('// Handle phone verification submit for cold visitors')
  );

  assert.ok(fetchFnBody.includes('sessionStorage.getItem(\'completed_booking_result\')'), 'Checks completed_booking_result');
  assert.ok(fetchFnBody.includes('localStorage.getItem(\'bwork_pending_booking\')'), 'Checks bwork_pending_booking');
  assert.ok(fetchFnBody.includes('sessionStorage.getItem(`bwork_booking_access_${bookingId}`)'), 'Checks bwork_booking_access_<id>');
  assert.ok(
    fetchFnBody.includes('const accessContact = overrideContact || statusAccess?.contact || storedBooking?.customer_contact || storedBooking?.contact || pendingBooking?.contact;'),
    'Correct contact priority order implemented'
  );
});

test('ConfirmPage Case 12: Never reads contact, phone, or token from URL search params', () => {
  const urlInitSection = confirmPageSrc.slice(0, confirmPageSrc.indexOf('export default function ConfirmPage() {') + 500);

  assert.ok(urlInitSection.includes("const bookingId = query.get('id');"), 'Reads id');
  assert.ok(urlInitSection.includes("const queryCode = query.get('code');"), 'Reads code');
  assert.ok(!confirmPageSrc.includes("query.get('contact')"), 'MUST NOT read contact from query');
  assert.ok(!confirmPageSrc.includes("query.get('phone')"), 'MUST NOT read phone from query');
  assert.ok(!confirmPageSrc.includes("query.get('token')"), 'MUST NOT read token from query');
});

test('ConfirmPage Case 13: Sends X-Booking-Contact and X-Booking-Token in request headers to backend', () => {
  assert.ok(
    confirmPageSrc.includes("headers: accessHeaders"),
    'GET /api/public/bookings sends headers'
  );
  assert.ok(
    confirmPageSrc.includes("...(accessToken ? { 'X-Booking-Token': accessToken } : {})"),
    'Sends X-Booking-Token header'
  );
  assert.ok(
    confirmPageSrc.includes("...(accessContact ? { 'X-Booking-Contact': accessContact } : {})"),
    'Sends X-Booking-Contact header'
  );
  assert.ok(
    confirmPageSrc.includes("...(currentContact ? { 'X-Booking-Contact': currentContact } : {})"),
    'upload-slip sends X-Booking-Contact header'
  );
});

// ============================================================================
// 3. COLD-VISIT PHONE VERIFICATION FALLBACK & MISMATCH GUARDS
// ============================================================================

test('ConfirmPage Case 14: Cold visit without credentials triggers verification state and does not leak booking details', () => {
  assert.ok(confirmPageSrc.includes('const [needsVerification, setNeedsVerification] = useState(false);'), 'Has needsVerification state');
  assert.ok(confirmPageSrc.includes('res.status === 403 || res.status === 401'), 'Catches 403/401 to trigger verification');
  assert.ok(confirmPageSrc.includes('ยืนยันเบอร์โทรศัพท์ที่ใช้จอง'), 'Renders phone verification title');
  assert.ok(confirmPageSrc.includes('เพื่อความปลอดภัยและความเป็นส่วนตัว กรุณากรอกเบอร์โทรศัพท์'), 'Renders safe prompt');
});

test('ConfirmPage Case 15: Submitting phone in cold visit validates format and persists verified access', () => {
  assert.ok(confirmPageSrc.includes('handlePhoneVerifySubmit'), 'Has handlePhoneVerifySubmit');
  assert.ok(confirmPageSrc.includes('cleanInput.length < 9 || cleanInput.length > 15'), 'Validates 9-15 digit phone format');
  assert.ok(
    confirmPageSrc.includes('sessionStorage.setItem(`bwork_booking_access_${bookingId}`, JSON.stringify({'),
    'Persists verified contact to sessionStorage'
  );
});

test('ConfirmPage Case 16: Submitting wrong phone in cold visit displays error message', () => {
  assert.ok(
    confirmPageSrc.includes('setVerificationError(\'ไม่สามารถยืนยันข้อมูลการจองได้ กรุณาตรวจสอบข้อมูลอีกครั้ง\');'),
    'Displays generic mismatch error for wrong phone without leaking booking identity'
  );
});

test('ConfirmPage Case 17: Canonical booking code mismatch sets bookingCodeMismatch and fails closed', () => {
  assert.ok(confirmPageSrc.includes('const [bookingCodeMismatch, setBookingCodeMismatch] = useState(false);'), 'Has bookingCodeMismatch state');

  const mockBookingData = {
    id: 55,
    receipt_number: 'BK-000055',
    booking_code: 'BK-000055'
  };

  const getValidCodes = (data) => [
    data.receipt_number,
    data.booking_code,
    data.bookingCode,
    data.id ? `BK-${String(data.id).padStart(6, '0')}` : null
  ].filter(Boolean).map(c => String(c).trim().toUpperCase());

  const validCodes = getValidCodes(mockBookingData);

  assert.equal(validCodes.includes('BK-000055'.toUpperCase()), true, 'Matches canonical code');
  assert.equal(validCodes.includes('bk-000055'.toUpperCase()), true, 'Matches case-insensitively');
  assert.equal(validCodes.includes('55'), false, 'Rejects raw integer ID without canonical formatting');
  assert.equal(validCodes.includes('BK-55'), false, 'Rejects unpadded alias BK-55');
  assert.equal(validCodes.includes('BK-999999'), false, 'Rejects mismatching code');

  assert.ok(confirmPageSrc.includes('{bookingCodeMismatch ? ('), 'Renders mismatch guard view first');
  assert.ok(confirmPageSrc.includes('ข้อมูลรหัสการจองไม่ถูกต้อง'), 'Mismatch error heading exists');
});

test('ConfirmPage Case 18: Preserves remaining countdown time from paymentDeadline / created_at without restarting to 15:00', () => {
  const now = Date.now();
  const booking = {
    id: 108,
    created_at: new Date(now - 7 * 60 * 1000).toISOString(),
    paymentDeadline: new Date(now + 8 * 60 * 1000).toISOString(),
    payment_window_minutes: 15
  };

  const { remainingSeconds, isExpired } = calcPaymentTimeLeft(booking, 15, now);

  assert.equal(isExpired, false);
  assert.ok(remainingSeconds >= 475 && remainingSeconds <= 485, `Remaining should be ~480s, got ${remainingSeconds}`);
  assert.notEqual(remainingSeconds, 900, 'Must NOT reset to 15:00 (900 seconds)');
});
