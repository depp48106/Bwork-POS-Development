'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSlipEvidence } = require('../../shared/slipVerificationCore.mjs');
const { layoutRoles, temporalAndReference } = require('../../shared/slipLayoutEvidence.mjs');

const line = (text, x, y, w = 80, h = 20, words = null) => ({
  text,
  confidence: 90,
  bbox: { x0: x, y0: y, x1: x + w, y1: y + h },
  words: words || [{ text, bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, confidence: 90 }]
});

test('Target Fix 1: โอนเงินสำเร็จ anchors adjacent datetime', () => {
  const lines = [
    line('โอนเงินสำเร็จ', 100, 100, 150, 25),
    line('12 ก.ย. 2569 14:25 น.', 100, 135, 180, 20)
  ];
  const ev = extractSlipEvidence('โอนเงินสำเร็จ\n12 ก.ย. 2569 14:25 น.', null, lines);
  assert.equal(ev.datetime.date, '2026-09-12');
  assert.equal(ev.datetime.time, '14:25');
});

test('Target Fix 1: จ่ายบิลสำเร็จ anchors adjacent datetime', () => {
  const lines = [
    line('จ่ายบิลสำเร็จ', 100, 100, 150, 25),
    line('19 ก.ย. 2569 20:04 น.', 100, 135, 180, 20)
  ];
  const ev = extractSlipEvidence('จ่ายบิลสำเร็จ\n19 ก.ย. 2569 20:04 น.', null, lines);
  assert.equal(ev.datetime.date, '2026-09-19');
  assert.equal(ev.datetime.time, '20:04');
});

test('Target Fix 1: Unrelated text containing สำเร็จ does NOT become transaction anchor', () => {
  const lines = [
    line('สมัครสมาชิกสำเร็จ', 100, 100, 180, 25),
    line('12 ก.ย. 2569 14:25 น.', 100, 135, 180, 20)
  ];
  const ev = extractSlipEvidence('สมัครสมาชิกสำเร็จ\n12 ก.ย. 2569 14:25 น.', null, lines);
  // Without transaction completion semantics (โอนเงิน/จ่ายบิล/ทำรายการ/transfer/payment), no contextual date is anchored
  assert.equal(ev.datetime.date, null);
  assert.equal(ev.datetime.time, null);
});

test('Target Fix 1: Top phone status-bar clock remains rejected even with transaction anchor below', () => {
  const layout = [
    line('17:55', 30, 20, 50, 20),
    line('โอนเงินสำเร็จ', 40, 80, 180, 25),
    line('03 ต.ค. 2569 18:20 น.', 40, 125, 200, 20)
  ];
  const ocrText = '17:55\nโอนเงินสำเร็จ\n03 ต.ค. 2569 18:20 น.';
  const temp = temporalAndReference(ocrText, layout);
  assert.equal(temp.datetime.date, '2026-10-03');
  assert.equal(temp.datetime.time, '18:20', 'Must select 18:20, NOT top clock 17:55');
});

test('Target Fix 2: Thai TSV spaced role labels "จ า ก :" and "ถ ึ ง :" extracted as roles', () => {
  const layout = [
    line('จ า ก :', 40, 100, 50, 20),
    line('นาย สมชาย ใจดี', 40, 125, 150, 25),
    line('ถ ึ ง :', 40, 175, 50, 20),
    line('บริษัท บิลท์ ฮาร์ท จำกัด', 40, 200, 200, 25),
    line('จำนวนเงิน 350.00 บาท', 40, 250, 180, 25)
  ];
  const roles = layoutRoles(layout, s => s);
  assert.equal(roles.sender.rawName, 'นาย สมชาย ใจดี');
  assert.equal(roles.receiver.rawName, 'บริษัท บิลท์ ฮาร์ท จำกัด');
});

test('Target Fix 2: Normal "จาก" and "ถึง" remain unchanged and work identically', () => {
  const layout = [
    line('จาก: นาย สมชาย ใจดี', 40, 100, 200, 25),
    line('ถึง: บริษัท บิลท์ ฮาร์ท จำกัด', 40, 150, 220, 25)
  ];
  const roles = layoutRoles(layout, s => s);
  assert.equal(roles.sender.rawName, 'นาย สมชาย ใจดี');
  assert.equal(roles.receiver.rawName, 'บริษัท บิลท์ ฮาร์ท จำกัด');
});

test('Target Fix 2: Spaced customer names are NOT collapsed destructively', () => {
  const layout = [
    line('จ า ก : นาย สมชาย ใจดี มากมาก', 40, 100, 250, 25),
    line('ถ ึ ง : บริษัท บิลท์ ฮาร์ท จำกัด', 40, 150, 250, 25)
  ];
  const roles = layoutRoles(layout, s => s);
  // Spaces inside customer names must be fully preserved
  assert.equal(roles.sender.rawName, 'นาย สมชาย ใจดี มากมาก');
  assert.equal(roles.receiver.rawName, 'บริษัท บิลท์ ฮาร์ท จำกัด');
});

test('Target Fix 2: Image-410 protection: "10" remains NOT "TO"', () => {
  const layout = [
    line('FROM MR. KUNAKORN Y.', 40, 100, 200, 25),
    line('10', 40, 150, 30, 20),
    line('นาย เอกชัย วงศ์สวัสดิ์', 40, 175, 180, 25)
  ];
  const roles = layoutRoles(layout, s => s);
  assert.equal(roles.sender.rawName, 'MR. KUNAKORN Y.');
  assert.equal(roles.receiver.rawName, null, 'Ambiguous "10" must fail closed to null');
  assert.equal(roles.receiver.warnings.includes('role_ambiguous'), true);
});

test('Target Fix 2: Missing receiver label remains fail-closed', () => {
  const layout = [
    line('จาก: นาย นิธิศ วัฒนา', 40, 100, 180, 25),
    line('นาย เอกชัย วงศ์สวัสดิ์', 40, 150, 180, 25)
  ];
  const roles = layoutRoles(layout, s => s);
  assert.equal(roles.sender.rawName, 'นาย นิธิศ วัฒนา');
  assert.equal(roles.receiver.rawName, null, 'Unlabelled name must not be assumed receiver');
});
