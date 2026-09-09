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
const { BANK_CODES, KNOWN_BANK_CODES, COMPANY_KEYWORDS, normalizeForMatch, accountDigits, parseTLV, parseThaiBankSlipQR, toSatang, extractPreciseAmount, extractReceiverSection, analyzeSlipText } = require('../shared/slipVerificationCore.mjs');

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

async function performSlipOCR(imageBuffer, accountConfig = {}, qrResult = null) {
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
    let metadata = null;
    // Serialize existing recognition results, never call Recognize again.
    try { if (typeof api.GetTSVText === 'function') metadata = { tsv: api.GetTSVText(0) || '' }; } catch (_) {}
    api.Clear();
    try { Tess.FS.unlink('/input'); } catch (_) {}

    return analyzeSlipText(ocrText, accountConfig, qrResult, metadata);
  } catch (err) {
    console.warn('Slip OCR warning:', err.message);
    return {
      success: false,
      ocrText: '',
      detectedAmount: null,
      receiverText: '',
      receiverTemplate: 'none',
      verificationTier: 'manual_review',
      hasCompanyMatch: false,
      hasNameMatch: false,
      hasAccountMatch: false,
      hasTaxIdMatch: false,
      hasPromptPayMatch: false,
      hasBankMatch: false,
      hasBankConflict: false,
      hasAliasMatch: false
    };
  }
}

function runSlipOCR(imageBuffer, accountConfig = {}, qrResult = null) {
  const job = ocrQueue.then(() => performSlipOCR(imageBuffer, accountConfig, qrResult));
  ocrQueue = job.catch(() => undefined);
  return job;
}

/**
 * Main 5-Tier Verification Engine with OCR Receiver & Amount Match
 */
async function verifySlip(imageBuffer, booking, dbQuery, _clientQrData = null, dependencies = {}) {
  const result = {
    isValid: false,
    eligibleForAutoApproval: false,
    autoApproved: false,
    verificationTier: 'manual_review',
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

    const ocrResult = await runOCR(imageBuffer, accountConfig, qrResult);
    result.details.ocr = ocrResult;
    result.verificationTier = ocrResult.verificationTier || 'manual_review';

    // SLIP-PARSER-PHASE4K: Strict Runtime Shadow Integration for Datetime ROI
    // Strictly opt-in via exact process.env.BWORK_SLIP_ROI_SHADOW === 'true'.
    // Failure in shadow must NEVER break baseline verify or alter payment decisions.
    const isRoiShadowEnabled = (dependencies.roiShadowEnabled !== undefined)
      ? dependencies.roiShadowEnabled === true
      : (process.env.BWORK_SLIP_ROI_SHADOW === 'true');

    if (isRoiShadowEnabled) {
      try {
        const policyModPath = '../shared/' + 'slipRoi' + 'DatetimePolicy.mjs';
        const { determinePhase4gRoiTarget, extractDatetimeRoi, mergeDatetimeRoi } = require(policyModPath);
        const layoutLines = ocrResult.evidence?.layout || [];
        const jimpLib = dependencies.Jimp || Jimp;
        const jimpImg = await jimpLib.read(imageBuffer);
        if (!jimpImg || !jimpImg.bitmap || jimpImg.bitmap.width <= 0 || jimpImg.bitmap.height <= 0) {
          throw new Error('Invalid image dimensions for shadow ROI');
        }
        const size = { width: jimpImg.bitmap.width, height: jimpImg.bitmap.height };

        const decision = determinePhase4gRoiTarget(ocrResult.evidence, layoutLines, size, 'policy1');
        const primaryTarget = decision.primary;

        if (primaryTarget && primaryTarget.shouldTrigger && primaryTarget.bbox) {
          const bbox = primaryTarget.bbox;
          const cropX = Math.max(0, Math.min(size.width - 20, Math.floor(bbox.x0)));
          const cropY = Math.max(0, Math.min(size.height - 20, Math.floor(bbox.y0)));
          const cropW = Math.max(20, Math.min(size.width - cropX, Math.ceil(bbox.x1 - bbox.x0)));
          const cropH = Math.max(20, Math.min(size.height - cropY, Math.ceil(bbox.y1 - bbox.y0)));

          const crop = jimpImg.clone().crop(cropX, cropY, cropW, cropH);
          crop.greyscale();
          crop.contrast(0.15);
          crop.scale(1.75);
          const cropBuffer = await crop.getBufferAsync(jimpLib.MIME_PNG || 'image/png');

          // Pass 2: single targeted ROI OCR (max 2 total)
          const roiResult = await runOCR(cropBuffer);
          const roiExtraction = extractDatetimeRoi(roiResult?.ocrText, roiResult?.evidence?.layout);
          const mergedEvidence = mergeDatetimeRoi(ocrResult.evidence, roiExtraction);

          const baseDate = ocrResult.evidence?.datetime?.date ?? null;
          const baseTime = ocrResult.evidence?.datetime?.time ?? null;
          const roiDate = roiExtraction?.date ?? null;
          const roiTime = roiExtraction?.time ?? null;

          result.details.shadowDatetimeRoi = {
            enabled: true,
            triggered: true,
            region: primaryTarget.region || null,
            date: roiDate,
            time: roiTime,
            dateConflict: Boolean(mergedEvidence?.datetime?.roiAdvisory?.roiConflict && roiExtraction?.provenance?.dateConflict),
            timeConflict: Boolean(mergedEvidence?.datetime?.roiAdvisory?.roiConflict && roiExtraction?.provenance?.timeConflict),
            paymentUseAllowed: false,
            comparison: {
              dateSame: (baseDate !== null && roiDate !== null) ? baseDate === roiDate : null,
              timeSame: (baseTime !== null && roiTime !== null) ? baseTime === roiTime : null
            }
          };
        } else {
          result.details.shadowDatetimeRoi = {
            enabled: true,
            triggered: false,
            region: null,
            date: null,
            time: null,
            dateConflict: false,
            timeConflict: false,
            paymentUseAllowed: false,
            comparison: {
              dateSame: null,
              timeSame: null
            }
          };
        }
      } catch (shadowErr) {
        // Shadow failure must NEVER break baseline verify
        result.details.shadowDatetimeRoi = {
          enabled: true,
          triggered: false,
          region: null,
          date: null,
          time: null,
          dateConflict: false,
          timeConflict: false,
          paymentUseAllowed: false,
          shadowError: true,
          comparison: {
            dateSame: null,
            timeSame: null
          }
        };
      }
    }

    if (!ocrResult.success) {
      result.reasons.push('ระบบอ่านข้อมูลในสลิปไม่สำเร็จ กรุณาใช้สลิปต้นฉบับที่เห็นชื่อผู้รับ ยอดเงิน และ QR ชัดเจน แล้วอัปโหลดใหม่');
      return result;
    }
    result.detectedAmount = ocrResult.detectedAmount;
    // Extraction improvement is evidence, not permission to expand payment eligibility.
    if (ocrResult.evidence?.amount?.evidence?.recoveredAcrossFeeContext === true) {
      result.verificationTier = 'manual_review';
      result.reasons.push('ข้อมูลยอดโอนแยกจากค่าธรรมเนียมไม่ชัดเจน กรุณาแนบสลิปต้นฉบับที่แสดงยอดโอนชัดเจน');
      return result; // Existing failure route; NOT the receiver-only manual-review path.
    }
    if (!ocrResult.hasCompanyMatch && !ocrResult.receiverOcrUncertain) {
      result.reasons.push('บัญชีผู้รับเงินหรือธนาคารปลายทางในสลิปไม่ตรงกับ ' + accountConfig.accountName + ' กรุณาตรวจสอบแล้วอัปโหลดสลิปที่ถูกต้อง');
      return result;
    }
    result.confidence += (result.verificationTier === 'strict_verified' ? 30 : 20);

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
    if (ocrResult.receiverOcrUncertain) {
      result.manualReviewRequired = true;
      result.evidenceState = 'uncertain';
      result.verificationTier = 'manual_review';
      result.reasons.push('ข้อมูลชื่อผู้รับอ่านได้ไม่ชัดเจน กรุณารอเจ้าหน้าที่ตรวจสอบสลิป');
      return result;
    }
    result.eligibleForAutoApproval = (result.verificationTier === 'strict_verified' || result.verificationTier === 'template_verified');
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
