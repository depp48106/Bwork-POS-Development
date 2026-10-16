/**
 * Dashboard Export Utilities for B-WORK POS
 * Handles date filtering, field transformation, and export generation (CSV / XLSX / TSV)
 * for external Dashboard data entry.
 */

import { normalizeBookingFinancials } from './financialUtils.js';

export const DASHBOARD_EXPORT_COLUMNS = [
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

/**
 * Returns today's date in 'YYYY-MM-DD' formatted for Asia/Bangkok (UTC+7)
 */
export function getTodayBangkokDate() {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return fmt.format(new Date());
  } catch (e) {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const bangkokTime = new Date(utc + (7 * 3600000));
    return bangkokTime.toISOString().slice(0, 10);
  }
}

/**
 * Extracts YYYY-MM-DD date string from various datetime formats
 */
export function extractDatePart(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

/**
 * Formats a date string into DD/MM/YYYY (Christian Era / Gregorian)
 */
export function formatExportDate(dateStr) {
  if (!dateStr) return '-';
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${day}/${m}/${y}`;
  }
  return '-';
}

/**
 * Formats time string into HH:mm
 */
export function formatExportTime(timeStr) {
  if (!timeStr) return '-';
  const str = String(timeStr).trim();
  if (str.includes('T')) {
    const t = str.split('T')[1];
    if (t && t.length >= 5) return t.substring(0, 5);
  }
  if (str.includes(' ')) {
    const parts = str.split(' ');
    const t = parts[1] || parts[0];
    if (t && t.includes(':')) return t.substring(0, 5);
  }
  if (str.includes(':')) {
    return str.substring(0, 5);
  }
  return '-';
}

/**
 * Formats Customer Type into standard Thai labels
 */
export function formatCustomerType(b) {
  const cType = b.customer_type || (b.booking_source === 'online' ? 'general' : 'walkin');
  if (cType === 'builtland') {
    return b.internal_department ? `Builtland (${b.internal_department})` : 'Builtland';
  }
  if (cType === 'basecamp') {
    const sub = b.basecamp_sub_type === 'hotdesk' ? 'Hotdesk' : (b.basecamp_sub_type ? 'Office' : '');
    const unit = b.basecamp_unit ? ` ${b.basecamp_unit}` : '';
    const detail = (sub || unit) ? ` (${(sub + unit).trim()})` : '';
    return `Basecamp${detail}`;
  }
  if (cType === 'shop') {
    return 'ร้านค้าพันธมิตร (Shop)';
  }
  if (cType === 'walkin' || b.booking_source === 'walk-in') {
    return 'Walk-in';
  }
  if (cType === 'general' || cType === 'online' || b.booking_channel === 'line_oa' || b.booking_source === 'online') {
    return 'ลูกค้าทั่วไป';
  }
  return b.customer_type || 'ลูกค้าทั่วไป';
}

/**
 * Formats Booking Channel (POS / LINE OA)
 */
export function formatBookingChannel(b) {
  if (b.booking_channel === 'line_oa' || b.booking_source === 'online' || b.customer_type === 'online') {
    return 'LINE OA';
  }
  return 'POS';
}

/**
 * Formats Pricing Type (รายชั่วโมง, ครึ่งวัน, เต็มวัน)
 */
export function formatPricingType(item) {
  const type = item?.booking_type || 'hourly';
  if (type === 'hourly') return 'รายชั่วโมง';
  if (type === 'half_day') return 'ครึ่งวัน';
  if (type === 'full_day' || type === 'daily') return 'เต็มวัน';
  return type;
}

/**
 * Calculates Amount Actually Received
 * - Hour Credit Booking B: strictly 0 (never treated as new revenue)
 * - Cancelled / rejected / failed: 0
 * - Builtland / Internal free: 0
 * - Pending / Unpaid / Reviewing: 0
 * - Zero total_amount: 0
 * - Multi-item booking: allocated proportionally to item subtotals so sum never exceeds total_amount
 */
export function calculateAmountReceived(b, item) {
  if (!b) return 0;
  if (b.billing_option === 'hour_credit' || b.payment_method === 'hour_credit') {
    return 0;
  }
  if (b.payment_status === 'cancelled' || b.payment_status === 'failed' || b.payment_status === 'rejected') {
    return 0;
  }
  if (b.customer_type === 'builtland' || b.payment_status === 'internal_free' || b.billing_option === 'builtland' || b.billing_option === 'internal_free') {
    return 0;
  }
  if (b.payment_status === 'pending' || b.payment_status === 'unpaid' || b.payment_status === 'reviewing' || !b.payment_status) {
    return 0;
  }

  // Realized money received using normalizeBookingFinancials (with safe legacy fallback)
  const fin = normalizeBookingFinancials(b);
  const realizedRevenue = fin ? Number(fin.paid_amount || 0) : 0;
  if (realizedRevenue <= 0) {
    return 0;
  }

  // Single item or no items
  if (!item) {
    return realizedRevenue;
  }

  const items = Array.isArray(b.items) && b.items.length > 0 ? b.items : null;
  if (!items || items.length <= 1) {
    return realizedRevenue;
  }

  // For multi-item bookings: allocate proportionally to item subtotals
  // so the sum of all item allocations strictly equals realizedRevenue
  const sumSubtotals = items.reduce((sum, it) => {
    const itSub = it.subtotal != null ? Number(it.subtotal) : (Number(it.price || 0) * Number(it.quantity || 1));
    return sum + (isNaN(itSub) ? 0 : itSub);
  }, 0);

  const itemIndex = items.findIndex(it => (it.id != null && it.id === item.id) || it === item);

  if (itemIndex === items.length - 1) {
    // Last item receives the exact remaining balance to prevent 1-satang rounding drift
    let sumPrev = 0;
    for (let i = 0; i < items.length - 1; i++) {
      const prevIt = items[i];
      const prevSub = prevIt.subtotal != null ? Number(prevIt.subtotal) : (Number(prevIt.price || 0) * Number(prevIt.quantity || 1));
      let prevAlloc = 0;
      if (sumSubtotals > 0 && !isNaN(prevSub)) {
        prevAlloc = Math.round((prevSub / sumSubtotals) * realizedRevenue * 100) / 100;
      } else {
        prevAlloc = Math.round((realizedRevenue / items.length) * 100) / 100;
      }
      sumPrev += prevAlloc;
    }
    return Math.round((realizedRevenue - sumPrev) * 100) / 100;
  }

  const thisSubtotal = item.subtotal != null ? Number(item.subtotal) : (Number(item.price || 0) * Number(item.quantity || 1));

  if (sumSubtotals > 0 && !isNaN(thisSubtotal)) {
    return Math.round((thisSubtotal / sumSubtotals) * realizedRevenue * 100) / 100;
  }

  return Math.round((realizedRevenue / items.length) * 100) / 100;
}

/**
 * Formats Payment Status into Thai
 */
export function formatPaymentStatus(b) {
  const status = b?.payment_status;
  if (status === 'paid') return 'ชำระแล้ว';
  if (status === 'deposit') return 'ชำระมัดจำแล้ว';
  if (status === 'cancelled') return 'ยกเลิก';
  if (status === 'pending' || status === 'unpaid') return 'รอชำระ';
  if (status === 'reviewing') return 'รอตรวจสอบสลิป';
  if (status === 'internal_free') return 'ใช้งานภายใน (ฟรี)';
  return status || '-';
}

/**
 * Formats Payment Method into Thai
 */
export function formatPaymentMethod(b) {
  if (b.billing_option === 'hour_credit' || b.payment_method === 'hour_credit') {
    return 'เครดิตชั่วโมง';
  }
  if (b.customer_type === 'builtland' || b.payment_status === 'internal_free') {
    return 'ไม่คิดค่าบริการ';
  }
  if (b.customer_type === 'basecamp' && Number(b.total_amount || 0) === 0) {
    return 'ไม่คิดค่าบริการ';
  }
  const m = b.payment_method;
  if (m === 'cash') return 'เงินสด';
  if (m === 'transfer') return 'โอนเงิน';
  if (m === 'free' || m === 'internal') return 'ไม่คิดค่าบริการ';
  return m || '-';
}

/**
 * Formats Payment Date (DD/MM/YYYY)
 */
export function formatPaymentDate(b) {
  if (b.payment_status !== 'paid' && b.payment_status !== 'deposit' && b.payment_status !== 'internal_free') {
    return '-';
  }
  const dateStr = b.slip_verified_at || b.paid_at || b.created_at;
  return formatExportDate(dateStr);
}

/**
 * Formats Billing Option
 */
export function formatBillingOption(b) {
  if (b.billing_option === 'hour_credit' || b.payment_method === 'hour_credit') {
    return 'เครดิตชั่วโมง';
  }
  if (b.customer_type === 'builtland' || b.billing_option === 'builtland' || b.billing_option === 'internal_free') {
    return 'โควต้า Builtland';
  }
  if (b.customer_type === 'basecamp' || b.billing_option === 'quota' || b.billing_option === 'quota_partial') {
    return 'โควต้า Basecamp';
  }
  if (b.customer_type === 'shop') {
    return 'โควต้า Shop';
  }
  return 'ปกติ';
}

/**
 * Formats Advance Payment flag
 * External Dashboard expects payment in advance status.
 * For deposit bookings, returns 'มัดจำ'. Otherwise '-'.
 */
export function formatAdvancePaymentFlag(b, item) {
  if (b?.payment_status === 'deposit') {
    return 'มัดจำ';
  }
  return '-';
}

/**
 * Formats Tax Invoice flag
 */
export function formatTaxInvoiceFlag(b) {
  return b.tax_invoice_required === 1 ? 'ขอใบกำกับภาษี' : 'ไม่ขอ';
}

/**
 * Formats Multi-day flag (unsupported in POS single-day model)
 */
export function formatMultiDayFlag() {
  return '-';
}

/**
 * Formats Notes / Reason
 */
export function formatNotes(b) {
  return b.cancellation_reason || b.internal_department || b.department || b.notes || '-';
}

/**
 * Customer Type Filter Options for Dashboard Export Modal
 */
export const EXPORT_CUSTOMER_TYPE_OPTIONS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'general', label: 'ลูกค้าทั่วไป' },
  { value: 'builtland', label: 'บิลท์ แลนด์' },
  { value: 'basecamp', label: 'ผู้เช่ารายเดือน' },
  { value: 'shop', label: 'ร้านค้าพันธมิตร' }
];

/**
 * Returns date YYYY-MM-DD offset by N days from today in Asia/Bangkok
 */
export function getDateOffsetBangkok(offsetDays = 0) {
  const today = getTodayBangkokDate();
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(y, m - 1, d + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns start of current month (YYYY-MM-01) in Asia/Bangkok
 */
export function getStartOfMonthBangkok() {
  const today = getTodayBangkokDate();
  return `${today.substring(0, 7)}-01`;
}

/**
 * Customer Type Filter Matcher
 * - GENERAL: normal/general, includes LINE OA and Walk-in/POS general customers, excludes Builtland, excludes Basecamp, excludes Shop
 * - BUILTLAND: customer_type === 'builtland'
 * - BASECAMP: customer_type === 'basecamp'
 * - SHOP: customer_type === 'shop'
 * - ALL: no customer-type restriction
 */
export function matchesCustomerTypeFilter(b, customerType = 'all') {
  if (!customerType || customerType === 'all') return true;

  const rawType = (b.customer_type || '').toLowerCase().trim();
  const cType = (b.customer_type || (b.booking_source === 'online' ? 'general' : 'walkin')).toLowerCase().trim();

  const isBuiltland = rawType === 'builtland' || cType === 'builtland';
  const isBasecamp = rawType === 'basecamp' || cType === 'basecamp';
  const isShop = rawType === 'shop' || cType === 'shop';

  if (customerType === 'builtland') {
    return isBuiltland;
  }
  if (customerType === 'basecamp') {
    return isBasecamp;
  }
  if (customerType === 'shop') {
    return isShop;
  }
  if (customerType === 'general') {
    // Exclude Builtland, Basecamp, and Shop; include all regular/general customers
    if (isBuiltland || isBasecamp || isShop) return false;
    return true;
  }

  return true;
}

/**
 * Extracts the room usage date (YYYY-MM-DD) for a booking item
 */
export function getBookingItemUsageDate(b, item) {
  const raw = item?.start_time || b.start_time || b.booking_date;
  return extractDatePart(raw);
}

/**
 * Filters bookings strictly by usage/service date range (YYYY-MM-DD), NOT created_at
 * and by customer type (all / general / builtland / basecamp).
 * Produces an array of { booking, item } pairs.
 *
 * Supports both signatures:
 *   filterBookingsForExport(bookings, { startDate, endDate, customerType })
 *   filterBookingsForExport(bookings, startDate, endDate, customerType)
 */
export function filterBookingsForExport(bookings, arg1, arg2, arg3) {
  if (!bookings || !Array.isArray(bookings)) return [];

  let startDate = '';
  let endDate = '';
  let customerType = 'all';

  if (typeof arg1 === 'object' && arg1 !== null) {
    startDate = arg1.startDate || '';
    endDate = arg1.endDate || arg1.startDate || '';
    customerType = arg1.customerType || 'all';
  } else {
    startDate = arg1 || '';
    // If arg2 looks like YYYY-MM-DD, it's endDate
    if (arg2 && /^\d{4}-\d{2}-\d{2}$/.test(arg2)) {
      endDate = arg2;
      customerType = arg3 || 'all';
    } else if (arg2 === '' || arg2 === undefined) {
      endDate = startDate;
      customerType = arg3 || 'all';
    } else {
      // Legacy single date call: (bookings, targetDate, statusFilter)
      endDate = startDate;
      customerType = 'all';
    }
  }

  // If endDate is before startDate, invalid range -> return empty
  if (startDate && endDate && endDate < startDate) {
    return [];
  }

  const results = [];

  for (const b of bookings) {
    // Customer type filter check
    if (!matchesCustomerTypeFilter(b, customerType)) {
      continue;
    }

    const items = Array.isArray(b.items) && b.items.length > 0 ? b.items : null;

    if (items) {
      for (const item of items) {
        const itemDate = getBookingItemUsageDate(b, item);
        if (!itemDate) continue;

        let inRange = true;
        if (startDate && itemDate < startDate) inRange = false;
        if (endDate && itemDate > endDate) inRange = false;

        if (inRange) {
          results.push({ booking: b, item });
        }
      }
    } else {
      const bDate = getBookingItemUsageDate(b, null);
      if (!bDate) continue;

      let inRange = true;
      if (startDate && bDate < startDate) inRange = false;
      if (endDate && bDate > endDate) inRange = false;

      if (inRange) {
        results.push({ booking: b, item: null });
      }
    }
  }

  return results;
}

/**
 * Transforms a single { booking, item } pair into the 19-column array
 */
export function buildDashboardExportRow(b, item) {
  const usageDate = getBookingItemUsageDate(b, item);
  const startTime = item?.start_time || b.start_time;
  const endTime = item?.end_time || b.end_time;
  const roomName = item?.room_name || b.room_name || '-';

  return [
    b.id,                                   // 1. Booking ID
    b.receipt_number || '-',                // 2. เลขที่ใบเสร็จ
    b.customer_name || '-',                 // 3. ชื่อผู้จอง
    formatCustomerType(b),                  // 4. ประเภทลูกค้า
    formatBookingChannel(b),                // 5. ช่องทางการจอง
    roomName,                               // 6. ห้อง/บริการ
    formatExportDate(usageDate),            // 7. วันที่ใช้งาน (DD/MM/YYYY)
    formatExportTime(startTime),            // 8. เวลาเริ่ม (HH:mm)
    formatExportTime(endTime),              // 9. เวลาสิ้นสุด (HH:mm)
    formatPricingType(item),                // 10. ประเภทราคา
    calculateAmountReceived(b, item),       // 11. ยอดเงินที่ได้รับจริง
    formatPaymentStatus(b),                 // 12. สถานะการชำระ
    formatPaymentMethod(b),                 // 13. ช่องทางชำระเงิน
    formatPaymentDate(b),                   // 14. วันที่ชำระเงิน
    formatBillingOption(b),                 // 15. รูปแบบการเรียกเก็บ
    formatAdvancePaymentFlag(b, item),      // 16. จองล่วงหน้า
    formatTaxInvoiceFlag(b),                // 17. ขอใบกำกับภาษี
    formatMultiDayFlag(),                   // 18. จองข้ามวัน
    formatNotes(b)                          // 19. หมายเหตุ
  ];
}

/**
 * Transforms an array of { booking, item } pairs into an array of rows
 */
export function buildDashboardExportRows(pairs) {
  return pairs.map(p => buildDashboardExportRow(p.booking, p.item));
}

/**
 * Generates CSV string with UTF-8 BOM (\uFEFF)
 */
export function generateDashboardCsv(rows, columns = DASHBOARD_EXPORT_COLUMNS) {
  const bom = '\uFEFF';
  const allRows = [columns, ...rows];
  const csvLines = allRows.map(row => {
    return row.map(val => {
      const s = val == null ? '' : String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(',');
  });
  return bom + csvLines.join('\r\n');
}

/**
 * Generates TSV string for clipboard copy
 */
export function generateDashboardTsv(rows, columns = DASHBOARD_EXPORT_COLUMNS) {
  const allRows = [columns, ...rows];
  return allRows.map(row => {
    return row.map(val => {
      const s = val == null ? '' : String(val);
      return s.replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ');
    }).join('\t');
  }).join('\n');
}

/**
 * Generates XLSX workbook
 */
export function generateDashboardXlsxWorkbook(rows, columns = DASHBOARD_EXPORT_COLUMNS, XLSX) {
  if (!XLSX) throw new Error('XLSX library is required');
  const allRows = [columns, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(allRows);

  worksheet['!cols'] = columns.map((col, idx) => {
    let maxLen = col.length;
    for (const r of rows) {
      const valStr = r[idx] == null ? '' : String(r[idx]);
      if (valStr.length > maxLen) maxLen = valStr.length;
    }
    return { wch: Math.min(Math.max(maxLen + 4, 10), 40) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Dashboard Export');
  return workbook;
}

/**
 * Triggers a file download from a Blob
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Downloads CSV file
 */
export function downloadDashboardCsvFile(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
}

/**
 * Downloads XLSX file
 */
export function downloadDashboardXlsxFile(rows, filename, XLSX) {
  const wb = generateDashboardXlsxWorkbook(rows, DASHBOARD_EXPORT_COLUMNS, XLSX);
  XLSX.writeFile(wb, filename);
}
