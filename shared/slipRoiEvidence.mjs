// Phase 4F: Targeted ROI OCR Evidence Module
// Evidence-only, offline experiment. Never modifies payment decisions or reads ground truth.
import { extractSlipEvidence } from './slipVerificationCore.mjs';

export const ROI_PRIORITY = ['datetime', 'roles', 'amount'];

export function isGlyphFragmented(text) {
  if (!text || typeof text !== 'string') return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 3) return false;
  const singleGlyphs = words.filter(w => w.length <= 2);
  return (singleGlyphs.length / words.length) >= 0.6;
}

export function inspectDatetimeRoiTrigger(baselineEvidence, layoutLines = [], dimensions = {}) {
  const h = dimensions.height || (layoutLines.length ? Math.max(...layoutLines.map(l => l.bbox?.y1 || 0)) : 1000);
  const w = dimensions.width || (layoutLines.length ? Math.max(...layoutLines.map(l => l.bbox?.x1 || 0)) : 1000);
  const dt = baselineEvidence?.datetime || {};
  const isWeak = !dt.date || !dt.time || dt.confidenceTier === 'uncertain' || dt.confidenceTier === 'conflict';
  if (!isWeak) return { shouldTrigger: false, reason: 'datetime_already_confident' };

  // Independent evidence: check top 28% of image for transaction header evidence
  const topCutoff = h * 0.28;
  const statusBarCutoff = h * 0.05;
  const topLines = layoutLines.filter(l => l.bbox && l.bbox.y0 < topCutoff && l.bbox.y1 > statusBarCutoff);

  // Exclude phone status bar clocks alone
  const isStatusBarClock = l => (l.bbox.y1 <= statusBarCutoff * 1.5 || l.bbox.y0 <= statusBarCutoff) && /^\d{1,2}:\d{2}$/.test(l.text.trim());
  const validTopLines = topLines.filter(l => !isStatusBarClock(l));

  // Must have independent evidence: a transaction completion keyword fragment OR multiple layout components in top region
  const headerKeyword = /(?:รายการ|โอน|จ่าย|ชำระ|สำเร็จ|transfer|payment|completed|successful|make\b|k\+)/i;
  const hasKeyword = validTopLines.some(l => headerKeyword.test(l.text));
  const hasHeaderDensity = validTopLines.length >= 2;

  if (!hasKeyword && !hasHeaderDensity) {
    return { shouldTrigger: false, reason: 'no_independent_header_evidence' };
  }

  // Calculate crop coordinates: top header region omitting phone status bar
  const y0 = Math.max(0, Math.floor(statusBarCutoff * 0.8));
  const y1 = Math.min(h, Math.floor(topCutoff));
  const x0 = 0;
  const x1 = w;

  return {
    shouldTrigger: true,
    target: 'datetime',
    reason: hasKeyword ? 'datetime_weak_with_header_keyword_fragment' : 'datetime_weak_with_top_header_density',
    bbox: { x0, y0, x1, y1 },
    preprocessing: {
      scale: 1.75,
      greyscale: true,
      contrast: 0.15
    }
  };
}

export function inspectRolesRoiTrigger(baselineEvidence, layoutLines = [], dimensions = {}) {
  const h = dimensions.height || (layoutLines.length ? Math.max(...layoutLines.map(l => l.bbox?.y1 || 0)) : 1000);
  const w = dimensions.width || (layoutLines.length ? Math.max(...layoutLines.map(l => l.bbox?.x1 || 0)) : 1000);

  for (const role of ['sender', 'receiver']) {
    const roleEv = baselineEvidence?.[role] || {};
    const rawName = roleEv.rawName;
    const hasAnchor = (roleEv.roleEvidence && roleEv.roleEvidence.length > 0) ||
      layoutLines.some(l => (role === 'sender' ? /^(?:จ\s*า\s*ก|ผ\s*ู้\s*โ\s*อ\s*น|FROM\b)/i : /^(?:ถ\s*ึ\s*ง|ผ\s*ู้\s*ร\s*ั\s*บ|TO\b)/i).test(l.text));

    if (!hasAnchor) continue;

    const isMissing = !rawName || rawName.trim().length === 0;
    const isCorrupted = isGlyphFragmented(rawName) || (rawName && rawName.length < 3) || roleEv.warnings?.includes('spatial_logo_token_excluded');

    if (isMissing || isCorrupted) {
      // Find anchor bounding box
      const anchorLine = roleEv.roleEvidence?.[0] || layoutLines.find(l => (role === 'sender' ? /^(?:จ\s*า\s*ก|ผ\s*ู้\s*โ\s*อ\s*น|FROM\b)/i : /^(?:ถ\s*ึ\s*ง|ผ\s*ู้\s*ร\s*ั\s*บ|TO\b)/i).test(l.text));
      if (!anchorLine || !anchorLine.bbox) continue;

      const ab = anchorLine.bbox;
      const lineH = Math.max(16, ab.y1 - ab.y0);

      // Crop region: around the anchor line and text below/beside it, with safety padding
      let x0 = Math.max(0, ab.x0);
      let x1 = Math.min(w, Math.max(ab.x1 + lineH * 8, w * 0.9));
      let y0 = Math.max(0, ab.y0 - Math.floor(lineH * 0.2));
      let y1 = Math.min(h, ab.y1 + Math.floor(lineH * 2.5));

      // Logo exclusion: if an adjacent logo token is on the left of the name (e.g. icon word inside anchor), offset x0 past the logo
      if (anchorLine.words && anchorLine.words.length > 1) {
        const firstWord = anchorLine.words[0];
        if (firstWord.bbox && (firstWord.bbox.x1 - firstWord.bbox.x0) < lineH * 1.5) {
          x0 = Math.max(x0, firstWord.bbox.x1 + 2);
        }
      }

      return {
        shouldTrigger: true,
        target: 'roles',
        role,
        reason: isMissing ? `${role}_missing_with_explicit_anchor` : `${role}_fragmented_or_logo_corrupted`,
        bbox: { x0, y0, x1, y1 },
        preprocessing: {
          scale: 1.5,
          greyscale: true,
          contrast: 0.1
        }
      };
    }
  }

  return { shouldTrigger: false, reason: 'roles_confident_or_no_anchor' };
}

export function inspectAmountRoiTrigger(baselineEvidence, layoutLines = [], dimensions = {}) {
  const h = dimensions.height || (layoutLines.length ? Math.max(...layoutLines.map(l => l.bbox?.y1 || 0)) : 1000);
  const w = dimensions.width || (layoutLines.length ? Math.max(...layoutLines.map(l => l.bbox?.x1 || 0)) : 1000);
  const amt = baselineEvidence?.amount || {};

  // Trigger only on intrinsic evidence: conflict tier or multiple candidates with watermark-like divergence
  const hasConflict = amt.confidenceTier === 'conflict' || (amt.candidates && amt.candidates.length > 1 && Math.abs(amt.candidates[0].value - (amt.candidates[1]?.value || 0)) > 500);
  const hasAnomaly = amt.warnings?.includes('amount_format_anomaly') || (amt.value !== null && String(amt.raw || '').length >= 7 && amt.candidates?.[0]?.source === 'ocr');

  if (!hasConflict && !hasAnomaly) {
    return { shouldTrigger: false, reason: 'amount_confident_or_not_conflicted' };
  }

  // Find amount anchor line
  const amtLine = layoutLines.find(l => /^(?:amount|total|จำนวนเงิน|ยอดโอน|จำนวน)/i.test(l.text.replace(/\s+/g, '')));
  if (!amtLine || !amtLine.bbox) return { shouldTrigger: false, reason: 'amount_anchor_not_found' };

  const ab = amtLine.bbox;
  const lineH = Math.max(16, ab.y1 - ab.y0);
  const y0 = Math.max(0, ab.y0 - Math.floor(lineH * 0.5));
  const y1 = Math.min(h, ab.y1 + Math.floor(lineH * 2.5));
  const x0 = Math.max(0, ab.x0);
  const x1 = Math.min(w, Math.floor(w * 0.85));

  return {
    shouldTrigger: true,
    target: 'amount',
    reason: hasConflict ? 'amount_confidence_conflict' : 'amount_intrinsic_anomaly',
    bbox: { x0, y0, x1, y1 },
    preprocessing: {
      scale: 1.5,
      greyscale: true,
      contrast: 0.15
    }
  };
}

export function determineRoiTarget(baselineEvidence, layoutLines = [], dimensions = {}) {
  const deferred = [];

  // Priority 1: Datetime
  const dt = inspectDatetimeRoiTrigger(baselineEvidence, layoutLines, dimensions);
  if (dt.shouldTrigger) {
    // Check subsequent targets to record in deferred
    const roles = inspectRolesRoiTrigger(baselineEvidence, layoutLines, dimensions);
    if (roles.shouldTrigger) deferred.push(roles);
    const amt = inspectAmountRoiTrigger(baselineEvidence, layoutLines, dimensions);
    if (amt.shouldTrigger) deferred.push(amt);
    return { primary: dt, deferred };
  } else {
    deferred.push(dt);
  }

  // Priority 2: Roles (Sender / Receiver)
  const roles = inspectRolesRoiTrigger(baselineEvidence, layoutLines, dimensions);
  if (roles.shouldTrigger) {
    const amt = inspectAmountRoiTrigger(baselineEvidence, layoutLines, dimensions);
    if (amt.shouldTrigger) deferred.push(amt);
    return { primary: roles, deferred };
  } else {
    deferred.push(roles);
  }

  // Priority 3: Amount
  const amt = inspectAmountRoiTrigger(baselineEvidence, layoutLines, dimensions);
  if (amt.shouldTrigger) {
    return { primary: amt, deferred };
  } else {
    deferred.push(amt);
  }

  return { primary: null, deferred };
}

export function extractRoiFields(roiOcrText, roiLayout = [], targetSpec = {}) {
  const evidence = extractSlipEvidence(roiOcrText, null, { blocks: [] });
  const target = targetSpec?.target;

  if (target === 'datetime') {
    let date = evidence.datetime?.date || null;
    let time = evidence.datetime?.time || null;

    // Direct fallback for simple single/two line ROI crops
    if (!time) {
      const tm = roiOcrText.match(/(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*[AP]M)?(?![\d:])/i);
      if (tm) time = tm[0];
    }

    return {
      date,
      time,
      rawText: roiOcrText
    };
  }

  if (target === 'roles') {
    const role = targetSpec?.role || 'sender';
    let rawName = evidence[role]?.rawName || null;
    if (!rawName) {
      // Fallback: search lines without anchor marker
      const lines = roiOcrText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (/^(?:จาก|ผู้โอน|ผู้ส่ง|From|ถึง|ผู้รับ|To|จำนวน|amount)/i.test(line)) {
          const stripped = line.replace(/^(?:จาก|ผู้โอน|ผู้ส่ง|From|ถึง|ผู้รับ|To)\s*[:：-]?\s*/i, '').trim();
          if (stripped && !/^(?:ธ\.|ธนาคาร|SCB|KBANK)/i.test(stripped) && !/^[\d\s*•xX-]+$/.test(stripped)) {
            rawName = stripped;
            break;
          }
        } else if (!/^(?:ธ\.|ธนาคาร|SCB|KBANK)/i.test(line) && !/^[\d\s*•xX-]+$/.test(line) && line.length >= 3) {
          rawName = line;
          break;
        }
      }
    }

    return {
      rawName,
      rawText: roiOcrText
    };
  }

  if (target === 'amount') {
    let value = evidence.amount?.value || null;
    if (value === null) {
      const match = roiOcrText.match(/(?:^|[^\d,])(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+(?:\.\d{2}))(?!\d)/);
      if (match) {
        const parsed = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(parsed) && parsed > 0) value = parsed;
      }
    }
    return {
      value,
      rawText: roiOcrText
    };
  }

  return { rawText: roiOcrText };
}

export function mergeRoiEvidence(baselineEvidence, roiExtraction, targetSpec) {
  // Deep clone baseline to prevent any mutation
  const merged = structuredClone(baselineEvidence);

  if (!roiExtraction || !targetSpec) {
    return merged;
  }

  const { target } = targetSpec;

  if (target === 'datetime') {
    const baseDate = baselineEvidence.datetime?.date ?? null;
    const baseTime = baselineEvidence.datetime?.time ?? null;
    const roiDate = roiExtraction.date ?? null;
    const roiTime = roiExtraction.time ?? null;

    let roiStatus = 'none';
    let roiConflict = false;

    // Check time agreement/disagreement
    if (baseTime && roiTime) {
      if (baseTime === roiTime) {
        roiStatus = 'corroborated';
      } else {
        roiConflict = true;
        roiStatus = 'disagreement';
      }
    } else if (!baseTime && roiTime) {
      roiStatus = 'candidate_recovered';
    }

    // Check date agreement/disagreement
    if (baseDate && roiDate) {
      if (baseDate !== roiDate) {
        roiConflict = true;
        roiStatus = 'disagreement';
      } else if (roiStatus === 'none') {
        roiStatus = 'corroborated';
      }
    } else if (!baseDate && roiDate) {
      if (roiStatus === 'none') roiStatus = 'candidate_recovered';
    }

    merged.datetime = {
      ...merged.datetime,
      // Authoritative baseline values preserved
      date: baseDate,
      time: baseTime,
      roiAdvisory: {
        date: roiDate,
        time: roiTime,
        status: roiStatus,
        roiConflict,
        rawText: roiExtraction.rawText || '',
        provenance: 'targeted_roi',
        paymentUseAllowed: false
      }
    };

    if (roiConflict) {
      merged.datetime.warnings = [...(merged.datetime.warnings || []), 'roi_baseline_datetime_conflict'];
    }
  } else if (target === 'roles') {
    const role = targetSpec.role || 'sender';
    const baseRole = baselineEvidence[role] || {};
    const baseName = baseRole.rawName ?? null;
    const roiName = roiExtraction.rawName ?? null;

    let roiStatus = 'none';
    let roiConflict = false;

    if (baseName && roiName) {
      if (baseName === roiName) {
        roiStatus = 'corroborated';
      } else {
        roiConflict = true;
        roiStatus = 'disagreement';
      }
    } else if (!baseName && roiName) {
      roiStatus = 'candidate_recovered';
    }

    merged[role] = {
      ...baseRole,
      // Authoritative baseline value preserved
      rawName: baseName,
      roiAdvisory: {
        rawName: roiName,
        status: roiStatus,
        roiConflict,
        rawText: roiExtraction.rawText || '',
        provenance: 'targeted_roi',
        paymentUseAllowed: false
      }
    };

    if (roiConflict) {
      merged[role].warnings = [...(merged[role].warnings || []), 'roi_baseline_role_conflict'];
    }
  } else if (target === 'amount') {
    const baseAmt = baselineEvidence.amount?.value ?? null;
    const roiAmt = roiExtraction.value ?? null;

    let roiStatus = 'none';
    let roiConflict = false;

    if (baseAmt !== null && roiAmt !== null) {
      if (baseAmt === roiAmt) {
        roiStatus = 'corroborated';
      } else {
        roiConflict = true;
        roiStatus = 'disagreement';
      }
    } else if (baseAmt === null && roiAmt !== null) {
      roiStatus = 'candidate_recovered';
    }

    merged.amount = {
      ...merged.amount,
      // Authoritative baseline value strictly preserved
      value: baseAmt,
      roiAdvisory: {
        value: roiAmt,
        status: roiStatus,
        roiConflict,
        rawText: roiExtraction.rawText || '',
        provenance: 'targeted_roi',
        paymentUseAllowed: false
      }
    };

    if (roiConflict) {
      merged.amount.warnings = [...(merged.amount.warnings || []), 'roi_baseline_amount_conflict'];
      merged.amount.confidenceTier = 'conflict';
    }
  }

  return merged;
}
