const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hourCreditsCss = fs.readFileSync(path.join(__dirname, '../src/components/HourCredits.css'), 'utf-8');
const dashboardCss = fs.readFileSync(path.join(__dirname, '../src/components/Dashboard.css'), 'utf-8');
const indexCss = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf-8');
const bookingPosJsx = fs.readFileSync(path.join(__dirname, '../src/components/BookingPOS.jsx'), 'utf-8');

test('1. HourCredits.css scopes status badges to prevent global .status-available leakage', () => {
  // Ensure unscoped .status-available { is absent
  const hasUnscoped = /(?:^|\n)\.status-available\s*\{/m.test(hourCreditsCss);
  assert.equal(hasUnscoped, false, 'HourCredits.css must not define unscoped .status-available');

  // Ensure scoped version exists
  assert.match(hourCreditsCss, /\.credit-status-badge\.status-available\s*\{/);
  assert.match(hourCreditsCss, /\.credit-status-badge\.status-partially_used\s*\{/);
  assert.match(hourCreditsCss, /\.credit-status-badge\.status-exhausted\s*\{/);
});

test('2. Dashboard.css defines explicit available room styling for light and dark modes', () => {
  // Light mode definition
  assert.match(dashboardCss, /\.op-room-row\.status-available\s*\{[^}]*background:\s*transparent;/);

  // Dark mode surface definition
  assert.match(dashboardCss, /\[data-theme="dark"\]\s+\.op-room-row\.status-available\s*\{[^}]*background:/);

  // Dark mode hover definition
  assert.match(dashboardCss, /\[data-theme="dark"\]\s+\.op-room-row\.status-available:hover\s*\{[^}]*background:/);
});

test('3. Dashboard.css configures restrained green semantic indicator for available rooms', () => {
  // Dot styling
  assert.match(dashboardCss, /\.op-room-dot\.dot-available\s*\{[^}]*background-color:\s*#10b981;/);

  // High contrast context text in dark mode
  assert.match(dashboardCss, /\[data-theme="dark"\]\s+\.op-room-row\.status-available\s+\.op-room-status-context\s*\{[^}]*color:\s*#34d399;/);
});

test('4. index.css print rules isolate #print-receipt-area with visibility:hidden on body', () => {
  // Body visibility hidden
  assert.match(indexCss, /body:not\(\.printing-quotation\)\s*\*\s*\{[^}]*visibility:\s*hidden\s*!important;/);

  // Receipt visibility visible
  assert.match(indexCss, /body:not\(\.printing-quotation\)\s*#print-receipt-area,\s*body:not\(\.printing-quotation\)\s*#print-receipt-area\s*\*\s*\{[^}]*visibility:\s*visible\s*!important;/);
});

test('5. index.css print rules remove Booking Management tables, headers, and tabs from layout', () => {
  assert.match(indexCss, /\.pb-console-header/);
  assert.match(indexCss, /\.pb-status-tabs-strip/);
  assert.match(indexCss, /\.pb-filters-panel/);
  assert.match(indexCss, /\.pb-table-wrap/);
  assert.match(indexCss, /\.pb-pagination/);
});

test('6. index.css collapses modal containers into static unpadded flow in print mode', () => {
  assert.match(indexCss, /\.print-modal-overlay\s*\{[^}]*position:\s*static\s*!important;[^}]*background:\s*transparent\s*!important;/);
  assert.match(indexCss, /\.history-modal-container\s*\{[^}]*display:\s*block\s*!important;/);
  assert.match(indexCss, /\.history-receipt-column\s*\{[^}]*display:\s*block\s*!important;/);
});

const receiptPrintJsx = fs.readFileSync(path.join(__dirname, '../src/components/ReceiptPrint.jsx'), 'utf-8');

test('7. BookingPOS.jsx receipt modal includes print-modal-overlay class for consistent print isolation', () => {
  assert.match(bookingPosJsx, /className="print-modal-overlay"/);
});

test('8. index.css locks receipt width to 72mm and enforces continuous height', () => {
  // #print-receipt-area width and continuous height
  assert.match(indexCss, /#print-receipt-area\s*\{[^}]*width:\s*72mm\s*!important;/);
  assert.match(indexCss, /#print-receipt-area\s*\{[^}]*max-width:\s*72mm\s*!important;/);
  assert.match(indexCss, /#print-receipt-area\s*\{[^}]*height:\s*auto\s*!important;/);
  assert.match(indexCss, /#print-receipt-area\s*\{[^}]*min-height:\s*0\s*!important;/);
  assert.match(indexCss, /#print-receipt-area\s*\{[^}]*max-height:\s*none\s*!important;/);

  // .receipt-wrapper width and continuous height
  assert.match(indexCss, /\.receipt-wrapper\s*\{[^}]*width:\s*72mm\s*!important;/);
  assert.match(indexCss, /\.receipt-wrapper\s*\{[^}]*max-width:\s*72mm\s*!important;/);
  assert.match(indexCss, /\.receipt-wrapper\s*\{[^}]*height:\s*auto\s*!important;/);
});

test('9. @page defines margin: 0 without forcing fixed height', () => {
  assert.match(indexCss, /@page\s*\{[^}]*margin:\s*0;/);
  const hasFixed200mm = /@page\s*\{[^}]*200mm/i.test(indexCss);
  assert.equal(hasFixed200mm, false, '@page must not specify 200mm height');
});

test('10. ReceiptPrint.jsx has 72mm width, continuous height, no fixed 200mm, and no auto-scale', () => {
  assert.match(receiptPrintJsx, /width:\s*'72mm'/);
  assert.match(receiptPrintJsx, /maxWidth:\s*'72mm'/);
  assert.match(receiptPrintJsx, /height:\s*'auto'/);
  assert.match(receiptPrintJsx, /minHeight:\s*0/);
  assert.match(receiptPrintJsx, /maxHeight:\s*'none'/);

  // No 200mm fixed height anywhere in ReceiptPrint.jsx
  assert.equal(/200mm/i.test(receiptPrintJsx), false, 'ReceiptPrint must not contain 200mm');

  // No transform scale anywhere in ReceiptPrint.jsx
  assert.equal(/transform:\s*['"`]?scale/i.test(receiptPrintJsx), false, 'ReceiptPrint must not scale content');
});
