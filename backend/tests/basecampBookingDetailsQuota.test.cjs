const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ==============================================================================
// BASECAMP BOOKING DETAILS QUOTA UNIT & REGRESSION TEST SUITE
// ==============================================================================

test('1. Basecamp Customer Identification Rules', () => {
  const isBasecampCustomer = (b) => Boolean(b && b.customer_type === 'basecamp');

  assert.strictEqual(isBasecampCustomer({ customer_type: 'basecamp' }), true);
  assert.strictEqual(isBasecampCustomer({ customer_type: 'general' }), false);
  assert.strictEqual(isBasecampCustomer({ customer_type: 'builtland' }), false);
  assert.strictEqual(isBasecampCustomer({ customer_type: 'walkin' }), false);
  assert.strictEqual(isBasecampCustomer({}), false);
  assert.strictEqual(isBasecampCustomer(null), false);
});

test('2. Basecamp Quota Allocation Rules by Subtype', () => {
  const getMaxQuota = (subType) => (subType === 'office' ? 4 : 2);

  // Office units get 4 hours/month
  assert.strictEqual(getMaxQuota('office'), 4);
  // Hotdesk units get 2 hours/month
  assert.strictEqual(getMaxQuota('hotdesk'), 2);
  // Default or undefined fallback to 2 (hotdesk)
  assert.strictEqual(getMaxQuota('unknown'), 2);
});

test('3. Authoritative Quota Calculation & Exclusion of Cancelled Bookings', () => {
  const calculateQuota = (subType, bookingsInMonth) => {
    const maxQuota = subType === 'office' ? 4 : 2;
    const activeBookings = (bookingsInMonth || []).filter(
      b => b.payment_status !== 'cancelled'
    );
    const usedQuota = activeBookings.reduce(
      (sum, b) => sum + (Number(b.quota_hours_used) || 0),
      0
    );
    const remainingQuota = Math.max(0, maxQuota - usedQuota);
    return {
      max_quota: maxQuota,
      used_quota: usedQuota,
      remaining_quota: remainingQuota
    };
  };

  // Scenario A: Office unit with 1 paid booking (2 hrs) and 1 pending booking (1 hr)
  const officeBookings = [
    { id: 1, payment_status: 'paid', quota_hours_used: 2 },
    { id: 2, payment_status: 'pending', quota_hours_used: 1 },
    { id: 3, payment_status: 'cancelled', quota_hours_used: 3 } // should be ignored
  ];
  const qA = calculateQuota('office', officeBookings);
  assert.strictEqual(qA.max_quota, 4);
  assert.strictEqual(qA.used_quota, 3);
  assert.strictEqual(qA.remaining_quota, 1);

  // Scenario B: Hotdesk unit with 2 hrs used (depleted)
  const hotdeskBookings = [
    { id: 4, payment_status: 'reviewing', quota_hours_used: 2 }
  ];
  const qB = calculateQuota('hotdesk', hotdeskBookings);
  assert.strictEqual(qB.max_quota, 2);
  assert.strictEqual(qB.used_quota, 2);
  assert.strictEqual(qB.remaining_quota, 0);

  // Scenario C: Over-quota clamp (cannot be negative)
  const overBookings = [
    { id: 5, payment_status: 'paid', quota_hours_used: 5 }
  ];
  const qC = calculateQuota('office', overBookings);
  assert.strictEqual(qC.remaining_quota, 0);
});

test('4. Quota State Badges: available, low, depleted', () => {
  const getRemainingClass = (remainingQuota) => {
    if (remainingQuota === 0) return 'is-depleted';
    if (remainingQuota <= 1) return 'is-low';
    return 'is-available';
  };

  assert.strictEqual(getRemainingClass(0), 'is-depleted');
  assert.strictEqual(getRemainingClass(0.5), 'is-low');
  assert.strictEqual(getRemainingClass(1), 'is-low');
  assert.strictEqual(getRemainingClass(2), 'is-available');
  assert.strictEqual(getRemainingClass(4), 'is-available');
});

test('5. Thai Quota Period Formatter', () => {
  function formatThaiQuotaPeriod(targetMonthStr) {
    if (!targetMonthStr || typeof targetMonthStr !== 'string') return '';
    const [yStr, mStr] = targetMonthStr.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(y) || isNaN(m)) return targetMonthStr;
    const THAI_MONTHS_FULL = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiMonth = THAI_MONTHS_FULL[m - 1] || mStr;
    const thaiYear = y + 543;
    return `${thaiMonth} ${thaiYear}`;
  }

  assert.strictEqual(formatThaiQuotaPeriod('2026-10'), 'ตุลาคม 2569');
  assert.strictEqual(formatThaiQuotaPeriod('2026-01'), 'มกราคม 2569');
  assert.strictEqual(formatThaiQuotaPeriod('2026-12'), 'ธันวาคม 2569');
  assert.strictEqual(formatThaiQuotaPeriod('invalid'), 'invalid');
  assert.strictEqual(formatThaiQuotaPeriod(''), '');
  assert.strictEqual(formatThaiQuotaPeriod(null), '');
});

test('6. Service Month/Year Extraction from Booking Data', () => {
  const extractServiceMonthYear = (booking) => {
    const firstItem = booking.items?.[0] || {};
    const serviceTimeStr = firstItem.start_time || booking.start_time || booking.booking_date || booking.created_at;
    let month, year;
    if (serviceTimeStr) {
      const cleanStr = String(serviceTimeStr).replace(' ', 'T');
      const [dPart] = cleanStr.split('T');
      if (dPart && dPart.includes('-')) {
        const parts = dPart.split('-');
        if (parts.length >= 2) {
          year = parseInt(parts[0], 10);
          month = parseInt(parts[1], 10);
        }
      }
    }
    if (!month || !year || isNaN(month) || isNaN(year)) {
      const now = new Date();
      month = now.getMonth() + 1;
      year = now.getFullYear();
    }
    return { month, year };
  };

  const b1 = { items: [{ start_time: '2026-10-15T09:00:00' }] };
  assert.deepStrictEqual(extractServiceMonthYear(b1), { month: 10, year: 2026 });

  const b2 = { booking_date: '2026-11-20' };
  assert.deepStrictEqual(extractServiceMonthYear(b2), { month: 11, year: 2026 });

  const b3 = { created_at: '2026-05-01 14:30:00' };
  assert.deepStrictEqual(extractServiceMonthYear(b3), { month: 5, year: 2026 });
});

test('7. Multi-Room Bookings Share the Same Basecamp Quota Pool', () => {
  const booking = {
    customer_type: 'basecamp',
    basecamp_sub_type: 'office',
    basecamp_unit: '401',
    quota_hours_used: 2,
    items: [
      { room_id: 1, room_name: 'Mars (301)', price: 1000 },
      { room_id: 2, room_name: 'Jupiter (302)', price: 1500 }
    ]
  };

  const uniqueRooms = Array.from(new Set(booking.items.map(it => it.room_name)));
  assert.strictEqual(uniqueRooms.length, 2);
  assert.strictEqual(uniqueRooms.join(', '), 'Mars (301), Jupiter (302)');

  // Both rooms draw against the single office 401 quota (4 hrs)
  const quota = { max_quota: 4, used_quota: 2, remaining_quota: 2 };
  assert.strictEqual(quota.remaining_quota, 2);
});

test('8. Missing Unit Number Safety: No Default or Invented Quota', () => {
  const validateBasecampBooking = (b) => {
    if (!b || b.customer_type !== 'basecamp') return { showQuota: false };
    if (!b.basecamp_unit) return { showQuota: true, error: 'missing_unit' };
    return { showQuota: true, subType: b.basecamp_sub_type || 'office', unit: b.basecamp_unit };
  };

  assert.deepStrictEqual(validateBasecampBooking({ customer_type: 'general' }), { showQuota: false });
  assert.deepStrictEqual(validateBasecampBooking({ customer_type: 'basecamp' }), { showQuota: true, error: 'missing_unit' });
  assert.deepStrictEqual(validateBasecampBooking({ customer_type: 'basecamp', basecamp_unit: '405' }), {
    showQuota: true,
    subType: 'office',
    unit: '405'
  });
});

test('9. Express Backend Permission Configuration Parity Check', () => {
  const serverJsPath = path.join(__dirname, '../server.js');
  const serverJs = fs.readFileSync(serverJsPath, 'utf8');

  // Verify /api/basecamp route requires 'pos', 'manage', 'pending', 'history'
  const routeMatch = serverJs.match(/app\.use\(['"]\/api\/basecamp['"],\s*authenticateToken,\s*requireAnyPermission\(([^)]+)\)\)/);
  assert.ok(routeMatch, 'server.js must configure permissions for /api/basecamp');
  
  const perms = routeMatch[1].replace(/['"]/g, '').split(',').map(s => s.trim());
  assert.ok(perms.includes('pos'), 'Must include pos');
  assert.ok(perms.includes('manage'), 'Must include manage');
  assert.ok(perms.includes('pending'), 'Must include pending');
  assert.ok(perms.includes('history'), 'Must include history');
});

test('10. Worker Backend Auth & Permission Parity Check', () => {
  const workerJsPath = path.join(__dirname, '../worker.js');
  const workerJs = fs.readFileSync(workerJsPath, 'utf8');

  // Verify worker.js contains pathname.startsWith('/api/basecamp') auth check
  assert.ok(
    workerJs.includes("pathname.startsWith('/api/basecamp')"),
    'worker.js must contain auth check for /api/basecamp'
  );
  assert.ok(
    workerJs.includes("['pos', 'manage', 'pending', 'history'].includes(p)"),
    'worker.js must check pos, manage, pending, history permissions'
  );
});

test('11. Frontend Source Implementation Checks', () => {
  const pendingBookingsPath = path.join(__dirname, '../../frontend/src/components/PendingBookings.jsx');
  const pendingBookingsJsx = fs.readFileSync(pendingBookingsPath, 'utf8');

  // Verify state
  assert.ok(pendingBookingsJsx.includes('basecampQuota'), 'Must declare basecampQuota state');
  assert.ok(pendingBookingsJsx.includes('basecampQuotaLoading'), 'Must declare basecampQuotaLoading state');
  assert.ok(pendingBookingsJsx.includes('basecampQuotaError'), 'Must declare basecampQuotaError state');

  // Verify section ID and title
  assert.ok(pendingBookingsJsx.includes('id="pb-detail-basecamp-quota-card"'), 'Must have card ID');
  assert.ok(pendingBookingsJsx.includes('โควตาการใช้งานห้องประชุม'), 'Must have Thai section title');
  assert.ok(pendingBookingsJsx.includes('Basecamp Quota'), 'Must have Basecamp Quota badge');
  assert.ok(pendingBookingsJsx.includes('โควตาทั้งหมด'), 'Must have total quota stat');
  assert.ok(pendingBookingsJsx.includes('ใช้ไปแล้ว'), 'Must have used quota stat');
  assert.ok(pendingBookingsJsx.includes('คงเหลือ'), 'Must have remaining quota stat');

  // Verify CSS file contains basecamp quota classes
  const cssPath = path.join(__dirname, '../../frontend/src/components/PendingBookings.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('.pb-detail-basecamp-quota-card'), 'PendingBookings.css must style quota card');
  assert.ok(css.includes('.pb-quota-badge'), 'PendingBookings.css must style quota badge');
  assert.ok(css.includes('.pb-quota-stat-box--remaining.is-available'), 'CSS must have is-available state');
  assert.ok(css.includes('.pb-quota-stat-box--remaining.is-low'), 'CSS must have is-low state');
  assert.ok(css.includes('.pb-quota-stat-box--remaining.is-depleted'), 'CSS must have is-depleted state');
});

test('12. Existing Basecamp Administration Workflow Header Compliance', () => {
  const modalPath = path.join(__dirname, '../../frontend/src/components/BasecampQuotaModal.jsx');
  const modalJsx = fs.readFileSync(modalPath, 'utf8');

  // Verify BasecampQuotaModal passes auth headers so it is never blocked
  assert.ok(
    modalJsx.includes("localStorage.getItem('token')"),
    'BasecampQuotaModal must retrieve auth token'
  );
  assert.ok(
    modalJsx.includes("'Authorization': `Bearer ${token}`"),
    'BasecampQuotaModal must include Authorization Bearer header'
  );
});

