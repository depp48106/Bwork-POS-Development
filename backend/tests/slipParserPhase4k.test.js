'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifySlip } = require('../slipVerifier.js');

// Mock helper to create dummy image buffer and layout evidence
const mockImageBuffer = Buffer.from('dummy-image-data');
const mockValidQr = {
  isValidSlipQR: true,
  transRef: 'PHASE4KTEST12345',
  bankCode: '004',
  bankName: 'ธนาคารกสิกรไทย'
};

const mockLayoutLine = (text, x, y, w = 100, h = 20) => ({
  text,
  confidence: 90,
  bbox: { x0: x, y0: y, x1: x + w, y1: y + h },
  words: [{ text, bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, confidence: 90 }]
});

const createMockJimp = (width = 800, height = 1200, shouldThrow = false) => {
  if (shouldThrow) {
    return {
      read: async () => { throw new Error('Simulated Jimp read failure'); },
      MIME_PNG: 'image/png'
    };
  }
  return {
    read: async () => ({
      bitmap: { width, height },
      clone() { return this; },
      crop() { return this; },
      greyscale() { return this; },
      contrast() { return this; },
      scale() { return this; },
      getBufferAsync: async () => Buffer.from('mock-crop-png')
    }),
    MIME_PNG: 'image/png'
  };
};

// ============================================================================
// Test 1: Feature flag absent -> OFF (no shadow ROI executed)
// ============================================================================
test('Phase 4K (1/18): BWORK_SLIP_ROI_SHADOW absent defaults to OFF', async () => {
  delete process.env.BWORK_SLIP_ROI_SHADOW;
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ\nจำนวน 500.00 บาท',
      detectedAmount: 500,
      evidence: { layout: [mockLayoutLine('โอนเงินสำเร็จ', 50, 50)], datetime: { date: null, time: null } }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(ocrCalls, 1, 'Only baseline OCR should be invoked');
  assert.equal(res.details.shadowDatetimeRoi, undefined, 'Shadow ROI details must not exist');
});

// ============================================================================
// Test 2: BWORK_SLIP_ROI_SHADOW="" -> OFF
// ============================================================================
test('Phase 4K (2/18): BWORK_SLIP_ROI_SHADOW="" behaves as OFF', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = '';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ\nจำนวน 500.00 บาท',
      detectedAmount: 500,
      evidence: { layout: [mockLayoutLine('โอนเงินสำเร็จ', 50, 50)], datetime: { date: null, time: null } }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(ocrCalls, 1);
  assert.equal(res.details.shadowDatetimeRoi, undefined);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 3: BWORK_SLIP_ROI_SHADOW="false" -> OFF
// ============================================================================
test('Phase 4K (3/18): BWORK_SLIP_ROI_SHADOW="false" behaves as OFF', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'false';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ\nจำนวน 500.00 บาท',
      detectedAmount: 500,
      evidence: { layout: [mockLayoutLine('โอนเงินสำเร็จ', 50, 50)], datetime: { date: null, time: null } }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(ocrCalls, 1);
  assert.equal(res.details.shadowDatetimeRoi, undefined);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 4: BWORK_SLIP_ROI_SHADOW="0" -> OFF
// ============================================================================
test('Phase 4K (4/18): BWORK_SLIP_ROI_SHADOW="0" behaves as OFF', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = '0';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ\nจำนวน 500.00 บาท',
      detectedAmount: 500,
      evidence: { layout: [mockLayoutLine('โอนเงินสำเร็จ', 50, 50)], datetime: { date: null, time: null } }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(ocrCalls, 1);
  assert.equal(res.details.shadowDatetimeRoi, undefined);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 5: BWORK_SLIP_ROI_SHADOW="TRUE" (uppercase) -> OFF
// ============================================================================
test('Phase 4K (5/18): BWORK_SLIP_ROI_SHADOW="TRUE" behaves as OFF', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'TRUE';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ\nจำนวน 500.00 บาท',
      detectedAmount: 500,
      evidence: { layout: [mockLayoutLine('โอนเงินสำเร็จ', 50, 50)], datetime: { date: null, time: null } }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(ocrCalls, 1);
  assert.equal(res.details.shadowDatetimeRoi, undefined);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 6: BWORK_SLIP_ROI_SHADOW="true " (whitespace) -> OFF
// ============================================================================
test('Phase 4K (6/18): BWORK_SLIP_ROI_SHADOW="true " behaves as OFF', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'true ';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ\nจำนวน 500.00 บาท',
      detectedAmount: 500,
      evidence: { layout: [mockLayoutLine('โอนเงินสำเร็จ', 50, 50)], datetime: { date: null, time: null } }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(ocrCalls, 1);
  assert.equal(res.details.shadowDatetimeRoi, undefined);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 7: BWORK_SLIP_ROI_SHADOW="true" -> ON, executes shadow analysis
// ============================================================================
test('Phase 4K (7/18): BWORK_SLIP_ROI_SHADOW="true" is ON and populates shadow details', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'true';
  let ocrCalls = 0;
  const mockRunOCR = async (buf) => {
    ocrCalls++;
    if (ocrCalls === 1) {
      return {
        success: true,
        ocrText: 'โอนเงินสำเร็จ\nจำนวน 500.00 บาท',
        detectedAmount: 500,
        evidence: {
          layout: [mockLayoutLine('โอนเงินสำเร็จ', 100, 100)],
          datetime: { date: null, time: null, confidenceTier: 'uncertain' }
        }
      };
    }
    // Secondary ROI OCR
    return {
      success: true,
      ocrText: '09 ก.ย. 2569 14:30 น.',
      evidence: {
        layout: [mockLayoutLine('09 ก.ย. 2569 14:30 น.', 10, 10)]
      }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(ocrCalls, 2, 'Should execute baseline OCR + 1 secondary ROI OCR');
  assert.ok(res.details.shadowDatetimeRoi, 'Shadow details must exist');
  assert.equal(res.details.shadowDatetimeRoi.enabled, true);
  assert.equal(res.details.shadowDatetimeRoi.triggered, true);
  assert.equal(res.details.shadowDatetimeRoi.region, 'top_transaction_header');
  assert.equal(res.details.shadowDatetimeRoi.time, '14:30');
  assert.equal(res.details.shadowDatetimeRoi.date, '2026-09-09');
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 8: Flag OFF -> baseline return shape completely unchanged
// ============================================================================
test('Phase 4K (8/18): Flag OFF has identical baseline return shape and zero shadow leak', async () => {
  delete process.env.BWORK_SLIP_ROI_SHADOW;
  const mockRunOCR = async () => ({
    success: true,
    ocrText: 'โอนเงินสำเร็จ\nจำนวน 500.00 บาท',
    detectedAmount: 500,
    verificationTier: 'full_auto',
    evidence: { layout: [], datetime: { date: '2026-09-09', time: '14:30' } }
  });

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(res.details.shadowDatetimeRoi, undefined);
  assert.equal(res.verificationTier, 'full_auto');
  assert.equal(res.detectedAmount, 500);
});

// ============================================================================
// Test 9: Flag ON -> paymentUseAllowed is strictly false
// ============================================================================
test('Phase 4K (9/18): Flag ON strictly enforces paymentUseAllowed === false', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'true';
  const mockRunOCR = async (buf) => ({
    success: true,
    ocrText: 'โอนเงินสำเร็จ\n14:30 น.',
    detectedAmount: 500,
    evidence: {
      layout: [mockLayoutLine('โอนเงินสำเร็จ', 100, 100)],
      datetime: { date: null, time: null, confidenceTier: 'uncertain' }
    }
  });

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.ok(res.details.shadowDatetimeRoi);
  assert.strictEqual(res.details.shadowDatetimeRoi.paymentUseAllowed, false);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 10: Shadow trigger=false -> secondary OCR is NOT called
// ============================================================================
test('Phase 4K (10/18): Untriggered shadow makes zero secondary OCR calls (1 total)', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'true';
  let ocrCalls = 0;
  // Confident baseline datetime -> policy1 trigger should be false
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ 500 บาท',
      detectedAmount: 500,
      evidence: {
        layout: [mockLayoutLine('โอนเงินสำเร็จ', 100, 100)],
        datetime: { date: '2026-09-09', time: '14:30', confidenceTier: 'confident' }
      }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(ocrCalls, 1, 'Only 1 baseline OCR call should occur when untriggered');
  assert.equal(res.details.shadowDatetimeRoi.enabled, true);
  assert.equal(res.details.shadowDatetimeRoi.triggered, false);
  assert.equal(res.details.shadowDatetimeRoi.paymentUseAllowed, false);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 11: Shadow trigger=true -> exactly one secondary OCR call (max 2 total)
// ============================================================================
test('Phase 4K (11/18): Triggered shadow executes exactly 1 secondary OCR (2 total ops)', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'true';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ',
      detectedAmount: 500,
      evidence: {
        layout: [mockLayoutLine('โอนเงินสำเร็จ', 100, 100)],
        datetime: { date: null, time: null, confidenceTier: 'missing' }
      }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(ocrCalls, 2, 'Triggered slip must execute exactly 2 total OCR operations');
  assert.equal(res.details.shadowDatetimeRoi.triggered, true);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 12: Shadow crop error -> baseline succeeds, shadowError: true
// ============================================================================
test('Phase 4K (12/18): Shadow crop error does not crash baseline; sets shadowError: true', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'true';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ 500 บาท',
      detectedAmount: 500,
      evidence: {
        layout: [mockLayoutLine('โอนเงินสำเร็จ', 100, 100)],
        datetime: { date: null, time: null, confidenceTier: 'missing' }
      }
    };
  };

  // Jimp fails to read
  const failingJimp = createMockJimp(800, 1200, true);

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: failingJimp
  });

  assert.equal(ocrCalls, 1, 'Baseline OCR succeeded');
  assert.ok(res.details.ocr, 'Baseline verification succeeded');
  assert.equal(res.details.shadowDatetimeRoi.shadowError, true);
  assert.equal(res.details.shadowDatetimeRoi.paymentUseAllowed, false);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 13: Shadow OCR error -> baseline succeeds, shadowError: true
// ============================================================================
test('Phase 4K (13/18): Shadow OCR throw does not crash baseline; sets shadowError: true', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'true';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    if (ocrCalls === 1) {
      return {
        success: true,
        ocrText: 'โอนเงินสำเร็จ',
        detectedAmount: 500,
        evidence: {
          layout: [mockLayoutLine('โอนเงินสำเร็จ', 100, 100)],
          datetime: { date: null, time: null, confidenceTier: 'missing' }
        }
      };
    }
    throw new Error('Simulated secondary Tesseract crash');
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.ok(res.details.ocr, 'Baseline verification succeeded');
  assert.equal(res.details.shadowDatetimeRoi.shadowError, true);
  assert.equal(res.details.shadowDatetimeRoi.paymentUseAllowed, false);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 14: Shadow policy exception -> baseline succeeds, shadowError: true
// ============================================================================
test('Phase 4K (14/18): Shadow policy exception caught safely; sets shadowError: true', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'true';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    return {
      success: true,
      ocrText: 'โอนเงินสำเร็จ',
      detectedAmount: 500,
      evidence: {
        sender: { rawName: 'ทดสอบ' },
        receiver: { rawName: 'ผู้รับ' },
        datetime: { date: null, time: null },
        get layout() {
          throw new Error('Simulated shadow policy exception');
        }
      }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.ok(res.details.ocr);
  assert.equal(res.details.shadowDatetimeRoi.shadowError, true);
  assert.equal(res.details.shadowDatetimeRoi.paymentUseAllowed, false);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 15: Baseline decision parity between flag ON and flag OFF
// ============================================================================
test('Phase 4K (15/18): Baseline auto-approval / rejection / verification tier is identical flag ON vs OFF', async () => {
  const runVerification = async (flagValue) => {
    if (flagValue === undefined) delete process.env.BWORK_SLIP_ROI_SHADOW;
    else process.env.BWORK_SLIP_ROI_SHADOW = flagValue;

    const mockRunOCR = async () => ({
      success: true,
      ocrText: 'โอนเงินสำเร็จ 500 บาท',
      detectedAmount: 500,
      verificationTier: 'full_auto',
      hasAccountMatch: true,
      evidence: {
        layout: [mockLayoutLine('โอนเงินสำเร็จ', 100, 100)],
        datetime: { date: null, time: null }
      }
    });

    return verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
      decodeMiniQR: async () => mockValidQr,
      runSlipOCR: mockRunOCR,
      Jimp: createMockJimp()
    });
  };

  const resOff = await runVerification(undefined);
  const resOn = await runVerification('true');

  assert.equal(resOff.isValid, resOn.isValid);
  assert.equal(resOff.verificationTier, resOn.verificationTier);
  assert.equal(resOff.detectedAmount, resOn.detectedAmount);
  assert.equal(resOff.expectedAmount, resOn.expectedAmount);
  assert.deepEqual(resOff.reasons, resOn.reasons);
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 16: Shadow evidence comparison (dateSame and timeSame)
// ============================================================================
test('Phase 4K (16/18): Comparison metrics dateSame and timeSame are accurately populated', async () => {
  process.env.BWORK_SLIP_ROI_SHADOW = 'true';
  let ocrCalls = 0;
  const mockRunOCR = async () => {
    ocrCalls++;
    if (ocrCalls === 1) {
      return {
        success: true,
        ocrText: 'โอนเงินสำเร็จ 14:30 น.',
        detectedAmount: 500,
        evidence: {
          layout: [mockLayoutLine('โอนเงินสำเร็จ', 100, 100)],
          datetime: { date: null, time: '14:30', confidenceTier: 'partial' }
        }
      };
    }
    return {
      success: true,
      ocrText: '09 ก.ย. 2569 14:30 น.',
      evidence: { layout: [mockLayoutLine('09 ก.ย. 2569 14:30 น.', 10, 10)] }
    };
  };

  const res = await verifySlip(mockImageBuffer, { total_amount: 500 }, null, null, {
    decodeMiniQR: async () => mockValidQr,
    runSlipOCR: mockRunOCR,
    Jimp: createMockJimp()
  });

  assert.equal(res.details.shadowDatetimeRoi.comparison.dateSame, null, 'Baseline date was null so dateSame is null');
  assert.equal(res.details.shadowDatetimeRoi.comparison.timeSame, true, 'Baseline time 14:30 == ROI time 14:30');
  delete process.env.BWORK_SLIP_ROI_SHADOW;
});

// ============================================================================
// Test 17: Cloudflare Worker purity (zero OCR / Jimp / Tesseract / ROI references)
// ============================================================================
test('Phase 4K (17/18): Cloudflare Worker backend/worker.js contains zero OCR or ROI references', () => {
  const workerPath = path.join(__dirname, '..', 'worker.js');
  const workerContent = fs.readFileSync(workerPath, 'utf8');

  assert.doesNotMatch(workerContent, /tesseract/i, 'worker.js must not mention tesseract');
  assert.doesNotMatch(workerContent, /jimp/i, 'worker.js must not mention jimp');
  assert.doesNotMatch(workerContent, /slipRoi/i, 'worker.js must not mention slipRoi');
  assert.doesNotMatch(workerContent, /extractDatetimeRoi/i, 'worker.js must not mention extractDatetimeRoi');
  assert.doesNotMatch(workerContent, /runSlipOCR/i, 'worker.js must not mention runSlipOCR');
});

// ============================================================================
// Test 18: Full backward compatibility
// ============================================================================
test('Phase 4K (18/18): Backward compatibility - verifySlip works without dependencies parameter', async () => {
  delete process.env.BWORK_SLIP_ROI_SHADOW;
  // Passing invalid image buffer without dependencies should gracefully return invalid QR result
  const res = await verifySlip(Buffer.from('not-a-real-image'), { total_amount: 100 });
  assert.equal(res.isValid, false);
  assert.equal(res.details.shadowDatetimeRoi, undefined);
});
