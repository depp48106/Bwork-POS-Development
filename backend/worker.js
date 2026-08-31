// Cloudflare Worker API for Bwork-POS & Booking App
// Unified single source of truth for Local & Production environments
// Features: Robust Auth, Sequential Receipts, Overlap Checking, Secure PINs, LINE Push, and R2 Slip Management

const JWT_SECRET = 'bwork-pos-secret-key-change-in-production';
const JWT_EXPIRY = 8 * 60 * 60 * 1000; // 8 hours

// ==========================================
// 1. CRYPTO & AUTH HELPERS
// ==========================================
async function hashPassword(password) {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

async function createToken(payload) {
  try {
    const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64urlEncode(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + JWT_EXPIRY }));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${header}.${body}`)
    );
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const signatureBinary = String.fromCharCode(...signatureArray);
    const signature = btoa(signatureBinary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${header}.${body}.${signature}`;
  } catch (e) {
    return 'token_' + Date.now();
  }
}

async function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    let sigStr = signature.replace(/-/g, '+').replace(/_/g, '/');
    while (sigStr.length % 4) sigStr += '=';
    const sigBinary = atob(sigStr);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      encoder.encode(`${header}.${body}`)
    );
    if (!isValid) return null;
    const payload = JSON.parse(base64urlDecode(body));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function authenticateUser(request, env, requiredRole = null) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return { error: 'กรุณาเข้าสู่ระบบ (Token not provided)', status: 401 };
  }
  const payload = await verifyToken(token);
  if (!payload || !payload.id) {
    return { error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', status: 401 };
  }
  const user = await env.DB.prepare("SELECT id, username, role, permissions, fullname FROM users WHERE id = ?").bind(payload.id).first();
  if (!user) {
    return { error: 'ไม่พบข้อมูลผู้ใช้นี้ในระบบ', status: 401 };
  }
  if (user.role) {
    const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(user.role).first();
    if (roleRecord && typeof roleRecord.permissions === 'string') {
      user.permissions = roleRecord.permissions;
    }
  }
  if (user.permissions === null || user.permissions === undefined) {
    user.permissions = user.role === 'admin'
      ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation'
      : 'pos,pending,layout,manage,history,quotations';
  }
  if (requiredRole && user.role !== requiredRole) {
    return { error: 'ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้ (สำหรับผู้ดูแลระบบเท่านั้น)', status: 403 };
  }
  return { user };
}

// ==========================================
// 2. TIMESTAMPS & OVERLAP HELPERS
// ==========================================
function normalizeToLocalISO(dateStr, timeStr) {
  if (!dateStr) return '';
  if (timeStr) {
    let cleanTime = String(timeStr).trim();
    if (cleanTime.length === 5) cleanTime += ':00';
    const cleanDate = String(dateStr).trim().split('T')[0].split(' ')[0];
    return `${cleanDate}T${cleanTime}`;
  }
  if (typeof dateStr === 'string') {
    let s = dateStr.trim();
    // YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD HH:MM:SS format without timezone
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      s = s.replace(' ', 'T');
      if (s.length === 16) s += ':00';
      return s;
    }
    // Has timezone offset (e.g. Z or +07:00)
    if (s.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const bkkMs = d.getTime() + 7 * 60 * 60 * 1000;
        const bkk = new Date(bkkMs);
        const y = bkk.getUTCFullYear();
        const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
        const day = String(bkk.getUTCDate()).padStart(2, '0');
        const h = String(bkk.getUTCHours()).padStart(2, '0');
        const min = String(bkk.getUTCMinutes()).padStart(2, '0');
        const sec = String(bkk.getUTCSeconds()).padStart(2, '0');
        return `${y}-${m}-${day}T${h}:${min}:${sec}`;
      }
    }
    if (s.includes('T')) {
      const parts = s.split('T');
      const timePart = parts[1].split('.')[0];
      const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
      return `${parts[0]}T${cleanTime}`;
    }
    if (s.includes(' ')) {
      const parts = s.split(' ');
      const timePart = parts[1].split('.')[0];
      const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
      return `${parts[0]}T${cleanTime}`;
    }
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const bkkMs = d.getTime() + 7 * 60 * 60 * 1000;
  const bkk = new Date(bkkMs);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bkk.getUTCDate()).padStart(2, '0');
  const h = String(bkk.getUTCHours()).padStart(2, '0');
  const min = String(bkk.getUTCMinutes()).padStart(2, '0');
  const sec = String(bkk.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}:${sec}`;
}

async function getCleaningBufferMinutes(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cleaning_buffer_minutes'").first();
    if (row && row.value) {
      const val = parseInt(row.value, 10);
      if (!isNaN(val)) return val;
    }
  } catch (e) {}
  return 30;
}

async function checkRoomOverlap(env, roomId, startISO, endISO, excludeBookingId = null) {
  const normStart = normalizeToLocalISO(startISO);
  const normEnd = normalizeToLocalISO(endISO);
  const bufferMins = await getCleaningBufferMinutes(env);
  const bufferMs = bufferMins * 60 * 1000;

  const reqStartMs = new Date(normStart.replace(' ', 'T')).getTime();
  const reqEndMs = new Date(normEnd.replace(' ', 'T')).getTime();
  const reqEndBufferedMs = reqEndMs + bufferMs;

  let query = `
    SELECT bi.id, bi.booking_id, bi.start_time, bi.end_time, b.customer_name, b.payment_status
    FROM booking_items bi
    JOIN bookings b ON bi.booking_id = b.id
    WHERE bi.room_id = ?
      AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
  `;
  const params = [roomId];
  if (excludeBookingId) {
    query += " AND b.id != ?";
    params.push(excludeBookingId);
  }

  const { results: bookings } = await env.DB.prepare(query).bind(...params).all();
  for (const b of (bookings || [])) {
    if (!b.start_time || !b.end_time) continue;
    const bStartNorm = normalizeToLocalISO(b.start_time);
    const bEndNorm = normalizeToLocalISO(b.end_time);
    const bStartMs = new Date(bStartNorm.replace(' ', 'T')).getTime();
    const bEndMs = new Date(bEndNorm.replace(' ', 'T')).getTime();
    const bEndBufferedMs = bEndMs + bufferMs;

    const [bEndDate, bEndTime] = bEndNorm.split('T');
    const [bEndH, bEndM] = (bEndTime || '00:00').substring(0, 5).split(':').map(Number);
    const totalBufferedMins = bEndH * 60 + bEndM + bufferMins;
    const bufH = Math.floor(totalBufferedMins / 60) % 24;
    const bufM = totalBufferedMins % 60;
    const bufHHMM = `${String(bufH).padStart(2, '0')}:${String(bufM).padStart(2, '0')}`;
    const endBufferedISO = `${bEndDate}T${bufHHMM}:00`;

    // Overlap condition taking cleaning buffer into account:
    // (Requested Start < Existing End + Buffer) AND (Requested End + Buffer > Existing Start)
    if (reqStartMs < bEndBufferedMs && reqEndBufferedMs > bStartMs) {
      const isDirectUsage = (reqStartMs < bEndMs && reqEndMs > bStartMs);
      return {
        hasOverlap: true,
        overlap: true,
        isCleaningBuffer: !isDirectUsage,
        bufferMinutes: bufferMins,
        booking: {
          ...b,
          start_time: bStartNorm,
          end_time: bEndNorm,
          end_buffered_time: endBufferedISO
        }
      };
    }
  }
  return { hasOverlap: false, overlap: false, bufferMinutes: bufferMins };
}

function formatOverlapErrorMessage(roomName, overlapResult) {
  const b = (overlapResult && overlapResult.booking) || {};
  const sTime = b.start_time && b.start_time.includes('T') ? b.start_time.split('T')[1].substring(0, 5) : (b.start_time || '');
  const eTime = b.end_time && b.end_time.includes('T') ? b.end_time.split('T')[1].substring(0, 5) : (b.end_time || '');
  const nextAvail = b.end_buffered_time && b.end_buffered_time.includes('T') ? b.end_buffered_time.split('T')[1].substring(0, 5) : eTime;

  const customer = b.customer_name ? `คุณ ${b.customer_name}` : 'ลูกค้า';
  const nameLabel = roomName ? `ห้อง "${roomName}"` : 'ห้องนี้';

  if (overlapResult.isCleaningBuffer) {
    return `${nameLabel} อยู่ในช่วงเวลาทำความสะอาด (${overlapResult.bufferMinutes || 30} นาที) ต่อจากคิว${customer} (ใช้งานถึง ${eTime} น.) สามารถจองได้ตั้งแต่เวลา ${nextAvail} น. เป็นต้นไป`;
  }
  return `${nameLabel} ไม่ว่างในช่วงเวลาดังกล่าว (มีผู้ใช้งาน: ${customer} ช่วงเวลา ${sTime} - ${eTime} น.)`;
}

// ==========================================
// 3. SEQUENTIAL RECEIPT & QUOTATION NUMBER GENERATORS
// ==========================================
async function generateReceiptNumber(env) {
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bkkDate = new Date(Date.now() + bangkokOffsetMs);
  const yy = String(bkkDate.getUTCFullYear()).slice(-2);
  const mm = String(bkkDate.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `BK-${yy}${mm}`;

  const lastRow = await env.DB.prepare(
    "SELECT receipt_number FROM bookings WHERE receipt_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).bind(`${prefix}%`).first();

  let seq = 1;
  if (lastRow && lastRow.receipt_number) {
    const rawSeq = lastRow.receipt_number.replace(prefix, '').replace(/^-/, '');
    const lastNum = parseInt(rawSeq, 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

async function generateQuotationNumber(env) {
  const now = new Date();
  const year2 = String(now.getFullYear()).slice(-2);
  const month2 = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `QT-${year2}${month2}-`;

  const lastRow = await env.DB.prepare(
    "SELECT quotation_no FROM quotations WHERE quotation_no LIKE ? ORDER BY id DESC LIMIT 1"
  ).bind(`${prefix}%`).first();

  let seq = 1;
  if (lastRow && lastRow.quotation_no) {
    const match = lastRow.quotation_no.match(/(\d+)$/);
    if (match) {
      const lastNum = parseInt(match[1], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function generateUniquePinCode(env) {
  let pin = String(Math.floor(100000 + Math.random() * 900000));
  let existing = await env.DB.prepare(
    "SELECT id FROM bookings WHERE pin_code = ? AND (checkin_status IS NULL OR checkin_status != 'expired')"
  ).bind(pin).first();
  let tries = 0;
  while (existing && tries < 10) {
    pin = String(Math.floor(100000 + Math.random() * 900000));
    existing = await env.DB.prepare(
      "SELECT id FROM bookings WHERE pin_code = ? AND (checkin_status IS NULL OR checkin_status != 'expired')"
    ).bind(pin).first();
    tries++;
  }
  return pin;
}

// ==========================================
// 4. FILE UPLOAD & R2 HELPERS
// ==========================================
async function saveUploadedFile(env, fileData, folder = 'uploads') {
  if (!fileData) return null;
  if (typeof fileData === 'string' && fileData.startsWith('data:')) {
    const matches = fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return fileData;
    }
    const contentType = matches[1];
    const base64Data = matches[2];
    const binaryStr = atob(base64Data);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const ext = contentType.includes('png') ? 'png' : (contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpeg' : 'bin');
    const filename = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;

    if (env.BUCKET) {
      await env.BUCKET.put(filename, bytes.buffer, {
        httpMetadata: { contentType }
      });
      return `/uploads/${filename}`;
    } else {
      return fileData; // Store Data URL directly in DB if R2 not bound
    }
  }
  return fileData;
}

// ==========================================
// 5. LINE OA FLEX MESSAGE BUILDERS
// ==========================================
function formatThaiDateDisplay(isoString) {
  if (!isoString) return '-';
  try {
    const cleanStr = String(isoString).replace(' ', 'T');
    const [datePart] = cleanStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const months = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const thaiYear = y + 543;
    return `${d} ${months[m - 1]} ${thaiYear}`;
  } catch (e) {
    return String(isoString);
  }
}

// 1. Flex Message: ยืนยันการจองห้องประชุมสำเร็จ (ไม่แสดงรหัสผ่านในขั้นตอนนี้)
function buildLineBookingConfirmationFlex(booking, item, room) {
  const customerName = booking.customer_name || 'ลูกค้าคนพิเศษ';
  const roomName = room?.name || 'ห้องประชุม B-WORK';
  const receiptNo = booking.receipt_number || `BK-${String(booking.id).padStart(6, '0')}`;
  
  let dateDisplay = '-';
  let timeDisplay = '-';
  if (item?.start_time) {
    const sStr = String(item.start_time).replace(' ', 'T');
    dateDisplay = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = item.end_time ? String(item.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = `${sTime} - ${eTime} น.`;
  }

  return {
    type: 'flex',
    altText: `ยืนยันการจองห้องประชุม ${roomName} สำเร็จ (เลขที่: ${receiptNo})`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1e3a8a',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: 'B-WORK COWORKING & MEETING',
            weight: 'bold',
            color: '#93c5fd',
            size: 'xs'
          },
          {
            type: 'text',
            text: 'ยืนยันการจองสำเร็จ ✅',
            weight: 'bold',
            color: '#ffffff',
            size: 'xl',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ชื่อผู้จอง', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: customerName, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ห้องประชุม', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: roomName, size: 'sm', color: '#1e3a8a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'วันที่ใช้งาน', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: dateDisplay, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'เวลา', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: timeDisplay, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'เลขที่ใบจอง', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: receiptNo, size: 'sm', color: '#0f172a', flex: 4, align: 'end' }
            ]
          },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: '#f1f5f9',
            cornerRadius: '10px',
            contents: [
              {
                type: 'text',
                text: '🔑 รหัสผ่านเข้าห้อง (Door PIN)',
                size: 'xs',
                color: '#475569',
                weight: 'bold',
                align: 'center'
              },
              {
                type: 'text',
                text: 'รับรหัสได้ที่เคาน์เตอร์ประชาสัมพันธ์',
                size: 'sm',
                color: '#0f172a',
                weight: 'bold',
                align: 'center',
                margin: 'xs'
              },
              {
                type: 'text',
                text: 'เมื่อมาถึงสถานที่ กรุณาติดต่อเคาน์เตอร์ เพื่อรับรหัส PIN เข้าห้อง',
                size: 'xxs',
                color: '#64748b',
                align: 'center',
                wrap: true,
                margin: 'xs'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#1e3a8a',
            height: 'sm',
            action: {
              type: 'uri',
              label: '📱 ตรวจสอบสถานะการจอง',
              uri: `https://bwork-booking.pages.dev/status?contact=${encodeURIComponent(booking.contact || '')}`
            }
          }
        ]
      }
    }
  };
}

// 2. Flex Message: ส่งรหัสผ่านเปิดประตูห้องประชุม (Door PIN Dispatch)
function buildLineDoorPinFlex(booking, item, room) {
  const customerName = booking.customer_name || 'ลูกค้าคนพิเศษ';
  const roomName = room?.name || 'ห้องประชุม B-WORK';
  const pinCode = booking.pin_code || '------';
  
  let timeDisplay = '-';
  if (item?.start_time) {
    const sStr = String(item.start_time).replace(' ', 'T');
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = item.end_time ? String(item.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = `${sTime} - ${eTime} น.`;
  }

  return {
    type: 'flex',
    altText: `🔑 รหัสผ่านเข้าห้องประชุม ${roomName}: ${pinCode}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#10b981',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: 'B-WORK DOOR ACCESS',
            weight: 'bold',
            color: '#ffffff',
            size: 'xs'
          },
          {
            type: 'text',
            text: 'รหัสผ่านเปิดประตูห้องประชุม 🔑',
            weight: 'bold',
            color: '#ffffff',
            size: 'lg',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ห้องประชุม', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: roomName, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ช่วงเวลา', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: timeDisplay, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '16px',
            backgroundColor: '#f0fdf4',
            cornerRadius: '12px',
            borderColor: '#86efac',
            borderWidth: '1px',
            contents: [
              {
                type: 'text',
                text: '🔑 รหัส PIN ปลดล็อกประตู 6 หลัก',
                size: 'xs',
                color: '#15803d',
                weight: 'bold',
                align: 'center'
              },
              {
                type: 'text',
                text: pinCode,
                size: '3xl',
                color: '#166534',
                weight: 'bold',
                align: 'center',
                margin: 'sm'
              },
              {
                type: 'text',
                text: 'กดรหัส PIN 6 หลักที่หน้าจอแท็บเล็ตหน้าห้องเพื่อเปิดประตูเข้าใช้งาน',
                size: 'xxs',
                color: '#16a34a',
                align: 'center',
                wrap: true,
                margin: 'sm'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'ขอให้มีความสุขกับการใช้บริการ B-WORK ค่ะ',
            size: 'xxs',
            color: '#94a3b8',
            align: 'center'
          }
        ]
      }
    }
  };
}

async function sendLineBookingConfirmation(env, bookingId) {
  try {
    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;

    const item = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first() : null;

    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;
    if (!channelAccessToken) return null;

    const flexCard = buildLineBookingConfirmationFlex(booking, item, room);

    const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: booking.line_user_id,
        messages: [flexCard]
      })
    });

    return { success: lineRes.ok, status: lineRes.status };
  } catch (err) {
    console.error('Error sending confirmation message:', err);
    return null;
  }
}

async function sendLineDoorPin(env, bookingId) {
  try {
    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;

    const item = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first() : null;

    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;
    if (!channelAccessToken) return null;

    const flexCard = buildLineDoorPinFlex(booking, item, room);

    const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: booking.line_user_id,
        messages: [flexCard]
      })
    });

    return { success: lineRes.ok, status: lineRes.status };
  } catch (err) {
    console.error('Error sending door pin message:', err);
    return null;
  }
}

// 3. Flex Message: แจ้งยกเลิกการจองห้องประชุม
function buildLineBookingCancellationFlex(booking, item, room, reason = '') {
  const roomName = room ? `${room.name} (${room.room_number || ''})` : 'ห้องประชุม B-WORK';
  const bookingCode = booking.receipt_number || `#BK-${String(booking.id).padStart(6, '0')}`;

  let timeDisplay = '-';
  if (item && item.start_time) {
    const sStr = String(item.start_time).replace(' ', 'T');
    const sDate = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = item.end_time ? String(item.end_time).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    timeDisplay = `${sDate} (${sTime} - ${eTime} น.)`;
  }

  return {
    type: 'flex',
    altText: `🚫 แจ้งยกเลิกการจองห้องประชุม ${bookingCode}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#dc2626',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: '🚫 แจ้งยกเลิกการจองห้องประชุม',
            weight: 'bold',
            color: '#ffffff',
            size: 'md'
          },
          {
            type: 'text',
            text: `รหัสการจอง: ${bookingCode}`,
            color: '#fee2e2',
            size: 'xs',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ชื่อผู้จอง', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: booking.customer_name || 'ลูกค้า', size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ห้องประชุม', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: roomName, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'วัน/เวลาเดิม', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: timeDisplay, size: 'sm', color: '#dc2626', weight: 'bold', flex: 4, align: 'end', wrap: true }
            ]
          },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: '#fef2f2',
            cornerRadius: '10px',
            borderColor: '#fca5a5',
            borderWidth: '1px',
            contents: [
              {
                type: 'text',
                text: 'สถานะ: ยกเลิกการจองแล้ว',
                size: 'xs',
                color: '#991b1b',
                weight: 'bold'
              },
              {
                type: 'text',
                text: reason ? `หมายเหตุ: ${reason}` : 'รายการจองนี้ได้รับการยกเลิกในระบบเรียบร้อยแล้ว',
                size: 'xxs',
                color: '#b91c1c',
                wrap: true,
                margin: 'xs'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'หากมีข้อสงสัยหรือต้องการจองใหม่ สามารถติดต่อเจ้าหน้าที่ B-WORK ได้ตลอดเวลาค่ะ',
            size: 'xxs',
            color: '#94a3b8',
            align: 'center',
            wrap: true
          }
        ]
      }
    }
  };
}

async function sendLineBookingCancellation(env, bookingId, reason = '') {
  try {
    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;

    const item = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first() : null;

    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;
    if (!channelAccessToken) return null;

    const flexCard = buildLineBookingCancellationFlex(booking, item, room, reason);

    const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: booking.line_user_id,
        messages: [flexCard]
      })
    });

    return { success: lineRes.ok, status: lineRes.status };
  } catch (err) {
    console.error('Error sending cancellation message:', err);
    return null;
  }
}

// 4. Flex Message: แจ้งเปลี่ยนแปลงวัน/เวลาการจองสำเร็จ
function buildLineBookingRescheduleFlex(booking, item, room, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal) {
  const roomName = room ? `${room.name} (${room.room_number || ''})`.replace(' ()', '') : 'ห้องประชุม B-WORK';
  const bookingCode = booking.receipt_number || `#BK-${String(booking.id).padStart(6, '0')}`;
  const pinCode = (room && room.pin_code && room.pin_code.trim()) ? room.pin_code.trim() : (booking.pin_code || '------');

  let oldTimeDisplay = '-';
  if (oldStartTime) {
    const sStr = String(oldStartTime).replace(' ', 'T');
    const sDate = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = oldEndTime ? String(oldEndTime).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    oldTimeDisplay = `${sDate} (${sTime} - ${eTime} น.)`;
  }

  let newTimeDisplay = '-';
  if (newStartTime) {
    const sStr = String(newStartTime).replace(' ', 'T');
    const sDate = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes('T') ? sStr.split('T')[1].substring(0, 5) : '';
    const eStr = newEndTime ? String(newEndTime).replace(' ', 'T') : '';
    const eTime = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : '';
    newTimeDisplay = `${sDate} (${sTime} - ${eTime} น.)`;
  }

  return {
    type: 'flex',
    altText: `🔄 แจ้งเปลี่ยนแปลงข้อมูลการจอง ${bookingCode} (${roomName} รหัสเข้าห้อง: ${pinCode})`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2563eb',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: '🔄 เปลี่ยนแปลงข้อมูลการจองสำเร็จ',
            weight: 'bold',
            color: '#ffffff',
            size: 'md'
          },
          {
            type: 'text',
            text: `รหัสการจอง: ${bookingCode}`,
            color: '#bfdbfe',
            size: 'xs',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ชื่อผู้จอง', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: booking.customer_name || 'ลูกค้า', size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ห้องประชุม', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: roomName, size: 'sm', color: '#0284c7', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'วัน/เวลาเดิม', size: 'sm', color: '#94a3b8', flex: 2 },
              { type: 'text', text: oldTimeDisplay, size: 'sm', color: '#94a3b8', weight: 'regular', flex: 4, align: 'end', wrap: true }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'วัน/เวลาใหม่', size: 'sm', color: '#2563eb', flex: 2, weight: 'bold' },
              { type: 'text', text: newTimeDisplay, size: 'sm', color: '#2563eb', weight: 'bold', flex: 4, align: 'end', wrap: true }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ยอดสุทธิ', size: 'sm', color: '#64748b', flex: 2 },
              { type: 'text', text: `฿${Number(newTotal !== undefined ? newTotal : booking.total_amount || 0).toLocaleString()}`, size: 'sm', color: '#0f172a', weight: 'bold', flex: 4, align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: '#f0fdf4',
            cornerRadius: '12px',
            borderColor: '#86efac',
            borderWidth: '1px',
            contents: [
              {
                type: 'text',
                text: '🔑 รหัสผ่านปลดล็อกประตูห้องใหม่ (Door PIN)',
                size: 'xs',
                color: '#15803d',
                weight: 'bold',
                align: 'center'
              },
              {
                type: 'text',
                text: pinCode,
                size: 'xl',
                color: '#166534',
                weight: 'bold',
                align: 'center',
                margin: 'xs'
              },
              {
                type: 'text',
                text: 'กดรหัส PIN ตามด้วยเครื่องหมาย # ที่หน้าจอแท็บเล็ตหน้าห้องเพื่อปลดล็อก',
                size: 'xxs',
                color: '#16a34a',
                align: 'center',
                wrap: true,
                margin: 'xs'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'ระบบได้อัปเดตข้อมูลการใช้งานห้องประชุมให้เรียบร้อยแล้วค่ะ',
            size: 'xxs',
            color: '#94a3b8',
            align: 'center'
          }
        ]
      }
    }
  };
}

async function sendLineBookingReschedule(env, bookingId, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal) {
  try {
    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;

    const item = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first() : null;

    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;
    if (!channelAccessToken) return null;

    const flexCard = buildLineBookingRescheduleFlex(booking, item, room, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal);

    const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: booking.line_user_id,
        messages: [flexCard]
      })
    });

    return { success: lineRes.ok, status: lineRes.status };
  } catch (err) {
    console.error('Error sending reschedule message:', err);
    return null;
  }
}

let schemaInitialized = false;
async function ensureD1Schema(env) {
  if (schemaInitialized || !env || !env.DB) return;
  const migrations = [
    "ALTER TABLE bookings ADD COLUMN tax_invoice_required INTEGER DEFAULT 0",
    "ALTER TABLE bookings ADD COLUMN tax_name TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_address TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_id TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_phone TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_delivery_method TEXT",
    "ALTER TABLE bookings ADD COLUMN tax_postal_address TEXT",
    "ALTER TABLE bookings ADD COLUMN guest_count INTEGER",
    "ALTER TABLE bookings ADD COLUMN booking_source TEXT DEFAULT 'online'",
    "ALTER TABLE bookings ADD COLUMN customer_email TEXT",
    "ALTER TABLE bookings ADD COLUMN slip_image_url TEXT",
    "ALTER TABLE bookings ADD COLUMN line_user_id TEXT",
    "ALTER TABLE bookings ADD COLUMN pin_code TEXT",
    "ALTER TABLE bookings ADD COLUMN qr_token TEXT",
    "ALTER TABLE bookings ADD COLUMN receipt_number TEXT",
    "ALTER TABLE bookings ADD COLUMN checkin_status TEXT DEFAULT 'pending'",
    "ALTER TABLE bookings ADD COLUMN checkin_at DATETIME",
    "ALTER TABLE booking_items ADD COLUMN layout TEXT DEFAULT 'standard'",
    "ALTER TABLE booking_items ADD COLUMN booking_type TEXT DEFAULT 'hourly'",
    "ALTER TABLE booking_items ADD COLUMN guest_count INTEGER",
    "ALTER TABLE booking_items ADD COLUMN pin_code TEXT",
    "ALTER TABLE booking_items ADD COLUMN checkin_status TEXT DEFAULT 'pending'",
    "ALTER TABLE booking_items ADD COLUMN checkin_at DATETIME",
    "ALTER TABLE rooms ADD COLUMN daily_rate REAL DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN half_day_rate REAL DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN has_classroom INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN classroom_hourly_rate REAL DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN classroom_daily_rate REAL DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN classroom_capacity INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN classroom_image_url TEXT",
    "ALTER TABLE rooms ADD COLUMN has_hourly INTEGER DEFAULT 1",
    "ALTER TABLE rooms ADD COLUMN has_halfday INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN has_daily INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN pin_code TEXT",
    "ALTER TABLE rooms ADD COLUMN category TEXT DEFAULT 'Meeting Room'"
  ];

  for (const sql of migrations) {
    try {
      await env.DB.prepare(sql).run();
    } catch (e) {
      // Ignored: column already exists
    }
  }
  schemaInitialized = true;
}

// ==========================================
// 6. MAIN WORKER ROUTER
// ==========================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Standard CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Content-Type': 'application/json'
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Ensure D1 database schema has all latest columns
      await ensureD1Schema(env);
      // ----------------------------------------------------
      // SERVE R2 UPLOADS / STATIC IMAGES (/uploads/*)
      // ----------------------------------------------------
      if (pathname.startsWith('/uploads/') && method === 'GET') {
        const filePath = pathname.replace('/uploads/', '');
        if (env.BUCKET) {
          const object = await env.BUCKET.get(filePath);
          if (!object) {
            return new Response('File Not Found', { status: 404 });
          }
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('Cache-Control', 'public, max-age=31536000');
          return new Response(object.body, { headers });
        }
      }

      // ----------------------------------------------------
      // 0. AUTHENTICATION ENDPOINTS
      // ----------------------------------------------------
      if (pathname === '/api/auth/login' && method === 'POST') {
        const { username, password } = await request.json();
        if (!username || !password) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' }), { status: 400, headers: corsHeaders });
        }

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
          if (safeUser.role) {
            const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(safeUser.role).first();
            if (roleRecord && typeof roleRecord.permissions === 'string') {
              safeUser.permissions = roleRecord.permissions;
            }
          }
          if (safeUser.permissions === null || safeUser.permissions === undefined) {
            safeUser.permissions = safeUser.role === 'admin' 
              ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation' 
              : 'pos,pending,layout,manage,history,quotations';
          }
          const token = await createToken({ id: safeUser.id, username: safeUser.username, role: safeUser.role, permissions: safeUser.permissions, fullname: safeUser.fullname });
          return new Response(JSON.stringify({ success: true, token, user: safeUser }), { headers: corsHeaders });
        } else {
          return new Response(JSON.stringify({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }), { status: 401, headers: corsHeaders });
        }
      }

      if (pathname === '/api/auth/login-pin' && method === 'POST') {
        const { pin_code } = await request.json();
        if (!pin_code) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกรหัส PIN' }), { status: 400, headers: corsHeaders });
        }
        const user = await env.DB.prepare("SELECT id, username, role, permissions, fullname FROM users WHERE pin_code = ?").bind(pin_code.trim()).first();
        if (user) {
          const safeUser = { ...user };
          if (safeUser.role) {
            const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(safeUser.role).first();
            if (roleRecord && typeof roleRecord.permissions === 'string') {
              safeUser.permissions = roleRecord.permissions;
            }
          }
          if (safeUser.permissions === null || safeUser.permissions === undefined) {
            safeUser.permissions = safeUser.role === 'admin' 
              ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation' 
              : 'pos,pending,layout,manage,history,quotations';
          }
          const token = await createToken({ id: safeUser.id, username: safeUser.username, role: safeUser.role, permissions: safeUser.permissions, fullname: safeUser.fullname });
          return new Response(JSON.stringify({ success: true, token, user: safeUser }), { headers: corsHeaders });
        }
        return new Response(JSON.stringify({ error: 'รหัส PIN ไม่ถูกต้อง' }), { status: 401, headers: corsHeaders });
      }

      if (pathname === '/api/auth/me' && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        return new Response(JSON.stringify({ success: true, user: auth.user }), { headers: corsHeaders });
      }

      if ((pathname === '/api/auth/change-password' || pathname === '/api/users/change-password') && method === 'POST') {
        const body = await request.json();
        const { username, oldPassword, newPassword } = body;
        if (!oldPassword || !newPassword) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' }), { status: 400, headers: corsHeaders });
        }
        let targetUsername = username;
        if (!targetUsername) {
          const auth = await authenticateUser(request, env);
          if (auth.user) targetUsername = auth.user.username;
        }
        if (!targetUsername) {
          return new Response(JSON.stringify({ error: 'กรุณาระบุชื่อผู้ใช้งาน' }), { status: 400, headers: corsHeaders });
        }
        const oldHash = await hashPassword(oldPassword.trim());
        const user = await env.DB.prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND password_hash = ?").bind(targetUsername.trim(), oldHash).first();
        if (!user) {
          return new Response(JSON.stringify({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' }), { status: 400, headers: corsHeaders });
        }
        const newHash = await hashPassword(newPassword.trim());
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, user.id).run();
        return new Response(JSON.stringify({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' }), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 1. DASHBOARD & OCCUPANCY
      // ----------------------------------------------------
      if (pathname === '/api/dashboard/summary' && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const startDate = url.searchParams.get('start_date');
        const endDate = url.searchParams.get('end_date');

        let dateFilterBookings = "";
        let dateFilterItems = "";
        const paramsBookings = [];
        const paramsItems = [];

        if (startDate && endDate) {
          dateFilterBookings = " AND DATE(b.created_at) >= ? AND DATE(b.created_at) <= ?";
          paramsBookings.push(startDate, endDate);
          dateFilterItems = " AND DATE(b.created_at) >= ? AND DATE(b.created_at) <= ?";
          paramsItems.push(startDate, endDate);
        }

        // Total revenue from paid bookings
        const paidRes = await env.DB.prepare(`SELECT SUM(b.total_amount) as total FROM bookings b WHERE b.payment_status = 'paid'${dateFilterBookings}`).bind(...paramsBookings).first();
        const revenue = paidRes?.total || 0;

        // Total bookings count
        const countRes = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE (b.payment_status IS NULL OR b.payment_status != 'cancelled')${dateFilterBookings}`).bind(...paramsBookings).first();
        const bookingsCount = countRes?.count || 0;

        // Paid bookings count
        const paidCountRes = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE b.payment_status = 'paid'${dateFilterBookings}`).bind(...paramsBookings).first();
        const paidCount = paidCountRes?.count || 0;

        // Pending bookings count
        const pendingCountRes = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE (b.payment_status = 'pending' OR b.payment_status = 'reviewing')${dateFilterBookings}`).bind(...paramsBookings).first();
        const pendingCount = pendingCountRes?.count || 0;

        // Trend (revenue by date)
        const { results: trendResults } = await env.DB.prepare(`
          SELECT DATE(b.created_at) as date, SUM(b.total_amount) as revenue
          FROM bookings b
          WHERE b.payment_status = 'paid'${dateFilterBookings}
          GROUP BY DATE(b.created_at)
          ORDER BY DATE(b.created_at) ASC
        `).bind(...paramsBookings).all();

        // Popular Rooms
        const { results: popularRooms } = await env.DB.prepare(`
          SELECT r.name, SUM(bi.subtotal) as total_revenue, COUNT(bi.id) as bookings_count
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          JOIN rooms r ON bi.room_id = r.id
          WHERE (b.payment_status IS NULL OR b.payment_status != 'cancelled')${dateFilterItems}
          GROUP BY r.id, r.name
          ORDER BY total_revenue DESC
        `).bind(...paramsItems).all();

        // Popular Services
        const { results: popularServices } = await env.DB.prepare(`
          SELECT s.name, SUM(bi.quantity) as total_quantity, SUM(bi.subtotal) as total_revenue
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          JOIN services s ON bi.service_id = s.id
          WHERE (b.payment_status IS NULL OR b.payment_status != 'cancelled')${dateFilterItems}
          GROUP BY s.id, s.name
          ORDER BY total_quantity DESC
        `).bind(...paramsItems).all();

        return new Response(JSON.stringify({
          revenue,
          totalSales: revenue,
          bookingsCount,
          roomBookingsCount: bookingsCount,
          paidCount,
          pendingCount,
          trend: trendResults || [],
          popularRooms: popularRooms || [],
          popularServices: popularServices || []
        }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/rooms/occupancy') && method === 'GET') {
        const { current_time } = Object.fromEntries(url.searchParams);
        const { results: rooms } = await env.DB.prepare("SELECT * FROM rooms WHERE status = 'active'").all();
        const roomsOccupancy = [];

        for (const room of (rooms || [])) {
          let currentBooking = null;
          if (current_time) {
            currentBooking = await env.DB.prepare(`
              SELECT bi.*, b.customer_name, b.payment_status, b.pin_code
              FROM booking_items bi
              JOIN bookings b ON bi.booking_id = b.id
              WHERE bi.room_id = ? 
                AND bi.start_time <= ? 
                AND bi.end_time > ? 
                AND b.payment_status != 'cancelled'
              LIMIT 1
            `).bind(room.id, current_time, current_time).first();
          }
          roomsOccupancy.push({
            ...room,
            is_occupied: !!currentBooking,
            current_booking: currentBooking || null
          });
        }
        return new Response(JSON.stringify(roomsOccupancy), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 2. ROOMS & SERVICES CRUD
      // ----------------------------------------------------
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
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, 'rooms');
          const classroomImageUrl = await saveUploadedFile(env, body.classroom_image_url, 'rooms');

          const ins = await env.DB.prepare(
            `INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, half_day_rate, has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url, description, image_url, category, pin_code, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
          ).bind(
            body.name, body.capacity || 0, body.hourly_rate || 0, body.daily_rate || 0, body.half_day_rate || 0,
            body.has_classroom || 0, body.classroom_hourly_rate || 0, body.classroom_daily_rate || 0, body.classroom_capacity || 0,
            classroomImageUrl || null, body.description || '', imageUrl || null, body.category || 'Meeting Room', body.pin_code || null
          ).run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'บันทึกห้องสำเร็จ' }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/rooms/') && !pathname.includes('occupancy')) {
        const parts = pathname.split('/');
        const roomId = parts[3];

        if (method === 'PUT') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, 'rooms');
          const classroomImageUrl = await saveUploadedFile(env, body.classroom_image_url, 'rooms');

          await env.DB.prepare(
            `UPDATE rooms SET name=?, capacity=?, hourly_rate=?, daily_rate=?, half_day_rate=?, has_classroom=?, classroom_hourly_rate=?, classroom_daily_rate=?, classroom_capacity=?, classroom_image_url=?, description=?, image_url=?, category=?, pin_code=?, status=? WHERE id=?`
          ).bind(
            body.name, body.capacity || 0, body.hourly_rate || 0, body.daily_rate || 0, body.half_day_rate || 0,
            body.has_classroom || 0, body.classroom_hourly_rate || 0, body.classroom_daily_rate || 0, body.classroom_capacity || 0,
            classroomImageUrl || null, body.description || '', imageUrl || null, body.category || 'Meeting Room', body.pin_code || null, body.status || 'active', roomId
          ).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขข้อมูลห้องสำเร็จ' }), { headers: corsHeaders });
        }

        if (method === 'DELETE') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

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
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, 'services');
          const ins = await env.DB.prepare(
            "INSERT INTO services (name, price, category, image_url, description, status) VALUES (?, ?, ?, ?, ?, 'active')"
          ).bind(body.name, body.price || 0, body.category || 'catering', imageUrl || null, body.description || '').run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'บันทึกบริการสำเร็จ' }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/services/')) {
        const serviceId = pathname.replace('/api/services/', '');
        if (method === 'PUT') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, 'services');
          await env.DB.prepare(
            "UPDATE services SET name=?, price=?, category=?, image_url=?, description=?, status=? WHERE id=?"
          ).bind(body.name, body.price || 0, body.category || 'catering', imageUrl || null, body.description || '', body.status || 'active', serviceId).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขบริการสำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          await env.DB.prepare("UPDATE services SET status = 'inactive' WHERE id = ?").bind(serviceId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบบริการสำเร็จ' }), { headers: corsHeaders });
        }
      }

      if (pathname === '/api/categories' || pathname.startsWith('/api/categories/')) {
        return new Response(JSON.stringify(['Meeting Room', 'Co-Working Space', 'Event Hall', 'catering', 'equipment', 'staff']), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 3. PUBLIC ROOMS & SCHEDULE
      // ----------------------------------------------------
      if (pathname === '/api/public/rooms/schedule') {
        const date = url.searchParams.get('date');
        const { results: rooms } = await env.DB.prepare("SELECT * FROM rooms WHERE status = 'active' ORDER BY name ASC").all();
        
        let query = `
          SELECT bi.*, b.customer_name, b.payment_status
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
        const scheduleMap = (rooms || []).map(room => ({
          ...room,
          bookings: (bookings || []).filter(b => b.room_id === room.id)
        }));

        const bufferMins = await getCleaningBufferMinutes(env);
        return new Response(JSON.stringify({ date, cleaning_buffer_minutes: bufferMins, buffer_minutes: bufferMins, rooms: scheduleMap }), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings/check-overlap') {
        const roomId = url.searchParams.get('room_id');
        const startTime = url.searchParams.get('start_time');
        const endTime = url.searchParams.get('end_time');
        const excludeBookingId = url.searchParams.get('exclude_booking_id');
        const overlapResult = await checkRoomOverlap(env, roomId, startTime, endTime, excludeBookingId);
        return new Response(JSON.stringify(overlapResult), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings/calendar' && method === 'GET') {
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');

        let query = `
          SELECT bi.start_time, bi.end_time, bi.room_id, bi.subtotal, bi.price, bi.quantity, bi.layout, bi.booking_type,
                 bi.guest_count as item_guest_count,
                 r.name as room_name,
                 b.id as booking_id, b.customer_name, b.payment_status, b.booking_source, b.department, b.contact, b.guest_count
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          LEFT JOIN rooms r ON bi.room_id = r.id
          WHERE bi.room_id IS NOT NULL AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
        `;
        const params = [];
        if (month && year) {
          const mStr = String(month).padStart(2, '0');
          query += ` AND bi.start_time LIKE ?`;
          params.push(`${year}-${mStr}%`);
        }
        query += ` ORDER BY bi.start_time ASC`;

        const { results } = await env.DB.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results || []), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings/upcoming-alerts' && method === 'GET') {
        const alertSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'room_alert_minutes'").first();
        const alertMinutes = alertSetting && alertSetting.value ? parseInt(alertSetting.value, 10) : 15;

        // Current time in Bangkok timezone (UTC+7)
        const bangkokNow = new Date(Date.now() + 7 * 3600 * 1000);
        
        // Window: strictly starting soon (from 2 mins ago up to alertMinutes into the future)
        const startWindow = new Date(bangkokNow.getTime() - 2 * 60 * 1000);
        const endWindow = new Date(bangkokNow.getTime() + alertMinutes * 60 * 1000);

        const formatISO = (d) => {
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, '0');
          const day = String(d.getUTCDate()).padStart(2, '0');
          const h = String(d.getUTCHours()).padStart(2, '0');
          const min = String(d.getUTCMinutes()).padStart(2, '0');
          const s = String(d.getUTCSeconds()).padStart(2, '0');
          return `${y}-${m}-${day}T${h}:${min}:${s}`;
        };

        const startWindowStr = formatISO(startWindow);
        const endWindowStr = formatISO(endWindow);

        // 1. Upcoming bookings nearing start time (within 15 mins)
        const { results: upcoming } = await env.DB.prepare(`
          SELECT bi.start_time, bi.end_time, bi.room_id, bi.layout, bi.booking_type,
                 r.name as room_name,
                 b.id as booking_id, b.customer_name, b.payment_status
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          LEFT JOIN rooms r ON bi.room_id = r.id
          WHERE bi.room_id IS NOT NULL 
            AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
            AND bi.start_time >= ?
            AND bi.start_time <= ?
          ORDER BY bi.start_time ASC LIMIT 10
        `).bind(startWindowStr, endWindowStr).all();

        // 2. Today's full schedule for notification history in bell
        const todayPrefix = formatISO(bangkokNow).split('T')[0];
        const { results: todayBookings } = await env.DB.prepare(`
          SELECT bi.start_time, bi.end_time, bi.room_id, bi.layout, bi.booking_type,
                 r.name as room_name,
                 b.id as booking_id, b.customer_name, b.payment_status
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          LEFT JOIN rooms r ON bi.room_id = r.id
          WHERE bi.room_id IS NOT NULL 
            AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
            AND bi.start_time LIKE ?
          ORDER BY bi.start_time ASC LIMIT 30
        `).bind(`${todayPrefix}%`).all();

        // 3. Incoming LINE OA / Online bookings (pending or reviewing)
        const { results: incomingList } = await env.DB.prepare(`
          SELECT b.id as booking_id, b.customer_name, b.total_amount, b.payment_status, b.created_at, b.booking_source, 
                 (CASE WHEN b.slip_image_url IS NOT NULL AND b.slip_image_url != '' THEN 'uploaded' ELSE NULL END) as slip_image_url,
                 r.name as room_name, bi.start_time, bi.end_time
          FROM bookings b
          LEFT JOIN booking_items bi ON bi.booking_id = b.id
          LEFT JOIN rooms r ON bi.room_id = r.id
          WHERE b.payment_status IN ('pending', 'reviewing')
          ORDER BY b.id DESC LIMIT 20
        `).all();

        const pendingCountRes = await env.DB.prepare("SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'pending'").first();
        const reviewingCountRes = await env.DB.prepare("SELECT COUNT(*) as count FROM bookings WHERE payment_status = 'reviewing'").first();

        return new Response(JSON.stringify({
          upcoming: upcoming || [],
          todayBookings: todayBookings || [],
          incomingBookings: incomingList || [],
          pendingCount: (pendingCountRes?.count || 0) + (reviewingCountRes?.count || 0),
          reviewingCount: reviewingCountRes?.count || 0
        }), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 4. POS BOOKINGS (STAFF SIDE - REQUIRES AUTH)
      // ----------------------------------------------------
      
      // ----------------------------------------------------
      // BASECAMP QUOTA HUB ENDPOINTS
      // ----------------------------------------------------
      if (pathname === '/api/basecamp/quota' && method === 'GET') {
        const subType = url.searchParams.get('sub_type') || 'office';
        const unit = url.searchParams.get('unit') || '401';
        const now = new Date();
        const month = url.searchParams.get('month') || String(now.getMonth() + 1);
        const year = url.searchParams.get('year') || String(now.getFullYear());
        const targetMonthStr = `${year}-${String(month).padStart(2, '0')}`;
        const maxQuota = subType === 'office' ? 4 : 2;

        try {
          const quotaRow = await env.DB.prepare(
            `SELECT COALESCE(SUM(b.quota_hours_used), 0) as used_hours
             FROM bookings b
             WHERE b.customer_type = 'basecamp'
               AND b.basecamp_sub_type = ?
               AND b.basecamp_unit = ?
               AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
               AND (
                 EXISTS (
                   SELECT 1 FROM booking_items bi 
                   WHERE bi.booking_id = b.id 
                     AND strftime('%Y-%m', bi.start_time) = ?
                 )
                 OR (
                   NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id)
                   AND strftime('%Y-%m', b.created_at) = ?
                 )
               )`
          ).bind(subType, unit, targetMonthStr, targetMonthStr).first();

          const usedQuota = quotaRow ? Number(quotaRow.used_hours) : 0;
          const remainingQuota = Math.max(0, maxQuota - usedQuota);

          return new Response(JSON.stringify({
            sub_type: subType,
            unit: unit,
            target_month: targetMonthStr,
            max_quota: maxQuota,
            used_quota: usedQuota,
            remaining_quota: remainingQuota
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({
            sub_type: subType,
            unit: unit,
            target_month: targetMonthStr,
            max_quota: maxQuota,
            used_quota: 0,
            remaining_quota: maxQuota
          }), { headers: corsHeaders });
        }
      }

      if (pathname === '/api/basecamp/quota/overview' && method === 'GET') {
        const now = new Date();
        const month = url.searchParams.get('month') || String(now.getMonth() + 1);
        const year = url.searchParams.get('year') || String(now.getFullYear());
        const targetMonthStr = `${year}-${String(month).padStart(2, '0')}`;

        const OFFICE_UNITS = ['401','402','403','404','405','406','407','408','409','410','411','412','413','414'];
        const HOTDESK_UNITS = ['419','420','421','422','427','428','429','430'];

        try {
          const { results: rows } = await env.DB.prepare(
            `SELECT b.basecamp_sub_type, b.basecamp_unit, COALESCE(SUM(b.quota_hours_used), 0) as used_hours, COUNT(DISTINCT b.id) as booking_count
             FROM bookings b
             WHERE b.customer_type = 'basecamp'
               AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
               AND (
                 EXISTS (
                   SELECT 1 FROM booking_items bi 
                   WHERE bi.booking_id = b.id 
                     AND strftime('%Y-%m', bi.start_time) = ?
                 )
                 OR (
                   NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id)
                   AND strftime('%Y-%m', b.created_at) = ?
                 )
               )
             GROUP BY b.basecamp_sub_type, b.basecamp_unit`
          ).bind(targetMonthStr, targetMonthStr).all();

          const usageMap = {};
          (rows || []).forEach(r => {
            usageMap[`${r.basecamp_sub_type}_${r.basecamp_unit}`] = {
              used_quota: Number(r.used_hours),
              booking_count: Number(r.booking_count)
            };
          });

          const units = [];
          OFFICE_UNITS.forEach(u => {
            const usage = usageMap[`office_${u}`] || { used_quota: 0, booking_count: 0 };
            const maxQuota = 4;
            units.push({
              sub_type: 'office',
              unit: u,
              label: `Office ${u}`,
              max_quota: maxQuota,
              used_quota: usage.used_quota,
              remaining_quota: Math.max(0, maxQuota - usage.used_quota),
              used_count: usage.booking_count
            });
          });

          HOTDESK_UNITS.forEach(u => {
            const usage = usageMap[`hotdesk_${u}`] || { used_quota: 0, booking_count: 0 };
            const maxQuota = 2;
            units.push({
              sub_type: 'hotdesk',
              unit: u,
              label: `Hotdesk ${u}`,
              max_quota: maxQuota,
              used_quota: usage.used_quota,
              remaining_quota: Math.max(0, maxQuota - usage.used_quota),
              used_count: usage.booking_count
            });
          });

          return new Response(JSON.stringify({
            success: true,
            target_month: targetMonthStr,
            units
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      if (pathname === '/api/basecamp/quota/history' && method === 'GET') {
        const subType = url.searchParams.get('sub_type');
        const unit = url.searchParams.get('unit');
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');
        const targetMonthStr = (month && year) ? `${year}-${String(month).padStart(2, '0')}` : null;

        try {
          let sql = `
            SELECT b.id, b.receipt_number, b.customer_name, b.created_at, b.quota_hours_used,
                   bi.start_time, bi.end_time, bi.price, bi.subtotal, r.name as room_name
            FROM bookings b
            LEFT JOIN booking_items bi ON b.id = bi.booking_id
            LEFT JOIN rooms r ON bi.room_id = r.id
            WHERE b.customer_type = 'basecamp'
              AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
          `;
          const params = [];
          if (subType) { sql += ` AND b.basecamp_sub_type = ?`; params.push(subType); }
          if (unit) { sql += ` AND b.basecamp_unit = ?`; params.push(unit); }
          if (targetMonthStr) {
            sql += ` AND (strftime('%Y-%m', bi.start_time) = ? OR strftime('%Y-%m', b.created_at) = ?)`;
            params.push(targetMonthStr, targetMonthStr);
          }
          sql += ` ORDER BY b.created_at DESC`;

          const { results: bookings } = await env.DB.prepare(sql).bind(...params).all();
          return new Response(JSON.stringify({ success: true, bookings: bookings || [] }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
        }
      }

      if (pathname === '/api/bookings' && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const status = url.searchParams.get('payment_status') || url.searchParams.get('status');
        const startDate = url.searchParams.get('start_date');
        const endDate = url.searchParams.get('end_date');
        const search = url.searchParams.get('search');

        let query = `SELECT DISTINCT b.* FROM bookings b LEFT JOIN booking_items bi ON b.id = bi.booking_id LEFT JOIN rooms r ON bi.room_id = r.id WHERE 1=1`;
        const params = [];

        if (startDate) {
          query += ` AND (datetime(b.created_at) >= datetime(?) OR bi.start_time >= ? OR b.booking_date >= ?)`;
          params.push(startDate + ' 00:00:00', startDate, startDate);
        }
        if (endDate) {
          query += ` AND (datetime(b.created_at) <= datetime(?) OR bi.start_time <= ? OR b.booking_date <= ?)`;
          params.push(endDate + ' 23:59:59', endDate + ' 23:59:59', endDate);
        }
        if (search) {
          const q = `%${search}%`;
          query += ` AND (b.customer_name LIKE ? OR b.contact LIKE ? OR b.department LIKE ? OR b.receipt_number LIKE ? OR CAST(b.id AS TEXT) LIKE ? OR b.pin_code LIKE ? OR r.name LIKE ? OR r.category LIKE ?)`;
          params.push(q, q, q, q, q, q, q, q);
        }
        if (status) {
          if (status === 'pending' || status === 'unpaid') {
            query += ` AND (b.payment_status IN ('pending', 'reviewing', 'unpaid') OR b.payment_status IS NULL)`;
          } else if (status !== 'all') {
            query += ` AND b.payment_status = ?`;
            params.push(status);
          }
        }
        query += ` ORDER BY b.created_at DESC LIMIT 150`;

        const { results: bookings } = await env.DB.prepare(query).bind(...params).all();

        if (bookings && bookings.length > 0) {
          const bookingIds = bookings.map(b => b.id);
          const placeholders = bookingIds.map(() => '?').join(',');
          const { results: items } = await env.DB.prepare(
            `SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.category as service_category
             FROM booking_items bi
             LEFT JOIN rooms r ON bi.room_id = r.id
             LEFT JOIN services s ON bi.service_id = s.id
             WHERE bi.booking_id IN (${placeholders})
             ORDER BY bi.id ASC`
          ).bind(...bookingIds).all();

          const itemsMap = {};
          (items || []).forEach(it => {
            if (!itemsMap[it.booking_id]) itemsMap[it.booking_id] = [];
            itemsMap[it.booking_id].push(it);
          });

          bookings.forEach(b => {
            b.items = itemsMap[b.id] || [];
            if (b.items.length > 0) {
              const first = b.items[0];
              b.room_name = first.room_name;
              b.room_capacity = first.room_capacity;
              b.booking_type = first.booking_type;
              b.layout = first.layout;
              b.start_time = first.start_time;
              b.end_time = first.end_time;
            }
          });
        }

        return new Response(JSON.stringify(bookings || []), { headers: corsHeaders });
      }

      if (pathname === '/api/bookings' && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const body = await request.json();
        const { 
          customer_name, department, contact, payment_status, payment_method, items, line_user_id, booking_source,
          customer_type = 'walkin',
          basecamp_sub_type = null,
          basecamp_unit = null,
          internal_department = null,
          billing_option = 'paid'
        } = body;

        if (!customer_name || !items || !items.length) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกข้อมูลผู้จองและเลือกรายการอย่างน้อย 1 รายการ' }), { status: 400, headers: corsHeaders });
        }

        // 1. Verify Overlap for all room items
        for (const item of items) {
          if (item.room_id && item.start_time && item.end_time) {
            const overlapResult = await checkRoomOverlap(env, item.room_id, item.start_time, item.end_time);
            if (overlapResult.hasOverlap) {
              const rObj = await env.DB.prepare('SELECT name FROM rooms WHERE id = ?').bind(item.room_id).first();
              const rName = rObj ? rObj.name : `ID: ${item.room_id}`;
              return new Response(JSON.stringify({ error: formatOverlapErrorMessage(rName, overlapResult) }), { status: 409, headers: corsHeaders });
            }
          }
        }

        // 2. Server-side price calculation
        let serverTotal = 0;
        let totalBookingHours = 0;
        for (const item of items) {
          if (item.room_id) {
            const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(item.room_id).first();
            if (room) {
              let itemPrice = room.hourly_rate;
              const bType = item.booking_type || 'hourly';
              const bLayout = item.layout || 'standard';
              if (bType === 'daily') {
                itemPrice = bLayout === 'classroom' ? (room.classroom_daily_rate || room.daily_rate) : room.daily_rate;
              } else if (bType === 'halfday') {
                itemPrice = room.half_day_rate;
              } else {
                itemPrice = bLayout === 'classroom' ? (room.classroom_hourly_rate || room.hourly_rate) : room.hourly_rate;
              }
              const qty = item.quantity || 1;
              item.price = itemPrice;
              item.subtotal = Math.round(itemPrice * qty * 100) / 100;
              serverTotal += item.subtotal;
            }
            if (item.start_time && item.end_time) {
              const s = new Date(item.start_time);
              const e = new Date(item.end_time);
              const diffHours = Math.max(0, (e.getTime() - s.getTime()) / (1000 * 60 * 60));
              totalBookingHours += diffHours;
            } else if (item.quantity) {
              totalBookingHours += item.quantity;
            }
          } else if (item.service_id) {
            const service = await env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(item.service_id).first();
            if (service) {
              const qty = item.quantity || 1;
              item.price = service.price;
              item.subtotal = Math.round(service.price * qty * 100) / 100;
              serverTotal += item.subtotal;
            }
          }
        }

        let verifiedTotal = body.total_amount !== undefined ? body.total_amount : Math.round(serverTotal * 100) / 100;
        let quotaHoursUsed = 0;
        let effectiveBillingOption = billing_option || 'paid';

        if (customer_type === 'basecamp') {
          const maxQuota = basecamp_sub_type === 'office' ? 4 : 2;
          const firstItemDate = items[0]?.start_time || new Date().toISOString();
          const targetMonthStr = normalizeToLocalISO(firstItemDate).substring(0, 7);

          try {
            const quotaRow = await env.DB.prepare(
              `SELECT COALESCE(SUM(b.quota_hours_used), 0) as used_hours
               FROM bookings b
               WHERE b.customer_type = 'basecamp'
                 AND b.basecamp_sub_type = ?
                 AND b.basecamp_unit = ?
                 AND (b.payment_status != 'cancelled' OR b.payment_status IS NULL)
                 AND (
                   EXISTS (
                     SELECT 1 FROM booking_items bi 
                     WHERE bi.booking_id = b.id 
                       AND strftime('%Y-%m', bi.start_time) = ?
                   )
                   OR (
                     NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id)
                     AND strftime('%Y-%m', b.created_at) = ?
                   )
                 )`
            ).bind(basecamp_sub_type, basecamp_unit, targetMonthStr, targetMonthStr).first();

            const usedQuota = quotaRow ? Number(quotaRow.used_hours) : 0;
            const remainingQuota = Math.max(0, maxQuota - usedQuota);

            quotaHoursUsed = Math.min(totalBookingHours, remainingQuota);
            const chargeableHours = Math.max(0, totalBookingHours - quotaHoursUsed);

            if (totalBookingHours > 0) {
              verifiedTotal = Math.round((chargeableHours / totalBookingHours) * serverTotal * 100) / 100;
            } else {
              verifiedTotal = 0;
            }

            effectiveBillingOption = quotaHoursUsed > 0 ? (verifiedTotal === 0 ? 'quota' : 'quota_partial') : 'paid';
          } catch (qErr) {
            console.error('Error fetching quota in worker:', qErr);
          }
        } else if (customer_type === 'builtland') {
          verifiedTotal = 0;
          quotaHoursUsed = 0;
          effectiveBillingOption = 'internal_free';
        }

        const receiptNumber = await generateReceiptNumber(env);
        const roomItem = items.find(it => !!it.room_id);
        let pinCode = null;

        if (roomItem) {
          const roomDb = await env.DB.prepare('SELECT pin_code FROM rooms WHERE id = ?').bind(roomItem.room_id).first();
          if (roomDb && roomDb.pin_code && roomDb.pin_code.trim()) {
            pinCode = roomDb.pin_code.trim();
          } else {
            pinCode = await generateUniquePinCode(env);
          }
        }

        // Extract optional guest count for Walk-in
        const effectiveGuestCount = (body.guest_count !== undefined && body.guest_count !== null && body.guest_count !== '')
          ? parseInt(body.guest_count, 10)
          : (items.find(it => it.guest_count)?.guest_count ? parseInt(items.find(it => it.guest_count).guest_count, 10) : null);

        const nowIso = new Date().toISOString();
        const effectivePaymentStatus = customer_type === 'builtland' 
          ? 'internal_free' 
          : (verifiedTotal === 0 ? 'paid' : (payment_status || 'pending'));

        let insBooking;
        try {
          insBooking = await env.DB.prepare(
            `INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, booking_source, line_user_id, guest_count, checkin_status, customer_type, basecamp_sub_type, basecamp_unit, internal_department, billing_option, quota_hours_used, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            customer_name, 
            department || internal_department || '', 
            contact || '', 
            verifiedTotal, 
            effectivePaymentStatus, 
            payment_method || 'cash', 
            receiptNumber, 
            pinCode, 
            booking_source || 'walkin', 
            line_user_id || null, 
            effectiveGuestCount,
            customer_type || 'walkin',
            basecamp_sub_type || null,
            basecamp_unit || null,
            internal_department || null,
            effectiveBillingOption,
            quotaHoursUsed,
            nowIso
          ).run();
        } catch (dbErr) {
          insBooking = await env.DB.prepare(
            `INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, booking_source, line_user_id, checkin_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
          ).bind(customer_name, department || '', contact || '', verifiedTotal, effectivePaymentStatus, payment_method || 'cash', receiptNumber, pinCode, booking_source || 'walkin', line_user_id || null, nowIso).run();
        }

        const bookingId = insBooking.meta.last_row_id;

        for (let item of items) {
          const normStart = (item.room_id && item.start_time) ? normalizeToLocalISO(item.start_time) : null;
          const normEnd = (item.room_id && item.end_time) ? normalizeToLocalISO(item.end_time) : null;
          const itemGuestCount = item.guest_count ? parseInt(item.guest_count, 10) : effectiveGuestCount;

          try {
            await env.DB.prepare(
              `INSERT INTO booking_items (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, guest_count, pin_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              bookingId,
              item.room_id || null,
              item.service_id || null,
              item.quantity || 1,
              item.price || 0,
              normStart,
              normEnd,
              item.subtotal || 0,
              item.layout || 'standard',
              item.booking_type || 'hourly',
              itemGuestCount,
              item.room_id ? pinCode : null
            ).run();
          } catch (itemErr) {
            await env.DB.prepare(
              `INSERT INTO booking_items (booking_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, pin_code)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              bookingId,
              item.room_id || null,
              item.service_id || null,
              item.quantity || 1,
              item.price || 0,
              normStart,
              normEnd,
              item.subtotal || 0,
              item.layout || 'standard',
              item.booking_type || 'hourly',
              item.room_id ? pinCode : null
            ).run();
          }
        }

        const savedBooking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        const { results: savedItems } = await env.DB.prepare(`
          SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.category as service_category
          FROM booking_items bi
          LEFT JOIN rooms r ON bi.room_id = r.id
          LEFT JOIN services s ON bi.service_id = s.id
          WHERE bi.booking_id = ?
        `).bind(bookingId).all();

        return new Response(JSON.stringify({
          success: true,
          bookingId,
          booking_id: bookingId,
          id: bookingId,
          receiptNumber,
          receipt_number: receiptNumber,
          booking_code: receiptNumber,
          bookingCode: receiptNumber,
          pinCode,
          pin_code: pinCode,
          ...(savedBooking || {}),
          items: savedItems || [],
          message: 'บันทึกการจองสำเร็จ'
        }), { status: 201, headers: corsHeaders });
      }

      // Send Door Access PIN (Staff in POS or Reception triggers this)
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/send-pin') && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        if (booking.line_user_id) {
          const res = await sendLineDoorPin(env, bookingId);
          if (res && res.success) {
            return new Response(JSON.stringify({ 
              success: true, 
              line_sent: true, 
              pin_code: booking.pin_code, 
              message: 'ส่งรหัสผ่านเข้าห้องไปยัง LINE OA ของลูกค้าเรียบร้อยแล้ว' 
            }), { headers: corsHeaders });
          } else {
            return new Response(JSON.stringify({ 
              success: false, 
              line_sent: false, 
              pin_code: booking.pin_code, 
              error: 'เกิดข้อผิดพลาดในการเชื่อมต่อ LINE API' 
            }), { status: 500, headers: corsHeaders });
          }
        } else {
          return new Response(JSON.stringify({ 
            success: true, 
            line_sent: false, 
            pin_code: booking.pin_code, 
            message: 'ลูกค้ารายนี้ไม่ได้จองผ่าน LINE (จองผ่านหน้าเว็บทั่วไป)' 
          }), { headers: corsHeaders });
        }
      }

      // Payment status update -> Triggers Confirmation message (No PIN)
      if (pathname.startsWith('/api/bookings/') && (pathname.endsWith('/payment-status') || pathname.endsWith('/payment')) && (method === 'PUT' || method === 'PATCH' || method === 'POST')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const body = await request.json();
        const paymentStatus = body.payment_status || 'paid';
        const paymentMethod = body.payment_method || 'transfer';

        await env.DB.prepare('UPDATE bookings SET payment_status = ?, payment_method = ? WHERE id = ?')
          .bind(paymentStatus, paymentMethod, bookingId).run();

        let lineData = null;
        if (paymentStatus === 'paid') {
          lineData = await sendLineBookingConfirmation(env, bookingId);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: 'อัปเดตสถานะการชำระเงินสำเร็จ' + (lineData?.success ? ' และส่งการแจ้งเตือนยืนยันการจองผ่าน LINE OA แล้ว' : ''),
          line_notification_sent: lineData?.success || false
        }), { headers: corsHeaders });
      }

      // Cancel booking endpoint (Soft cancel + LINE Notification)
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/cancel') && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const body = await request.json().catch(() => ({}));
        const reason = body.reason || 'ลูกค้าแจ้งยกเลิก / เจ้าหน้าที่ทำรายการ';

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });

        await env.DB.prepare("UPDATE bookings SET payment_status = 'cancelled' WHERE id = ?").bind(bookingId).run();
        
        let lineData = null;
        if (booking.line_user_id) {
          lineData = await sendLineBookingCancellation(env, bookingId, reason);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: 'ยกเลิกการจองสำเร็จ' + (lineData?.success ? ' และส่งข้อความแจ้งเตือนผ่าน LINE OA เรียบร้อย' : ''),
          line_sent: lineData?.success || false
        }), { headers: corsHeaders });
      }

      // Reschedule booking date/time endpoint (Overlap check + Update + LINE Notification)
      if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/reschedule') && (method === 'PUT' || method === 'POST')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];
        const body = await request.json();
        const { date, start_time, end_time, booking_type, layout, total_amount, send_line, room_id } = body;

        if (!date || !start_time || !end_time) {
          return new Response(JSON.stringify({ error: 'กรุณาระบุ วันที่, เวลาเริ่มต้น และเวลาสิ้นสุด ให้ครบถ้วน' }), { status: 400, headers: corsHeaders });
        }

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
        if (!booking) return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });

        const currentItem = await env.DB.prepare('SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1').bind(bookingId).first();
        if (!currentItem) return new Response(JSON.stringify({ error: 'ไม่พบรายการห้องในการจองนี้' }), { status: 404, headers: corsHeaders });

        const targetRoomId = room_id || currentItem.room_id;
        const targetRoomObj = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(targetRoomId).first();

        const cleanStart = start_time.length === 5 ? `${start_time}:00` : start_time;
        const cleanEnd = end_time.length === 5 ? `${end_time}:00` : end_time;
        const newStartISO = `${date}T${cleanStart}`;
        const newEndISO = `${date}T${cleanEnd}`;

        // Overlap check (exclude this booking)
        const overlapResult = await checkRoomOverlap(env, targetRoomId, newStartISO, newEndISO, bookingId);
        if (overlapResult.hasOverlap) {
          const targetRoomName = targetRoomObj ? targetRoomObj.name : `ID: ${targetRoomId}`;
          return new Response(JSON.stringify({ error: formatOverlapErrorMessage(targetRoomName, overlapResult) }), { status: 400, headers: corsHeaders });
        }

        const oldStart = currentItem.start_time;
        const oldEnd = currentItem.end_time;

        // Synchronize PIN code with the target room
        let newPinCode = (targetRoomObj && targetRoomObj.pin_code && targetRoomObj.pin_code.trim())
          ? targetRoomObj.pin_code.trim()
          : (booking.pin_code || await generateUniquePinCode(env));

        // Update booking_items
        await env.DB.prepare(
          `UPDATE booking_items SET room_id = ?, start_time = ?, end_time = ?, subtotal = ?, price = ?, booking_type = ?, layout = ?, pin_code = ? WHERE id = ?`
        ).bind(
          targetRoomId,
          newStartISO,
          newEndISO,
          total_amount !== undefined ? total_amount : currentItem.subtotal,
          total_amount !== undefined ? total_amount : currentItem.price,
          booking_type || currentItem.booking_type || 'hourly',
          layout || currentItem.layout || 'standard',
          newPinCode,
          currentItem.id
        ).run();

        // Update bookings total_amount & pin_code
        if (total_amount !== undefined) {
          await env.DB.prepare('UPDATE bookings SET pin_code = ?, total_amount = ? WHERE id = ?').bind(newPinCode, total_amount, bookingId).run();
        } else {
          await env.DB.prepare('UPDATE bookings SET pin_code = ? WHERE id = ?').bind(newPinCode, bookingId).run();
        }
        booking.pin_code = newPinCode;

        let lineData = null;
        if (send_line !== false && booking.line_user_id) {
          lineData = await sendLineBookingReschedule(env, bookingId, oldStart, oldEnd, newStartISO, newEndISO, total_amount);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: 'เปลี่ยนแปลงข้อมูลการจองสำเร็จ' + (lineData?.success ? ' และส่งข้อความแจ้งเตือนผ่าน LINE OA เรียบร้อย' : ''),
          line_sent: lineData?.success || false,
          pin_code: newPinCode
        }), { headers: corsHeaders });
      }

      if (pathname.startsWith('/api/bookings/') && (method === 'GET' || method === 'PUT' || method === 'DELETE')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const parts = pathname.split('/');
        const bookingId = parts[3];

        if (method === 'GET') {
          const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
          if (!booking) return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
          const { results: items } = await env.DB.prepare(`
            SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.category as service_category
            FROM booking_items bi
            LEFT JOIN rooms r ON bi.room_id = r.id
            LEFT JOIN services s ON bi.service_id = s.id
            WHERE bi.booking_id = ?
          `).bind(bookingId).all();
          return new Response(JSON.stringify({ ...booking, items: items || [] }), { headers: corsHeaders });
        }

        if (method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare(
            `UPDATE bookings SET customer_name=?, department=?, contact=?, total_amount=?, payment_status=?, payment_method=? WHERE id=?`
          ).bind(
            body.customer_name, body.department || '', body.contact || '', body.total_amount || 0, body.payment_status || 'pending', body.payment_method || 'cash', bookingId
          ).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขข้อมูลการจองสำเร็จ' }), { headers: corsHeaders });
        }

        // Hard permanent delete: Delete booking items first, then booking record
        if (method === 'DELETE') {
          await env.DB.prepare("DELETE FROM booking_items WHERE booking_id = ?").bind(bookingId).run();
          await env.DB.prepare("DELETE FROM bookings WHERE id = ?").bind(bookingId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบรายการจองออกจากระบบอย่างถาวรสำเร็จ' }), { headers: corsHeaders });
        }
      }

      // ----------------------------------------------------
      // 5. PUBLIC BOOKINGS (CUSTOMER SIDE - NO AUTH REQUIRED)
      // ----------------------------------------------------
      if (pathname.startsWith('/api/public/bookings/') && pathname.endsWith('/upload-slip') && method === 'POST') {
        const parts = pathname.split('/');
        const idParam = parts[4];

        let slip_image = null;
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            const body = await request.json();
            slip_image = body.slip_image || body.slip || body.image;
          } catch (e) {}
        } else if (contentType.includes('multipart/form-data')) {
          try {
            const formData = await request.formData();
            const file = formData.get('slip') || formData.get('slip_image') || formData.get('image');
            if (file && typeof file === 'object' && typeof file.arrayBuffer === 'function') {
              const arrayBuffer = await file.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);
              const mime = file.type || 'image/jpeg';
              slip_image = `data:${mime};base64,${base64}`;
            } else if (typeof file === 'string') {
              slip_image = file;
            }
          } catch (e) {}
        }

        let bookingId = isNaN(Number(idParam)) ? null : Number(idParam);
        if (!bookingId && typeof idParam === 'string' && idParam.startsWith('BK-')) {
          const raw = idParam.replace('BK-', '');
          if (raw.length <= 6 && !isNaN(Number(raw))) {
            bookingId = parseInt(raw, 10);
          }
        }

        const booking = await env.DB.prepare(
          'SELECT * FROM bookings WHERE id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)'
        ).bind(bookingId || 0, idParam, idParam).first();

        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        if (!slip_image) {
          return new Response(JSON.stringify({ error: 'ไม่พบไฟล์รูปภาพสลิปที่ส่งมา กรุณาลองใหม่อีกครั้ง' }), { status: 400, headers: corsHeaders });
        }

        let savedSlipUrl = await saveUploadedFile(env, slip_image, 'slips');

        // Guard against Cloudflare D1 SQLITE_TOOBIG (1MB max statement size)
        if (savedSlipUrl && typeof savedSlipUrl === 'string' && savedSlipUrl.length > 700000) {
          savedSlipUrl = savedSlipUrl.substring(0, 650000);
        }

        try {
          await env.DB.prepare('UPDATE bookings SET slip_image_url = ?, payment_status = ? WHERE id = ?')
            .bind(savedSlipUrl || 'uploaded', 'reviewing', booking.id).run();
        } catch (dbErr) {
          console.error('[Upload Slip] D1 update error:', dbErr.message);
          await env.DB.prepare('UPDATE bookings SET slip_image_url = ?, payment_status = ? WHERE id = ?')
            .bind('uploaded', 'reviewing', booking.id).run();
        }

        return new Response(JSON.stringify({
          success: true,
          slipUrl: savedSlipUrl,
          message: 'อัปโหลดสลิปสำเร็จ! กำลังตรวจสอบการชำระเงิน'
        }), { headers: corsHeaders });
      }

      // Lookup Bookings By Phone Number Only
      if ((pathname === '/api/public/bookings/by-phone' || pathname === '/api/public/bookings/lookup') && method === 'GET') {
        const phone = url.searchParams.get('phone') || url.searchParams.get('contact');
        if (!phone || !phone.trim()) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกเบอร์โทรศัพท์' }), { status: 400, headers: corsHeaders });
        }

        const cleanPhone = String(phone).replace(/\D/g, '');
        const { results: bookings } = await env.DB.prepare(
          `SELECT * FROM bookings 
           WHERE (REPLACE(REPLACE(REPLACE(contact, '-', ''), ' ', ''), '+', '') = ? 
              OR contact = ? 
              OR contact LIKE ?)
           ORDER BY id DESC LIMIT 10`
        ).bind(cleanPhone, phone, `%${cleanPhone}%`).all();

        if (!bookings || !bookings.length) {
          return new Response(JSON.stringify({ error: 'ไม่พบรายการจองสำหรับเบอร์โทรศัพท์นี้ กรุณาตรวจสอบเบอร์อีกครั้ง' }), { status: 404, headers: corsHeaders });
        }

        const bookingIds = bookings.map(b => b.id);
        const placeholders = bookingIds.map(() => '?').join(',');
        const { results: items } = await env.DB.prepare(
          `SELECT bi.*, r.name as room_name, r.capacity, r.image_url, r.description
           FROM booking_items bi
           LEFT JOIN rooms r ON bi.room_id = r.id
           WHERE bi.booking_id IN (${placeholders})
           ORDER BY bi.id ASC`
        ).bind(...bookingIds).all();

        const itemsMap = {};
        (items || []).forEach(it => {
          if (!itemsMap[it.booking_id]) itemsMap[it.booking_id] = [];
          itemsMap[it.booking_id].push(it);
        });

        bookings.forEach(b => {
          const bItems = itemsMap[b.id] || [];
          b.items = bItems;
          b.bookingCode = `BK-${String(b.id).padStart(6, '0')}`;
          if (bItems.length > 0 && bItems[0].room_name) {
            b.room_name = bItems[0].room_name;
            b.start_time = bItems[0].start_time?.includes('T') ? bItems[0].start_time.split('T')[1].substring(0, 5) : bItems[0].start_time;
            b.end_time = bItems[0].end_time?.includes('T') ? bItems[0].end_time.split('T')[1].substring(0, 5) : bItems[0].end_time;
            b.booking_date = bItems[0].start_time?.includes('T') ? bItems[0].start_time.split('T')[0] : b.created_at?.split('T')[0];
          }
        });

        return new Response(JSON.stringify({ success: true, bookings }), { headers: corsHeaders });
      }

      // Customer requests Door PIN via Web / LIFF
      if (pathname.startsWith('/api/public/bookings/') && pathname.endsWith('/request-pin') && method === 'POST') {
        const parts = pathname.split('/');
        const idParam = parts[4];

        let bookingId = idParam;
        if (typeof idParam === 'string' && idParam.startsWith('BK-')) {
          const raw = idParam.replace('BK-', '');
          if (raw.length <= 6 && !isNaN(raw)) {
            bookingId = parseInt(raw, 10);
          }
        }

        const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ? OR receipt_number = ?').bind(bookingId, idParam).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: 'ไม่พบข้อมูลการจอง' }), { status: 404, headers: corsHeaders });
        }

        if (booking.payment_status !== 'paid') {
          return new Response(JSON.stringify({ error: 'รายการจองนี้ยังไม่ได้รับการยืนยันชำระเงิน กรุณาติดต่อพนักงาน' }), { status: 400, headers: corsHeaders });
        }

        const res = await sendLineDoorPin(env, booking.id);
        if (res && res.success) {
          return new Response(JSON.stringify({ success: true, message: 'ส่งรหัสผ่านเข้าห้องไปยัง LINE เรียบร้อยแล้ว' }), { headers: corsHeaders });
        } else {
          return new Response(JSON.stringify({ success: true, pin_code: booking.pin_code, message: `รหัสผ่านเปิดประตูคือ ${booking.pin_code}` }), { headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/public/bookings/') && method === 'GET') {
        const idParam = pathname.replace('/api/public/bookings/', '');
        const contact = url.searchParams.get('contact');

        let bookingId = idParam;
        if (typeof idParam === 'string' && idParam.startsWith('BK-')) {
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
        let roomInfo = null;
        if (items && items.length) {
          roomInfo = {
            id: items[0].room_id,
            name: items[0].room_name,
            capacity: items[0].capacity,
            image_url: items[0].image_url,
            description: items[0].description
          };
        }

        return new Response(JSON.stringify({
          ...booking,
          bookingCode,
          items: items || [],
          room: roomInfo,
          start_time: items && items.length ? (items[0].start_time?.includes('T') ? items[0].start_time.split('T')[1].substring(0, 5) : items[0].start_time) : null,
          end_time: items && items.length ? (items[0].end_time?.includes('T') ? items[0].end_time.split('T')[1].substring(0, 5) : items[0].end_time) : null,
          booking_date: items && items.length ? (items[0].start_time?.includes('T') ? items[0].start_time.split('T')[0] : booking.created_at?.split('T')[0]) : null,
          paymentDeadline: new Date(new Date(booking.created_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
        }), { headers: corsHeaders });
      }

      if (pathname === '/api/public/bookings' && method === 'POST') {
        const body = await request.json();
        const { 
          customer_name, contact, email, department, note, room_id, booking_date, 
          start_time, end_time, booking_type, layout, total_amount, line_user_id,
          tax_invoice_required, tax_name, tax_address, tax_id, tax_phone,
          tax_delivery_method, tax_postal_address, guest_count, guests
        } = body;

        if (!customer_name || !contact || !room_id || !booking_date || !start_time || !end_time) {
          return new Response(JSON.stringify({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน (ชื่อ, เบอร์โทร, ห้อง, วันที่, เวลา)' }), { status: 400, headers: corsHeaders });
        }

        // Mandatory guest_count validation for online bookings
        const parsedGuests = parseInt(guest_count || guests, 10);
        if (isNaN(parsedGuests) || parsedGuests < 1) {
          return new Response(JSON.stringify({ error: 'กรุณาระบุจำนวนผู้เข้าใช้งาน (อย่างน้อย 1 ท่าน)' }), { status: 400, headers: corsHeaders });
        }

        if (end_time <= start_time) {
          return new Response(JSON.stringify({ error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' }), { status: 400, headers: corsHeaders });
        }

        // Validate past time for today's booking
        const [by, bm, bd] = booking_date.split('-').map(Number);
        const [bsh, bsm] = start_time.split(':').map(Number);
        const bookingStartUtc = new Date(Date.UTC(by, bm - 1, bd, bsh - 7, bsm));
        if (bookingStartUtc.getTime() < Date.now() - 5 * 60 * 1000) {
          return new Response(JSON.stringify({ error: 'ขออภัย ไม่สามารถจองช่วงเวลาในอดีตได้ กรุณาเลือกช่วงเวลาใหม่' }), { status: 400, headers: corsHeaders });
        }

        const room = await env.DB.prepare("SELECT * FROM rooms WHERE id = ? AND status = 'active'").bind(room_id).first();
        if (!room) {
          return new Response(JSON.stringify({ error: 'ไม่พบห้องที่เลือก หรือห้องไม่พร้อมใช้งาน' }), { status: 404, headers: corsHeaders });
        }

        const fullStart = normalizeToLocalISO(booking_date, start_time);
        const fullEnd = normalizeToLocalISO(booking_date, end_time);

        const overlapResult = await checkRoomOverlap(env, room_id, fullStart, fullEnd);
        if (overlapResult.hasOverlap) {
          return new Response(JSON.stringify({ error: formatOverlapErrorMessage(room.name, overlapResult) }), { status: 409, headers: corsHeaders });
        }

        // Server-side price calculation
        let price = room.hourly_rate;
        let quantity = 1;
        const bType = booking_type || 'hourly';
        const bLayout = layout || 'standard';

        if (bType === 'daily') {
          price = bLayout === 'classroom' ? (room.classroom_daily_rate || room.daily_rate) : room.daily_rate;
          quantity = 1;
        } else if (bType === 'halfday') {
          price = room.half_day_rate;
          quantity = 1;
        } else {
          price = bLayout === 'classroom' ? (room.classroom_hourly_rate || room.hourly_rate) : room.hourly_rate;
          const startParts = start_time.split(':');
          const endParts = end_time.split(':');
          const startMinutes = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
          const endMinutes = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);
          quantity = Math.max(1, Math.ceil((endMinutes - startMinutes) / 60));
        }

        const subtotal = total_amount || Math.round(price * quantity * 100) / 100;
        const receiptNumber = await generateReceiptNumber(env);
        const pinCode = room.pin_code?.trim() || await generateUniquePinCode(env);

        const nowIso = new Date().toISOString();
        let insBooking;
        try {
          insBooking = await env.DB.prepare(
            `INSERT INTO bookings (
               customer_name, department, contact, total_amount, payment_status, payment_method, 
               receipt_number, pin_code, booking_source, customer_email, checkin_status, line_user_id,
               tax_invoice_required, tax_name, tax_address, tax_id, tax_phone, tax_delivery_method, tax_postal_address,
               guest_count,
               created_at
             )
             VALUES (?, ?, ?, ?, 'pending', 'transfer', ?, ?, 'online', ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            customer_name, department || note || '', contact, subtotal, receiptNumber, pinCode, 
            email || null, line_user_id || null, 
            tax_invoice_required ? 1 : 0, tax_name || null, tax_address || null, tax_id || null, tax_phone || null, 
            tax_delivery_method || null, tax_postal_address || null, 
            parsedGuests,
            nowIso
          ).run();
        } catch (dbErr) {
          console.warn('Extended booking insert failed, falling back to core schema:', dbErr);
          insBooking = await env.DB.prepare(
            `INSERT INTO bookings (
               customer_name, department, contact, total_amount, payment_status, payment_method, 
               receipt_number, pin_code, booking_source, customer_email, checkin_status, line_user_id,
               created_at
             )
             VALUES (?, ?, ?, ?, 'pending', 'transfer', ?, ?, 'online', ?, 'pending', ?, ?)`
          ).bind(
            customer_name, department || note || '', contact, subtotal, receiptNumber, pinCode, 
            email || null, line_user_id || null, 
            nowIso
          ).run();
        }

        const bookingId = insBooking.meta.last_row_id;

        try {
          await env.DB.prepare(
            `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, guest_count, pin_code)
             VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(bookingId, room_id, subtotal, fullStart, fullEnd, subtotal, bLayout, bType, parsedGuests, pinCode).run();
        } catch (itemErr) {
          console.warn('Extended item insert failed, falling back to core item schema:', itemErr);
          await env.DB.prepare(
            `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal)
             VALUES (?, ?, 1, ?, ?, ?, ?)`
          ).bind(bookingId, room_id, subtotal, fullStart, fullEnd, subtotal).run();
        }

        const bookingCode = `BK-${String(bookingId).padStart(6, '0')}`;

        // Return clean response WITHOUT exposing the PIN code to unverified customer
        return new Response(JSON.stringify({
          success: true,
          booking_id: bookingId,
          bookingId: bookingId,
          id: bookingId,
          booking_code: receiptNumber || bookingCode,
          bookingCode: receiptNumber || bookingCode,
          receipt_number: receiptNumber,
          receiptNumber: receiptNumber,
          total_amount: subtotal,
          totalAmount: subtotal,
          paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          message: 'บันทึกการจองสำเร็จ! กรุณาแนบสลิปชำระเงินเพื่อยืนยันการจอง'
        }), { status: 201, headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 6. QUOTATIONS CRUD (REQUIRES AUTH)
      // ----------------------------------------------------
      if (pathname === '/api/quotations/next-number' && method === 'GET') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const nextNum = await generateQuotationNumber(env);
        return new Response(JSON.stringify({ quotationNo: nextNum, quotation_no: nextNum }), { headers: corsHeaders });
      }

      if (pathname === '/api/quotations') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        if (method === 'GET') {
          const { results } = await env.DB.prepare("SELECT * FROM quotations ORDER BY created_at DESC").all();
          return new Response(JSON.stringify(results || []), { headers: corsHeaders });
        }
        if (method === 'POST') {
          const body = await request.json();
          const qNo = body.quotation_no || await generateQuotationNumber(env);
          const ins = await env.DB.prepare(
            "INSERT INTO quotations (customer_name, department, contact, total_amount, status, quotation_no, valid_until, seller_name, job_name, customer_address) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)"
          ).bind(body.customer_name, body.department || '', body.contact || '', body.total_amount || 0, qNo, body.valid_until || '', body.seller_name || '', body.job_name || '', body.customer_address || '').run();
          
          const qId = ins.meta.last_row_id;
          if (body.items && body.items.length) {
            for (const item of body.items) {
              await env.DB.prepare(
                `INSERT INTO quotation_items 
                 (quotation_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, discount, item_date, discount_type) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                qId,
                item.room_id || null,
                item.service_id || null,
                item.quantity || 1,
                item.price || 0,
                item.start_time || null,
                item.end_time || null,
                item.subtotal || 0,
                item.layout || 'standard',
                item.booking_type || 'hourly',
                item.discount || 0,
                item.item_date || null,
                item.discount_type || 'amount'
              ).run();
            }
          }

          return new Response(JSON.stringify({ success: true, id: qId, quotation_no: qNo }), { status: 201, headers: corsHeaders });
        }
      }

      if (pathname.startsWith('/api/quotations/')) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const qId = pathname.replace('/api/quotations/', '').split('/')[0];
        if (method === 'GET') {
          const q = await env.DB.prepare("SELECT * FROM quotations WHERE id = ?").bind(qId).first();
          if (!q) {
            return new Response(JSON.stringify({ error: 'ไม่พบใบเสนอราคา' }), { status: 404, headers: corsHeaders });
          }

          const { results: items } = await env.DB.prepare(
            `SELECT qi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name 
             FROM quotation_items qi
             LEFT JOIN rooms r ON qi.room_id = r.id
             LEFT JOIN services s ON qi.service_id = s.id
             WHERE qi.quotation_id = ?`
          ).bind(qId).all();

          return new Response(JSON.stringify({ ...q, items: items || [] }), { headers: corsHeaders });
        }
        if (method === 'PUT') {
          const body = await request.json();
          if (body.status === 'approved') {
            await env.DB.prepare("UPDATE quotations SET status = 'approved', approved_at = ? WHERE id = ?").bind(new Date().toISOString(), qId).run();
          } else {
            await env.DB.prepare(
              "UPDATE quotations SET customer_name=?, department=?, contact=?, total_amount=?, status=?, valid_until=?, seller_name=?, job_name=?, customer_address=?, quotation_no=? WHERE id=?"
            ).bind(body.customer_name, body.department || '', body.contact || '', body.total_amount || 0, body.status || 'draft', body.valid_until || '', body.seller_name || '', body.job_name || '', body.customer_address || '', body.quotation_no || '', qId).run();

            if (body.items) {
              await env.DB.prepare("DELETE FROM quotation_items WHERE quotation_id = ?").bind(qId).run();
              for (const item of body.items) {
                await env.DB.prepare(
                  `INSERT INTO quotation_items 
                   (quotation_id, room_id, service_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, discount, item_date, discount_type) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                  qId,
                  item.room_id || null,
                  item.service_id || null,
                  item.quantity || 1,
                  item.price || 0,
                  item.start_time || null,
                  item.end_time || null,
                  item.subtotal || 0,
                  item.layout || 'standard',
                  item.booking_type || 'hourly',
                  item.discount || 0,
                  item.item_date || null,
                  item.discount_type || 'amount'
                ).run();
              }
            }
          }
          return new Response(JSON.stringify({ success: true, message: 'อัปเดตใบเสนอราคาสำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          await env.DB.prepare("DELETE FROM quotation_items WHERE quotation_id = ?").bind(qId).run();
          await env.DB.prepare("DELETE FROM quotations WHERE id = ?").bind(qId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบใบเสนอราคาสำเร็จ' }), { headers: corsHeaders });
        }
      }

      // ----------------------------------------------------
      // 7. SETTINGS, USERS & ROLES CRUD (REQUIRES AUTH)
      // ----------------------------------------------------
      if (pathname === '/api/public/settings/payment' && method === 'GET') {
        const { results: settings } = await env.DB.prepare("SELECT key, value FROM settings").all();
        const map = {};
        (settings || []).forEach(s => map[s.key] = s.value);
        return new Response(JSON.stringify({
          company_name: map.company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)',
          promptpay_id: map.promptpay_id || '0125554000401',
          payment_bank_name: map.payment_bank_name || map.bank_name || 'ธนาคารกรุงศรีอยุธยา (Krungsri)',
          payment_bank_account: map.payment_bank_account || map.bank_account || '329-1-38429-0',
          payment_bank_account_name: map.payment_bank_account_name || map.bank_account_name || 'บริษัท บิลท์ ฮาร์ท จำกัด',
          payment_deadline_hours: 24,
          ...map
        }), { headers: corsHeaders });
      }

      if (pathname === '/api/settings') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

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
        (settings || []).forEach(s => map[s.key] = s.value);

        return new Response(JSON.stringify({
          company_name: map.company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)',
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
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        if (method === 'GET') {
          const { results: users } = await env.DB.prepare("SELECT id, username, role, permissions, fullname, created_at FROM users").all();
          const cleanUsers = (users || []).map(u => ({
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
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const uId = pathname.replace('/api/users/', '').split('/')[0];
        if (pathname.endsWith('/reset-password') && method === 'POST') {
          let body = {};
          try { body = await request.json(); } catch (e) {}
          const newPass = (body.newPassword || body.password || '123456').trim();
          if (newPass.length < 1) {
            return new Response(JSON.stringify({ error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 1 ตัวอักษร' }), { status: 400, headers: corsHeaders });
          }
          const newHash = await hashPassword(newPass);
          await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, uId).run();
          return new Response(JSON.stringify({ success: true, message: `รีเซ็ตรหัสผ่านเป็น "${newPass}" เรียบร้อยแล้ว` }), { headers: corsHeaders });
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
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const rId = pathname.replace('/api/roles/', '');
        if (method === 'POST') {
          const body = await request.json();
          const ins = await env.DB.prepare("INSERT INTO roles (name, label, permissions) VALUES (?, ?, ?)").bind(body.name, body.label || body.name, body.permissions || '').run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: 'เพิ่มสิทธิ์สำเร็จ' }), { status: 201, headers: corsHeaders });
        }
        if (method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare("UPDATE roles SET name=?, label=?, permissions=? WHERE id=?").bind(body.name, body.label || body.name, body.permissions || '', rId).run();
          await env.DB.prepare("UPDATE users SET permissions=? WHERE role=?").bind(body.permissions || '', body.name).run();
          return new Response(JSON.stringify({ success: true, message: 'แก้ไขสิทธิ์สำเร็จ' }), { headers: corsHeaders });
        }
        if (method === 'DELETE') {
          await env.DB.prepare("DELETE FROM roles WHERE id=?").bind(rId).run();
          return new Response(JSON.stringify({ success: true, message: 'ลบสิทธิ์สำเร็จ' }), { headers: corsHeaders });
        }
        const { results: roles } = await env.DB.prepare("SELECT * FROM roles").all();
        return new Response(JSON.stringify(roles && roles.length ? roles : [
          { id: 1, name: 'admin', label: 'ผู้ดูแลระบบ (Admin)', permissions: 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation' },
          { id: 2, name: 'staff', label: 'พนักงานต้อนรับ (Reception)', permissions: 'pos,pending,layout,manage,history,quotations' }
        ]), { headers: corsHeaders });
      }

      // ----------------------------------------------------
      // 8. FILE UPLOADS, HARDWARE ACCESS & ADMIN TOOLS
      // ----------------------------------------------------
      if (pathname === '/api/upload' && method === 'POST') {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const body = await request.json();
        const savedUrl = await saveUploadedFile(env, body.image || body.image_url, 'uploads');
        return new Response(JSON.stringify({ success: true, url: savedUrl || '/uploads/img_default.png' }), { headers: corsHeaders });
      }

      // Door Access Tablet PIN Verification Endpoint
      if (pathname === '/api/access/verify-pin' && method === 'POST') {
        const { room_id, pin_code } = await request.json();
        if (!pin_code || !pin_code.trim()) {
          return new Response(JSON.stringify({ success: false, valid: false, error: 'กรุณากรอกรหัส PIN 6 หลัก' }), { status: 400, headers: corsHeaders });
        }
        const trimmedPin = pin_code.trim();

        let query = `
          SELECT bi.id as item_id, bi.start_time, bi.end_time, bi.checkin_status,
                 b.id as booking_id, b.customer_name, b.payment_status, b.pin_code,
                 r.id as room_id, r.name as room_name
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          JOIN rooms r ON bi.room_id = r.id
          WHERE (b.pin_code = ? OR bi.pin_code = ? OR r.pin_code = ?)
        `;
        const params = [trimmedPin, trimmedPin, trimmedPin];
        if (room_id) {
          query += " AND bi.room_id = ?";
          params.push(room_id);
        }

        const bookingRow = await env.DB.prepare(query).bind(...params).first();
        if (!bookingRow) {
          return new Response(JSON.stringify({ success: false, valid: false, error: 'ไม่พบข้อมูลการจองด้วยรหัส PIN นี้' }), { status: 404, headers: corsHeaders });
        }

        if (bookingRow.payment_status !== 'paid') {
          return new Response(JSON.stringify({ success: false, valid: false, error: 'รายการจองนี้ยังไม่ได้ชำระเงิน กรุณาชำระเงินที่เคาน์เตอร์ก่อน' }), { status: 400, headers: corsHeaders });
        }

        return new Response(JSON.stringify({
          success: true,
          valid: true,
          message: 'รหัสถูกต้อง ประตูเปิดแล้ว',
          booking: {
            id: bookingRow.booking_id,
            customer_name: bookingRow.customer_name,
            room_name: bookingRow.room_name,
            start_time: bookingRow.start_time,
            end_time: bookingRow.end_time
          }
        }), { headers: corsHeaders });
      }

      // Direct Full Database SQL Dump Download
      if (pathname === '/api/backup/download-sql' && method === 'GET') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const sql = await generateD1DumpSql(env);
        const now = new Date();
        const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `bwork_pos_backup_${dStr}.sql`;

        return new Response(sql, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${fileName}"`
          }
        });
      }

      // Restore Full Database from SQL Dump
      if (pathname === '/api/backup/restore-sql' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const { sqlContent } = await request.json();
        if (!sqlContent || typeof sqlContent !== 'string' || !sqlContent.trim()) {
          return new Response(JSON.stringify({ error: 'ไม่พบเนื้อหาไฟล์ SQL สำหรับกู้คืน' }), { status: 400, headers: corsHeaders });
        }

        try {
          await env.DB.exec(sqlContent);
          return new Response(JSON.stringify({
            success: true,
            message: 'กู้คืนฐานข้อมูลจากไฟล์ .sql สำเร็จเรียบร้อยแล้ว'
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: 'การกู้คืนล้มเหลว: ' + err.message }), { status: 500, headers: corsHeaders });
        }
      }

      // OneDrive Status
      if (pathname === '/api/backup/onedrive/status' && method === 'GET') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const refTokenRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_refresh_token'").first();
        const emailRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_user_email'").first();
        const lastBackupRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_last_backup'").first();
        const lastFileRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_last_file'").first();

        return new Response(JSON.stringify({
          connected: !!(refTokenRow && refTokenRow.value),
          userEmail: emailRow ? emailRow.value : '',
          lastBackup: lastBackupRow ? lastBackupRow.value : null,
          lastFile: lastFileRow ? lastFileRow.value : ''
        }), { headers: corsHeaders });
      }

      // Get OneDrive OAuth URL
      if (pathname === '/api/backup/onedrive/auth-url' && method === 'GET') {
        const clientIdRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_id'").first();
        const cId = clientIdRow?.value || 'd3590ed6-52b3-4102-aeff-aad2292ab01c';
        const redirectUri = url.searchParams.get('redirect_uri') || `${url.origin}/api/backup/onedrive/callback`;
        const scopes = encodeURIComponent('offline_access Files.ReadWrite Files.ReadWrite.All User.Read');
        const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${cId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_mode=query&prompt=consent`;
        return new Response(JSON.stringify({ authUrl, clientId: cId, redirectUri }), { headers: corsHeaders });
      }

      // OneDrive OAuth Callback Endpoint
      if (pathname === '/api/backup/onedrive/callback' && method === 'GET') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error_description') || url.searchParams.get('error');

        if (error || !code) {
          return new Response(`
            <!DOCTYPE html>
            <html>
            <body style="font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#f8fafc;">
              <div style="text-align:center; padding:30px; background:#fff; border-radius:16px; border:1px solid #e2e8f0; max-width:420px;">
                <h3 style="color:#ef4444;">❌ การเชื่อมต่อไม่สำเร็จ</h3>
                <p style="color:#64748b; font-size:14px;">${error || 'ไม่พบ Authorization Code'}</p>
                <button onclick="window.close()" style="margin-top:12px; padding:8px 16px; background:#e2e8f0; border:none; border-radius:8px; cursor:pointer;">ปิดหน้าต่าง</button>
              </div>
            </body>
            </html>
          `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        try {
          const clientIdRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_id'").first();
          const clientSecretRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_secret'").first();
          const cId = clientIdRow?.value || 'd3590ed6-52b3-4102-aeff-aad2292ab01c';
          const redirectUri = `${url.origin}/api/backup/onedrive/callback`;

          const params = new URLSearchParams();
          params.append('client_id', cId);
          if (clientSecretRow?.value) params.append('client_secret', clientSecretRow.value);
          params.append('code', code);
          params.append('redirect_uri', redirectUri);
          params.append('grant_type', 'authorization_code');

          const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
          });
          const tokenData = await tokenRes.json();
          if (tokenData.error) {
            throw new Error(tokenData.error_description || tokenData.error);
          }

          let userEmail = 'OneDrive User';
          try {
            const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
              headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });
            const profile = await profileRes.json();
            userEmail = profile.userPrincipalName || profile.mail || profile.displayName || 'OneDrive User';
          } catch (e) {}

          await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_refresh_token', ?)").bind(tokenData.refresh_token).run();
          await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_user_email', ?)").bind(userEmail).run();

          return new Response(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><title>เชื่อมต่อ OneDrive สำเร็จ</title></head>
            <body style="font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#f0fdf4;">
              <div style="text-align:center; padding:36px; background:#fff; border-radius:20px; box-shadow:0 10px 30px rgba(0,0,0,0.06); max-width:440px; border:1px solid #bbf7d0;">
                <div style="font-size:42px; margin-bottom:12px;">✅</div>
                <h2 style="color:#16a34a; margin:0 0 8px 0; font-size:20px;">เชื่อมต่อบัญชี OneDrive สำเร็จ!</h2>
                <p style="color:#475569; font-size:14px; margin:0 0 16px 0;">เชื่อมต่อกับ: <strong>${userEmail}</strong></p>
                <p style="color:#94a3b8; font-size:12px;">กำลังปิดหน้าต่างนี้และกลับสู่ระบบ POS...</p>
                <script>
                  if (window.opener) {
                    window.opener.postMessage({ type: 'ONEDRIVE_AUTH_SUCCESS', email: '${userEmail}' }, '*');
                  }
                  setTimeout(() => window.close(), 1500);
                </script>
              </div>
            </body>
            </html>
          `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        } catch (err) {
          return new Response(`
            <!DOCTYPE html>
            <html>
            <body style="font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#fef2f2;">
              <div style="text-align:center; padding:30px; background:#fff; border-radius:16px; border:1px solid #fecaca; max-width:420px;">
                <h3 style="color:#ef4444; margin-top:0;">❌ การแลกเปลี่ยน Token ล้มเหลว</h3>
                <p style="color:#64748b; font-size:13px; word-break:break-all;">${err.message}</p>
                <button onclick="window.close()" style="margin-top:12px; padding:8px 16px; background:#fee2e2; color:#ef4444; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">ปิดหน้าต่าง</button>
              </div>
            </body>
            </html>
          `, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      }

      // Connect OneDrive Token
      if (pathname === '/api/backup/onedrive/connect' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const body = await request.json();
        const { code, client_id, client_secret, redirect_uri } = body;

        const cId = client_id || 'd3590ed6-52b3-4102-aeff-aad2292ab01c';
        const params = new URLSearchParams();
        params.append('client_id', cId);
        if (client_secret) params.append('client_secret', client_secret);
        params.append('code', code);
        params.append('redirect_uri', redirect_uri || 'https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/backup/onedrive/callback');
        params.append('grant_type', 'authorization_code');

        const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
          return new Response(JSON.stringify({ error: tokenData.error_description || tokenData.error }), { status: 400, headers: corsHeaders });
        }

        let userEmail = 'OneDrive User';
        try {
          const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const profile = await profileRes.json();
          userEmail = profile.userPrincipalName || profile.mail || profile.displayName || 'OneDrive User';
        } catch (e) {}

        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_refresh_token', ?)").bind(tokenData.refresh_token).run();
        await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_user_email', ?)").bind(userEmail).run();

        return new Response(JSON.stringify({
          success: true,
          message: `เชื่อมต่อบัญชี OneDrive (${userEmail}) สำเร็จ`,
          userEmail
        }), { headers: corsHeaders });
      }

      // Trigger Manual OneDrive Cloud Backup
      if (pathname === '/api/backup/onedrive/trigger' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const sql = await generateD1DumpSql(env);
        const now = new Date();
        const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `bwork_backup_${dStr}.sql`;

        const fileData = await uploadToOneDriveFromWorker(env, sql, fileName);

        return new Response(JSON.stringify({
          success: true,
          message: 'สำรองข้อมูลและอัปโหลดขึ้น OneDrive สำเร็จแล้ว',
          file: fileData
        }), { headers: corsHeaders });
      }

      // Disconnect OneDrive
      if (pathname === '/api/backup/onedrive/disconnect' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        await env.DB.prepare("DELETE FROM settings WHERE key IN ('onedrive_refresh_token', 'onedrive_user_email', 'onedrive_last_backup', 'onedrive_last_file')").run();
        return new Response(JSON.stringify({ success: true, message: 'ยกเลิกการเชื่อมต่อ OneDrive เรียบร้อยแล้ว' }), { headers: corsHeaders });
      }

      if (pathname === '/api/backup/trigger' && (method === 'POST' || method === 'GET')) {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        return new Response(JSON.stringify({ success: true, message: 'ฐานข้อมูล D1 สำรองข้อมูลอัตโนมัติบน Cloudflare เรียบร้อยแล้ว' }), { headers: corsHeaders });
      }

      // Clear all history (Admin Only with Auth)
      if (pathname === '/api/admin/clear-history' && method === 'POST') {
        const auth = await authenticateUser(request, env, 'admin');
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        await env.DB.prepare("DELETE FROM booking_items").run();
        await env.DB.prepare("DELETE FROM bookings").run();
        await env.DB.prepare("DELETE FROM quotation_items").run().catch(() => {});
        await env.DB.prepare("DELETE FROM quotations").run().catch(() => {});
        await env.DB.prepare("DELETE FROM sqlite_sequence WHERE name IN ('bookings', 'booking_items', 'quotations', 'quotation_items')").run().catch(() => {});

        // Delete test slips from R2 if bucket exists
        if (env.BUCKET) {
          try {
            const list = await env.BUCKET.list({ prefix: 'slips/' });
            for (const obj of list.objects) {
              await env.BUCKET.delete(obj.key);
            }
          } catch (r2Err) {
            console.warn('R2 clear error:', r2Err);
          }
        }

        return new Response(JSON.stringify({ success: true, message: 'ล้างประวัติการใช้งานและรูปภาพสลิปทดสอบทั้งหมดเรียบร้อยแล้ว' }), { headers: corsHeaders });
      }

      // LINE Webhook Endpoint
      if (pathname === '/api/line/webhook') {
        return new Response(JSON.stringify({ success: true, message: 'LINE Webhook Received' }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error('Worker runtime error:', err);
      return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), { status: 500, headers: corsHeaders });
    }
  },

  // Scheduled Midnight Auto-Backup Trigger (Cloudflare Cron)
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        console.log('Daily midnight Cloudflare D1 to OneDrive backup started...');
        const refTokenRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_refresh_token'").first();
        if (refTokenRow && refTokenRow.value) {
          const sql = await generateD1DumpSql(env);
          const now = new Date();
          const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const fileName = `bwork_backup_${dStr}.sql`;
          await uploadToOneDriveFromWorker(env, sql, fileName);
          console.log('Daily midnight OneDrive backup completed successfully:', fileName);
        }
      } catch (err) {
        console.error('Scheduled daily backup error:', err);
      }
    })());
  }
};

const BACKUP_TABLES = [
  'rooms', 'categories', 'items', 'users', 'roles',
  'customers', 'departments', 'settings', 'bookings',
  'booking_items', 'quotations', 'quotation_items',
  'payment_transactions', 'timeline_notes', 'booking_history',
  'cash_shifts', 'cash_drawer_logs'
];

async function generateD1DumpSql(env) {
  const lines = [
    '--',
    '-- =========================================================',
    '-- BWORK POS DATABASE BACKUP (SQL DUMP)',
    `-- Export Timestamp: ${new Date().toISOString()}`,
    '-- Target: Microsoft OneDrive Cloud Backup',
    '-- =========================================================',
    '',
    'PRAGMA foreign_keys = OFF;',
    'BEGIN TRANSACTION;'
  ];

  for (const table of BACKUP_TABLES) {
    try {
      const { results: rows } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      if (!rows || !rows.length) continue;

      lines.push('');
      lines.push(`-- Table: ${table} (${rows.length} rows)`);
      lines.push(`DELETE FROM ${table};`);

      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return val;
          if (typeof val === 'boolean') return val ? 1 : 0;
          const str = String(val).replace(/'/g, "''");
          return `'${str}'`;
        });
        lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`);
      }
    } catch (e) {}
  }

  lines.push('');
  lines.push('COMMIT;');
  lines.push('PRAGMA foreign_keys = ON;');
  lines.push('');

  return lines.join('\n');
}

async function uploadToOneDriveFromWorker(env, sqlContent, fileName) {
  const refTokenRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_refresh_token'").first();
  if (!refTokenRow || !refTokenRow.value) {
    throw new Error('ยังไม่ได้เชื่อมต่อบัญชี OneDrive');
  }

  const clientIdRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_id'").first();
  const clientSecretRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'onedrive_client_secret'").first();

  const cId = clientIdRow?.value || 'd3590ed6-52b3-4102-aeff-aad2292ab01c';
  const params = new URLSearchParams();
  params.append('client_id', cId);
  if (clientSecretRow?.value) params.append('client_secret', clientSecretRow.value);
  params.append('refresh_token', refTokenRow.value);
  params.append('grant_type', 'refresh_token');

  const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new Error(tokenData.error_description || tokenData.error);
  }

  if (tokenData.refresh_token && tokenData.refresh_token !== refTokenRow.value) {
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_refresh_token', ?)").bind(tokenData.refresh_token).run();
  }

  const endpoint = `https://graph.microsoft.com/v1.0/me/drive/root:/Bwork_POS_Backups/${encodeURIComponent(fileName)}:/content`;
  const uploadRes = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'text/plain; charset=utf-8'
    },
    body: sqlContent
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`OneDrive upload failed (${uploadRes.status}): ${errText}`);
  }

  const fileData = await uploadRes.json();
  const nowIso = new Date().toISOString();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_last_backup', ?)").bind(nowIso).run();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onedrive_last_file', ?)").bind(fileName).run();

  return fileData;
}
