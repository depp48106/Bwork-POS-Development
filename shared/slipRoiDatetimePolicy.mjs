// Phase 4G: Narrow Datetime-Only ROI Policy Module
// Evidence-only, offline evaluation. Never modifies payment decisions or reads ground truth.
import { extractSlipEvidence } from './slipVerificationCore.mjs';
import { parseDate } from './slipLayoutEvidence.mjs';

// Explicitly disabled non-datetime targets in Phase 4G/4I
export const DISABLED_TARGETS = Object.freeze(['sender', 'receiver', 'amount']);
export const ENABLED_TARGETS = Object.freeze(['datetime']);

// Explicit allowlist of weak/missing datetime states
export const WEAK_DATETIME_TIERS = Object.freeze(new Set([
  'uncertain',
  'conflict',
  'missing',
  'low_confidence'
]));

/**
 * Checks whether baseline datetime is genuinely missing or in an explicit weak state.
 * Returns true only if date/time is missing or tier is in WEAK_DATETIME_TIERS.
 *
 * Phase 4I Fix 1: Intentionally unscorable 2-digit year check.
 * If date is null specifically because year/date is intentionally marked uncertain (e.g. 2-digit year)
 * AND time is already strong/complete without conflict, do NOT retry datetime ROI solely for date.
 */
export function isDatetimeWeakOrMissing(datetimeEvidence) {
  if (!datetimeEvidence) return true;
  const { date, time, confidenceTier, warnings = [] } = datetimeEvidence;

  const isDateIntentionallyUncertain = !date && warnings.includes('year_or_date_uncertain') && !warnings.includes('datetime_conflict');
  const isTimeStrong = Boolean(time);

  if (isDateIntentionallyUncertain && isTimeStrong) {
    return false;
  }

  const isMissing = !date || !time;
  const isWeakTier = Boolean(confidenceTier && WEAK_DATETIME_TIERS.has(confidenceTier));
  return isMissing || isWeakTier;
}

/**
 * Filter layout lines to top transaction-header candidate lines, strictly rejecting
 * phone status-bar clocks alone (lines at y <= 5% of height with bare time string).
 */
export function getTopHeaderCandidateLines(layoutLines = [], height = 1000) {
  const topCutoff = height * 0.28;
  const statusBarCutoff = height * 0.05;

  const inTopZone = layoutLines.filter(l => l.bbox && l.bbox.y0 < topCutoff && l.bbox.y1 > statusBarCutoff);
  // Exclude phone status bar clocks: short time token near top boundary
  const isStatusBarClock = l => (l.bbox.y1 <= statusBarCutoff * 1.5 || l.bbox.y0 <= statusBarCutoff) &&
    /^\d{1,2}:\d{2}$/.test(l.text.trim());

  return inTopZone.filter(l => !isStatusBarClock(l));
}

/**
 * Generic Detection of Transaction Body Datetime Region with Semantic Association (Candidate B).
 * Required Fix 1: Requires:
 * 1. Line(s) in body band (0.15*h < y < 0.88*h) containing date/time-shaped fragments
 * 2. Nearby transaction-semantic or transaction-structure evidence within vertical proximity (Δy <= 0.22*h):
 *    - transfer/payment/completed/success semantic text
 *    - transaction reference nearby
 *    - amount/fee/currency grouping nearby
 *    - party/account labels nearby
 * Returns bounding box and supporting lines if well-supported, or null if absent/ambiguous.
 */
export function detectTransactionBodyDatetimeRegion(layoutLines = [], height = 1000, width = 1000) {
  if (!layoutLines || layoutLines.length === 0) return null;

  const dateShapeRegex = /(?:\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|\b\d{1,2}\s+[A-Za-zก-๙.]{2,}\s+\d{2,4}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b)/i;
  const timeShapeRegex = /(?<![\d:])(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d(?:\s*:\s*[0-5]\d)?(?:\s*[AP]M\b|(?![0-9a-zA-Z:]))/i;
  const dateTimeLabelRegex = /(?:วันที่(?:โอน)?|เวลา(?:โอน)?|Date\b|Time\b)/i;

  const bodyMinY = height * 0.15;
  const bodyMaxY = height * 0.88;

  // Filter lines located in the body band
  const bodyLines = layoutLines.filter(l => l.bbox && l.bbox.y0 >= bodyMinY && l.bbox.y1 <= bodyMaxY);

  // Helper functions to identify date and time shaped lines with OCR space tolerance
  const isDateLine = l => {
    const compact = l.text.replace(/(?<=[ก-๙.])\s+(?=[ก-๙.])/g, '');
    return dateShapeRegex.test(l.text) || dateShapeRegex.test(compact) || /(?:วันที่(?:โอน)?|Date\b)/i.test(l.text);
  };
  const isTimeLine = l => {
    if (/^\d{1,2}:\d{2}$/.test(l.text.trim()) && l.bbox.y0 < height * 0.08) return false;
    return timeShapeRegex.test(l.text) || /(?:เวลา(?:โอน)?|Time\b)/i.test(l.text);
  };

  // Find lines containing date or time shape
  const dtCandidateLines = bodyLines.filter(l => isDateLine(l) || isTimeLine(l));

  if (dtCandidateLines.length === 0) return null;

  // Transaction semantic & structure patterns
  const semanticTxRegex = /(?:โอน|จ่าย|ข่าย|ชำระ|สำเร็จ|สําเร็จ|transfer|payment|completed|successful|paid|topup|เติมเงิน|บิล|bill)/i;
  const semanticRefRegex = /(?:เลขที่|รหัส|อ้างอิง|ref(?:erence)?|trans(?:action)?|id|no|\b[A-Za-z0-9]{12,}\b)/i;
  const semanticAmountRegex = /(?:baht|thb|บาท|จำนวนเงิน|จํานวนเงิน|ค่าธรรมเนียม|fee|amount|\b(?:THB|\$|฿)\s*\d+)/i;
  const semanticPartyRegex = /(?:from|to|จาก|ถึง|ไปยัง|account|บัญชี|promptpay|พร้อมเพย์|card|บัตร)/i;

  const supportedCandidateLines = [];
  const maxProximityY = height * 0.22; // within 22% of slip height

  for (const dtLine of dtCandidateLines) {
    const nearbyLines = bodyLines.filter(other => {
      if (other === dtLine) return false;
      const dist = Math.abs((other.bbox.y0 + other.bbox.y1) / 2 - (dtLine.bbox.y0 + dtLine.bbox.y1) / 2);
      return dist <= maxProximityY;
    });

    const hasTxSemantic = nearbyLines.some(l => semanticTxRegex.test(l.text) || semanticTxRegex.test(l.text.replace(/\s+/g, '')));
    const hasRefSemantic = nearbyLines.some(l => semanticRefRegex.test(l.text) || semanticRefRegex.test(l.text.replace(/\s+/g, '')));
    const hasAmountSemantic = nearbyLines.some(l => semanticAmountRegex.test(l.text) || semanticAmountRegex.test(l.text.replace(/\s+/g, '')));
    const hasPartySemantic = nearbyLines.some(l => semanticPartyRegex.test(l.text) || semanticPartyRegex.test(l.text.replace(/\s+/g, '')));
    const hasPairingSemantic = (isDateLine(dtLine) && nearbyLines.some(isTimeLine)) ||
      (isTimeLine(dtLine) && nearbyLines.some(isDateLine));

    const supportCount = (hasTxSemantic ? 1 : 0) + (hasRefSemantic ? 1 : 0) + (hasAmountSemantic ? 1 : 0) + (hasPartySemantic ? 1 : 0) + (hasPairingSemantic ? 1 : 0);

    // Required Fix 1: Must have at least one generic transaction-structure or semantic association
    if (supportCount >= 1) {
      supportedCandidateLines.push({ line: dtLine, supportCount });
    }
  }

  if (supportedCandidateLines.length === 0) return null;

  // Group candidate lines that belong to the same cluster (within 180px vertically)
  const clusters = [];
  for (const { line, supportCount } of supportedCandidateLines) {
    let added = false;
    for (const cluster of clusters) {
      const clusterMidY = (cluster.minY + cluster.maxY) / 2;
      const lineMidY = (line.bbox.y0 + line.bbox.y1) / 2;
      if (Math.abs(clusterMidY - lineMidY) <= Math.max(180, height * 0.15)) {
        cluster.lines.push(line);
        cluster.minY = Math.min(cluster.minY, line.bbox.y0);
        cluster.maxY = Math.max(cluster.maxY, line.bbox.y1);
        cluster.totalSupport += supportCount;
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({
        lines: [line],
        minY: line.bbox.y0,
        maxY: line.bbox.y1,
        totalSupport: supportCount
      });
    }
  }

  // If multiple clusters exist, select only if one has clearly stronger support, otherwise fail closed
  if (clusters.length > 1) {
    clusters.sort((a, b) => b.totalSupport - a.totalSupport);
    if (clusters[0].totalSupport === clusters[1].totalSupport) {
      // Ambiguous multiple body regions -> fail closed
      return null;
    }
  }

  const selectedCluster = clusters[0];
  const cropY0 = Math.max(0, Math.floor(selectedCluster.minY - 45));
  const cropY1 = Math.min(height, Math.ceil(selectedCluster.maxY + 45));

  return {
    region: 'transaction_body_block',
    reason: 'datetime_weak_with_body_transaction_semantic_association',
    supportingLines: selectedCluster.lines.map(l => l.text),
    bbox: { x0: 0, y0: cropY0, x1: width, y1: cropY1 }
  };
}

/**
 * Policy 1: STRICT LAYOUT / TEXT-EVIDENCE TRIGGER (Phase 4I Dynamic Region)
 * Deterministically selects EXACTLY ONE ROI candidate region:
 * - Candidate B (transaction_body_block) if date/time fragment with transaction-semantic association exists
 * - Candidate A (top_transaction_header) if top header keyword or density exists
 * Max 1 ROI target.
 */
export function inspectPolicy1Trigger(baselineEvidence, layoutLines = [], dimensions = {}) {
  const dt = baselineEvidence?.datetime;
  if (!isDatetimeWeakOrMissing(dt)) {
    return { shouldTrigger: false, reason: 'datetime_already_confident' };
  }

  const h = dimensions.height || (layoutLines.length ? Math.max(...layoutLines.map(l => l.bbox?.y1 || 0)) : 1000);
  const w = dimensions.width || (layoutLines.length ? Math.max(...layoutLines.map(l => l.bbox?.x1 || 0)) : 1000);

  // Candidate B: Check for transaction body datetime region with semantic association
  const bodyRegion = detectTransactionBodyDatetimeRegion(layoutLines, h, w);
  if (bodyRegion) {
    return {
      shouldTrigger: true,
      policy: 'policy1_strict_layout',
      target: 'datetime',
      region: bodyRegion.region,
      reason: bodyRegion.reason,
      supportingLines: bodyRegion.supportingLines,
      bbox: bodyRegion.bbox,
      preprocessing: { scale: 1.75, greyscale: true, contrast: 0.15 }
    };
  }

  // Candidate A: Fall back to top transaction header if header keyword or line density is present
  const topLines = getTopHeaderCandidateLines(layoutLines, h);
  const headerKeywordRegex = /(?:รายการ|โอน|จ่าย|ชำระ|สำเร็จ|transfer|payment|completed|successful|make\b|k\+)/i;
  const hasKeyword = topLines.some(l => headerKeywordRegex.test(l.text));
  const hasDensity = topLines.length >= 2;

  if (!hasKeyword && !hasDensity) {
    return { shouldTrigger: false, reason: 'no_independent_header_evidence' };
  }

  const statusBarCutoff = h * 0.05;
  const topCutoff = h * 0.28;
  const y0 = Math.max(0, Math.floor(statusBarCutoff * 0.8));
  const y1 = Math.min(h, Math.floor(topCutoff));

  return {
    shouldTrigger: true,
    policy: 'policy1_strict_layout',
    target: 'datetime',
    region: 'top_transaction_header',
    reason: hasKeyword ? 'datetime_weak_with_header_keyword' : 'datetime_weak_with_top_header_density',
    supportingLines: topLines.map(l => l.text),
    bbox: { x0: 0, y0, x1: w, y1 },
    preprocessing: { scale: 1.75, greyscale: true, contrast: 0.15 }
  };
}

/**
 * FROZEN IMAGE METRIC DEFINITIONS (Policy 2: Exploratory Only)
 * 1. localTextBandContrast:
 *    - Definition: Max luminance minus min luminance (L_max - L_min) in y in [0.05*h, 0.28*h]
 *    - Scale: [0, 255]
 *    - Rationale: High range (>= 180) verifies that stroke contrasts exist despite binarization failure.
 * 2. horizontalEdgeDensity:
 *    - Definition: Average absolute difference between adjacent horizontal samples |L(x) - L(x-2)|
 *    - Scale: [0, 100]
 *    - Rationale: Text characters generate frequent horizontal transitions (>= 4.5).
 * 3. ocrGhostFragmentPresent:
 *    - Definition: Layout lines in header zone contain a short isolated token (<= 6 chars)
 *      with word confidence < 75, indicating OCR attempted to parse character glyphs.
 */
export const FROZEN_POLICY2_THRESHOLDS = Object.freeze({
  minContrastRange: 180,
  minEdgeDensity: 4.5,
  ghostMaxLen: 6,
  ghostMaxConfidence: 75
});

/**
 * Computes deterministic image metrics for the top header candidate band.
 */
export function computeHeaderImageMetrics(jimpImage, layoutLines = [], height = 1000, width = 1000) {
  if (!jimpImage || !jimpImage.bitmap) {
    return { localTextBandContrast: 0, horizontalEdgeDensity: 0, ocrGhostFragmentPresent: false };
  }

  const yStart = Math.floor(height * 0.05);
  const yEnd = Math.floor(height * 0.28);
  const w = jimpImage.bitmap.width;

  let minL = 255, maxL = 0, edgeSum = 0, count = 0;
  // Sample every 2nd pixel horizontally and vertically for fast, cheap computation
  for (let y = yStart; y < yEnd; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const idx = (y * w + x) * 4;
      const r = jimpImage.bitmap.data[idx];
      const g = jimpImage.bitmap.data[idx + 1];
      const b = jimpImage.bitmap.data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (lum < minL) minL = lum;
      if (lum > maxL) maxL = lum;

      if (x > 1) {
        const pIdx = (y * w + (x - 2)) * 4;
        const pLum = 0.299 * jimpImage.bitmap.data[pIdx] + 0.587 * jimpImage.bitmap.data[pIdx + 1] + 0.114 * jimpImage.bitmap.data[pIdx + 2];
        edgeSum += Math.abs(lum - pLum);
      }
      count++;
    }
  }

  const localTextBandContrast = maxL - minL;
  const horizontalEdgeDensity = count > 0 ? (edgeSum / count) : 0;

  // Check for OCR ghost fragment in top zone
  const topLines = getTopHeaderCandidateLines(layoutLines, height);
  const ocrGhostFragmentPresent = topLines.some(l => {
    const isShort = l.text.trim().length <= FROZEN_POLICY2_THRESHOLDS.ghostMaxLen;
    const isLowConf = Number.isFinite(l.confidence) && l.confidence < FROZEN_POLICY2_THRESHOLDS.ghostMaxConfidence;
    const isFragment = /[|\-=_~]/.test(l.text) && /\d|[a-zก-๙]/i.test(l.text);
    return isShort && (isLowConf || isFragment);
  });

  return {
    localTextBandContrast: Math.round(localTextBandContrast),
    horizontalEdgeDensity: Number((Math.round(horizontalEdgeDensity * 10) / 10).toFixed(1)),
    ocrGhostFragmentPresent
  };
}

/**
 * Policy 2: GENERIC IMAGE-SIGNAL TRIGGER (Exploratory Only)
 * First checks Policy 1. If Policy 1 triggers, returns it.
 * If Policy 1 does NOT trigger, checks whether frozen generic image metrics
 * indicate a text-bearing low-contrast header band.
 */
export function inspectPolicy2Trigger(baselineEvidence, layoutLines = [], dimensions = {}, imageMetrics = null) {
  const p1 = inspectPolicy1Trigger(baselineEvidence, layoutLines, dimensions);
  if (p1.shouldTrigger) {
    return p1;
  }

  const dt = baselineEvidence?.datetime;
  if (!isDatetimeWeakOrMissing(dt)) {
    return { shouldTrigger: false, reason: 'datetime_already_confident' };
  }

  if (!imageMetrics) {
    return { shouldTrigger: false, reason: 'image_metrics_unavailable' };
  }

  const { localTextBandContrast, horizontalEdgeDensity, ocrGhostFragmentPresent } = imageMetrics;
  const meetsContrast = localTextBandContrast >= FROZEN_POLICY2_THRESHOLDS.minContrastRange;
  const meetsEdge = horizontalEdgeDensity >= FROZEN_POLICY2_THRESHOLDS.minEdgeDensity;
  const meetsGhost = ocrGhostFragmentPresent === true;

  if (meetsContrast && meetsEdge && meetsGhost) {
    const h = dimensions.height || 1000;
    const w = dimensions.width || 1000;
    const statusBarCutoff = h * 0.05;
    const topCutoff = h * 0.28;
    const y0 = Math.max(0, Math.floor(statusBarCutoff * 0.8));
    const y1 = Math.min(h, Math.floor(topCutoff));

    return {
      shouldTrigger: true,
      policy: 'policy2_exploratory_image_signal',
      target: 'datetime',
      reason: 'datetime_weak_with_ghost_fragment_and_edge_density',
      bbox: { x0: 0, y0, x1: w, y1 },
      preprocessing: { scale: 1.75, greyscale: true, contrast: 0.15 }
    };
  }

  return { shouldTrigger: false, reason: 'image_metrics_below_threshold' };
}

/**
 * Determine Phase 4G ROI Target (Strictly Datetime-Only).
 * Mode: 'policy1' (default) or 'policy2' (exploratory).
 * Roles and amount triggers are strictly disabled.
 */
export function determinePhase4gRoiTarget(baselineEvidence, layoutLines = [], dimensions = {}, mode = 'policy1', imageMetrics = null) {
  let decision = null;
  if (mode === 'policy2') {
    decision = inspectPolicy2Trigger(baselineEvidence, layoutLines, dimensions, imageMetrics);
  } else {
    decision = inspectPolicy1Trigger(baselineEvidence, layoutLines, dimensions);
  }

  if (decision.shouldTrigger) {
    return {
      primary: decision,
      deferred: [], // No deferred targets because non-datetime targets are disabled
      disabledTargets: DISABLED_TARGETS
    };
  }

  return {
    primary: null,
    deferred: [decision],
    disabledTargets: DISABLED_TARGETS
  };
}

/**
 * Extract datetime fields from cropped ROI OCR text with Ambiguity Guard (Required Fix 2).
 * Rules:
 * 1. Exactly one well-supported candidate -> advisory candidate allowed
 * 2. Multiple candidates with same normalized value -> corroborated
 * 3. Multiple materially different plausible dates/times -> return conflict/uncertain, do NOT pick arbitrarily
 * 4. Status-bar-like candidate -> exclude
 * 5. Returns full provenance: candidates, distinct values, conflict flags
 */
export function extractDatetimeRoi(roiOcrText, roiLayout = []) {
  const evidence = extractSlipEvidence(roiOcrText, null, { blocks: [] });
  const baseEvDate = evidence.datetime?.date || null;
  const baseEvTime = evidence.datetime?.time || null;

  const timeRegex = /(?<![\d:])(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d(?:\s*:\s*[0-5]\d)?(?:\s*[AP]M\b|(?![0-9a-zA-Z:]))/i;
  const lines = String(roiOcrText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // 1. Candidate Date Collection & Ambiguity Guard
  const dateCandidates = [];
  if (baseEvDate) {
    dateCandidates.push({ source: 'evidence', date: baseEvDate, raw: baseEvDate });
  }
  for (const line of lines) {
    const d = parseDate(line);
    if (d) {
      dateCandidates.push({ source: 'line_scan', date: d, raw: line });
    }
  }

  const distinctDates = [...new Set(dateCandidates.map(c => c.date))];
  let finalDate = null;
  let dateConflict = false;

  if (distinctDates.length === 1) {
    finalDate = distinctDates[0];
  } else if (distinctDates.length > 1) {
    dateConflict = true;
    finalDate = null; // Ambiguous multiple distinct dates -> fail closed
  }

  // 2. Candidate Time Collection & Ambiguity Guard
  const timeCandidates = [];
  if (baseEvTime) {
    timeCandidates.push({ source: 'evidence', time: baseEvTime.replace(/\s*:\s*/g, ':'), raw: baseEvTime });
  }
  for (const line of lines) {
    const tm = line.match(timeRegex);
    if (tm) {
      const normalizedTime = tm[0].replace(/\s*:\s*/g, ':');
      timeCandidates.push({ source: 'line_scan', time: normalizedTime, raw: line });
    }
  }

  const distinctTimes = [...new Set(timeCandidates.map(c => c.time))];
  let finalTime = null;
  let timeConflict = false;

  if (distinctTimes.length === 1) {
    finalTime = distinctTimes[0];
  } else if (distinctTimes.length > 1) {
    timeConflict = true;
    finalTime = null; // Ambiguous multiple distinct times -> fail closed
  }

  return {
    date: finalDate,
    time: finalTime,
    rawText: roiOcrText,
    provenance: {
      dateCandidates,
      timeCandidates,
      distinctDates,
      distinctTimes,
      dateConflict,
      timeConflict
    }
  };
}

/**
 * Merge Datetime ROI Evidence into Baseline Evidence.
 * Strictly adheres to Phase 4F safety guarantees:
 * - Baseline authoritative values are NEVER replaced when present.
 * - Disagreement records advisory conflict.
 * - Baseline null + ROI candidate records advisory candidate only (paymentUseAllowed: false).
 * - verificationTier, payment eligibility, and auto-approval are untouched.
 */
export function mergeDatetimeRoi(baselineEvidence, roiExtraction) {
  const merged = structuredClone(baselineEvidence);
  if (!roiExtraction) return merged;

  const baseDate = baselineEvidence?.datetime?.date ?? null;
  const baseTime = baselineEvidence?.datetime?.time ?? null;
  const roiDate = roiExtraction.date ?? null;
  const roiTime = roiExtraction.time ?? null;

  let roiStatus = 'none';
  let roiConflict = Boolean(roiExtraction.provenance?.dateConflict || roiExtraction.provenance?.timeConflict);

  // Time agreement / conflict
  if (baseTime && roiTime) {
    if (baseTime === roiTime) {
      roiStatus = 'corroborated';
    } else {
      roiConflict = true;
      roiStatus = 'disagreement';
    }
  } else if (!baseTime && roiTime) {
    roiStatus = roiConflict ? 'conflict' : 'candidate_recovered';
  }

  // Date agreement / conflict
  if (baseDate && roiDate) {
    if (baseDate !== roiDate) {
      roiConflict = true;
      roiStatus = 'disagreement';
    } else if (roiStatus === 'none') {
      roiStatus = 'corroborated';
    }
  } else if (!baseDate && roiDate) {
    if (roiStatus === 'none') roiStatus = roiConflict ? 'conflict' : 'candidate_recovered';
  }

  merged.datetime = {
    ...merged.datetime,
    // Baseline authoritative values strictly preserved
    date: baseDate,
    time: baseTime,
    roiAdvisory: {
      date: roiDate,
      time: roiTime,
      status: roiStatus,
      roiConflict,
      rawText: roiExtraction.rawText || '',
      provenance: 'targeted_datetime_roi',
      details: roiExtraction.provenance || null,
      paymentUseAllowed: false
    }
  };

  if (roiConflict) {
    merged.datetime.warnings = [...(merged.datetime.warnings || []), 'roi_baseline_datetime_conflict'];
  }

  return merged;
}
