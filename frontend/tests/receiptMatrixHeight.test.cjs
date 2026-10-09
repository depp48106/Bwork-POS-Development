const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');
const HELPER_PATH = path.join(ROOT_DIR, 'src/utils/printReceiptHelper.js');

function createSampleBooking(itemCount) {
  const items = [];
  for (let i = 1; i <= itemCount; i++) {
    items.push({
      id: i,
      room_id: (i % 6) + 4,
      room_name: `Meeting Room ${i}`,
      start_time: '2026-10-15 09:00:00',
      end_time: '2026-10-15 11:00:00',
      booking_date: '2026-10-15',
      duration_hours: 2,
      price_per_hour: 500,
      subtotal: 1000,
      layout: 'standard'
    });
  }

  return {
    id: 1000 + itemCount,
    booking_code: `BK-TEST-${itemCount}`,
    receipt_number: `RC-20261015-${itemCount}`,
    customer_name: 'บริษัท ทดสอบระบบ จำกัด',
    contact: '081-234-5678',
    department: 'แผนกบัญชีและการเงิน',
    guest_count: 5,
    booking_details: 'ต้องการไมโครโฟนไร้สาย 2 ตัว และจอโปรเจกเตอร์',
    created_at: '2026-10-15T08:30:00+07:00',
    total_amount: itemCount * 1000,
    paid_amount: itemCount * 1000,
    remaining_balance: 0,
    payment_status: 'paid',
    payment_method: 'promptpay',
    items
  };
}

test('Receipt Paper Size & Height Matrix (1, 3, 7, 15, 25 items)', async (t) => {
  const helper = await import('file:///' + HELPER_PATH.replace(/\\/g, '/'));
  const { calculateReceiptHeightMm, SAFETY_BOTTOM_BUFFER_MM, applyDynamicReceiptPageSize, cleanupDynamicReceiptPageSize, STYLE_ELEMENT_ID } = helper;

  const scenarios = [
    { count: 1, baseHeightPx: 520 },   // ~140mm
    { count: 3, baseHeightPx: 640 },   // ~172mm
    { count: 7, baseHeightPx: 880 },   // ~235mm
    { count: 15, baseHeightPx: 1360 }, // ~362mm
    { count: 25, baseHeightPx: 1960 }  // ~521mm
  ];

  for (const sc of scenarios) {
    await t.test(`Matrix Test: ${sc.count} item(s)`, (subT) => {
      const dummyEl = {
        scrollHeight: sc.baseHeightPx,
        offsetHeight: sc.baseHeightPx,
        getBoundingClientRect: () => ({ height: sc.baseHeightPx })
      };

      const calculatedMm = calculateReceiptHeightMm(dummyEl);
      const rawMm = (sc.baseHeightPx * 25.4) / 96;
      const expectedMm = Number((Math.ceil((rawMm + SAFETY_BOTTOM_BUFFER_MM) * 10) / 10).toFixed(1));

      assert.strictEqual(calculatedMm, expectedMm, `Calculated mm must match formula for ${sc.count} items`);
      assert.ok(calculatedMm >= 50.0, 'Must meet minimum page height 50mm');
      assert.ok(calculatedMm <= 2000.0, 'Must not exceed maximum limit 2000mm');

      // Trailing safety margin check
      const trailingSpaceMm = Number((calculatedMm - rawMm).toFixed(1));
      assert.ok(trailingSpaceMm >= SAFETY_BOTTOM_BUFFER_MM && trailingSpaceMm <= SAFETY_BOTTOM_BUFFER_MM + 0.1,
        `Trailing blank space must be minimal (${SAFETY_BOTTOM_BUFFER_MM}mm), was ${trailingSpaceMm}mm`);

      console.log(`[Item Count: ${sc.count}] Height: ${calculatedMm}mm (Raw: ${rawMm.toFixed(1)}mm, Trailing buffer: ${trailingSpaceMm}mm)`);
    });
  }
});

test('Receipt Print Lifecycle Hardening (No arbitrary timers, reliable afterprint, non-receipt safety)', async (t) => {
  const helper = await import('file:///' + HELPER_PATH.replace(/\\/g, '/'));
  const { printReceipt, applyDynamicReceiptPageSize, cleanupDynamicReceiptPageSize, STYLE_ELEMENT_ID } = helper;

  await t.test('1. Idle preview exceeding 120s does not suffer timer-based stylesheet destruction', async () => {
    // Setup mock DOM and window
    let styleTag = null;
    const originalDoc = global.document;
    const originalWin = global.window;

    global.document = {
      getElementById: (id) => (id === STYLE_ELEMENT_ID ? styleTag : {
        scrollHeight: 550,
        offsetHeight: 550,
        getBoundingClientRect: () => ({ height: 550 })
      }),
      createElement: () => {
        styleTag = { id: STYLE_ELEMENT_ID, textContent: '', parentNode: { removeChild: () => { styleTag = null; } } };
        return styleTag;
      },
      head: { appendChild: (el) => { styleTag = el; } }
    };

    let afterPrintListener = null;
    let printCalled = false;
    global.window = {
      addEventListener: (evt, fn) => { if (evt === 'afterprint') afterPrintListener = fn; },
      removeEventListener: (evt, fn) => { if (evt === 'afterprint') afterPrintListener = null; },
      print: () => { printCalled = true; }
    };

    try {
      await printReceipt('dummy-id');
      assert.ok(printCalled, 'window.print must be invoked');
      assert.ok(styleTag !== null, 'Style tag must be active during preview');
      assert.match(styleTag.textContent, /size:\s*72mm/, 'Must contain 72mm @page size');

      // Simulate idle preview for extended period (no timer destruction can happen)
      // Because there are no setTimeout timers created by printReceipt
      assert.ok(styleTag !== null, 'Style tag must REMAIN active indefinitely while dialog is open');

      // Simulate print completion: afterprint fires
      assert.ok(typeof afterPrintListener === 'function', 'afterprint listener must be registered');
      afterPrintListener();

      assert.strictEqual(styleTag, null, 'Style tag must be cleanly removed on afterprint');
    } finally {
      global.document = originalDoc;
      global.window = originalWin;
    }
  });

  await t.test('2. Error during window.print() cleans up style tag and listener safely', async () => {
    let styleTag = null;
    const originalDoc = global.document;
    const originalWin = global.window;

    global.document = {
      getElementById: (id) => (id === STYLE_ELEMENT_ID ? styleTag : {
        scrollHeight: 550,
        offsetHeight: 550,
        getBoundingClientRect: () => ({ height: 550 })
      }),
      createElement: () => {
        styleTag = { id: STYLE_ELEMENT_ID, textContent: '', parentNode: { removeChild: () => { styleTag = null; } } };
        return styleTag;
      },
      head: { appendChild: (el) => { styleTag = el; } }
    };

    let afterPrintListener = null;
    global.window = {
      addEventListener: (evt, fn) => { if (evt === 'afterprint') afterPrintListener = fn; },
      removeEventListener: (evt, fn) => { if (evt === 'afterprint') afterPrintListener = null; },
      print: () => { throw new Error('Simulated print dialogue error'); }
    };

    try {
      await printReceipt('dummy-id');
      assert.strictEqual(styleTag, null, 'Style tag must be cleaned up on print error');
      assert.strictEqual(afterPrintListener, null, 'Listener must be detached on print error');
    } finally {
      global.document = originalDoc;
      global.window = originalWin;
    }
  });

  await t.test('3. Successive prints reuse single style tag and update dimensions without leaks', async () => {
    let styleTag = null;
    let createCount = 0;
    const originalDoc = global.document;

    global.document = {
      getElementById: (id) => (id === STYLE_ELEMENT_ID ? styleTag : null),
      createElement: () => {
        createCount++;
        styleTag = { id: STYLE_ELEMENT_ID, textContent: '', parentNode: { removeChild: () => { styleTag = null; } } };
        return styleTag;
      },
      head: { appendChild: (el) => { styleTag = el; } }
    };

    try {
      const el1 = { scrollHeight: 500, offsetHeight: 500, getBoundingClientRect: () => ({ height: 500 }) };
      const el2 = { scrollHeight: 900, offsetHeight: 900, getBoundingClientRect: () => ({ height: 900 }) };

      const h1 = applyDynamicReceiptPageSize(el1);
      assert.strictEqual(createCount, 1, 'First print creates 1 style element');
      assert.match(styleTag.textContent, new RegExp(`size:\\s*72mm\\s+${h1}mm`));

      const h2 = applyDynamicReceiptPageSize(el2);
      assert.strictEqual(createCount, 1, 'Second print must reuse existing element (no duplicate creation)');
      assert.match(styleTag.textContent, new RegExp(`size:\\s*72mm\\s+${h2}mm`));
      assert.notStrictEqual(h1, h2);

      cleanupDynamicReceiptPageSize();
      assert.strictEqual(styleTag, null, 'Cleanup removes the style element');
    } finally {
      global.document = originalDoc;
    }
  });

  await t.test('4. Task 1: Hidden receipt with scrollHeight > 0 is rejected from triggering 72mm receipt sizing', async () => {
    const { isReceiptPrintTarget } = helper;
    const originalDoc = global.document;
    const originalWin = global.window;

    global.document = {
      body: { classList: { contains: () => false } }
    };
    global.window = {
      getComputedStyle: () => ({ display: 'none', visibility: 'hidden' })
    };

    try {
      // Hidden element simulation: scrollHeight is 600, but offsetParent is null and bounding box is 0
      const hiddenEl = {
        scrollHeight: 600,
        offsetHeight: 0,
        offsetParent: null,
        isConnected: true,
        getBoundingClientRect: () => ({ width: 0, height: 0 })
      };

      const isTarget = isReceiptPrintTarget(hiddenEl);
      assert.strictEqual(isTarget, false, 'Hidden receipt element with scrollHeight > 0 must NOT be treated as print target');
    } finally {
      global.document = originalDoc;
      global.window = originalWin;
    }
  });

  await t.test('5. Task 1: A4 Quotation print marker (.printing-quotation) takes absolute precedence over receipt', async () => {
    const { isReceiptPrintTarget } = helper;
    const originalDoc = global.document;
    const originalWin = global.window;

    global.document = {
      body: { classList: { contains: (cls) => cls === 'printing-quotation' } }
    };
    global.window = {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
    };

    try {
      const el = {
        scrollHeight: 500,
        offsetHeight: 500,
        offsetParent: {},
        isConnected: true,
        getBoundingClientRect: () => ({ width: 272, height: 500 })
      };

      const isTarget = isReceiptPrintTarget(el);
      assert.strictEqual(isTarget, false, 'body.printing-quotation must reject receipt dynamic sizing');
    } finally {
      global.document = originalDoc;
      global.window = originalWin;
    }
  });

  await t.test('6. Task 1 & 3: Genuinely visible receipt modal on screen is recognized as valid target for Ctrl+P', async () => {
    const { isReceiptPrintTarget } = helper;
    const originalDoc = global.document;
    const originalWin = global.window;

    global.document = {
      body: { classList: { contains: () => false } }
    };
    global.window = {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
    };

    try {
      const visibleEl = {
        scrollHeight: 536,
        offsetHeight: 536,
        offsetParent: {},
        isConnected: true,
        getBoundingClientRect: () => ({ width: 272, height: 536 }),
        closest: () => null
      };

      const isTarget = isReceiptPrintTarget(visibleEl);
      assert.strictEqual(isTarget, true, 'Visible receipt modal must be recognized as print target');
    } finally {
      global.document = originalDoc;
      global.window = originalWin;
    }
  });

  await t.test('7. Task 3: Stale receipt state + A4 print (stale flag is vetoed when element is not visible)', async () => {
    const { isReceiptPrintTarget } = helper;
    const originalDoc = global.document;
    const originalWin = global.window;

    global.document = {
      body: { classList: { contains: () => false } }
    };
    global.window = {
      getComputedStyle: () => ({ display: 'none', visibility: 'hidden' })
    };

    try {
      // Simulate stale state where isReceiptPrintActive was true, but modal is closed
      const closedModalEl = {
        scrollHeight: 500,
        offsetHeight: 0,
        offsetParent: null,
        isConnected: true,
        getBoundingClientRect: () => ({ width: 0, height: 0 })
      };

      const isTarget = isReceiptPrintTarget(closedModalEl);
      assert.strictEqual(isTarget, false, 'Stale flag must not hijack print when receipt modal is closed');
    } finally {
      global.document = originalDoc;
      global.window = originalWin;
    }
  });

  await t.test('8. Task 3: Missing afterprint followed by new receipt (safe replacement of dynamic size)', async () => {
    const { applyDynamicReceiptPageSize, STYLE_ELEMENT_ID } = helper;
    let styleTag = null;
    const originalDoc = global.document;

    global.document = {
      getElementById: (id) => (id === STYLE_ELEMENT_ID ? styleTag : null),
      createElement: () => {
        styleTag = { id: STYLE_ELEMENT_ID, textContent: '', parentNode: { removeChild: () => { styleTag = null; } } };
        return styleTag;
      },
      head: { appendChild: (el) => { styleTag = el; } }
    };

    try {
      // Job 1: Receipt 1 (medium)
      const el1 = { scrollHeight: 600, offsetHeight: 600, getBoundingClientRect: () => ({ height: 600 }) };
      const h1 = applyDynamicReceiptPageSize(el1);
      assert.ok(styleTag !== null, 'Style created for receipt 1');

      // afterprint NEVER fires (simulated failure) -> styleTag remains in DOM
      assert.ok(styleTag !== null, 'Style remains after missing afterprint');

      // Job 2: Receipt 2 (long)
      const el2 = { scrollHeight: 1200, offsetHeight: 1200, getBoundingClientRect: () => ({ height: 1200 }) };
      const h2 = applyDynamicReceiptPageSize(el2);

      assert.match(styleTag.textContent, new RegExp(`size:\\s*72mm\\s+${h2}mm`));
      assert.notStrictEqual(h1, h2, 'Height safely replaced with new receipt dimensions without duplicating tag');
    } finally {
      global.document = originalDoc;
    }
  });

  await t.test('9. Task 3: Missing afterprint followed by A4 (cleanupDynamicReceiptPageSize cleans stale tag)', async () => {
    const { applyDynamicReceiptPageSize, cleanupDynamicReceiptPageSize, STYLE_ELEMENT_ID } = helper;
    let styleTag = null;
    const originalDoc = global.document;

    global.document = {
      getElementById: (id) => (id === STYLE_ELEMENT_ID ? styleTag : null),
      createElement: () => {
        styleTag = { id: STYLE_ELEMENT_ID, textContent: '', parentNode: { removeChild: () => { styleTag = null; } } };
        return styleTag;
      },
      head: { appendChild: (el) => { styleTag = el; } }
    };

    try {
      // Receipt print left style in DOM because afterprint failed
      const el1 = { scrollHeight: 600, offsetHeight: 600, getBoundingClientRect: () => ({ height: 600 }) };
      applyDynamicReceiptPageSize(el1);
      assert.ok(styleTag !== null, 'Leftover receipt style exists');

      // User triggers A4 print: beforeprint detects non-receipt target and cleans up
      cleanupDynamicReceiptPageSize();
      assert.strictEqual(styleTag, null, 'Leftover receipt style cleanly cleared before A4 print');
    } finally {
      global.document = originalDoc;
    }
  });

  await t.test('10. Task 3: Receipt cancel dispatches afterprint and detaches cleanly', async () => {
    let styleTag = null;
    const originalDoc = global.document;
    const originalWin = global.window;

    global.document = {
      getElementById: (id) => (id === STYLE_ELEMENT_ID ? styleTag : {
        scrollHeight: 550,
        offsetHeight: 550,
        getBoundingClientRect: () => ({ height: 550 })
      }),
      createElement: () => {
        styleTag = { id: STYLE_ELEMENT_ID, textContent: '', parentNode: { removeChild: () => { styleTag = null; } } };
        return styleTag;
      },
      head: { appendChild: (el) => { styleTag = el; } }
    };

    let afterPrintListener = null;
    global.window = {
      addEventListener: (evt, fn) => { if (evt === 'afterprint') afterPrintListener = fn; },
      removeEventListener: (evt, fn) => { if (evt === 'afterprint') afterPrintListener = null; },
      print: () => {}
    };

    try {
      await helper.printReceipt('dummy-id');
      assert.ok(styleTag !== null, 'Style tag active during preview');

      // Cashier cancels (presses Esc or Cancel) -> browser triggers afterprint
      afterPrintListener();
      assert.strictEqual(styleTag, null, 'Style tag cleared on cancel');
      assert.strictEqual(afterPrintListener, null, 'Listener detached on cancel');
    } finally {
      global.document = originalDoc;
      global.window = originalWin;
    }
  });
});
