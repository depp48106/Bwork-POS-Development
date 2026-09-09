/**
 * frontend/src/utils/browserSlipVerifier.js
 *
 * Browser-side OCR & QR assistant for POS Staff Review Modal.
 * Acts STRICTLY as decision support. Never triggers automatic approval.
 */

import { createWorker } from 'tesseract.js';
import jsQR from 'jsqr';
import {
  BANK_CODES,
  toSatang,
  extractPreciseAmount,
  extractReceiverSection,
  normalizeReceiverLine,
  parseThaiBankSlipQR,
  analyzeSlipText
} from '../../../shared/slipVerificationCore.mjs';

// Singleton worker promise to avoid repeatedly downloading/initializing workers
let tesseractWorkerPromise = null;

export async function getTesseractWorker(onProgress = null) {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      // Create worker for Thai and English
      const worker = await createWorker('tha+eng', 1, {
        logger: (m) => {
          if (onProgress && m.status === 'recognizing text') {
            onProgress(Math.round((m.progress || 0) * 100));
          }
        }
      });
      return worker;
    })();
  }
  return tesseractWorkerPromise;
}

/**
 * Loads an image from URL into an HTMLImageElement with CORS enabled.
 */
export function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('ไม่สามารถโหลดรูปภาพสลิปได้ (CORS หรือ URL ไม่ถูกต้อง)'));
    img.src = url;
  });
}

/**
 * Decodes Mini QR from an image element using an offscreen canvas and jsQR.
 */
export function decodeBrowserQR(imgElement) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    canvas.width = imgElement.naturalWidth || imgElement.width;
    canvas.height = imgElement.naturalHeight || imgElement.height;
    ctx.drawImage(imgElement, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth'
    });

    if (!code || !code.data) return null;

    const raw = code.data;
    const parsed = parseThaiBankSlipQR(raw);
    if (parsed) {
      return { ...parsed, isPaymentQR: Boolean(parsed.isMerchantPaymentQR) };
    }

    return {
      isValidSlipQR: false,
      isPaymentQR: false,
      rawQR: raw,
      transRef: null
    };
  } catch (err) {
    console.warn('[browserSlipVerifier] QR decode failed:', err);
    return null;
  }
}

/**
 * Helper to mask personal names and accounts for POS display.
 */
export function maskName(name) {
  if (!name) return '-';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].length > 3 ? parts[0].slice(0, 2) + '***' : parts[0];
  }
  return parts[0] + ' ' + parts.slice(1).map(p => p.slice(0, 1) + '***').join(' ');
}

export function maskAccount(acc) {
  if (!acc) return '-';
  const digits = String(acc).replace(/[^0-9]/g, '');
  if (digits.length >= 4) {
    return 'ลงท้าย ' + digits.slice(-4);
  }
  return acc;
}

/**
 * Main Browser Assistant Function:
 * Analyzes slip image on staff browser and returns structured comparison result.
 */
export async function analyzeSlipInBrowser(imageUrl, bookingInfo, settings, onProgress = null) {
  const startTime = performance.now();
  const result = {
    status: 'processing', // 'completed' | 'incomplete' | 'error'
    timing: {
      qrTimeMs: 0,
      ocrTimeMs: 0,
      totalTimeMs: 0
    },
    qr: {
      detected: false,
      isValidSlipQR: false,
      isPaymentQR: false,
      bankName: '-',
      transRef: null,
      transRefMasked: '-'
    },
    amount: {
      expected: bookingInfo?.total_amount || 0,
      detected: null,
      matched: false, // true | false | null
      statusText: 'กำลังอ่าน...'
    },
    receiver: {
      detectedName: '-',
      detectedNameMasked: '-',
      detectedAccount: '-',
      detectedAccountMasked: '-',
      template: 'unknown',
      matched: false, // true | false | null
      statusText: 'กำลังอ่าน...'
    },
    verificationTier: 'manual_review',
    decisionSupportMessage: '',
    messageType: 'info', // 'success' | 'warning' | 'error' | 'info'
    rawOcrSnippet: '',
    error: null
  };

  try {
    // 1. Load image
    const imgElement = await loadImageElement(imageUrl);

    // 2. Decode QR
    const qrStart = performance.now();
    const qrResult = decodeBrowserQR(imgElement);
    result.timing.qrTimeMs = Math.round(performance.now() - qrStart);

    if (qrResult) {
      result.qr.detected = true;
      result.qr.isValidSlipQR = !!qrResult.isValidSlipQR;
      result.qr.isPaymentQR = !!qrResult.isPaymentQR;
      result.qr.bankName = qrResult.bankName || '-';
      result.qr.transRef = qrResult.transRef || null;
      if (qrResult.transRef) {
        result.qr.transRefMasked = qrResult.transRef.length > 8
          ? qrResult.transRef.slice(0, 6) + '...' + qrResult.transRef.slice(-4)
          : qrResult.transRef;
      }
    }

    if (result.qr.isPaymentQR) {
      result.status = 'completed';
      result.amount.statusText = 'ไม่ใช่สลิปโอน';
      result.receiver.statusText = 'ตรวจพบ Payment QR';
      result.decisionSupportMessage = 'รูปภาพที่แนบคือ QR Code สำหรับสแกนจ่ายเงิน (Payment QR) ไม่ใช่สลิปหลักฐานการโอนเงินสำเร็จ กรุณาตรวจสอบก่อนตัดสินใจ';
      result.messageType = 'error';
      result.timing.totalTimeMs = Math.round(performance.now() - startTime);
      return result;
    }

    // 3. Run OCR
    const ocrStart = performance.now();
    const worker = await getTesseractWorker(onProgress);
    const ocrResponse = await worker.recognize(imgElement, {}, { text: true, blocks: true });
    result.timing.ocrTimeMs = Math.round(performance.now() - ocrStart);
    result.timing.totalTimeMs = Math.round(performance.now() - startTime);

    const ocrText = ocrResponse?.data?.text || '';
    result.rawOcrSnippet = ocrText.slice(0, 150);

    // 4. Run Shared Pure Analysis
    const accountConfig = {
      company_name: settings?.company_name || settings?.accountName || 'บริษัท บิลท์ ฮาร์ท จำกัด',
      accountName: settings?.payment_bank_account_name || settings?.company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด',
      payment_bank_account: settings?.payment_bank_account || '',
      payment_bank_name: settings?.payment_bank_name || '',
      company_tax_id: settings?.company_tax_id || '',
      promptpay_id: settings?.promptpay_id || ''
    };

    const analysis = analyzeSlipText(ocrText, accountConfig, qrResult, ocrResponse?.data);
    result.evidence = analysis.evidence;
    result.evidenceState = analysis.evidenceState;
    result.verificationTier = analysis.verificationTier;

    // 5. Evaluate Amount
    const detectedAmt = analysis.detectedAmount;
    result.amount.detected = detectedAmt;
    if (detectedAmt !== null) {
      const expSatang = toSatang(bookingInfo?.total_amount || 0);
      const detSatang = toSatang(detectedAmt);
      if (expSatang === detSatang) {
        result.amount.matched = true;
        result.amount.statusText = 'ตรง';
      } else {
        result.amount.matched = false;
        result.amount.statusText = 'ไม่ตรง';
      }
    } else {
      result.amount.matched = null;
      result.amount.statusText = 'อ่านไม่ได้';
    }

    // 6. Evaluate Receiver
    result.receiver.template = analysis.detectedTemplate || analysis.receiverTemplate;
    const isReceiverValid = analysis.hasCompanyMatch;
    result.receiver.matched = isReceiverValid;
    result.receiver.statusText = analysis.receiverOcrUncertain ? 'อ่านไม่ชัดเจน' : isReceiverValid ? 'ตรง' : (analysis.receiverText ? 'ไม่ตรง' : 'ตรวจไม่ได้');

    // Extract first line of receiver for masked display
    const firstReceiverLine = (analysis.receiverText || '').split(/\r?\n/)[0] || '';
    result.receiver.detectedName = firstReceiverLine || '-';
    result.receiver.detectedNameMasked = firstReceiverLine ? maskName(firstReceiverLine) : '-';

    // Mask configured account for display
    result.receiver.detectedAccountMasked = maskAccount(analysis.evidence.receiver.accountMasked);

    // 7. Contextual Helper Message (Strictly non-authoritative Decision Support)
    result.status = 'completed';

    if (result.amount.matched === true && isReceiverValid) {
      result.decisionSupportMessage = 'ข้อมูลที่ระบบอ่านสอดคล้องกับรายการจอง กรุณาตรวจสอบรูปสลิปอีกครั้งก่อนอนุมัติ';
      result.messageType = 'success';
    } else if (result.amount.matched === false) {
      result.decisionSupportMessage = `ยอดเงินในสลิปที่อ่านได้ (฿${Number(detectedAmt || 0).toLocaleString()}) ไม่ตรงกับยอดที่ต้องชำระ (฿${Number(bookingInfo?.total_amount || 0).toLocaleString()}) กรุณาตรวจสอบก่อนอนุมัติ`;
      result.messageType = 'warning';
    } else if (analysis.receiverOcrUncertain) {
      result.decisionSupportMessage = 'ชื่อผู้รับอ่านได้ไม่ชัดเจน กรุณาตรวจสอบรูปสลิปด้วยตนเอง';
      result.messageType = 'warning';
    } else if (isReceiverValid === false && analysis.receiverText) {
      result.decisionSupportMessage = 'ข้อมูลผู้รับในสลิปไม่ตรงกับบัญชีที่กำหนด กรุณาตรวจสอบความถูกต้องของสลิป';
      result.messageType = 'warning';
    } else if (result.amount.matched === null || !analysis.receiverText) {
      result.status = 'incomplete';
      result.decisionSupportMessage = 'ระบบไม่สามารถอ่านข้อมูลสลิปได้ครบ กรุณาตรวจสอบด้วยตนเอง';
      result.messageType = 'info';
    } else {
      result.decisionSupportMessage = 'กรุณาตรวจสอบรายละเอียดในสลิปด้วยตนเองก่อนดำเนินการ';
      result.messageType = 'info';
    }

    return result;
  } catch (err) {
    console.error('[browserSlipVerifier] Error during verification:', err);
    result.status = 'error';
    result.error = err.message || 'เกิดข้อผิดพลาดในการประมวลผล OCR';
    result.decisionSupportMessage = 'ไม่สามารถตรวจอัตโนมัติ กรุณาตรวจสอบด้วยตนเอง';
    result.messageType = 'error';
    result.timing.totalTimeMs = Math.round(performance.now() - startTime);
    return result;
  }
}
