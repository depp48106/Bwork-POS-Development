const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const HELPER_PATH = path.join(ROOT_DIR, 'src/utils/printReceiptHelper.js');
const INDEX_CSS_PATH = path.join(ROOT_DIR, 'src/index.css');
const BOOKING_POS_PATH = path.join(ROOT_DIR, 'src/components/BookingPOS.jsx');
const HISTORY_PATH = path.join(ROOT_DIR, 'src/components/History.jsx');
const PENDING_BOOKINGS_PATH = path.join(ROOT_DIR, 'src/components/PendingBookings.jsx');

test('1. calculateReceiptHeightMm accurately converts px to mm with deterministic safety buffer', async () => {
  const helper = await import('file:///' + HELPER_PATH.replace(/\\/g, '/'));
  const { calculateReceiptHeightMm, SAFETY_BOTTOM_BUFFER_MM } = helper;

  // 1 inch = 96 px = 25.4 mm => factor = 25.4 / 96 = ~0.2645833
  const dummyEl = {
    scrollHeight: 500,
    offsetHeight: 500,
    getBoundingClientRect: () => ({ height: 500 })
  };

  const expectedRawMm = (500 * 25.4) / 96; // 132.29166...
  const expectedTotalMm = expectedRawMm + SAFETY_BOTTOM_BUFFER_MM; // 135.29166...
  const expectedRoundedMm = Number((Math.ceil(expectedTotalMm * 10) / 10).toFixed(1));

  const calculated = calculateReceiptHeightMm(dummyEl);
  assert.strictEqual(calculated, expectedRoundedMm);
});

test('2. Dynamic receipt height scales across short, medium, and long receipt heights without fixed 200mm cutoff', async () => {
  const helper = await import('file:///' + HELPER_PATH.replace(/\\/g, '/'));
  const { calculateReceiptHeightMm } = helper;

  // Short: ~450px (~122mm)
  const shortEl = { scrollHeight: 450, offsetHeight: 450, getBoundingClientRect: () => ({ height: 450 }) };
  const shortHeight = calculateReceiptHeightMm(shortEl);
  assert.ok(shortHeight >= 115 && shortHeight <= 130, `Short height ${shortHeight} should be ~122mm`);

  // Medium: ~650px (~175mm)
  const medEl = { scrollHeight: 650, offsetHeight: 650, getBoundingClientRect: () => ({ height: 650 }) };
  const medHeight = calculateReceiptHeightMm(medEl);
  assert.ok(medHeight >= 165 && medHeight <= 185, `Medium height ${medHeight} should be ~175mm`);

  // Long: ~1100px (~294mm) -> exceeds 200mm without clipping
  const longEl = { scrollHeight: 1100, offsetHeight: 1100, getBoundingClientRect: () => ({ height: 1100 }) };
  const longHeight = calculateReceiptHeightMm(longEl);
  assert.ok(longHeight >= 285 && longHeight <= 305, `Long height ${longHeight} should be ~294mm`);

  // Assert distinct dynamic progression: short < medium < long
  assert.ok(shortHeight < medHeight && medHeight < longHeight);
  assert.ok(longHeight > 200, 'Long receipt must naturally exceed 200mm without arbitrary clamping');
});

test('3. Extreme-length safety thresholds clamp absurd dimensions while preserving normal receipts', async () => {
  const helper = await import('file:///' + HELPER_PATH.replace(/\\/g, '/'));
  const { calculateReceiptHeightMm, MIN_SAFE_PAGE_HEIGHT_MM, MAX_SAFE_PAGE_HEIGHT_MM } = helper;

  // Absurdly tiny: 10px (~2.6mm) -> clamped to minimum 50mm
  const tinyEl = { scrollHeight: 10, offsetHeight: 10, getBoundingClientRect: () => ({ height: 10 }) };
  assert.strictEqual(calculateReceiptHeightMm(tinyEl), MIN_SAFE_PAGE_HEIGHT_MM);

  // Absurdly huge: 20000px (~5291mm) -> clamped to practical maximum 2000mm (2 meters)
  const giantEl = { scrollHeight: 20000, offsetHeight: 20000, getBoundingClientRect: () => ({ height: 20000 }) };
  assert.strictEqual(calculateReceiptHeightMm(giantEl), MAX_SAFE_PAGE_HEIGHT_MM);
});

test('4. Dynamic @page injection creates exactly one dedicated style element and does not accumulate', async () => {
  const helper = await import('file:///' + HELPER_PATH.replace(/\\/g, '/'));
  const { applyDynamicReceiptPageSize, cleanupDynamicReceiptPageSize, STYLE_ELEMENT_ID } = helper;

  // Mock DOM environment
  const mockStyle = { id: '', textContent: '', parentNode: null };
  const createdElements = [];
  const headChildren = [];

  const originalDocument = global.document;
  global.document = {
    getElementById: (id) => headChildren.find(el => el.id === id) || null,
    createElement: (tag) => {
      const el = { id: '', textContent: '', parentNode: null };
      createdElements.push(el);
      return el;
    },
    head: {
      appendChild: (el) => {
        el.parentNode = global.document.head;
        headChildren.push(el);
      }
    }
  };

  const dummyEl = { scrollHeight: 600, offsetHeight: 600, getBoundingClientRect: () => ({ height: 600 }) };

  // Call 1: Receipt A (short/medium)
  const h1 = applyDynamicReceiptPageSize(dummyEl);
  assert.strictEqual(headChildren.length, 1, 'Must create exactly 1 style element on first print');
  assert.strictEqual(headChildren[0].id, STYLE_ELEMENT_ID);
  assert.match(headChildren[0].textContent, /size:\s*72mm\s+[\d.]+mm\s*!important/);

  // Call 2: Receipt B (different height) without cleanup
  dummyEl.scrollHeight = 1000;
  dummyEl.offsetHeight = 1000;
  const h2 = applyDynamicReceiptPageSize(dummyEl);
  assert.strictEqual(headChildren.length, 1, 'Must reuse existing style element rather than creating new ones');
  assert.notStrictEqual(h1, h2, 'Height must dynamically update to new measurement');

  // Call 3: Cleanup
  global.document.head.removeChild = (el) => {
    const idx = headChildren.indexOf(el);
    if (idx !== -1) headChildren.splice(idx, 1);
  };
  cleanupDynamicReceiptPageSize();
  assert.strictEqual(headChildren.length, 0, 'Cleanup must remove style element completely');

  global.document = originalDocument;
});

test('5. Image readiness helper deterministically checks complete and naturalWidth', async () => {
  const helper = await import('file:///' + HELPER_PATH.replace(/\\/g, '/'));
  const { ensureReceiptImagesLoaded } = helper;

  // Mock element with 2 images
  const loadedImg = { complete: true, naturalWidth: 550, addEventListener: () => {}, removeEventListener: () => {} };
  let loadHandler = null;
  const pendingImg = {
    complete: false,
    naturalWidth: 0,
    addEventListener: (ev, h) => { if (ev === 'load') loadHandler = h; },
    removeEventListener: () => {}
  };

  const dummyReceipt = {
    querySelectorAll: (sel) => sel === 'img' ? [loadedImg, pendingImg] : []
  };

  let resolved = false;
  const promise = ensureReceiptImagesLoaded(dummyReceipt).then(() => { resolved = true; });

  // Before image loads
  assert.strictEqual(resolved, false);

  // Trigger load event
  if (loadHandler) loadHandler();
  await promise;
  assert.strictEqual(resolved, true);
});

test('6. index.css print rules enforce top-to-bottom document flow without vertical centering', () => {
  const css = fs.readFileSync(INDEX_CSS_PATH, 'utf-8');

  // html and body reset
  assert.match(
    css,
    /html,\s*body:not\(\.printing-quotation\)\s*\{[^}]*margin:\s*0\s*!important;[^}]*padding:\s*0\s*!important;/s,
    'html and body must have margin 0 and padding 0 in print'
  );
  assert.match(
    css,
    /html,\s*body:not\(\.printing-quotation\)\s*\{[^}]*height:\s*auto\s*!important;/s,
    'html and body must have height auto in print'
  );
  assert.match(
    css,
    /html,\s*body:not\(\.printing-quotation\)\s*\{[^}]*min-height:\s*0\s*!important;/s,
    'html and body must have min-height 0 in print'
  );

  // Modal and layout parents reset
  assert.match(
    css,
    /\.print-modal-overlay[^}]*display:\s*block\s*!important;[^}]*position:\s*static\s*!important;/s,
    '.print-modal-overlay must collapse to static block flow'
  );

  assert.match(
    css,
    /\.history-modal-container[^}]*display:\s*block\s*!important;[^}]*position:\s*static\s*!important;/s,
    '.history-modal-container must collapse to static block flow'
  );

  assert.match(
    css,
    /\.history-receipt-column[^}]*display:\s*block\s*!important;/s,
    '.history-receipt-column must display as static block in print'
  );

  // Parent chain must normalize alignments
  assert.match(
    css,
    /align-items:\s*normal\s*!important;[^}]*justify-content:\s*normal\s*!important;/s,
    'Parent wrappers must clear flex centering alignments'
  );

  // Receipt area 72mm and page-break-inside avoid
  assert.match(
    css,
    /#print-receipt-area\s*\{[^}]*width:\s*72mm\s*!important;[^}]*page-break-inside:\s*avoid\s*!important;/s,
    '#print-receipt-area must be 72mm and avoid page breaks'
  );
});

test('7. All print entry points (BookingPOS, History, PendingBookings) use printReceipt helper', () => {
  const posContent = fs.readFileSync(BOOKING_POS_PATH, 'utf-8');
  assert.match(posContent, /import\s*\{\s*printReceipt\s*\}\s*from\s*['"]\.\.\/utils\/printReceiptHelper['"]/, 'BookingPOS must import printReceipt');
  assert.match(posContent, /printReceipt\(['"]print-receipt-area['"]\)/, 'BookingPOS must invoke printReceipt');

  const historyContent = fs.readFileSync(HISTORY_PATH, 'utf-8');
  assert.match(historyContent, /import\s*\{\s*printReceipt\s*\}\s*from\s*['"]\.\.\/utils\/printReceiptHelper['"]/, 'History must import printReceipt');
  assert.match(historyContent, /printReceipt\(['"]print-receipt-area['"]\)/, 'History must invoke printReceipt');

  const pendingContent = fs.readFileSync(PENDING_BOOKINGS_PATH, 'utf-8');
  assert.match(pendingContent, /import\s*\{\s*printReceipt\s*\}\s*from\s*['"]\.\.\/utils\/printReceiptHelper['"]/, 'PendingBookings must import printReceipt');
  assert.match(pendingContent, /printReceipt\(['"]print-receipt-area['"]\)/, 'PendingBookings must invoke printReceipt');
});
