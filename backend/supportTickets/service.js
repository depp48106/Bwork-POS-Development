/**
 * supportTickets/service.js
 * Business logic and database access layer for Customer Issue Tickets & POS Notification System
 */

const VALID_CATEGORIES = ['booking', 'payment', 'facility', 'general', 'other'];
const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const VALID_STATUSES = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];

/**
 * Format today's year and month in Asia/Bangkok
 */
function getBangkokYearMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit'
  }).format(date); // e.g. "2026-10"
  return parts.replace('-', ''); // "202610"
}

/**
 * Concurrency-safe unique ticket number generator: TKT-YYYYMM-XXXXX
 */
async function generateUniqueTicketNumber(dbQuery, date = new Date()) {
  const ym = getBangkokYearMonth(date);
  const prefix = `TKT-${ym}-`;

  const row = await dbQuery.get(
    `SELECT ticket_number FROM support_tickets WHERE ticket_number LIKE ? ORDER BY ticket_number DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let nextSeq = 1;
  if (row && row.ticket_number) {
    const parts = row.ticket_number.split('-');
    if (parts.length >= 3) {
      const currentSeq = parseInt(parts[2], 10);
      if (!isNaN(currentSeq)) {
        nextSeq = currentSeq + 1;
      }
    }
  }

  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
}

/**
 * Helper to record a ticket event / audit log
 */
async function recordTicketEvent(dbQuery, { ticketId, actorType, actorId, actorName, eventType, oldValue, newValue, notes }) {
  try {
    await dbQuery.run(
      `INSERT INTO support_ticket_events
       (ticket_id, actor_type, actor_id, actor_name, event_type, old_value, new_value, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        ticketId,
        actorType,
        actorId || null,
        actorName || actorType,
        eventType,
        oldValue || null,
        newValue || null,
        notes || null
      ]
    );
  } catch (err) {
    console.warn('[TicketEvent] Failed to record event:', err.message);
  }
}

/**
 * Validate customer ticket creation input
 */
function validateTicketInput({ category, other_category, subject, description, customer_phone, customer_name }) {
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return `หมวดหมู่ปัญหาไม่ถูกต้อง (ต้องเป็น ${VALID_CATEGORIES.join(', ')})`;
  }
  if (category === 'other') {
    if (!other_category || typeof other_category !== 'string' || !other_category.trim()) {
      return 'กรุณาระบุประเภทปัญหาอื่น ๆ';
    }
    if (other_category.trim().length > 100) {
      return 'ประเภทปัญหาอื่น ๆ ต้องไม่เกิน 100 ตัวอักษร';
    }
  }
  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return 'กรุณากรอกหัวข้อปัญหา';
  }
  if (subject.trim().length > 200) {
    return 'หัวข้อปัญหายาวเกินไป (สูงสุด 200 ตัวอักษร)';
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    return 'กรุณากรอกรายละเอียดปัญหา';
  }
  if (description.trim().length > 3000) {
    return 'รายละเอียดปัญหายาวเกินไป (สูงสุด 3000 ตัวอักษร)';
  }
  if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) {
    return 'กรุณาระบุชื่อผู้ติดต่อ';
  }
  if (!customer_phone || typeof customer_phone !== 'string' || !customer_phone.trim()) {
    return 'กรุณาระบุเบอร์โทรศัพท์สำหรับติดต่อกลับ';
  }
  const cleanPhone = customer_phone.replace(/[^0-9+]/g, '');
  if (cleanPhone.length < 9 || cleanPhone.length > 15) {
    return 'เบอร์โทรศัพท์ไม่ถูกต้อง (กรุณากรอก 9-15 หลัก)';
  }
  return null;
}

/**
 * Create a new ticket (Customer Facing)
 */
async function createTicket(dbQuery, data) {
  const validationError = validateTicketInput(data);
  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }

  const {
    category,
    other_category,
    subject,
    description,
    customer_name,
    customer_phone,
    line_user_id,
    booking_code,
    booking_id,
    room_id,
    priority = 'normal',
    attachments = []
  } = data;

  const validPriority = VALID_PRIORITIES.includes(priority) ? priority : 'normal';
  const finalOtherCategory = category === 'other' && other_category ? String(other_category).trim() : null;

  // Optional: match existing customer from phone
  let customerId = data.customer_id || null;
  if (!customerId && customer_phone) {
    try {
      const cleanPhone = customer_phone.replace(/[^0-9]/g, '');
      const matched = await dbQuery.get(
        `SELECT id FROM customers WHERE REPLACE(REPLACE(phone, '-', ''), ' ', '') LIKE ? LIMIT 1`,
        [`%${cleanPhone.slice(-9)}%`]
      );
      if (matched) customerId = matched.id;
    } catch (e) {}
  }

  // Optional: match booking_id from booking_code
  let resolvedBookingId = booking_id || null;
  let resolvedBookingCode = booking_code ? String(booking_code).trim().toUpperCase() : null;
  let resolvedRoomId = room_id || null;

  if (resolvedBookingCode && !resolvedBookingId) {
    try {
      const bRow = await dbQuery.get(
        `SELECT id, room_id FROM bookings WHERE booking_code = ? LIMIT 1`,
        [resolvedBookingCode]
      );
      if (bRow) {
        resolvedBookingId = bRow.id;
        if (!resolvedRoomId) resolvedRoomId = bRow.room_id;
      }
    } catch (e) {}
  }

  // Insert ticket with collision retry loop
  let inserted = null;
  let attempts = 0;
  while (!inserted && attempts < 5) {
    attempts++;
    const ticketNumber = await generateUniqueTicketNumber(dbQuery);
    try {
      const res = await dbQuery.run(
        `INSERT INTO support_tickets
         (ticket_number, customer_id, customer_name, customer_phone, line_user_id,
          booking_id, booking_code, room_id, category, other_category, subject, description,
          priority, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          ticketNumber,
          customerId,
          customer_name.trim(),
          customer_phone.trim(),
          line_user_id ? String(line_user_id).trim() : null,
          resolvedBookingId,
          resolvedBookingCode,
          resolvedRoomId,
          category,
          finalOtherCategory,
          subject.trim(),
          description.trim(),
          validPriority
        ]
      );

      const ticketId = res.lastID || (await dbQuery.get('SELECT last_insert_rowid() AS id')).id;
      inserted = { id: ticketId, ticket_number: ticketNumber };
    } catch (insertErr) {
      if (insertErr.message && insertErr.message.includes('UNIQUE constraint failed: support_tickets.ticket_number')) {
        // Collision: loop again
        continue;
      }
      throw insertErr;
    }
  }

  if (!inserted) {
    throw new Error('ไม่สามารถสร้างรหัส Ticket ได้ กรุณาลองใหม่อีกครั้ง');
  }

  const ticketId = inserted.id;

  // Insert initial message
  const msgRes = await dbQuery.run(
    `INSERT INTO support_ticket_messages
     (ticket_id, sender_type, sender_name, verified_sender_id, message, visibility, created_at)
     VALUES (?, 'customer', ?, ?, ?, 'public', CURRENT_TIMESTAMP)`,
    [
      ticketId,
      customer_name.trim(),
      line_user_id || customer_phone.trim(),
      description.trim()
    ]
  );
  const messageId = msgRes.lastID || (await dbQuery.get('SELECT last_insert_rowid() AS id')).id;

  // Insert attachments (max 3)
  const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 3) : [];
  for (const att of safeAttachments) {
    if (att && att.file_url) {
      await dbQuery.run(
        `INSERT INTO support_ticket_attachments
         (ticket_id, message_id, file_url, r2_object_key, file_name, content_type, file_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          ticketId,
          messageId,
          att.file_url,
          att.r2_object_key || null,
          att.file_name || 'attachment',
          att.content_type || 'image/jpeg',
          att.file_size || null
        ]
      );
    }
  }

  // Record creation event
  await recordTicketEvent(dbQuery, {
    ticketId,
    actorType: 'customer',
    actorId: line_user_id || customer_phone,
    actorName: customer_name,
    eventType: 'CREATED',
    newValue: 'NEW',
    notes: `เปิด Ticket ปัญหา: ${subject.trim()}`
  });

  return {
    success: true,
    ticket_id: ticketId,
    ticket_number: inserted.ticket_number,
    status: 'NEW',
    category,
    other_category: finalOtherCategory,
    subject: subject.trim(),
    created_at: new Date().toISOString()
  };
}

/**
 * List tickets for a customer by phone, line_user_id, or booking_code
 */
async function listCustomerTickets(dbQuery, { phone, line_user_id, booking_code }) {
  const conditions = [];
  const params = [];

  if (phone) {
    const clean = phone.replace(/[^0-9]/g, '');
    conditions.push(`REPLACE(REPLACE(customer_phone, '-', ''), ' ', '') LIKE ?`);
    params.push(`%${clean.slice(-9)}%`);
  }
  if (line_user_id) {
    conditions.push(`line_user_id = ?`);
    params.push(line_user_id);
  }
  if (booking_code) {
    conditions.push(`booking_code = ?`);
    params.push(String(booking_code).trim().toUpperCase());
  }

  if (conditions.length === 0) {
    return [];
  }

  const sql = `
    SELECT t.*,
      (SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = t.id AND visibility = 'public') AS message_count,
      (SELECT COUNT(*) FROM support_ticket_attachments WHERE ticket_id = t.id) AS attachment_count,
      r.name as room_name
    FROM support_tickets t
    LEFT JOIN rooms r ON t.room_id = r.id
    WHERE ${conditions.join(' OR ')}
    ORDER BY t.created_at DESC
    LIMIT 50
  `;

  return await dbQuery.all(sql, params);
}

/**
 * Get ticket details for Customer (public visibility only)
 */
async function getCustomerTicketByNumber(dbQuery, ticketNumber, verification = {}) {
  const ticket = await dbQuery.get(
    `SELECT t.*, r.name as room_name,
      b.payment_status as booking_payment_status,
      b.checkin_status as booking_checkin_status,
      (SELECT MIN(start_time) FROM booking_items WHERE booking_id = b.id) AS start_time,
      (SELECT MAX(end_time) FROM booking_items WHERE booking_id = b.id) AS end_time
     FROM support_tickets t
     LEFT JOIN rooms r ON t.room_id = r.id
     LEFT JOIN bookings b ON t.booking_id = b.id
     WHERE t.ticket_number = ?`,
    [ticketNumber]
  );

  if (!ticket) {
    const err = new Error('ไม่พบข้อมูล Ticket นี้');
    err.status = 404;
    throw err;
  }

  // If verification provided (phone or line_user_id), check ownership
  if (verification.phone) {
    const cleanInput = verification.phone.replace(/[^0-9]/g, '');
    const cleanStored = ticket.customer_phone.replace(/[^0-9]/g, '');
    if (cleanInput.slice(-8) !== cleanStored.slice(-8)) {
      const err = new Error('เบอร์โทรศัพท์ไม่ตรงกับข้อมูลในระบบ');
      err.status = 403;
      throw err;
    }
  } else if (verification.line_user_id) {
    if (ticket.line_user_id && ticket.line_user_id !== verification.line_user_id) {
      const err = new Error('LINE Account ไม่ตรงกับผู้เปิด Ticket');
      err.status = 403;
      throw err;
    }
  }

  // Get public messages only
  const messages = await dbQuery.all(
    `SELECT m.id, m.ticket_id, m.sender_type, m.sender_name, m.message, m.created_at
     FROM support_ticket_messages m
     WHERE m.ticket_id = ? AND m.visibility = 'public'
     ORDER BY m.created_at ASC`,
    [ticket.id]
  );

  // Get attachments
  const attachments = await dbQuery.all(
    `SELECT id, ticket_id, message_id, file_url, file_name, content_type, file_size, created_at
     FROM support_ticket_attachments
     WHERE ticket_id = ?
     ORDER BY created_at ASC`,
    [ticket.id]
  );

  // Group attachments by message_id
  const attachByMsg = {};
  for (const a of attachments) {
    if (!attachByMsg[a.message_id]) attachByMsg[a.message_id] = [];
    attachByMsg[a.message_id].push(a);
  }

  const enrichedMessages = messages.map(m => ({
    ...m,
    attachments: attachByMsg[m.id] || []
  }));

  return {
    ticket,
    messages: enrichedMessages
  };
}

/**
 * Customer reply to ticket
 */
async function addCustomerMessage(dbQuery, ticketNumber, { sender_name, sender_phone, line_user_id, message, attachments = [] }) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    const err = new Error('กรุณากรอกข้อความ');
    err.status = 400;
    throw err;
  }

  const ticket = await dbQuery.get(
    `SELECT id, ticket_number, status, customer_name, customer_phone, line_user_id
     FROM support_tickets WHERE ticket_number = ?`,
    [ticketNumber]
  );

  if (!ticket) {
    const err = new Error('ไม่พบข้อมูล Ticket นี้');
    err.status = 404;
    throw err;
  }

  // Check ownership if phone or line provided
  if (sender_phone) {
    const cleanInput = sender_phone.replace(/[^0-9]/g, '');
    const cleanStored = ticket.customer_phone.replace(/[^0-9]/g, '');
    if (cleanInput.slice(-8) !== cleanStored.slice(-8)) {
      const err = new Error('เบอร์โทรศัพท์ไม่ตรงกับข้อมูลในระบบ');
      err.status = 403;
      throw err;
    }
  }

  const senderName = (sender_name || ticket.customer_name || 'ลูกค้า').trim();
  const senderId = line_user_id || sender_phone || ticket.customer_phone;

  // Insert message
  const msgRes = await dbQuery.run(
    `INSERT INTO support_ticket_messages
     (ticket_id, sender_type, sender_name, verified_sender_id, message, visibility, created_at)
     VALUES (?, 'customer', ?, ?, ?, 'public', CURRENT_TIMESTAMP)`,
    [ticket.id, senderName, senderId, message.trim()]
  );
  const messageId = msgRes.lastID || (await dbQuery.get('SELECT last_insert_rowid() AS id')).id;

  // Insert attachments (max 3)
  const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 3) : [];
  for (const att of safeAttachments) {
    if (att && att.file_url) {
      await dbQuery.run(
        `INSERT INTO support_ticket_attachments
         (ticket_id, message_id, file_url, r2_object_key, file_name, content_type, file_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          ticket.id,
          messageId,
          att.file_url,
          att.r2_object_key || null,
          att.file_name || 'attachment',
          att.content_type || 'image/jpeg',
          att.file_size || null
        ]
      );
    }
  }

  // If ticket was closed or resolved, auto-reopen
  let newStatus = ticket.status;
  if (['RESOLVED', 'CLOSED'].includes(ticket.status)) {
    newStatus = 'REOPENED';
    await dbQuery.run(
      `UPDATE support_tickets SET status = 'REOPENED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticket.id]
    );
    await recordTicketEvent(dbQuery, {
      ticketId: ticket.id,
      actorType: 'customer',
      actorId: senderId,
      actorName: senderName,
      eventType: 'STATUS_CHANGE',
      oldValue: ticket.status,
      newValue: 'REOPENED',
      notes: 'ลูกค้าตอบกลับ ข้อความใหม่ทำให้เปิด Ticket ใหม่อัตโนมัติ'
    });
  } else {
    await dbQuery.run(
      `UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticket.id]
    );
  }

  return {
    success: true,
    message_id: messageId,
    ticket_id: ticket.id,
    ticket_number: ticket.ticket_number,
    ticket_status: newStatus,
    created_at: new Date().toISOString()
  };
}

/**
 * List tickets for POS Staff with filters & search
 */
async function listStaffTickets(dbQuery, { status, category, priority, assigned_to, q, limit = 50, offset = 0, staff_username }) {
  const conditions = [];
  const params = [];

  if (status && status !== 'ALL') {
    conditions.push('t.status = ?');
    params.push(status);
  }
  if (category && category !== 'ALL') {
    conditions.push('t.category = ?');
    params.push(category);
  }
  if (priority && priority !== 'ALL') {
    conditions.push('t.priority = ?');
    params.push(priority);
  }
  if (assigned_to && assigned_to !== 'ALL') {
    conditions.push('t.assigned_to = ?');
    params.push(assigned_to);
  }

  if (q && q.trim()) {
    const search = `%${q.trim()}%`;
    const cleanDigits = q.replace(/[^0-9]/g, '');
    const phoneSearch = cleanDigits.length >= 4 ? `%${cleanDigits}%` : search;
    conditions.push(
      '(t.ticket_number LIKE ? OR t.customer_name LIKE ? OR t.customer_phone LIKE ? OR REPLACE(REPLACE(t.customer_phone, "-", ""), " ", "") LIKE ? OR t.booking_code LIKE ? OR t.subject LIKE ?)'
    );
    params.push(search, search, search, phoneSearch, search, search);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countRow = await dbQuery.get(
    `SELECT COUNT(*) AS total FROM support_tickets t ${whereClause}`,
    params
  );
  const total = countRow ? countRow.total : 0;

  // Query tickets
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const sql = `
    SELECT t.*,
      r.name as room_name,
      (SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = t.id) AS message_count,
      (SELECT COUNT(*) FROM support_ticket_attachments WHERE ticket_id = t.id) AS attachment_count,
      (SELECT MAX(created_at) FROM support_ticket_messages WHERE ticket_id = t.id) AS last_message_at,
      COALESCE(
        (SELECT last_read_at FROM support_ticket_reads WHERE ticket_id = t.id AND staff_username = ?),
        '1970-01-01'
      ) AS staff_last_read_at
    FROM support_tickets t
    LEFT JOIN rooms r ON t.room_id = r.id
    ${whereClause}
    ORDER BY
      CASE t.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END ASC,
      t.updated_at DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [staff_username || 'system', ...params, safeLimit, safeOffset];
  const rows = await dbQuery.all(sql, queryParams);

  const enriched = rows.map(r => ({
    ...r,
    is_unread_for_staff: r.last_message_at ? (r.last_message_at > r.staff_last_read_at) : false
  }));

  return {
    tickets: enriched,
    total,
    limit: safeLimit,
    offset: safeOffset
  };
}

/**
 * Get ticket details for POS Staff (includes internal notes and event history)
 */
async function getStaffTicketDetail(dbQuery, ticketIdOrNumber, requestingStaffUsername) {
  const isId = /^\d+$/.test(String(ticketIdOrNumber));
  const ticket = await dbQuery.get(
    `SELECT t.*, r.name as room_name,
      b.payment_status as booking_payment_status,
      b.checkin_status as booking_checkin_status,
      (SELECT MIN(start_time) FROM booking_items WHERE booking_id = b.id) AS start_time,
      (SELECT MAX(end_time) FROM booking_items WHERE booking_id = b.id) AS end_time
     FROM support_tickets t
     LEFT JOIN rooms r ON t.room_id = r.id
     LEFT JOIN bookings b ON t.booking_id = b.id
     WHERE ${isId ? 't.id = ?' : 't.ticket_number = ?'}`,
    [ticketIdOrNumber]
  );

  if (!ticket) {
    const err = new Error('ไม่พบข้อมูล Ticket นี้');
    err.status = 404;
    throw err;
  }

  // Get all messages (public + internal)
  const messages = await dbQuery.all(
    `SELECT m.*
     FROM support_ticket_messages m
     WHERE m.ticket_id = ?
     ORDER BY m.created_at ASC`,
    [ticket.id]
  );

  // Get attachments
  const attachments = await dbQuery.all(
    `SELECT id, ticket_id, message_id, file_url, file_name, content_type, file_size, created_at
     FROM support_ticket_attachments
     WHERE ticket_id = ?
     ORDER BY created_at ASC`,
    [ticket.id]
  );

  // Group attachments by message_id
  const attachByMsg = {};
  for (const a of attachments) {
    if (!attachByMsg[a.message_id]) attachByMsg[a.message_id] = [];
    attachByMsg[a.message_id].push(a);
  }

  const enrichedMessages = messages.map(m => ({
    ...m,
    attachments: attachByMsg[m.id] || []
  }));

  // Get audit events
  const events = await dbQuery.all(
    `SELECT id, ticket_id, actor_type, actor_id, actor_name, event_type, old_value, new_value, notes, created_at
     FROM support_ticket_events
     WHERE ticket_id = ?
     ORDER BY created_at DESC`,
    [ticket.id]
  );

  // Mark read for this staff
  if (requestingStaffUsername) {
    await markTicketRead(dbQuery, ticket.id, requestingStaffUsername);
  }

  return {
    ticket,
    messages: enrichedMessages,
    attachments,
    events
  };
}

/**
 * Mark ticket as read by staff
 */
async function markTicketRead(dbQuery, ticketId, staffUsername) {
  try {
    await dbQuery.run(
      `INSERT INTO support_ticket_reads (ticket_id, staff_username, last_read_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(ticket_id, staff_username) DO UPDATE SET last_read_at = CURRENT_TIMESTAMP`,
      [ticketId, staffUsername]
    );
  } catch (err) {
    console.warn('[TicketRead] Error updating read marker:', err.message);
  }
}

/**
 * Update ticket status, priority, or assignee (Staff Facing)
 */
async function updateTicketStatus(dbQuery, ticketId, { status, priority, assigned_to, staff_user, notes }) {
  const ticket = await dbQuery.get('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
  if (!ticket) {
    const err = new Error('ไม่พบข้อมูล Ticket นี้');
    err.status = 404;
    throw err;
  }

  const updates = [];
  const params = [];
  const staffUsername = staff_user ? (staff_user.username || 'staff') : 'staff';
  const staffName = staff_user ? (staff_user.fullname || staff_user.username || 'เจ้าหน้าที่') : 'เจ้าหน้าที่';

  // 1. Status change
  if (status && status !== ticket.status) {
    if (!VALID_STATUSES.includes(status)) {
      const err = new Error(`สถานะไม่ถูกต้อง (${VALID_STATUSES.join(', ')})`);
      err.status = 400;
      throw err;
    }
    updates.push('status = ?');
    params.push(status);

    if (status === 'RESOLVED') {
      updates.push('resolved_at = CURRENT_TIMESTAMP');
    } else if (status === 'CLOSED') {
      updates.push('closed_at = CURRENT_TIMESTAMP');
    }

    await recordTicketEvent(dbQuery, {
      ticketId,
      actorType: 'staff',
      actorId: staffUsername,
      actorName: staffName,
      eventType: 'STATUS_CHANGE',
      oldValue: ticket.status,
      newValue: status,
      notes: notes || `เปลี่ยนสถานะเป็น ${status}`
    });
  }

  // 2. Priority change
  if (priority && priority !== ticket.priority) {
    if (!VALID_PRIORITIES.includes(priority)) {
      const err = new Error(`ระดับความสำคัญไม่ถูกต้อง (${VALID_PRIORITIES.join(', ')})`);
      err.status = 400;
      throw err;
    }
    updates.push('priority = ?');
    params.push(priority);

    await recordTicketEvent(dbQuery, {
      ticketId,
      actorType: 'staff',
      actorId: staffUsername,
      actorName: staffName,
      eventType: 'PRIORITY_CHANGE',
      oldValue: ticket.priority,
      newValue: priority,
      notes: `เปลี่ยนระดับความสำคัญเป็น ${priority}`
    });
  }

  // 3. Assignee change
  if (assigned_to !== undefined && assigned_to !== ticket.assigned_to) {
    updates.push('assigned_to = ?');
    params.push(assigned_to || null);

    await recordTicketEvent(dbQuery, {
      ticketId,
      actorType: 'staff',
      actorId: staffUsername,
      actorName: staffName,
      eventType: 'ASSIGN_STAFF',
      oldValue: ticket.assigned_to,
      newValue: assigned_to || 'unassigned',
      notes: assigned_to ? `มอบหมายงานให้ ${assigned_to}` : 'ยกเลิกการมอบหมายงาน'
    });
  }

  // 4. If note provided as internal note, record message
  if (notes && notes.trim()) {
    await dbQuery.run(
      `INSERT INTO support_ticket_messages
       (ticket_id, sender_type, sender_name, verified_sender_id, message, visibility, created_at)
       VALUES (?, 'staff', ?, ?, ?, 'internal', CURRENT_TIMESTAMP)`,
      [ticketId, staffName, staffUsername, notes.trim()]
    );
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(ticketId);
    await dbQuery.run(
      `UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  }

  return await dbQuery.get('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
}

/**
 * Add staff message (public reply or internal note)
 */
async function addStaffMessage(dbQuery, ticketId, { staff_user, message, visibility = 'public', attachments = [] }) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    const err = new Error('กรุณากรอกข้อความ');
    err.status = 400;
    throw err;
  }

  const validVisibility = ['public', 'internal'].includes(visibility) ? visibility : 'public';
  const ticket = await dbQuery.get('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
  if (!ticket) {
    const err = new Error('ไม่พบข้อมูล Ticket นี้');
    err.status = 404;
    throw err;
  }

  const staffUsername = staff_user ? (staff_user.username || 'staff') : 'staff';
  const staffName = staff_user ? (staff_user.fullname || staff_user.username || 'เจ้าหน้าที่ B-WORK') : 'เจ้าหน้าที่ B-WORK';

  const msgRes = await dbQuery.run(
    `INSERT INTO support_ticket_messages
     (ticket_id, sender_type, sender_name, verified_sender_id, message, visibility, created_at)
     VALUES (?, 'staff', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [ticketId, staffName, staffUsername, message.trim(), validVisibility]
  );
  const messageId = msgRes.lastID || (await dbQuery.get('SELECT last_insert_rowid() AS id')).id;

  // Insert attachments (max 3)
  const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 3) : [];
  for (const att of safeAttachments) {
    if (att && att.file_url) {
      await dbQuery.run(
        `INSERT INTO support_ticket_attachments
         (ticket_id, message_id, file_url, r2_object_key, file_name, content_type, file_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          ticketId,
          messageId,
          att.file_url,
          att.r2_object_key || null,
          att.file_name || 'attachment',
          att.content_type || 'image/jpeg',
          att.file_size || null
        ]
      );
    }
  }

  // If public reply and ticket was NEW, advance to IN_PROGRESS
  if (validVisibility === 'public' && ticket.status === 'NEW') {
    await dbQuery.run(
      `UPDATE support_tickets SET status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticketId]
    );
    await recordTicketEvent(dbQuery, {
      ticketId,
      actorType: 'staff',
      actorId: staffUsername,
      actorName: staffName,
      eventType: 'STATUS_CHANGE',
      oldValue: 'NEW',
      newValue: 'IN_PROGRESS',
      notes: 'เจ้าหน้าที่ตอบกลับลูกค้า ปรับสถานะเป็นกำลังดำเนินการ'
    });
  } else {
    await dbQuery.run(
      `UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [ticketId]
    );
  }

  // Auto mark read for replying staff
  await markTicketRead(dbQuery, ticketId, staffUsername);

  return {
    success: true,
    message_id: messageId,
    ticket_id: ticketId,
    visibility: validVisibility,
    sender_name: staffName,
    created_at: new Date().toISOString()
  };
}

/**
 * Get notification counts for POS Staff
 */
async function getTicketNotificationCounts(dbQuery, staffUsername) {
  // 1. New tickets count (unattended)
  const newRow = await dbQuery.get(
    `SELECT COUNT(*) AS count FROM support_tickets WHERE status = 'NEW'`
  );
  const newTicketsCount = newRow ? newRow.count : 0;

  // 2. Open tickets count
  const openRow = await dbQuery.get(
    `SELECT COUNT(*) AS count FROM support_tickets WHERE status IN ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'REOPENED')`
  );
  const openTicketsCount = openRow ? openRow.count : 0;

  // 3. Unread count for this specific staff member
  const unreadRow = await dbQuery.get(
    `SELECT COUNT(DISTINCT t.id) AS count
     FROM support_tickets t
     JOIN support_ticket_messages m ON t.id = m.ticket_id
     LEFT JOIN support_ticket_reads r ON t.id = r.ticket_id AND r.staff_username = ?
     WHERE t.status NOT IN ('CLOSED')
       AND m.created_at > COALESCE(r.last_read_at, '1970-01-01')
       AND (m.sender_type = 'customer' OR m.verified_sender_id != ?)`,
    [staffUsername || 'system', staffUsername || 'system']
  );
  const unreadCount = unreadRow ? unreadRow.count : 0;

  return {
    newTicketsCount,
    openTicketsCount,
    unreadCount
  };
}

module.exports = {
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
};
