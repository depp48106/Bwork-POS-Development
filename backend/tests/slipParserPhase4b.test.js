'use strict';
// Phase 4B regression tests: layout evidence, contextual headers, logo icon exclusion, Image 410 protection, and payment safety.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSlipEvidence, analyzeSlipText } = require('../../shared/slipVerificationCore.mjs');
const { normalizeLayout, layoutRoles, temporalAndReference, spatialAmount } = require('../../shared/slipLayoutEvidence.mjs');

const line = (text, x, y, w = 80, h = 20, words = null) => ({
  text,
  confidence: 90,
  bbox: { x0: x, y0: y, x1: x + w, y1: y + h },
  words: words || [{ text, bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, confidence: 90 }]
});

test('Contextual transaction header + nearby datetime (Thai and English)', () => {
  const scbLines = [
    line('Successful payment', 100, 100, 200, 25),
    line('04 Sep 2026 - 10:25', 100, 135, 180, 20),
    line('Ref ID: 2026090432jUYew1soxtHAyRy', 100, 165, 300, 20)
  ];
  const e1 = extractSlipEvidence('', null, scbLines);
  assert.equal(e1.datetime.date, '2026-09-04');
  assert.equal(e1.datetime.time, '10:25');

  const ktbLines = [
    line('“2 ท ํ า ร า ย ก า ร ส ํ า เร ็ จ', 90, 440, 480, 40),
    line('07 ก.ย. 2569 18:42', 250, 520, 300, 30)
  ];
  const e2 = extractSlipEvidence('', null, ktbLines);
  assert.equal(e2.datetime.date, '2026-09-07');
  assert.equal(e2.datetime.time, '18:42');

  const kbankLines = [
    line('Transfer Completed', 100, 50, 200, 25),
    line('31 Aug 2026 8:33 PM', 100, 85, 180, 20)
  ];
  const e3 = extractSlipEvidence('', null, kbankLines);
  assert.equal(e3.datetime.date, '2026-08-31');
  assert.equal(e3.datetime.time, '8:33 PM');
});

test('Phone status-bar time rejection', () => {
  const lines = [
    line('09:30', 50, 10, 50, 15),
    line('Screenshot 2026-09-08', 100, 10, 150, 15),
    line('Successful payment', 100, 200, 200, 25),
    line('04 Sep 2026 - 14:15', 100, 235, 180, 20)
  ];
  const e = extractSlipEvidence('', null, lines);
  assert.equal(e.datetime.time, '14:15');
  assert.equal(e.datetime.date, '2026-09-04');
});

test('Thai Buddhist Era and English month handling', () => {
  const thaiText = 'Successful payment\n07 ก.ย. 2569 18:46 น.';
  const e1 = extractSlipEvidence(thaiText);
  assert.equal(e1.datetime.date, '2026-09-07');
  assert.equal(e1.datetime.time, '18:46');

  const engText = 'Successful payment\n29 Aug 2026 - 11:30';
  const e2 = extractSlipEvidence(engText);
  assert.equal(e2.datetime.date, '2026-08-29');
  assert.equal(e2.datetime.time, '11:30');
});

test('2-digit year uncertainty returns date: null without inventing century', () => {
  const lines = [
    line('Successful payment', 100, 100, 200, 25),
    line('07 ก.ย. 69 18:42', 100, 135, 180, 20)
  ];
  const e = extractSlipEvidence('', null, lines);
  assert.equal(e.datetime.date, null);
  assert.equal(e.datetime.time, '18:42');
  assert.ok(e.datetime.warnings.includes('year_or_date_uncertain'));
});

test('Sender/receiver isolated logo/icon exclusion (@, ©, ®)', () => {
  const wordsFrom = [
    { text: 'FROM', bbox: { x0: 50, y0: 100, x1: 100, y1: 120 }, confidence: 95 },
    { text: '@', bbox: { x0: 150, y0: 100, x1: 170, y1: 120 }, confidence: 90 },
    { text: 'MR.', bbox: { x0: 180, y0: 100, x1: 210, y1: 120 }, confidence: 95 },
    { text: 'Kunakorn', bbox: { x0: 215, y0: 100, x1: 280, y1: 120 }, confidence: 95 },
    { text: 'Y.', bbox: { x0: 285, y0: 100, x1: 300, y1: 120 }, confidence: 95 }
  ];
  const wordsTo = [
    { text: 'TO', bbox: { x0: 50, y0: 200, x1: 80, y1: 220 }, confidence: 95 },
    { text: '©', bbox: { x0: 130, y0: 200, x1: 150, y1: 220 }, confidence: 90 },
    { text: 'PROVINCIAL', bbox: { x0: 160, y0: 200, x1: 250, y1: 220 }, confidence: 95 },
    { text: 'WATERWORKS', bbox: { x0: 255, y0: 200, x1: 360, y1: 220 }, confidence: 95 },
    { text: 'AUT', bbox: { x0: 365, y0: 200, x1: 400, y1: 220 }, confidence: 95 }
  ];
  const lines = [
    line('FROM @ MR. Kunakorn Y.', 50, 100, 250, 20, wordsFrom),
    line('xxx-xxx411-7', 50, 130, 120, 20),
    line('TO © PROVINCIAL WATERWORKS AUT', 50, 200, 350, 20, wordsTo),
    line('xxx-xxx999-7', 50, 230, 120, 20)
  ];
  const e = extractSlipEvidence('', null, lines);
  assert.equal(e.sender.rawName, 'MR. Kunakorn Y.');
  assert.ok(e.sender.warnings.includes('spatial_logo_token_excluded'));
  assert.equal(e.receiver.rawName, 'PROVINCIAL WATERWORKS AUT');
  assert.ok(e.receiver.warnings.includes('spatial_logo_token_excluded'));
});

test('Image-410 protection: "10" is NEVER reinterpreted as "TO", ambiguous role fails closed', () => {
  const words = [
    { text: '10', bbox: { x0: 50, y0: 200, x1: 70, y1: 220 }, confidence: 85 },
    { text: '®', bbox: { x0: 80, y0: 200, x1: 100, y1: 220 }, confidence: 85 },
    { text: 'MR.', bbox: { x0: 110, y0: 200, x1: 140, y1: 220 }, confidence: 95 },
    { text: 'KUNAKORN', bbox: { x0: 145, y0: 200, x1: 220, y1: 220 }, confidence: 95 },
    { text: 'YAMLOY', bbox: { x0: 225, y0: 200, x1: 280, y1: 220 }, confidence: 95 }
  ];
  const lines = [
    line('FROM @ MR. Kunakorn Y.', 50, 100, 250, 20),
    line('10 ® MR. KUNAKORN YAMLOY', 50, 200, 280, 20, words),
    line('x-9901', 50, 230, 80, 20)
  ];
  const e = extractSlipEvidence('', null, lines);
  assert.equal(e.receiver.rawName, null);
  assert.equal(e.receiver.confidenceTier, 'uncertain');
  assert.ok(e.receiver.warnings.includes('role_ambiguous'));
});

test('Spatial amount evidence marks paymentUseAllowed: false and preserves fee guards', () => {
  const wordsAmount = [{ text: 'Amount', bbox: { x0: 50, y0: 300, x1: 120, y1: 320 }, confidence: 95 }];
  const wordsValue = [{ text: '159.00', bbox: { x0: 50, y0: 330, x1: 110, y1: 350 }, confidence: 92 },
                      { text: 'Baht', bbox: { x0: 115, y0: 330, x1: 150, y1: 350 }, confidence: 90 }];
  const lines = [
    line('Amount', 50, 300, 70, 20, wordsAmount),
    line('159.00 Baht', 50, 330, 100, 20, wordsValue)
  ];
  const plainAmount = { value: null, raw: null, candidates: [], evidence: { recoveredAcrossFeeContext: false }, warnings: ['amount_missing'] };
  const recovered = spatialAmount(plainAmount, lines);
  assert.equal(recovered.value, 159);
  assert.equal(recovered.paymentUseAllowed, false);
  assert.ok(recovered.warnings.includes('evidence_only_amount_recovery_not_payment_eligible'));

  const feePlain = { value: null, raw: null, candidates: [], evidence: { recoveredAcrossFeeContext: true }, warnings: [] };
  const blocked = spatialAmount(feePlain, lines);
  assert.equal(blocked.value, null);
});

test('Reference Thai space tolerance and character ambiguity', () => {
  const lines = [
    line('ร ห ั ส อ ้ า ง อ ิ ง 7a37139c62174dae9f900c6482416698', 100, 500, 500, 25)
  ];
  const e = extractSlipEvidence('', null, lines);
  assert.equal(e.reference.value, '7a37139c62174dae9f900c6482416698');
  assert.equal(e.reference.source, 'ocr');

  const ambLines = [
    line('รหัสอ้างอิง 0O1Il5S8', 100, 500, 300, 25)
  ];
  const amb = extractSlipEvidence('', null, ambLines);
  assert.equal(amb.reference.value, '0O1Il5S8');
  assert.equal(amb.reference.confidenceTier, 'uncertain');
  assert.ok(amb.reference.warnings.includes('reference_character_ambiguity'));
});

test('Zero payment auto-approval expansion: new layout evidence does NOT alter verificationTier', () => {
  const config = { accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด', accountNumber: '1234567890', bankName: 'Krungsri' };
  const qr = { isValidSlipQR: true, bankCode: '025', transRef: 'ABC234' };
  const text = 'Successful payment\n04 Sep 2026 - 10:25\nFROM @ MR. Kunakorn Y.\nTO © PROVINCIAL WATERWORKS AUT\nAmount 175.48';
  const lines = [
    line('Successful payment', 100, 100, 200, 25),
    line('04 Sep 2026 - 10:25', 100, 135, 180, 20),
    line('FROM @ MR. Kunakorn Y.', 50, 200, 250, 20),
    line('TO © PROVINCIAL WATERWORKS AUT', 50, 250, 350, 20),
    line('Amount 175.48', 50, 300, 150, 20)
  ];
  const analysis = analyzeSlipText(text, config, qr, lines);
  assert.equal(analysis.hasCompanyMatch, false);
  assert.equal(analysis.verificationTier, 'manual_review');
});
