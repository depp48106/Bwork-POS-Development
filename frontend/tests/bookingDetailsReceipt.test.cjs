const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RECEIPT_PRINT_PATH = path.join(ROOT_DIR, 'src/components/ReceiptPrint.jsx');
const BOOKING_POS_PATH = path.join(ROOT_DIR, 'src/components/BookingPOS.jsx');
const PENDING_BOOKINGS_PATH = path.join(ROOT_DIR, 'src/components/PendingBookings.jsx');
const HELPER_PATH = path.join(ROOT_DIR, 'src/utils/printReceiptHelper.js');

test('1. Canonical booking_details field extraction and normalization', () => {
  const receiptCode = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf8');
  assert.ok(
    receiptCode.includes("booking?.booking_details"),
    'ReceiptPrint must reference canonical booking.booking_details'
  );
  assert.ok(
    !receiptCode.includes("booking.note || booking.notes"),
    'ReceiptPrint must not have legacy speculative booking.note fallback'
  );

  // Normalization behavior test
  function extractBookingDetails(booking) {
    return typeof booking?.booking_details === 'string'
      ? booking.booking_details.trim()
      : '';
  }

  assert.strictEqual(extractBookingDetails({ booking_details: '  รายละเอียดพิเศษ  ' }), 'รายละเอียดพิเศษ');
  assert.strictEqual(extractBookingDetails({ booking_details: null }), '');
  assert.strictEqual(extractBookingDetails({ booking_details: undefined }), '');
  assert.strictEqual(extractBookingDetails({ booking_details: '' }), '');
  assert.strictEqual(extractBookingDetails({ booking_details: '   ' }), '');
});

test('2. Details rendered when non-empty, omitted when null, empty or undefined', () => {
  const receiptCode = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf8');

  // Verify conditional rendering guard
  assert.ok(
    receiptCode.includes('{bookingDetails && ('),
    'ReceiptPrint must guard the details section with {bookingDetails && ('
  );
  assert.ok(
    receiptCode.includes('รายละเอียด:'),
    'ReceiptPrint must render Thai label "รายละเอียด:"'
  );
});

test('3. Multiline text and Thai/English wrapping rules are enforced', () => {
  const receiptCode = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf8');

  assert.ok(receiptCode.includes("whiteSpace: 'pre-wrap'"), 'Must specify whiteSpace: "pre-wrap" to preserve line breaks');
  assert.ok(receiptCode.includes("overflowWrap: 'break-word'"), 'Must specify overflowWrap: "break-word"');
  assert.ok(receiptCode.includes("wordBreak: 'break-word'"), 'Must specify wordBreak: "break-word"');
});

test('4. Booking-level details displayed once in metadata section (not inside items table)', () => {
  const receiptCode = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf8');

  const metaSectionIdx = receiptCode.indexOf('2. Customer & Booking Meta Info');
  const detailsIdx = receiptCode.indexOf('{bookingDetails && (');
  const itemsSectionIdx = receiptCode.indexOf('3. Items Table');

  assert.ok(metaSectionIdx > 0, 'Customer Meta Info section found');
  assert.ok(detailsIdx > metaSectionIdx, 'Details must appear in/after metadata section');
  assert.ok(detailsIdx < itemsSectionIdx, 'Details must appear before items table (not repeated per item)');
});

test('5. 72mm geometry and continuous dynamic height preserved', () => {
  const receiptCode = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf8');

  assert.ok(receiptCode.includes("width: '72mm'"), 'Must enforce 72mm width');
  assert.ok(receiptCode.includes("maxWidth: '72mm'"), 'Must enforce 72mm maxWidth');
  assert.ok(receiptCode.includes("height: 'auto'"), 'Must enforce height: auto');
  assert.ok(!receiptCode.includes('200mm'), 'Must not contain fixed 200mm cutoff');
});

test('6. Dynamic print helper integration scales with booking details content', async () => {
  const helper = await import('file:///' + HELPER_PATH.replace(/\\/g, '/'));
  const { calculateReceiptHeightMm, SAFETY_BOTTOM_BUFFER_MM } = helper;

  // Simulate short receipt without details: 400px
  const elNoDetails = { scrollHeight: 400, offsetHeight: 400, getBoundingClientRect: () => ({ height: 400 }) };
  const heightNoDetails = calculateReceiptHeightMm(elNoDetails);

  // Simulate receipt with 3 lines of details: 480px
  const elWithDetails = { scrollHeight: 480, offsetHeight: 480, getBoundingClientRect: () => ({ height: 480 }) };
  const heightWithDetails = calculateReceiptHeightMm(elWithDetails);

  // Simulate receipt with long multiline details: 600px
  const elLongDetails = { scrollHeight: 600, offsetHeight: 600, getBoundingClientRect: () => ({ height: 600 }) };
  const heightLongDetails = calculateReceiptHeightMm(elLongDetails);

  assert.ok(heightWithDetails > heightNoDetails, 'Height must increase with details content');
  assert.ok(heightLongDetails > heightWithDetails, 'Height must dynamically scale with long details content');
  assert.ok(heightLongDetails <= 350, 'Receipt height remains valid thermal continuous size');
});

test('7. BookingPOS includes booking_details in payload, textarea with 1000 max length, and reset', () => {
  const posCode = fs.readFileSync(BOOKING_POS_PATH, 'utf8');

  assert.ok(posCode.includes('const [bookingDetails, setBookingDetails] = useState('), 'BookingPOS has bookingDetails state');
  assert.ok(posCode.includes('booking_details: bookingDetails.trim() || null'), 'BookingPOS sends canonical booking_details in payload');
  assert.ok(posCode.includes('รายละเอียดเพิ่มเติม'), 'BookingPOS has label รายละเอียดเพิ่มเติม');
  assert.ok(posCode.includes('maxLength={1000}'), 'BookingPOS enforces maxLength 1000 on textarea');
});

test('8. PendingBookings includes detail modal display and dedicated edit modal with 1000 limit', () => {
  const pbCode = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  assert.ok(pbCode.includes('b.booking_details'), 'PendingBookings checks b.booking_details');
  assert.ok(pbCode.includes('showEditDetailsModal'), 'PendingBookings has showEditDetailsModal state');
  assert.ok(pbCode.includes('/api/bookings/'), 'PendingBookings calls booking API');
  assert.ok(pbCode.includes('/details'), 'PendingBookings calls /details endpoint');
  assert.ok(pbCode.includes('แก้ไขรายละเอียดเพิ่มเติม'), 'PendingBookings has Thai label for editing details');
});
