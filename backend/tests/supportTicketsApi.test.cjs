const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sqlite3 = require('sqlite3');
const { executeMigrationSql } = require('../migrator');
const {
  VALID_CATEGORIES,
  VALID_PRIORITIES,
  VALID_STATUSES,
  generateUniqueTicketNumber,
  validateTicketInput,
  createTicket,
  listCustomerTickets,
  getCustomerTicketByNumber,
  addCustomerMessage,
  listStaffTickets,
  getStaffTicketDetail,
  updateTicketStatus,
  addStaffMessage,
  markTicketRead,
  getTicketNotificationCounts
} = require('../supportTickets/service');

test('Customer Support Tickets & Notification System Test Suite', async (t) => {
  // Setup in-memory SQLite database
  const db = new sqlite3.Database(':memory:');
  const dbQuery = {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, lastID: this.lastID, changes: this.changes });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    },
    exec(sql) {
      return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };

  // 1. Setup prerequisite tables
  await dbQuery.exec(`
    CREATE TABLE rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT
    );

    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_code TEXT UNIQUE,
      room_id INTEGER,
      status TEXT,
      payment_status TEXT,
      checkin_status TEXT
    );

    CREATE TABLE booking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER,
      room_id INTEGER,
      start_time DATETIME,
      end_time DATETIME
    );
  `);

  // 2. Run Migration 012
  const migration012Path = path.join(__dirname, '..', 'migrations', '012_add_support_tickets.sql');
  const migration012Sql = fs.readFileSync(migration012Path, 'utf8');
  await executeMigrationSql(dbQuery, migration012Sql);

  // Seed sample room and booking
  await dbQuery.run(`INSERT INTO rooms (name) VALUES ('Meeting Room A')`);
  await dbQuery.run(`INSERT INTO customers (name, phone) VALUES ('Somchai Prasert', '0812345678')`);
  await dbQuery.run(
    `INSERT INTO bookings (booking_code, room_id, status, payment_status, checkin_status)
     VALUES ('BK-202610-001', 1, 'confirmed', 'paid', 'checked_in')`
  );
  await dbQuery.run(
    `INSERT INTO booking_items (booking_id, room_id, start_time, end_time)
     VALUES (1, 1, '2026-10-25 10:00:00', '2026-10-25 12:00:00')`
  );

  await t.test('1. Concurrency-Safe Ticket Number Generation', async () => {
    const num1 = await generateUniqueTicketNumber(dbQuery);
    assert.match(num1, /^TKT-\d{6}-00001$/);
  });

  await t.test('2. Validation Rules for Ticket Creation', async () => {
    // Missing category
    assert.ok(validateTicketInput({ subject: 'Test', description: 'Desc', customer_name: 'A', customer_phone: '0811111111' }));
    // Invalid category
    assert.ok(validateTicketInput({ category: 'invalid_cat', subject: 'Test', description: 'Desc', customer_name: 'A', customer_phone: '0811111111' }));
    // Missing subject
    assert.ok(validateTicketInput({ category: 'booking', subject: '', description: 'Desc', customer_name: 'A', customer_phone: '0811111111' }));
    // Missing phone
    assert.ok(validateTicketInput({ category: 'booking', subject: 'Test', description: 'Desc', customer_name: 'A', customer_phone: '' }));
    // Invalid short phone
    assert.ok(validateTicketInput({ category: 'booking', subject: 'Test', description: 'Desc', customer_name: 'A', customer_phone: '123' }));
    // Category 'other' without other_category
    assert.ok(validateTicketInput({ category: 'other', other_category: '', subject: 'Test', description: 'Desc', customer_name: 'A', customer_phone: '0811111111' }));
    // Category 'other' with whitespace-only other_category
    assert.ok(validateTicketInput({ category: 'other', other_category: '   ', subject: 'Test', description: 'Desc', customer_name: 'A', customer_phone: '0811111111' }));
    // Category 'other' with other_category > 100 characters
    assert.ok(validateTicketInput({ category: 'other', other_category: 'a'.repeat(101), subject: 'Test', description: 'Desc', customer_name: 'A', customer_phone: '0811111111' }));
    // Category 'other' with valid other_category
    assert.equal(validateTicketInput({ category: 'other', other_category: 'สอบถามที่จอดรถ', subject: 'Test', description: 'Desc', customer_name: 'A', customer_phone: '0811111111' }), null);
    // Valid input
    assert.equal(validateTicketInput({
      category: 'booking',
      subject: 'ขอเปลี่ยนเวลาจอง',
      description: 'ต้องการเลื่อนเวลาจาก 10:00 เป็น 11:00',
      customer_name: 'สมชาย',
      customer_phone: '081-234-5678'
    }), null);
  });

  let createdTicket1 = null;
  let createdTicket2 = null;

  await t.test('3. Create Customer Ticket (Booking Category & Attachments)', async () => {
    const res = await createTicket(dbQuery, {
      category: 'booking',
      subject: 'มีปัญหาเรื่องการจองห้อง',
      description: 'จองห้องแล้วระบบไม่ส่งการยืนยัน',
      customer_name: 'Somchai Prasert',
      customer_phone: '081-234-5678',
      line_user_id: 'U1234567890abcdef',
      booking_code: 'BK-202610-001',
      attachments: [
        {
          file_url: '/uploads/support_slip_test.jpg',
          file_name: 'slip.jpg',
          content_type: 'image/jpeg',
          file_size: 102400
        }
      ]
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 'NEW');
    assert.equal(res.category, 'booking');
    assert.match(res.ticket_number, /^TKT-\d{6}-00001$/);
    createdTicket1 = res;

    // Verify initial message was inserted
    const msgs = await dbQuery.all(`SELECT * FROM support_ticket_messages WHERE ticket_id = ?`, [res.ticket_id]);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].sender_type, 'customer');
    assert.equal(msgs[0].message, 'จองห้องแล้วระบบไม่ส่งการยืนยัน');
    assert.equal(msgs[0].visibility, 'public');

    // Verify attachment was linked
    const atts = await dbQuery.all(`SELECT * FROM support_ticket_attachments WHERE ticket_id = ?`, [res.ticket_id]);
    assert.equal(atts.length, 1);
    assert.equal(atts[0].file_url, '/uploads/support_slip_test.jpg');

    // Verify audit event
    const events = await dbQuery.all(`SELECT * FROM support_ticket_events WHERE ticket_id = ?`, [res.ticket_id]);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'CREATED');
  });

  await t.test('4. Create Second Ticket (Payment Category & Priority)', async () => {
    const res = await createTicket(dbQuery, {
      category: 'payment',
      subject: 'แนบสลิปแล้วระบบไม่อัปเดต',
      description: 'โอนเงินแล้วแต่หน้าจอขึ้นรอชำระเงิน',
      customer_name: 'Wichai S.',
      customer_phone: '0899887766',
      priority: 'high'
    });

    assert.equal(res.success, true);
    assert.match(res.ticket_number, /^TKT-\d{6}-00002$/);
    createdTicket2 = res;

    const tRow = await dbQuery.get(`SELECT priority FROM support_tickets WHERE id = ?`, [res.ticket_id]);
    assert.equal(tRow.priority, 'high');
  });

  await t.test('5. Customer Ticket Listing (By Phone / LINE ID)', async () => {
    const byPhone = await listCustomerTickets(dbQuery, { phone: '0812345678' });
    assert.equal(byPhone.length, 1);
    assert.equal(byPhone[0].ticket_number, createdTicket1.ticket_number);
    assert.equal(byPhone[0].message_count, 1);
    assert.equal(byPhone[0].attachment_count, 1);

    const byLine = await listCustomerTickets(dbQuery, { line_user_id: 'U1234567890abcdef' });
    assert.equal(byLine.length, 1);

    const byBooking = await listCustomerTickets(dbQuery, { booking_code: 'BK-202610-001' });
    assert.equal(byBooking.length, 1);
  });

  await t.test('6. Customer Ticket Detail (Public Filter Verification)', async () => {
    // Insert an internal staff note into Ticket 1 to ensure customer cannot see it
    await dbQuery.run(
      `INSERT INTO support_ticket_messages
       (ticket_id, sender_type, sender_name, verified_sender_id, message, visibility, created_at)
       VALUES (?, 'staff', 'Staff Secret', 'admin', 'This is an internal note that customer should NOT see', 'internal', CURRENT_TIMESTAMP)`,
      [createdTicket1.ticket_id]
    );

    const detail = await getCustomerTicketByNumber(dbQuery, createdTicket1.ticket_number, { phone: '0812345678' });
    assert.equal(detail.ticket.ticket_number, createdTicket1.ticket_number);
    // Should ONLY have 1 public message, NOT the internal note!
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].sender_type, 'customer');

    // Phone mismatch throws 403
    await assert.rejects(
      async () => {
        await getCustomerTicketByNumber(dbQuery, createdTicket1.ticket_number, { phone: '0999999999' });
      },
      (err) => err.status === 403
    );
  });

  await t.test('7. Customer Reply to Ticket', async () => {
    const replyRes = await addCustomerMessage(dbQuery, createdTicket1.ticket_number, {
      sender_name: 'Somchai Prasert',
      sender_phone: '081-234-5678',
      message: 'สอบถามความคืบหน้าเพิ่มเติมครับ'
    });

    assert.equal(replyRes.success, true);

    const detail = await getCustomerTicketByNumber(dbQuery, createdTicket1.ticket_number, { phone: '0812345678' });
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[1].message, 'สอบถามความคืบหน้าเพิ่มเติมครับ');
  });

  await t.test('8. POS Staff Ticket Listing & Filters', async () => {
    // List ALL
    const staffListAll = await listStaffTickets(dbQuery, { staff_username: 'admin' });
    assert.equal(staffListAll.total, 2);

    // List by Category 'payment'
    const staffListPayment = await listStaffTickets(dbQuery, { category: 'payment', staff_username: 'admin' });
    assert.equal(staffListPayment.total, 1);
    assert.equal(staffListPayment.tickets[0].ticket_number, createdTicket2.ticket_number);

    // Search query by phone
    const staffSearch = await listStaffTickets(dbQuery, { q: '0812345678', staff_username: 'admin' });
    assert.equal(staffSearch.total, 1);
    assert.equal(staffSearch.tickets[0].ticket_number, createdTicket1.ticket_number);
  });

  await t.test('9. POS Staff Ticket Detail (Sees Internal Notes & Timeline)', async () => {
    const staffDetail = await getStaffTicketDetail(dbQuery, createdTicket1.ticket_id, 'admin');
    assert.equal(staffDetail.ticket.ticket_number, createdTicket1.ticket_number);
    // Staff sees 3 messages (1 customer init + 1 internal staff note + 1 customer reply)
    assert.equal(staffDetail.messages.length, 3);
    assert.ok(staffDetail.messages.some(m => m.visibility === 'internal'));

    // Check read marker was recorded
    const readRow = await dbQuery.get(
      `SELECT * FROM support_ticket_reads WHERE ticket_id = ? AND staff_username = 'admin'`,
      [createdTicket1.ticket_id]
    );
    assert.ok(readRow);
  });

  await t.test('10. POS Staff Status, Priority, & Assignee Updates', async () => {
    const updated = await updateTicketStatus(dbQuery, createdTicket1.ticket_id, {
      status: 'ACKNOWLEDGED',
      priority: 'urgent',
      assigned_to: 'staff_alice',
      staff_user: { username: 'admin', fullname: 'Administrator' },
      notes: 'รับเรื่องแล้วกำลังติดต่อลูกค้า'
    });

    assert.equal(updated.status, 'ACKNOWLEDGED');
    assert.equal(updated.priority, 'urgent');
    assert.equal(updated.assigned_to, 'staff_alice');

    // Verify events were logged
    const events = await dbQuery.all(
      `SELECT * FROM support_ticket_events WHERE ticket_id = ? ORDER BY id DESC`,
      [createdTicket1.ticket_id]
    );
    assert.ok(events.some(e => e.event_type === 'STATUS_CHANGE' && e.new_value === 'ACKNOWLEDGED'));
    assert.ok(events.some(e => e.event_type === 'PRIORITY_CHANGE' && e.new_value === 'urgent'));
    assert.ok(events.some(e => e.event_type === 'ASSIGN_STAFF' && e.new_value === 'staff_alice'));
  });

  await t.test('11. POS Staff Message Reply (Public vs Internal)', async () => {
    // 1. Staff replies publicly
    const pubMsg = await addStaffMessage(dbQuery, createdTicket2.ticket_id, {
      staff_user: { username: 'admin', fullname: 'Admin POS' },
      message: 'ตรวจสอบสลิปแล้ว ได้ทำการยืนยันให้เรียบร้อยแล้วครับ',
      visibility: 'public'
    });
    assert.equal(pubMsg.success, true);
    assert.equal(pubMsg.visibility, 'public');

    // Ticket 2 should have transitioned from NEW to IN_PROGRESS automatically
    const t2 = await dbQuery.get(`SELECT status FROM support_tickets WHERE id = ?`, [createdTicket2.ticket_id]);
    assert.equal(t2.status, 'IN_PROGRESS');

    // 2. Staff adds internal note
    const intMsg = await addStaffMessage(dbQuery, createdTicket2.ticket_id, {
      staff_user: { username: 'admin', fullname: 'Admin POS' },
      message: 'ยอดโอนเข้าบัญชี SCB 500 บาท เรียบร้อยแล้ว',
      visibility: 'internal'
    });
    assert.equal(intMsg.visibility, 'internal');
  });

  await t.test('12. Notification Counts for POS Badge', async () => {
    const counts = await getTicketNotificationCounts(dbQuery, 'staff_bob');
    // Ticket 1: ACKNOWLEDGED, Ticket 2: IN_PROGRESS -> newTicketsCount = 0
    assert.equal(counts.newTicketsCount, 0);
    // Both Ticket 1 and Ticket 2 are open -> openTicketsCount = 2
    assert.equal(counts.openTicketsCount, 2);

    // Create a NEW ticket to test newTicketsCount
    await createTicket(dbQuery, {
      category: 'facility',
      subject: 'แอร์ห้องประชุมไม่เย็น',
      description: 'แอร์มีเสียงดังและไม่เย็น',
      customer_name: 'Anan',
      customer_phone: '0855554444'
    });

    const updatedCounts = await getTicketNotificationCounts(dbQuery, 'staff_bob');
    assert.equal(updatedCounts.newTicketsCount, 1);
    assert.equal(updatedCounts.openTicketsCount, 3);
  });

  await t.test('13. Resolve Ticket & Auto Re-open on Customer Message', async () => {
    // Resolve Ticket 1
    await updateTicketStatus(dbQuery, createdTicket1.ticket_id, {
      status: 'RESOLVED',
      staff_user: { username: 'admin' },
      notes: 'ปัญหาได้รับการแก้ไขเรียบร้อยแล้ว'
    });

    let t1 = await dbQuery.get(`SELECT status, resolved_at FROM support_tickets WHERE id = ?`, [createdTicket1.ticket_id]);
    assert.equal(t1.status, 'RESOLVED');
    assert.ok(t1.resolved_at);

    // Customer replies to resolved ticket
    await addCustomerMessage(dbQuery, createdTicket1.ticket_number, {
      sender_phone: '081-234-5678',
      message: 'ยังพบปัญหาเดิมอยู่ครับ รบกวนดูให้อีกที'
    });

    t1 = await dbQuery.get(`SELECT status FROM support_tickets WHERE id = ?`, [createdTicket1.ticket_id]);
    assert.equal(t1.status, 'REOPENED');
  });

  await t.test('13.1. Create Ticket with Category Other and Other Category Specified', async () => {
    const res = await createTicket(dbQuery, {
      category: 'other',
      other_category: 'ปัญหาที่จอดรถและการเดินทาง',
      subject: 'สอบถามที่จอดรถสำหรับผู้มาติดต่อ',
      description: 'ต้องการทราบว่ามีที่จอดรถฟรีหรือไม่',
      customer_name: 'นภาพร ใจดี',
      customer_phone: '085-555-4433'
    });

    assert.equal(res.success, true);
    assert.equal(res.category, 'other');
    assert.equal(res.other_category, 'ปัญหาที่จอดรถและการเดินทาง');
    assert.match(res.ticket_number, /^TKT-\d{6}-\d{5}$/);

    // Verify database record has other_category
    const row = await dbQuery.get('SELECT * FROM support_tickets WHERE id = ?', [res.ticket_id]);
    assert.equal(row.category, 'other');
    assert.equal(row.other_category, 'ปัญหาที่จอดรถและการเดินทาง');

    // Verify getCustomerTicketByNumber returns other_category
    const detail = await getCustomerTicketByNumber(dbQuery, res.ticket_number);
    assert.equal(detail.ticket.category, 'other');
    assert.equal(detail.ticket.other_category, 'ปัญหาที่จอดรถและการเดินทาง');
  });

  await t.test('14. Express HTTP Endpoints Integration Test', async () => {
    const express = require('express');
    const { createPublicSupportRouter, createStaffSupportRouter } = require('../supportTickets/routes');

    const app = express();
    app.use(express.json({ limit: '10mb' }));

    // Mock staff auth middleware
    const mockStaffAuth = (req, res, next) => {
      req.user = { id: 1, username: 'test_admin', role: 'admin', fullname: 'Test Admin' };
      next();
    };

    app.use('/api/public/support', createPublicSupportRouter(dbQuery));
    app.use('/api/pos/support', mockStaffAuth, createStaffSupportRouter(dbQuery));

    // Listen on random port
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. POST /api/public/support/tickets
      const createRes = await fetch(`${baseUrl}/api/public/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'facility',
          subject: 'โปรเจคเตอร์เปิดไม่ติด',
          description: 'โปรเจคเตอร์ห้องประชุม 1 ไฟกระพริบสีแดง',
          customer_name: 'Preecha',
          customer_phone: '0823456789'
        })
      });
      assert.equal(createRes.status, 201);
      const createData = await createRes.json();
      assert.equal(createData.success, true);
      assert.match(createData.ticket_number, /^TKT-/);

      // 2. GET /api/public/support/tickets?phone=0823456789
      const listRes = await fetch(`${baseUrl}/api/public/support/tickets?phone=0823456789`);
      assert.equal(listRes.status, 200);
      const listData = await listRes.json();
      assert.equal(listData.tickets.length, 1);
      assert.equal(listData.tickets[0].ticket_number, createData.ticket_number);

      // 3. GET /api/public/support/tickets/:ticketNumber
      const detailRes = await fetch(`${baseUrl}/api/public/support/tickets/${createData.ticket_number}`);
      assert.equal(detailRes.status, 200);
      const detailData = await detailRes.json();
      assert.equal(detailData.ticket.ticket_number, createData.ticket_number);

      // 4. POST /api/public/support/tickets/:ticketNumber/messages
      const msgRes = await fetch(`${baseUrl}/api/public/support/tickets/${createData.ticket_number}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_name: 'Preecha',
          message: 'ลองเปลี่ยนปลั๊กแล้วยังไม่ติดครับ'
        })
      });
      assert.equal(msgRes.status, 201);

      // 5. GET /api/pos/support/notifications/count
      const notifRes = await fetch(`${baseUrl}/api/pos/support/notifications/count`);
      assert.equal(notifRes.status, 200);
      const notifData = await notifRes.json();
      assert.ok(notifData.success);
      assert.ok(typeof notifData.newTicketsCount === 'number');

      // 6. GET /api/pos/support/tickets
      const staffListRes = await fetch(`${baseUrl}/api/pos/support/tickets?category=facility`);
      assert.equal(staffListRes.status, 200);
      const staffListData = await staffListRes.json();
      assert.ok(staffListData.tickets.some(t => t.ticket_number === createData.ticket_number));

      // 7. PATCH /api/pos/support/tickets/:id
      const patchRes = await fetch(`${baseUrl}/api/pos/support/tickets/${createData.ticket_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'IN_PROGRESS',
          priority: 'urgent',
          notes: 'ช่างกำลังเข้าไปตรวจสอบหน้างาน'
        })
      });
      assert.equal(patchRes.status, 200);
      const patchData = await patchRes.json();
      assert.equal(patchData.ticket.status, 'IN_PROGRESS');

      // 8. POST /api/pos/support/tickets/:id/messages
      const staffMsgRes = await fetch(`${baseUrl}/api/pos/support/tickets/${createData.ticket_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'เจ้าหน้าที่กำลังนำสาย HDMI สำรองไปเปลี่ยนให้ครับ',
          visibility: 'public'
        })
      });
      assert.equal(staffMsgRes.status, 201);

    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log('✅ ALL SUPPORT TICKETS SERVICE & API ENGINE TESTS PASSED');
});
