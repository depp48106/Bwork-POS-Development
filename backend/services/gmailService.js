/**
 * BWORK-POS | GMAIL API SERVICE MODULE
 * Handles RFC 2822 MIME message construction, email templating,
 * OAuth2 token exchange with scope gmail.send, and secure dispatch
 * (Dry-run by default, master safety switch, staging allowlist, and durable error handling).
 */

const crypto = require('crypto');

const DEFAULT_SENDER_NAME = 'บริษัท บิลท์ ฮาร์ท จำกัด';
const DEFAULT_SENDER_EMAIL = 'coworkings.bwork@gmail.com';
const DEFAULT_REPLY_TO = 'coworkings.bwork@gmail.com';
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

let cachedAccessToken = null;
let cachedTokenExpiry = 0;

/**
 * Checks if Gmail API credentials are configured in the environment.
 */
function isGmailConfigured(env = process.env) {
  return Boolean(
    env.GMAIL_CLIENT_ID &&
    env.GMAIL_CLIENT_SECRET &&
    env.GMAIL_REFRESH_TOKEN
  );
}

/**
 * Checks if live sending switch is enabled.
 * Default is strictly FALSE.
 * Merely configuring credentials must NOT enable live sending!
 */
function isLiveDispatchEnabled(env = process.env) {
  return String(env.GMAIL_LIVE_DISPATCH_ENABLED || '').toLowerCase() === 'true';
}

/**
 * Validates email format according to RFC 5322.
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(email.trim());
}

/**
 * Staging recipient allowlist checker.
 * On non-production (development, staging, test), only allows emails matching the allowlist.
 */
function getEffectiveEnvironment(env = process.env) {
  const raw = String(env?.APP_ENV || env?.ENVIRONMENT || process.env?.APP_ENV || process.env?.ENVIRONMENT || '').trim().toLowerCase();
  if (raw === 'production') return 'production';
  if (raw === 'staging') return 'staging';
  if (raw === 'test') return 'test';
  // Missing, empty, or unknown values MUST NEVER be considered production!
  return 'development';
}

function isEmailAllowedInStaging(email, env = process.env, appEnv = getEffectiveEnvironment(env)) {
  if (appEnv === 'production') return true;

  const rawList = env.GMAIL_STAGING_ALLOWLIST || '';
  if (!rawList.trim()) return false;

  const target = String(email || '').trim().toLowerCase();
  const allowed = rawList.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  return allowed.some(pattern => {
    if (pattern.startsWith('@')) {
      return target.endsWith(pattern);
    }
    return target === pattern;
  });
}

/**
 * Encodes string to UTF-8 base64 encoded-word for MIME headers (RFC 2047).
 */
function encodeMimeHeader(text) {
  if (!text) return '';
  const str = String(text);
  if (!/[^\x20-\x7E]/.test(str)) {
    return str;
  }
  return `=?UTF-8?B?${Buffer.from(str, 'utf8').toString('base64')}?=`;
}

/**
 * Base64URL encoding (RFC 4648).
 */
function base64UrlEncode(strOrBuffer) {
  const buf = Buffer.isBuffer(strOrBuffer) ? strOrBuffer : Buffer.from(strOrBuffer, 'utf8');
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generates official B-WORK e-Tax Invoice email template (Text & HTML).
 */
function generateTaxInvoiceEmailContent({
  booking,
  invoice,
  recipientEmail,
  senderEmail = process.env.GMAIL_USER_EMAIL || DEFAULT_SENDER_EMAIL,
  senderName = process.env.GMAIL_SENDER_NAME || DEFAULT_SENDER_NAME,
  replyTo = process.env.GMAIL_REPLY_TO || DEFAULT_REPLY_TO
}) {
  const bookingId = booking?.id || booking?.booking_id || '-';
  const bookingCode = booking?.receipt_number || booking?.booking_code || `BK-${String(bookingId).padStart(6, '0')}`;
  const invoiceNumber = invoice?.invoice_number || `INV-${bookingId}`;
  const customerName = invoice?.tax_name || booking?.tax_name || booking?.customer_name || 'ท่านผู้มีอุปการคุณ';
  const taxId = invoice?.tax_id || booking?.tax_id || '-';
  const branchText = invoice?.tax_payer_type === 'individual'
    ? 'บุคคลธรรมดา'
    : (invoice?.tax_branch_type === 'branch' ? `สาขา ${invoice?.tax_branch_number || ''}` : 'สำนักงานใหญ่');
  const amount = Number(booking?.total_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
  const dateStr = invoice?.created_at ? new Date(invoice.created_at).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric'
  }) : new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  const subject = `[B-WORK] ใบกำกับภาษี / ใบเสร็จรับเงินเต็มรูปแบบ เลขที่ ${invoiceNumber} (${bookingCode})`;

  const textBody = `
เรียน ${customerName},

บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่) ขอขอบพระคุณที่ท่านได้ใช้บริการ บีเวิร์ค โคเวิร์กกิ้ง สเปซ (B-WORK Coworking Space & Meeting Rooms)

ทางเราได้จัดทำเอกสารใบกำกับภาษี / ใบเสร็จรับเงินอิเล็กทรอนิกส์ (e-Tax Invoice / Receipt) สำหรับรายการจองของท่านเรียบร้อยแล้ว โดยมีรายละเอียดดังต่อไปนี้:

- รหัสการจอง: ${bookingCode}
- เลขที่ใบกำกับภาษี: ${invoiceNumber}
- วันที่ออกเอกสาร: ${dateStr}
- ผู้เสียภาษี: ${customerName}
- เลขประจำตัวผู้เสียภาษี: ${taxId} (${branchText})
- ยอดเงินรวมทั้งสิ้น: ฿${amount} บาท

ท่านสามารถเปิดดูหรือดาวน์โหลดไฟล์เอกสารใบกำกับภาษีอิเล็กทรอนิกส์ (ไฟล์แนบ PDF) ที่แนบมาพร้อมกับอีเมลฉบับนี้

หากท่านมีข้อสงสัยหรือต้องการสอบถามข้อมูลเพิ่มเติม สามารถติดต่อเราได้ที่:
โทร: 02-000-0000
อีเมล: ${replyTo}
LINE Official: @bwork

ขอแสดงความนับถือ,
${senderName}
บริษัท บิลท์ ฮาร์ท จำกัด
`.trim();

  const htmlBody = `
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Prompt', 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f1f5f9; color: #1e293b; }
    .container { max-width: 600px; margin: 24px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 8px 0 0; font-size: 14px; opacity: 0.9; }
    .body { padding: 32px 24px; }
    .card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; }
    .card-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 14px; }
    .card-row:last-child { border-bottom: none; }
    .label { color: #64748b; font-weight: 600; }
    .value { color: #0f172a; font-weight: 700; text-align: right; }
    .attachment-box { display: flex; align-items: center; gap: 12px; background: rgba(2, 132, 199, 0.08); border: 1.5px solid #38bdf8; border-radius: 10px; padding: 14px 18px; margin: 20px 0; }
    .footer { background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px; text-align: center; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${senderName}</h1>
      <p>ใบกำกับภาษี / ใบเสร็จรับเงินเต็มรูปแบบอิเล็กทรอนิกส์</p>
    </div>
    <div class="body">
      <p style="font-size: 16px; line-height: 1.6; margin-top: 0;">
        เรียน <strong>${customerName}</strong>,
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        บริษัท บิลท์ ฮาร์ท จำกัด ขอขอบพระคุณที่ท่านได้ใช้บริการห้องประชุมและพื้นที่ทำงาน B-WORK ทางเราได้ออกเอกสารใบกำกับภาษีสำหรับรายการของท่านเรียบร้อยแล้ว รายละเอียดดังตารางด้านล่างนี้:
      </p>
      <div class="card">
        <div class="card-row">
          <span class="label">รหัสการจอง:</span>
          <span class="value">${bookingCode}</span>
        </div>
        <div class="card-row">
          <span class="label">เลขที่ใบกำกับภาษี:</span>
          <span class="value" style="color: #0284c7;">${invoiceNumber}</span>
        </div>
        <div class="card-row">
          <span class="label">วันที่ออกเอกสาร:</span>
          <span class="value">${dateStr}</span>
        </div>
        <div class="card-row">
          <span class="label">ผู้เสียภาษี:</span>
          <span class="value">${customerName}</span>
        </div>
        <div class="card-row">
          <span class="label">เลขประจำตัวผู้เสียภาษี:</span>
          <span class="value">${taxId} (${branchText})</span>
        </div>
        <div class="card-row" style="padding-top: 12px;">
          <span class="label" style="font-size: 15px;">ยอดเงินรวมทั้งสิ้น:</span>
          <span class="value" style="font-size: 18px; color: #059669;">฿${amount}</span>
        </div>
      </div>
      <div class="attachment-box">
        <div style="font-size: 24px;">📄</div>
        <div>
          <div style="font-weight: 800; font-size: 14px; color: #0369a1;">เอกสารใบกำกับภาษี (ไฟล์แนบ PDF)</div>
          <div style="font-size: 12px; color: #64748b;">กรุณาตรวจสอบเอกสารฉบับสมบูรณ์ที่แนบมากับอีเมลนี้</div>
        </div>
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
        หากท่านต้องการสอบถามข้อมูลเพิ่มเติม หรือแก้ไขข้อมูลภาษี กรุณาติดต่อฝ่ายบริการลูกค้า โทร 02-000-0000 หรือ LINE: @bwork หรืออีเมล: ${replyTo}
      </p>
    </div>
    <div class="footer">
      <div>© ${new Date().getFullYear()} บริษัท บิลท์ ฮาร์ท จำกัด (Built Heart Co., Ltd.) · สำนักงานใหญ่</div>
      <div style="margin-top: 4px;">B-WORK Coworking Space & Meeting Rooms · ถนนสุขุมวิท กรุงเทพมหานคร</div>
      <div style="margin-top: 8px; font-size: 11px; color: #94a3b8;">อีเมลฉบับนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับโดยตรง</div>
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, textBody, htmlBody };
}

/**
 * Builds RFC 2822 Multipart MIME Message with PDF attachment.
 * Encodes Thai sender name correctly via RFC 2047.
 */
function buildMimeMessage({
  from = process.env.GMAIL_USER_EMAIL || DEFAULT_SENDER_EMAIL,
  fromName = process.env.GMAIL_SENDER_NAME || DEFAULT_SENDER_NAME,
  replyTo = process.env.GMAIL_REPLY_TO || DEFAULT_REPLY_TO,
  to,
  subject,
  text,
  html,
  attachmentBuffer,
  attachmentFileName = 'Tax_Invoice.pdf',
  attachmentContentType = 'application/pdf'
}) {
  const boundaryMixed = `==_mixed_${crypto.randomBytes(8).toString('hex')}==`;
  const boundaryAlt = `==_alt_${crypto.randomBytes(8).toString('hex')}==`;

  const safeAttachmentName = String(attachmentFileName).replace(/["\r\n]/g, '');

  let mime = '';
  // Top Headers
  mime += `From: ${encodeMimeHeader(fromName)} <${from}>\r\n`;
  mime += `Reply-To: <${replyTo}>\r\n`;
  mime += `To: ${to}\r\n`;
  mime += `Subject: ${encodeMimeHeader(subject)}\r\n`;
  mime += `MIME-Version: 1.0\r\n`;
  mime += `Content-Type: multipart/mixed; boundary="${boundaryMixed}"\r\n\r\n`;

  // Part 1: Alternative (Text & HTML)
  mime += `--${boundaryMixed}\r\n`;
  mime += `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n\r\n`;

  // Plain Text
  mime += `--${boundaryAlt}\r\n`;
  mime += `Content-Type: text/plain; charset=UTF-8\r\n`;
  mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
  mime += Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n') + '\r\n\r\n';

  // HTML
  mime += `--${boundaryAlt}\r\n`;
  mime += `Content-Type: text/html; charset=UTF-8\r\n`;
  mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
  mime += Buffer.from(html, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n') + '\r\n\r\n';

  mime += `--${boundaryAlt}--\r\n\r\n`;

  // Part 2: PDF Attachment
  if (attachmentBuffer && Buffer.isBuffer(attachmentBuffer)) {
    mime += `--${boundaryMixed}\r\n`;
    mime += `Content-Type: ${attachmentContentType}; name="${encodeMimeHeader(safeAttachmentName)}"\r\n`;
    mime += `Content-Disposition: attachment; filename="${encodeMimeHeader(safeAttachmentName)}"\r\n`;
    mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
    mime += attachmentBuffer.toString('base64').match(/.{1,76}/g).join('\r\n') + '\r\n\r\n';
  }

  mime += `--${boundaryMixed}--\r\n`;

  return mime;
}

/**
 * Exchanges OAuth2 refresh token for a short-lived access token.
 */
async function getGmailAccessToken({
  clientId = process.env.GMAIL_CLIENT_ID,
  clientSecret = process.env.GMAIL_CLIENT_SECRET,
  refreshToken = process.env.GMAIL_REFRESH_TOKEN,
  fetchFn = fetch
} = {}) {
  const now = Date.now();
  if (cachedAccessToken && cachedTokenExpiry > now + 60000) {
    return cachedAccessToken;
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail API OAuth2 credentials ไม่ครบถ้วน (ต้องการ GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)');
  }

  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const bodyParams = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const res = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString()
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google OAuth2 Token Exchange ล้มเหลว (HTTP ${res.status}): ${errText}`);
  }

  const tokenData = await res.json();
  if (!tokenData.access_token) {
    throw new Error('Google OAuth2 ไม่ได้ส่ง access_token กลับมา');
  }

  cachedAccessToken = tokenData.access_token;
  cachedTokenExpiry = now + (Number(tokenData.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

/**
 * Sends or simulates sending tax invoice email via Gmail API.
 * Follows strict safety rules:
 * 1. Defaults to dry_run: true.
 * 2. Live dispatch requires GMAIL_LIVE_DISPATCH_ENABLED === 'true' AND valid credentials.
 * 3. Staging / non-production checks GMAIL_STAGING_ALLOWLIST.
 * 4. Timeout or network interruption during live send is marked uncertain (do not auto-retry).
 */
async function sendTaxInvoiceEmail({
  booking,
  invoice,
  recipientEmail,
  pdfBuffer,
  fileName = 'Tax_Invoice.pdf',
  dry_run = true,
  dispatchedBy = 'staff',
  senderEmail = process.env.GMAIL_USER_EMAIL || DEFAULT_SENDER_EMAIL,
  senderName = process.env.GMAIL_SENDER_NAME || DEFAULT_SENDER_NAME,
  replyTo = process.env.GMAIL_REPLY_TO || DEFAULT_REPLY_TO,
  env = process.env,
  fetchFn = fetch,
  timeoutMs = 15000
}) {
  // 1. Validation: Recipient Email
  const cleanEmail = (recipientEmail || '').trim();
  if (!cleanEmail || !isValidEmail(cleanEmail)) {
    throw new Error('รูปแบบอีเมลผู้รับไม่ถูกต้อง');
  }

  // 2. Validation: PDF Buffer
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error('ไม่พบไฟล์เอกสาร PDF หรือเนื้อหาไฟล์ว่างเปล่า');
  }

  // Strict PDF Magic Bytes Check: %PDF- (0x25 0x50 0x44 0x46)
  if (
    pdfBuffer.length < 4 ||
    pdfBuffer[0] !== 0x25 ||
    pdfBuffer[1] !== 0x50 ||
    pdfBuffer[2] !== 0x44 ||
    pdfBuffer[3] !== 0x46
  ) {
    throw new Error('ไฟล์เอกสารไม่ใช่รูปแบบ PDF ที่ถูกต้อง (%PDF- signature missing)');
  }

  // Max 10MB file limit
  if (pdfBuffer.length > 10 * 1024 * 1024) {
    throw new Error('ขนาดไฟล์ PDF เกินขีดจำกัด 10MB');
  }

  // 3. Generate Content & MIME Message
  const { subject, textBody, htmlBody } = generateTaxInvoiceEmailContent({
    booking,
    invoice,
    recipientEmail: cleanEmail,
    senderEmail,
    senderName,
    replyTo
  });

  const rawMime = buildMimeMessage({
    from: senderEmail,
    fromName: senderName,
    replyTo,
    to: cleanEmail,
    subject,
    text: textBody,
    html: htmlBody,
    attachmentBuffer: pdfBuffer,
    attachmentFileName: fileName,
    attachmentContentType: 'application/pdf'
  });

  const base64UrlRaw = base64UrlEncode(rawMime);

  // 4. DRY-RUN MODE:
  // Default is dry_run: true. Simulated dispatch without external API calls.
  if (dry_run) {
    const simulatedMsgId = `dry_run_msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const timestamp = new Date().toISOString();

    console.log(`[GmailService] [DRY-RUN] Simulated tax invoice dispatch to ${cleanEmail}`);
    console.log(`  - Sender: "${senderName}" <${senderEmail}> | Reply-To: <${replyTo}>`);
    console.log(`  - Booking ID: ${booking?.id}`);
    console.log(`  - Invoice Number: ${invoice?.invoice_number || 'N/A'}`);
    console.log(`  - Subject: "${subject}"`);
    console.log(`  - Attached File: ${fileName} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);
    console.log(`  - Simulated Message ID: ${simulatedMsgId}`);

    return {
      success: true,
      dry_run: true,
      status: 'dry_run',
      message_id: simulatedMsgId,
      recipient: cleanEmail,
      subject,
      file_name: fileName,
      file_size: pdfBuffer.length,
      mime_size: rawMime.length,
      dispatched_by: dispatchedBy,
      timestamp,
      email_preview: {
        to: cleanEmail,
        from: `${senderName} <${senderEmail}>`,
        reply_to: replyTo,
        subject,
        text: textBody,
        html: htmlBody,
        file_name: fileName,
        file_size: pdfBuffer.length
      }
    };
  }

  // 5. LIVE GMAIL API DISPATCH
  // Master Switch Check:
  if (!isLiveDispatchEnabled(env)) {
    throw new Error('ระบบยังไม่ได้เปิดสวิตช์ส่งอีเมลจริง (GMAIL_LIVE_DISPATCH_ENABLED != true) กรุณาเลือกโหมดจำลองส่ง (Dry-run)');
  }

  // Credentials Check:
  if (!isGmailConfigured(env)) {
    throw new Error('ไม่ได้กำหนดค่า Gmail API OAuth2 Credentials ในระบบ กรุณาตรวจสอบการตั้งค่า');
  }

  // Staging Allowlist Check:
  const appEnv = getEffectiveEnvironment(env);
  if (appEnv !== 'production' && !isEmailAllowedInStaging(cleanEmail, env, appEnv)) {
    throw new Error(`โหมด ${appEnv} อนุญาตให้ส่งอีเมลจริงเฉพาะอีเมลใน Staging Allowlist เท่านั้น (${cleanEmail} ไม่อยู่ในรายการที่อนุญาต)`);
  }

  // Fetch OAuth2 Access Token
  const accessToken = await getGmailAccessToken({
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
    fetchFn
  });

  // Call Gmail messages.send REST API with timeout
  const gmailSendUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchFn(gmailSendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: base64UrlRaw }),
      signal: controller.signal
    });
  } catch (netErr) {
    clearTimeout(timer);
    // Uncertain timeout / socket reset after sending
    const isTimeout = netErr.name === 'AbortError' || netErr.code === 'ETIMEDOUT' || netErr.code === 'ECONNRESET';
    const uncertainError = new Error(`คำขอส่งอีเมลไปยัง Gmail API หมดเวลา (Timeout) หรือเครือข่ายขัดข้อง (${netErr.message})`);
    uncertainError.isUncertain = true;
    uncertainError.code = 'DISPATCH_UNCERTAIN';
    throw uncertainError;
  }
  clearTimeout(timer);

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Gmail API ส่งข้อความไม่สำเร็จ (HTTP ${response.status}): ${errBody}`);
  }

  const gmailResult = await response.json().catch(() => ({}));
  const timestamp = new Date().toISOString();

  console.log(`[GmailService] [LIVE] Successfully accepted by Gmail API for ${cleanEmail} (Message ID: ${gmailResult.id})`);

  return {
    success: true,
    dry_run: false,
    status: 'gmail_accepted',
    message_id: gmailResult.id || `gmail_${Date.now()}`,
    thread_id: gmailResult.threadId || null,
    recipient: cleanEmail,
    subject,
    file_name: fileName,
    file_size: pdfBuffer.length,
    dispatched_by: dispatchedBy,
    timestamp,
    email_preview: {
      to: cleanEmail,
      from: `${senderName} <${senderEmail}>`,
      reply_to: replyTo,
      subject,
      file_name: fileName,
      file_size: pdfBuffer.length
    }
  };
}

module.exports = {
  DEFAULT_SENDER_NAME,
  DEFAULT_SENDER_EMAIL,
  DEFAULT_REPLY_TO,
  GMAIL_SEND_SCOPE,
  isGmailConfigured,
  isLiveDispatchEnabled,
  getEffectiveEnvironment,
  isEmailAllowedInStaging,
  isValidEmail,
  encodeMimeHeader,
  base64UrlEncode,
  generateTaxInvoiceEmailContent,
  buildMimeMessage,
  getGmailAccessToken,
  sendTaxInvoiceEmail
};
