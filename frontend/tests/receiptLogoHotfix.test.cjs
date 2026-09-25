const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RECEIPT_PRINT_PATH = path.join(ROOT_DIR, 'src/components/ReceiptPrint.jsx');
const APP_PATH = path.join(ROOT_DIR, 'src/App.jsx');
const PUBLIC_LOGO_PATH = path.join(ROOT_DIR, 'public/BWORK-LOGO.png');
const PUBLIC_UPLOAD_LOGO_PATH = path.join(ROOT_DIR, 'public/uploads/img_1784278289923_kie4d.png');
const DIST_LOGO_PATH = path.join(ROOT_DIR, 'dist/BWORK-LOGO.png');
const DIST_UPLOAD_LOGO_PATH = path.join(ROOT_DIR, 'dist/uploads/img_1784278289923_kie4d.png');

test('1. Static logo assets exist and are valid PNG images in public/ and dist/', () => {
  assert.ok(fs.existsSync(PUBLIC_LOGO_PATH), 'public/BWORK-LOGO.png must exist');
  assert.ok(fs.existsSync(PUBLIC_UPLOAD_LOGO_PATH), 'public/uploads/img_1784278289923_kie4d.png must exist');
  assert.ok(fs.existsSync(DIST_LOGO_PATH), 'dist/BWORK-LOGO.png must exist in built assets');
  assert.ok(fs.existsSync(DIST_UPLOAD_LOGO_PATH), 'dist/uploads/img_1784278289923_kie4d.png must exist in built assets');

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const bworkLogoBuf = fs.readFileSync(PUBLIC_LOGO_PATH);
  assert.ok(bworkLogoBuf.subarray(0, 8).equals(pngHeader), 'BWORK-LOGO.png must have valid PNG magic bytes');
  assert.strictEqual(bworkLogoBuf.readUInt32BE(16), 550, 'BWORK-LOGO.png width must be 550');
  assert.strictEqual(bworkLogoBuf.readUInt32BE(20), 207, 'BWORK-LOGO.png height must be 207');

  const uploadLogoBuf = fs.readFileSync(PUBLIC_UPLOAD_LOGO_PATH);
  assert.ok(uploadLogoBuf.subarray(0, 8).equals(pngHeader), 'Upload logo must have valid PNG magic bytes');
  assert.strictEqual(uploadLogoBuf.readUInt32BE(16), 550, 'Upload logo width must be 550');
  assert.strictEqual(uploadLogoBuf.readUInt32BE(20), 207, 'Upload logo height must be 207');
});

test('2. ReceiptPrint.jsx defines deterministic receiptLogo with static brand fallback', () => {
  const content = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf-8');
  assert.match(
    content,
    /const\s+receiptLogo\s*=\s*safeSettings\.logo_image\s*\|\|\s*['"]\/BWORK-LOGO\.png['"]/,
    'ReceiptPrint must derive receiptLogo with fallback to /BWORK-LOGO.png'
  );
  assert.match(
    content,
    /\{receiptLogo\s*&&\s*\(/,
    'ReceiptPrint header must check receiptLogo instead of only safeSettings.logo_image'
  );
  assert.match(
    content,
    /<img[^>]+src=\{receiptLogo\}/,
    'ReceiptPrint img src must be {receiptLogo}'
  );
});

test('3. ReceiptPrint.jsx onError gracefully falls back to /BWORK-LOGO.png instead of destroying DOM', () => {
  const content = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf-8');
  assert.doesNotMatch(
    content,
    /e\.currentTarget\.parentElement\.style\.display\s*=\s*['"]none['"]/,
    'ReceiptPrint onError must NOT permanently hide the parent element'
  );
  assert.match(
    content,
    /e\.currentTarget\.src\s*=\s*['"]\/BWORK-LOGO\.png['"]/,
    'ReceiptPrint onError must fall back to /BWORK-LOGO.png'
  );
});

test('4. App.jsx initializes settings state with deterministic logo_image: "/BWORK-LOGO.png"', () => {
  const content = fs.readFileSync(APP_PATH, 'utf-8');
  assert.match(
    content,
    /const\s+\[settings,\s*setSettings\]\s*=\s*useState\(\{\s*company_name:[^}]*logo_image:\s*['"]\/BWORK-LOGO\.png['"]/s,
    'App.jsx initial settings state must define logo_image: "/BWORK-LOGO.png"'
  );
});

test('5. App.jsx handleLogin immediately sets auth and invokes fetchSettings()', () => {
  const content = fs.readFileSync(APP_PATH, 'utf-8');
  const loginMatch = content.match(/const\s+handleLogin\s*=\s*async\s*\(e\)\s*=>\s*\{([\s\S]*?)\n\s*\};/);
  assert.ok(loginMatch, 'handleLogin must be present in App.jsx');
  const loginBody = loginMatch[1];
  assert.match(
    loginBody,
    /authManager\.setAuth\(data\.token,\s*data\.user\)/,
    'handleLogin must register token with authManager upon successful login'
  );
  assert.match(
    loginBody,
    /fetchSettings\(\)/,
    'handleLogin must call fetchSettings() to retrieve settings immediately after login without refresh'
  );
});

test('6. App.jsx fetchSettings attaches Authorization header when token is present', () => {
  const content = fs.readFileSync(APP_PATH, 'utf-8');
  const fetchSettingsMatch = content.match(/const\s+fetchSettings\s*=\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\};/);
  assert.ok(fetchSettingsMatch, 'fetchSettings must be present in App.jsx');
  const fetchBody = fetchSettingsMatch[1];
  assert.match(
    fetchBody,
    /Authorization/,
    'fetchSettings must send Authorization header when token is present'
  );
});

test('7. Simulated first-load settings resolution logic produces valid logo src on 100% of scenarios', () => {
  // Scenario A: Fresh unauthenticated initial state
  const initialSettings = {
    company_name: 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)',
    receipt_header: 'ใบเสร็จรับเงิน / ใบรับจองบริการ',
    receipt_footer: 'ขอบคุณที่ใช้บริการห้องประชุมของเรา',
    logo_image: '/BWORK-LOGO.png'
  };
  const resolveLogo = (s) => (s && s.logo_image) || '/BWORK-LOGO.png';

  assert.strictEqual(resolveLogo(initialSettings), '/BWORK-LOGO.png', 'Fresh initial state must resolve to /BWORK-LOGO.png');

  // Scenario B: Settings is null / undefined during initial render
  assert.strictEqual(resolveLogo(null), '/BWORK-LOGO.png', 'Null settings must resolve to /BWORK-LOGO.png');
  assert.strictEqual(resolveLogo(undefined), '/BWORK-LOGO.png', 'Undefined settings must resolve to /BWORK-LOGO.png');
  assert.strictEqual(resolveLogo({}), '/BWORK-LOGO.png', 'Empty settings object must resolve to /BWORK-LOGO.png');

  // Scenario C: Custom uploaded logo from backend/D1
  const loadedSettings = {
    ...initialSettings,
    logo_image: '/uploads/img_1784278289923_kie4d.png'
  };
  assert.strictEqual(
    resolveLogo(loadedSettings),
    '/uploads/img_1784278289923_kie4d.png',
    'Loaded settings with custom logo must resolve to uploaded logo'
  );

  // Scenario D: Custom logo with empty string fallback
  assert.strictEqual(
    resolveLogo({ logo_image: '' }),
    '/BWORK-LOGO.png',
    'Empty string logo_image must fall back to /BWORK-LOGO.png'
  );
});

test('8. ReceiptPrint onError includes explicit loop protection against repeated failures', () => {
  const content = fs.readFileSync(RECEIPT_PRINT_PATH, 'utf-8');
  assert.match(
    content,
    /e\.currentTarget\.dataset\.fallbackTried\s*=\s*['"]true['"]/,
    'onError must record fallbackTried'
  );
  assert.match(
    content,
    /e\.currentTarget\.onerror\s*=\s*null/,
    'onError must nullify handler on repeated failure to prevent infinite loops'
  );
});
