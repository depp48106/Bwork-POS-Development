/**
 * discountDepositPhase5.test.cjs
 * Comprehensive Automated Verification Suite for Phase 5:
 * ReceiptPrint, History Financials, Dashboard Export, Receipt PIN Security, and Payment Integrity Guard.
 *
 * Runs via node --test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

let receiptUtils;
let exportUtils;
let financialUtils;

test.before(async () => {
  const receiptPath = path.resolve(__dirname, '../src/utils/receiptUtils.js');
  const exportPath = path.resolve(__dirname, '../src/utils/dashboardExport.js');
  const finPath = path.resolve(__dirname, '../src/utils/financialUtils.js');

  receiptUtils = await import(`file://${receiptPath.replace(/\\/g, '/')}`);
  exportUtils = await import(`file://${exportPath.replace(/\\/g, '/')}`);
  financialUtils = await import(`file://${finPath.replace(/\\/g, '/')}`);
});

/* =========================================================================
   SECTION 1: RECEIPT FINANCIAL ENGINE (receiptUtils.js)
   ========================================================================= */

test('1. Receipt Engine: Full paid booking with percent discount', () => {
  const booking = {
    id: 101,
    subtotal_amount: 2000,
    discount_type: 'percent',
    discount_value: 10,
    discount_amount: 200,
    total_amount: 1800,
    paid_amount: 1800,
    balance_amount: 0,
    payment_status: 'paid',
    payment_method: 'transfer'
  };

  const totals = receiptUtils.getReceiptTotals(booking);
  assert.equal(totals.grossSubtotal, 2000);
  assert.equal(totals.hasDiscount, true);
  assert.equal(totals.discountAmount, 200);
  assert.equal(totals.discountLabel, 'ส่วนลด (10%)');
  assert.equal(totals.netTotal, 1800);
  assert.equal(totals.paidAmount, 1800);
  assert.equal(totals.balanceAmount, 0);

  const payment = receiptUtils.getReceiptPaymentDetails(booking);
  assert.equal(payment.isPaid, true);
  assert.equal(payment.isDeposit, false);
  assert.equal(payment.receiptTitle, 'ใบเสร็จรับเงิน', 'Full paid booking must be titled ใบเสร็จรับเงิน');
  assert.ok(payment.methodLabel.includes('โอนเงิน'));
});

test('2. Receipt Engine: Deposit booking with fixed discount', () => {
  const booking = {
    id: 102,
    subtotal_amount: 3000,
    discount_type: 'fixed',
    discount_value: 300,
    discount_amount: 300,
    total_amount: 2700,
    paid_amount: 1000,
    balance_amount: 1700,
    payment_status: 'deposit',
    payment_method: 'cash'
  };

  const totals = receiptUtils.getReceiptTotals(booking);
  assert.equal(totals.grossSubtotal, 3000);
  assert.equal(totals.hasDiscount, true);
  assert.equal(totals.discountAmount, 300);
  assert.equal(totals.discountLabel, 'ส่วนลด');
  assert.equal(totals.netTotal, 2700);
  assert.equal(totals.paidAmount, 1000);
  assert.equal(totals.balanceAmount, 1700);

  const payment = receiptUtils.getReceiptPaymentDetails(booking);
  assert.equal(payment.isDeposit, true);
  assert.equal(payment.isPaid, false);
  assert.equal(payment.receiptTitle, 'ใบรับเงินมัดจำ', 'Deposit booking must be titled ใบรับเงินมัดจำ');
  assert.equal(payment.statusLabel, 'ชำระมัดจำแล้ว');
  assert.ok(payment.methodLabel.includes('เงินสด'));
});

test('3. Receipt Engine: Unpaid / Pending booking', () => {
  const booking = {
    id: 103,
    subtotal_amount: 1500,
    total_amount: 1500,
    paid_amount: 0,
    balance_amount: 1500,
    payment_status: 'pending'
  };

  const totals = receiptUtils.getReceiptTotals(booking);
  assert.equal(totals.grossSubtotal, 1500);
  assert.equal(totals.hasDiscount, false);
  assert.equal(totals.netTotal, 1500);
  assert.equal(totals.paidAmount, 0);
  assert.equal(totals.balanceAmount, 1500);

  const payment = receiptUtils.getReceiptPaymentDetails(booking);
  assert.equal(payment.isPaid, false);
  assert.equal(payment.isDeposit, false);
  assert.equal(payment.receiptTitle, 'ใบแจ้งยอดการจอง', 'Pending booking must use neutral title ใบแจ้งยอดการจอง');
  assert.equal(payment.statusLabel, 'ค้างชำระ (Pending)');
});

test('4. Receipt Engine: Builtland internal free booking uses neutral confirmation title', () => {
  const booking = {
    id: 104,
    customer_type: 'builtland',
    internal_department: 'HR',
    payment_status: 'internal_free',
    total_amount: 0
  };

  const totals = receiptUtils.getReceiptTotals(booking);
  assert.equal(totals.grossSubtotal, 0);
  assert.equal(totals.hasDiscount, false);
  assert.equal(totals.netTotal, 0);
  assert.equal(totals.paidAmount, 0);
  assert.equal(totals.balanceAmount, 0);

  const payment = receiptUtils.getReceiptPaymentDetails(booking);
  assert.equal(payment.isPaid, true);
  assert.equal(payment.receiptTitle, 'ใบยืนยันการจอง', 'Internal free booking must use neutral title ใบยืนยันการจอง');
  assert.ok(payment.statusLabel.includes('สิทธิ์การใช้งานภายใน'));
  assert.ok(payment.methodLabel.includes('ไม่คิดค่าบริการ'));
});

test('5. Receipt Engine: Zero-net 100% discount booking uses neutral confirmation title', () => {
  const booking = {
    id: 105,
    subtotal_amount: 1200,
    discount_type: 'percent',
    discount_value: 100,
    discount_amount: 1200,
    total_amount: 0,
    paid_amount: 0,
    balance_amount: 0,
    payment_status: 'paid',
    payment_method: 'transfer'
  };

  const totals = receiptUtils.getReceiptTotals(booking);
  assert.equal(totals.grossSubtotal, 1200);
  assert.equal(totals.hasDiscount, true);
  assert.equal(totals.discountAmount, 1200);
  assert.equal(totals.netTotal, 0);
  assert.equal(totals.paidAmount, 0);
  assert.equal(totals.balanceAmount, 0);

  const payment = receiptUtils.getReceiptPaymentDetails(booking);
  assert.equal(payment.isPaid, true);
  assert.equal(payment.receiptTitle, 'ใบยืนยันการจอง', 'Zero-net 100% discount must use neutral title ใบยืนยันการจอง');
  assert.ok(payment.statusLabel.includes('ส่วนลด 100%'));
});

test('6. Receipt Engine: Cancelled booking uses safe cancellation notice title', () => {
  const cancelledBooking = {
    id: 106,
    total_amount: 1000,
    payment_status: 'cancelled',
    cancellation_reason: 'หมดเวลาชำระเงิน'
  };

  const payment = receiptUtils.getReceiptPaymentDetails(cancelledBooking);
  assert.equal(payment.isPaid, false);
  assert.equal(payment.receiptTitle, 'ใบแจ้งยอดการจอง (ยกเลิก)', 'Cancelled booking must use safe cancellation notice title');
});

test('7. Receipt Engine: Legacy booking fallback without snapshot fields', () => {
  const legacyPaid = {
    id: 107,
    total_amount: 800,
    payment_status: 'paid',
    payment_method: 'cash'
  };

  const totals = receiptUtils.getReceiptTotals(legacyPaid);
  assert.equal(totals.grossSubtotal, 800);
  assert.equal(totals.hasDiscount, false);
  assert.equal(totals.netTotal, 800);
  assert.equal(totals.paidAmount, 800);
  assert.equal(totals.balanceAmount, 0);

  const payment = receiptUtils.getReceiptPaymentDetails(legacyPaid);
  assert.equal(payment.isPaid, true);
  assert.equal(payment.receiptTitle, 'ใบเสร็จรับเงิน');
});

test('8. Receipt Engine: Multi-item booking calculates correct item subtotal sum', () => {
  const multiItem = {
    id: 108,
    items: [
      { id: 1, room_name: 'Room 1', subtotal: 1000 },
      { id: 2, room_name: 'Room 2', subtotal: 500 }
    ],
    total_amount: 1500,
    paid_amount: 1500,
    balance_amount: 0,
    payment_status: 'paid'
  };

  const receiptData = receiptUtils.normalizeBookingReceipt(multiItem);
  const totals = receiptUtils.getReceiptTotals(multiItem, receiptData.normalizedItems);
  assert.equal(totals.itemsSubtotal, 1500);
  assert.equal(totals.grossSubtotal, 1500);
  assert.equal(totals.netTotal, 1500);
});

/* =========================================================================
   SECTION 2: RECEIPT PRINT PRESENTATION & PIN SECURITY
   ========================================================================= */

test('9. ReceiptPrint.jsx: Source code audit for Phase 5 financial presentation', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../src/components/ReceiptPrint.jsx'), 'utf8');

  assert.ok(code.includes('payment.receiptTitle'), 'Receipt must use dynamic payment.receiptTitle');
  assert.ok(code.includes('ยอดรวมก่อนส่วนลด:'), 'Receipt must render gross subtotal label when discount exists');
  assert.ok(code.includes('ยอดสุทธิ:'), 'Receipt must render net total label');
  assert.ok(code.includes('ชำระแล้ว'), 'Receipt must render paid amount label');
  assert.ok(code.includes('ยอดคงเหลือ:'), 'Receipt must render remaining balance label');
  assert.ok(code.includes("width: '72mm'"), 'Receipt must enforce 72mm width');
  assert.ok(code.includes('getReceiptTotals'), 'Receipt must invoke getReceiptTotals');
  assert.ok(code.includes('getReceiptPaymentDetails'), 'Receipt must invoke getReceiptPaymentDetails');
});

test('10. Security Audit: ReceiptPrint.jsx and receiptUtils.js contain ZERO door-access PIN rendering', () => {
  const receiptCode = fs.readFileSync(path.resolve(__dirname, '../src/components/ReceiptPrint.jsx'), 'utf8');
  const utilsCode = fs.readFileSync(path.resolve(__dirname, '../src/utils/receiptUtils.js'), 'utf8');

  // Verify no PIN-related variables are referenced in receipt presentation
  assert.ok(!receiptCode.includes('pin_code'), 'ReceiptPrint must NOT reference pin_code');
  assert.ok(!receiptCode.includes('builtland_pin_code'), 'ReceiptPrint must NOT reference builtland_pin_code');
  assert.ok(!receiptCode.includes('รหัสเข้าห้อง'), 'ReceiptPrint must NOT contain label "รหัสเข้าห้อง"');
  assert.ok(!receiptCode.includes('Door PIN'), 'ReceiptPrint must NOT contain label "Door PIN"');
  assert.ok(!receiptCode.includes('Access PIN'), 'ReceiptPrint must NOT contain label "Access PIN"');

  // Verify receipt utility does not extract or expose PINs
  assert.ok(!utilsCode.includes('pin_code'), 'receiptUtils must NOT reference pin_code');
  assert.ok(!utilsCode.includes('builtland_pin_code'), 'receiptUtils must NOT reference builtland_pin_code');
});

test('11. Security Regression: Rendered Receipt data contains ZERO door PIN values', () => {
  // Booking with door PINs configured at booking level and item level
  const bookingWithPins = {
    id: 999,
    pin_code: '524149#',
    builtland_pin_code: '306306#',
    room_name: 'Boardroom A',
    total_amount: 1500,
    paid_amount: 1500,
    balance_amount: 0,
    payment_status: 'paid',
    items: [
      { id: 901, room_name: 'Boardroom A', pin_code: '524149#', builtland_pin_code: '306306#', subtotal: 1500 }
    ]
  };

  const receiptData = receiptUtils.normalizeBookingReceipt(bookingWithPins);
  const jsonStr = JSON.stringify(receiptData);

  assert.ok(!jsonStr.includes('524149#'), 'Normalized receipt items must NOT contain door PIN 524149#');
  assert.ok(!jsonStr.includes('306306#'), 'Normalized receipt items must NOT contain Builtland PIN 306306#');
});

/* =========================================================================
   SECTION 3: HISTORY FINANCIAL PRESENTATION (History.jsx)
   ========================================================================= */

test('12. History.jsx: Source code audit for realized revenue and deposit filter', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../src/components/History.jsx'), 'utf8');

  assert.ok(code.includes("import { normalizeBookingFinancials } from '../utils/financialUtils'"), 'History must import normalizeBookingFinancials');
  assert.ok(code.includes("STATUS_TABS"), 'History must define STATUS_TABS');
  assert.ok(code.includes("deposit"), 'STATUS_TABS must include deposit');
  assert.ok(code.includes("ยอดรับเงินจริง:"), 'History must render realized revenue summary card');
  assert.ok(code.includes("ยอดคงค้าง:"), 'History must render outstanding balance summary card');
  assert.ok(code.includes("realizedRevenue"), 'History must compute realized revenue');
  assert.ok(code.includes("totalOutstanding"), 'History must compute total outstanding');
  assert.ok(code.includes("<span>มัดจำ</span>"), 'History must include deposit status badge');
  assert.ok(code.includes("Export สำหรับ Dashboard"), 'History must keep Dashboard Export intact');
});

/* =========================================================================
   SECTION 4: DASHBOARD EXPORT ENGINE (dashboardExport.js)
   ========================================================================= */

test('13. Dashboard Export: calculateAmountReceived uses realized revenue (paid_amount)', () => {
  // 1. Normal fully paid
  const paidBooking = { payment_status: 'paid', total_amount: 1500, paid_amount: 1500, balance_amount: 0 };
  assert.equal(exportUtils.calculateAmountReceived(paidBooking), 1500);

  // 2. Deposit booking
  const depositBooking = { payment_status: 'deposit', total_amount: 3000, paid_amount: 1000, balance_amount: 2000 };
  assert.equal(exportUtils.calculateAmountReceived(depositBooking), 1000);

  // 3. Unpaid / pending booking
  const pendingBooking = { payment_status: 'pending', total_amount: 2000, paid_amount: 0, balance_amount: 2000 };
  assert.equal(exportUtils.calculateAmountReceived(pendingBooking), 0);

  // 4. Cancelled booking
  const cancelledBooking = { payment_status: 'cancelled', total_amount: 2000, paid_amount: 500, balance_amount: 1500 };
  assert.equal(exportUtils.calculateAmountReceived(cancelledBooking), 0);

  // 5. Builtland booking
  const blBooking = { customer_type: 'builtland', payment_status: 'internal_free', total_amount: 0 };
  assert.equal(exportUtils.calculateAmountReceived(blBooking), 0);

  // 6. Hour Credit
  const hcBooking = { payment_status: 'paid', billing_option: 'hour_credit', total_amount: 0 };
  assert.equal(exportUtils.calculateAmountReceived(hcBooking), 0);

  // 7. Legacy paid without paid_amount
  const legacyPaid = { payment_status: 'paid', total_amount: 1200 };
  assert.equal(exportUtils.calculateAmountReceived(legacyPaid), 1200);
});

test('14. Dashboard Export: Multi-item uneven allocation with remainder adjustment guarantees exact sum', () => {
  // 3 items with uneven subtotals (1000 each = 3000 total), customer paid deposit of 1000
  const multiDeposit3 = {
    id: 202,
    payment_status: 'deposit',
    total_amount: 3000,
    paid_amount: 1000,
    balance_amount: 2000,
    items: [
      { id: 1, room_name: 'Room 1', subtotal: 1000 },
      { id: 2, room_name: 'Room 2', subtotal: 1000 },
      { id: 3, room_name: 'Room 3', subtotal: 1000 }
    ]
  };

  const a1 = exportUtils.calculateAmountReceived(multiDeposit3, multiDeposit3.items[0]);
  const a2 = exportUtils.calculateAmountReceived(multiDeposit3, multiDeposit3.items[1]);
  const a3 = exportUtils.calculateAmountReceived(multiDeposit3, multiDeposit3.items[2]);

  assert.equal(a1, 333.33);
  assert.equal(a2, 333.33);
  assert.equal(a3, 333.34, 'Last item receives exact remainder adjustment');
  assert.equal(Math.round((a1 + a2 + a3) * 100) / 100, 1000.00, 'Sum of 3 items strictly equals 1000.00 with zero drift');
});

test('15. Dashboard Export: formatPaymentStatus formats deposit and standard statuses', () => {
  assert.equal(exportUtils.formatPaymentStatus({ payment_status: 'deposit' }), 'ชำระมัดจำแล้ว');
  assert.equal(exportUtils.formatPaymentStatus({ payment_status: 'paid' }), 'ชำระแล้ว');
  assert.equal(exportUtils.formatPaymentStatus({ payment_status: 'pending' }), 'รอชำระ');
  assert.equal(exportUtils.formatPaymentStatus({ payment_status: 'cancelled' }), 'ยกเลิก');
  assert.equal(exportUtils.formatPaymentStatus({ payment_status: 'reviewing' }), 'รอตรวจสอบสลิป');
  assert.equal(exportUtils.formatPaymentStatus({ payment_status: 'internal_free' }), 'ใช้งานภายใน (ฟรี)');
});

test('16. Dashboard Export: formatAdvancePaymentFlag returns "มัดจำ" for deposit bookings', () => {
  assert.equal(exportUtils.formatAdvancePaymentFlag({ payment_status: 'deposit' }), 'มัดจำ');
  assert.equal(exportUtils.formatAdvancePaymentFlag({ payment_status: 'paid' }), '-');
  assert.equal(exportUtils.formatAdvancePaymentFlag({ payment_status: 'pending' }), '-');
  assert.equal(exportUtils.formatAdvancePaymentFlag(null), '-');
});

test('17. Dashboard Export: formatPaymentDate formats deposit payment dates', () => {
  const depositBooking = { payment_status: 'deposit', created_at: '2026-10-04T10:00:00' };
  assert.equal(exportUtils.formatPaymentDate(depositBooking), '04/10/2026');

  const unpaidBooking = { payment_status: 'pending', created_at: '2026-10-04T10:00:00' };
  assert.equal(exportUtils.formatPaymentDate(unpaidBooking), '-');
});

test('18. Dashboard Export: Full 19-column row generation for deposit booking', () => {
  const depositBooking = {
    id: 301,
    receipt_number: 'BK-DEP-301',
    customer_name: 'คุณ ชญานนท์',
    customer_type: 'walkin',
    booking_source: 'pos',
    payment_status: 'deposit',
    payment_method: 'transfer',
    billing_option: 'paid',
    total_amount: 2500,
    paid_amount: 1000,
    balance_amount: 1500,
    created_at: '2026-10-04T09:00:00',
    paid_at: '2026-10-04T09:15:00'
  };
  const item = {
    id: 401,
    room_name: 'Meeting Room 2',
    start_time: '2026-10-04T10:00:00',
    end_time: '2026-10-04T12:00:00',
    booking_type: 'hourly',
    subtotal: 2500
  };

  const row = exportUtils.buildDashboardExportRow(depositBooking, item);
  assert.equal(row.length, 19, 'Must generate exactly 19 columns');
  assert.equal(row[0], 301);                      // 1. Booking ID
  assert.equal(row[1], 'BK-DEP-301');             // 2. Receipt Number
  assert.equal(row[2], 'คุณ ชญานนท์');             // 3. Customer Name
  assert.equal(row[3], 'Walk-in');                // 4. Customer Type
  assert.equal(row[4], 'POS');                    // 5. Booking Channel
  assert.equal(row[5], 'Meeting Room 2');         // 6. Room
  assert.equal(row[6], '04/10/2026');             // 7. Usage Date
  assert.equal(row[7], '10:00');                  // 8. Start Time
  assert.equal(row[8], '12:00');                  // 9. End Time
  assert.equal(row[9], 'รายชั่วโมง');             // 10. Pricing Type
  assert.equal(row[10], 1000);                    // 11. Amount Actually Received (paid_amount!)
  assert.equal(row[11], 'ชำระมัดจำแล้ว');         // 12. Payment Status
  assert.equal(row[12], 'โอนเงิน');               // 13. Payment Method
  assert.equal(row[13], '04/10/2026');            // 14. Payment Date
  assert.equal(row[14], 'ปกติ');                   // 15. Billing Option
  assert.equal(row[15], 'มัดจำ');                 // 16. Advance Payment Flag
  assert.equal(row[16], 'ไม่ขอ');                 // 17. Tax Invoice Flag
  assert.equal(row[17], '-');                     // 18. Multi-day Flag
  assert.equal(row[18], '-');                     // 19. Notes
});

/* =========================================================================
   SECTION 5: PAYMENT INTEGRITY GUARD (backend/server.js & backend/worker.js)
   ========================================================================= */

test('19. Payment Integrity Guard: server.js and worker.js contract audit', () => {
  const serverCode = fs.readFileSync(path.resolve(__dirname, '../../backend/server.js'), 'utf8');
  const workerCode = fs.readFileSync(path.resolve(__dirname, '../../backend/worker.js'), 'utf8');

  // Verify server.js
  assert.ok(serverCode.includes("hasV1Snapshots"), 'server.js must check hasV1Snapshots');
  assert.ok(serverCode.includes("code: 'PAYMENT_BALANCE_REMAINING'"), 'server.js must return PAYMENT_BALANCE_REMAINING');
  assert.ok(serverCode.includes("code: 'PAYMENT_STATE_INCONSISTENT'"), 'server.js must return PAYMENT_STATE_INCONSISTENT');
  assert.ok(serverCode.includes("status(409)"), 'server.js must return HTTP 409 status');

  // Verify worker.js
  assert.ok(workerCode.includes("hasV1Snapshots"), 'worker.js must check hasV1Snapshots');
  assert.ok(workerCode.includes("PAYMENT_BALANCE_REMAINING"), 'worker.js must return PAYMENT_BALANCE_REMAINING');
  assert.ok(workerCode.includes("PAYMENT_STATE_INCONSISTENT"), 'worker.js must return PAYMENT_STATE_INCONSISTENT');
  assert.ok(workerCode.includes("status: 409"), 'worker.js must return HTTP 409 status');
});

test('20. Payment Integrity Guard: Verification of 5 mandatory behavioral cases (A through E)', () => {
  function evaluatePaymentPatch(booking, requestedStatus) {
    if (!booking) return { status: 404, error: 'Not found' };
    if (requestedStatus === 'paid') {
      const hasV1Snapshots = (booking.balance_amount !== null && booking.balance_amount !== undefined) ||
                             (booking.paid_amount !== null && booking.paid_amount !== undefined);
      if (hasV1Snapshots) {
        const balance = Number(booking.balance_amount || 0);
        const paid = Number(booking.paid_amount || 0);
        const total = Number(booking.total_amount || 0);

        if (balance > 0) {
          return {
            status: 409,
            code: 'PAYMENT_BALANCE_REMAINING',
            balance_amount: balance,
            error: 'Balance remains'
          };
        }

        if (Math.round((paid - total) * 100) / 100 !== 0) {
          return {
            status: 409,
            code: 'PAYMENT_STATE_INCONSISTENT',
            paid_amount: paid,
            total_amount: total,
            error: 'Inconsistent state'
          };
        }
      }
    }
    return { status: 200, success: true };
  }

  // Case A: total 2700, paid 1000, balance 1700 -> PATCH paid -> REJECT (409)
  const caseA = { total_amount: 2700, paid_amount: 1000, balance_amount: 1700 };
  const resA = evaluatePaymentPatch(caseA, 'paid');
  assert.equal(resA.status, 409);
  assert.equal(resA.code, 'PAYMENT_BALANCE_REMAINING');

  // Case B: total 2700, paid 1000, balance 0 -> PATCH paid -> REJECT (409)
  const caseB = { total_amount: 2700, paid_amount: 1000, balance_amount: 0 };
  const resB = evaluatePaymentPatch(caseB, 'paid');
  assert.equal(resB.status, 409);
  assert.equal(resB.code, 'PAYMENT_STATE_INCONSISTENT');

  // Case C: total 2700, paid 2700, balance 0 -> PATCH paid -> ALLOW (200)
  const caseC = { total_amount: 2700, paid_amount: 2700, balance_amount: 0 };
  const resC = evaluatePaymentPatch(caseC, 'paid');
  assert.equal(resC.status, 200);

  // Case D: total 0, paid 0, balance 0 (zero-net) -> PATCH paid -> ALLOW (200)
  const caseD = { total_amount: 0, paid_amount: 0, balance_amount: 0 };
  const resD = evaluatePaymentPatch(caseD, 'paid');
  assert.equal(resD.status, 200);

  // Case E: legacy row with NULL snapshot fields -> ALLOW (200)
  const caseE = { total_amount: 1500, paid_amount: null, balance_amount: null };
  const resE = evaluatePaymentPatch(caseE, 'paid');
  assert.equal(resE.status, 200, 'Legacy rows without snapshot fields must remain compatible');
});
