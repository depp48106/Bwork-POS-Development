const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const XLSX = require('xlsx');

let exportUtils;
test.before(async () => {
  const modPath = path.resolve(__dirname, '../src/utils/dashboardExport.js');
  exportUtils = await import(`file://${modPath.replace(/\\/g, '/')}`);
});

test('1. getTodayBangkokDate returns valid YYYY-MM-DD in Asia/Bangkok time', () => {
  const today = exportUtils.getTodayBangkokDate();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test('2. extractDatePart extracts YYYY-MM-DD from various formats', () => {
  assert.equal(exportUtils.extractDatePart('2026-09-11T14:30:00'), '2026-09-11');
  assert.equal(exportUtils.extractDatePart('2026-09-11 09:00:00'), '2026-09-11');
  assert.equal(exportUtils.extractDatePart('2026-09-11'), '2026-09-11');
  assert.equal(exportUtils.extractDatePart(null), '');
});

test('3. formatExportDate formats dates as DD/MM/YYYY', () => {
  assert.equal(exportUtils.formatExportDate('2026-09-11T10:00:00'), '11/09/2026');
  assert.equal(exportUtils.formatExportDate('2026-09-01'), '01/09/2026');
  assert.equal(exportUtils.formatExportDate(null), '-');
});

test('4. formatExportTime formats times as HH:mm', () => {
  assert.equal(exportUtils.formatExportTime('2026-09-11T09:30:00'), '09:30');
  assert.equal(exportUtils.formatExportTime('2026-09-11 14:00:00'), '14:00');
  assert.equal(exportUtils.formatExportTime('08:15:00'), '08:15');
  assert.equal(exportUtils.formatExportTime(null), '-');
});

test('5. filterBookingsForExport filters strictly by usage/service date, NOT created_at (Check E)', () => {
  const sampleBookings = [
    {
      id: 1,
      customer_name: 'Customer A (Created Today, Uses Today)',
      created_at: '2026-09-11T08:00:00',
      payment_status: 'paid',
      items: [
        { id: 101, room_name: 'Room 1', start_time: '2026-09-11T10:00:00', end_time: '2026-09-11T12:00:00', subtotal: 500 }
      ]
    },
    {
      id: 2,
      customer_name: 'Customer B (Created Today, Uses Tomorrow)',
      created_at: '2026-09-11T08:00:00', // created today!
      payment_status: 'paid',
      items: [
        { id: 102, room_name: 'Room 2', start_time: '2026-09-12T10:00:00', end_time: '2026-09-12T12:00:00', subtotal: 600 } // usage tomorrow
      ]
    },
    {
      id: 3,
      customer_name: 'Customer C (Created 3 days ago, Uses Today)',
      created_at: '2026-09-08T10:00:00', // created 3 days ago!
      payment_status: 'paid',
      items: [
        { id: 103, room_name: 'Room 3', start_time: '2026-09-11T14:00:00', end_time: '2026-09-11T16:00:00', subtotal: 700 } // usage today
      ]
    }
  ];

  const filtered = exportUtils.filterBookingsForExport(sampleBookings, '2026-09-11');
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].booking.id, 1);
  assert.equal(filtered[1].booking.id, 3);
});

test('6. Multi-room booking produces 1 row per item with correct room names', () => {
  const multiRoomBooking = [
    {
      id: 10,
      customer_name: 'Corporate Group',
      created_at: '2026-09-10T10:00:00',
      payment_status: 'paid',
      total_amount: 2200,
      items: [
        { id: 201, room_name: 'Room A', start_time: '2026-09-11T09:00:00', end_time: '2026-09-11T12:00:00', subtotal: 1000 },
        { id: 202, room_name: 'Room B', start_time: '2026-09-11T09:00:00', end_time: '2026-09-11T12:00:00', subtotal: 1200 }
      ]
    }
  ];

  const filtered = exportUtils.filterBookingsForExport(multiRoomBooking, '2026-09-11');
  assert.equal(filtered.length, 2);
  const rows = exportUtils.buildDashboardExportRows(filtered);
  assert.equal(rows[0][5], 'Room A');
  assert.equal(rows[0][10], 1000);
  assert.equal(rows[1][5], 'Room B');
  assert.equal(rows[1][10], 1200);
  assert.equal(rows[0][10] + rows[1][10], 2200, 'Sum of multi-item rows matches total_amount');
});

test('7. Check A: Revenue is NEVER overstated in multi-item bookings with discounts or quota', () => {
  // Booking with 2 items rack rate = 1000 each (sum = 2000), but customer paid discounted total_amount = 1200
  const discountedBooking = {
    id: 15,
    customer_name: 'Discounted Company',
    payment_status: 'paid',
    total_amount: 1200,
    items: [
      { id: 501, room_name: 'Room 1', start_time: '2026-09-11T09:00:00', end_time: '2026-09-11T11:00:00', subtotal: 1000 },
      { id: 502, room_name: 'Room 2', start_time: '2026-09-11T09:00:00', end_time: '2026-09-11T11:00:00', subtotal: 1000 }
    ]
  };

  const row1 = exportUtils.calculateAmountReceived(discountedBooking, discountedBooking.items[0]);
  const row2 = exportUtils.calculateAmountReceived(discountedBooking, discountedBooking.items[1]);

  assert.equal(row1, 600, 'Row 1 proportionally receives 600, not rack rate 1000');
  assert.equal(row2, 600, 'Row 2 proportionally receives 600, not rack rate 1000');
  assert.equal(row1 + row2, 1200, 'Sum of rows strictly equals 1200, avoiding revenue overstatement');
});

test('8. Check A & D: Zero-revenue cases strictly export amount = 0', () => {
  // Hour credit
  const hcBooking = { payment_status: 'paid', payment_method: 'hour_credit', billing_option: 'hour_credit', total_amount: 0 };
  assert.equal(exportUtils.calculateAmountReceived(hcBooking, { subtotal: 1500 }), 0);

  // Cancelled
  const cancelledBooking = { payment_status: 'cancelled', total_amount: 1500 };
  assert.equal(exportUtils.calculateAmountReceived(cancelledBooking, { subtotal: 1500 }), 0);

  // Builtland internal free
  const blBooking = { customer_type: 'builtland', payment_status: 'internal_free', total_amount: 0 };
  assert.equal(exportUtils.calculateAmountReceived(blBooking, { subtotal: 1500 }), 0);

  // Basecamp 100% quota
  const bcFreeBooking = { customer_type: 'basecamp', billing_option: 'quota', payment_status: 'paid', total_amount: 0 };
  assert.equal(exportUtils.calculateAmountReceived(bcFreeBooking, { subtotal: 1000 }), 0);

  // Pending / Reviewing
  const pendingBooking = { payment_status: 'pending', total_amount: 1500 };
  assert.equal(exportUtils.calculateAmountReceived(pendingBooking, { subtotal: 1500 }), 0);
});

test('9. Check B: Advance payment flag exports "-" as unsupported', () => {
  const booking = { created_at: '2026-09-01T10:00:00' };
  const item = { start_time: '2026-09-11T10:00:00' };
  assert.equal(exportUtils.formatAdvancePaymentFlag(booking, item), '-');
});

test('10. Check C: Basecamp uses exact POS source fields (customer_type, basecamp_sub_type, basecamp_unit, billing_option)', () => {
  const bcOffice = {
    customer_type: 'basecamp',
    basecamp_sub_type: 'office',
    basecamp_unit: '401',
    billing_option: 'quota'
  };
  assert.equal(exportUtils.formatCustomerType(bcOffice), 'Basecamp (Office 401)');
  assert.equal(exportUtils.formatBillingOption(bcOffice), 'โควต้า Basecamp');

  const bcHotdesk = {
    customer_type: 'basecamp',
    basecamp_sub_type: 'hotdesk',
    basecamp_unit: '419',
    billing_option: 'quota_partial'
  };
  assert.equal(exportUtils.formatCustomerType(bcHotdesk), 'Basecamp (Hotdesk 419)');
  assert.equal(exportUtils.formatBillingOption(bcHotdesk), 'โควต้า Basecamp');

  const bcDefault = { customer_type: 'basecamp' };
  assert.equal(exportUtils.formatCustomerType(bcDefault), 'Basecamp');
});

test('11. Check D: Hour Credit Booking B exports amount = 0, method = "เครดิตชั่วโมง", option = "เครดิตชั่วโมง"', () => {
  const hcBooking = {
    id: 99,
    receipt_number: 'BK-HC-99',
    customer_name: 'คุณ วรรณา (เครดิตชั่วโมง)',
    customer_type: 'walkin',
    booking_source: 'walk-in',
    payment_status: 'paid',
    payment_method: 'hour_credit',
    billing_option: 'hour_credit',
    total_amount: 0,
    created_at: '2026-09-11T10:00:00'
  };
  const item = {
    id: 991,
    room_name: 'Room 1',
    start_time: '2026-09-11T13:00:00',
    end_time: '2026-09-11T14:00:00',
    booking_type: 'hourly',
    price: 500,
    subtotal: 500
  };

  const row = exportUtils.buildDashboardExportRow(hcBooking, item);
  assert.equal(row[10], 0, 'Amount actually received must be 0');
  assert.equal(row[12], 'เครดิตชั่วโมง', 'Payment method must be เครดิตชั่วโมง');
  assert.equal(row[14], 'เครดิตชั่วโมง', 'Billing option must be เครดิตชั่วโมง');
});

test('12. Test 10 Representative Booking Records match required Dashboard semantics', () => {
  const records = [
    // 1. Normal paid booking
    {
      b: { id: 1, receipt_number: 'BK-001', customer_name: 'คุณ สมคิด', customer_type: 'walkin', payment_status: 'paid', payment_method: 'transfer', billing_option: 'paid', total_amount: 500, created_at: '2026-09-11T08:00:00', slip_verified_at: '2026-09-11T08:05:00' },
      item: { room_name: 'Room 1', start_time: '2026-09-11T09:00:00', end_time: '2026-09-11T11:00:00', booking_type: 'hourly', subtotal: 500 }
    },
    // 2. Walk-in
    {
      b: { id: 2, receipt_number: 'BK-002', customer_name: 'ลูกค้า Walk-in', customer_type: 'walkin', booking_source: 'walk-in', payment_status: 'paid', payment_method: 'cash', billing_option: 'paid', total_amount: 800, created_at: '2026-09-11T12:00:00' },
      item: { room_name: 'Room 2', start_time: '2026-09-11T13:00:00', end_time: '2026-09-11T15:00:00', booking_type: 'hourly', subtotal: 800 }
    },
    // 3. LINE OA booking
    {
      b: { id: 3, receipt_number: 'BK-003', customer_name: 'คุณ โชติ', customer_type: 'general', booking_channel: 'line_oa', booking_source: 'online', payment_status: 'paid', payment_method: 'transfer', billing_option: 'paid', total_amount: 1200, created_at: '2026-09-11T13:00:00' },
      item: { room_name: 'Room 3', start_time: '2026-09-11T14:00:00', end_time: '2026-09-11T17:00:00', booking_type: 'hourly', subtotal: 1200 }
    },
    // 4. Builtland
    {
      b: { id: 4, receipt_number: 'BK-004', customer_name: 'คุณ อารีพร', customer_type: 'builtland', internal_department: 'ฝ่ายบัญชี', payment_status: 'internal_free', billing_option: 'builtland', total_amount: 0, created_at: '2026-09-11T09:00:00' },
      item: { room_name: 'Boardroom', start_time: '2026-09-11T10:00:00', end_time: '2026-09-11T12:00:00', booking_type: 'hourly', subtotal: 1500 }
    },
    // 5. Basecamp
    {
      b: { id: 5, receipt_number: 'BK-005', customer_name: 'บจก. คลาวด์ซิงค์', customer_type: 'basecamp', basecamp_sub_type: 'office', basecamp_unit: '401', payment_status: 'paid', billing_option: 'quota', total_amount: 0, created_at: '2026-09-11T08:30:00' },
      item: { room_name: 'Room 2', start_time: '2026-09-11T09:00:00', end_time: '2026-09-11T11:00:00', booking_type: 'hourly', subtotal: 1000 }
    },
    // 6. Hour Credit Booking B
    {
      b: { id: 6, receipt_number: 'BK-006', customer_name: 'คุณ ธนกร', customer_type: 'walkin', payment_status: 'paid', payment_method: 'hour_credit', billing_option: 'hour_credit', total_amount: 0, created_at: '2026-09-11T14:00:00' },
      item: { room_name: 'Room 1', start_time: '2026-09-11T15:00:00', end_time: '2026-09-11T17:00:00', booking_type: 'hourly', subtotal: 1000 }
    },
    // 7. Cancelled booking
    {
      b: { id: 7, receipt_number: 'BK-007', customer_name: 'คุณ สุภาพร', customer_type: 'general', booking_channel: 'line_oa', payment_status: 'cancelled', cancellation_reason: 'หมดเวลาชำระเงิน', total_amount: 500, created_at: '2026-09-11T10:00:00' },
      item: { room_name: 'Room 4', start_time: '2026-09-11T11:00:00', end_time: '2026-09-11T12:00:00', booking_type: 'hourly', subtotal: 500 }
    },
    // 8. Pending/reviewing booking
    {
      b: { id: 8, receipt_number: 'BK-008', customer_name: 'คุณ พิชัย', customer_type: 'general', booking_channel: 'line_oa', payment_status: 'reviewing', total_amount: 800, created_at: '2026-09-11T15:00:00' },
      item: { room_name: 'Room 1', start_time: '2026-09-11T16:00:00', end_time: '2026-09-11T18:00:00', booking_type: 'hourly', subtotal: 800 }
    },
    // 9. Multi-item booking (1 item from a 2-room booking)
    {
      b: {
        id: 9, receipt_number: 'BK-009', customer_name: 'บจก. มัลติรูม', customer_type: 'walkin', payment_status: 'paid', payment_method: 'transfer', total_amount: 1500, created_at: '2026-09-11T08:00:00',
        items: [
          { id: 91, room_name: 'Room A', start_time: '2026-09-11T09:00:00', end_time: '2026-09-11T11:00:00', subtotal: 1000 },
          { id: 92, room_name: 'Room B', start_time: '2026-09-11T09:00:00', end_time: '2026-09-11T10:00:00', subtotal: 500 }
        ]
      },
      item: { id: 91, room_name: 'Room A', start_time: '2026-09-11T09:00:00', end_time: '2026-09-11T11:00:00', subtotal: 1000 }
    },
    // 10. Tax invoice booking
    {
      b: { id: 10, receipt_number: 'BK-010', customer_name: 'บจก. สยามเทค', customer_type: 'walkin', payment_status: 'paid', payment_method: 'transfer', tax_invoice_required: 1, total_amount: 2000, created_at: '2026-09-11T09:00:00' },
      item: { room_name: 'Meeting Room 5', start_time: '2026-09-11T10:00:00', end_time: '2026-09-11T12:00:00', booking_type: 'hourly', subtotal: 2000 }
    }
  ];

  const rows = records.map(r => exportUtils.buildDashboardExportRow(r.b, r.item));
  assert.equal(rows.length, 10);

  // 1. Normal paid
  assert.equal(rows[0][3], 'Walk-in');
  assert.equal(rows[0][4], 'POS');
  assert.equal(rows[0][10], 500);
  assert.equal(rows[0][11], 'ชำระแล้ว');
  assert.equal(rows[0][12], 'โอนเงิน');
  assert.equal(rows[0][14], 'ปกติ');
  assert.equal(rows[0][15], '-'); // Advance payment unsupported

  // 2. Walk-in
  assert.equal(rows[1][3], 'Walk-in');
  assert.equal(rows[1][10], 800);
  assert.equal(rows[1][12], 'เงินสด');

  // 3. LINE OA
  assert.equal(rows[2][3], 'ลูกค้าทั่วไป');
  assert.equal(rows[2][4], 'LINE OA');
  assert.equal(rows[2][10], 1200);

  // 4. Builtland
  assert.equal(rows[3][3], 'Builtland (ฝ่ายบัญชี)');
  assert.equal(rows[3][10], 0, 'Builtland amount received must be 0');
  assert.equal(rows[3][12], 'ไม่คิดค่าบริการ');
  assert.equal(rows[3][14], 'โควต้า Builtland');

  // 5. Basecamp
  assert.equal(rows[4][3], 'Basecamp (Office 401)');
  assert.equal(rows[4][10], 0, 'Basecamp quota amount received must be 0');
  assert.equal(rows[4][12], 'ไม่คิดค่าบริการ');
  assert.equal(rows[4][14], 'โควต้า Basecamp');

  // 6. Hour Credit Booking B
  assert.equal(rows[5][10], 0, 'Hour credit amount received must be 0');
  assert.equal(rows[5][12], 'เครดิตชั่วโมง');
  assert.equal(rows[5][14], 'เครดิตชั่วโมง');

  // 7. Cancelled
  assert.equal(rows[6][10], 0, 'Cancelled amount received must be 0');
  assert.equal(rows[6][11], 'ยกเลิก');
  assert.equal(rows[6][18], 'หมดเวลาชำระเงิน');

  // 8. Pending/reviewing
  assert.equal(rows[7][10], 0, 'Reviewing slip amount received must be 0');
  assert.equal(rows[7][11], 'รอตรวจสอบสลิป');

  // 9. Multi-item
  assert.equal(rows[8][10], 1000, 'Multi-item row allocates exact proportion 1000');

  // 10. Tax invoice
  assert.equal(rows[9][16], 'ขอใบกำกับภาษี');
});

test('13. Check F: CSV, XLSX, and Clipboard (TSV) produce IDENTICAL row values and column order', () => {
  const sampleRows = [
    [1, 'BK-001', 'คุณ สมคิด', 'Walk-in', 'POS', 'Room 1', '11/09/2026', '09:00', '11:00', 'รายชั่วโมง', 500, 'ชำระแล้ว', 'โอนเงิน', '11/09/2026', 'ปกติ', '-', 'ไม่ขอ', '-', '-'],
    [6, 'BK-006', 'คุณ ธนกร', 'Walk-in', 'POS', 'Room 1', '11/09/2026', '15:00', '17:00', 'รายชั่วโมง', 0, 'ชำระแล้ว', 'เครดิตชั่วโมง', '11/09/2026', 'เครดิตชั่วโมง', '-', 'ไม่ขอ', '-', '-']
  ];

  // 1. CSV
  const csv = exportUtils.generateDashboardCsv(sampleRows);
  const csvLines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(csvLines.length, 3); // 1 header + 2 rows

  // 2. TSV
  const tsv = exportUtils.generateDashboardTsv(sampleRows);
  const tsvLines = tsv.trim().split('\n');
  assert.equal(tsvLines.length, 3);

  // 3. XLSX
  const wb = exportUtils.generateDashboardXlsxWorkbook(sampleRows, exportUtils.DASHBOARD_EXPORT_COLUMNS, XLSX);
  const sheet = wb.Sheets['Dashboard Export'];
  const xlsxJson = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert.equal(xlsxJson.length, 3);

  // Verify Headers match across all 3
  const csvCols = csvLines[0].split(',');
  const tsvCols = tsvLines[0].split('\t');
  const xlsxCols = xlsxJson[0];

  assert.deepEqual(csvCols, exportUtils.DASHBOARD_EXPORT_COLUMNS);
  assert.deepEqual(tsvCols, exportUtils.DASHBOARD_EXPORT_COLUMNS);
  assert.deepEqual(xlsxCols, exportUtils.DASHBOARD_EXPORT_COLUMNS);

  // Verify Data rows match across all 3
  for (let r = 0; r < sampleRows.length; r++) {
    const expected = sampleRows[r].map(String);
    const fromTsv = tsvLines[r + 1].split('\t');
    const fromXlsx = xlsxJson[r + 1].map(String);

    assert.deepEqual(fromTsv, expected, `TSV row ${r} does not match expected`);
    assert.deepEqual(fromXlsx, expected, `XLSX row ${r} does not match expected`);
  }
});

test('14. History.jsx toolbar action and redesigned modal structure', () => {
  const historyCode = fs.readFileSync(path.resolve(__dirname, '../src/components/History.jsx'), 'utf8');
  assert.ok(historyCode.includes('Export สำหรับ Dashboard'), 'History must contain "Export สำหรับ Dashboard" button');
  assert.ok(historyCode.includes('showExportModal'), 'History must include showExportModal state');
  assert.ok(historyCode.includes('exportStartDate'), 'History must include exportStartDate state');
  assert.ok(historyCode.includes('exportEndDate'), 'History must include exportEndDate state');
  assert.ok(historyCode.includes('exportCustomerType'), 'History must include exportCustomerType state');
  assert.ok(historyCode.includes('handleExportDashboardCsv'), 'History must include CSV export handler');
  assert.ok(historyCode.includes('handleExportDashboardXlsx'), 'History must include XLSX export handler');
  assert.ok(historyCode.includes('handleCopyDashboardTsv'), 'History must include TSV copy handler');
  assert.ok(historyCode.includes('ช่วงวันที่เข้าใช้บริการ (Service Date)'), 'History modal must include Service Date input label');
  assert.ok(historyCode.includes('วันที่เริ่มต้น'), 'History modal must include start date label');
  assert.ok(historyCode.includes('วันที่สิ้นสุด'), 'History modal must include end date label');
  assert.ok(historyCode.includes('7 วันล่าสุด'), 'History modal must include 7-day quick preset');
  assert.ok(historyCode.includes('เดือนนี้'), 'History modal must include month quick preset');
  assert.ok(historyCode.includes('EXPORT_CUSTOMER_TYPE_OPTIONS'), 'History modal must use EXPORT_CUSTOMER_TYPE_OPTIONS');
  assert.ok(historyCode.includes('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น'), 'History modal must include end date < start date validation');
  assert.ok(historyCode.includes('ไม่พบรายการในช่วงวันที่และประเภทลูกค้าที่เลือก'), 'History modal must include empty state message');
});

test('15. History.jsx operational lookup functions remain intact and report-heavy UI is removed', () => {
  const historyCode = fs.readFileSync(path.resolve(__dirname, '../src/components/History.jsx'), 'utf8');

  // Operational items retained
  assert.ok(historyCode.includes('ReceiptPrint'), 'Receipt printing must remain intact');
  assert.ok(historyCode.includes('openBookingDetails'), 'Booking details modal must remain intact');
  assert.ok(historyCode.includes('handleDeleteBooking'), 'Booking deletion must remain intact');
  assert.ok(historyCode.includes('viewingSlipBooking'), 'Slip viewing modal must remain intact');
  assert.ok(historyCode.includes('selectedTaxBooking'), 'Tax invoice modal must remain intact');
  assert.ok(historyCode.includes('STATUS_TABS'), 'Status tabs must remain intact');
  assert.ok(historyCode.includes('CUSTOMER_TYPE_OPTIONS'), 'Customer type filter must remain intact');

  // Reporting/Analytics items removed/hidden
  assert.ok(!historyCode.includes('รายงาน PDF'), 'Formal PDF report button must be removed');
  assert.ok(!historyCode.includes('history-pdf-report-container'), 'Hidden PDF report DOM structure must be removed');
  assert.ok(!historyCode.includes('ยอดรับรวม:'), 'Aggregate revenue KPI text must be removed from status strip');
});

test('16. Criteria 1 & 2: Start/end date fields render in History.jsx and default to today', () => {
  const historyCode = fs.readFileSync(path.resolve(__dirname, '../src/components/History.jsx'), 'utf8');
  assert.ok(historyCode.includes("const [exportStartDate, setExportStartDate] = useState(getTodayBangkokDate());"), 'exportStartDate defaults to getTodayBangkokDate()');
  assert.ok(historyCode.includes("const [exportEndDate, setExportEndDate] = useState(getTodayBangkokDate());"), 'exportEndDate defaults to getTodayBangkokDate()');
  assert.ok(historyCode.includes('type="date"'), 'Contains date inputs');
});

test('17. Criteria 3: End < start invalidates range and returns empty array', () => {
  const sampleBookings = [
    { id: 1, items: [{ start_time: '2026-09-12T10:00:00', end_time: '2026-09-12T12:00:00' }] }
  ];
  // End date is before start date
  const result = exportUtils.filterBookingsForExport(sampleBookings, {
    startDate: '2026-09-15',
    endDate: '2026-09-10',
    customerType: 'all'
  });
  assert.equal(result.length, 0, 'Invalid date range returns empty array');
});

test('18. Criteria 4: Customer type options defined and rendered correctly', () => {
  assert.deepEqual(exportUtils.EXPORT_CUSTOMER_TYPE_OPTIONS, [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'general', label: 'ลูกค้าทั่วไป' },
    { value: 'builtland', label: 'บิลท์ แลนด์' },
    { value: 'basecamp', label: 'ผู้เช่ารายเดือน' }
  ]);
});

test('19. Criteria 5 & 6: General filter includes LINE OA general and Walk-in general, excludes Builtland and Basecamp', () => {
  const lineOAGeneral = { customer_type: 'general', booking_source: 'online' };
  const walkinGeneral = { customer_type: 'walkin', booking_source: 'pos' };
  const builtlandBooking = { customer_type: 'builtland' };
  const basecampBooking = { customer_type: 'basecamp' };

  assert.equal(exportUtils.matchesCustomerTypeFilter(lineOAGeneral, 'general'), true, 'General filter includes LINE OA general');
  assert.equal(exportUtils.matchesCustomerTypeFilter(walkinGeneral, 'general'), true, 'General filter includes Walk-in general');
  assert.equal(exportUtils.matchesCustomerTypeFilter(builtlandBooking, 'general'), false, 'General filter excludes Builtland');
  assert.equal(exportUtils.matchesCustomerTypeFilter(basecampBooking, 'general'), false, 'General filter excludes Basecamp');
});

test('20. Criteria 7 & 8: Builtland and Basecamp filters strictly match only their respective bookings', () => {
  const lineOAGeneral = { customer_type: 'general', booking_source: 'online' };
  const walkinGeneral = { customer_type: 'walkin', booking_source: 'pos' };
  const builtlandBooking = { customer_type: 'builtland' };
  const basecampBooking = { customer_type: 'basecamp' };

  // Builtland filter
  assert.equal(exportUtils.matchesCustomerTypeFilter(builtlandBooking, 'builtland'), true, 'Builtland filter matches Builtland');
  assert.equal(exportUtils.matchesCustomerTypeFilter(lineOAGeneral, 'builtland'), false, 'Builtland filter excludes General');
  assert.equal(exportUtils.matchesCustomerTypeFilter(basecampBooking, 'builtland'), false, 'Builtland filter excludes Basecamp');

  // Basecamp filter
  assert.equal(exportUtils.matchesCustomerTypeFilter(basecampBooking, 'basecamp'), true, 'Basecamp filter matches Basecamp');
  assert.equal(exportUtils.matchesCustomerTypeFilter(lineOAGeneral, 'basecamp'), false, 'Basecamp filter excludes General');
  assert.equal(exportUtils.matchesCustomerTypeFilter(builtlandBooking, 'basecamp'), false, 'Basecamp filter excludes Builtland');
});

test('21. Criteria 9: "all" filter includes all customer types', () => {
  const lineOAGeneral = { customer_type: 'general', booking_source: 'online' };
  const walkinGeneral = { customer_type: 'walkin', booking_source: 'pos' };
  const builtlandBooking = { customer_type: 'builtland' };
  const basecampBooking = { customer_type: 'basecamp' };

  assert.equal(exportUtils.matchesCustomerTypeFilter(lineOAGeneral, 'all'), true);
  assert.equal(exportUtils.matchesCustomerTypeFilter(walkinGeneral, 'all'), true);
  assert.equal(exportUtils.matchesCustomerTypeFilter(builtlandBooking, 'all'), true);
  assert.equal(exportUtils.matchesCustomerTypeFilter(basecampBooking, 'all'), true);
});

test('22. Criteria 10: Date-range filtering uses service date (start_time), not created_at', () => {
  const bookings = [
    {
      id: 1,
      created_at: '2026-09-01T10:00:00', // created on 1st
      customer_type: 'general',
      items: [{ start_time: '2026-09-10T09:00:00', end_time: '2026-09-10T11:00:00' }] // service on 10th
    },
    {
      id: 2,
      created_at: '2026-09-10T08:00:00', // created on 10th
      customer_type: 'general',
      items: [{ start_time: '2026-09-15T14:00:00', end_time: '2026-09-15T16:00:00' }] // service on 15th
    },
    {
      id: 3,
      created_at: '2026-09-05T12:00:00', // created on 5th
      customer_type: 'general',
      items: [{ start_time: '2026-09-11T13:00:00', end_time: '2026-09-11T15:00:00' }] // service on 11th
    }
  ];

  // Filtering for service dates between 2026-09-09 and 2026-09-12
  const results = exportUtils.filterBookingsForExport(bookings, {
    startDate: '2026-09-09',
    endDate: '2026-09-12',
    customerType: 'all'
  });

  assert.equal(results.length, 2);
  const matchedIds = results.map(r => r.booking.id);
  assert.deepEqual(matchedIds, [1, 3], 'Strictly matches service date range, not created_at');
});

test('23. Criteria 11: Empty state / no-result disables export actions', () => {
  const historyCode = fs.readFileSync(path.resolve(__dirname, '../src/components/History.jsx'), 'utf8');
  assert.ok(historyCode.includes('const isExportDisabled = isInvalidDateRange || exportMatchingPairs.length === 0;'), 'isExportDisabled checks invalid date and empty results');
  assert.ok(historyCode.includes('disabled={isExportDisabled}'), 'Buttons bind disabled={isExportDisabled}');
  assert.ok(historyCode.includes('ไม่พบรายการในช่วงวันที่และประเภทลูกค้าที่เลือก'), 'Shows empty message when no results');
});

test('24. Criteria 12: CSV, XLSX, and Clipboard TSV parity on identical dataset', () => {
  const sampleData = [
    [101, 'BK-101', 'สมชาย', 'ลูกค้าทั่วไป', 'LINE OA', 'Room 1', '11/09/2026', '09:00', '12:00', 'รายชั่วโมง', 1500, 'ชำระแล้ว', 'โอนเงิน', '11/09/2026', 'ปกติ', '-', 'ขอใบกำกับภาษี', '-', '-']
  ];
  const csv = exportUtils.generateDashboardCsv(sampleData);
  const tsv = exportUtils.generateDashboardTsv(sampleData);
  const wb = exportUtils.generateDashboardXlsxWorkbook(sampleData, exportUtils.DASHBOARD_EXPORT_COLUMNS, XLSX);

  const csvRows = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  const tsvRows = tsv.trim().split('\n');
  const xlsxRows = XLSX.utils.sheet_to_json(wb.Sheets['Dashboard Export'], { header: 1 });

  assert.equal(csvRows.length, 2);
  assert.equal(tsvRows.length, 2);
  assert.equal(xlsxRows.length, 2);
  assert.deepEqual(csvRows[0].split(','), exportUtils.DASHBOARD_EXPORT_COLUMNS);
  assert.deepEqual(tsvRows[0].split('\t'), exportUtils.DASHBOARD_EXPORT_COLUMNS);
  assert.deepEqual(xlsxRows[0], exportUtils.DASHBOARD_EXPORT_COLUMNS);
  assert.deepEqual(csvRows[1].split(','), tsvRows[1].split('\t'));
  assert.deepEqual(tsvRows[1].split('\t'), xlsxRows[1].map(String));
});

test('25. Criteria 13: Approved 19-column mapping remains unchanged with exact ordering', () => {
  assert.equal(exportUtils.DASHBOARD_EXPORT_COLUMNS.length, 19);
  const expectedCols = [
    'Booking ID',
    'เลขที่ใบเสร็จ',
    'ชื่อผู้จอง',
    'ประเภทลูกค้า',
    'ช่องทางการจอง',
    'ห้อง/บริการ',
    'วันที่ใช้งาน',
    'เวลาเริ่ม',
    'เวลาสิ้นสุด',
    'ประเภทราคา',
    'ยอดเงินที่ได้รับจริง',
    'สถานะการชำระ',
    'ช่องทางชำระเงิน',
    'วันที่ชำระเงิน',
    'รูปแบบการเรียกเก็บ',
    'จองล่วงหน้า',
    'ขอใบกำกับภาษี',
    'จองข้ามวัน',
    'หมายเหตุ'
  ];
  assert.deepEqual(exportUtils.DASHBOARD_EXPORT_COLUMNS, expectedCols);
});
