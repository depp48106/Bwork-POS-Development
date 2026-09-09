import { normalizeLayout, layoutRoles, temporalAndReference, spatialAmount } from './slipLayoutEvidence.mjs';
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
    .replace(/\u0E4D\u0E32/g, '\u0E33')
    .normalize('NFKC')
    .replace(/\u0E4D\u0E32/g, '\u0E33')
    .trim()
    .replace(/^(?:บริษัท|บจก\.?|หจก\.?|บัญชี|ผู้รับ|นาย|นางสาว|นาง)\s*/u, '')
    .replace(/\s*(?:จำกัด(?:\s*มหาชน)?|co\.?\s*,?\s*ltd\.?|ltd\.?)$/u, '')
    .replace(/[^a-z0-9ก-๙*•]/g, '');
}

function accountDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseTLV(str) {
  const result = {};
  let i = 0;
  while (i < str.length) {
    const tag = str.substring(i, i + 2);
    const lengthText = str.substring(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthText)) throw new Error('Malformed QR TLV');
    const len = Number(lengthText);
    if (i + 4 + len > str.length || Object.hasOwn(result, tag)) throw new Error('Malformed QR TLV');
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
          amount: root['54'] ? (toSatang(root['54']) === null ? (() => { throw new Error('Invalid QR amount'); })() : Number(root['54'])) : null,
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

function extractAmountEvidence(ocrText) {
  const lines = String(ocrText || '').normalize('NFKC')
    .replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0x0E50))
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const label = /จำนวนเงิน|จํานวนเงิน|จำนวน|จํานวน|ยอดเงิน|ยอดชำระ|ยอดโอน|\bamount\b|\btotal\b/i;
  const negative = /ยอด(?:เงิน)?คงเหลือ|ค่าธรรมเนียม|\b(?:balance|fee)\b/i;
  const boundary = /ผู้รับ|ผู้โอน|ผู้ส่ง|ไปยัง|^ถึง|\b(?:from|to|sender|receiver|beneficiary|ref(?:erence)?|date|time|note|memo|account|phone)\b|เลขที่|วันที่|เวลา|บัญชี|พร้อมเพย์|หมายเหตุ/i;
  const currency = /บาท|\bbaht\b|\bthb\b|฿/i;
  const candidates = [];
  let amountLabel = -10, excludedRegion = false, recoveredAcrossFeeContext = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (negative.test(line)) {
      // A standalone balance/fee label owns the next numeric line.
      excludedRegion = !/\d/.test(line);
      if (/ค่าธรรมเนียม|\bfee\b/i.test(line)) recoveredAcrossFeeContext = true;
      if (/balance|ยอด(?:เงิน)?คงเหลือ/i.test(line)) amountLabel = -10;
      continue;
    }
    const matched = line.match(label);
    if (matched) { amountLabel = i; excludedRegion = false; recoveredAcrossFeeContext = false; }
    else if (boundary.test(line)) { amountLabel = -10; excludedRegion = false; recoveredAcrossFeeContext = false; continue; }
    else if (excludedRegion) {
      if (/\d/.test(line)) excludedRegion = false;
      continue;
    }
    const distance = i - amountLabel;
    const hasLabel = distance >= 0 && distance <= 2;
    const hasCurrency = currency.test(line);
    const standalone = lines.length === 1 && /^[\d.,\s]+$/.test(line);
    if (!hasLabel && !hasCurrency && !standalone) continue;
    const text = matched ? line.slice(matched.index + matched[0].length).split(boundary)[0] : line;
    // Complete tokens only; prevent suffixes, timestamps, dates, phones and references.
    const tokens = text.match(/(?<![\w.,:/+-])\d[\d.,]*(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?(?![\w.,:/-])/g) || [];
    for (const raw of tokens) {
      const satang = normalizeAmountToken(raw);
      const invalid = satang === null || satang <= 0 || /^\d{9,}$/.test(raw);
      candidates.push({
        raw, value: invalid ? null : satang / 100, lineIndex: i, source: 'ocr',
        labelDistance: hasLabel ? distance : null, formatScore: invalid ? 0 : 10,
        contextScore: hasLabel ? 60 : hasCurrency ? 40 : 30,
        ocrConfidence: null, finalScore: invalid ? 0 : (hasLabel ? 60 : hasCurrency ? 40 : 30) + 10,
        evidence: { recoveredAcrossFeeContext },
        warnings: invalid ? ['invalid_amount_token'] : recoveredAcrossFeeContext ? ['amount_recovered_across_fee'] : []
      });
    }
  }
  const ranked = [...new Map(candidates.filter(c => c.value !== null)
    .sort((a,b) => a.finalScore-b.finalScore ||
      Number(b.evidence.recoveredAcrossFeeContext)-Number(a.evidence.recoveredAcrossFeeContext)).map(c => [c.value,c])).values()]
    .sort((a,b) => b.finalScore-a.finalScore);
  const ambiguous = ranked.length > 1 && ranked[0].finalScore - ranked[1].finalScore < 20;
  const malformed = candidates.some(c => c.value === null && c.labelDistance !== null);
  const best = !ambiguous && !malformed ? ranked[0] : null;
  return { value: best?.value ?? null, raw: best?.raw ?? null, candidates,
    evidence: { recoveredAcrossFeeContext: best?.evidence.recoveredAcrossFeeContext ?? false },
    confidenceTier: best ? 'strong' : 'uncertain',
    warnings: ambiguous ? ['amount_ambiguous'] : malformed ? ['invalid_amount_token'] : best ? [...best.warnings] : ['amount_missing'] };
}

function extractPreciseAmount(ocrText) {
  return extractAmountEvidence(ocrText).value;
}

function extractReceiverSection(ocrText) {
  const lines = String(ocrText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const receiver = /^(?:บัญชีผู้รับ|ผู้\s*รับ(?:เงิน)?|ไปยัง|ถึง|รับเงินโดย|TO\b|Receiver\b|Beneficiary\b)\s*[:：-]?\s*/i;
  const boundary = /^(?:จาก|ผู้โอน|ผู้ส่ง|FROM\b|Sender\b|จำนวน|จํานวน|ยอดเงิน|ยอดโอน|ยอดชำระ|Amount\b|Total\b|ค่าธรรมเนียม|Fee\b|วันที่|เวลา|เลขที่รายการ|รหัสอ้างอิง|หมายเหตุ|บันทึก|Reference\b|Ref\b|Date\b|Time\b|Note\b|Memo\b)/i;
  const starts = lines.map((line, index) => receiver.test(line) ? index : -1).filter(index => index >= 0);

  if (starts.length === 1) {
    const section = [lines[starts[0]].replace(receiver, '')];
    for (let i = starts[0] + 1; i < lines.length && i <= starts[0] + 8; i++) {
      if (boundary.test(lines[i]) || receiver.test(lines[i])) break;
      section.push(lines[i]);
    }
    const text = section.join('\n').trim();
    return { text, template: 'standard_labeled' };
  }

  // Ambiguous layout: multiple receiver markers found -> fail-safe, cannot pick safely
  if (starts.length > 1) {
    return { text: '', template: 'ambiguous' };
  }

  // Verified KBank Structural Template (when "TO / ไปยัง" keyword is absent in app design)
  // Proven from real KBank K+ slip layout:
  // - Sender bank marker: /(?:ธ\.กสิกรไทย|kbank|k\+)/i
  // - Followed by sender account pattern
  // - Trailing boundary: /(?:เลขที่รายการ|รหัสอ้างอิง|transaction\s*no|ref\s*id)/i
  const kbankSenderIdx = lines.findIndex(l => /(?:ธ\.กสิกรไทย|kbank|kasikorn|k\+)/i.test(l));
  const kbankRefIdx = lines.findIndex(l => /(?:เลขที่รายการ|รหัสอ้างอิง|transaction\s*no|ref\s*id)/i.test(l));

  if (kbankSenderIdx >= 0 && kbankRefIdx > kbankSenderIdx + 1) {
    let senderEndIdx = -1;
    for (let i = kbankSenderIdx; i < kbankRefIdx; i++) {
      if (/[\d๐-๙xX*•%-]{5,}/.test(lines[i])) {
        senderEndIdx = i;
        break;
      }
    }
    if (senderEndIdx < 0) return { text: '', template: 'ambiguous' };
    const receiverStart = senderEndIdx + 1;
    if (receiverStart < kbankRefIdx) {
      const section = [];
      for (let i = receiverStart; i < kbankRefIdx && i <= receiverStart + 6; i++) {
        if (boundary.test(lines[i])) break;
        section.push(lines[i]);
      }
      const text = section.join('\n').trim();
      if (text.length > 0) {
        return { text, template: 'kbank_structural' };
      }
    }
  }

  return { text: '', template: 'unrecognized' };
}

export function comparisonName(line) {
  // A single isolated digit before an explicit Thai name prefix is OCR noise.
  // Never strip digits from unlabelled names, and never consult receiver settings.
  return String(line || '').replace(/^\d\s+(?=(?:บริษัท|บจก\.|หจก\.|นาย|นางสาว|นาง)\s)/u, '');
}

function normalizeReceiverLine(line) {
  return normalizeForMatch(comparisonName(line));
}

// Extraction never accepts booking/configured receiver data.
export function extractSlipEvidence(ocrText, qrResult = null, metadata = null) {
  const receiverSection = extractReceiverSection(ocrText);
  const lines = String(ocrText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const senderMarker = /^(?:จาก|ผู้โอน|ผู้ส่ง|From\b|Sender\b)\s*[:：-]?\s*/i;
  const starts = lines.map((l,i) => senderMarker.test(l) ? i : -1).filter(i => i >= 0);
  let senderLines = [];
  if (starts.length === 1) {
    senderLines = [lines[starts[0]].replace(senderMarker, '')];
    for (let i = starts[0]+1; i < lines.length; i++) {
      if (/^(?:TO\b|Receiver\b|Beneficiary\b|ผู้\s*รับ|ไปยัง|ถึง|Amount\b|จำนวน|ยอด|Fee\b|ค่าธรรมเนียม)/i.test(lines[i])) break;
      senderLines.push(lines[i]);
    }
  }
  const field = (text, roleEvidence) => {
    const parts = text.split('\n').map(l => l.trim()).filter(Boolean);
    const accountMasked = parts.find(l => /^(?:[\dxX*•][ -]?){4,}$/.test(l)) || null;
    const rawName = parts.find(l => l !== accountMasked && !/^(?:ธ\.|ธนาคาร|SCB\b|KBANK\b|Krungsri\b)/i.test(l)) || null;
    const uncertain = !rawName || !roleEvidence || /[*•]|x{2,}/i.test(rawName);
    return { rawName, comparisonNormalizedName: rawName ? comparisonName(rawName) : null,
      normalizedName: rawName ? normalizeReceiverLine(rawName) : null,
      accountMasked, roleEvidence, confidenceTier: uncertain ? 'uncertain' : 'partial',
      warnings: !roleEvidence ? ['role_ambiguous'] : [] };
  };
  const layout = normalizeLayout(metadata || {});
  const roles = layout.length ? layoutRoles(layout, normalizeReceiverLine) : {};
  const temporal = temporalAndReference(ocrText, layout, qrResult);
  return {
    amount: spatialAmount(extractAmountEvidence(ocrText), layout),
    sender: roles.sender || field(senderLines.join('\n'), starts.length === 1 ? 'explicit_sender_label' : null),
    receiver: roles.receiver || field(receiverSection.text, receiverSection.text ? receiverSection.template : null),
    layout,
    ...temporal,
    qr: { parsed: Boolean(qrResult?.isValidSlipQR), bankCode: qrResult?.bankCode ?? null,
      reference: qrResult?.transRef ?? null, warnings: qrResult?.isValidSlipQR ? ['format_valid_not_payment_proof'] : ['qr_unavailable_or_invalid'] },
    warnings: []
  };
}

function analyzeSlipText(ocrText, accountConfig = {}, qrResult = null, metadata = null) {
  accountConfig = {
    ...accountConfig,
    accountName: accountConfig.accountName || accountConfig.payment_bank_account_name,
    companyName: accountConfig.companyName || accountConfig.company_name,
    accountNumber: accountConfig.accountNumber || accountConfig.payment_bank_account,
    promptpayId: accountConfig.promptpayId || accountConfig.promptpay_id,
    taxId: accountConfig.taxId || accountConfig.company_tax_id,
    bankName: accountConfig.bankName || accountConfig.payment_bank_name
  };
  // Phase 3 metadata enriches evidence only. Phase 2 comparison below remains text-based.
  const evidence = extractSlipEvidence(ocrText, qrResult, metadata);
  const extracted = extractReceiverSection(ocrText);
  const receiverText = typeof extracted === 'object' ? extracted.text : String(extracted || '');
  const rawTemplate = typeof extracted === 'object' ? extracted.template : 'standard_labeled';

  const configuredName = normalizeForMatch(accountConfig.accountName || accountConfig.companyName);
  const receiverLines = receiverText.split('\n').map(l => l.trim()).filter(Boolean);

  const hasNameMatch = configuredName.length >= 6 &&
    receiverLines.some(line => normalizeReceiverLine(line) === configuredName);

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
  const hasAccountOrPromptPay = Boolean(hasAccountMatch || hasPromptPayMatch || hasTaxIdMatch);

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
  const nonNameBankLines = receiverLines.filter(line => normalizeReceiverLine(line, configuredName) !== configuredName);
  const detectedBanks = [...new Set(nonNameBankLines.flatMap(bankCodesIn))];

  const hasExplicitBankMatch = expectedBanks.length === 1 && detectedBanks.length === 1 && expectedBanks[0] === detectedBanks[0];
  const hasBankConflict = detectedBanks.length > 0 && !hasExplicitBankMatch;

  // Specific verified bank template classification
  let detectedTemplate = rawTemplate;
  // Isolate pre-sender header so sender bank keywords NEVER leak into template detection:
  const preSenderText = String(ocrText || '').split(/(?:จาก|ผู้โอน|FROM\b|Sender\b)/i)[0] || '';
  const isScbSlip = qrResult?.bankCode === '014' || /(?:scb|ไทยพาณิชย์|siam\s*commercial)/i.test(preSenderText);
  const isKbankSlip = qrResult?.bankCode === '004' || (rawTemplate === 'kbank_structural') || /(?:kbank|กสิกรไทย|k\+)/i.test(preSenderText);

  if (rawTemplate === 'standard_labeled' && isScbSlip) {
    detectedTemplate = 'scb_template';
  } else if (rawTemplate === 'kbank_structural' || (isKbankSlip && rawTemplate === 'standard_labeled')) {
    detectedTemplate = 'kbank_template';
  }

  // Destination bank compatibility check for Tier B:
  // SCB template is ONLY compatible if expected bank is SCB ('014') or if payment is via PromptPay ('hasPromptPayMatch'/'hasTaxIdMatch')
  // KBank template is ONLY compatible if expected bank is KBANK ('004') or if payment is via PromptPay
  const destinationBankMatchesTemplate = (
    (detectedTemplate === 'scb_template' && (expectedBanks.includes('014') || hasPromptPayMatch || hasTaxIdMatch)) ||
    (detectedTemplate === 'kbank_template' && (expectedBanks.includes('004') || hasPromptPayMatch || hasTaxIdMatch))
  );

  // Migration guard ONLY for the two former target-correction pairs.
  // Compare an exact suffix; never rewrite the extracted text or approve this match.
  const formerCorrectionOnly = receiverLines.some(line => {
    const visible = normalizeForMatch(line.replace(/^(?:ด|จ|ฉ)\s+/, ''));
    return (configuredName.startsWith('บิลท์') && visible.startsWith('ปิลท์') &&
      visible.slice(1) === configuredName.slice(1)) ||
      (configuredName.startsWith('บิ้วท์') && visible.startsWith('ปิ้วท์') &&
      visible.slice(1) === configuredName.slice(1));
  });
  const receiverOcrUncertain = !hasNameMatch && formerCorrectionOnly &&
    Boolean(receiverText) && hasAccountOrPromptPay && !hasBankConflict &&
    (hasExplicitBankMatch || (detectedBanks.length === 0 && destinationBankMatchesTemplate));

  // Tiered verification:
  // Tier A: Strict Verified (Name + Account/PromptPay + Explicit Bank Text in Receiver block)
  // Tier B: Template Verified (Name + Account/PromptPay 100% match on verified bank template without bank text)
  // Tier C: Manual Review (Ambiguous, incomplete, mismatch, or unknown template)
  let verificationTier = 'manual_review';
  let hasCompanyMatch = false;

  if (hasNameMatch && hasAccountOrPromptPay && !hasBankConflict) {
    if (hasExplicitBankMatch) {
      verificationTier = 'strict_verified';
      hasCompanyMatch = true;
    } else if (detectedBanks.length === 0 && destinationBankMatchesTemplate) {
      // Allowed ONLY for verified bank templates proven from real slips not to render bank text in receiver block
      const ALLOWED_TIER_B_TEMPLATES = ['scb_template', 'kbank_template'];
      if (ALLOWED_TIER_B_TEMPLATES.includes(detectedTemplate)) {
        verificationTier = 'template_verified';
        hasCompanyMatch = true;
      }
    }
  }

  if (evidence.amount.value === null || evidence.amount.evidence.recoveredAcrossFeeContext) verificationTier = 'manual_review';
  const evidenceState = hasCompanyMatch && evidence.amount.value !== null ? 'verified'
    : receiverOcrUncertain || !receiverText || evidence.amount.value === null ? 'uncertain' : 'conflict';
  return {
    success: true,
    ocrText,
    detectedAmount: evidence.amount.value,
    evidence,
    evidenceState,
    receiverOcrUncertain,
    receiverEvidenceState: receiverOcrUncertain ? 'uncertain' : hasCompanyMatch ? 'verified' : 'conflict',
    receiverText,
    receiverTemplate: detectedTemplate,
    verificationTier,
    hasCompanyMatch,
    hasNameMatch,
    hasAccountMatch,
    hasTaxIdMatch,
    hasPromptPayMatch,
    hasBankMatch: hasExplicitBankMatch,
    hasBankConflict,
    hasAliasMatch: false
  };
}


export { BANK_CODES, KNOWN_BANK_CODES, COMPANY_KEYWORDS, normalizeForMatch, accountDigits, parseTLV, parseThaiBankSlipQR, toSatang, normalizeAmountToken, extractPreciseAmount, extractReceiverSection, normalizeReceiverLine, analyzeSlipText };
