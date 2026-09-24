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

test('7. BookingPOS.jsx receipt modal includes print-modal-overlay class for consistent print isolation', () => {
  assert.match(bookingPosJsx, /className="print-modal-overlay"/);
});
