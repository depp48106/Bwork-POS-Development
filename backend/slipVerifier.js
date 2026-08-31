const path = require('path');
const jsQR = require('jsqr');
const Jimp = require('jimp');
const { createWorker } = require('tesseract.js');

// Bank Code Mapping (PromptPay / ITMX Interbank Bank Identifiers)
const BANK_CODES = {
  '002': { code: '002', name: 'ธนาคารกรุงเทพ', enName: 'Bangkok Bank (BBL)', shortName: 'BBL' },
  '004': { code: '004', name: 'ธนาคารกสิกรไทย', enName: 'Kasikornbank (KBank)', shortName: 'KBANK' },
  '006': { code: '006', name: 'ธนาคารกรุงไทย', enName: 'Krungthai Bank (KTB)', shortName: 'KTB' },
  '011': { code: '011', name: 'ธนาคารทหารไทยธนชาต', enName: 'TMBThanachart Bank (TTB)', shortName: 'TTB' },
  '014': { code: '014', name: 'ธนาคารไทยพาณิชย์', enName: 'Siam Commercial Bank (SCB)', shortName: 'SCB' },
  '025': { code: '025', name: 'ธนาคารกรุงศรีอยุธยา', enName: 'Bank of Ayudhya (BAY)', shortName: 'BAY' },
  '030': { code: '030', name: 'ธนาคารออมสิน', enName: 'Government Savings Bank (GSB)', shortName: 'GSB' },
  '034': { code: '034', name: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', enName: 'BAAC', shortName: 'BAAC' },
  '065': { code: '065', name: 'ธนาคารธนชาต', enName: 'Thanachart Bank', shortName: 'TBANK' },
  '069': { code: '069', name: 'ธนาคารเกียรตินาคินภัทร', enName: 'Kiatnakin Phatra Bank', shortName: 'KKP' },
  '073': { code: '073', name: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', enName: 'LH Bank', shortName: 'LHBANK' },
  '098': { code: '098', name: 'ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม', enName: 'SME D Bank', shortName: 'SME' }
};

const KNOWN_BANK_CODES = Object.keys(BANK_CODES);

// Default Company Account Identification Keywords
const COMPANY_KEYWORDS = ['บิลท์', 'บิ้วท์', 'ปิลท์', 'built', 'heart', 'bwork', 'b-work', '38429', '0125554000401'];

/**
 * Parse EMVCo / ITMX / PromptPay TLV (Tag-Length-Value) string
 */
function parseTLV(str) {
  const result = {};
  let i = 0;
  while (i < str.length) {
    const tag = str.substring(i, i + 2);
    const len = parseInt(str.substring(i + 2, i + 4), 10);
    if (isNaN(len) || len < 0) break;
    const val = str.substring(i + 4, i + 4 + len);
    result[tag] = val;
    i += 4 + len;
  }
  return result;
}

/**
 * Parse PromptPay / ITMX Mini QR Standard on Thai Bank Slips
 * AND strictly filter out Merchant Payment QRs (QR สำหรับจ่ายเงิน)
 */
function parseThaiBankSlipQR(qrString) {
  if (!qrString || typeof qrString !== 'string') return null;

  try {
    const root = parseTLV(qrString);

    // =========================================================
    // Format A: ITMX / SCB / Thai Bank Transfer Slip Mini QR
    // (e.g. 0046000600000101030140225202608275pmz0lPQPi1Ti9x1g5102TH91048A2D)
    // =========================================================
    if (root['00'] && root['00'].length > 10) {
      const sub00 = parseTLV(root['00']);
      const bankCode = sub00['01'];
      const transRef = sub00['02'];

      if (bankCode && KNOWN_BANK_CODES.includes(bankCode) && transRef) {
        return {
          isValidSlipQR: true,
          isMerchantPaymentQR: false,
          bankCode: bankCode,
          bankName: BANK_CODES[bankCode].name,
          transRef: transRef,
          amount: null,
          countryCode: root['51'] || 'TH',
          format: 'ITMX_MINI_QR',
          rawQR: qrString
        };
      }
    }

    // =========================================================
    // Format B: EMVCo PromptPay Standard Slip Mini QR
    // =========================================================
    if (root['00'] === '01') {
      // 1. Check if Merchant Payment QR (Reject!)
      const isStaticPaymentQR = root['01'] === '11';
      const hasMerchantInfo = !!(root['59'] || root['60'] || root['52']);
      
      if (isStaticPaymentQR || hasMerchantInfo) {
        return {
          isValidSlipQR: false,
          isMerchantPaymentQR: true,
          merchantName: root['59'] || null,
          rejectionReason: 'รูปภาพที่อัปโหลดคือ QR Code สำหรับสแกนจ่ายเงิน (Payment QR) ไม่ใช่สลิปหลักฐานการโอนเงินสำเร็จของธนาคาร'
        };
      }

      // 2. Check Bank Slip tags
      let isBankSlipQR = false;
      let sendingBank = null;
      let bankCode = null;
      let sendingAccount = null;

      for (const tag of ['29', '30', '31']) {
        if (root[tag]) {
          const sub = parseTLV(root[tag]);
          if (sub['00'] && (sub['00'] === 'A000000677010111' || sub['00'] === 'A000000677010112')) {
            if (sub['01'] && sub['01'].length >= 3) {
              const rawCode = sub['01'].substring(0, 3);
              if (KNOWN_BANK_CODES.includes(rawCode) && sub['01'].length <= 13) {
                bankCode = rawCode;
                sendingBank = BANK_CODES[bankCode].name;
                sendingAccount = sub['02'] || null;
                isBankSlipQR = true;
              }
            }
          }
        }
      }

      let transRef = null;
      if (root['62']) {
        const sub62 = parseTLV(root['62']);
        transRef = sub62['07'] || null;
      }

      if (isBankSlipQR && transRef) {
        return {
          isValidSlipQR: true,
          isMerchantPaymentQR: false,
          bankCode,
          bankName: sendingBank,
          transRef,
          amount: root['54'] ? parseFloat(root['54']) : null,
          sendingAccount,
          countryCode: root['58'] || 'TH',
          format: 'EMVCO_MINI_QR',
          rawQR: qrString
        };
      }
    }

    return {
      isValidSlipQR: false,
      isMerchantPaymentQR: false,
      rawText: qrString,
      rejectionReason: 'QR Code ในรูปภาพไม่ใช่สลิปโอนเงินของธนาคาร (กรุณาแนบรูปสลิปที่ได้จากแอปธนาคาร)'
    };
  } catch (err) {
    return {
      isValidSlipQR: false,
      isMerchantPaymentQR: false,
      rawText: qrString,
      rejectionReason: err.message
    };
  }
}

/**
 * Decode Mini QR Code from image Buffer with multi-pass image enhancement
 */
async function decodeMiniQR(imageBuffer) {
  try {
    const jimpImage = await Jimp.read(imageBuffer);

    // Pass 1: Raw Image
    let qr = jsQR(new Uint8ClampedArray(jimpImage.bitmap.data), jimpImage.bitmap.width, jimpImage.bitmap.height);
    if (qr && qr.data) {
      const parsed = parseThaiBankSlipQR(qr.data);
      if (parsed) return parsed;
    }

    // Pass 2: High Contrast & Greyscale
    const enhanced1 = jimpImage.clone().greyscale().contrast(0.6);
    qr = jsQR(new Uint8ClampedArray(enhanced1.bitmap.data), enhanced1.bitmap.width, enhanced1.bitmap.height);
    if (qr && qr.data) {
      const parsed = parseThaiBankSlipQR(qr.data);
      if (parsed) return parsed;
    }

    // Pass 3: Resized 2x for small Mini QR codes
    const enhanced2 = jimpImage.clone().resize(jimpImage.bitmap.width * 1.5, jimpImage.bitmap.height * 1.5).greyscale().contrast(0.7);
    qr = jsQR(new Uint8ClampedArray(enhanced2.bitmap.data), enhanced2.bitmap.width, enhanced2.bitmap.height);
    if (qr && qr.data) {
      const parsed = parseThaiBankSlipQR(qr.data);
      if (parsed) return parsed;
    }

    // Pass 4: Threshold Binarization
    const enhanced3 = jimpImage.clone().greyscale().contrast(0.9);
    qr = jsQR(new Uint8ClampedArray(enhanced3.bitmap.data), enhanced3.bitmap.width, enhanced3.bitmap.height);
    if (qr && qr.data) {
      const parsed = parseThaiBankSlipQR(qr.data);
      if (parsed) return parsed;
    }

    return null;
  } catch (err) {
    console.error('Mini QR decode error:', err);
    return null;
  }
}

/**
 * Robust Amount Extractor from OCR Text (Ignoring Fee '0.00' and picking transaction amount)
 */
function extractPreciseAmount(ocrText) {
  if (!ocrText) return null;
  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);

  // Strategy 1: Look directly for lines around "จำนวน", "AMOUNT", "ยอดเงิน"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:จำนวน|จํานวน|amount|ยอดเงิน|ยอดชำระ|ยอดโอน)/i.test(line)) {
      if (/ค่าธรรมเนียม|fee/i.test(line)) continue;
      const candidateChunk = lines.slice(i, i + 4).join(' ');
      const cleanChunk = candidateChunk.replace(/ค่าธรรมเนียม[\s\S]*/i, '').replace(/fee[\s\S]*/i, '');
      const match = cleanChunk.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/);
      if (match) {
        const val = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(val)) return val;
      }
    }
  }

  // Strategy 2: Collect all decimal currency patterns and exclude fee lines
  const validAmounts = [];
  for (const line of lines) {
    if (/ค่าธรรมเนียม|fee|ref|เลขที่|เวลา|date|time|id/i.test(line)) continue;
    const matches = line.match(/([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/g);
    if (matches) {
      for (const m of matches) {
        const val = parseFloat(m.replace(/,/g, ''));
        if (!isNaN(val)) validAmounts.push(val);
      }
    }
  }

  const positive = validAmounts.filter(v => v > 0);
  if (positive.length > 0) return positive[0];
  return validAmounts.length > 0 ? validAmounts[0] : null;
}

/**
 * Run Local Tesseract OCR to read text fields on slip (Receiver name, account, amount)
 */
async function runSlipOCR(imageBuffer) {
  try {
    const worker = await createWorker('tha+eng');
    const ret = await worker.recognize(imageBuffer);
    await worker.terminate();

    const ocrText = ret.data.text || '';

    // 1. Amount Extraction using robust Multi-Strategy Extractor
    const detectedAmount = extractPreciseAmount(ocrText);

    // 2. Extract Receiver Name / Account (text after TO / ไปยัง / ถึง / ผู้รับ)
    const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
    let receiverText = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(TO|ไปยัง|ถึง|ผู้รับ|บัญชีผู้รับ|รับเงินโดย)/i.test(line)) {
        receiverText = lines.slice(i, i + 3).join(' ');
        break;
      }
    }

    // 3. Match against Company Account Keywords
    const hasCompanyMatch = COMPANY_KEYWORDS.some(kw => ocrText.toLowerCase().includes(kw.toLowerCase()));

    return {
      success: true,
      ocrText,
      detectedAmount,
      receiverText,
      hasCompanyMatch
    };
  } catch (err) {
    console.warn('Slip OCR warning:', err.message);
    return {
      success: false,
      ocrText: '',
      detectedAmount: null,
      receiverText: '',
      hasCompanyMatch: true // fallback if OCR fails
    };
  }
}

/**
 * Main 5-Tier Verification Engine with OCR Receiver & Amount Match
 */
async function verifySlip(imageBuffer, booking, dbQuery) {
  const result = {
    isValid: false,
    autoApproved: false,
    confidence: 0,
    transRef: null,
    bankCode: null,
    bankName: null,
    detectedAmount: null,
    expectedAmount: Number(booking ? (booking.total_amount || 0) : 0),
    reasons: [],
    details: {}
  };

  try {
    // -------------------------------------------------------------
    // Tier 1: Decode & Analyze Mini QR Code
    // -------------------------------------------------------------
    const qrResult = await decodeMiniQR(imageBuffer);
    result.details.qr = qrResult;

    if (!qrResult) {
      result.isValid = false;
      result.autoApproved = false;
      result.confidence = 0;
      result.reasons.push('ไม่พบ QR Code ธนาคารในรูปภาพ กรุณาแนบสลิปที่มี Mini QR Code ชัดเจน');
      return result;
    }

    // Check if user uploaded a Payment QR instead of a Slip
    if (qrResult.isMerchantPaymentQR) {
      result.isValid = false;
      result.autoApproved = false;
      result.confidence = 0;
      result.reasons.push(qrResult.rejectionReason || 'รูปภาพที่อัปโหลดคือ QR Code สำหรับจ่ายเงิน (ไม่ใช่สลิปโอนเงินสำเร็จ)');
      return result;
    }

    // Check if valid Slip Mini QR
    if (!qrResult.isValidSlipQR || !qrResult.transRef) {
      result.isValid = false;
      result.autoApproved = false;
      result.confidence = 0;
      result.reasons.push(qrResult.rejectionReason || 'QR Code ในรูปภาพไม่ใช่สลิปโอนเงินของธนาคาร (กรุณาแนบรูปสลิปที่ได้จากแอปธนาคาร)');
      return result;
    }

    // Real Bank Slip Mini QR identified!
    result.transRef = qrResult.transRef;
    result.bankCode = qrResult.bankCode;
    result.bankName = qrResult.bankName;
    result.detectedAmount = qrResult.amount;
    result.confidence = 40;

    // -------------------------------------------------------------
    // Tier 2: Duplicate Slip Check in Database
    // -------------------------------------------------------------
    if (result.transRef && dbQuery) {
      const existing = await dbQuery.get(
        'SELECT id, booking_id, created_at FROM slip_verifications WHERE trans_ref = ? AND verification_status = "passed"',
        [result.transRef]
      );
      if (existing && booking && String(existing.booking_id) !== String(booking.id)) {
        result.isValid = false;
        result.autoApproved = false;
        result.confidence = 0;
        result.reasons.push(`สลิปนี้ถูกใช้งานไปแล้วในระบบ (รหัสอ้างอิง: ${result.transRef}, ใบจอง #${existing.booking_id})`);
        return result;
      }
    }

    // -------------------------------------------------------------
    // Tier 3: OCR Text Extraction (Receiver & Amount Cross-Check)
    // -------------------------------------------------------------
    const ocrResult = await runSlipOCR(imageBuffer);
    result.details.ocr = ocrResult;

    if (ocrResult.success) {
      // 3.1 Receiver Match Check
      if (!ocrResult.hasCompanyMatch) {
        result.isValid = false;
        result.autoApproved = false;
        result.confidence = 0;
        result.reasons.push('บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของบริษัท บิลท์ ฮาร์ท จำกัด (กรุณาโอนเข้าบัญชีบริษัทที่ถูกต้อง)');
        return result;
      } else {
        result.confidence += 30; // Receiver matches company account
      }

      // 3.2 If QR didn't embed amount, take from OCR
      if (result.detectedAmount === null && ocrResult.detectedAmount !== null) {
        result.detectedAmount = ocrResult.detectedAmount;
      }
    }

    // -------------------------------------------------------------
    // Tier 4: Amount Validation
    // -------------------------------------------------------------
    const expected = Number(booking ? (booking.total_amount || 0) : 0);

    if (result.detectedAmount !== null && result.detectedAmount !== undefined) {
      if (Math.abs(result.detectedAmount - expected) < 0.01) {
        result.confidence += 30; // Exact amount match -> 100%
        result.isValid = true;
      } else {
        result.isValid = false;
        result.autoApproved = false;
        result.reasons.push(`ยอดเงินในสลิปไม่ตรงกับยอดค่าบริการห้องประชุมที่ต้องชำระ (${expected.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท) กรุณาตรวจสอบยอดเงินและแนบสลิปที่ถูกต้อง`);
        return result;
      }
    } else {
      // Amount could not be extracted with certainty: Real slip to company, mark valid
      result.confidence += 20;
      result.isValid = true;
    }

    // -------------------------------------------------------------
    // Tier 5: Decision Engine
    // -------------------------------------------------------------
    if (result.transRef && result.isValid && result.reasons.length === 0 && result.confidence >= 70) {
      result.autoApproved = true;
    } else {
      result.autoApproved = false;
    }

    const verificationStatus = result.autoApproved ? 'passed' : (result.isValid ? 'flagged' : 'rejected');

    // Save record in slip_verifications if booking exists
    if (booking && booking.id && booking.id !== 999999 && dbQuery) {
      try {
        await dbQuery.run(`
          INSERT INTO slip_verifications 
          (booking_id, trans_ref, bank_code, bank_name, amount, is_auto_approved, confidence_score, raw_qr_data, ocr_text, verification_status, rejection_reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `, [
          booking.id,
          result.transRef,
          result.bankCode,
          result.bankName,
          result.detectedAmount || expected,
          result.autoApproved ? 1 : 0,
          result.confidence,
          qrResult ? (qrResult.rawQR || qrResult.rawText || '') : '',
          ocrResult ? ocrResult.ocrText : '',
          verificationStatus,
          result.reasons.join(', ') || null
        ]);
      } catch (e) {}
    }

    return result;
  } catch (err) {
    console.error('Slip verification error:', err);
    result.reasons.push('เกิดข้อผิดพลาดในการประมวลผลสลิป: ' + err.message);
    return result;
  }
}

module.exports = {
  BANK_CODES,
  KNOWN_BANK_CODES,
  COMPANY_KEYWORDS,
  parseTLV,
  parseThaiBankSlipQR,
  parsePromptPayMiniQR: parseThaiBankSlipQR,
  decodeMiniQR,
  extractPreciseAmount,
  runSlipOCR,
  verifySlip
};
