// Cloudflare Worker API for Bwork-POS & Booking App
// Comprehensive API routing, Cloudflare D1 SQLite queries, Auth, and LINE Webhook

async function hashPassword(password) {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json'
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 0. POST /api/auth/login (Staff & Admin Login)
      if (pathname === '/api/auth/login' && method === 'POST') {
        const { username, password } = await request.json();
        const passHash = await hashPassword(password);
        
        let user = await env.DB.prepare(
          "SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND password_hash = ?"
        ).bind(username, passHash).first();

        // Fallback for default admin
        if (!user && (username === 'admin' && password === 'admin123')) {
          user = await env.DB.prepare("SELECT * FROM users WHERE LOWER(username) = 'admin'").first();
        }

        if (user) {
          const { password_hash, ...safeUser } = user;
          return new Response(JSON.stringify({ success: true, user: safeUser }), { headers: corsHeaders });
        } else {
          return new Response(JSON.stringify({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }), { status: 401, headers: corsHeaders });
        }
      }

      // 1. GET /api/rooms & GET /api/public/rooms
      if (pathname === '/api/rooms' || pathname === '/api/public/rooms') {
        const { results } = await env.DB.prepare("SELECT * FROM rooms WHERE status = 'active' ORDER BY name ASC").all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      // 2. GET /api/services
      if (pathname === '/api/services') {
        const { results } = await env.DB.prepare("SELECT * FROM services WHERE status = 'active' ORDER BY name ASC").all();
        return new Response(JSON.stringify(results), { headers: corsHeaders });
      }

      // 3. GET /api/public/rooms/schedule
      if (pathname === '/api/public/rooms/schedule') {
        const date = url.searchParams.get('date');
        const { results: rooms } = await env.DB.prepare("SELECT * FROM rooms WHERE status = 'active' ORDER BY name ASC").all();
        
        let query = `
          SELECT bi.*, b.customer_name, b.payment_status, b.pin_code as master_pin
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          WHERE b.payment_status != 'cancelled'
        `;
        const params = [];
        if (date) {
          query += " AND bi.start_time LIKE ?";
          params.push(`${date}%`);
        }

        const { results: bookings } = await env.DB.prepare(query).bind(...params).all();

        const scheduleMap = rooms.map(room => ({
          ...room,
          bookings: bookings.filter(b => b.room_id === room.id)
        }));

        return new Response(JSON.stringify({ date, rooms: scheduleMap }), { headers: corsHeaders });
      }

      // 4. GET /api/bookings (List bookings for POS history & pending approvals)
      if (pathname === '/api/bookings' && method === 'GET') {
        const status = url.searchParams.get('status');
        let query = `SELECT * FROM bookings`;
        const params = [];
        if (status) {
          query += ` WHERE payment_status = ?`;
          params.push(status);
        }
        query += ` ORDER BY created_at DESC LIMIT 100`;

        const { results: bookings } = await env.DB.prepare(query).bind(...params).all();

        for (let b of bookings) {
          const { results: items } = await env.DB.prepare(
            `SELECT bi.*, r.name as room_name, s.name as service_name
             FROM booking_items bi
             LEFT JOIN rooms r ON bi.room_id = r.id
             LEFT JOIN services s ON bi.service_id = s.id
             WHERE bi.booking_id = ?`
          ).bind(b.id).all();
          b.items = items;
        }

        return new Response(JSON.stringify(bookings), { headers: corsHeaders });
      }

      // 5. POST /api/bookings (POS Walk-in Booking Endpoint)
      if (pathname === '/api/bookings' && method === 'POST') {
        const body = await request.json();
        const { customer_name, department, contact, total_amount, payment_status, payment_method, items, line_user_id } = body;

        if (!customer_name || !items || !items.length) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกข้อมูลผู้จองและเลือกรายการอย่างน้อย 1 รายการ' }), { status: 400, headers: corsHeaders });
        }

        const receiptNumber = `BK-${new Date().toISOString().slice(0,10).replace(/-/g,'')}${Math.floor(100 + Math.random() * 900)}`;
        const pinCode = String(Math.floor(100000 + Math.random() * 900000));

        const insBooking = await env.DB.prepare(
          `INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, line_user_id, checkin_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(customer_name, department || '', contact || '', total_amount || 0, payment_status || 'paid', payment_method || 'cash', receiptNumber, pinCode, line_user_id || null).run();

        const bookingId = insBooking.meta.last_row_id;

        for (let item of items) {
          await env.DB.prepare(
            `INSERT INTO booking_items (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, pin_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            bookingId,
            item.room_id || null,
            item.service_id || null,
            item.quantity || 1,
            item.price || 0,
            item.start_time || null,
            item.end_time || null,
            item.subtotal || 0,
            item.layout || 'standard',
            item.booking_type || 'hourly',
            item.room_id ? pinCode : null
          ).run();
        }

        return new Response(JSON.stringify({
          success: true,
          bookingId,
          receiptNumber,
          pinCode,
          message: 'บันทึกการจองสำเร็จ'
        }), { status: 201, headers: corsHeaders });
      }

      // 6. PUT /api/bookings/:id/payment-status (Admin approve/reject slip)
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/payment-status') && method === 'PUT') {
        const parts = pathname.split('/');
        const bookingId = parts[3];
        const { payment_status } = await request.json();

        await env.DB.prepare('UPDATE bookings SET payment_status = ? WHERE id = ?').bind(payment_status, bookingId).run();

        return new Response(JSON.stringify({ success: true, message: 'อัปเดตสถานะสำเร็จ' }), { headers: corsHeaders });
      }

      // 7. POST /api/public/bookings/:id/upload-slip (Upload Payment Slip)
      if (pathname.startsWith('/api/public/bookings/') && pathname.endsWith('/upload-slip') && method === 'POST') {
        const parts = pathname.split('/');
        const idParam = parts[4];
        const { slip_image } = await request.json();

        let bookingId = idParam;
        if (idParam.startsWith('BK-')) {
          const raw = idParam.replace('BK-', '');
          if (raw.length <= 6 && !isNaN(raw)) {
            bookingId = parseInt(raw, 10);
          }
        }

        const booking = await env.DB.prepare(
          'SELECT * FROM bookings WHERE id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)'
        ).bind(bookingId, idParam, idParam).first();

        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        await env.DB.prepare('UPDATE bookings SET slip_image_url = ?, payment_status = ? WHERE id = ?')
          .bind(slip_image || 'uploaded', 'reviewing', booking.id).run();

        return new Response(JSON.stringify({
          success: true,
          slipUrl: slip_image,
          message: 'อัปโหลดสลิปสำเร็จ! กำลังตรวจสอบการชำระเงิน'
        }), { headers: corsHeaders });
      }

      // 8. GET /api/public/bookings/:id
      if (pathname.startsWith('/api/public/bookings/') && method === 'GET') {
        const idParam = pathname.replace('/api/public/bookings/', '');
        const contact = url.searchParams.get('contact');

        let bookingId = idParam;
        if (idParam.startsWith('BK-')) {
          const raw = idParam.replace('BK-', '');
          if (raw.length <= 6 && !isNaN(raw)) {
            bookingId = parseInt(raw, 10);
          }
        }

        let booking;
        if (contact) {
          const cleanContact = String(contact).replace(/\D/g, '');
          booking = await env.DB.prepare(
            `SELECT * FROM bookings 
             WHERE (id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)) 
               AND (REPLACE(REPLACE(REPLACE(contact, '-', ''), ' ', ''), '+', '') = ? OR contact = ?)`
          ).bind(bookingId, idParam, idParam, cleanContact, contact).first();
        } else {
          booking = await env.DB.prepare(
            'SELECT * FROM bookings WHERE id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)'
          ).bind(bookingId, idParam, idParam).first();
        }

        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง หรือเบอร์โทรศัพท์ไม่ถูกต้อง' }), { status: 404, headers: corsHeaders });
        }

        const { results: items } = await env.DB.prepare(
          `SELECT bi.*, r.name as room_name, r.capacity, r.image_url, r.description
           FROM booking_items bi
           LEFT JOIN rooms r ON bi.room_id = r.id
           WHERE bi.booking_id = ?`
        ).bind(booking.id).all();

        const bookingCode = `BK-${String(booking.id).padStart(6, '0')}`;

        return new Response(JSON.stringify({
          ...booking,
          bookingCode,
          items,
          paymentDeadline: new Date(new Date(booking.created_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
        }), { headers: corsHeaders });
      }

      // 9. POST /api/public/bookings
      if (pathname === '/api/public/bookings' && method === 'POST') {
        const body = await request.json();
        const { customer_name, contact, email, department, note, room_id, booking_date, start_time, end_time, booking_type, layout, total_amount } = body;

        if (!customer_name || !contact || !room_id || !booking_date || !start_time || !end_time) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' }), { status: 400, headers: corsHeaders });
        }

        const room = await env.DB.prepare("SELECT * FROM rooms WHERE id = ? AND status = 'active'").bind(room_id).first();
        if (!room) {
          return new Response(JSON.stringify({ error: 'ไม่พบห้องที่เลือก' }), { status: 404, headers: corsHeaders });
        }

        const fullStart = `${booking_date}T${start_time}:00`;
        const fullEnd = `${booking_date}T${end_time}:00`;

        // Check overlap
        const overlap = await env.DB.prepare(
          `SELECT bi.id FROM booking_items bi
           JOIN bookings b ON bi.booking_id = b.id
           WHERE bi.room_id = ? AND bi.start_time < ? AND bi.end_time > ? AND b.payment_status != 'cancelled'`
        ).bind(room_id, fullEnd, fullStart).first();

        if (overlap) {
          return new Response(JSON.stringify({ error: 'ห้องนี้ถูกจองในช่วงเวลาดังกล่าวแล้ว' }), { status: 409, headers: corsHeaders });
        }

        const receiptNumber = `BK-${new Date().toISOString().slice(0,10).replace(/-/g,'')}${Math.floor(100 + Math.random() * 900)}`;
        const pinCode = room.pin_code?.trim() || String(Math.floor(100000 + Math.random() * 900000));

        const insBooking = await env.DB.prepare(
          `INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, booking_source, customer_email, checkin_status)
           VALUES (?, ?, ?, ?, 'pending', 'transfer', ?, ?, 'online', ?, 'pending')`
        ).bind(customer_name, department || note || '', contact, total_amount || 0, receiptNumber, pinCode, email || null).run();

        const bookingId = insBooking.meta.last_row_id;

        await env.DB.prepare(
          `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, pin_code)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(bookingId, room_id, total_amount || 0, fullStart, fullEnd, total_amount || 0, layout || 'standard', booking_type || 'hourly', pinCode).run();

        const bookingCode = `BK-${String(bookingId).padStart(6, '0')}`;

        return new Response(JSON.stringify({
          success: true,
          bookingId,
          bookingCode,
          receiptNumber,
          pinCode,
          totalAmount: total_amount,
          message: 'บันทึกการจองสำเร็จ'
        }), { status: 201, headers: corsHeaders });
      }

      // 10. GET /api/settings & GET /api/public/settings/payment & POST /api/settings
      if (pathname === '/api/settings' || pathname === '/api/public/settings/payment') {
        if (method === 'POST') {
          const body = await request.json();
          for (let [k, v] of Object.entries(body)) {
            await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?")
              .bind(k, String(v), String(v)).run();
          }
          return new Response(JSON.stringify({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ' }), { headers: corsHeaders });
        }

        const { results: settings } = await env.DB.prepare("SELECT key, value FROM settings").all();
        const map = {};
        settings.forEach(s => map[s.key] = s.value);

        return new Response(JSON.stringify({
          company_name: map.company_name || 'บริษัท ดีพมายด์ โซลูชั่น จำกัด',
          receipt_header: map.receipt_header || 'ใบเสร็จรับเงิน / ใบรับจองบริการ',
          receipt_footer: map.receipt_footer || 'ขอบคุณที่ใช้บริการห้องประชุมของเรา',
          promptpay_id: map.promptpay_id || '0125554000401',
          payment_bank_name: map.payment_bank_name || map.bank_name || 'ธนาคารกรุงศรีอยุธยา (Krungsri)',
          payment_bank_account: map.payment_bank_account || map.bank_account || '329-1-38429-0',
          payment_bank_account_name: map.payment_bank_account_name || map.bank_account_name || 'บริษัท บิลท์ ฮาร์ท จำกัด',
          payment_deadline_hours: 24,
          ...map
        }), { headers: corsHeaders });
      }

      // 11. GET /api/bookings/upcoming-alerts
      if (pathname === '/api/bookings/upcoming-alerts') {
        return new Response(JSON.stringify([]), { headers: corsHeaders });
      }

      // 12. POST /api/line/webhook
      if (pathname === '/api/line/webhook') {
        return new Response(JSON.stringify({ success: true, message: 'LINE Webhook Received' }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), { status: 404, headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
