const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Load Canonical Financial & Lifecycle Engine from frontend
const {
  roundMoney,
  normalizeBookingFinancials,
  getBookingUsageLifecycle
} = require('../../frontend/src/utils/financialUtils.js');

describe('BWORK-POS Booking Lifecycle & Slip Status Separation Suite', () => {

  describe('1. Financial Normalization & Reviewing Guard Tests', () => {
    test('State: รอตรวจสลิป (Online booking, unpaid, slip attached)', () => {
      const b = {
        id: 101,
        total_amount: 500,
        paid_amount: 0,
        balance_amount: 500,
        payment_status: 'reviewing',
        slip_verify_status: 'pending_manual',
        slip_image_url: 'https://r2/slip101.jpg'
      };
      const fin = normalizeBookingFinancials(b);
      assert.equal(fin.is_paid, false);
      assert.equal(fin.is_reviewing, true);
      assert.equal(fin.is_deposit, false);
      assert.equal(fin.is_pending, false);
      assert.equal(fin.balance_amount, 500);
      assert.equal(fin.is_collectible, false); // Not collectible while reviewing
    });

    test('State: มัดจำแล้ว / ตรวจสลิปมัดจำแล้ว (Deposit paid, no new slip)', () => {
      const b = {
        id: 102,
        total_amount: 1000,
        paid_amount: 300,
        balance_amount: 700,
        payment_status: 'deposit',
        slip_verify_status: 'approved_manual',
        slip_image_url: 'https://r2/deposit_slip.jpg'
      };
      const fin = normalizeBookingFinancials(b);
      assert.equal(fin.is_paid, false);
      assert.equal(fin.is_reviewing, false);
      assert.equal(fin.is_deposit, true);
      assert.equal(fin.paid_amount, 300);
      assert.equal(fin.balance_amount, 700);
      assert.equal(fin.is_collectible, true);
    });

    test('State: มัดจำแล้ว แต่ลูกค้าแนบสลิปชำระส่วนที่เหลือเข้ามาใหม่ (Deposit with pending balance slip)', () => {
      const b = {
        id: 103,
        total_amount: 1000,
        paid_amount: 300,
        balance_amount: 700,
        payment_status: 'deposit',
        slip_verify_status: 'pending_manual', // New balance slip needs review
        slip_image_url: 'https://r2/balance_slip.jpg'
      };
      const fin = normalizeBookingFinancials(b);
      assert.equal(fin.is_paid, false);
      assert.equal(fin.is_reviewing, true); // Must review balance slip
      assert.equal(fin.is_deposit, true);
      assert.equal(fin.balance_amount, 700);
    });

    test('State: ชำระแล้ว (Full payment settled, manual_approved)', () => {
      const b = {
        id: 104,
        total_amount: 190,
        paid_amount: 190,
        balance_amount: 0,
        payment_status: 'paid',
        slip_verify_status: 'manual_approved',
        slip_image_url: 'https://r2/full_slip.jpg'
      };
      const fin = normalizeBookingFinancials(b);
      assert.equal(fin.is_paid, true);
      assert.equal(fin.is_reviewing, false);
      assert.equal(fin.is_deposit, false);
      assert.equal(fin.balance_amount, 0);
      assert.equal(fin.is_collectible, false);
    });

    test('CRITICAL REGRESSION: ข้อมูลเก่าที่เคยพบปัญหา (Booking ID 59 scenario - paid with stale pending_manual)', () => {
      const b59 = {
        id: 59,
        customer_name: 'Ploy',
        total_amount: 190,
        paid_amount: 190,
        balance_amount: 0,
        payment_status: 'paid',
        slip_verify_status: 'pending_manual', // Stale un-updated status from legacy flow
        slip_image_url: 'https://r2/slip59.jpg'
      };
      const fin = normalizeBookingFinancials(b59);
      // Invariant: Once paid, is_paid MUST be true and is_reviewing MUST be false
      assert.equal(fin.is_paid, true, 'is_paid must be true for paid booking');
      assert.equal(fin.is_reviewing, false, 'is_reviewing must NEVER be true for paid booking');
      assert.equal(fin.balance_amount, 0, 'balance_amount must be 0');
      assert.equal(fin.is_collectible, false, 'is_collectible must be false');
    });

    test('State: ปฏิเสธสลิป (Rejected slip)', () => {
      const b = {
        id: 105,
        total_amount: 300,
        paid_amount: 0,
        balance_amount: 300,
        payment_status: 'rejected',
        slip_verify_status: 'rejected',
        slip_image_url: 'https://r2/bad_slip.jpg'
      };
      const fin = normalizeBookingFinancials(b);
      assert.equal(fin.is_paid, false);
      assert.equal(fin.is_reviewing, false);
      assert.equal(fin.is_rejected, true);
    });

    test('State: ยกเลิกการจอง (Cancelled booking)', () => {
      const b = {
        id: 106,
        total_amount: 500,
        paid_amount: 0,
        balance_amount: 500,
        payment_status: 'cancelled',
        slip_verify_status: 'pending_manual',
        slip_image_url: 'https://r2/cancelled_slip.jpg'
      };
      const fin = normalizeBookingFinancials(b);
      assert.equal(fin.is_cancelled, true);
      assert.equal(fin.is_paid, false);
      assert.equal(fin.is_reviewing, false);
    });

    test('State: ชำระยอดคงเหลือครบถ้วนแล้ว (Deposit followed by balance settled to paid)', () => {
      const b = {
        id: 107,
        total_amount: 1000,
        paid_amount: 1000,
        balance_amount: 0,
        payment_status: 'paid',
        slip_verify_status: 'approved_manual',
        slip_image_url: 'https://r2/balance_settled_slip.jpg'
      };
      const fin = normalizeBookingFinancials(b);
      assert.equal(fin.is_paid, true);
      assert.equal(fin.is_deposit, false);
      assert.equal(fin.is_reviewing, false);
      assert.equal(fin.balance_amount, 0);
      assert.equal(fin.is_collectible, false);
    });
  });

  describe('2. Service Usage Lifecycle Separation Tests', () => {
    const fixedNow = new Date('2026-10-28T14:00:00.000Z');

    test('State: รอเริ่มการใช้งาน (Upcoming service)', () => {
      const b = {
        id: 201,
        start_time: '2026-10-28T15:00:00.000Z',
        end_time: '2026-10-28T17:00:00.000Z'
      };
      const usage = getBookingUsageLifecycle(b, fixedNow);
      assert.equal(usage.key, 'upcoming');
      assert.equal(usage.label, 'รอเริ่มการใช้งาน');
      assert.equal(usage.is_upcoming, true);
      assert.equal(usage.is_active, false);
      assert.equal(usage.is_completed, false);
    });

    test('State: กำลังใช้งานขณะนี้ (Active service usage)', () => {
      const b = {
        id: 202,
        start_time: '2026-10-28T13:30:00.000Z',
        end_time: '2026-10-28T15:30:00.000Z'
      };
      const usage = getBookingUsageLifecycle(b, fixedNow);
      assert.equal(usage.key, 'active');
      assert.equal(usage.label, 'กำลังใช้งานขณะนี้');
      assert.equal(usage.is_active, true);
      assert.equal(usage.is_completed, false);
      assert.equal(usage.is_upcoming, false);
    });

    test('State: สิ้นสุดเวลาการจองแล้ว (Completed schedule duration)', () => {
      const b = {
        id: 203,
        start_time: '2026-10-28T10:00:00.000Z',
        end_time: '2026-10-28T12:00:00.000Z'
      };
      const usage = getBookingUsageLifecycle(b, fixedNow);
      assert.equal(usage.key, 'completed');
      assert.equal(usage.label, 'สิ้นสุดเวลาการจองแล้ว');
      assert.equal(usage.is_completed, true);
      assert.equal(usage.is_active, false);
      assert.equal(usage.is_upcoming, false);
    });

    test('Multi-item booking: Evaluates across entire schedule span', () => {
      const b = {
        id: 204,
        items: [
          { start_time: '2026-10-28T10:00:00.000Z', end_time: '2026-10-28T12:00:00.000Z' },
          { start_time: '2026-10-28T13:00:00.000Z', end_time: '2026-10-28T16:00:00.000Z' }
        ]
      };
      // At 14:00, item 2 is active, so overall is active
      const usage = getBookingUsageLifecycle(b, fixedNow);
      assert.equal(usage.key, 'active');
      assert.equal(usage.label, 'กำลังใช้งานขณะนี้');
    });
  });

  describe('3. Combined Lifecycle + Payment Matrix (Clean Separation)', () => {
    const fixedNow = new Date('2026-10-28T14:00:00.000Z');

    test('Scenario: ตรวจสลิปแล้ว + สิ้นสุดเวลาการจองแล้ว (Reported user issue)', () => {
      const b = {
        id: 59,
        customer_name: 'Ploy',
        payment_status: 'paid',
        slip_verify_status: 'pending_manual', // Legacy stale
        total_amount: 190,
        paid_amount: 190,
        balance_amount: 0,
        start_time: '2026-10-27T10:00:00.000Z',
        end_time: '2026-10-27T12:00:00.000Z' // Finished yesterday
      };

      const fin = normalizeBookingFinancials(b);
      const usage = getBookingUsageLifecycle(b, fixedNow);

      // Financial invariant
      assert.equal(fin.is_paid, true);
      assert.equal(fin.is_reviewing, false);

      // Service usage invariant
      assert.equal(usage.is_completed, true);
      assert.equal(usage.label, 'สิ้นสุดเวลาการจองแล้ว');

      // Primary Action Helper simulation
      const isPaid = fin.is_paid;
      const isCancelled = fin.is_cancelled;
      const isRejected = fin.is_rejected;
      const isReviewing = !isPaid && !isCancelled && !isRejected && fin.is_reviewing;

      let primaryAction;
      if (isReviewing) {
        primaryAction = 'review_slip';
      } else if (fin.is_collectible) {
        primaryAction = fin.is_deposit ? 'pay_balance' : 'pay';
      } else if (isPaid && !isCancelled) {
        primaryAction = 'receipt';
      } else {
        primaryAction = 'details';
      }

      // Assert primary action is 'receipt' ('ดูการจอง'), NOT 'review_slip' ('ตรวจสลิป')!
      assert.equal(primaryAction, 'receipt', 'Primary action must be receipt / ดูการจอง');
    });
  });

  describe('4. Real Production Backup Data Audit Test', () => {
    test('Audit real SQLite dump: Verify all 11 legacy bookings resolve correctly', () => {
      const dumpPath = 'D:/Project BL/BACKUPS/bworkpos_db_backup_20261027_233137.sql';
      if (!fs.existsSync(dumpPath)) {
        console.warn('Backup dump not found, skipping real dump test.');
        return;
      }

      const sql = fs.readFileSync(dumpPath, 'utf8');
      const db = new DatabaseSync(':memory:');
      db.exec(sql);

      const rows = db.prepare(`
        SELECT id, customer_name, payment_status, slip_verify_status,
               paid_amount, balance_amount, total_amount, slip_image_url
        FROM bookings
        WHERE payment_status = 'paid' AND slip_verify_status = 'pending_manual'
      `).all();

      assert.equal(rows.length, 11, 'Expected exactly 11 legacy bookings with paid + pending_manual');

      for (const row of rows) {
        const fin = normalizeBookingFinancials(row);
        assert.equal(fin.is_paid, true, 'Booking #' + row.id + ' must be is_paid: true');
        assert.equal(fin.is_reviewing, false, 'Booking #' + row.id + ' must NOT be is_reviewing');
        assert.equal(fin.balance_amount, 0, 'Booking #' + row.id + ' balance must be 0');
      }
      console.log('Verified all ' + rows.length + ' production legacy bookings: all 100% resolved as is_paid: true, is_reviewing: false.');
    });
  });
});
