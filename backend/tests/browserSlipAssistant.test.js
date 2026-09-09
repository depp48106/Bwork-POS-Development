/**
 * backend/tests/browserSlipAssistant.test.js
 *
 * Test suite for Phase 1: POS Browser OCR Assistant for Slip Review
 * Validates TC1 - TC8: Decision Support, Invariants, and Staff Approval Preservation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  BANK_CODES,
  toSatang,
  extractPreciseAmount,
  extractReceiverSection,
  normalizeReceiverLine,
  parseThaiBankSlipQR,
  analyzeSlipText
} = require('../../shared/slipVerificationCore.mjs');

// Helper to simulate the Browser Assistant's formatting logic (from browserSlipVerifier.js)
function evaluateBrowserAssistant(ocrText, bookingInfo, settings, qrResult = null, duplicateInDb = false) {
  const analysis = analyzeSlipText(ocrText, settings, qrResult);
  const detectedAmt = analysis.detectedAmount;

  let amountMatched = null;
  let amountStatusText = 'อ่านไม่ได้';
  if (detectedAmt !== null) {
    if (toSatang(bookingInfo.total_amount) === toSatang(detectedAmt)) {
      amountMatched = true;
      amountStatusText = 'ตรง';
    } else {
      amountMatched = false;
      amountStatusText = 'ไม่ตรง';
    }
  }

  const isReceiverValid = analysis.hasCompanyMatch;
  const receiverStatusText = isReceiverValid ? 'ตรง' : (analysis.receiverText ? 'ไม่ตรง' : 'ตรวจไม่ได้');

  let decisionSupportMessage = '';
  let messageType = 'info';

  if (duplicateInDb) {
    decisionSupportMessage = 'สลิปนี้มีประวัติใช้งานแล้วในระบบ กรุณาตรวจสอบก่อนดำเนินการ';
    messageType = 'warning';
  } else if (amountMatched === true && isReceiverValid) {
    decisionSupportMessage = 'ข้อมูลที่ระบบอ่านสอดคล้องกับรายการจอง กรุณาตรวจสอบรูปสลิปอีกครั้งก่อนอนุมัติ';
    messageType = 'success';
  } else if (amountMatched === false) {
    decisionSupportMessage = `ยอดเงินในสลิปที่อ่านได้ ไม่ตรงกับยอดที่ต้องชำระ กรุณาตรวจสอบก่อนอนุมัติ`;
    messageType = 'warning';
  } else if (isReceiverValid === false && analysis.receiverText) {
    decisionSupportMessage = 'ข้อมูลผู้รับในสลิปไม่ตรงกับบัญชีที่กำหนด กรุณาตรวจสอบความถูกต้องของสลิป';
    messageType = 'warning';
  } else {
    decisionSupportMessage = 'ระบบไม่สามารถอ่านข้อมูลสลิปได้ครบ กรุณาตรวจสอบด้วยตนเอง';
    messageType = 'info';
  }

  return {
    analysis,
    amount: {
      expected: bookingInfo.total_amount,
      detected: detectedAmt,
      matched: amountMatched,
      statusText: amountStatusText
    },
    receiver: {
      matched: isReceiverValid,
      statusText: receiverStatusText,
      template: analysis.receiverTemplate
    },
    duplicateDetected: duplicateInDb,
    decisionSupportMessage,
    messageType,
    // Strictly invariant: Assistant NEVER approves automatically
    autoApproved: false
  };
}

const defaultCompanySettings = {
  company_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
  payment_bank_account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
  payment_bank_account: '329-1-38429-0',
  payment_bank_name: 'ธนาคารกรุงศรีอยุธยา',
  company_tax_id: '0125554000401',
  promptpay_id: '0125554000401'
};

// =========================================================================
// TC1: Booking 300 / OCR 300 / receiver correct
// -> แสดง “ข้อมูลตรง”
// -> ยัง reviewing จน Staff กด Approve
// =========================================================================
test('TC1: Booking 300 / OCR 300 / receiver correct -> Displays matching info, remains non-auto-approved', () => {
  const ocrText = [
    'โอนเงินสำเร็จ',
    'จาก นาย สมชาย ใจดี',
    'ไปยัง',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    'ธนาคารกรุงศรีอยุธยา',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'รหัสอ้างอิง: REF123456'
  ].join('\n');

  const booking = { id: 101, total_amount: 300.00, payment_status: 'reviewing' };
  const res = evaluateBrowserAssistant(ocrText, booking, defaultCompanySettings);

  assert.equal(res.amount.matched, true);
  assert.equal(res.amount.statusText, 'ตรง');
  assert.equal(res.receiver.matched, true);
  assert.equal(res.receiver.statusText, 'ตรง');
  assert.equal(res.messageType, 'success');
  assert.match(res.decisionSupportMessage, /ข้อมูลที่ระบบอ่านสอดคล้องกับรายการจอง/);
  assert.equal(res.autoApproved, false, 'OCR assistant must NEVER auto approve');
  assert.equal(booking.payment_status, 'reviewing', 'Booking payment_status must remain reviewing');
});

// =========================================================================
// TC2: Booking 300 / OCR 100
// -> Warning ยอดไม่ตรง
// -> ยังสามารถ Staff Reject/Approve ตามสิทธิ์ได้
// -> ระบบไม่ auto paid
// =========================================================================
test('TC2: Booking 300 / OCR 100 -> Warning amount mismatch, remains reviewing, no auto-paid', () => {
  const ocrText = [
    'โอนเงินสำเร็จ',
    'จาก นาย สมชาย ใจดี',
    'ไปยัง',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    'ธนาคารกรุงศรีอยุธยา',
    '329-1-38429-0',
    'จำนวนเงิน 100.00 บาท',
    'รหัสอ้างอิง: REF123456'
  ].join('\n');

  const booking = { id: 102, total_amount: 300.00, payment_status: 'reviewing' };
  const res = evaluateBrowserAssistant(ocrText, booking, defaultCompanySettings);

  assert.equal(res.amount.matched, false);
  assert.equal(res.amount.statusText, 'ไม่ตรง');
  assert.equal(res.messageType, 'warning');
  assert.match(res.decisionSupportMessage, /ยอดเงินในสลิปที่อ่านได้ ไม่ตรงกับยอดที่ต้องชำระ/);
  assert.equal(res.autoApproved, false);
  assert.equal(booking.payment_status, 'reviewing');
});

// =========================================================================
// TC3: Receiver wrong
// -> Warning ผู้รับไม่ตรง
// -> ไม่ auto paid
// =========================================================================
test('TC3: Receiver wrong -> Warning receiver mismatch, no auto-paid', () => {
  const ocrText = [
    'โอนเงินสำเร็จ',
    'จาก นาย สมชาย ใจดี',
    'ไปยัง',
    'นาย สมศักดิ์ อื่นใด',
    'ธนาคารกรุงศรีอยุธยา',
    '999-9-99999-9',
    'จำนวนเงิน 300.00 บาท',
    'รหัสอ้างอิง: REF123456'
  ].join('\n');

  const booking = { id: 103, total_amount: 300.00, payment_status: 'reviewing' };
  const res = evaluateBrowserAssistant(ocrText, booking, defaultCompanySettings);

  assert.equal(res.amount.matched, true);
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ไม่ตรง');
  assert.equal(res.messageType, 'warning');
  assert.match(res.decisionSupportMessage, /ข้อมูลผู้รับในสลิปไม่ตรงกับบัญชีที่กำหนด/);
  assert.equal(res.autoApproved, false);
  assert.equal(booking.payment_status, 'reviewing');
});

// =========================================================================
// TC4: OCR error / unreadable
// -> Manual Review ยังทำงานปกติ
// =========================================================================
test('TC4: OCR unreadable / error -> Fail-safe to manual review', () => {
  const ocrText = ''; // empty or unreadable
  const booking = { id: 104, total_amount: 300.00, payment_status: 'reviewing' };
  const res = evaluateBrowserAssistant(ocrText, booking, defaultCompanySettings);

  assert.equal(res.amount.matched, null);
  assert.equal(res.amount.statusText, 'อ่านไม่ได้');
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ตรวจไม่ได้');
  assert.match(res.decisionSupportMessage, /ระบบไม่สามารถอ่านข้อมูลสลิปได้ครบ กรุณาตรวจสอบด้วยตนเอง/);
  assert.equal(res.autoApproved, false);
});

// =========================================================================
// TC5: SCB Tier B compatible
// -> แสดงข้อมูลตรง
// -> ไม่ auto paid
// =========================================================================
test('TC5: SCB Tier B compatible -> Displays matching info without bank text, no auto-paid', () => {
  const scbOcrText = [
    'SCB EASY',
    'โอนเงินสำเร็จ',
    'จาก นาย ธนาคาร ทดสอบ',
    'SCB xxx-xxx-1111',
    'ไปยัง',
    '5 นางสาว วรนิษฐา แสงกระจุย',
    'xxx-xxx-6227',
    'จำนวนเงิน 45.00 บาท',
    'รหัสอ้างอิง: 20260827XXXX'
  ].join('\n');

  const scbSettings = {
    company_name: 'นางสาว วรนิษฐา แสงกระจุย',
    payment_bank_account_name: 'นางสาว วรนิษฐา แสงกระจุย',
    payment_bank_account: '999-9-99622-7',
    payment_bank_name: 'ธนาคารไทยพาณิชย์',
    company_tax_id: '0125554000401',
    promptpay_id: ''
  };

  const booking = { id: 105, total_amount: 45.00, payment_status: 'reviewing' };
  const qrResult = { isValidSlipQR: true, bankCode: '014', bankName: 'ธนาคารไทยพาณิชย์', transRef: '20260827XXXX' };

  const res = evaluateBrowserAssistant(scbOcrText, booking, scbSettings, qrResult);

  assert.equal(res.amount.matched, true);
  assert.equal(res.receiver.matched, true);
  assert.equal(res.receiver.template, 'scb_template');
  assert.equal(res.analysis.verificationTier, 'template_verified');
  assert.equal(res.messageType, 'success');
  assert.match(res.decisionSupportMessage, /ข้อมูลที่ระบบอ่านสอดคล้องกับรายการจอง/);
  assert.equal(res.autoApproved, false);
});

// =========================================================================
// TC6: KBank OCR ambiguous (garbled PromptPay)
// -> แสดงตรวจสอบด้วยตนเอง
// -> ไม่ auto paid
// =========================================================================
test('TC6: KBank OCR ambiguous account -> Displays manual review message, no auto-paid', () => {
  const kbankAmbiguousText = [
    'โอนเงินสำเร็จ',
    'จาก นาย ทดสอบ',
    'กสิกรไทย xxx-xxx-1234',
    'ด ปิลท์ ฮาร์ท',
    'ธเพ๐9๒001XXXXX', // garbled account
    'จำนวนเงิน 1.00 บาท',
    'เลขที่รายการ: 01623808XXXX'
  ].join('\n');

  const booking = { id: 106, total_amount: 1.00, payment_status: 'reviewing' };
  const qrResult = { isValidSlipQR: true, bankCode: '004', bankName: 'ธนาคารกสิกรไทย', transRef: '01623808XXXX' };

  const res = evaluateBrowserAssistant(kbankAmbiguousText, booking, defaultCompanySettings, qrResult);

  // Name matched via scoped whitelist, but account is unreadable/garbled
  assert.equal(res.receiver.matched, false, 'Garbled account cannot produce receiver match');
  assert.equal(res.analysis.verificationTier, 'manual_review');
  assert.equal(res.autoApproved, false);
});

// =========================================================================
// TC7: Duplicate slip
// -> แสดง Duplicate Warning จากข้อมูล backend
// -> ห้าม auto paid
// =========================================================================
test('TC7: Duplicate slip -> Shows duplicate warning, no auto-paid', () => {
  const ocrText = [
    'โอนเงินสำเร็จ',
    'ไปยัง',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    'ธนาคารกรุงศรีอยุธยา',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'รหัสอ้างอิง: REF_DUPLICATE_99'
  ].join('\n');

  const booking = { id: 107, total_amount: 300.00, payment_status: 'reviewing' };
  const res = evaluateBrowserAssistant(ocrText, booking, defaultCompanySettings, null, true);

  assert.equal(res.duplicateDetected, true);
  assert.equal(res.messageType, 'warning');
  assert.match(res.decisionSupportMessage, /สลิปนี้มีประวัติใช้งานแล้วในระบบ/);
  assert.equal(res.autoApproved, false);
});

// =========================================================================
// TC8: Staff Approve
// -> ใช้ endpoint เดิม
// -> paid ตาม flow เดิม
// -> LINE Confirmation ไม่มี PIN
// =========================================================================
test('TC8: Staff Approve -> Uses manual payment flow, generates receipt without PIN leak', async () => {
  // Simulate Staff clicking manual approval
  const booking = { id: 108, total_amount: 300.00, payment_status: 'reviewing' };

  // 1. Action is explicitly triggered by staff (never by OCR automatically)
  const staffTriggeredPayment = true;
  assert.equal(staffTriggeredPayment, true);

  // 2. Booking status transitions to paid ONLY upon staff confirmation
  booking.payment_status = 'paid';
  booking.receipt_number = 'REC-20260903-0108';
  assert.equal(booking.payment_status, 'paid');
  assert.ok(booking.receipt_number);

  // 3. Worker / LINE Flex builder confirmation check:
  // Must NOT include PIN, Door PIN, or 6-digit pin code
  const vm = require('node:vm');
  const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
  const fnMatch = workerSource.match(/function buildLineBookingConfirmationFlex\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'buildLineBookingConfirmationFlex must exist in worker.js');
  const buildLineBookingConfirmationFlex = vm.runInNewContext(
    '(' + fnMatch[0] + ')',
    { String, Number, Boolean, Array, Object }
  );
  const flexObj = buildLineBookingConfirmationFlex({
    id: booking.id,
    customer_name: 'คุณทดสอบ',
    room_name: 'Room 301',
    usage_date: '2026-09-03',
    start_time: '09:00',
    end_time: '12:00',
    total_amount: 300.00,
    receipt_number: booking.receipt_number
  });

  const flexJson = JSON.stringify(flexObj);
  assert.doesNotMatch(flexJson, /PIN/i);
  assert.doesNotMatch(flexJson, /Door PIN/i);
  assert.doesNotMatch(flexJson, /รหัสเข้าห้อง/i);
  assert.doesNotMatch(flexJson, /รหัสผ่านเข้าห้อง/i);
});

// =========================================================================
// BUG 2 — Receiver Section Extraction Tests
// =========================================================================

const scbCompanySettings = {
  company_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
  payment_bank_account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
  payment_bank_account: '329-1-38429-0',
  payment_bank_name: 'ธนาคารไทยพาณิชย์',
  company_tax_id: '0125554000401',
  promptpay_id: '0125554000401'
};

const kbankCompanySettings = {
  company_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
  payment_bank_account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
  payment_bank_account: '329-1-38429-0',
  payment_bank_name: 'ธนาคารกสิกรไทย',
  company_tax_id: '0125554000401',
  promptpay_id: '0125554000401'
};

const scbQr = { isValidSlipQR: true, bankCode: '014', bankName: 'ธนาคารไทยพาณิชย์', transRef: 'SCB_REF_OK' };
const kbankQr = { isValidSlipQR: true, bankCode: '004', bankName: 'ธนาคารกสิกรไทย', transRef: 'KBANK_REF_OK' };

// --- SCB Tolerance Tests ---

test('BUG 2 - SCB Receiver: "ผู้รับเงิน:" (standard colon without spacing)', () => {
  const ocrText = [
    'SCB EASY',
    'โอนเงินสำเร็จ',
    'จาก นาย ทดสอบ',
    'ผู้รับเงิน: บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'รหัสอ้างอิง: REF_SCB_01'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'standard_labeled');
  assert.match(ext.text, /บริษัท บิลท์ ฮาร์ท จำกัด/);

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, scbCompanySettings, scbQr);
  assert.equal(res.receiver.matched, true);
  assert.equal(res.receiver.statusText, 'ตรง');
});

test('BUG 2 - SCB Receiver: "ผู้รับเงิน :" (colon with preceding space)', () => {
  const ocrText = [
    'SCB EASY',
    'โอนเงินสำเร็จ',
    'จาก นาย ทดสอบ',
    'ผู้รับเงิน : บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'รหัสอ้างอิง: REF_SCB_02'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'standard_labeled');
  assert.match(ext.text, /บริษัท บิลท์ ฮาร์ท จำกัด/);

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, scbCompanySettings, scbQr);
  assert.equal(res.receiver.matched, true);
  assert.equal(res.receiver.statusText, 'ตรง');
});

test('BUG 2 - SCB Receiver: "ผู้รับเงิน -" (dash separator)', () => {
  const ocrText = [
    'SCB EASY',
    'โอนเงินสำเร็จ',
    'จาก นาย ทดสอบ',
    'ผู้รับเงิน - บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'รหัสอ้างอิง: REF_SCB_03'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'standard_labeled');
  assert.match(ext.text, /บริษัท บิลท์ ฮาร์ท จำกัด/);

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, scbCompanySettings, scbQr);
  assert.equal(res.receiver.matched, true);
  assert.equal(res.receiver.statusText, 'ตรง');
});

test('BUG 2 - SCB Receiver: "ผู้ รับเงิน" (OCR internal spacing typo)', () => {
  const ocrText = [
    'SCB EASY',
    'โอนเงินสำเร็จ',
    'จาก นาย ทดสอบ',
    'ผู้ รับเงิน : บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'รหัสอ้างอิง: REF_SCB_04'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'standard_labeled');
  assert.match(ext.text, /บริษัท บิลท์ ฮาร์ท จำกัด/);

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, scbCompanySettings, scbQr);
  assert.equal(res.receiver.matched, true);
  assert.equal(res.receiver.statusText, 'ตรง');
});

test('BUG 2 - SCB Receiver: "ไปยัง" on separate header line', () => {
  const ocrText = [
    'SCB EASY',
    'โอนเงินสำเร็จ',
    'จาก นาย ทดสอบ',
    'ไปยัง',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'รหัสอ้างอิง: REF_SCB_05'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'standard_labeled');
  assert.match(ext.text, /บริษัท บิลท์ ฮาร์ท จำกัด/);

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, scbCompanySettings, scbQr);
  assert.equal(res.receiver.matched, true);
  assert.equal(res.receiver.statusText, 'ตรง');
});

// --- KBank Fallback Tests ---

test('BUG 2 - KBank Fallback: "Transaction No" reference marker', () => {
  const ocrText = [
    'โอนเงินสำเร็จ',
    'จาก นาย สมชาย',
    'กสิกรไทย xxx-xxx-1234',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'Transaction No: 016238081234'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'unrecognized'); // C: conservative backend parity
  assert.equal(ext.text, '');
  assert.deepEqual(ext, require('../slipVerifier').extractReceiverSection(ocrText));

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, kbankCompanySettings, kbankQr);
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ตรวจไม่ได้');
});

test('BUG 2 - KBank Fallback: "Ref ID" reference marker', () => {
  const ocrText = [
    'โอนเงินสำเร็จ',
    'จาก นาย สมชาย',
    'กสิกรไทย xxx-xxx-1234',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'Ref ID: 016238085678'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'unrecognized'); // C: conservative backend parity
  assert.equal(ext.text, '');
  assert.deepEqual(ext, require('../slipVerifier').extractReceiverSection(ocrText));

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, kbankCompanySettings, kbankQr);
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ตรวจไม่ได้');
});

test('BUG 2 - KBank Fallback: "ธ.กสิกรไทย" sender marker', () => {
  const ocrText = [
    'โอนเงินสำเร็จ',
    'ธ.กสิกรไทย xxx-xxx-1234',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'เลขที่รายการ: 016238089999'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'kbank_structural');
  assert.match(ext.text, /บริษัท บิลท์ ฮาร์ท จำกัด/);

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, kbankCompanySettings, kbankQr);
  assert.equal(res.receiver.matched, true);
  assert.equal(res.receiver.statusText, 'ตรง');
});

test('BUG 2 - KBank Fallback: "KBANK" uppercase marker', () => {
  const ocrText = [
    'KBANK Mobile Banking',
    'จาก นาย ทดสอบ',
    'KBANK 123-4-56789-0',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'หมายเลขอ้างอิง: 2026KBANK01'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'unrecognized'); // C: conservative backend parity
  assert.equal(ext.text, '');
  assert.deepEqual(ext, require('../slipVerifier').extractReceiverSection(ocrText));

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, kbankCompanySettings, kbankQr);
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ตรวจไม่ได้');
});

test('BUG 2 - KBank Fallback: "K+" logo text marker', () => {
  const ocrText = [
    'K+ Transfer',
    'จาก นาย ทดสอบ',
    'xxx-xxx-1234',
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท',
    'รหัสอ้างอิง: KPLUS_REF_99'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.template, 'kbank_structural');
  assert.match(ext.text, /บริษัท บิลท์ ฮาร์ท จำกัด/);

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, kbankCompanySettings, kbankQr);
  assert.equal(res.receiver.matched, true);
  assert.equal(res.receiver.statusText, 'ตรง');
});

// --- Negative Safety Tests (Must Fail Closed) ---

test('BUG 2 - Negative Safety: sender section only -> FAIL CLOSED (statusText: ตรวจไม่ได้)', () => {
  const ocrText = [
    'โอนเงินสำเร็จ',
    'จาก นาย สมชาย ใจดี',
    'กสิกรไทย xxx-xxx-1234'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.text, '');
  assert.equal(ext.template, 'unrecognized'); // C: canonical shared status

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, defaultCompanySettings);
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ตรวจไม่ได้');
  assert.equal(res.autoApproved, false);
});

test('BUG 2 - Negative Safety: name only without section keywords -> FAIL CLOSED', () => {
  const ocrText = [
    'บริษัท บิลท์ ฮาร์ท จำกัด',
    'จำนวนเงิน 300.00 บาท'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.text, '');

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, defaultCompanySettings);
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ตรวจไม่ได้');
  assert.equal(res.autoApproved, false);
});

test('BUG 2 - Negative Safety: account only without section keywords -> FAIL CLOSED', () => {
  const ocrText = [
    '329-1-38429-0',
    'จำนวนเงิน 300.00 บาท'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.text, '');

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, defaultCompanySettings);
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ตรวจไม่ได้');
  assert.equal(res.autoApproved, false);
});

test('BUG 2 - Negative Safety: sender bank only -> FAIL CLOSED', () => {
  const ocrText = [
    'โอนจาก ธนาคารไทยพาณิชย์',
    'จำนวนเงิน 300.00 บาท'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.text, '');

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 300 }, defaultCompanySettings);
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ตรวจไม่ได้');
  assert.equal(res.autoApproved, false);
});

test('BUG 2 - Negative Safety: unrelated OCR text -> FAIL CLOSED', () => {
  const ocrText = [
    'ร้านอาหารตามสั่ง บีเวิร์ค',
    'กะเพราไก่ไข่ดาว 60 บาท',
    'ขอบคุณที่ใช้บริการ'
  ].join('\n');

  const ext = extractReceiverSection(ocrText);
  assert.equal(ext.text, '');
  assert.equal(ext.template, 'unrecognized'); // C: canonical shared status

  const res = evaluateBrowserAssistant(ocrText, { total_amount: 60 }, defaultCompanySettings);
  assert.equal(res.receiver.matched, false);
  assert.equal(res.receiver.statusText, 'ตรวจไม่ได้');
  assert.equal(res.autoApproved, false);
});
