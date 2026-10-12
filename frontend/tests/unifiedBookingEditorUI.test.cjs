const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PENDING_BOOKINGS_PATH = path.join(ROOT_DIR, 'src/components/PendingBookings.jsx');

test('Phase EDIT-3: Unified Booking Editor UI Integration & LINE Policy Test Suite', async (t) => {
  const code = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf8').replace(/\r\n/g, '\n');

  await t.test('1. Single Unified Entry Point "แก้ไขการจอง" in Table Actions & Booking Details modal', () => {
    // Verified Table menu invokes handleOpenUnifiedEdit with 'schedule'
    assert.ok(code.includes("handleOpenUnifiedEdit(b, 'schedule')"), 'Table menu invokes handleOpenUnifiedEdit with default schedule tab');
    // Verified Details modal invokes handleOpenUnifiedEdit with fromDetail=true
    assert.ok(code.includes("handleOpenUnifiedEdit(b, 'schedule', true)"), 'Details modal invokes handleOpenUnifiedEdit with fromDetail=true');
    // Verified primary label
    assert.ok(code.includes('<span>แก้ไขการจอง</span>'), 'Renders label "แก้ไขการจอง"');
  });

  await t.test('2. Unified Editor Shell & 3 Segmented Navigation Tabs in Exact Order (A: Schedule, B: Customer, C: Details)', () => {
    assert.ok(code.includes('showUnifiedEditModal && unifiedEditTarget'), 'Conditional rendering of unified editor shell');
    assert.ok(code.includes("setUnifiedActiveTab('schedule')"), 'Tab switcher supports schedule tab');
    assert.ok(code.includes("setUnifiedActiveTab('customer')"), 'Tab switcher supports customer info tab');
    assert.ok(code.includes("setUnifiedActiveTab('details')"), 'Tab switcher supports details tab');

    assert.ok(code.includes('A. วัน / เวลา / ห้อง'), 'Renders Section A tab label: A. วัน / เวลา / ห้อง');
    assert.ok(code.includes('B. ข้อมูลผู้จอง'), 'Renders Section B tab label: B. ข้อมูลผู้จอง');
    assert.ok(code.includes('C. รายละเอียดเพิ่มเติม'), 'Renders Section C tab label: C. รายละเอียดเพิ่มเติม');

    // Verify ordering in tab navigation bar
    const posA = code.indexOf('A. วัน / เวลา / ห้อง');
    const posB = code.indexOf('B. ข้อมูลผู้จอง');
    const posC = code.indexOf('C. รายละเอียดเพิ่มเติม');
    assert.ok(posA > 0 && posB > posA && posC > posB, 'Tabs appear in exact sequence: Section A -> Section B -> Section C');
  });

  await t.test('3. Section A (Schedule) controls, real-time recalculation, and LINE notification review', () => {
    assert.ok(code.includes("unifiedActiveTab === 'schedule'"), 'Schedule section conditional view');
    assert.ok(code.includes('CustomDatePicker'), 'Embeds CustomDatePicker for date selection');
    assert.ok(code.includes('setRescheduleBookingType'), 'Allows switching between hourly, halfday, daily');
    assert.ok(code.includes('reschedulePriceCalc'), 'Embeds real-time price recalculation card');
    assert.ok(code.includes('rescheduleOverlapInfo.isOverlap'), 'Embeds real-time conflict overlap alert');
    assert.ok(code.includes('submitRescheduleBooking'), 'Binds submitRescheduleBooking to schedule save');
    assert.ok(
      code.includes('ส่งแจ้งเตือนเปลี่ยนวัน/เวลาหรือห้องผ่าน LINE OA'),
      'Displays explicit pre-save LINE notification notice when schedule changes and recipient exists'
    );
  });

  await t.test('4. Section A (Schedule) Multi-Item Safety Guard strictly isolates items[0]', () => {
    assert.ok(
      code.includes('const isMultiItem = Array.isArray(unifiedEditTarget.items) && unifiedEditTarget.items.length > 1;'),
      'Detects multi-item bookings'
    );
    assert.ok(
      code.includes('การจองหลายห้อง / หลายวัน (Multi-item Booking'),
      'Displays Multi-item Safety Guard header'
    );
    assert.ok(
      code.includes('เพื่อความถูกต้องของระบบและความปลอดภัยของรหัส PIN ทุกห้อง การแก้ไขวัน/เวลาสำหรับการจองแบบหลายรายการจะรองรับใน Phase ถัดไป (Phase EDIT-4)'),
      'Surfaces explicit safety notice locking multi-item schedule edits'
    );
    assert.ok(
      code.includes('🔒 กำหนดการถูกล็อกเพื่อความปลอดภัย'),
      'Renders security lock badge preventing unintended edits to items[0]'
    );
  });

  await t.test('5. Section B (Customer Info) field validation, pre-save diff review, and no-LINE policy', () => {
    assert.ok(code.includes("unifiedActiveTab === 'customer'"), 'Customer section conditional view');
    assert.ok(code.includes('value={customerInfoName}'), 'Binds customer name input');
    assert.ok(code.includes('value={customerInfoContact}'), 'Binds contact phone input');
    assert.ok(code.includes('value={customerInfoDepartment}'), 'Binds department input');
    assert.ok(code.includes('handleReviewCustomerInfo'), 'Triggers pre-save change summary review');
    assert.ok(code.includes('ตรวจสอบและบันทึกข้อมูลลูกค้า'), 'Action button confirms customer info update');
    assert.ok(
      code.includes('บันทึกข้อมูลโดยไม่ส่งแจ้งเตือน LINE OA'),
      'Displays pre-save review: "บันทึกข้อมูลโดยไม่ส่งแจ้งเตือน LINE OA" in Customer Info'
    );
  });

  await t.test('6. Section C (Additional Details) 1000-character limit, live counter, and no-LINE policy', () => {
    assert.ok(code.includes("unifiedActiveTab === 'details'"), 'Details section conditional view');
    assert.ok(code.includes('value={editDetailsText}'), 'Binds editDetailsText to textarea');
    assert.ok(code.includes('{editDetailsText.length}/1000'), 'Renders live character counter');
    assert.ok(code.includes('handleSaveBookingDetails'), 'Binds handleSaveBookingDetails to details save');
    assert.ok(
      code.includes('บันทึกข้อมูลโดยไม่ส่งแจ้งเตือน LINE OA'),
      'Clarifies that details edits save without sending LINE notification'
    );
  });

  await t.test('7. Independent Section Save Behavior & No Fake Cross-Endpoint Transactions', () => {
    assert.ok(code.includes('fetch(`/api/bookings/${customerInfoTarget.id}/customer-info`'), 'Uses customer-info endpoint');
    assert.ok(code.includes('fetch(`/api/bookings/${rescheduleTarget.id}/reschedule`'), 'Uses reschedule endpoint');
    assert.ok(code.includes('fetch(`/api/bookings/${editDetailsTarget.id}/details`'), 'Uses details endpoint');
  });

  await t.test('8. Mobile Responsiveness & Theme Token Adaptability', () => {
    assert.ok(code.includes("maxHeight: '92vh'"), 'Modal clamps to viewport height');
    assert.ok(code.includes("overflowY: 'auto'"), 'Modal scrolls vertically when content overflows');
    assert.ok(code.includes("backgroundColor: 'var(--bg-card)'"), 'Card uses semantic token --bg-card');
    assert.ok(code.includes("color: 'var(--text-main)'"), 'Typography uses semantic token --text-main');
    assert.ok(code.includes("color: 'var(--text-muted)'"), 'Labels use semantic token --text-muted');
  });

  await t.test('9. Seamless Return to Booking Details Modal', () => {
    assert.ok(code.includes('returnToDetailAfterUnified'), 'Tracks origin from Booking Details modal');
    assert.ok(
      code.includes('if (returnToDetailAfterUnified) {\n          setSelectedBooking(freshBooking);\n          setShowDetailModal(true);\n          setReturnToDetailAfterUnified(false);\n        }'),
      'Restores Booking Details modal on schedule save'
    );
  });
});
