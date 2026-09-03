/**
 * shared/slipVerificationCore.mjs
 *
 * Pure, environment-agnostic slip verification logic.
 * Contains NO Node.js filesystem, native bindings, or database dependencies.
 * Shared between Local Node.js verifier and Frontend Browser OCR assistant.
 */

// Thai Bank Code mappings from PromptPay / Thai QR specifications
export const BANK_CODES = {
  '002': { name: 'ธนาคารกรุงเทพ', short: 'BBL', promptpay_id: '002' },
  '004': { name: 'ธนาคารกสิกรไทย', short: 'KBANK', promptpay_id: '004' },
  '006': { name: 'ธนาคารกรุงไทย', short: 'KTB', promptpay_id: '006' },
  '011': { name: 'ธนาคารทหารไทยธนชาต', short: 'TTB', promptpay_id: '011' },
  '014': { name: 'ธนาคารไทยพาณิชย์', short: 'SCB', promptpay_id: '014' },
  '025': { name: 'ธนาคารกรุงศรีอยุธยา', short: 'BAY', promptpay_id: '025' },
  '069': { name: 'ธนาคารเกียรตินาคินภัทร', short: 'KKP', promptpay_id: '069' },
  '022': { name: 'ธนาคารซีไอเอ็มบีไทย', short: 'CIMBT', promptpay_id: '022' },
  '073': { name: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', short: 'LH', promptpay_id: '073' },
  '030': { name: 'ธนาคารออมสิน', short: 'GSB', promptpay_id: '030' },
  '034': { name: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', short: 'BAAC', promptpay_id: '034' }
};

export const BANK_ALIASES = {
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

/**
 * Normalizes strings for tolerant Thai/English matching.
 */
export function normalizeForMatch(str) {
  if (!str) return '';
  let s = String(str);
  s = s.replace(/\u0E4D\u0E32/g, '\u0E33');
  s = s.normalize('NFKC')
    .replace(/\u0E4D\u0E32/g, '\u0E33')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/บริษัท|จำกัด|co\.,?ltd\.?|co\,ltd|ltd\.?/gi, '')
    .replace(/[^a-z0-9\u0E00-\u0E7F]/gi, '');
  return s;
}

/**
 * Normalizes account numbers to raw alphanumeric digits.
 */
export function accountDigits(value) {
  if (!value) return '';
  return String(value).replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

/**
 * Converts THB amount into integer Satang (cents) to avoid IEEE-754 float drift.
 */
export function toSatang(val) {
  if (val === null || val === undefined) return 0;
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Normalizes amount tokens, handling thousand separators, decimal points, etc.
 */
export function normalizeAmountToken(token) {
  if (!token) return null;
  const raw = token.trim();
  const thousandsPattern = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
  if (thousandsPattern.test(raw)) {
    const n = parseFloat(raw.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  const clean = raw.replace(/,/g, '');
  const plainPattern = /^\d+(\.\d{1,2})?$/;
  if (!plainPattern.test(clean)) return null;
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

/**
 * Extracts precise transaction amounts from OCR text using strict line-based extraction.
 */
export function extractPreciseAmount(ocrText) {
  if (!ocrText) return null;
  const lines = ocrText.split(/\r?\n/);
  const candidates = [];

  const amountKeywords = [
    'จำนวนเงิน',
    'ยอดเงิน',
    'ยอดโอน',
    'จำนวน',
    'amount',
    'total'
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    const hasAmountKeyword = amountKeywords.some(k => lower.includes(k));

    if (hasAmountKeyword) {
      if (lower.includes('ค่าธรรมเนียม') || lower.includes('fee')) {
        continue;
      }
      const tokens = line.split(/[\s:]+/);
      for (const t of tokens) {
        const amt = normalizeAmountToken(t);
        if (amt !== null && amt > 0) {
          candidates.push(amt);
        }
      }
      if (candidates.length === 0 && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        const nextTokens = nextLine.split(/[\s:]+/);
        for (const t of nextTokens) {
          const amt = normalizeAmountToken(t);
          if (amt !== null && amt > 0) {
            candidates.push(amt);
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes('ค่าธรรมเนียม') || trimmed.toLowerCase().includes('fee')) continue;
    const tokens = trimmed.split(/[\s:]+/);
    for (const t of tokens) {
      const amt = normalizeAmountToken(t);
      if (amt !== null && amt > 0) {
        return amt;
      }
    }
  }

  return null;
}

/**
 * Normalizes a single line from the receiver section.
 * Strips leading avatar artifacts and applies scoped whitelist confusion pairs.
 */
export function normalizeReceiverLine(line, configuredName) {
  if (!line) return '';
  let cleaned = line
    .replace(/^[0-9•\-\*><)\s]+/, '')
    .replace(/^[A-Za-z]\)\s*/, '')
    .replace(/^(?:ด|จ|ฉ)\s+/, '')
    .trim();

  let norm = normalizeForMatch(cleaned);

  if (configuredName && configuredName.startsWith('บิลท์') && norm.startsWith('ปิลท์')) {
    norm = 'บิลท์' + norm.slice(5);
  } else if (configuredName && configuredName.startsWith('บิ้วท์') && norm.startsWith('ปิ้วท์')) {
    norm = 'บิ้วท์' + norm.slice(6);
  }

  return norm;
}

/**
 * Extracts the receiver (TO/ไปยัง) section from OCR text.
 */
export function extractReceiverSection(ocrText) {
  if (!ocrText) return { text: '', template: 'unknown' };
  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);

  const startKeywords = ['ไปยัง', 'to', 'ผู้รับเงิน', 'โอนให้', 'บัญชีผู้รับ', 'รับเงิน'];
  const endKeywords = [
    'จำนวนเงิน', 'ยอดเงิน', 'ยอดโอน', 'amount', 'total',
    'ค่าธรรมเนียม', 'fee', 'เลขที่รายการ', 'รหัสอ้างอิง',
    'หมายเลขอ้างอิง', 'ref', 'reference', 'บันทึกช่วยจำ', 'memo', 'วันที่'
  ];

  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    for (const k of startKeywords) {
      if (l === k || l.startsWith(k + ':') || l.startsWith(k + ' ') || l.endsWith(' ' + k)) {
        starts.push({ index: i, keyword: k });
        break;
      }
    }
  }

  if (starts.length === 1) {
    const startIdx = starts[0].index;
    const receiverLines = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      const l = lines[i].toLowerCase();
      const isEnd = endKeywords.some(k => l.includes(k));
      if (isEnd) break;
      receiverLines.push(lines[i]);
      if (receiverLines.length >= 6) break;
    }
    return { text: receiverLines.join('\n'), template: 'standard_labeled' };
  } else if (starts.length > 1) {
    return { text: '', template: 'ambiguous' };
  }

  let fromIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (l.includes('จาก') || l.includes('ผู้โอน') || l.includes('from')) {
      fromIdx = i;
      break;
    }
  }

  let refIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (l.includes('เลขที่รายการ') || l.includes('หมายเลขอ้างอิง') || l.includes('ref:')) {
      refIdx = i;
      break;
    }
  }

  if (fromIdx !== -1 && refIdx !== -1 && refIdx > fromIdx + 2) {
    const intermediateLines = lines.slice(fromIdx + 1, refIdx);
    const candidateLines = [];
    let passedSenderAccount = false;
    for (const line of intermediateLines) {
      if (!passedSenderAccount) {
        if (/xxx|\d{3,}/.test(line) || /ธนาคาร|bank/i.test(line)) {
          passedSenderAccount = true;
        }
        continue;
      }
      const l = line.toLowerCase();
      if (endKeywords.some(k => l.includes(k))) break;
      candidateLines.push(line);
      if (candidateLines.length >= 4) break;
    }
    if (candidateLines.length > 0) {
      return { text: candidateLines.join('\n'), template: 'kbank_structural' };
    }
  }

  return { text: '', template: 'unknown' };
}

/**
 * Decodes EMVCo / Thai Bank Mini QR TLV data.
 */
export function parseThaiBankSlipQR(qrData) {
  if (!qrData || typeof qrData !== 'string') return null;
  if (!qrData.startsWith('00') && !qrData.includes('0038')) return null;

  try {
    let pos = 0;
    let bankCode = null;
    let transRef = null;
    let subAgency = null;

    while (pos < qrData.length - 4) {
      const tag = qrData.substr(pos, 2);
      const lenStr = qrData.substr(pos + 2, 2);
      const len = parseInt(lenStr, 10);
      if (isNaN(len) || len <= 0 || pos + 4 + len > qrData.length) break;
      const value = qrData.substr(pos + 4, len);
      pos += 4 + len;

      if (tag === '00' && len >= 16) {
        let subPos = 0;
        while (subPos < value.length - 4) {
          const subTag = value.substr(subPos, 2);
          const subLen = parseInt(value.substr(subPos + 2, 2), 10);
          if (isNaN(subLen) || subLen <= 0 || subPos + 4 + subLen > value.length) break;
          const subVal = value.substr(subPos + 4, subLen);
          subPos += 4 + subLen;

          if (subTag === '01') bankCode = subVal;
          if (subTag === '02') transRef = subVal;
          if (subTag === '03') subAgency = subVal;
        }
      }
    }

    if (transRef) {
      const bankInfo = BANK_CODES[bankCode] || { name: 'ธนาคารไม่ทราบชื่อ (' + bankCode + ')', short: bankCode || 'UNKNOWN' };
      return {
        isValidSlipQR: true,
        bankCode,
        bankName: bankInfo.name,
        bankShort: bankInfo.short,
        transRef,
        subAgency,
        rawQR: qrData
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Analyzes OCR text against configured company settings.
 * Returns Tier classification: 'strict_verified' (Tier A), 'template_verified' (Tier B), or 'manual_review' (Tier C).
 */
export function analyzeSlipText(ocrText, accountConfig = {}, qrResult = null) {
  const extracted = extractReceiverSection(ocrText);
  const receiverText = typeof extracted === 'object' ? extracted.text : String(extracted || '');
  const rawTemplate = typeof extracted === 'object' ? extracted.template : 'standard_labeled';

  const rawConfigName = accountConfig.accountName || accountConfig.companyName || accountConfig.company_name || accountConfig.payment_bank_account_name;
  const configuredName = normalizeForMatch(rawConfigName);
  const receiverLines = receiverText.split('\n').map(l => l.trim()).filter(Boolean);

  const hasNameMatch = configuredName.length >= 6 &&
    receiverLines.some(line => normalizeReceiverLine(line, configuredName) === configuredName);

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

  const rawAccountNumber = accountConfig.accountNumber || accountConfig.payment_bank_account;
  const rawPromptpayId = accountConfig.promptpayId || accountConfig.promptpay_id;
  const rawTaxId = accountConfig.taxId || accountConfig.company_tax_id;
  const rawBankName = accountConfig.bankName || accountConfig.payment_bank_name;

  const hasAccountMatch = matchesAccount(rawAccountNumber, true);
  const hasPromptPayMatch = matchesAccount(rawPromptpayId, false);
  const hasTaxIdMatch = matchesAccount(rawTaxId, false);
  const hasAccountOrPromptPay = Boolean(hasAccountMatch || hasPromptPayMatch || hasTaxIdMatch);

  const bankCodesIn = text => Object.keys(BANK_ALIASES).filter(code =>
    BANK_ALIASES[code].some(alias => normalizeForMatch(text).includes(normalizeForMatch(alias))));

  const expectedBanks = bankCodesIn(rawBankName);
  const nonNameBankLines = receiverLines.filter(line => normalizeReceiverLine(line, configuredName) !== configuredName);
  const detectedBanks = [...new Set(nonNameBankLines.flatMap(bankCodesIn))];

  const hasExplicitBankMatch = expectedBanks.length === 1 && detectedBanks.length === 1 && expectedBanks[0] === detectedBanks[0];
  const hasBankConflict = detectedBanks.length > 0 && !hasExplicitBankMatch;

  let detectedTemplate = rawTemplate;
  const preSenderText = String(ocrText || '').split(/(?:จาก|ผู้โอน|FROM\b|Sender\b)/i)[0] || '';
  const isScbSlip = qrResult?.bankCode === '014' || /(?:scb|ไทยพาณิชย์|siam\s*commercial)/i.test(preSenderText);
  const isKbankSlip = qrResult?.bankCode === '004' || (rawTemplate === 'kbank_structural') || /(?:kbank|กสิกรไทย|k\+)/i.test(preSenderText);

  if (rawTemplate === 'standard_labeled' && isScbSlip) {
    detectedTemplate = 'scb_template';
  } else if (rawTemplate === 'kbank_structural' || (isKbankSlip && rawTemplate === 'standard_labeled')) {
    detectedTemplate = 'kbank_template';
  }

  const destinationBankMatchesTemplate = (
    (detectedTemplate === 'scb_template' && (expectedBanks.includes('014') || hasPromptPayMatch || hasTaxIdMatch)) ||
    (detectedTemplate === 'kbank_template' && (expectedBanks.includes('004') || hasPromptPayMatch || hasTaxIdMatch))
  );

  let verificationTier = 'manual_review';
  let hasCompanyMatch = false;

  if (hasNameMatch && hasAccountOrPromptPay && !hasBankConflict) {
    if (hasExplicitBankMatch) {
      verificationTier = 'strict_verified';
      hasCompanyMatch = true;
    } else if (detectedBanks.length === 0 && destinationBankMatchesTemplate) {
      const ALLOWED_TIER_B_TEMPLATES = ['scb_template', 'kbank_template'];
      if (ALLOWED_TIER_B_TEMPLATES.includes(detectedTemplate)) {
        verificationTier = 'template_verified';
        hasCompanyMatch = true;
      }
    }
  }

  return {
    success: true,
    ocrText,
    detectedAmount: extractPreciseAmount(ocrText),
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

export default {
  BANK_CODES,
  BANK_ALIASES,
  normalizeForMatch,
  accountDigits,
  toSatang,
  normalizeAmountToken,
  extractPreciseAmount,
  normalizeReceiverLine,
  extractReceiverSection,
  parseThaiBankSlipQR,
  analyzeSlipText
};
