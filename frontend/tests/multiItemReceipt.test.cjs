const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Dynamically import receiptUtils ES module
let receiptUtils;

test.before(async () => {
  receiptUtils = await import('../src/utils/receiptUtils.js');
});

test('1. Local wall-clock date parsing without UTC shifting', () => {
  const { parseReceiptLocalDate, formatReceiptDateThai, formatReceiptPeriod, formatReceiptTime } = receiptUtils;

  const d = parseReceiptLocalDate('2026-09-23T09:30:00');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8); // 0-indexed September = 8
  assert.equal(d.getDate(), 23);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);

  const thaiDate = formatReceiptDateThai('2026-09-23T09:30:00');
  assert.equal(thaiDate, '23 ก.ย. 2569');

  const timeStr = formatReceiptTime('2026-09-23T09:30:00');
  assert.equal(timeStr, '09:30');

  const periodStr = formatReceiptPeriod('2026-09-23T09:00:00', '2026-09-23T12:00:00');
  assert.equal(periodStr, '09:00 - 12:00 น.');
});

test('2. Single item / single day compact layout regression', () => {
  const { normalizeBookingReceipt, getReceiptTotals, getReceiptPaymentDetails } = receiptUtils;

  const booking = {
    id: 101,
    customer_name: 'สมชาย รักดี',
    total_amount: 3000,
    payment_status: 'paid',
    payment_method: 'cash',
    receipt_number: 'REC-202609-0001',
    created_at: '2026-09-23T10:00:00',
    items: [
      {
        id: 1,
        room_id: 4,
        room_name: 'Mars (301)',
        booking_type: 'hourly',
        start_time: '2026-09-23T09:00:00',
        end_time: '2026-09-23T12:00:00',
        quantity: 3,
        price: 1000,
        subtotal: 3000
      }
    ]
  };

  const receipt = normalizeBookingReceipt(booking);
  assert.equal(receipt.isMultiDate, false);
  assert.equal(receipt.dateCount, 1);
  assert.equal(receipt.groups.length, 1);
  assert.equal(receipt.groups[0].items.length, 1);

  const item = receipt.groups[0].items[0];
  assert.equal(item.displayName, 'Mars (301)');
  assert.equal(item.durationLabel, '3 ชม.');
  assert.equal(item.timePeriod, '09:00 - 12:00 น.');
  assert.equal(item.subtotal, 3000);

  const totals = getReceiptTotals(booking, receipt.normalizedItems);
  assert.equal(totals.grandTotal, 3000);
  assert.equal(totals.itemsSubtotal, 3000);
  assert.equal(totals.hasAdjustment, false);

  const payment = getReceiptPaymentDetails(booking);
  assert.equal(payment.statusKey, 'paid');
  assert.equal(payment.methodLabel, 'เงินสด (Cash)');
});

test('3. Example A: Same room across 2 different days', () => {
  const { normalizeBookingReceipt, getReceiptTotals } = receiptUtils;

  const booking = {
    id: 102,
    customer_name: 'บริษัท เอบีซี จำกัด',
    total_amount: 6000,
    payment_status: 'paid',
    payment_method: 'transfer',
    items: [
      {
        id: 1,
        room_id: 4,
        room_name: 'Mars (301)',
        booking_type: 'hourly',
        start_time: '2026-09-23T09:00:00',
        end_time: '2026-09-23T12:00:00',
        quantity: 3,
        price: 1000,
        subtotal: 3000
      },
      {
        id: 2,
        room_id: 4,
        room_name: 'Mars (301)',
        booking_type: 'hourly',
        start_time: '2026-09-24T09:00:00',
        end_time: '2026-09-24T12:00:00',
        quantity: 3,
        price: 1000,
        subtotal: 3000
      }
    ]
  };

  const receipt = normalizeBookingReceipt(booking);
  assert.equal(receipt.isMultiDate, true);
  assert.equal(receipt.dateCount, 2);
  assert.equal(receipt.groups.length, 2);

  assert.equal(receipt.groups[0].dateKey, '2026-09-23');
  assert.equal(receipt.groups[0].thaiDate, '23 ก.ย. 2569');
  assert.equal(receipt.groups[0].items.length, 1);
  assert.equal(receipt.groups[0].items[0].displayName, 'Mars (301)');

  assert.equal(receipt.groups[1].dateKey, '2026-09-24');
  assert.equal(receipt.groups[1].thaiDate, '24 ก.ย. 2569');
  assert.equal(receipt.groups[1].items.length, 1);
  assert.equal(receipt.groups[1].items[0].displayName, 'Mars (301)');

  const totals = getReceiptTotals(booking, receipt.normalizedItems);
  assert.equal(totals.grandTotal, 6000);
  assert.equal(totals.itemsSubtotal, 6000);
  assert.equal(totals.hasAdjustment, false);
});

test('4. Example B: Same room, multiple time slots on same day', () => {
  const { normalizeBookingReceipt } = receiptUtils;

  const booking = {
    id: 103,
    items: [
      {
        id: 2,
        room_id: 4,
        room_name: 'Mars (301)',
        booking_type: 'hourly',
        start_time: '2026-09-23T14:00:00',
        end_time: '2026-09-23T16:00:00',
        quantity: 2,
        price: 1000,
        subtotal: 2000
      },
      {
        id: 1,
        room_id: 4,
        room_name: 'Mars (301)',
        booking_type: 'hourly',
        start_time: '2026-09-23T09:00:00',
        end_time: '2026-09-23T11:00:00',
        quantity: 2,
        price: 1000,
        subtotal: 2000
      }
    ]
  };

  const receipt = normalizeBookingReceipt(booking);
  assert.equal(receipt.isMultiDate, false);
  assert.equal(receipt.dateCount, 1);
  assert.equal(receipt.groups.length, 1);

  // Verifying chronological ordering: 09:00 must be first even though API returned 14:00 first
  const items = receipt.groups[0].items;
  assert.equal(items.length, 2);
  assert.equal(items[0].startTimeStr, '09:00');
  assert.equal(items[0].timePeriod, '09:00 - 11:00 น.');
  assert.equal(items[1].startTimeStr, '14:00');
  assert.equal(items[1].timePeriod, '14:00 - 16:00 น.');
});

test('5. Example C: Different rooms on same day', () => {
  const { normalizeBookingReceipt, getReceiptTotals } = receiptUtils;

  const booking = {
    id: 104,
    total_amount: 5000,
    items: [
      {
        id: 2,
        room_id: 5,
        room_name: 'Mercury (302)',
        booking_type: 'hourly',
        start_time: '2026-09-23T10:00:00',
        end_time: '2026-09-23T12:00:00',
        quantity: 2,
        price: 1000,
        subtotal: 2000
      },
      {
        id: 1,
        room_id: 4,
        room_name: 'Mars (301)',
        booking_type: 'hourly',
        start_time: '2026-09-23T09:00:00',
        end_time: '2026-09-23T12:00:00',
        quantity: 3,
        price: 1000,
        subtotal: 3000
      }
    ]
  };

  const receipt = normalizeBookingReceipt(booking);
  assert.equal(receipt.isMultiDate, false);
  assert.equal(receipt.dateCount, 1);

  // Sorted by start time: Mars 09:00 comes before Mercury 10:00
  const items = receipt.groups[0].items;
  assert.equal(items[0].displayName, 'Mars (301)');
  assert.equal(items[1].displayName, 'Mercury (302)');

  const totals = getReceiptTotals(booking, receipt.normalizedItems);
  assert.equal(totals.grandTotal, 5000);
});

test('6. Example D: Different rooms across multiple days', () => {
  const { normalizeBookingReceipt } = receiptUtils;

  const booking = {
    id: 105,
    items: [
      {
        id: 2,
        room_id: 7,
        room_name: 'Venus (304)',
        booking_type: 'daily',
        start_time: '2026-09-25T08:00:00',
        end_time: '2026-09-25T17:00:00',
        quantity: 1,
        price: 4500,
        subtotal: 4500
      },
      {
        id: 1,
        room_id: 4,
        room_name: 'Mars (301)',
        booking_type: 'hourly',
        start_time: '2026-09-23T13:00:00',
        end_time: '2026-09-23T16:00:00',
        quantity: 3,
        price: 1000,
        subtotal: 3000
      }
    ]
  };

  const receipt = normalizeBookingReceipt(booking);
  assert.equal(receipt.isMultiDate, true);
  assert.equal(receipt.groups.length, 2);
  assert.equal(receipt.groups[0].dateKey, '2026-09-23');
  assert.equal(receipt.groups[0].items[0].displayName, 'Mars (301)');
  assert.equal(receipt.groups[1].dateKey, '2026-09-25');
  assert.equal(receipt.groups[1].items[0].displayName, 'Venus (304)');
  assert.equal(receipt.groups[1].items[0].durationLabel, '1 วัน');
});

test('7. Example E: Multi-item booking with different pricing types + service', () => {
  const { normalizeBookingReceipt, getReceiptTotals } = receiptUtils;

  const booking = {
    id: 106,
    total_amount: 8500,
    items: [
      {
        id: 1,
        room_id: 4,
        room_name: 'Mars (301)',
        booking_type: 'hourly',
        layout: 'classroom',
        start_time: '2026-09-23T09:00:00',
        end_time: '2026-09-23T12:00:00',
        quantity: 3,
        price: 1000,
        subtotal: 3000
      },
      {
        id: 2,
        room_id: 6,
        room_name: 'Saturn (303)',
        booking_type: 'daily',
        start_time: '2026-09-23T08:00:00',
        end_time: '2026-09-23T17:00:00',
        quantity: 1,
        price: 5000,
        subtotal: 5000
      },
      {
        id: 3,
        service_id: 1,
        service_name: 'Coffee Break Set A',
        quantity: 10,
        price: 50,
        subtotal: 500
      }
    ]
  };

  const receipt = normalizeBookingReceipt(booking);
  const items = receipt.groups[0].items;
  assert.equal(items.length, 3);

  // Classroom indicator attached
  const mars = items.find(it => it.rawItem.room_id === 4);
  assert.equal(mars.isClassroom, true);
  assert.ok(mars.displayName.includes('Classroom'));

  // Service item formatting
  const coffee = items.find(it => it.rawItem.service_id === 1);
  assert.equal(coffee.isRoom, false);
  assert.equal(coffee.durationLabel, 'x10');
  assert.equal(coffee.subtotal, 500);

  const totals = getReceiptTotals(booking, receipt.normalizedItems);
  assert.equal(totals.itemsSubtotal, 8500);
  assert.equal(totals.grandTotal, 8500);
  assert.equal(totals.hasAdjustment, false);
});

test('8. Chronological sorting across unordered multi-day records', () => {
  const { sortReceiptItems, normalizeReceiptItem } = receiptUtils;

  const rawItems = [
    { id: 10, start_time: '2026-09-25T14:00:00', room_name: 'Pluto (201)', booking_type: 'hourly' },
    { id: 20, start_time: '2026-09-23T16:00:00', room_name: 'Mars (301)', booking_type: 'hourly' },
    { id: 30, start_time: '2026-09-23T09:00:00', room_name: 'Mars (301)', booking_type: 'hourly' },
    { id: 40, start_time: '2026-09-24T10:00:00', room_name: 'Mercury (302)', booking_type: 'hourly' }
  ];

  const normalized = rawItems.map((it, idx) => normalizeReceiptItem(it, {}, idx));
  const sorted = sortReceiptItems(normalized);

  assert.equal(sorted[0].id, 30); // 2026-09-23 09:00
  assert.equal(sorted[1].id, 20); // 2026-09-23 16:00
  assert.equal(sorted[2].id, 40); // 2026-09-24 10:00
  assert.equal(sorted[3].id, 10); // 2026-09-25 14:00
});

test('9. Authoritative total preservation with negative adjustment (Discount)', () => {
  const { getReceiptTotals } = receiptUtils;

  // sum(item subtotals) = 6000, authoritative booking total = 5500
  const booking = { total_amount: 5500 };
  const items = [
    { subtotal: 3000 },
    { subtotal: 3000 }
  ];

  const totals = getReceiptTotals(booking, items);
  assert.equal(totals.itemsSubtotal, 6000);
  assert.equal(totals.hasAdjustment, true);
  assert.equal(totals.adjustmentType, 'discount');
  assert.equal(totals.adjustmentLabel, 'ส่วนลด / ปรับยอด');
  assert.equal(totals.adjustmentAmount, -500);
  assert.equal(totals.grandTotal, 5500);
});

test('10. Authoritative total preservation with positive adjustment (Surcharge)', () => {
  const { getReceiptTotals } = receiptUtils;

  // sum(item subtotals) = 6000, authoritative booking total = 6500
  const booking = { total_amount: 6500 };
  const items = [
    { subtotal: 3000 },
    { subtotal: 3000 }
  ];

  const totals = getReceiptTotals(booking, items);
  assert.equal(totals.itemsSubtotal, 6000);
  assert.equal(totals.hasAdjustment, true);
  assert.equal(totals.adjustmentType, 'surcharge');
  assert.equal(totals.adjustmentLabel, 'ปรับยอดเพิ่ม');
  assert.equal(totals.adjustmentAmount, 500);
  assert.equal(totals.grandTotal, 6500);
});

test('11. Internal Free booking handling', () => {
  const { getReceiptPaymentDetails } = receiptUtils;

  // Builtland customer
  const booking1 = {
    customer_type: 'builtland',
    payment_status: 'internal_free',
    total_amount: 0,
    quota_hours_used: 3
  };
  const pay1 = getReceiptPaymentDetails(booking1);
  assert.equal(pay1.statusKey, 'internal_free');
  assert.equal(pay1.isFree, true);
  assert.equal(pay1.isPaid, true);
  assert.equal(pay1.paidAmount, 0);
  assert.ok(pay1.statusLabel.includes('ใช้งานภายใน'));
  assert.ok(pay1.methodLabel.includes('ไม่คิดค่าบริการ'));
  assert.ok(pay1.note.includes('3 ชั่วโมง'));

  // General internal_free
  const booking2 = {
    payment_status: 'internal_free',
    total_amount: 0
  };
  const pay2 = getReceiptPaymentDetails(booking2);
  assert.equal(pay2.statusKey, 'internal_free');
  assert.equal(pay2.isFree, true);
  assert.equal(pay2.paidAmount, 0);
});

test('12. Other payment statuses mapping (reviewing, rejected, cancelled, pending)', () => {
  const { getReceiptPaymentDetails } = receiptUtils;

  // Reviewing
  const rev = getReceiptPaymentDetails({ payment_status: 'reviewing', slip_image_url: 'slip.jpg' });
  assert.equal(rev.statusKey, 'reviewing');
  assert.equal(rev.isPaid, false);

  // Rejected
  const rej = getReceiptPaymentDetails({ payment_status: 'rejected' });
  assert.equal(rej.statusKey, 'rejected');
  assert.equal(rej.isPaid, false);

  // Cancelled
  const can = getReceiptPaymentDetails({ payment_status: 'cancelled', cancellation_reason: 'ลูกค้ายกเลิก' });
  assert.equal(can.statusKey, 'cancelled');
  assert.equal(can.isPaid, false);
  assert.ok(can.note.includes('ลูกค้ายกเลิก'));

  // Pending
  const pen = getReceiptPaymentDetails({ payment_status: 'pending', payment_method: 'cash' });
  assert.equal(pen.statusKey, 'pending');
  assert.equal(pen.isPaid, false);
});

test('13. Backwards compatibility fallback when booking.items is empty', () => {
  const { normalizeBookingReceipt, getReceiptTotals } = receiptUtils;

  const legacyBooking = {
    id: 999,
    room_id: 4,
    room_name: 'Mars (301)',
    booking_date: '2026-09-23',
    startTime: '09:00',
    endTime: '12:00',
    total_amount: 3000,
    items: [] // Empty
  };

  const receipt = normalizeBookingReceipt(legacyBooking);
  assert.equal(receipt.isMultiDate, false);
  assert.equal(receipt.groups.length, 1);
  assert.equal(receipt.groups[0].items.length, 1);

  const item = receipt.groups[0].items[0];
  assert.equal(item.displayName, 'Mars (301)');
  assert.equal(item.durationLabel, '3 ชม.');
  assert.equal(item.subtotal, 3000);

  const totals = getReceiptTotals(legacyBooking, receipt.normalizedItems);
  assert.equal(totals.grandTotal, 3000);
});
