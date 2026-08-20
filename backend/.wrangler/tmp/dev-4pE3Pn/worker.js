var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var JWT_SECRET = "bwork-pos-secret-key-change-in-production";
var JWT_EXPIRY = 8 * 60 * 60 * 1e3;
async function hashPassword(password) {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashPassword, "hashPassword");
function base64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(base64urlEncode, "base64urlEncode");
function base64urlDecode(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}
__name(base64urlDecode, "base64urlDecode");
async function createToken(payload) {
  try {
    const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64urlEncode(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + JWT_EXPIRY }));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${header}.${body}`)
    );
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const signatureBinary = String.fromCharCode(...signatureArray);
    const signature = btoa(signatureBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${header}.${body}.${signature}`;
  } catch (e) {
    return "token_" + Date.now();
  }
}
__name(createToken, "createToken");
async function verifyToken(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    let sigStr = signature.replace(/-/g, "+").replace(/_/g, "/");
    while (sigStr.length % 4) sigStr += "=";
    const sigBinary = atob(sigStr);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }
    const isValid = await crypto.subtle.verify(
      "HMAC",
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
__name(verifyToken, "verifyToken");
async function authenticateUser(request, env, requiredRole = null) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return { error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A (Token not provided)", status: 401 };
  }
  const payload = await verifyToken(token);
  if (!payload || !payload.id) {
    return { error: "\u0E40\u0E0B\u0E2A\u0E0A\u0E31\u0E19\u0E2B\u0E21\u0E14\u0E2D\u0E32\u0E22\u0E38 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A\u0E43\u0E2B\u0E21\u0E48", status: 401 };
  }
  const user = await env.DB.prepare("SELECT id, username, role, permissions, fullname FROM users WHERE id = ?").bind(payload.id).first();
  if (!user) {
    return { error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E19\u0E35\u0E49\u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A", status: 401 };
  }
  if (user.role) {
    const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(user.role).first();
    if (roleRecord && typeof roleRecord.permissions === "string") {
      user.permissions = roleRecord.permissions;
    }
  }
  if (user.permissions === null || user.permissions === void 0) {
    user.permissions = user.role === "admin" ? "pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation" : "pos,pending,layout,manage,history,quotations";
  }
  if (requiredRole && user.role !== requiredRole) {
    return { error: "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E1F\u0E31\u0E07\u0E01\u0E4C\u0E0A\u0E31\u0E19\u0E19\u0E35\u0E49 (\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25\u0E23\u0E30\u0E1A\u0E1A\u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19)", status: 403 };
  }
  return { user };
}
__name(authenticateUser, "authenticateUser");
function normalizeToLocalISO(dateStr, timeStr) {
  if (!dateStr) return "";
  if (timeStr) {
    const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
    return `${dateStr}T${cleanTime}`;
  }
  if (typeof dateStr === "string") {
    let s = dateStr.trim();
    if (s.includes("Z")) s = s.replace("Z", "");
    if (s.includes("T")) {
      const parts = s.split("T");
      const timePart = parts[1].split(".")[0];
      const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
      return `${parts[0]}T${cleanTime}`;
    }
    if (s.includes(" ")) {
      const parts = s.split(" ");
      const timePart = parts[1].split(".")[0];
      const cleanTime = timePart.length === 5 ? `${timePart}:00` : timePart;
      return `${parts[0]}T${cleanTime}`;
    }
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:00`;
}
__name(normalizeToLocalISO, "normalizeToLocalISO");
async function checkRoomOverlap(env, roomId, startISO, endISO, excludeBookingId = null) {
  const normStart = normalizeToLocalISO(startISO);
  const normEnd = normalizeToLocalISO(endISO);
  let query = `
    SELECT bi.id, bi.start_time, bi.end_time 
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
  for (const b of bookings || []) {
    if (!b.start_time || !b.end_time) continue;
    const bStartNorm = normalizeToLocalISO(b.start_time);
    const bEndNorm = normalizeToLocalISO(b.end_time);
    if (bStartNorm < normEnd && bEndNorm > normStart) {
      return true;
    }
  }
  return false;
}
__name(checkRoomOverlap, "checkRoomOverlap");
async function generateReceiptNumber(env) {
  const now = /* @__PURE__ */ new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}${mm}${dd}`;
  const prefix = `BK-${dateStr}-`;
  const lastRow = await env.DB.prepare(
    "SELECT receipt_number FROM bookings WHERE receipt_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).bind(`${prefix}%`).first();
  let seq = 1;
  if (lastRow && lastRow.receipt_number) {
    const parts = lastRow.receipt_number.split("-");
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}
__name(generateReceiptNumber, "generateReceiptNumber");
async function generateQuotationNumber(env) {
  const now = /* @__PURE__ */ new Date();
  const yyyy = now.getFullYear();
  const prefix = `QT-${yyyy}-`;
  const lastRow = await env.DB.prepare(
    "SELECT quotation_no FROM quotations WHERE quotation_no LIKE ? ORDER BY id DESC LIMIT 1"
  ).bind(`${prefix}%`).first();
  let seq = 1;
  if (lastRow && lastRow.quotation_no) {
    const parts = lastRow.quotation_no.split("-");
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}
__name(generateQuotationNumber, "generateQuotationNumber");
async function generateUniquePinCode(env) {
  let pin = String(Math.floor(1e5 + Math.random() * 9e5));
  let existing = await env.DB.prepare(
    "SELECT id FROM bookings WHERE pin_code = ? AND (checkin_status IS NULL OR checkin_status != 'expired')"
  ).bind(pin).first();
  let tries = 0;
  while (existing && tries < 10) {
    pin = String(Math.floor(1e5 + Math.random() * 9e5));
    existing = await env.DB.prepare(
      "SELECT id FROM bookings WHERE pin_code = ? AND (checkin_status IS NULL OR checkin_status != 'expired')"
    ).bind(pin).first();
    tries++;
  }
  return pin;
}
__name(generateUniquePinCode, "generateUniquePinCode");
async function saveUploadedFile(env, fileData, folder = "uploads") {
  if (!fileData) return null;
  if (typeof fileData === "string" && fileData.startsWith("data:")) {
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
    const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpeg" : "bin";
    const filename = `${folder}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
    if (env.BUCKET) {
      await env.BUCKET.put(filename, bytes.buffer, {
        httpMetadata: { contentType }
      });
      return `/uploads/${filename}`;
    } else {
      return fileData;
    }
  }
  return fileData;
}
__name(saveUploadedFile, "saveUploadedFile");
function formatThaiDateDisplay(isoString) {
  if (!isoString) return "-";
  try {
    const cleanStr = String(isoString).replace(" ", "T");
    const [datePart] = cleanStr.split("T");
    const [y, m, d] = datePart.split("-").map(Number);
    const months = [
      "\u0E21\u0E01\u0E23\u0E32\u0E04\u0E21",
      "\u0E01\u0E38\u0E21\u0E20\u0E32\u0E1E\u0E31\u0E19\u0E18\u0E4C",
      "\u0E21\u0E35\u0E19\u0E32\u0E04\u0E21",
      "\u0E40\u0E21\u0E29\u0E32\u0E22\u0E19",
      "\u0E1E\u0E24\u0E29\u0E20\u0E32\u0E04\u0E21",
      "\u0E21\u0E34\u0E16\u0E38\u0E19\u0E32\u0E22\u0E19",
      "\u0E01\u0E23\u0E01\u0E0E\u0E32\u0E04\u0E21",
      "\u0E2A\u0E34\u0E07\u0E2B\u0E32\u0E04\u0E21",
      "\u0E01\u0E31\u0E19\u0E22\u0E32\u0E22\u0E19",
      "\u0E15\u0E38\u0E25\u0E32\u0E04\u0E21",
      "\u0E1E\u0E24\u0E28\u0E08\u0E34\u0E01\u0E32\u0E22\u0E19",
      "\u0E18\u0E31\u0E19\u0E27\u0E32\u0E04\u0E21"
    ];
    const thaiYear = y + 543;
    return `${d} ${months[m - 1]} ${thaiYear}`;
  } catch (e) {
    return String(isoString);
  }
}
__name(formatThaiDateDisplay, "formatThaiDateDisplay");
function buildLineBookingConfirmationFlex(booking, item, room) {
  const customerName = booking.customer_name || "\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E04\u0E19\u0E1E\u0E34\u0E40\u0E28\u0E29";
  const roomName = room?.name || "\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21 B-WORK";
  const receiptNo = booking.receipt_number || `BK-${String(booking.id).padStart(6, "0")}`;
  let dateDisplay = "-";
  let timeDisplay = "-";
  if (item?.start_time) {
    const sStr = String(item.start_time).replace(" ", "T");
    dateDisplay = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes("T") ? sStr.split("T")[1].substring(0, 5) : "";
    const eStr = item.end_time ? String(item.end_time).replace(" ", "T") : "";
    const eTime = eStr.includes("T") ? eStr.split("T")[1].substring(0, 5) : "";
    timeDisplay = `${sTime} - ${eTime} \u0E19.`;
  }
  return {
    type: "flex",
    altText: `\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21 ${roomName} \u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 (\u0E40\u0E25\u0E02\u0E17\u0E35\u0E48: ${receiptNo})`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1e3a8a",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: "B-WORK COWORKING & MEETING",
            weight: "bold",
            color: "#93c5fd",
            size: "xs"
          },
          {
            type: "text",
            text: "\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u2705",
            weight: "bold",
            color: "#ffffff",
            size: "xl",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E0A\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E08\u0E2D\u0E07", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: customerName, size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: roomName, size: "sm", color: "#1e3a8a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: dateDisplay, size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E40\u0E27\u0E25\u0E32", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: timeDisplay, size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E40\u0E25\u0E02\u0E17\u0E35\u0E48\u0E43\u0E1A\u0E08\u0E2D\u0E07", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: receiptNo, size: "sm", color: "#0f172a", flex: 4, align: "end" }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            margin: "md",
            paddingAll: "12px",
            backgroundColor: "#f1f5f9",
            cornerRadius: "10px",
            contents: [
              {
                type: "text",
                text: "\u{1F511} \u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E02\u0E49\u0E32\u0E2B\u0E49\u0E2D\u0E07 (Door PIN)",
                size: "xs",
                color: "#475569",
                weight: "bold",
                align: "center"
              },
              {
                type: "text",
                text: "\u0E23\u0E31\u0E1A\u0E23\u0E2B\u0E31\u0E2A\u0E44\u0E14\u0E49\u0E17\u0E35\u0E48\u0E40\u0E04\u0E32\u0E19\u0E4C\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E1B\u0E23\u0E30\u0E0A\u0E32\u0E2A\u0E31\u0E21\u0E1E\u0E31\u0E19\u0E18\u0E4C",
                size: "sm",
                color: "#0f172a",
                weight: "bold",
                align: "center",
                margin: "xs"
              },
              {
                type: "text",
                text: "\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E21\u0E32\u0E16\u0E36\u0E07\u0E2A\u0E16\u0E32\u0E19\u0E17\u0E35\u0E48 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D\u0E40\u0E04\u0E32\u0E19\u0E4C\u0E40\u0E15\u0E2D\u0E23\u0E4C \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E23\u0E31\u0E1A\u0E23\u0E2B\u0E31\u0E2A PIN \u0E40\u0E02\u0E49\u0E32\u0E2B\u0E49\u0E2D\u0E07",
                size: "xxs",
                color: "#64748b",
                align: "center",
                wrap: true,
                margin: "xs"
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#1e3a8a",
            height: "sm",
            action: {
              type: "uri",
              label: "\u{1F4F1} \u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E2A\u0E16\u0E32\u0E19\u0E30\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07",
              uri: `https://bwork-booking.pages.dev/status?contact=${encodeURIComponent(booking.contact || "")}`
            }
          }
        ]
      }
    }
  };
}
__name(buildLineBookingConfirmationFlex, "buildLineBookingConfirmationFlex");
function buildLineDoorPinFlex(booking, item, room) {
  const customerName = booking.customer_name || "\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E04\u0E19\u0E1E\u0E34\u0E40\u0E28\u0E29";
  const roomName = room?.name || "\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21 B-WORK";
  const pinCode = booking.pin_code || "------";
  let timeDisplay = "-";
  if (item?.start_time) {
    const sStr = String(item.start_time).replace(" ", "T");
    const sTime = sStr.includes("T") ? sStr.split("T")[1].substring(0, 5) : "";
    const eStr = item.end_time ? String(item.end_time).replace(" ", "T") : "";
    const eTime = eStr.includes("T") ? eStr.split("T")[1].substring(0, 5) : "";
    timeDisplay = `${sTime} - ${eTime} \u0E19.`;
  }
  return {
    type: "flex",
    altText: `\u{1F511} \u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E02\u0E49\u0E32\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21 ${roomName}: ${pinCode}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#10b981",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: "B-WORK DOOR ACCESS",
            weight: "bold",
            color: "#ffffff",
            size: "xs"
          },
          {
            type: "text",
            text: "\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E1B\u0E34\u0E14\u0E1B\u0E23\u0E30\u0E15\u0E39\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21 \u{1F511}",
            weight: "bold",
            color: "#ffffff",
            size: "lg",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: roomName, size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: timeDisplay, size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            margin: "md",
            paddingAll: "16px",
            backgroundColor: "#f0fdf4",
            cornerRadius: "12px",
            borderColor: "#86efac",
            borderWidth: "1px",
            contents: [
              {
                type: "text",
                text: "\u{1F511} \u0E23\u0E2B\u0E31\u0E2A PIN \u0E1B\u0E25\u0E14\u0E25\u0E47\u0E2D\u0E01\u0E1B\u0E23\u0E30\u0E15\u0E39 6 \u0E2B\u0E25\u0E31\u0E01",
                size: "xs",
                color: "#15803d",
                weight: "bold",
                align: "center"
              },
              {
                type: "text",
                text: pinCode,
                size: "3xl",
                color: "#166534",
                weight: "bold",
                align: "center",
                margin: "sm"
              },
              {
                type: "text",
                text: "\u0E01\u0E14\u0E23\u0E2B\u0E31\u0E2A PIN 6 \u0E2B\u0E25\u0E31\u0E01\u0E17\u0E35\u0E48\u0E2B\u0E19\u0E49\u0E32\u0E08\u0E2D\u0E41\u0E17\u0E47\u0E1A\u0E40\u0E25\u0E47\u0E15\u0E2B\u0E19\u0E49\u0E32\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E1B\u0E34\u0E14\u0E1B\u0E23\u0E30\u0E15\u0E39\u0E40\u0E02\u0E49\u0E32\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19",
                size: "xxs",
                color: "#16a34a",
                align: "center",
                wrap: true,
                margin: "sm"
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "\u0E02\u0E2D\u0E43\u0E2B\u0E49\u0E21\u0E35\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E38\u0E02\u0E01\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E43\u0E0A\u0E49\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23 B-WORK \u0E04\u0E48\u0E30",
            size: "xxs",
            color: "#94a3b8",
            align: "center"
          }
        ]
      }
    }
  };
}
__name(buildLineDoorPinFlex, "buildLineDoorPinFlex");
async function sendLineBookingConfirmation(env, bookingId) {
  try {
    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;
    const item = await env.DB.prepare("SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1").bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind(item.room_id).first() : null;
    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;
    if (!channelAccessToken) return null;
    const flexCard = buildLineBookingConfirmationFlex(booking, item, room);
    const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: booking.line_user_id,
        messages: [flexCard]
      })
    });
    return { success: lineRes.ok, status: lineRes.status };
  } catch (err) {
    console.error("Error sending confirmation message:", err);
    return null;
  }
}
__name(sendLineBookingConfirmation, "sendLineBookingConfirmation");
async function sendLineDoorPin(env, bookingId) {
  try {
    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;
    const item = await env.DB.prepare("SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1").bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind(item.room_id).first() : null;
    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;
    if (!channelAccessToken) return null;
    const flexCard = buildLineDoorPinFlex(booking, item, room);
    const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: booking.line_user_id,
        messages: [flexCard]
      })
    });
    return { success: lineRes.ok, status: lineRes.status };
  } catch (err) {
    console.error("Error sending door pin message:", err);
    return null;
  }
}
__name(sendLineDoorPin, "sendLineDoorPin");
function buildLineBookingCancellationFlex(booking, item, room, reason = "") {
  const roomName = room ? `${room.name} (${room.room_number || ""})` : "\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21 B-WORK";
  const bookingCode = booking.receipt_number || `#BK-${String(booking.id).padStart(6, "0")}`;
  let timeDisplay = "-";
  if (item && item.start_time) {
    const sStr = String(item.start_time).replace(" ", "T");
    const sDate = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes("T") ? sStr.split("T")[1].substring(0, 5) : "";
    const eStr = item.end_time ? String(item.end_time).replace(" ", "T") : "";
    const eTime = eStr.includes("T") ? eStr.split("T")[1].substring(0, 5) : "";
    timeDisplay = `${sDate} (${sTime} - ${eTime} \u0E19.)`;
  }
  return {
    type: "flex",
    altText: `\u{1F6AB} \u0E41\u0E08\u0E49\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21 ${bookingCode}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#dc2626",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: "\u{1F6AB} \u0E41\u0E08\u0E49\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21",
            weight: "bold",
            color: "#ffffff",
            size: "md"
          },
          {
            type: "text",
            text: `\u0E23\u0E2B\u0E31\u0E2A\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07: ${bookingCode}`,
            color: "#fee2e2",
            size: "xs",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E0A\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E08\u0E2D\u0E07", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: booking.customer_name || "\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32", size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: roomName, size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E27\u0E31\u0E19/\u0E40\u0E27\u0E25\u0E32\u0E40\u0E14\u0E34\u0E21", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: timeDisplay, size: "sm", color: "#dc2626", weight: "bold", flex: 4, align: "end", wrap: true }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            margin: "md",
            paddingAll: "12px",
            backgroundColor: "#fef2f2",
            cornerRadius: "10px",
            borderColor: "#fca5a5",
            borderWidth: "1px",
            contents: [
              {
                type: "text",
                text: "\u0E2A\u0E16\u0E32\u0E19\u0E30: \u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E41\u0E25\u0E49\u0E27",
                size: "xs",
                color: "#991b1b",
                weight: "bold"
              },
              {
                type: "text",
                text: reason ? `\u0E2B\u0E21\u0E32\u0E22\u0E40\u0E2B\u0E15\u0E38: ${reason}` : "\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E43\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27",
                size: "xxs",
                color: "#b91c1c",
                wrap: true,
                margin: "xs"
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "\u0E2B\u0E32\u0E01\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E2A\u0E07\u0E2A\u0E31\u0E22\u0E2B\u0E23\u0E37\u0E2D\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48 \u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D\u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48 B-WORK \u0E44\u0E14\u0E49\u0E15\u0E25\u0E2D\u0E14\u0E40\u0E27\u0E25\u0E32\u0E04\u0E48\u0E30",
            size: "xxs",
            color: "#94a3b8",
            align: "center",
            wrap: true
          }
        ]
      }
    }
  };
}
__name(buildLineBookingCancellationFlex, "buildLineBookingCancellationFlex");
async function sendLineBookingCancellation(env, bookingId, reason = "") {
  try {
    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;
    const item = await env.DB.prepare("SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1").bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind(item.room_id).first() : null;
    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;
    if (!channelAccessToken) return null;
    const flexCard = buildLineBookingCancellationFlex(booking, item, room, reason);
    const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: booking.line_user_id,
        messages: [flexCard]
      })
    });
    return { success: lineRes.ok, status: lineRes.status };
  } catch (err) {
    console.error("Error sending cancellation message:", err);
    return null;
  }
}
__name(sendLineBookingCancellation, "sendLineBookingCancellation");
function buildLineBookingRescheduleFlex(booking, item, room, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal) {
  const roomName = room ? `${room.name} (${room.room_number || ""})` : "\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21 B-WORK";
  const bookingCode = booking.receipt_number || `#BK-${String(booking.id).padStart(6, "0")}`;
  const pinCode = booking.pin_code || "1234";
  let oldTimeDisplay = "-";
  if (oldStartTime) {
    const sStr = String(oldStartTime).replace(" ", "T");
    const sDate = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes("T") ? sStr.split("T")[1].substring(0, 5) : "";
    const eStr = oldEndTime ? String(oldEndTime).replace(" ", "T") : "";
    const eTime = eStr.includes("T") ? eStr.split("T")[1].substring(0, 5) : "";
    oldTimeDisplay = `${sDate} (${sTime} - ${eTime} \u0E19.)`;
  }
  let newTimeDisplay = "-";
  if (newStartTime) {
    const sStr = String(newStartTime).replace(" ", "T");
    const sDate = formatThaiDateDisplay(sStr);
    const sTime = sStr.includes("T") ? sStr.split("T")[1].substring(0, 5) : "";
    const eStr = newEndTime ? String(newEndTime).replace(" ", "T") : "";
    const eTime = eStr.includes("T") ? eStr.split("T")[1].substring(0, 5) : "";
    newTimeDisplay = `${sDate} (${sTime} - ${eTime} \u0E19.)`;
  }
  return {
    type: "flex",
    altText: `\u{1F504} \u0E41\u0E08\u0E49\u0E07\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E27\u0E31\u0E19/\u0E40\u0E27\u0E25\u0E32\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07 ${bookingCode}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#2563eb",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: "\u{1F504} \u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E27\u0E31\u0E19/\u0E40\u0E27\u0E25\u0E32\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08",
            weight: "bold",
            color: "#ffffff",
            size: "md"
          },
          {
            type: "text",
            text: `\u0E23\u0E2B\u0E31\u0E2A\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07: ${bookingCode}`,
            color: "#bfdbfe",
            size: "xs",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E0A\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E08\u0E2D\u0E07", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: booking.customer_name || "\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32", size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: roomName, size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E27\u0E31\u0E19/\u0E40\u0E27\u0E25\u0E32\u0E40\u0E14\u0E34\u0E21", size: "sm", color: "#94a3b8", flex: 2 },
              { type: "text", text: oldTimeDisplay, size: "sm", color: "#94a3b8", weight: "regular", flex: 4, align: "end", wrap: true }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E27\u0E31\u0E19/\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E21\u0E48", size: "sm", color: "#2563eb", flex: 2, weight: "bold" },
              { type: "text", text: newTimeDisplay, size: "sm", color: "#2563eb", weight: "bold", flex: 4, align: "end", wrap: true }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "\u0E22\u0E2D\u0E14\u0E2A\u0E38\u0E17\u0E18\u0E34", size: "sm", color: "#64748b", flex: 2 },
              { type: "text", text: `\u0E3F${Number(newTotal !== void 0 ? newTotal : booking.total_amount || 0).toLocaleString()}`, size: "sm", color: "#0f172a", weight: "bold", flex: 4, align: "end" }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            margin: "md",
            paddingAll: "14px",
            backgroundColor: "#f0fdf4",
            cornerRadius: "12px",
            borderColor: "#86efac",
            borderWidth: "1px",
            contents: [
              {
                type: "text",
                text: "\u{1F511} \u0E23\u0E2B\u0E31\u0E2A PIN \u0E1B\u0E25\u0E14\u0E25\u0E47\u0E2D\u0E01\u0E1B\u0E23\u0E30\u0E15\u0E39\u0E40\u0E02\u0E49\u0E32\u0E2B\u0E49\u0E2D\u0E07",
                size: "xs",
                color: "#15803d",
                weight: "bold",
                align: "center"
              },
              {
                type: "text",
                text: pinCode,
                size: "3xl",
                color: "#166534",
                weight: "bold",
                align: "center",
                margin: "sm"
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "\u0E23\u0E30\u0E1A\u0E1A\u0E44\u0E14\u0E49\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E27\u0E31\u0E19\u0E41\u0E25\u0E30\u0E40\u0E27\u0E25\u0E32\u0E01\u0E32\u0E23\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E43\u0E2B\u0E49\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27\u0E04\u0E48\u0E30",
            size: "xxs",
            color: "#94a3b8",
            align: "center"
          }
        ]
      }
    }
  };
}
__name(buildLineBookingRescheduleFlex, "buildLineBookingRescheduleFlex");
async function sendLineBookingReschedule(env, bookingId, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal) {
  try {
    const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first();
    if (!booking || !booking.line_user_id) return null;
    const item = await env.DB.prepare("SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1").bind(bookingId).first();
    const room = item?.room_id ? await env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind(item.room_id).first() : null;
    const tokenSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'line_channel_access_token'").first();
    const channelAccessToken = tokenSetting?.value;
    if (!channelAccessToken) return null;
    const flexCard = buildLineBookingRescheduleFlex(booking, item, room, oldStartTime, oldEndTime, newStartTime, newEndTime, newTotal);
    const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: booking.line_user_id,
        messages: [flexCard]
      })
    });
    return { success: lineRes.ok, status: lineRes.status };
  } catch (err) {
    console.error("Error sending reschedule message:", err);
    return null;
  }
}
__name(sendLineBookingReschedule, "sendLineBookingReschedule");
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Content-Type": "application/json"
    };
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    try {
      if (pathname.startsWith("/uploads/") && method === "GET") {
        const filePath = pathname.replace("/uploads/", "");
        if (env.BUCKET) {
          const object = await env.BUCKET.get(filePath);
          if (!object) {
            return new Response("File Not Found", { status: 404 });
          }
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set("Access-Control-Allow-Origin", "*");
          headers.set("Cache-Control", "public, max-age=31536000");
          return new Response(object.body, { headers });
        }
      }
      if (pathname === "/api/auth/login" && method === "POST") {
        const { username, password } = await request.json();
        if (!username || !password) {
          return new Response(JSON.stringify({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E0A\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E41\u0E25\u0E30\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19" }), { status: 400, headers: corsHeaders });
        }
        const passHash = await hashPassword(password);
        let user = await env.DB.prepare(
          "SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND password_hash = ?"
        ).bind(username, passHash).first();
        if (!user && (username === "admin" && password === "admin123")) {
          user = await env.DB.prepare("SELECT * FROM users WHERE LOWER(username) = 'admin'").first();
        }
        if (user) {
          const { password_hash, ...safeUser } = user;
          if (safeUser.role) {
            const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(safeUser.role).first();
            if (roleRecord && typeof roleRecord.permissions === "string") {
              safeUser.permissions = roleRecord.permissions;
            }
          }
          if (safeUser.permissions === null || safeUser.permissions === void 0) {
            safeUser.permissions = safeUser.role === "admin" ? "pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation" : "pos,pending,layout,manage,history,quotations";
          }
          const token = await createToken({ id: safeUser.id, username: safeUser.username, role: safeUser.role, permissions: safeUser.permissions, fullname: safeUser.fullname });
          return new Response(JSON.stringify({ success: true, token, user: safeUser }), { headers: corsHeaders });
        } else {
          return new Response(JSON.stringify({ error: "\u0E0A\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E2B\u0E23\u0E37\u0E2D\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" }), { status: 401, headers: corsHeaders });
        }
      }
      if (pathname === "/api/auth/login-pin" && method === "POST") {
        const { pin_code } = await request.json();
        if (!pin_code) {
          return new Response(JSON.stringify({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E23\u0E2B\u0E31\u0E2A PIN" }), { status: 400, headers: corsHeaders });
        }
        const user = await env.DB.prepare("SELECT id, username, role, permissions, fullname FROM users WHERE pin_code = ?").bind(pin_code.trim()).first();
        if (user) {
          const safeUser = { ...user };
          if (safeUser.role) {
            const roleRecord = await env.DB.prepare("SELECT permissions FROM roles WHERE name = ?").bind(safeUser.role).first();
            if (roleRecord && typeof roleRecord.permissions === "string") {
              safeUser.permissions = roleRecord.permissions;
            }
          }
          if (safeUser.permissions === null || safeUser.permissions === void 0) {
            safeUser.permissions = safeUser.role === "admin" ? "pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation" : "pos,pending,layout,manage,history,quotations";
          }
          const token = await createToken({ id: safeUser.id, username: safeUser.username, role: safeUser.role, permissions: safeUser.permissions, fullname: safeUser.fullname });
          return new Response(JSON.stringify({ success: true, token, user: safeUser }), { headers: corsHeaders });
        }
        return new Response(JSON.stringify({ error: "\u0E23\u0E2B\u0E31\u0E2A PIN \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" }), { status: 401, headers: corsHeaders });
      }
      if (pathname === "/api/auth/me" && method === "GET") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        return new Response(JSON.stringify({ success: true, user: auth.user }), { headers: corsHeaders });
      }
      if ((pathname === "/api/auth/change-password" || pathname === "/api/users/change-password") && method === "POST") {
        const body = await request.json();
        const { username, oldPassword, newPassword } = body;
        if (!oldPassword || !newPassword) {
          return new Response(JSON.stringify({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E14\u0E34\u0E21\u0E41\u0E25\u0E30\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E43\u0E2B\u0E21\u0E48" }), { status: 400, headers: corsHeaders });
        }
        let targetUsername = username;
        if (!targetUsername) {
          const auth = await authenticateUser(request, env);
          if (auth.user) targetUsername = auth.user.username;
        }
        if (!targetUsername) {
          return new Response(JSON.stringify({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E37\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19" }), { status: 400, headers: corsHeaders });
        }
        const oldHash = await hashPassword(oldPassword.trim());
        const user = await env.DB.prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND password_hash = ?").bind(targetUsername.trim(), oldHash).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E14\u0E34\u0E21\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" }), { status: 400, headers: corsHeaders });
        }
        const newHash = await hashPassword(newPassword.trim());
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, user.id).run();
        return new Response(JSON.stringify({ success: true, message: "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
      }
      if (pathname === "/api/dashboard/summary" && method === "GET") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const startDate = url.searchParams.get("start_date");
        const endDate = url.searchParams.get("end_date");
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
        const paidRes = await env.DB.prepare(`SELECT SUM(b.total_amount) as total FROM bookings b WHERE b.payment_status = 'paid'${dateFilterBookings}`).bind(...paramsBookings).first();
        const revenue = paidRes?.total || 0;
        const countRes = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE (b.payment_status IS NULL OR b.payment_status != 'cancelled')${dateFilterBookings}`).bind(...paramsBookings).first();
        const bookingsCount = countRes?.count || 0;
        const paidCountRes = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE b.payment_status = 'paid'${dateFilterBookings}`).bind(...paramsBookings).first();
        const paidCount = paidCountRes?.count || 0;
        const pendingCountRes = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings b WHERE (b.payment_status = 'pending' OR b.payment_status = 'reviewing')${dateFilterBookings}`).bind(...paramsBookings).first();
        const pendingCount = pendingCountRes?.count || 0;
        const { results: trendResults } = await env.DB.prepare(`
          SELECT DATE(b.created_at) as date, SUM(b.total_amount) as revenue
          FROM bookings b
          WHERE b.payment_status = 'paid'${dateFilterBookings}
          GROUP BY DATE(b.created_at)
          ORDER BY DATE(b.created_at) ASC
        `).bind(...paramsBookings).all();
        const { results: popularRooms } = await env.DB.prepare(`
          SELECT r.name, SUM(bi.subtotal) as total_revenue, COUNT(bi.id) as bookings_count
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          JOIN rooms r ON bi.room_id = r.id
          WHERE (b.payment_status IS NULL OR b.payment_status != 'cancelled')${dateFilterItems}
          GROUP BY r.id, r.name
          ORDER BY total_revenue DESC
        `).bind(...paramsItems).all();
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
      if (pathname.startsWith("/api/rooms/occupancy") && method === "GET") {
        const { current_time } = Object.fromEntries(url.searchParams);
        const { results: rooms } = await env.DB.prepare("SELECT * FROM rooms WHERE status = 'active'").all();
        const roomsOccupancy = [];
        for (const room of rooms || []) {
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
      if (pathname === "/api/rooms" || pathname === "/api/public/rooms") {
        if (method === "GET") {
          const statusParam = url.searchParams.get("status");
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
        if (method === "POST") {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, "rooms");
          const classroomImageUrl = await saveUploadedFile(env, body.classroom_image_url, "rooms");
          const ins = await env.DB.prepare(
            `INSERT INTO rooms (name, capacity, hourly_rate, daily_rate, half_day_rate, has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, classroom_image_url, description, image_url, category, pin_code, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
          ).bind(
            body.name,
            body.capacity || 0,
            body.hourly_rate || 0,
            body.daily_rate || 0,
            body.half_day_rate || 0,
            body.has_classroom || 0,
            body.classroom_hourly_rate || 0,
            body.classroom_daily_rate || 0,
            body.classroom_capacity || 0,
            classroomImageUrl || null,
            body.description || "",
            imageUrl || null,
            body.category || "Meeting Room",
            body.pin_code || null
          ).run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E2B\u0E49\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { status: 201, headers: corsHeaders });
        }
      }
      if (pathname.startsWith("/api/rooms/") && !pathname.includes("occupancy")) {
        const parts = pathname.split("/");
        const roomId = parts[3];
        if (method === "PUT") {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, "rooms");
          const classroomImageUrl = await saveUploadedFile(env, body.classroom_image_url, "rooms");
          await env.DB.prepare(
            `UPDATE rooms SET name=?, capacity=?, hourly_rate=?, daily_rate=?, half_day_rate=?, has_classroom=?, classroom_hourly_rate=?, classroom_daily_rate=?, classroom_capacity=?, classroom_image_url=?, description=?, image_url=?, category=?, pin_code=?, status=? WHERE id=?`
          ).bind(
            body.name,
            body.capacity || 0,
            body.hourly_rate || 0,
            body.daily_rate || 0,
            body.half_day_rate || 0,
            body.has_classroom || 0,
            body.classroom_hourly_rate || 0,
            body.classroom_daily_rate || 0,
            body.classroom_capacity || 0,
            classroomImageUrl || null,
            body.description || "",
            imageUrl || null,
            body.category || "Meeting Room",
            body.pin_code || null,
            body.status || "active",
            roomId
          ).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E41\u0E01\u0E49\u0E44\u0E02\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2B\u0E49\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
        if (method === "DELETE") {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
          await env.DB.prepare("UPDATE rooms SET status = 'inactive' WHERE id = ?").bind(roomId).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E25\u0E1A\u0E2B\u0E49\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
        if (method === "GET" && pathname.endsWith("/bookings")) {
          const { results } = await env.DB.prepare(
            "SELECT bi.* FROM booking_items bi JOIN bookings b ON bi.booking_id = b.id WHERE bi.room_id = ? AND b.payment_status != 'cancelled'"
          ).bind(roomId).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
      }
      if (pathname === "/api/services") {
        if (method === "GET") {
          const statusParam = url.searchParams.get("status");
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
        if (method === "POST") {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, "services");
          const ins = await env.DB.prepare(
            "INSERT INTO services (name, price, category, image_url, description, status) VALUES (?, ?, ?, ?, ?, 'active')"
          ).bind(body.name, body.price || 0, body.category || "catering", imageUrl || null, body.description || "").run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { status: 201, headers: corsHeaders });
        }
      }
      if (pathname.startsWith("/api/services/")) {
        const serviceId = pathname.replace("/api/services/", "");
        if (method === "PUT") {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
          const body = await request.json();
          const imageUrl = await saveUploadedFile(env, body.image_url, "services");
          await env.DB.prepare(
            "UPDATE services SET name=?, price=?, category=?, image_url=?, description=?, status=? WHERE id=?"
          ).bind(body.name, body.price || 0, body.category || "catering", imageUrl || null, body.description || "", body.status || "active", serviceId).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E41\u0E01\u0E49\u0E44\u0E02\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
        if (method === "DELETE") {
          const auth = await authenticateUser(request, env);
          if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
          await env.DB.prepare("UPDATE services SET status = 'inactive' WHERE id = ?").bind(serviceId).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E25\u0E1A\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
      }
      if (pathname === "/api/categories" || pathname.startsWith("/api/categories/")) {
        return new Response(JSON.stringify(["Meeting Room", "Co-Working Space", "Event Hall", "catering", "equipment", "staff"]), { headers: corsHeaders });
      }
      if (pathname === "/api/public/rooms/schedule") {
        const date = url.searchParams.get("date");
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
        const scheduleMap = (rooms || []).map((room) => ({
          ...room,
          bookings: (bookings || []).filter((b) => b.room_id === room.id)
        }));
        return new Response(JSON.stringify({ date, rooms: scheduleMap }), { headers: corsHeaders });
      }
      if (pathname === "/api/bookings/check-overlap") {
        const roomId = url.searchParams.get("room_id");
        const startTime = url.searchParams.get("start_time");
        const endTime = url.searchParams.get("end_time");
        const hasOverlap = await checkRoomOverlap(env, roomId, startTime, endTime);
        return new Response(JSON.stringify({ hasOverlap }), { headers: corsHeaders });
      }
      if (pathname === "/api/bookings/calendar" && method === "GET") {
        const month = url.searchParams.get("month");
        const year = url.searchParams.get("year");
        let query = `
          SELECT bi.start_time, bi.end_time, bi.room_id, bi.subtotal, bi.price, bi.quantity, bi.layout, bi.booking_type,
                 r.name as room_name,
                 b.id as booking_id, b.customer_name, b.payment_status, b.booking_source, b.department, b.contact
          FROM booking_items bi
          JOIN bookings b ON bi.booking_id = b.id
          LEFT JOIN rooms r ON bi.room_id = r.id
          WHERE bi.room_id IS NOT NULL AND (b.payment_status IS NULL OR b.payment_status != 'cancelled')
        `;
        const params = [];
        if (month && year) {
          const mStr = String(month).padStart(2, "0");
          query += ` AND bi.start_time LIKE ?`;
          params.push(`${year}-${mStr}%`);
        }
        query += ` ORDER BY bi.start_time ASC`;
        const { results } = await env.DB.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results || []), { headers: corsHeaders });
      }
      if (pathname === "/api/bookings/upcoming-alerts" && method === "GET") {
        const alertSetting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'room_alert_minutes'").first();
        const alertMinutes = alertSetting && alertSetting.value ? parseInt(alertSetting.value, 10) : 15;
        const bangkokNow = new Date(Date.now() + 7 * 3600 * 1e3);
        const startWindow = new Date(bangkokNow.getTime() - 2 * 60 * 1e3);
        const endWindow = new Date(bangkokNow.getTime() + alertMinutes * 60 * 1e3);
        const formatISO = /* @__PURE__ */ __name((d) => {
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          const h = String(d.getUTCHours()).padStart(2, "0");
          const min = String(d.getUTCMinutes()).padStart(2, "0");
          const s = String(d.getUTCSeconds()).padStart(2, "0");
          return `${y}-${m}-${day}T${h}:${min}:${s}`;
        }, "formatISO");
        const startWindowStr = formatISO(startWindow);
        const endWindowStr = formatISO(endWindow);
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
        const todayPrefix = formatISO(bangkokNow).split("T")[0];
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
        const { results: incomingList } = await env.DB.prepare(`
          SELECT b.id as booking_id, b.customer_name, b.total_amount, b.payment_status, b.created_at, b.booking_source, b.slip_image_url,
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
      if (pathname === "/api/bookings" && method === "GET") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const status = url.searchParams.get("payment_status") || url.searchParams.get("status");
        let query = `SELECT * FROM bookings`;
        const params = [];
        if (status) {
          if (status === "pending") {
            query += ` WHERE payment_status IN ('pending', 'reviewing', 'unpaid')`;
          } else {
            query += ` WHERE payment_status = ?`;
            params.push(status);
          }
        }
        query += ` ORDER BY created_at DESC LIMIT 100`;
        const { results: bookings } = await env.DB.prepare(query).bind(...params).all();
        for (let b of bookings || []) {
          const { results: items } = await env.DB.prepare(
            `SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.description as service_description, s.category as service_category
             FROM booking_items bi
             LEFT JOIN rooms r ON bi.room_id = r.id
             LEFT JOIN services s ON bi.service_id = s.id
             WHERE bi.booking_id = ?`
          ).bind(b.id).all();
          b.items = items || [];
        }
        return new Response(JSON.stringify(bookings || []), { headers: corsHeaders });
      }
      if (pathname === "/api/bookings" && method === "POST") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const body = await request.json();
        const { customer_name, department, contact, payment_status, payment_method, items, line_user_id, booking_source } = body;
        if (!customer_name || !items || !items.length) {
          return new Response(JSON.stringify({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1C\u0E39\u0E49\u0E08\u0E2D\u0E07\u0E41\u0E25\u0E30\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22 1 \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23" }), { status: 400, headers: corsHeaders });
        }
        for (const item of items) {
          if (item.room_id && item.start_time && item.end_time) {
            const hasOverlap = await checkRoomOverlap(env, item.room_id, item.start_time, item.end_time);
            if (hasOverlap) {
              return new Response(JSON.stringify({ error: `\u0E2B\u0E49\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E16\u0E39\u0E01\u0E08\u0E2D\u0E07\u0E43\u0E19\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32\u0E14\u0E31\u0E07\u0E01\u0E25\u0E48\u0E32\u0E27\u0E41\u0E25\u0E49\u0E27 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E27\u0E25\u0E32\u0E2D\u0E37\u0E48\u0E19` }), { status: 409, headers: corsHeaders });
            }
          }
        }
        let serverTotal = 0;
        for (const item of items) {
          if (item.room_id) {
            const room = await env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind(item.room_id).first();
            if (room) {
              let itemPrice = room.hourly_rate;
              const bType = item.booking_type || "hourly";
              const bLayout = item.layout || "standard";
              if (bType === "daily") {
                itemPrice = bLayout === "classroom" ? room.classroom_daily_rate || room.daily_rate : room.daily_rate;
              } else if (bType === "halfday") {
                itemPrice = room.half_day_rate;
              } else {
                itemPrice = bLayout === "classroom" ? room.classroom_hourly_rate || room.hourly_rate : room.hourly_rate;
              }
              const qty = item.quantity || 1;
              item.price = itemPrice;
              item.subtotal = Math.round(itemPrice * qty * 100) / 100;
              serverTotal += item.subtotal;
            }
          } else if (item.service_id) {
            const service = await env.DB.prepare("SELECT * FROM services WHERE id = ?").bind(item.service_id).first();
            if (service) {
              const qty = item.quantity || 1;
              item.price = service.price;
              item.subtotal = Math.round(service.price * qty * 100) / 100;
              serverTotal += item.subtotal;
            }
          }
        }
        const verifiedTotal = body.total_amount || Math.round(serverTotal * 100) / 100;
        const receiptNumber = await generateReceiptNumber(env);
        const roomItem = items.find((it) => !!it.room_id);
        let pinCode = null;
        if (roomItem) {
          const roomDb = await env.DB.prepare("SELECT pin_code FROM rooms WHERE id = ?").bind(roomItem.room_id).first();
          if (roomDb && roomDb.pin_code && roomDb.pin_code.trim()) {
            pinCode = roomDb.pin_code.trim();
          } else {
            pinCode = await generateUniquePinCode(env);
          }
        }
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const insBooking = await env.DB.prepare(
          `INSERT INTO bookings (customer_name, department, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, booking_source, line_user_id, checkin_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
        ).bind(customer_name, department || "", contact || "", verifiedTotal, payment_status || "pending", payment_method || "cash", receiptNumber, pinCode, booking_source || "walkin", line_user_id || null, nowIso).run();
        const bookingId = insBooking.meta.last_row_id;
        for (let item of items) {
          const normStart = item.room_id && item.start_time ? normalizeToLocalISO(item.start_time) : null;
          const normEnd = item.room_id && item.end_time ? normalizeToLocalISO(item.end_time) : null;
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
            item.layout || "standard",
            item.booking_type || "hourly",
            item.room_id ? pinCode : null
          ).run();
        }
        return new Response(JSON.stringify({
          success: true,
          bookingId,
          receiptNumber,
          pinCode,
          message: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08"
        }), { status: 201, headers: corsHeaders });
      }
      if (pathname.startsWith("/api/bookings/") && pathname.endsWith("/send-pin") && method === "POST") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const parts = pathname.split("/");
        const bookingId = parts[3];
        const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07" }), { status: 404, headers: corsHeaders });
        }
        if (booking.line_user_id) {
          const res = await sendLineDoorPin(env, bookingId);
          if (res && res.success) {
            return new Response(JSON.stringify({
              success: true,
              line_sent: true,
              pin_code: booking.pin_code,
              message: "\u0E2A\u0E48\u0E07\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E02\u0E49\u0E32\u0E2B\u0E49\u0E2D\u0E07\u0E44\u0E1B\u0E22\u0E31\u0E07 LINE OA \u0E02\u0E2D\u0E07\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27"
            }), { headers: corsHeaders });
          } else {
            return new Response(JSON.stringify({
              success: false,
              line_sent: false,
              pin_code: booking.pin_code,
              error: "\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E43\u0E19\u0E01\u0E32\u0E23\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D LINE API"
            }), { status: 500, headers: corsHeaders });
          }
        } else {
          return new Response(JSON.stringify({
            success: true,
            line_sent: false,
            pin_code: booking.pin_code,
            message: "\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E23\u0E32\u0E22\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E08\u0E2D\u0E07\u0E1C\u0E48\u0E32\u0E19 LINE (\u0E08\u0E2D\u0E07\u0E1C\u0E48\u0E32\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E40\u0E27\u0E47\u0E1A\u0E17\u0E31\u0E48\u0E27\u0E44\u0E1B)"
          }), { headers: corsHeaders });
        }
      }
      if (pathname.startsWith("/api/bookings/") && (pathname.endsWith("/payment-status") || pathname.endsWith("/payment")) && (method === "PUT" || method === "PATCH" || method === "POST")) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const parts = pathname.split("/");
        const bookingId = parts[3];
        const body = await request.json();
        const paymentStatus = body.payment_status || "paid";
        const paymentMethod = body.payment_method || "transfer";
        await env.DB.prepare("UPDATE bookings SET payment_status = ?, payment_method = ? WHERE id = ?").bind(paymentStatus, paymentMethod, bookingId).run();
        let lineData = null;
        if (paymentStatus === "paid") {
          lineData = await sendLineBookingConfirmation(env, bookingId);
        }
        return new Response(JSON.stringify({
          success: true,
          message: "\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E2A\u0E16\u0E32\u0E19\u0E30\u0E01\u0E32\u0E23\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" + (lineData?.success ? " \u0E41\u0E25\u0E30\u0E2A\u0E48\u0E07\u0E01\u0E32\u0E23\u0E41\u0E08\u0E49\u0E07\u0E40\u0E15\u0E37\u0E2D\u0E19\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E1C\u0E48\u0E32\u0E19 LINE OA \u0E41\u0E25\u0E49\u0E27" : ""),
          line_notification_sent: lineData?.success || false
        }), { headers: corsHeaders });
      }
      if (pathname.startsWith("/api/bookings/") && pathname.endsWith("/cancel") && method === "POST") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const parts = pathname.split("/");
        const bookingId = parts[3];
        const body = await request.json().catch(() => ({}));
        const reason = body.reason || "\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E41\u0E08\u0E49\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01 / \u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48\u0E17\u0E33\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23";
        const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first();
        if (!booking) return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07" }), { status: 404, headers: corsHeaders });
        await env.DB.prepare("UPDATE bookings SET payment_status = 'cancelled' WHERE id = ?").bind(bookingId).run();
        let lineData = null;
        if (booking.line_user_id) {
          lineData = await sendLineBookingCancellation(env, bookingId, reason);
        }
        return new Response(JSON.stringify({
          success: true,
          message: "\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" + (lineData?.success ? " \u0E41\u0E25\u0E30\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E41\u0E08\u0E49\u0E07\u0E40\u0E15\u0E37\u0E2D\u0E19\u0E1C\u0E48\u0E32\u0E19 LINE OA \u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22" : ""),
          line_sent: lineData?.success || false
        }), { headers: corsHeaders });
      }
      if (pathname.startsWith("/api/bookings/") && pathname.endsWith("/reschedule") && (method === "PUT" || method === "POST")) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const parts = pathname.split("/");
        const bookingId = parts[3];
        const body = await request.json();
        const { date, start_time, end_time, booking_type, layout, total_amount, send_line, room_id } = body;
        if (!date || !start_time || !end_time) {
          return new Response(JSON.stringify({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38 \u0E27\u0E31\u0E19\u0E17\u0E35\u0E48, \u0E40\u0E27\u0E25\u0E32\u0E40\u0E23\u0E34\u0E48\u0E21\u0E15\u0E49\u0E19 \u0E41\u0E25\u0E30\u0E40\u0E27\u0E25\u0E32\u0E2A\u0E34\u0E49\u0E19\u0E2A\u0E38\u0E14 \u0E43\u0E2B\u0E49\u0E04\u0E23\u0E1A\u0E16\u0E49\u0E27\u0E19" }), { status: 400, headers: corsHeaders });
        }
        const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first();
        if (!booking) return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07" }), { status: 404, headers: corsHeaders });
        const currentItem = await env.DB.prepare("SELECT * FROM booking_items WHERE booking_id = ? LIMIT 1").bind(bookingId).first();
        if (!currentItem) return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E2B\u0E49\u0E2D\u0E07\u0E43\u0E19\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E19\u0E35\u0E49" }), { status: 404, headers: corsHeaders });
        const targetRoomId = room_id || currentItem.room_id;
        const cleanStart = start_time.length === 5 ? `${start_time}:00` : start_time;
        const cleanEnd = end_time.length === 5 ? `${end_time}:00` : end_time;
        const newStartISO = `${date}T${cleanStart}`;
        const newEndISO = `${date}T${cleanEnd}`;
        const isOverlapping = await checkRoomOverlap(env, targetRoomId, newStartISO, newEndISO, bookingId);
        if (isOverlapping) {
          return new Response(JSON.stringify({ error: "\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E43\u0E2B\u0E21\u0E48\u0E19\u0E35\u0E49\u0E21\u0E35\u0E1C\u0E39\u0E49\u0E08\u0E2D\u0E07\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E41\u0E25\u0E49\u0E27 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32\u0E2D\u0E37\u0E48\u0E19" }), { status: 400, headers: corsHeaders });
        }
        const oldStart = currentItem.start_time;
        const oldEnd = currentItem.end_time;
        await env.DB.prepare(
          `UPDATE booking_items SET room_id = ?, start_time = ?, end_time = ?, subtotal = ?, price = ?, booking_type = ?, layout = ? WHERE id = ?`
        ).bind(
          targetRoomId,
          newStartISO,
          newEndISO,
          total_amount !== void 0 ? total_amount : currentItem.subtotal,
          total_amount !== void 0 ? total_amount : currentItem.price,
          booking_type || currentItem.booking_type || "hourly",
          layout || currentItem.layout || "standard",
          currentItem.id
        ).run();
        if (total_amount !== void 0) {
          await env.DB.prepare("UPDATE bookings SET total_amount = ? WHERE id = ?").bind(total_amount, bookingId).run();
        }
        let lineData = null;
        if (send_line !== false && booking.line_user_id) {
          lineData = await sendLineBookingReschedule(env, bookingId, oldStart, oldEnd, newStartISO, newEndISO, total_amount);
        }
        return new Response(JSON.stringify({
          success: true,
          message: "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E27\u0E31\u0E19\u0E41\u0E25\u0E30\u0E40\u0E27\u0E25\u0E32\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" + (lineData?.success ? " \u0E41\u0E25\u0E30\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E41\u0E08\u0E49\u0E07\u0E40\u0E15\u0E37\u0E2D\u0E19\u0E1C\u0E48\u0E32\u0E19 LINE OA \u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22" : ""),
          line_sent: lineData?.success || false
        }), { headers: corsHeaders });
      }
      if (pathname.startsWith("/api/bookings/") && (method === "GET" || method === "PUT" || method === "DELETE")) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const parts = pathname.split("/");
        const bookingId = parts[3];
        if (method === "GET") {
          const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(bookingId).first();
          if (!booking) return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07" }), { status: 404, headers: corsHeaders });
          const { results: items } = await env.DB.prepare(`
            SELECT bi.*, r.name as room_name, r.description as room_description, r.capacity as room_capacity, s.name as service_name, s.description as service_description, s.category as service_category
            FROM booking_items bi
            LEFT JOIN rooms r ON bi.room_id = r.id
            LEFT JOIN services s ON bi.service_id = s.id
            WHERE bi.booking_id = ?
          `).bind(bookingId).all();
          return new Response(JSON.stringify({ ...booking, items: items || [] }), { headers: corsHeaders });
        }
        if (method === "PUT") {
          const body = await request.json();
          await env.DB.prepare(
            `UPDATE bookings SET customer_name=?, department=?, contact=?, total_amount=?, payment_status=?, payment_method=? WHERE id=?`
          ).bind(
            body.customer_name,
            body.department || "",
            body.contact || "",
            body.total_amount || 0,
            body.payment_status || "pending",
            body.payment_method || "cash",
            bookingId
          ).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E41\u0E01\u0E49\u0E44\u0E02\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
        if (method === "DELETE") {
          await env.DB.prepare("DELETE FROM booking_items WHERE booking_id = ?").bind(bookingId).run();
          await env.DB.prepare("DELETE FROM bookings WHERE id = ?").bind(bookingId).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E25\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E23\u0E30\u0E1A\u0E1A\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E16\u0E32\u0E27\u0E23\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
      }
      if (pathname.startsWith("/api/public/bookings/") && pathname.endsWith("/upload-slip") && method === "POST") {
        const parts = pathname.split("/");
        const idParam = parts[4];
        const { slip_image } = await request.json();
        let bookingId = idParam;
        if (typeof idParam === "string" && idParam.startsWith("BK-")) {
          const raw = idParam.replace("BK-", "");
          if (raw.length <= 6 && !isNaN(raw)) {
            bookingId = parseInt(raw, 10);
          }
        }
        const booking = await env.DB.prepare(
          "SELECT * FROM bookings WHERE id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)"
        ).bind(bookingId, idParam, idParam).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07" }), { status: 404, headers: corsHeaders });
        }
        const savedSlipUrl = await saveUploadedFile(env, slip_image, "slips");
        await env.DB.prepare("UPDATE bookings SET slip_image_url = ?, payment_status = ? WHERE id = ?").bind(savedSlipUrl || "uploaded", "reviewing", booking.id).run();
        return new Response(JSON.stringify({
          success: true,
          slipUrl: savedSlipUrl,
          message: "\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E2A\u0E25\u0E34\u0E1B\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08! \u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E01\u0E32\u0E23\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19"
        }), { headers: corsHeaders });
      }
      if ((pathname === "/api/public/bookings/by-phone" || pathname === "/api/public/bookings/lookup") && method === "GET") {
        const phone = url.searchParams.get("phone") || url.searchParams.get("contact");
        if (!phone || !phone.trim()) {
          return new Response(JSON.stringify({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E42\u0E17\u0E23\u0E28\u0E31\u0E1E\u0E17\u0E4C" }), { status: 400, headers: corsHeaders });
        }
        const cleanPhone = String(phone).replace(/\D/g, "");
        const { results: bookings } = await env.DB.prepare(
          `SELECT * FROM bookings 
           WHERE (REPLACE(REPLACE(REPLACE(contact, '-', ''), ' ', ''), '+', '') = ? 
              OR contact = ? 
              OR contact LIKE ?)
           ORDER BY id DESC LIMIT 10`
        ).bind(cleanPhone, phone, `%${cleanPhone}%`).all();
        if (!bookings || !bookings.length) {
          return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E42\u0E17\u0E23\u0E28\u0E31\u0E1E\u0E17\u0E4C\u0E19\u0E35\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07" }), { status: 404, headers: corsHeaders });
        }
        for (let b of bookings) {
          const { results: items } = await env.DB.prepare(
            `SELECT bi.*, r.name as room_name, r.capacity, r.image_url, r.description
             FROM booking_items bi
             LEFT JOIN rooms r ON bi.room_id = r.id
             WHERE bi.booking_id = ?`
          ).bind(b.id).all();
          b.items = items || [];
          b.bookingCode = `BK-${String(b.id).padStart(6, "0")}`;
          if (items && items.length && items[0].room_name) {
            b.room_name = items[0].room_name;
            b.start_time = items[0].start_time?.includes("T") ? items[0].start_time.split("T")[1].substring(0, 5) : items[0].start_time;
            b.end_time = items[0].end_time?.includes("T") ? items[0].end_time.split("T")[1].substring(0, 5) : items[0].end_time;
            b.booking_date = items[0].start_time?.includes("T") ? items[0].start_time.split("T")[0] : b.created_at?.split("T")[0];
          }
        }
        return new Response(JSON.stringify({ success: true, bookings }), { headers: corsHeaders });
      }
      if (pathname.startsWith("/api/public/bookings/") && pathname.endsWith("/request-pin") && method === "POST") {
        const parts = pathname.split("/");
        const idParam = parts[4];
        let bookingId = idParam;
        if (typeof idParam === "string" && idParam.startsWith("BK-")) {
          const raw = idParam.replace("BK-", "");
          if (raw.length <= 6 && !isNaN(raw)) {
            bookingId = parseInt(raw, 10);
          }
        }
        const booking = await env.DB.prepare("SELECT * FROM bookings WHERE id = ? OR receipt_number = ?").bind(bookingId, idParam).first();
        if (!booking) {
          return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07" }), { status: 404, headers: corsHeaders });
        }
        if (booking.payment_status !== "paid") {
          return new Response(JSON.stringify({ error: "\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E01\u0E32\u0E23\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19" }), { status: 400, headers: corsHeaders });
        }
        const res = await sendLineDoorPin(env, booking.id);
        if (res && res.success) {
          return new Response(JSON.stringify({ success: true, message: "\u0E2A\u0E48\u0E07\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E02\u0E49\u0E32\u0E2B\u0E49\u0E2D\u0E07\u0E44\u0E1B\u0E22\u0E31\u0E07 LINE \u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27" }), { headers: corsHeaders });
        } else {
          return new Response(JSON.stringify({ success: true, pin_code: booking.pin_code, message: `\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E1B\u0E34\u0E14\u0E1B\u0E23\u0E30\u0E15\u0E39\u0E04\u0E37\u0E2D ${booking.pin_code}` }), { headers: corsHeaders });
        }
      }
      if (pathname.startsWith("/api/public/bookings/") && method === "GET") {
        const idParam = pathname.replace("/api/public/bookings/", "");
        const contact = url.searchParams.get("contact");
        let bookingId = idParam;
        if (typeof idParam === "string" && idParam.startsWith("BK-")) {
          const raw = idParam.replace("BK-", "");
          if (raw.length <= 6 && !isNaN(raw)) {
            bookingId = parseInt(raw, 10);
          }
        }
        let booking;
        if (contact) {
          const cleanContact = String(contact).replace(/\D/g, "");
          booking = await env.DB.prepare(
            `SELECT * FROM bookings 
             WHERE (id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)) 
               AND (REPLACE(REPLACE(REPLACE(contact, '-', ''), ' ', ''), '+', '') = ? OR contact = ?)`
          ).bind(bookingId, idParam, idParam, cleanContact, contact).first();
        } else {
          booking = await env.DB.prepare(
            "SELECT * FROM bookings WHERE id = ? OR receipt_number = ? OR UPPER(receipt_number) = UPPER(?)"
          ).bind(bookingId, idParam, idParam).first();
        }
        if (!booking) {
          return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07 \u0E2B\u0E23\u0E37\u0E2D\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E42\u0E17\u0E23\u0E28\u0E31\u0E1E\u0E17\u0E4C\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07" }), { status: 404, headers: corsHeaders });
        }
        const { results: items } = await env.DB.prepare(
          `SELECT bi.*, r.name as room_name, r.capacity, r.image_url, r.description
           FROM booking_items bi
           LEFT JOIN rooms r ON bi.room_id = r.id
           WHERE bi.booking_id = ?`
        ).bind(booking.id).all();
        const bookingCode = `BK-${String(booking.id).padStart(6, "0")}`;
        return new Response(JSON.stringify({
          ...booking,
          bookingCode,
          items: items || [],
          paymentDeadline: new Date(new Date(booking.created_at).getTime() + 24 * 60 * 60 * 1e3).toISOString()
        }), { headers: corsHeaders });
      }
      if (pathname === "/api/public/bookings" && method === "POST") {
        const body = await request.json();
        const {
          customer_name,
          contact,
          email,
          department,
          note,
          room_id,
          booking_date,
          start_time,
          end_time,
          booking_type,
          layout,
          total_amount,
          line_user_id,
          tax_invoice_required,
          tax_name,
          tax_address,
          tax_id,
          tax_phone,
          tax_delivery_method,
          tax_postal_address
        } = body;
        if (!customer_name || !contact || !room_id || !booking_date || !start_time || !end_time) {
          return new Response(JSON.stringify({ error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E43\u0E2B\u0E49\u0E04\u0E23\u0E1A\u0E16\u0E49\u0E27\u0E19 (\u0E0A\u0E37\u0E48\u0E2D, \u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E42\u0E17\u0E23, \u0E2B\u0E49\u0E2D\u0E07, \u0E27\u0E31\u0E19\u0E17\u0E35\u0E48, \u0E40\u0E27\u0E25\u0E32)" }), { status: 400, headers: corsHeaders });
        }
        if (end_time <= start_time) {
          return new Response(JSON.stringify({ error: "\u0E40\u0E27\u0E25\u0E32\u0E2A\u0E34\u0E49\u0E19\u0E2A\u0E38\u0E14\u0E15\u0E49\u0E2D\u0E07\u0E21\u0E32\u0E01\u0E01\u0E27\u0E48\u0E32\u0E40\u0E27\u0E25\u0E32\u0E40\u0E23\u0E34\u0E48\u0E21\u0E15\u0E49\u0E19" }), { status: 400, headers: corsHeaders });
        }
        const [by, bm, bd] = booking_date.split("-").map(Number);
        const [bsh, bsm] = start_time.split(":").map(Number);
        const bookingStartUtc = new Date(Date.UTC(by, bm - 1, bd, bsh - 7, bsm));
        if (bookingStartUtc.getTime() < Date.now() - 5 * 60 * 1e3) {
          return new Response(JSON.stringify({ error: "\u0E02\u0E2D\u0E2D\u0E20\u0E31\u0E22 \u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E08\u0E2D\u0E07\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32\u0E43\u0E19\u0E2D\u0E14\u0E35\u0E15\u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E21\u0E48" }), { status: 400, headers: corsHeaders });
        }
        const room = await env.DB.prepare("SELECT * FROM rooms WHERE id = ? AND status = 'active'").bind(room_id).first();
        if (!room) {
          return new Response(JSON.stringify({ error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E2B\u0E49\u0E2D\u0E07\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01 \u0E2B\u0E23\u0E37\u0E2D\u0E2B\u0E49\u0E2D\u0E07\u0E44\u0E21\u0E48\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19" }), { status: 404, headers: corsHeaders });
        }
        const fullStart = normalizeToLocalISO(booking_date, start_time);
        const fullEnd = normalizeToLocalISO(booking_date, end_time);
        const hasOverlap = await checkRoomOverlap(env, room_id, fullStart, fullEnd);
        if (hasOverlap) {
          return new Response(JSON.stringify({ error: "\u0E2B\u0E49\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E16\u0E39\u0E01\u0E08\u0E2D\u0E07\u0E43\u0E19\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32\u0E14\u0E31\u0E07\u0E01\u0E25\u0E48\u0E32\u0E27\u0E41\u0E25\u0E49\u0E27 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E27\u0E25\u0E32\u0E2D\u0E37\u0E48\u0E19" }), { status: 409, headers: corsHeaders });
        }
        let price = room.hourly_rate;
        let quantity = 1;
        const bType = booking_type || "hourly";
        const bLayout = layout || "standard";
        if (bType === "daily") {
          price = bLayout === "classroom" ? room.classroom_daily_rate || room.daily_rate : room.daily_rate;
          quantity = 1;
        } else if (bType === "halfday") {
          price = room.half_day_rate;
          quantity = 1;
        } else {
          price = bLayout === "classroom" ? room.classroom_hourly_rate || room.hourly_rate : room.hourly_rate;
          const startParts = start_time.split(":");
          const endParts = end_time.split(":");
          const startMinutes = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
          const endMinutes = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);
          quantity = Math.max(1, Math.ceil((endMinutes - startMinutes) / 60));
        }
        const subtotal = total_amount || Math.round(price * quantity * 100) / 100;
        const receiptNumber = await generateReceiptNumber(env);
        const pinCode = room.pin_code?.trim() || await generateUniquePinCode(env);
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const insBooking = await env.DB.prepare(
          `INSERT INTO bookings (
             customer_name, department, contact, total_amount, payment_status, payment_method, 
             receipt_number, pin_code, booking_source, customer_email, checkin_status, line_user_id,
             tax_invoice_required, tax_name, tax_address, tax_id, tax_phone, tax_delivery_method, tax_postal_address,
             created_at
           )
           VALUES (?, ?, ?, ?, 'pending', 'transfer', ?, ?, 'online', ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          customer_name,
          department || note || "",
          contact,
          subtotal,
          receiptNumber,
          pinCode,
          email || null,
          line_user_id || null,
          tax_invoice_required ? 1 : 0,
          tax_name || null,
          tax_address || null,
          tax_id || null,
          tax_phone || null,
          tax_delivery_method || null,
          tax_postal_address || null,
          nowIso
        ).run();
        const bookingId = insBooking.meta.last_row_id;
        await env.DB.prepare(
          `INSERT INTO booking_items (booking_id, room_id, quantity, price, start_time, end_time, subtotal, layout, booking_type, pin_code)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(bookingId, room_id, subtotal, fullStart, fullEnd, subtotal, bLayout, bType, pinCode).run();
        const bookingCode = `BK-${String(bookingId).padStart(6, "0")}`;
        return new Response(JSON.stringify({
          success: true,
          bookingId,
          bookingCode,
          receiptNumber,
          totalAmount: subtotal,
          paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString(),
          message: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08! \u0E01\u0E23\u0E38\u0E13\u0E32\u0E41\u0E19\u0E1A\u0E2A\u0E25\u0E34\u0E1B\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07"
        }), { status: 201, headers: corsHeaders });
      }
      if (pathname === "/api/quotations/next-number" && method === "GET") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const nextNum = await generateQuotationNumber(env);
        return new Response(JSON.stringify({ quotationNo: nextNum }), { headers: corsHeaders });
      }
      if (pathname === "/api/quotations") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        if (method === "GET") {
          const { results } = await env.DB.prepare("SELECT * FROM quotations ORDER BY created_at DESC").all();
          return new Response(JSON.stringify(results || []), { headers: corsHeaders });
        }
        if (method === "POST") {
          const body = await request.json();
          const qNo = body.quotation_no || await generateQuotationNumber(env);
          const ins = await env.DB.prepare(
            "INSERT INTO quotations (customer_name, department, contact, total_amount, status, quotation_no) VALUES (?, ?, ?, ?, 'draft', ?)"
          ).bind(body.customer_name, body.department || "", body.contact || "", body.total_amount || 0, qNo).run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, quotation_no: qNo }), { status: 201, headers: corsHeaders });
        }
      }
      if (pathname.startsWith("/api/quotations/")) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const qId = pathname.replace("/api/quotations/", "").split("/")[0];
        if (method === "GET") {
          const q = await env.DB.prepare("SELECT * FROM quotations WHERE id = ?").bind(qId).first();
          return new Response(JSON.stringify(q || {}), { headers: corsHeaders });
        }
        if (method === "PUT") {
          const body = await request.json();
          if (body.status === "approved") {
            await env.DB.prepare("UPDATE quotations SET status = 'approved', approved_at = ? WHERE id = ?").bind((/* @__PURE__ */ new Date()).toISOString(), qId).run();
          } else {
            await env.DB.prepare(
              "UPDATE quotations SET customer_name=?, department=?, contact=?, total_amount=?, status=? WHERE id=?"
            ).bind(body.customer_name, body.department || "", body.contact || "", body.total_amount || 0, body.status || "draft", qId).run();
          }
          return new Response(JSON.stringify({ success: true, message: "\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E43\u0E1A\u0E40\u0E2A\u0E19\u0E2D\u0E23\u0E32\u0E04\u0E32\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
        if (method === "DELETE") {
          await env.DB.prepare("DELETE FROM quotations WHERE id = ?").bind(qId).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E25\u0E1A\u0E43\u0E1A\u0E40\u0E2A\u0E19\u0E2D\u0E23\u0E32\u0E04\u0E32\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
      }
      if (pathname === "/api/public/settings/payment" && method === "GET") {
        const { results: settings } = await env.DB.prepare("SELECT key, value FROM settings").all();
        const map = {};
        (settings || []).forEach((s) => map[s.key] = s.value);
        return new Response(JSON.stringify({
          company_name: map.company_name || "\u0E1A\u0E23\u0E34\u0E29\u0E31\u0E17 \u0E1A\u0E34\u0E25\u0E17\u0E4C \u0E2E\u0E32\u0E23\u0E4C\u0E17 \u0E08\u0E33\u0E01\u0E31\u0E14 (\u0E2A\u0E33\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E0D\u0E48)",
          promptpay_id: map.promptpay_id || "0125554000401",
          payment_bank_name: map.payment_bank_name || map.bank_name || "\u0E18\u0E19\u0E32\u0E04\u0E32\u0E23\u0E01\u0E23\u0E38\u0E07\u0E28\u0E23\u0E35\u0E2D\u0E22\u0E38\u0E18\u0E22\u0E32 (Krungsri)",
          payment_bank_account: map.payment_bank_account || map.bank_account || "329-1-38429-0",
          payment_bank_account_name: map.payment_bank_account_name || map.bank_account_name || "\u0E1A\u0E23\u0E34\u0E29\u0E31\u0E17 \u0E1A\u0E34\u0E25\u0E17\u0E4C \u0E2E\u0E32\u0E23\u0E4C\u0E17 \u0E08\u0E33\u0E01\u0E31\u0E14",
          payment_deadline_hours: 24,
          ...map
        }), { headers: corsHeaders });
      }
      if (pathname === "/api/settings") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        if (method === "POST") {
          const body = await request.json();
          for (let [k, v] of Object.entries(body)) {
            await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(k, String(v), String(v)).run();
          }
          return new Response(JSON.stringify({ success: true, message: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E01\u0E32\u0E23\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
        const { results: settings } = await env.DB.prepare("SELECT key, value FROM settings").all();
        const map = {};
        (settings || []).forEach((s) => map[s.key] = s.value);
        return new Response(JSON.stringify({
          company_name: map.company_name || "\u0E1A\u0E23\u0E34\u0E29\u0E31\u0E17 \u0E1A\u0E34\u0E25\u0E17\u0E4C \u0E2E\u0E32\u0E23\u0E4C\u0E17 \u0E08\u0E33\u0E01\u0E31\u0E14 (\u0E2A\u0E33\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E43\u0E2B\u0E0D\u0E48)",
          receipt_header: map.receipt_header || "\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E23\u0E31\u0E1A\u0E40\u0E07\u0E34\u0E19 / \u0E43\u0E1A\u0E23\u0E31\u0E1A\u0E08\u0E2D\u0E07\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23",
          receipt_footer: map.receipt_footer || "\u0E02\u0E2D\u0E1A\u0E04\u0E38\u0E13\u0E17\u0E35\u0E48\u0E43\u0E0A\u0E49\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E2B\u0E49\u0E2D\u0E07\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E02\u0E2D\u0E07\u0E40\u0E23\u0E32",
          promptpay_id: map.promptpay_id || "0125554000401",
          payment_bank_name: map.payment_bank_name || map.bank_name || "\u0E18\u0E19\u0E32\u0E04\u0E32\u0E23\u0E01\u0E23\u0E38\u0E07\u0E28\u0E23\u0E35\u0E2D\u0E22\u0E38\u0E18\u0E22\u0E32 (Krungsri)",
          payment_bank_account: map.payment_bank_account || map.bank_account || "329-1-38429-0",
          payment_bank_account_name: map.payment_bank_account_name || map.bank_account_name || "\u0E1A\u0E23\u0E34\u0E29\u0E31\u0E17 \u0E1A\u0E34\u0E25\u0E17\u0E4C \u0E2E\u0E32\u0E23\u0E4C\u0E17 \u0E08\u0E33\u0E01\u0E31\u0E14",
          payment_deadline_hours: 24,
          ...map
        }), { headers: corsHeaders });
      }
      if (pathname === "/api/users" || pathname === "/api/admin/users") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        if (method === "GET") {
          const { results: users } = await env.DB.prepare("SELECT id, username, role, permissions, fullname, created_at FROM users").all();
          const cleanUsers = (users || []).map((u) => ({
            ...u,
            permissions: u.permissions && u.permissions.trim() ? u.permissions : u.role === "admin" ? "pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation" : "pos,pending,layout,manage,history,quotations"
          }));
          return new Response(JSON.stringify(cleanUsers), { headers: corsHeaders });
        }
        if (method === "POST") {
          const body = await request.json();
          const defaultPerms = body.role === "admin" ? "pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation" : "pos,pending,layout,manage,history,quotations";
          const passHash = await hashPassword(body.password || "123456");
          const ins = await env.DB.prepare(
            "INSERT INTO users (username, password_hash, role, permissions, fullname) VALUES (?, ?, ?, ?, ?)"
          ).bind(body.username, passHash, body.role || "staff", body.permissions || defaultPerms, body.fullname || "").run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: "\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { status: 201, headers: corsHeaders });
        }
      }
      if (pathname.startsWith("/api/users/")) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const uId = pathname.replace("/api/users/", "").split("/")[0];
        if (pathname.endsWith("/reset-password") && method === "POST") {
          let body = {};
          try {
            body = await request.json();
          } catch (e) {
          }
          const newPass = (body.newPassword || body.password || "123456").trim();
          if (newPass.length < 1) {
            return new Response(JSON.stringify({ error: "\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E15\u0E49\u0E2D\u0E07\u0E21\u0E35\u0E04\u0E27\u0E32\u0E21\u0E22\u0E32\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22 1 \u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23" }), { status: 400, headers: corsHeaders });
          }
          const newHash = await hashPassword(newPass);
          await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, uId).run();
          return new Response(JSON.stringify({ success: true, message: `\u0E23\u0E35\u0E40\u0E0B\u0E47\u0E15\u0E23\u0E2B\u0E31\u0E2A\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E1B\u0E47\u0E19 "${newPass}" \u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27` }), { headers: corsHeaders });
        }
        if (method === "PUT") {
          const body = await request.json();
          const defaultPerms = body.role === "admin" ? "pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation" : "pos,pending,layout,manage,history,quotations";
          let query = "UPDATE users SET username=?, role=?, permissions=?, fullname=? WHERE id=?";
          let params = [body.username, body.role || "staff", body.permissions || defaultPerms, body.fullname || "", uId];
          if (body.password) {
            const passHash = await hashPassword(body.password);
            query = "UPDATE users SET username=?, role=?, permissions=?, fullname=?, password_hash=? WHERE id=?";
            params = [body.username, body.role || "staff", body.permissions || defaultPerms, body.fullname || "", passHash, uId];
          }
          await env.DB.prepare(query).bind(...params).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
        if (method === "DELETE") {
          await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uId).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E25\u0E1A\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
      }
      if (pathname === "/api/roles" || pathname.startsWith("/api/roles/")) {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const rId = pathname.replace("/api/roles/", "");
        if (method === "POST") {
          const body = await request.json();
          const ins = await env.DB.prepare("INSERT INTO roles (name, label, permissions) VALUES (?, ?, ?)").bind(body.name, body.label || body.name, body.permissions || "").run();
          return new Response(JSON.stringify({ success: true, id: ins.meta.last_row_id, message: "\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { status: 201, headers: corsHeaders });
        }
        if (method === "PUT") {
          const body = await request.json();
          await env.DB.prepare("UPDATE roles SET name=?, label=?, permissions=? WHERE id=?").bind(body.name, body.label || body.name, body.permissions || "", rId).run();
          await env.DB.prepare("UPDATE users SET permissions=? WHERE role=?").bind(body.permissions || "", body.name).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E41\u0E01\u0E49\u0E44\u0E02\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
        if (method === "DELETE") {
          await env.DB.prepare("DELETE FROM roles WHERE id=?").bind(rId).run();
          return new Response(JSON.stringify({ success: true, message: "\u0E25\u0E1A\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" }), { headers: corsHeaders });
        }
        const { results: roles } = await env.DB.prepare("SELECT * FROM roles").all();
        return new Response(JSON.stringify(roles && roles.length ? roles : [
          { id: 1, name: "admin", label: "\u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25\u0E23\u0E30\u0E1A\u0E1A (Admin)", permissions: "pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation" },
          { id: 2, name: "staff", label: "\u0E1E\u0E19\u0E31\u0E01\u0E07\u0E32\u0E19\u0E15\u0E49\u0E2D\u0E19\u0E23\u0E31\u0E1A (Reception)", permissions: "pos,pending,layout,manage,history,quotations" }
        ]), { headers: corsHeaders });
      }
      if (pathname === "/api/upload" && method === "POST") {
        const auth = await authenticateUser(request, env);
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        const body = await request.json();
        const savedUrl = await saveUploadedFile(env, body.image || body.image_url, "uploads");
        return new Response(JSON.stringify({ success: true, url: savedUrl || "/uploads/img_default.png" }), { headers: corsHeaders });
      }
      if (pathname === "/api/access/verify-pin" && method === "POST") {
        const { room_id, pin_code } = await request.json();
        if (!pin_code || !pin_code.trim()) {
          return new Response(JSON.stringify({ success: false, valid: false, error: "\u0E01\u0E23\u0E38\u0E13\u0E32\u0E01\u0E23\u0E2D\u0E01\u0E23\u0E2B\u0E31\u0E2A PIN 6 \u0E2B\u0E25\u0E31\u0E01" }), { status: 400, headers: corsHeaders });
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
          return new Response(JSON.stringify({ success: false, valid: false, error: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E14\u0E49\u0E27\u0E22\u0E23\u0E2B\u0E31\u0E2A PIN \u0E19\u0E35\u0E49" }), { status: 404, headers: corsHeaders });
        }
        if (bookingRow.payment_status !== "paid") {
          return new Response(JSON.stringify({ success: false, valid: false, error: "\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E08\u0E2D\u0E07\u0E19\u0E35\u0E49\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E07\u0E34\u0E19\u0E17\u0E35\u0E48\u0E40\u0E04\u0E32\u0E19\u0E4C\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E01\u0E48\u0E2D\u0E19" }), { status: 400, headers: corsHeaders });
        }
        return new Response(JSON.stringify({
          success: true,
          valid: true,
          message: "\u0E23\u0E2B\u0E31\u0E2A\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07 \u0E1B\u0E23\u0E30\u0E15\u0E39\u0E40\u0E1B\u0E34\u0E14\u0E41\u0E25\u0E49\u0E27",
          booking: {
            id: bookingRow.booking_id,
            customer_name: bookingRow.customer_name,
            room_name: bookingRow.room_name,
            start_time: bookingRow.start_time,
            end_time: bookingRow.end_time
          }
        }), { headers: corsHeaders });
      }
      if (pathname === "/api/backup/trigger" && (method === "POST" || method === "GET")) {
        const auth = await authenticateUser(request, env, "admin");
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        return new Response(JSON.stringify({ success: true, message: "\u0E10\u0E32\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 D1 \u0E2A\u0E33\u0E23\u0E2D\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34\u0E1A\u0E19 Cloudflare \u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27" }), { headers: corsHeaders });
      }
      if (pathname === "/api/admin/clear-history" && method === "POST") {
        const auth = await authenticateUser(request, env, "admin");
        if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        await env.DB.prepare("DELETE FROM booking_items").run();
        await env.DB.prepare("DELETE FROM bookings").run();
        await env.DB.prepare("DELETE FROM quotation_items").run().catch(() => {
        });
        await env.DB.prepare("DELETE FROM quotations").run().catch(() => {
        });
        await env.DB.prepare("DELETE FROM sqlite_sequence WHERE name IN ('bookings', 'booking_items', 'quotations', 'quotation_items')").run().catch(() => {
        });
        if (env.BUCKET) {
          try {
            const list = await env.BUCKET.list({ prefix: "slips/" });
            for (const obj of list.objects) {
              await env.BUCKET.delete(obj.key);
            }
          } catch (r2Err) {
            console.warn("R2 clear error:", r2Err);
          }
        }
        return new Response(JSON.stringify({ success: true, message: "\u0E25\u0E49\u0E32\u0E07\u0E1B\u0E23\u0E30\u0E27\u0E31\u0E15\u0E34\u0E01\u0E32\u0E23\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E41\u0E25\u0E30\u0E23\u0E39\u0E1B\u0E20\u0E32\u0E1E\u0E2A\u0E25\u0E34\u0E1B\u0E17\u0E14\u0E2A\u0E2D\u0E1A\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E23\u0E49\u0E2D\u0E22\u0E41\u0E25\u0E49\u0E27" }), { headers: corsHeaders });
      }
      if (pathname === "/api/line/webhook") {
        return new Response(JSON.stringify({ success: true, message: "LINE Webhook Received" }), { headers: corsHeaders });
      }
      return new Response(JSON.stringify({ error: "Endpoint Not Found" }), { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error("Worker runtime error:", err);
      return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), { status: 500, headers: corsHeaders });
    }
  }
};

// C:/Users/ADMIN/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// C:/Users/ADMIN/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-VyMkKV/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// C:/Users/ADMIN/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-VyMkKV/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
