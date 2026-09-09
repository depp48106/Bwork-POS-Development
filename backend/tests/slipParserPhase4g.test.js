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

test('Phase 4G: Roles ROI and Amount ROI are strictly disabled in policy', async () => {
  const mod = await import('../../shared/slipRoiDatetimePolicy.mjs');
  assert.deepEqual(mod.DISABLED_TARGETS, ['sender', 'receiver', 'amount']);
  assert.deepEqual(mod.ENABLED_TARGETS, ['datetime']);

  // Even with corrupted roles or amount conflict, determinePhase4gRoiTarget only evaluates datetime
  const baseline = {
    datetime: { date: '2026-05-30', time: '15:14', confidenceTier: 'partial' },
    sender: { rawName: 'ก ข ค ง', confidenceTier: 'uncertain' },
    amount: { value: 1000, confidenceTier: 'conflict' }
  };
  const decision = mod.determinePhase4gRoiTarget(baseline, [], { width: 1000, height: 1000 });
  assert.equal(decision.primary, null);
  assert.ok(decision.disabledTargets.includes('sender'));
  assert.ok(decision.disabledTargets.includes('receiver'));
  assert.ok(decision.disabledTargets.includes('amount'));
});

test('Phase 4G: Strong complete datetime does NOT trigger ROI', async () => {
  const { isDatetimeWeakOrMissing, inspectPolicy1Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const strongDatetime = { date: '2026-05-30', time: '15:14', confidenceTier: 'partial' };
  assert.equal(isDatetimeWeakOrMissing(strongDatetime), false);

  const topLines = [
    line('โอนเงินสำเร็จ', 100, 100, 180, 25),
    line('K PLUS', 100, 150, 80, 25)
  ];
  const res = inspectPolicy1Trigger({ datetime: strongDatetime }, topLines, { width: 1000, height: 1000 });
  assert.equal(res.shouldTrigger, false);
  assert.equal(res.reason, 'datetime_already_confident');
});

test('Phase 4G: Explicit weak datetime states allowlist', async () => {
  const { isDatetimeWeakOrMissing, WEAK_DATETIME_TIERS } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  assert.ok(WEAK_DATETIME_TIERS.has('uncertain'));
  assert.ok(WEAK_DATETIME_TIERS.has('conflict'));
  assert.ok(WEAK_DATETIME_TIERS.has('missing'));
  assert.ok(WEAK_DATETIME_TIERS.has('low_confidence'));

  // Missing time
  assert.equal(isDatetimeWeakOrMissing({ date: '2026-05-30', time: null }), true);
  // Missing date
  assert.equal(isDatetimeWeakOrMissing({ date: null, time: '15:14' }), true);
  // Uncertain tier
  assert.equal(isDatetimeWeakOrMissing({ date: '2026-05-30', time: '15:14', confidenceTier: 'uncertain' }), true);
  // Conflict tier
  assert.equal(isDatetimeWeakOrMissing({ date: '2026-05-30', time: '15:14', confidenceTier: 'conflict' }), true);
});

test('Phase 4G: Missing datetime alone does NOT trigger without header evidence', async () => {
  const { inspectPolicy1Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = { datetime: { date: null, time: null, confidenceTier: 'uncertain' } };
  // No layout lines in top region
  const res1 = inspectPolicy1Trigger(baseline, [], { width: 1000, height: 1000 });
  assert.equal(res1.shouldTrigger, false);
  assert.equal(res1.reason, 'no_independent_header_evidence');

  // Lines exist but lower down
  const lowerLines = [line('จำนวนเงิน 500.00 บาท', 100, 500, 200, 25)];
  const res2 = inspectPolicy1Trigger(baseline, lowerLines, { width: 1000, height: 1000 });
  assert.equal(res2.shouldTrigger, false);
  assert.equal(res2.reason, 'no_independent_header_evidence');
});

test('Phase 4G: Transaction-header keyword evidence triggers Policy 1', async () => {
  const { inspectPolicy1Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = { datetime: { date: null, time: null, confidenceTier: 'uncertain' } };
  const topLines = [line('โอนเงินสำเร็จ', 100, 100, 150, 25)];
  const res = inspectPolicy1Trigger(baseline, topLines, { width: 1000, height: 1000 });
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.policy, 'policy1_strict_layout');
  assert.equal(res.target, 'datetime');
  assert.ok(res.bbox);
  assert.equal(res.bbox.y0, 40);
  assert.equal(res.bbox.y1, 280);
});

test('Phase 4G: Top status-bar clock alone does NOT trigger datetime ROI', async () => {
  const { inspectPolicy1Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = { datetime: { date: null, time: null, confidenceTier: 'uncertain' } };
  // Top clock at y=20 (height=1000 => y <= 50)
  const statusBarLine = [line('09:41', 50, 20, 50, 20)];
  const res = inspectPolicy1Trigger(baseline, statusBarLine, { width: 1000, height: 1000 });
  assert.equal(res.shouldTrigger, false);
  assert.equal(res.reason, 'no_independent_header_evidence');
});

test('Phase 4G: Policy 1 does NOT depend on image filenames, banks, or ground truth', async () => {
  const { inspectPolicy1Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = { datetime: { date: null, time: null, confidenceTier: 'uncertain' } };
  const topLines = [line('TRANSFER COMPLETED', 100, 120, 200, 30)];

  // Function signature only takes baseline, layoutLines, dimensions
  const res = inspectPolicy1Trigger(baseline, topLines, { width: 1000, height: 1000 });
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.target, 'datetime');
});

test('Phase 4G: Policy 2 frozen thresholds and deterministic computation', async () => {
  const { FROZEN_POLICY2_THRESHOLDS, inspectPolicy2Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  assert.equal(FROZEN_POLICY2_THRESHOLDS.minContrastRange, 180);
  assert.equal(FROZEN_POLICY2_THRESHOLDS.minEdgeDensity, 4.5);
  assert.equal(FROZEN_POLICY2_THRESHOLDS.ghostMaxLen, 6);
  assert.equal(FROZEN_POLICY2_THRESHOLDS.ghostMaxConfidence, 75);

  const baseline = { datetime: { date: null, time: null, confidenceTier: 'uncertain' } };

  // Image metrics meeting frozen thresholds with ghost fragment
  const validMetrics = { localTextBandContrast: 220, horizontalEdgeDensity: 5.2, ocrGhostFragmentPresent: true };
  const res = inspectPolicy2Trigger(baseline, [], { width: 1000, height: 1000 }, validMetrics);
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.policy, 'policy2_exploratory_image_signal');

  // Below contrast threshold => no trigger
  const lowContrastMetrics = { localTextBandContrast: 120, horizontalEdgeDensity: 5.2, ocrGhostFragmentPresent: true };
  const res2 = inspectPolicy2Trigger(baseline, [], { width: 1000, height: 1000 }, lowContrastMetrics);
  assert.equal(res2.shouldTrigger, false);

  // Below edge density threshold => no trigger
  const lowEdgeMetrics = { localTextBandContrast: 220, horizontalEdgeDensity: 2.0, ocrGhostFragmentPresent: true };
  const res3 = inspectPolicy2Trigger(baseline, [], { width: 1000, height: 1000 }, lowEdgeMetrics);
  assert.equal(res3.shouldTrigger, false);
});

test('Phase 4G: Baseline preserved on ROI disagreement', async () => {
  const { mergeDatetimeRoi } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = {
    datetime: { date: '2026-05-30', time: '15:14' }
  };
  const roiExtraction = { date: '2026-01-01', time: '00:00' };
  const merged = mergeDatetimeRoi(baseline, roiExtraction);

  assert.equal(merged.datetime.date, '2026-05-30', 'Baseline date must be preserved');
  assert.equal(merged.datetime.time, '15:14', 'Baseline time must be preserved');
  assert.equal(merged.datetime.roiAdvisory.status, 'disagreement');
  assert.equal(merged.datetime.roiAdvisory.roiConflict, true);
  assert.equal(merged.datetime.roiAdvisory.paymentUseAllowed, false);
});

test('Phase 4G: ROI advisory candidate sets paymentUseAllowed: false', async () => {
  const { mergeDatetimeRoi } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = {
    datetime: { date: null, time: null }
  };
  const roiExtraction = { date: '2026-07-31', time: '07:11' };
  const merged = mergeDatetimeRoi(baseline, roiExtraction);

  assert.equal(merged.datetime.date, null, 'Baseline value remains null');
  assert.equal(merged.datetime.time, null, 'Baseline value remains null');
  assert.equal(merged.datetime.roiAdvisory.date, '2026-07-31');
  assert.equal(merged.datetime.roiAdvisory.time, '07:11');
  assert.equal(merged.datetime.roiAdvisory.status, 'candidate_recovered');
  assert.equal(merged.datetime.roiAdvisory.paymentUseAllowed, false);
});

test('Phase 4G: Runtime isolation - zero imports in runtime production files', () => {
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
      !content.includes('slipRoiDatetimePolicy'),
      `Runtime file ${path.basename(file)} must NOT import slipRoiDatetimePolicy`
    );
  }
});
