const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const jsxSource = fs.readFileSync(path.join(__dirname, '../src/components/PendingBookings.jsx'), 'utf8');

test('Customer Information Editing Modal UI & Responsive Safety Contract', async (t) => {
  await t.test('1. Action Menu entry point integration in Table & Details modal', () => {
    assert.ok(jsxSource.includes('handleOpenCustomerInfoEdit(b)'), 'Dropdown action menu invokes handleOpenCustomerInfoEdit');
    assert.ok(jsxSource.includes('handleOpenCustomerInfoEdit(b, true)'), 'Details modal invokes handleOpenCustomerInfoEdit with fromDetail = true');
    assert.ok(jsxSource.includes('แก้ไขข้อมูลผู้จอง'), 'Action label displays "แก้ไขข้อมูลผู้จอง"');
  });

  await t.test('2. Mobile (400px) responsiveness and layout wrapping', () => {
    assert.ok(
      jsxSource.includes("gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))'"),
      'Contact phone and department grid uses auto-fit minmax(200px, 1fr) for responsive wrapping on mobile <= 440px'
    );
    assert.ok(jsxSource.includes("maxHeight: '90vh'"), 'Modal dialog clamps to 90vh on small screens');
    assert.ok(jsxSource.includes("overflowY: 'auto'"), 'Modal card scrolls vertically on mobile if content overflows');
  });

  await t.test('3. Light Mode and Dark Mode theme token adaptability', () => {
    assert.ok(jsxSource.includes("backgroundColor: 'var(--bg-card)'"), 'Modal surfaces use semantic --bg-card token');
    assert.ok(jsxSource.includes("color: 'var(--text-main)'"), 'Typography uses semantic --text-main token');
    assert.ok(jsxSource.includes("color: 'var(--text-muted)'"), 'Subtitles and labels use semantic --text-muted token');
    assert.ok(
      jsxSource.includes("backgroundColor: 'var(--bg-muted, rgba(125, 125, 125, 0.08))'"),
      'Pre-save review diff container uses theme-neutral background for high contrast in light/dark modes'
    );
  });

  await t.test('4. Field validation, character limits, and counter indicators', () => {
    assert.ok(jsxSource.includes('maxLength={100}'), 'Customer name and department enforce maxLength 100');
    assert.ok(jsxSource.includes('maxLength={50}'), 'Contact phone enforces maxLength 50');
    assert.ok(jsxSource.includes('maxLength={1000}'), 'Booking details enforces maxLength 1000');
    assert.ok(jsxSource.includes('{customerInfoDetails.length}/1000'), 'Booking details shows live character counter');
    assert.ok(jsxSource.includes('customerInfoDetails.length > 950 ? \'#ef4444\''), 'Character counter warns in red when approaching limit');
  });

  await t.test('5. Pre-Save Change Summary Diff modal verification', () => {
    assert.ok(jsxSource.includes('showCustomerInfoDiffModal && customerInfoTarget'), 'Diff modal conditionally renders on review');
    assert.ok(jsxSource.includes('customerInfoDiff.changedFields.map'), 'Diff modal maps over changed fields');
    assert.ok(jsxSource.includes('textDecoration: \'line-through\''), 'Old value is struck through in red');
    assert.ok(jsxSource.includes('color: \'#10b981\''), 'New value is highlighted in emerald green');
    assert.ok(jsxSource.includes('กลับไปแก้ไข'), 'Provides Back button to adjust edits');
    assert.ok(jsxSource.includes('ยืนยันการบันทึก'), 'Provides Confirm & Save button');
  });

  await t.test('6. Save button disabled when nothing changed', () => {
    assert.ok(
      jsxSource.includes('disabled={customerInfoLoading || !customerInfoDiff.hasChanged || !customerInfoName.trim()}'),
      'Save button strictly disabled when no changes detected or name is empty'
    );
  });

  await t.test('7. LINE OA recipient binding and toggle state', () => {
    assert.ok(
      jsxSource.includes('Boolean(booking.line_user_id)'),
      'LINE checkbox initializes enabled ONLY if booking has a valid line_user_id'
    );
    assert.ok(
      jsxSource.includes('!customerInfoTarget.line_user_id || customerInfoLoading'),
      'Checkbox is disabled when line_user_id is missing or request is in-flight'
    );
    assert.ok(
      jsxSource.includes('ไม่สามารถส่ง LINE ได้ (การจองนี้ไม่ได้จองผ่าน LINE OA)'),
      'Surfaces clear notice when booking was created without LINE binding'
    );
  });

  await t.test('8. Navigation return to Booking Details modal', () => {
    assert.ok(jsxSource.includes('setReturnToDetailAfterCustomerInfo(!!fromDetail)'), 'Preserves origin navigation state');
    assert.ok(
      jsxSource.includes('setShowDetailModal(true)'),
      'Re-opens Booking Details modal seamlessly upon cancel or successful save'
    );
  });

  await t.test('9. HTTP 409 Conflict handling in frontend', () => {
    assert.ok(
      jsxSource.includes('res.status === 409'),
      'Detects HTTP 409 Concurrency Conflict from server'
    );
    assert.ok(
      jsxSource.includes('ข้อมูลการจองได้รับการแก้ไขโดยผู้ใช้อื่นแล้ว กรุณารีเฟรชหน้าจอเพื่อดูข้อมูลล่าสุด'),
      'Prompts staff to refresh on conflict'
    );
  });
});
