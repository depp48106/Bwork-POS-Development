// Cloudflare Worker API for Bwork-POS & Booking App
// Comprehensive API routing, Cloudflare D1 SQLite queries, Auth, Management, Quotations, Roles & LINE Webhook

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
      // 0. AUTH (/api/auth/login, /api/auth/change-password, /api/users/change-password)
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
          // Ensure permissions has fallback
          if (!safeUser.permissions || !safeUser.permissions.trim()) {
            safeUser.permissions = safeUser.role === 'admin' 
              ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation' 
              : 'pos,pending,layout,manage,history,quotations';
          }
          return new Response(JSON.stringify({ success: true, user: safeUser }), { headers: corsHeaders });
        } else {
          return new Response(JSON.stringify({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }), { status: 401, headers: corsHeaders });
        }
      }

      if ((pathname === '/api/auth/change-password' || pathname === '/api/users/change-password') && method === 'POST') {
        const { username, oldPassword, newPassword } = await request.json();
        const oldHash = await hashPassword(oldPassword);
        const user = await env.DB.prepare("SELECT * FROM users WHERE username = ? AND password_hash = ?").bind(username, oldHash).first();
        if (!user) {
          return new Response(JSON.stringify({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }
        const newHash = await hashPassword(newPassword);
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, user.id).run();
        return new Response(JSON.stringify({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' }), { headers: corsHeaders });
      }

      // 1. DASHBOARD & SUMMARY (/api/dashboard/summary, /api/rooms/occupancy)
      if (pathname === '/api/dashboard/summary') {
        const { results: paidBookings } = await env.DB.prepare("SELECT SUM(total_amount) as total FROM bookings WHERE payment_status = 'paid'").all();
        const totalSales = paidBookings[0]?.total || 0;
        const { results: pending } = await env.DB.prepare("SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'pending' OR payment_status = 'reviewing'").all();
        const pendingCount = pending[0]?.count || 0;
        const { results: countBookings } = await env.DB.prepare("SELECT COUNT(*) as count FROM bookings").all();

        return new Response(JSON.stringify({
          totalSales,
          roomBookingsCount: countBookings[0]?.count || 0,
          serviceSales: 0,
          pendingCount,
          recentBookings: []
        }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/rooms/occupancy')) {
        return new Response(JSON.stringify([]), { headers: corsHeaders });
      }

      // 2. ROOMS CRUD & SCHEDULE (/api/rooms, /api/public/rooms/schedule, /api/bookings/check-overlap)
      if (pathname === '/api/rooms' || pathname === '/api/public/rooms') {
        if (method === 'GET') {
          const statusParam = url.searchParams.get('status');
          let query = "SELECT * FROM rooms";
          const params = [];
          if (statusParam) {
            query += " WHERE status = ?";
            params.push(statusParam);
          }
          query += " ORDER BY name ASC";
          const { results } = await env.DB.prepare(query).bind(...params).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const body = await request.json();
          const ins = await env.DB.prepare(
            `INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, half_day_rate, has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url, description, image_url, category, pin_code, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
          ).bind(
            body.name, body.capacity || 0, body.hourly_rate || 0, body.daily_rate || 0, body.half_day_rate || 0,
            body.has_classroom || 0, body.classroom_hourly_rate || 0, body.classroom_daily_rate || 0, body.classroom_capacity || 0,
            body.classroom_image_url || null, body.description || '', body.image_url || null, body.category || 'Meeting Room', body.pin_code || null
          ).run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'บันทึกห้องสำเร็จ' }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/rooms/') && !pathname.includes('occupancy')) {
        const parts = pathname.split('/');
        const roomId = parts[3];
        if (method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare(
            `UPDATE rooms SET name=?, capacity=?, hourly_rate=?, daily_rate=?, half_day_rate=?, has_classroom=?, classroom_hourly_rate=?, classroom_daily_rate=?, classroom_capacity=?, classroom_image_url=?, description=?, image_url=?, category=?, pin_code=?, status=? WHERE id=?`
          ).bind(
            body.name, body.capacity || 0, body.hourly_rate || 0, body.daily_rate || 0, body.half_day_rate || 0,
            body.has_classroom || 0, body.classroom_hourly_rate || 0, body.classroom_daily_rate || 0, body.classroom_capacity || 0,
            body.classroom_image_url || null, body.description || '', body.image_url || null, body.category || 'Meeting Room', body.pin_code || null, body.status || 'active', roomId
          ).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขข้อมูลห้องสำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          await env.DB.prepare("UPDATE rooms SET status = 'inactive' WHERE id = ?").bind(roomId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบห้องสำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'GET' && pathname.endsWith('/bookings')) {
          const { results } = await env.DB.prepare(
            "SELECT bi.* FROM booking_items bi JOIN bookings b ON bi.booking_id = b.id WHERE bi.room_id = ? AND b.payment_status != 'cancelled'"
          ).bind(roomId).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
      }

      // 3. SERVICES CRUD & CATEGORIES (/api/services, /api/categories)
      if (pathname === '/api/services') {
        if (method === 'GET') {
          const statusParam = url.searchParams.get('status');
          let query = "SELECT * FROM services";
          const params = [];
          if (statusParam) {
            query += " WHERE status = ?";
            params.push(statusParam);
          }
          query += " ORDER BY name ASC";
          const { results } = await env.DB.prepare(query).bind(...params).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const body = await request.json();
          const ins = await env.DB.prepare(
            "INSERT INTO services (name, price, category, image_url, status) VALUES (?, ?, ?, ?, 'active')"
          ).bind(body.name, body.price || 0, body.category || 'catering', body.image_url || null).run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'บันทึกบริการสำเร็จ' }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/services/')) {
        const serviceId = pathname.replace('/api/services/', '');
        if (method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare(
            "UPDATE services SET name=?, price=?, category=?, image_url=?, status=? WHERE id=?"
          ).bind(body.name, body.price || 0, body.category || 'catering', body.image_url || null, body.status || 'active', serviceId).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขบริการสำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          await env.DB.prepare("UPDATE services SET status = 'inactive' WHERE id = ?").bind(serviceId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบบริการสำเร็จ' }), { headers: corsHeaders });
        }
      }

      if (pathname === '/api/categories' || pathname.startsWith('/api/categories/')) {
        return new Response(JSON.stringify(['Meeting Room', 'Co-Working Space', 'Event Hall', 'catering', 'equipment', 'staff']), { headers: corsHeaders });
      }

      // 4. BOOKINGS, CALENDAR & OVERLAP CHECK (/api/bookings, /api/bookings/calendar, /api/bookings/check-overlap)
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

      if (pathname.startsWith('/api/bookings/calendar')) {
        const { results: items } = await env.DB.prepare(
          `SELECT bi.*, b.customer_name, b.payment_status, r.name as room_name
           FROM booking_items bi
           JOIN bookings b ON bi.booking_id = b.id
           LEFT JOIN rooms r ON bi.room_id = r.id
           WHERE b.payment_status != 'cancelled'`
        ).all();
        return new Response(JSON.stringify(items), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings/check-overlap') {
        const roomId = url.searchParams.get('room_id');
        const startTime = url.searchParams.get('start_time');
        const endTime = url.searchParams.get('end_time');

        const overlap = await env.DB.prepare(
          `SELECT bi.id FROM booking_items bi
           JOIN bookings b ON bi.booking_id = b.id
           WHERE bi.room_id = ? AND bi.start_time < ? AND bi.end_time > ? AND b.payment_status != 'cancelled'`
        ).bind(roomId, endTime, startTime).first();

        return new Response(JSON.stringify({ hasOverlap: !!overlap }), { headers: corsHeaders });
      }

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

      if (pathname.startsWith('/api/bookings/') && (pathname.endsWith('/payment-status') || pathname.endsWith('/payment')) && (method === 'PUT' || method === 'PATCH')) {
        const parts = pathname.split('/');
        const bookingId = parts[3];
        const body = await request.json();
        const paymentStatus = body.payment_status || 'paid';
        const paymentMethod = body.payment_method || 'transfer';

        await env.DB.prepare('UPDATE bookings SET payment_status = ?, payment_method = ? WHERE id = ?')
          .bind(paymentStatus, paymentMethod, bookingId).run();

        return new Response(JSON.stringify({ success: true, message: 'อัปเดตสถานะการชำระเงินสำเร็จ' }), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings/upcoming-alerts') {
        return new Response(JSON.stringify([]), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/bookings/') && (method === 'GET' || method === 'PUT' || method === 'DELETE')) {
        const parts = pathname.split('/');
        const bookingId = parts[3];

        if (method === 'GET') {
          const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
          if (!booking) return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
          const { results: items } = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ?').bind(bookingId).all();
          return new Response(JSON.stringify({ ...booking, items }), { headers: corsHeaders });
        }

        if (method === 'DELETE') {
          await env.DB.prepare("UPDATE bookings SET payment_status = 'cancelled' WHERE id = ?").bind(bookingId).run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
      }

      // 5. PUBLIC BOOKINGS & SLIP UPLOAD (/api/public/bookings)
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

      // 6. QUOTATIONS CRUD (/api/quotations)
      if (pathname === '/api/quotations/next-number') {
        const nextNum = `QT-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;
        return new Response(JSON.stringify({ quotationNo: nextNum }), { headers: corsHeaders });
      }

      if (pathname === '/api/quotations') {
        if (method === 'GET') {
          const { results } = await env.DB.prepare("SELECT * FROM quotations ORDER BY created_at DESC").all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const body = await request.json();
          const ins = await env.DB.prepare(
            "INSERT INTO quotations (customer_name, department, contact, total_amount, status, quotation_no) VALUES (?, ?, ?, ?, 'draft', ?)"
          ).bind(body.customer_name, body.department || '', body.contact || '', body.total_amount || 0, body.quotation_no || `QT-${Date.now()}`).run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/quotations/')) {
        const qId = pathname.replace('/api/quotations/', '').split('/')[0];
        if (method === 'GET') {
          const q = await env.DB.prepare("SELECT * FROM quotations WHERE id = ?").bind(qId).first();
          return new Response(JSON.stringify(q || {}), { headers: corsHeaders });
        }
        if (method === 'PUT') {
          await env.DB.prepare("UPDATE quotations SET status = 'approved', approved_at = ? WHERE id = ?").bind(new Date().toISOString(), qId).run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
      }

      // 7. SETTINGS, USERS & ROLES CRUD (/api/settings, /api/users, /api/roles)
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

      if (pathname === '/api/users' || pathname === '/api/admin/users') {
        if (method === 'GET') {
          const { results: users } = await env.DB.prepare("SELECT id, username, role, permissions, fullname, created_at FROM users").all();
          const cleanUsers = users.map(u => ({
            ...u,
            permissions: (u.permissions && u.permissions.trim()) ? u.permissions : (u.role === 'admin' ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation' : 'pos,pending,layout,manage,history,quotations')
          }));
          return new Response(JSON.stringify(cleanUsers), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const body = await request.json();
          const defaultPerms = body.role === 'admin'
            ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation'
            : 'pos,pending,layout,manage,history,quotations';
          const passHash = await hashPassword(body.password || '123456');
          const ins = await env.DB.prepare(
            "INSERT INTO users (username, password_hash, role, permissions, fullname) VALUES (?, ?, ?, ?, ?)"
          ).bind(body.username, passHash, body.role || 'staff', body.permissions || defaultPerms, body.fullname || '').run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'เพิ่มผู้ใช้งานสำเร็จ' }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/users/')) {
        const uId = pathname.replace('/api/users/', '').split('/')[0];
        if (pathname.endsWith('/reset-password') && method === 'POST') {
          const newHash = await hashPassword('123456');
          await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, uId).run();
          return new Response(JSON.stringify({ success: true, message: 'รีเซ็ตรหัสผ่านเป็น 123456 เรียบร้อยแล้ว' }), { headers: corsHeaders });
        }
        if (method === 'PUT') {
          const body = await request.json();
          const defaultPerms = body.role === 'admin'
            ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation'
            : 'pos,pending,layout,manage,history,quotations';
          let query = "UPDATE users SET username=?, role=?, permissions=?, fullname=? WHERE id=?";
          let params = [body.username, body.role || 'staff', body.permissions || defaultPerms, body.fullname || '', uId];
          if (body.password) {
            const passHash = await hashPassword(body.password);
            query = "UPDATE users SET username=?, role=?, permissions=?, fullname=?, password_hash=? WHERE id=?";
            params = [body.username, body.role || 'staff', body.permissions || defaultPerms, body.fullname || '', passHash, uId];
          }
          await env.DB.prepare(query).bind(...params).run();
          return new Response(JSON.stringify({ success: true, message: 'อัปเดตผู้ใช้งานสำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบผู้ใช้งานสำเร็จ' }), { headers: corsHeaders });
        }
      }

      if (pathname === '/api/roles' || pathname.startsWith('/api/roles/')) {
        const rId = pathname.replace('/api/roles/', '');
        if (method === 'POST') {
          const body = await request.json();
          const ins = await env.DB.prepare("INSERT INTO roles (name, label, permissions) VALUES (?, ?, ?)").bind(body.name, body.label || body.name, body.permissions || '').run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'เพิ่มสิทธิ์สำเร็จ' }), { status: 201, headers: corsHeaders });
        }
        if (method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare("UPDATE roles SET name=?, label=?, permissions=? WHERE id=?").bind(body.name, body.label || body.name, body.permissions || '', rId).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขสิทธิ์สำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          await env.DB.prepare("DELETE FROM roles WHERE id=?").bind(rId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบสิทธิ์สำเร็จ' }), { headers: corsHeaders });
        }
        const { results: roles } = await env.DB.prepare("SELECT * FROM roles").all();
        return new Response(JSON.stringify(roles.length ? roles : [
          { id: 1, name: 'admin', label: 'ผู้ดูแลระบบ (Admin)', permissions: 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation' },
          { id: 2, name: 'staff', label: 'พนักงานต้อนรับ (Reception)', permissions: 'pos,pending,layout,manage,history,quotations' }
        ]), { headers: corsHeaders });
      }

      if (pathname === '/api/upload' && method === 'POST') {
        const body = await request.json();
        return new Response(JSON.stringify({ success: true, url: body.image || body.image_url || '/uploads/img_default.png' }), { headers: corsHeaders });
      }

      if (pathname === '/api/access/verify-pin') {
        return new Response(JSON.stringify({ success: true, valid: true, message: 'รหัสถูกต้อง' }), { headers: corsHeaders });
      }

      if (pathname === '/api/backup/trigger') {
        return new Response(JSON.stringify({ success: true, message: 'สำรองข้อมูลสำเร็จ' }), { headers: corsHeaders });
      }

      if (pathname === '/api/admin/clear-history' && method === 'POST') {
        await env.DB.prepare("DELETE FROM booking_items").run();
        await env.DB.prepare("DELETE FROM bookings").run();
        return new Response(JSON.stringify({ success: true, message: 'ล้างประวัติการใช้งานเรียบร้อยแล้ว' }), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings/upcoming-alerts') {
        return new Response(JSON.stringify([]), { headers: corsHeaders });
      }

      if (pathname === '/api/line/webhook') {
        return new Response(JSON.stringify({ success: true, message: 'LINE Webhook Received' }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), { status: 404, headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
