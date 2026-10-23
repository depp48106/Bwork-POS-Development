const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PENDING_BOOKINGS_PATH = path.join(ROOT_DIR, 'src/components/PendingBookings.jsx');
const PENDING_BOOKINGS_CSS_PATH = path.join(ROOT_DIR, 'src/components/PendingBookings.css');

test('1. Phase EDIT-4D: Reschedule Modal isolates schedule flow and preserves booking_details via separate details modal', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  // Verify embedding inside showRescheduleModal does NOT include details editing textarea
  const modalStart = code.indexOf('{showRescheduleModal && rescheduleTarget && (() => {');
  assert.ok(modalStart > 0, 'showRescheduleModal must exist');
  const modalEnd = code.indexOf('{/* TAX INVOICE DETAILS & PRINT MODAL */}', modalStart);
  assert.ok(modalEnd > modalStart, 'showRescheduleModal end boundary found');
  const modalSnippet = code.substring(modalStart, modalEnd);

  // Reschedule modal must NOT have booking_details textarea
  assert.ok(!modalSnippet.includes('value={rescheduleDetails}'), 'Reschedule modal must not contain rescheduleDetails textarea');

  // Dedicated showEditDetailsModal must contain the details editing textarea
  const detailsModalStart = code.indexOf('{showEditDetailsModal && editDetailsTarget && (');
  assert.ok(detailsModalStart > 0, 'showEditDetailsModal must exist');
  const detailsModalEnd = code.indexOf('{showCustomerInfoModal && customerInfoTarget && (', detailsModalStart);
  assert.ok(detailsModalEnd > detailsModalStart, 'showEditDetailsModal end boundary found');
  const detailsModalSnippet = code.substring(detailsModalStart, detailsModalEnd);

  assert.ok(detailsModalSnippet.includes('value={editDetailsText}'), 'Dedicated modal must bind editDetailsText');
  assert.ok(detailsModalSnippet.includes('maxLength={1000}'), 'Dedicated modal textarea must have maxLength 1000');
  assert.ok(detailsModalSnippet.includes('{editDetailsText.length}/1000'), 'Dedicated modal must render live counter {editDetailsText.length}/1000');
});

test('2. Phase EDIT-4D: Reschedule PUT payload preserves booking_details silently without overwriting', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  const submitFnStart = code.indexOf('const submitRescheduleBooking = async () => {');
  assert.ok(submitFnStart > 0, 'submitRescheduleBooking function must exist');
  const submitFnEnd = code.indexOf('const formatUsageDate =', submitFnStart);
  assert.ok(submitFnEnd > submitFnStart, 'submitRescheduleBooking function end boundary found');
  const submitSnippet = code.substring(submitFnStart, submitFnEnd);

  // PUT payload must NOT include booking_details so backend silently preserves existing details
  assert.ok(!submitSnippet.includes('booking_details: rescheduleDetails'), 'Reschedule payload must not overwrite booking_details');
  assert.ok(submitSnippet.includes('booking_details: rescheduleTarget.booking_details'), 'Local state must preserve existing booking_details');
});

test('3. Immediate UI State Synchronization on Reschedule Success', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');

  const submitFnStart = code.indexOf('const submitRescheduleBooking = async () => {');
  const submitFnEnd = code.indexOf('const formatUsageDate =', submitFnStart);
  const submitSnippet = code.substring(submitFnStart, submitFnEnd);

  // Immediately update bookings array in local state
  assert.ok(
    submitSnippet.includes('setBookings(prev => prev.map(item => item.id === targetId ? { ...item, ...freshBooking } : item))'),
    'Must update bookings table state synchronously on success'
  );

  // Immediately update selectedBooking
  assert.ok(
    submitSnippet.includes('setSelectedBooking(freshBooking)'),
    'Must update selectedBooking state synchronously on success'
  );

  // Reset modal state
  assert.ok(submitSnippet.includes('setShowRescheduleModal(false)'), 'Must close reschedule modal on success');
  assert.ok(submitSnippet.includes("setRescheduleDetails('')"), 'Must reset rescheduleDetails on success');
});

test('4. Seamless Navigation: Returns to Detail Modal when opened from Detail View', () => {
  const rawCode = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');
  const code = rawCode.replace(/\r\n/g, '\n');

  // Tracking state
  assert.ok(code.includes("const [returnToDetailAfterReschedule, setReturnToDetailAfterReschedule] = useState(false);"), 'Must define returnToDetailAfterReschedule state');

  // handleOpenReschedule with fromDetail parameter
  assert.ok(code.includes('const handleOpenReschedule = async (booking, fromDetail = false) => {'), 'handleOpenReschedule accepts fromDetail');
  assert.ok(code.includes('setReturnToDetailAfterReschedule(!!fromDetail);'), 'handleOpenReschedule sets return tracking');

  // Trigger from detail modal footer
  assert.ok(code.includes('handleOpenReschedule(b, true);'), 'Detail modal passes true for fromDetail');

  // Close / cancel restoration
  assert.ok(
    code.includes('if (returnToDetailAfterReschedule) {\n      setShowDetailModal(true);\n      setReturnToDetailAfterReschedule(false);\n    }'),
    'Closing reschedule modal returns to detail modal if opened from detail'
  );

  // Success restoration
  assert.ok(
    code.includes('if (returnToDetailAfterReschedule) {\n          setSelectedBooking(freshBooking);\n          setShowDetailModal(true);\n          setReturnToDetailAfterReschedule(false);\n        }'),
    'Submitting reschedule modal returns to detail modal with freshBooking if opened from detail'
  );
});

test('5. Modal Stacking & Z-Index Conflict Defense', () => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8');
  const css = fs.readFileSync(PENDING_BOOKINGS_CSS_PATH, 'utf8');

  // Extract base detail modal overlay z-index
  const overlayZIdxMatch = css.match(/\.pb-modal-overlay\s*\{[^}]*z-index:\s*(\d+);/);
  assert.ok(overlayZIdxMatch, 'pb-modal-overlay z-index found in CSS');
  const baseOverlayZIndex = parseInt(overlayZIdxMatch[1], 10);

  // Both Reschedule and Edit Details modals must have higher z-index than pb-modal-overlay
  const rescheduleModalSnippet = code.substring(
    code.indexOf('{showRescheduleModal && rescheduleTarget'),
    code.indexOf('{showRescheduleModal && rescheduleTarget') + 1600
  );
  const editDetailsModalSnippet = code.substring(
    code.indexOf('{showEditDetailsModal && editDetailsTarget'),
    code.indexOf('{showEditDetailsModal && editDetailsTarget') + 1600
  );

  const reschedZMatch = rescheduleModalSnippet.match(/zIndex:\s*(\d+)/);
  const editZMatch = editDetailsModalSnippet.match(/zIndex:\s*(\d+)/);

  assert.ok(reschedZMatch, 'Reschedule modal inline zIndex found');
  assert.ok(editZMatch, 'Edit details modal inline zIndex found');

  const reschedZIndex = parseInt(reschedZMatch[1], 10);
  const editZIndex = parseInt(editZMatch[1], 10);

  assert.ok(reschedZIndex > baseOverlayZIndex, `Reschedule modal zIndex (${reschedZIndex}) must be higher than overlay (${baseOverlayZIndex})`);
  assert.ok(editZIndex > baseOverlayZIndex, `Edit details modal zIndex (${editZIndex}) must be higher than overlay (${baseOverlayZIndex})`);
});
