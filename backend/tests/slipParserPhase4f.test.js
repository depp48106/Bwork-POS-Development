'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const line = (text, x, y, w = 80, h = 20, words = null) => ({
  text,
  confidence: 90,
  bbox: { x0: x, y0: y, x1: x + w, y1: y + h },
  words: words || [{ text, bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, confidence: 90 }]
});

test('Phase 4F: shared/slipRoiEvidence.mjs imports cleanly and has zero ground truth dependence', async () => {
  const mod = await import('../../shared/slipRoiEvidence.mjs');
  assert.ok(mod.determineRoiTarget);
  assert.ok(mod.inspectDatetimeRoiTrigger);
  assert.ok(mod.inspectRolesRoiTrigger);
  assert.ok(mod.inspectAmountRoiTrigger);
  assert.ok(mod.mergeRoiEvidence);
  assert.deepEqual(mod.ROI_PRIORITY, ['datetime', 'roles', 'amount']);
});

test('Phase 4F: Datetime missing alone does NOT trigger ROI without top header evidence', async () => {
  const { inspectDatetimeRoiTrigger } = await import('../../shared/slipRoiEvidence.mjs');
  const baselineEvidence = {
    datetime: { date: null, time: null, confidenceTier: 'uncertain' }
  };
  // Empty layout lines: no independent header evidence
  const res1 = inspectDatetimeRoiTrigger(baselineEvidence, [], { width: 1000, height: 1600 });
  assert.equal(res1.shouldTrigger, false);
  assert.equal(res1.reason, 'no_independent_header_evidence');

  // Lines exist but far down (y > 28% of height): no top header evidence
  const lowerLines = [
    line('จำนวนเงิน 500.00 บาท', 100, 600, 200, 25),
    line('ผู้รับเงิน สมใจ', 100, 700, 150, 25)
  ];
  const res2 = inspectDatetimeRoiTrigger(baselineEvidence, lowerLines, { width: 1000, height: 1600 });
  assert.equal(res2.shouldTrigger, false);
  assert.equal(res2.reason, 'no_independent_header_evidence');
});

test('Phase 4F: Status-bar-only clocks do NOT trigger datetime ROI', async () => {
  const { inspectDatetimeRoiTrigger } = await import('../../shared/slipRoiEvidence.mjs');
  const baselineEvidence = {
    datetime: { date: null, time: null, confidenceTier: 'uncertain' }
  };
  // Status bar clock at top edge (y <= 5% of height = 80px)
  const statusBarLine = [
    line('09:41', 50, 20, 50, 20)
  ];
  const res = inspectDatetimeRoiTrigger(baselineEvidence, statusBarLine, { width: 1000, height: 1600 });
  assert.equal(res.shouldTrigger, false);
  assert.equal(res.reason, 'no_independent_header_evidence');
});

test('Phase 4F: Independent top-header evidence triggers datetime ROI', async () => {
  const { inspectDatetimeRoiTrigger } = await import('../../shared/slipRoiEvidence.mjs');
  const baselineEvidence = {
    datetime: { date: null, time: null, confidenceTier: 'uncertain' }
  };
  const topLines = [
    line('โอนเงินสำเร็จ', 100, 120, 180, 30),
    line('K PLUS', 100, 180, 80, 25)
  ];
  const res = inspectDatetimeRoiTrigger(baselineEvidence, topLines, { width: 1000, height: 1600 });
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.target, 'datetime');
  assert.ok(res.bbox);
  assert.ok(res.bbox.y1 <= 1600 * 0.28);
});

test('Phase 4F: Confident datetime does NOT trigger datetime ROI even with top header', async () => {
  const { inspectDatetimeRoiTrigger } = await import('../../shared/slipRoiEvidence.mjs');
  const baselineEvidence = {
    datetime: { date: '2026-05-30', time: '15:14', confidenceTier: 'partial' }
  };
  const topLines = [line('TRANSFER COMPLETED', 100, 100, 200, 30)];
  const res = inspectDatetimeRoiTrigger(baselineEvidence, topLines, { width: 1000, height: 1600 });
  assert.equal(res.shouldTrigger, false);
  assert.equal(res.reason, 'datetime_already_confident');
});

test('Phase 4F: Generic glyph fragmentation triggers roles ROI (no hardcoded string)', async () => {
  const { inspectRolesRoiTrigger } = await import('../../shared/slipRoiEvidence.mjs');
  const anchor = line('จาก', 50, 300, 40, 20);
  const baselineEvidence = {
    sender: {
      rawName: 'ก ข ค ง จ', // Highly fragmented generic text (5 single-glyph words)
      roleEvidence: [anchor],
      confidenceTier: 'partial'
    }
  };
  const res = inspectRolesRoiTrigger(baselineEvidence, [anchor], { width: 1000, height: 1600 });
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.target, 'roles');
  assert.equal(res.role, 'sender');
});

test('Phase 4F: Missing name with explicit anchor triggers roles ROI', async () => {
  const { inspectRolesRoiTrigger } = await import('../../shared/slipRoiEvidence.mjs');
  const anchor = line('ผู้รับเงิน', 50, 450, 80, 20);
  const baselineEvidence = {
    receiver: {
      rawName: null,
      roleEvidence: [anchor],
      confidenceTier: 'uncertain'
    }
  };
  const res = inspectRolesRoiTrigger(baselineEvidence, [anchor], { width: 1000, height: 1600 });
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.target, 'roles');
  assert.equal(res.role, 'receiver');
});

test('Phase 4F: Confident unfragmented name does NOT trigger roles ROI', async () => {
  const { inspectRolesRoiTrigger } = await import('../../shared/slipRoiEvidence.mjs');
  const anchor = line('ผู้โอน', 50, 300, 50, 20);
  const baselineEvidence = {
    sender: {
      rawName: 'นาย สมชาย ใจดี',
      roleEvidence: [anchor],
      confidenceTier: 'partial'
    }
  };
  const res = inspectRolesRoiTrigger(baselineEvidence, [anchor], { width: 1000, height: 1600 });
  assert.equal(res.shouldTrigger, false);
});

test('Phase 4F: Intrinsic amount conflict triggers amount ROI without ground truth', async () => {
  const { inspectAmountRoiTrigger } = await import('../../shared/slipRoiEvidence.mjs');
  const amtAnchor = line('จำนวนเงิน', 50, 500, 80, 20);
  const baselineEvidence = {
    amount: {
      value: 1870,
      candidates: [{ value: 1870, source: 'ocr' }, { value: 870, source: 'ocr' }],
      confidenceTier: 'conflict'
    }
  };
  const res = inspectAmountRoiTrigger(baselineEvidence, [amtAnchor], { width: 1000, height: 1600 });
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.target, 'amount');
});

test('Phase 4F: Confident single amount does NOT trigger amount ROI', async () => {
  const { inspectAmountRoiTrigger } = await import('../../shared/slipRoiEvidence.mjs');
  const amtAnchor = line('จำนวนเงิน', 50, 500, 80, 20);
  const baselineEvidence = {
    amount: {
      value: 500,
      candidates: [{ value: 500, source: 'ocr' }],
      confidenceTier: 'exact'
    }
  };
  const res = inspectAmountRoiTrigger(baselineEvidence, [amtAnchor], { width: 1000, height: 1600 });
  assert.equal(res.shouldTrigger, false);
});

test('Phase 4F: Priority budget enforcement picks exactly 1 primary target', async () => {
  const { determineRoiTarget } = await import('../../shared/slipRoiEvidence.mjs');
  const layout = [
    line('TRANSFER COMPLETED', 100, 100, 200, 30),
    line('จาก', 50, 300, 40, 20),
    line('จำนวนเงิน', 50, 500, 80, 20)
  ];
  const baselineEvidence = {
    datetime: { date: null, time: null, confidenceTier: 'uncertain' },
    sender: { rawName: 'ก ข ค', roleEvidence: [layout[1]], confidenceTier: 'partial' },
    amount: { value: 1000, candidates: [{ value: 1000 }, { value: 200 }], confidenceTier: 'conflict' }
  };
  const res = determineRoiTarget(baselineEvidence, layout, { width: 1000, height: 1600 });
  assert.ok(res.primary);
  assert.equal(res.primary.target, 'datetime', 'Datetime must have highest priority');
  assert.equal(res.deferred.length, 2, 'Lower priority targets must be deferred');
});

test('Phase 4F: Safe merge preserves baseline authoritative values when strong', async () => {
  const { mergeRoiEvidence } = await import('../../shared/slipRoiEvidence.mjs');
  const baselineEvidence = {
    datetime: { date: '2026-05-30', time: '15:14' },
    sender: { rawName: 'นาย สมชาย ใจดี' },
    amount: { value: 500 }
  };

  // 1. Agreement scenario
  const agreeExtraction = { date: '2026-05-30', time: '15:14' };
  const merged1 = mergeRoiEvidence(baselineEvidence, agreeExtraction, { target: 'datetime' });
  assert.equal(merged1.datetime.date, '2026-05-30');
  assert.equal(merged1.datetime.time, '15:14');
  assert.equal(merged1.datetime.roiAdvisory.status, 'corroborated');
  assert.equal(merged1.datetime.roiAdvisory.paymentUseAllowed, false);

  // 2. Disagreement scenario: baseline value must NOT be overwritten
  const disagreeExtraction = { date: '2026-01-01', time: '00:00' };
  const merged2 = mergeRoiEvidence(baselineEvidence, disagreeExtraction, { target: 'datetime' });
  assert.equal(merged2.datetime.date, '2026-05-30', 'Baseline date must be preserved');
  assert.equal(merged2.datetime.time, '15:14', 'Baseline time must be preserved');
  assert.equal(merged2.datetime.roiAdvisory.status, 'disagreement');
  assert.equal(merged2.datetime.roiAdvisory.roiConflict, true);
  assert.ok(merged2.datetime.warnings.includes('roi_baseline_datetime_conflict'));
  assert.equal(merged2.datetime.roiAdvisory.paymentUseAllowed, false);
});

test('Phase 4F: Baseline null + ROI candidate remains advisory only (paymentUseAllowed: false)', async () => {
  const { mergeRoiEvidence } = await import('../../shared/slipRoiEvidence.mjs');
  const baselineEvidence = {
    datetime: { date: null, time: null },
    sender: { rawName: null },
    amount: { value: null }
  };

  const recoveredDt = { date: '2024-05-27', time: '07:11' };
  const merged = mergeRoiEvidence(baselineEvidence, recoveredDt, { target: 'datetime' });

  assert.equal(merged.datetime.date, null, 'Authoritative date must remain null');
  assert.equal(merged.datetime.time, null, 'Authoritative time must remain null');
  assert.equal(merged.datetime.roiAdvisory.date, '2024-05-27');
  assert.equal(merged.datetime.roiAdvisory.time, '07:11');
  assert.equal(merged.datetime.roiAdvisory.status, 'candidate_recovered');
  assert.equal(merged.datetime.roiAdvisory.paymentUseAllowed, false, 'Must never be payment usable');
});

test('Phase 4F: Amount disagreement triggers advisory conflict without overwriting baseline', async () => {
  const { mergeRoiEvidence } = await import('../../shared/slipRoiEvidence.mjs');
  const baselineEvidence = {
    amount: { value: 1870, confidenceTier: 'partial' }
  };
  const roiAmt = { value: 870 };
  const merged = mergeRoiEvidence(baselineEvidence, roiAmt, { target: 'amount' });

  assert.equal(merged.amount.value, 1870, 'Authoritative amount must not be overwritten');
  assert.equal(merged.amount.roiAdvisory.value, 870);
  assert.equal(merged.amount.roiAdvisory.status, 'disagreement');
  assert.equal(merged.amount.roiAdvisory.roiConflict, true);
  assert.equal(merged.amount.confidenceTier, 'conflict');
  assert.equal(merged.amount.roiAdvisory.paymentUseAllowed, false);
});

test('Phase 4F: Runtime isolation - zero imports in runtime production files', () => {
  const runtimeFiles = [
    path.resolve(__dirname, '../server.js'),
    path.resolve(__dirname, '../slipVerifier.js'),
    path.resolve(__dirname, '../worker.js'),
    path.resolve(__dirname, '../../frontend/src/utils/browserSlipVerifier.js')
  ];

  for (const file of runtimeFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(
      !content.includes('slipRoiEvidence'),
      `Runtime file ${path.basename(file)} must NOT import slipRoiEvidence`
    );
  }
});
