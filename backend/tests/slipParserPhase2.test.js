'use strict';
// Synthetic evidence only: no network, real database, images or secrets.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../shared/slipVerificationCore.mjs');
const backend = require('../slipVerifier');
const config = { accountName: 'บริษัท บิลท์ ฮาร์ท จำกัด', accountNumber: '1234567890', bankName: 'Krungsri' };
const labeled = name => ['From', 'Other Sender', 'TO', name, 'Krungsri', '1234567890', 'Amount 300 THB'].join('\n');

for (const [text, expected] of [
  ['09:30\nBalance 1300.00', null], ['Amount 30\nAmount 300', null],
  ['Amount\nFee 30.00\n300.00 THB', 300], ['Amount 1,30,0.00', null],
  ['Amount 300.00บาท', 300], ['Amount\n300.00 THB\nBalance\n12,500.00 THB', 300],
  ['Amount 300.00 THB\nBalance 1300.00 THB', 300],
  ['Balance 1300.00 THB\n09:30', null], ['Available Balance 300 THB', null],
  ['Remaining Balance\n300 THB', null], ['Service Fee 300 THB', null],
  ['ยอดเงินคงเหลือ 300 บาท', null], ['ยอดคงเหลือ\n300 บาท', null],
  ['ค่าธรรมเนียม 300 บาท', null], ['Account 1234567890', null],
  ['Phone 0812345678', null], ['Date 2026/09/08\nTime 09:30', null],
  ['Amount 30', 30], ['Amount 300', 300], ['Amount 1,300', 1300],
  ['Amount 1,300.00', 1300]
]) {
  test('Phase2 amount parity: ' + JSON.stringify(text), () => {
    assert.equal(core.extractPreciseAmount(text), expected);
    assert.equal(backend.extractPreciseAmount(text, 300), expected);
    assert.deepEqual(backend.analyzeSlipText(text, config), core.analyzeSlipText(text, config));
  });
}
test('SCB artifact cleanup is target independent and preserves raw evidence', () => {
  const raw = '5 บริษัท บิลท์ ฮาร์ท จำกัด';
  const a = core.analyzeSlipText(labeled(raw), config);
  const b = core.analyzeSlipText(labeled(raw), { ...config, accountName: 'บริษัท อื่น จำกัด' });
  assert.deepEqual(a.evidence, b.evidence);
  assert.equal(a.evidence.receiver.rawName, raw);
  assert.equal(a.evidence.receiver.comparisonNormalizedName, 'บริษัท บิลท์ ฮาร์ท จำกัด');
  assert.equal(a.hasNameMatch, true);
  assert.equal(b.hasNameMatch, false);
  assert.equal(core.comparisonName('5 บจก. ตัวอย่าง จำกัด'), 'บจก. ตัวอย่าง จำกัด');
});
for (const name of ['7-Eleven', '123 Company', 'บริษัท 5 ดาว จำกัด', '5 Star Company']) {
  test('Protect digit name: ' + name, () => {
    assert.equal(core.comparisonName(name), name);
    assert.match(core.normalizeReceiverLine(name), /\d/);
  });
}
test('Masks and sender/receiver roles survive extraction without configured corrections', () => {
  const e = core.extractSlipEvidence(labeled('สม*** ใจดี'));
  assert.equal(e.sender.rawName, 'Other Sender');
  assert.equal(e.receiver.rawName, 'สม*** ใจดี');
  assert.match(e.receiver.normalizedName, /\*\*\*/);
  assert.equal(core.normalizeReceiverLine('ด ปิลท์ ฮาร์ท', 'บิลท์ฮาร์ท'), core.normalizeReceiverLine('ด ปิลท์ ฮาร์ท', 'อื่น'));
  assert.equal(core.extractSlipEvidence('Unlabeled Name\n300 THB').receiver.confidenceTier, 'uncertain');
  const masked = core.extractSlipEvidence('TO\nสม*** ใจดี\nxxx-x-x1234-x\nAmount 300');
  assert.equal(masked.receiver.accountMasked, 'xxx-x-x1234-x');
  assert.equal(masked.qr.parsed, false);
  assert.equal(masked.amount.value, 300); // QR absence does not suppress review evidence.
});
test('Shared QR format validation is identical, unknown/truncated/duplicate tags fail', () => {
  const tlv = (tag, value) => tag + String(value.length).padStart(2, '0') + value;
  const valid = tlv('00', tlv('01', '014') + tlv('02', 'TESTREF123'));
  for (const raw of [valid, valid.slice(0,-1), tlv('00',tlv('01','999')+tlv('02','TESTREF123')),
    tlv('00',tlv('01','014')+tlv('01','004')+tlv('02','TESTREF123')), 'not a QR']) {
    const result = core.parseThaiBankSlipQR(raw);
    assert.deepEqual(result, backend.parseThaiBankSlipQR(raw));
    assert.equal(result.isValidSlipQR, raw === valid);
  }
});
