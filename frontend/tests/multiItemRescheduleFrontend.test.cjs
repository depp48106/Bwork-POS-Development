const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PENDING_BOOKINGS_JSX = path.join(ROOT_DIR, 'src/components/PendingBookings.jsx');
const PENDING_BOOKINGS_CSS = path.join(ROOT_DIR, 'src/components/PendingBookings.css');

test('Phase EDIT-4C: Multi-Item Reschedule Frontend Implementation Test Suite', async (t) => {
  const jsxCode = fs.readFileSync(PENDING_BOOKINGS_JSX, 'utf8').replace(/\r\n/g, '\n');
  const cssCode = fs.readFileSync(PENDING_BOOKINGS_CSS, 'utf8').replace(/\r\n/g, '\n');

  await t.test('1. State Management: selectedRescheduleItemId is declared', () => {
    assert.ok(
      jsxCode.includes("const [selectedRescheduleItemId, setSelectedRescheduleItemId] = useState(null);"),
      'Must declare selectedRescheduleItemId state initialized to null'
    );
  });

  await t.test('2. Two-Stage Reschedule Flow in handleOpenReschedule', () => {
    // Single-item directly sets selectedRescheduleItemId
    assert.ok(
      jsxCode.includes('setSelectedRescheduleItemId(item.id || null);'),
      'Single-item booking automatically selects item.id'
    );
    // Multi-item clears selectedRescheduleItemId to show item selector screen
    assert.ok(
      jsxCode.includes('setSelectedRescheduleItemId(null);'),
      'Multi-item booking initializes with selectedRescheduleItemId = null'
    );
    // Has helper to initialize fields per item
    assert.ok(
      jsxCode.includes('const initRescheduleFields = (item, parentBooking = rescheduleTarget) => {'),
      'Contains initRescheduleFields helper function'
    );
  });

  await t.test('3. Stage 1: Item Selector Screen in Modal JSX', () => {
    assert.ok(
      jsxCode.includes('const isSelectingItem = isMulti && !selectedRescheduleItemId;'),
      'Calculates isSelectingItem flag when multi-item and no item is selected'
    );
    assert.ok(
      jsxCode.includes('STAGE 1: ITEM SELECTOR (for Multi-Item Bookings)'),
      'Renders Stage 1 Item Selector section'
    );
    assert.ok(
      jsxCode.includes('การจองนี้มีหลายรายการ'),
      'Displays multi-item notice header'
    );
    assert.ok(
      jsxCode.includes('className="pb-resched-item-card"'),
      'Renders item cards with pb-resched-item-card class'
    );
    assert.ok(
      jsxCode.includes('setSelectedRescheduleItemId(item.id);'),
      'Item card action button sets selectedRescheduleItemId'
    );
    assert.ok(
      jsxCode.includes('initRescheduleFields(item, rescheduleTarget);'),
      'Item card action button initializes reschedule fields for chosen item'
    );
  });

  await t.test('4. Stage 2: Edit Form Heading, Back Button, and Item Diff', () => {
    assert.ok(
      jsxCode.includes('ย้อนกลับไปเลือกรายการอื่น'),
      'Provides back button to return to Item Selector'
    );
    assert.ok(
      jsxCode.includes('onClick={() => setSelectedRescheduleItemId(null)}'),
      'Back button resets selectedRescheduleItemId to null'
    );
    assert.ok(
      jsxCode.includes('กำลังแก้ไข:'),
      'Displays active item heading badge'
    );
    assert.ok(
      jsxCode.includes('ยอดรายการนี้:'),
      'Shows item-specific subtotal diff in price recalculation summary'
    );
    assert.ok(
      jsxCode.includes('reschedulePriceCalc.oldItemSubtotal'),
      'References oldItemSubtotal in price calculation'
    );
    assert.ok(
      jsxCode.includes('reschedulePriceCalc.newItemSubtotal'),
      'References newItemSubtotal in price calculation'
    );
  });

  await t.test('5. Real-Time Overlap Detection Checks Internal Sibling Collisions', () => {
    assert.ok(
      jsxCode.includes('const internalOverlap = items.find(otherIt => {'),
      'Checks collision against sibling items within the same booking'
    );
    assert.ok(
      jsxCode.includes("customer_name: 'รายการอื่นในใบจองนี้'"),
      'Labels internal collision as sibling item conflict'
    );
  });

  await t.test('6. Payload Transmission: PUT body includes booking_item_id', () => {
    assert.ok(
      jsxCode.includes('booking_item_id: targetItemId,'),
      'Transmits target booking_item_id in PUT /api/bookings/:id/reschedule payload'
    );
  });

  await t.test('7. Error Handling: HTTP 409 Refresh and Specific Error Codes', () => {
    assert.ok(
      jsxCode.includes("res.status === 409 || data.code === 'ERR_CONCURRENT_MODIFICATION'"),
      'Detects HTTP 409 concurrent modification error'
    );
    assert.ok(
      jsxCode.includes('ข้อมูลการจองมีการเปลี่ยนแปลงจากผู้ใช้อื่น กรุณาตรวจสอบข้อมูลล่าสุดและลองใหม่อีกครั้ง'),
      'Displays Thai explanation on concurrent conflict'
    );
    assert.ok(
      jsxCode.includes('fetch(`/api/bookings/${rescheduleTarget.id}`)'),
      'Refreshes booking data on 409 collision'
    );
    assert.ok(
      jsxCode.includes("data.code === 'ERR_RESCHEDULE_BELOW_PAID'"),
      'Handles ERR_RESCHEDULE_BELOW_PAID error code'
    );
    assert.ok(
      jsxCode.includes("data.code === 'ERR_ROOM_OVERLAP'"),
      'Handles ERR_ROOM_OVERLAP error code'
    );
  });

  await t.test('8. CSS Styling in PendingBookings.css', () => {
    assert.ok(
      cssCode.includes('.pb-resched-item-card'),
      'Contains .pb-resched-item-card CSS rule'
    );
    assert.ok(
      cssCode.includes('.pb-resched-item-card:hover'),
      'Contains hover state for item cards'
    );
    assert.ok(
      cssCode.includes('@media (max-width: 640px)'),
      'Contains responsive mobile styling for item cards'
    );
  });

  await t.test('9. Stage 1 Item Card Security: Door PIN is NOT displayed on Item Selector cards', () => {
    const stage1Start = jsxCode.indexOf('{isSelectingItem ? (');
    const stage1End = jsxCode.indexOf('STAGE 2: EDIT FORM', stage1Start);
    assert.ok(stage1Start > 0 && stage1End > stage1Start, 'Stage 1 boundaries found');
    const stage1Snippet = jsxCode.substring(stage1Start, stage1End);

    assert.ok(!stage1Snippet.includes('PIN:'), 'Door PIN must not be exposed on Stage 1 selector cards');
    assert.ok(!stage1Snippet.includes('item.pin_code'), 'item.pin_code must not be rendered on selector cards');
  });

  await t.test('10. Stage 2 Financial Safety & Non-Promissory Messaging', () => {
    const stage2Start = jsxCode.indexOf('STAGE 2: EDIT FORM');
    const stage2End = jsxCode.indexOf('TAX INVOICE DETAILS & PRINT MODAL', stage2Start);
    assert.ok(stage2Start > 0 && stage2End > stage2Start, 'Stage 2 boundaries found');
    const stage2Snippet = jsxCode.substring(stage2Start, stage2End);

    // Non-promissory difference (no "คืนเงินส่วนต่าง" refund promise)
    assert.ok(!stage2Snippet.includes('คืนเงินส่วนต่าง'), 'Must not make automated refund promises (คืนเงินส่วนต่าง)');
    assert.ok(stage2Snippet.includes('ยอดลดลง'), 'Must display non-promissory difference (ยอดลดลง)');

    // Estimate disclaimer
    assert.ok(stage2Snippet.includes('ยอดเงินที่แสดงเป็นการประมาณการเบื้องต้น'), 'Must render estimate disclaimer note');

    // Blocking warning if total < paid
    assert.ok(stage2Snippet.includes('ไม่อนุญาตให้บันทึก: ยอดรวมใหม่'), 'Must display blocking warning when total < paid');
    assert.ok(stage2Snippet.includes('reschedulePriceCalc.newTotal < reschedulePriceCalc.paidAmount'), 'Submit button must be disabled when total < paid');

    // booking_details removed from Stage 2
    assert.ok(!stage2Snippet.includes('value={rescheduleDetails}'), 'booking_details textarea must not be present in Stage 2');
  });
});
