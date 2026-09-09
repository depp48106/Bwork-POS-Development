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

// 1. Roles ROI disabled
test('Phase 4I (1/18): Roles ROI is strictly disabled in policy', async () => {
  const mod = await import('../../shared/slipRoiDatetimePolicy.mjs');
  assert.ok(mod.DISABLED_TARGETS.includes('sender'));
  assert.ok(mod.DISABLED_TARGETS.includes('receiver'));
  const baseline = {
    datetime: { date: '2026-05-30', time: '15:14', confidenceTier: 'partial' },
    sender: { rawName: 'บงาย', confidenceTier: 'uncertain' },
    receiver: { rawName: null, confidenceTier: 'missing' }
  };
  const decision = mod.determinePhase4gRoiTarget(baseline, [], { width: 1000, height: 1000 });
  assert.equal(decision.primary, null);
});

// 2. Amount ROI disabled
test('Phase 4I (2/18): Amount ROI is strictly disabled in policy', async () => {
  const mod = await import('../../shared/slipRoiDatetimePolicy.mjs');
  assert.ok(mod.DISABLED_TARGETS.includes('amount'));
  const baseline = {
    datetime: { date: '2026-05-30', time: '15:14', confidenceTier: 'partial' },
    amount: { value: 1870, confidenceTier: 'conflict' }
  };
  const decision = mod.determinePhase4gRoiTarget(baseline, [], { width: 1000, height: 1000 });
  assert.equal(decision.primary, null);
});

// 3. Candidate A selection (top header keyword/density)
test('Phase 4I (3/18): Candidate A selection when top header keyword is present', async () => {
  const { inspectPolicy1Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = { datetime: { date: null, time: null, confidenceTier: 'uncertain' } };
  const topLines = [
    line('โอนเงินสำเร็จ', 100, 100, 150, 25),
    line('K PLUS', 100, 140, 80, 25)
  ];
  const res = inspectPolicy1Trigger(baseline, topLines, { width: 1000, height: 1000 });
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.region, 'top_transaction_header');
  assert.equal(res.target, 'datetime');
  assert.ok(res.bbox);
  assert.equal(res.bbox.y0, 40);
  assert.equal(res.bbox.y1, 280);
});

// 4. Candidate B selection (body datetime fragment + transaction semantic association)
test('Phase 4I (4/18): Candidate B selection for lower-body datetime with semantic association', async () => {
  const { inspectPolicy1Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = { datetime: { date: null, time: null, confidenceTier: 'uncertain' } };
  const bodyLines = [
    line('14 ก.พ. 2567 11:18', 100, 600, 200, 25),
    line('รหัสอ้างอิง 2024021481234567', 100, 630, 250, 25),
    line('โอนเงินสำเร็จ', 100, 660, 150, 25)
  ];
  const res = inspectPolicy1Trigger(baseline, bodyLines, { width: 1000, height: 1000 });
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.region, 'transaction_body_block');
  assert.equal(res.target, 'datetime');
  assert.ok(res.bbox.y0 <= 600);
  assert.ok(res.bbox.y1 >= 660);
});

// 5. Semantic association requirement (Candidate B rejected without semantic/structural evidence)
test('Phase 4I (5/18): Candidate B rejected if body datetime lacks transaction semantic association', async () => {
  const { detectTransactionBodyDatetimeRegion } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  // Date-like string in body, but surrounded only by unrelated text (no tx/ref/amount/party keywords)
  const isolatedBodyLines = [
    line('14 ก.พ. 2567', 100, 500, 150, 25),
    line('คำอธิบายทั่วไป lorem ipsum', 100, 530, 200, 25)
  ];
  const region = detectTransactionBodyDatetimeRegion(isolatedBodyLines, 1000, 1000);
  assert.equal(region, null, 'Should reject candidate B without semantic association');
});

// 6. Multiple body clusters: stronger support selected
test('Phase 4I (6/18): Multiple body clusters select cluster with stronger semantic support', async () => {
  const { detectTransactionBodyDatetimeRegion } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const lines = [
    // Weak cluster at y=250: 1 semantic match (party)
    line('10 Jan 2026', 100, 250, 120, 25),
    line('จาก นาย สมชาย', 100, 280, 150, 25),

    // Strong cluster at y=700: 3 semantic matches (transfer, ref, amount)
    line('14 ก.พ. 2567 11:18', 100, 700, 200, 25),
    line('โอนเงินสำเร็จ', 100, 730, 150, 25),
    line('เลขที่อ้างอิง REF999888', 100, 760, 200, 25),
    line('จำนวนเงิน 500.00 บาท', 100, 790, 180, 25)
  ];
  const region = detectTransactionBodyDatetimeRegion(lines, 1000, 1000);
  assert.ok(region, 'Region should be detected');
  assert.equal(region.region, 'transaction_body_block');
  // Should have selected the cluster around y=700-790
  assert.ok(region.bbox.y0 <= 700, 'Selected cluster bbox.y0 should be near y=700');
  assert.ok(region.bbox.y1 >= 700, 'Selected cluster bbox.y1 should encompass y=700');
});

// 7. Ambiguous multiple body clusters (equal support): fail closed (returns null)
test('Phase 4I (7/18): Ambiguous multiple body clusters with equal support fail closed (return null)', async () => {
  const { detectTransactionBodyDatetimeRegion } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const lines = [
    // Cluster 1 at y=300 with 1 semantic match
    line('10 Jan 2026', 100, 300, 120, 25),
    line('โอนเงินสำเร็จ', 100, 330, 150, 25),

    // Cluster 2 at y=700 with 1 semantic match
    line('11 Jan 2026', 100, 700, 120, 25),
    line('จ่ายบิลสำเร็จ', 100, 730, 150, 25)
  ];
  const region = detectTransactionBodyDatetimeRegion(lines, 1000, 1000);
  assert.equal(region, null, 'Ambiguous equal-support clusters must fail closed');
});

// 8. Fix 1: 2-digit-year uncertain with strong time does NOT trigger ROI
test('Phase 4I (8/18): Fix 1: year_or_date_uncertain with strong time does NOT trigger ROI', async () => {
  const { isDatetimeWeakOrMissing, inspectPolicy1Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = {
    datetime: {
      date: null,
      time: '14:27',
      confidenceTier: 'partial',
      warnings: ['year_or_date_uncertain']
    }
  };
  assert.equal(isDatetimeWeakOrMissing(baseline.datetime), false);
  const topLines = [line('โอนเงินสำเร็จ', 100, 100, 150, 25)];
  const res = inspectPolicy1Trigger(baseline, topLines, { width: 1000, height: 1000 });
  assert.equal(res.shouldTrigger, false);
  assert.equal(res.reason, 'datetime_already_confident');
});

// 9. Fix 1: missing time WITH 2-digit-year STILL triggers ROI
test('Phase 4I (9/18): Fix 1: missing time with year_or_date_uncertain STILL triggers ROI', async () => {
  const { isDatetimeWeakOrMissing, inspectPolicy1Trigger } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = {
    datetime: {
      date: null,
      time: null,
      confidenceTier: 'uncertain',
      warnings: ['year_or_date_uncertain']
    }
  };
  assert.equal(isDatetimeWeakOrMissing(baseline.datetime), true);
  const topLines = [line('โอนเงินสำเร็จ', 100, 100, 150, 25)];
  const res = inspectPolicy1Trigger(baseline, topLines, { width: 1000, height: 1000 });
  assert.equal(res.shouldTrigger, true);
  assert.equal(res.region, 'top_transaction_header');
});

// 10. Spaced colon tolerance (11: 51 -> 11:51)
test('Phase 4I (10/18): Spaced colon tolerance normalizes "11: 51" to "11:51"', async () => {
  const { extractSlipEvidence } = await import('../../shared/slipVerificationCore.mjs');
  const { extractDatetimeRoi } = await import('../../shared/slipRoiDatetimePolicy.mjs');

  const textWithSpacedColons = 'โอนเงินสำเร็จ\n14 ก.พ. 2567 11: 51\nจำนวนเงิน 100.00 บาท';
  const ev = extractSlipEvidence(textWithSpacedColons);
  assert.equal(ev.datetime?.time, '11:51');

  const roiEv = extractDatetimeRoi(textWithSpacedColons);
  assert.equal(roiEv.time, '11:51');
});

// 11. Thai month combining mark tolerance (ก.ุพ. -> ก.พ.)
test('Phase 4I (11/18): Thai month combining-mark noise tolerance (ก.ุพ. -> ก.พ.)', async () => {
  const { parseDate } = await import('../../shared/slipLayoutEvidence.mjs');
  const noisyThaiDate = '14 ก.ุพ. 2567';
  const parsed = parseDate(noisyThaiDate);
  assert.equal(parsed, '2024-02-14');

  const noisyThaiDate2 = '14 กุ.พ. 2567';
  const parsed2 = parseDate(noisyThaiDate2);
  assert.equal(parsed2, '2024-02-14');
});

// 12. Ambiguity Guard: single candidate accepted
test('Phase 4I (12/18): Ambiguity Guard: single candidate accepted', async () => {
  const { extractDatetimeRoi } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const roiText = 'TRANSFER COMPLETED\n25 May 2024 10:15:30\nRef: 12345';
  const extraction = extractDatetimeRoi(roiText);
  assert.equal(extraction.date, '2024-05-25');
  assert.equal(extraction.time, '10:15:30');
  assert.equal(extraction.provenance.dateConflict, false);
  assert.equal(extraction.provenance.timeConflict, false);
});

// 13. Ambiguity Guard: identical candidates corroborated
test('Phase 4I (13/18): Ambiguity Guard: multiple identical candidates corroborated', async () => {
  const { extractDatetimeRoi } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const roiText = 'TRANSFER COMPLETED 15:30\nDate: 25 May 2024\nTime: 15:30\nTransaction Date: 25 May 2024';
  const extraction = extractDatetimeRoi(roiText);
  assert.equal(extraction.date, '2024-05-25');
  assert.equal(extraction.time, '15:30');
  assert.equal(extraction.provenance.distinctDates.length, 1);
  assert.equal(extraction.provenance.distinctTimes.length, 1);
  assert.equal(extraction.provenance.dateConflict, false);
  assert.equal(extraction.provenance.timeConflict, false);
});

// 14. Ambiguity Guard: multiple distinct dates -> fail closed
test('Phase 4I (14/18): Ambiguity Guard: multiple distinct dates fail closed to null and set dateConflict', async () => {
  const { extractDatetimeRoi } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const roiText = 'TRANSFER COMPLETED\n25 May 2024 10:15\nEffective: 26 May 2024';
  const extraction = extractDatetimeRoi(roiText);
  assert.equal(extraction.date, null, 'Distinct conflicting dates must resolve to null');
  assert.equal(extraction.provenance.dateConflict, true);
  assert.equal(extraction.provenance.distinctDates.length, 2);
});

// 15. Ambiguity Guard: multiple distinct times -> fail closed
test('Phase 4I (15/18): Ambiguity Guard: multiple distinct times fail closed to null and set timeConflict', async () => {
  const { extractDatetimeRoi } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const roiText = 'TRANSFER COMPLETED 10:15\nOrder created: 09:30';
  const extraction = extractDatetimeRoi(roiText);
  assert.equal(extraction.time, null, 'Distinct conflicting times must resolve to null');
  assert.equal(extraction.provenance.timeConflict, true);
  assert.equal(extraction.provenance.distinctTimes.length, 2);
});

// 16. Baseline preserved on ROI disagreement
test('Phase 4I (16/18): Baseline authoritative values preserved on ROI disagreement', async () => {
  const { mergeDatetimeRoi } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = {
    datetime: { date: '2024-05-25', time: '10:15' }
  };
  const roiExtraction = { date: '2024-05-26', time: '11:20' };
  const merged = mergeDatetimeRoi(baseline, roiExtraction);
  assert.equal(merged.datetime.date, '2024-05-25', 'Baseline date must be preserved');
  assert.equal(merged.datetime.time, '10:15', 'Baseline time must be preserved');
  assert.equal(merged.datetime.roiAdvisory.status, 'disagreement');
  assert.equal(merged.datetime.roiAdvisory.roiConflict, true);
});

// 17. ROI advisory candidate sets paymentUseAllowed: false
test('Phase 4I (17/18): ROI advisory candidate always sets paymentUseAllowed: false', async () => {
  const { mergeDatetimeRoi } = await import('../../shared/slipRoiDatetimePolicy.mjs');
  const baseline = {
    datetime: { date: null, time: null }
  };
  const roiExtraction = { date: '2024-05-25', time: '10:15' };
  const merged = mergeDatetimeRoi(baseline, roiExtraction);
  assert.equal(merged.datetime.roiAdvisory.paymentUseAllowed, false);
  assert.equal(merged.datetime.roiAdvisory.date, '2024-05-25');
  assert.equal(merged.datetime.roiAdvisory.time, '10:15');
});

// 18. Runtime isolation (zero production imports of slipRoiDatetimePolicy)
test('Phase 4I (18/18): Runtime isolation - zero production imports of slipRoiDatetimePolicy', () => {
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
