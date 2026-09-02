const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const jsQR = require('jsqr');
const Jimp = require('jimp');

let TessCoreModule = null;
try {
  TessCoreModule = require('tesseract.js-core/tesseract-core-simd-lstm');
} catch (_) {
  try {
    TessCoreModule = require('tesseract.js-core/tesseract-core-lstm');
  } catch (__) {
    TessCoreModule = require('tesseract.js-core/tesseract-core');
  }
}

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

// Legacy exported labels only; never sufficient for automatic receiver approval.
const COMPANY_KEYWORDS = ['บิลท์', 'บิ้วท์', 'ปิลท์', 'built', 'heart', 'bwork', 'b-work', '38429', '0125554000401'];

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/บริษัท|จำกัด|มหาชน|บจก|หจก|บัญชี|เลขที่|ผู้รับ|นาย|นางสาว|นาง/g, '')
    .replace(/[^a-z0-9ก-๙]/g, '');
}

function accountDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

async function loadCompanyAccountConfig(dbQuery) {
  const defaults = {
    companyName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    accountNumber: '329-1-38429-0',
    bankName: 'ธนาคารกรุงศรีอยุธยา',
    taxId: '0125554000401',
    promptpayId: '0125554000401'
  };
  if (!dbQuery) return defaults;

  try {
    const keys = [
      'company_name', 'company_tax_id', 'promptpay_id', 'payment_bank_name',
      'payment_bank_account', 'payment_bank_account_name',
      'quotation_bank_account_no', 'quotation_bank_account_name'
    ];
    const placeholders = keys.map(() => '?').join(',');
    const rows = await dbQuery.all(`SELECT key, value FROM settings WHERE key IN (${placeholders})`, keys);
    const settings = Object.fromEntries((rows || []).map(row => [row.key, row.value]));
    return {
      companyName: settings.company_name || defaults.companyName,
      accountName: settings.payment_bank_account_name || settings.quotation_bank_account_name || defaults.accountName,
      accountNumber: settings.payment_bank_account || settings.quotation_bank_account_no || defaults.accountNumber,
      bankName: settings.payment_bank_name || defaults.bankName,
      taxId: settings.company_tax_id || defaults.taxId,
      promptpayId: settings.promptpay_id || settings.company_tax_id || defaults.promptpayId
    };
  } catch (err) {
    console.warn('Load company account settings warning:', err.message);
    return defaults;
  }
}

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

// Parse OCR evidence independently. Booking amounts are used only after extraction.
function toSatang(value) {
  const match = String(value ?? '').match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const satang = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(satang) ? satang : null;
}

function normalizeAmountToken(token) {
  if (/[\u00a0\u202f ]/.test(token) &&
      !/^\d{1,3}(?:[\u00a0\u202f ]\d{3})+(?:[.,]\d{1,2})?$/.test(token)) return null;
  let value = token.replace(/[\u00a0\u202f ]/g, '');
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(value)) value = value.replace(/,/g, '');
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(value)) value = value.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(value)) value = value.replace(',', '.');
  return toSatang(value);
}

function extractPreciseAmount(ocrText) {
  const lines = String(ocrText || '').normalize('NFKC')
    .replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0x0E50))
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const label = /(?:จำนวนเงิน|จํานวนเงิน|จำนวน|จํานวน|ยอดเงิน|ยอดชำระ|ยอดโอน|\bamount\b|\btotal\b)/i;
  const stop = /ค่าธรรมเนียม|\bfee\b|ผู้รับ|ผู้โอน|ผู้ส่ง|ไปยัง|^ถึง|\b(?:from|to|beneficiary|ref(?:erence)?|date|time|note|memo)\b|เลขที่|วันที่|เวลา|บัญชี|พร้อมเพย์|หมายเหตุ/i;
  const labelled = [];
  const currency = [];
  const collect = (line, target) => {
    // Consume complete tokens: never match a suffix of 1300.00 or a reference.
    const tokens = line.match(/(?<![\w.,:+-])\d[\d.,]*(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?(?![\w.,:])/g) || [];
    for (const token of tokens) {
      const value = normalizeAmountToken(token);
      if (value !== null && value > 0) target.push(value);
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matchedLabel = line.match(label);
    if (matchedLabel && !/ค่าธรรมเนียม|\bfee\b/i.test(line)) {
      const remainder = line.slice(matchedLabel.index + matchedLabel[0].length);
      collect(remainder.split(stop)[0], labelled);
      if (!/\d/.test(remainder) && !stop.test(remainder)) {
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          if (stop.test(lines[j]) || label.test(lines[j])) break;
          collect(lines[j], labelled);
          if (/\d/.test(lines[j])) break;
        }
      }
    } else if (!stop.test(line) && !(i > 0 && /ค่าธรรมเนียม|\bfee\b/i.test(lines[i - 1])) &&
      (/บาท|\bbaht\b|\bthb\b|฿/i.test(line) || (lines.length === 1 && /^[\d.,\s]+$/.test(line)))) {
      collect(line, currency);
    }
  }
  const candidates = [...new Set(labelled.length ? labelled : currency)];
  return candidates.length === 1 ? candidates[0] / 100 : null;
}

function extractReceiverSection(ocrText) {
  const lines = String(ocrText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const receiver = /^(?:บัญชีผู้รับ|ผู้รับ(?:เงิน)?|ไปยัง|ถึง|รับเงินโดย|TO\b|Beneficiary\b)\s*[:：-]?\s*/i;
  const boundary = /^(?:จาก|ผู้โอน|ผู้ส่ง|FROM\b|Sender\b|จำนวน|จํานวน|ยอดเงิน|ยอดโอน|ยอดชำระ|Amount\b|Total\b|ค่าธรรมเนียม|Fee\b|วันที่|เวลา|เลขที่รายการ|รหัสอ้างอิง|หมายเหตุ|บันทึก|Reference\b|Ref\b|Date\b|Time\b|Note\b|Memo\b)/i;
  const starts = lines.map((line, index) => receiver.test(line) ? index : -1).filter(index => index >= 0);
  if (starts.length !== 1) return ''; // Ambiguous layout: no whole-slip fallback.
  const section = [lines[starts[0]].replace(receiver, '')];
  for (let i = starts[0] + 1; i < lines.length && i <= starts[0] + 8; i++) {
    if (boundary.test(lines[i]) || receiver.test(lines[i])) break;
    section.push(lines[i]);
  }
  return section.join('\n').trim();
}

function analyzeSlipText(ocrText, accountConfig = {}) {
  const receiverText = extractReceiverSection(ocrText);
  const configuredName = normalizeForMatch(accountConfig.accountName || accountConfig.companyName);
  const hasNameMatch = configuredName.length >= 6 &&
    receiverText.split('\n').map(normalizeForMatch).some(line => line === configuredName);
  const accountTokens = receiverText.match(/(?<![a-z0-9])(?:[0-9xX*•][ -]?){4,}(?![a-z0-9])/gi) || [];
  const matchesAccount = (configured, allowMasked) => {
    const digits = accountDigits(configured);
    if (digits.length < 9) return false;
    return accountTokens.some(token => {
      const candidate = token.replace(/[ -]/g, '').toLowerCase();
      if (candidate.length !== digits.length || (candidate.match(/\d/g) || []).length < 4) return false;
      return [...candidate].every((char, index) => char === digits[index] || (allowMasked && /[x*•]/.test(char)));
    });
  };
  const hasAccountMatch = matchesAccount(accountConfig.accountNumber, true);
  const hasPromptPayMatch = matchesAccount(accountConfig.promptpayId, false);
  const hasTaxIdMatch = matchesAccount(accountConfig.taxId, false);
  const aliases = {
    '002': ['กรุงเทพ', 'bangkokbank', 'bbl'],
    '004': ['กสิกรไทย', 'kasikornbank', 'kbank'],
    '006': ['กรุงไทย', 'krungthai', 'ktb'],
    '011': ['ทหารไทยธนชาต', 'ttb', 'tmbthanachart'],
    '014': ['ไทยพาณิชย์', 'scb', 'siamcommercialbank'],
    '025': ['กรุงศรี', 'krungsri', 'ayudhya', 'bay'],
    '030': ['ออมสิน', 'gsb', 'governmentsavingsbank'],
    '034': ['เพื่อการเกษตร', 'ธกส', 'baac'],
    '065': ['ธนาคารธนชาต', 'tbank', 'thanachartbank'],
    '069': ['เกียรตินาคิน', 'kkp', 'kiatnakin'],
    '073': ['แลนด์แอนด์เฮ้าส์', 'lhbank', 'lhb'],
    '098': ['พัฒนาวิสาหกิจ', 'smedbank']
  };
  const bankCodesIn = text => Object.keys(aliases).filter(code =>
    aliases[code].some(alias => normalizeForMatch(text).includes(normalizeForMatch(alias))));
  const expectedBanks = bankCodesIn(accountConfig.bankName);
  const bankLines = receiverText.split('\n').filter(line => normalizeForMatch(line) !== configuredName);
  const detectedBanks = [...new Set(bankLines.flatMap(bankCodesIn))];
  const hasBankMatch = expectedBanks.length === 1 && detectedBanks.length === 1 && expectedBanks[0] === detectedBanks[0];
  return {
    success: true, ocrText, detectedAmount: extractPreciseAmount(ocrText), receiverText,
    hasCompanyMatch: Boolean(receiverText && hasNameMatch && (hasAccountMatch || hasPromptPayMatch) && hasBankMatch),
    hasNameMatch, hasAccountMatch, hasTaxIdMatch, hasPromptPayMatch, hasBankMatch,
    hasAliasMatch: false
  };
}

/**
 * Run Local In-Process TesseractCore OCR to read text fields on slip (Receiver name, account, amount)
 * Fully local, stable WASM SIMD-LSTM, avoiding thread crashes and missing symbols.
 */
let globalTessInstance = null;
let globalOcrApi = null;
let ocrInitPromise = null;

async function getOCRInstance() {
  if (globalOcrApi) {
    return { Tess: globalTessInstance, api: globalOcrApi };
  }
  if (!ocrInitPromise) {
    ocrInitPromise = (async () => {
      const langPath = path.join(__dirname, 'tessdata');
      const requiredLanguages = ['tha.traineddata.gz', 'eng.traineddata.gz'];
      if (!requiredLanguages.every(file => fs.existsSync(path.join(langPath, file)))) {
        throw new Error('ไม่พบชุดภาษา OCR แบบ local ใน backend/tessdata');
      }

      if (!TessCoreModule) {
        throw new Error('ไม่พบโมดูล tesseract.js-core');
      }

      const Tess = await TessCoreModule();
      const api = new Tess.TessBaseAPI();

      const engGz = fs.readFileSync(path.join(langPath, 'eng.traineddata.gz'));
      const thaGz = fs.readFileSync(path.join(langPath, 'tha.traineddata.gz'));
      Tess.FS.writeFile('/eng.traineddata', zlib.gunzipSync(engGz));
      Tess.FS.writeFile('/tha.traineddata', zlib.gunzipSync(thaGz));

      api.Init('/', 'tha+eng');

      globalTessInstance = Tess;
      globalOcrApi = api;
      return { Tess, api };
    })();
  }
  return ocrInitPromise;
}

let ocrQueue = Promise.resolve();

async function performSlipOCR(imageBuffer, accountConfig = {}) {
  try {
    const { Tess, api } = await getOCRInstance();

    // Native Leptonica image loading and recognition
    Tess.FS.writeFile('/input', imageBuffer);
    const setRes = api.SetImageFile(1, 0);
    if (setRes === 1) {
      throw new Error('ไม่สามารถอ่านไฟล์รูปภาพสลิปได้');
    }

    api.Recognize();
    const ocrText = api.GetUTF8Text() || '';
    api.Clear();
    try { Tess.FS.unlink('/input'); } catch (_) {}

    return analyzeSlipText(ocrText, accountConfig);
  } catch (err) {
    console.warn('Slip OCR warning:', err.message);
    return {
      success: false,
      ocrText: '',
      detectedAmount: null,
      receiverText: '',
      hasCompanyMatch: false,
      hasNameMatch: false,
      hasAccountMatch: false,
      hasTaxIdMatch: false,
      hasPromptPayMatch: false,
      hasBankMatch: false,
      hasAliasMatch: false
    };
  }
}

function runSlipOCR(imageBuffer, accountConfig = {}) {
  const job = ocrQueue.then(() => performSlipOCR(imageBuffer, accountConfig));
  ocrQueue = job.catch(() => undefined);
  return job;
}

/**
 * Main 5-Tier Verification Engine with OCR Receiver & Amount Match
 */
async function verifySlip(imageBuffer, booking, dbQuery, _clientQrData = null, dependencies = {}) {
  const result = {
    isValid: false, eligibleForAutoApproval: false, autoApproved: false, confidence: 0,
    transRef: null, bankCode: null, bankName: null, detectedAmount: null,
    expectedAmount: Number(booking ? (booking.total_amount || 0) : 0), reasons: [], details: {}
  };
  try {
    const decode = dependencies.decodeMiniQR || decodeMiniQR;
    const runOCR = dependencies.runSlipOCR || runSlipOCR;
    const accountConfig = await loadCompanyAccountConfig(dbQuery);
    result.details.accountCheck = {
      bankName: accountConfig.bankName,
      accountSuffix: accountDigits(accountConfig.accountNumber).slice(-5)
    };
    // Only QR decoded from the uploaded image is evidence. Client qr_data is untrusted.
    const qrResult = await decode(imageBuffer);
    result.details.qr = qrResult;
    if (!qrResult) {
      result.reasons.push('ไม่พบ QR Code ธนาคารในรูปภาพ กรุณาแนบสลิปที่มี Mini QR Code ชัดเจน');
      return result;
    }
    if (qrResult.isMerchantPaymentQR) {
      result.reasons.push(qrResult.rejectionReason || 'รูปภาพที่อัปโหลดคือ QR Code สำหรับจ่ายเงิน (ไม่ใช่สลิปโอนเงินสำเร็จ)');
      return result;
    }
    if (!qrResult.isValidSlipQR || !qrResult.transRef) {
      result.reasons.push(qrResult.rejectionReason || 'QR Code ในรูปภาพไม่ใช่สลิปโอนเงินของธนาคาร');
      return result;
    }
    result.transRef = qrResult.transRef;
    result.bankCode = qrResult.bankCode;
    result.bankName = qrResult.bankName;
    result.confidence = 40;

    if (dbQuery) {
      const existing = await dbQuery.get(
        "SELECT booking_id FROM slip_verifications WHERE trans_ref = ? AND verification_status IN ('passed', 'approved', 'auto_approved', 'pending_manual') LIMIT 1",
        [result.transRef]
      );
      const paidBooking = await dbQuery.get(
        "SELECT id FROM bookings WHERE slip_trans_ref = ? AND payment_status = 'paid' LIMIT 1",
        [result.transRef]
      );
      if (existing || paidBooking) {
        result.reasons.push('สลิปนี้ถูกใช้งานไปแล้วในระบบ ไม่สามารถใช้ซ้ำได้');
        return result;
      }
    }

    const ocrResult = await runOCR(imageBuffer, accountConfig);
    result.details.ocr = ocrResult;
    if (!ocrResult.success) {
      result.reasons.push('ระบบอ่านข้อมูลในสลิปไม่สำเร็จ กรุณาใช้สลิปต้นฉบับที่เห็นชื่อผู้รับ ยอดเงิน และ QR ชัดเจน แล้วอัปโหลดใหม่');
      return result;
    }
    result.detectedAmount = ocrResult.detectedAmount;
    if (!ocrResult.hasCompanyMatch) {
      result.reasons.push('บัญชีผู้รับเงินหรือธนาคารปลายทางในสลิปไม่ตรงกับ ' + accountConfig.accountName + ' กรุณาตรวจสอบแล้วอัปโหลดสลิปที่ถูกต้อง');
      return result;
    }
    result.confidence += 30;

    const detectedSatang = toSatang(result.detectedAmount);
    const expectedSatang = toSatang(result.expectedAmount);
    if (detectedSatang === null) {
      result.reasons.push('ระบบอ่านยอดเงินจากสลิปไม่สำเร็จ กรุณาใช้สลิปต้นฉบับที่เห็นยอดเงินชัดเจนแล้วอัปโหลดใหม่');
      return result;
    }
    if (expectedSatang === null || detectedSatang !== expectedSatang) {
      result.reasons.push('ยอดเงินในสลิปไม่ตรงกับยอดค่าบริการห้องประชุมที่ต้องชำระ (' +
        result.expectedAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' บาท) กรุณาตรวจสอบยอดเงินและแนบสลิปที่ถูกต้อง');
      return result;
    }
    // If this QR format carries an amount, it must independently agree too.
    if (qrResult.amount !== null && qrResult.amount !== undefined &&
        toSatang(qrResult.amount) !== detectedSatang) {
      result.reasons.push('ยอดเงินใน Mini QR ไม่ตรงกับยอดเงินที่อ่านได้จากสลิป');
      return result;
    }

    result.confidence += 30;
    result.isValid = true;
    result.eligibleForAutoApproval = result.confidence >= 100;
    return result;
  } catch (err) {
    console.error('Slip verification error:', err);
    result.isValid = false;
    result.eligibleForAutoApproval = false;
    result.autoApproved = false;
    result.reasons.push('เกิดข้อผิดพลาดในการประมวลผลสลิป');
    return result;
  }
}

async function commitVerifiedSlip(verification, booking, dbQuery, completePayment) {
  verification.autoApproved = false;
  if (!verification.isValid || !verification.eligibleForAutoApproval || !verification.transRef) {
    return verification;
  }
  try {
    if (!dbQuery || typeof dbQuery.transaction !== 'function') throw new Error('TRANSACTION_UNAVAILABLE');
    await dbQuery.transaction(async () => {
      const current = await dbQuery.get(
        'SELECT id, total_amount, payment_status FROM bookings WHERE id = ?',
        [booking.id]
      );
      if (!current) throw new Error('BOOKING_NOT_FOUND');
      if (['paid', 'cancelled'].includes(current.payment_status)) throw new Error('BOOKING_STATE_CHANGED');
      if (toSatang(current.total_amount) !== toSatang(verification.expectedAmount)) throw new Error('BOOKING_AMOUNT_CHANGED');

      const existing = await dbQuery.get(
        'SELECT booking_id FROM slip_verifications WHERE trans_ref = ? LIMIT 1',
        [verification.transRef]
      );
      const paidBooking = await dbQuery.get(
        "SELECT id FROM bookings WHERE slip_trans_ref = ? AND payment_status = 'paid' LIMIT 1",
        [verification.transRef]
      );
      if (existing || paidBooking) throw new Error('DUPLICATE_SLIP');

      const qr = verification.details.qr || {};
      const ocr = verification.details.ocr || {};
      await dbQuery.run(
        "INSERT INTO slip_verifications " +
        "(booking_id, trans_ref, bank_code, bank_name, amount, is_auto_approved, " +
        "confidence_score, raw_qr_data, ocr_text, verification_status, rejection_reason, created_at) " +
        "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'passed', NULL, datetime('now', 'localtime'))",
        [
          booking.id, verification.transRef, verification.bankCode, verification.bankName,
          verification.detectedAmount, verification.confidence, qr.rawQR || '', ocr.ocrText || ''
        ]
      );
      const update = await completePayment();
      if (!update || update.changes !== 1) throw new Error('PAYMENT_UPDATE_FAILED');
    });
    // A successful scan is NOT a successful payment until the transaction commits.
    verification.autoApproved = true;
    return verification;
  } catch (err) {
    const duplicate = /DUPLICATE_SLIP|UNIQUE constraint/i.test(String(err && err.message));
    verification.isValid = false;
    verification.eligibleForAutoApproval = false;
    verification.autoApproved = false;
    verification.confidence = 0;
    verification.errorCode = duplicate ? 'DUPLICATE_SLIP' : 'VERIFICATION_PERSISTENCE_FAILED';
    verification.reasons = [duplicate
      ? 'สลิปนี้ถูกใช้งานไปแล้วในระบบ ไม่สามารถใช้ซ้ำได้'
      : 'ระบบไม่สามารถบันทึกผลตรวจสอบสลิปได้ กรุณาลองอัปโหลดอีกครั้ง'];
    return verification;
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
  toSatang,
  extractReceiverSection,
  analyzeSlipText,
  commitVerifiedSlip,
  runSlipOCR,
  loadCompanyAccountConfig,
  verifySlip
};
