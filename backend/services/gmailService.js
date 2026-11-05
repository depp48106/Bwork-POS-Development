/**
 * BWORK-POS | GMAIL API SERVICE MODULE
 * Handles RFC 2822 MIME message construction, email templating,
 * and secure dispatch (simulated Dry-run by default, modular for live Gmail API).
 */

const crypto = require('crypto');

/**
 * Checks if Gmail API credentials are configured in the environment.
 */
function isGmailConfigured() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );
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
 * Encodes string to UTF-8 base64 encoded-word for MIME headers (RFC 2047).
 */
function encodeMimeHeader(text) {
  if (!text) return '';
  return `=?UTF-8?B?${Buffer.from(String(text), 'utf8').toString('base64')}?=`;
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
  senderEmail = 'bwork.coworking@gmail.com'
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
อีเมล: support@bwork.co
LINE Official: @bwork

ขอแสดงความนับถือ,
ทีมงาน B-WORK Coworking Space
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
      <h1>B-WORK Coworking Space</h1>
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
        หากท่านต้องการสอบถามข้อมูลเพิ่มเติม หรือแก้ไขข้อมูลภาษี กรุณาติดต่อฝ่ายบริการลูกค้า โทร 02-000-0000 หรือ LINE: @bwork
      </p>
    </div>
    <div class="footer">
      <div>© ${new Date().getFullYear()} บริษัท บิลท์ ฮาร์ท จำกัด (Built Heart Co., Ltd.) · สำนักงานใหญ่</div>
      <div style="margin-top: 4px;">B-WORK Coworking Space & Meeting Rooms · ถนนสุขุมวิท กรุงเทพมหานคร</div>
      <div style="margin-top: 8px; font-size: 11px; color: #94a3b8;">อีเมลฉบับนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับ</div>
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, textBody, htmlBody };
}

/**
 * Builds RFC 2822 Multipart MIME Message with PDF attachment.
 */
function buildMimeMessage({
  from,
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
  mime += `From: ${encodeMimeHeader('B-WORK Coworking Space')} <${from}>\r\n`;
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
 * Sends or simulates sending tax invoice email via Gmail API.
 * Defaults to dry_run: true. Never dispatches live email if dry_run=true.
 */
async function sendTaxInvoiceEmail({
  booking,
  invoice,
  recipientEmail,
  pdfBuffer,
  fileName = 'Tax_Invoice.pdf',
  dry_run = true,
  dispatchedBy = 'staff',
  senderEmail = process.env.GMAIL_USER_EMAIL || 'billing@bwork.co'
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
    senderEmail
  });

  const rawMime = buildMimeMessage({
    from: senderEmail,
    to: cleanEmail,
    subject,
    text: textBody,
    html: htmlBody,
    attachmentBuffer: pdfBuffer,
    attachmentFileName: fileName,
    attachmentContentType: 'application/pdf'
  });

  const base64UrlRaw = base64UrlEncode(rawMime);

  // 4. Dispatch Execution: DRY-RUN vs LIVE
  if (dry_run || !isGmailConfigured()) {
    const simulatedMsgId = `dry_run_msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const timestamp = new Date().toISOString();

    console.log(`[GmailService] [DRY-RUN] Simulated tax invoice dispatch to ${cleanEmail}`);
    console.log(`  - Booking ID: ${booking?.id}`);
    console.log(`  - Invoice Number: ${invoice?.invoice_number || 'N/A'}`);
    console.log(`  - Subject: "${subject}"`);
    console.log(`  - Attached File: ${fileName} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);
    console.log(`  - Simulated Message ID: ${simulatedMsgId}`);

    return {
      success: true,
      dry_run: true,
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
        from: senderEmail,
        subject,
        text: textBody,
        html: htmlBody,
        file_name: fileName,
        file_size: pdfBuffer.length
      }
    };
  }

  // Live Gmail API Call (When credentials are fully provided in future release)
  throw new Error('ระบบยังไม่อนุญาตให้ส่งอีเมลจริง กรุณาเลือกโหมดจำลองส่ง (Dry-run)');
}

module.exports = {
  isGmailConfigured,
  isValidEmail,
  generateTaxInvoiceEmailContent,
  buildMimeMessage,
  sendTaxInvoiceEmail,
  base64UrlEncode
};
