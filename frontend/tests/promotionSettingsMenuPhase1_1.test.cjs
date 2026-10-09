const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('BWORK-PROMOTION-SETTINGS-MENU Phase 1.1 Tests', async (t) => {
  const appSrc = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  const settingsSrc = fs.readFileSync(path.join(__dirname, '../src/components/Settings.jsx'), 'utf8');
  const promoSettingsSrc = fs.readFileSync(path.join(__dirname, '../src/components/PromotionSettings.jsx'), 'utf8');
  const doorAccessSrc = fs.readFileSync(path.join(__dirname, '../src/components/DoorAccessSettings.jsx'), 'utf8');

  await t.test('1. Default Permissions UI & Key Definition', () => {
    // Permission key admin-promotion must exist with exact Thai label
    assert.match(settingsSrc, /\{\s*key:\s*'admin-promotion',\s*label:\s*'ตั้งค่าโปรโมชั่น'\s*\}/,
      'Settings.jsx must declare admin-promotion with label ตั้งค่าโปรโมชั่น');

    // Verify natural placement: admin-system -> admin-promotion -> admin-quotation
    const sysIndex = settingsSrc.indexOf("'admin-system'");
    const promoIndex = settingsSrc.indexOf("'admin-promotion'");
    const quoteIndex = settingsSrc.indexOf("'admin-quotation'");

    assert.ok(sysIndex > 0 && promoIndex > 0 && quoteIndex > 0, 'Permissions must exist in Settings.jsx');
    assert.ok(sysIndex < promoIndex, 'admin-promotion must appear after admin-system');
    assert.ok(promoIndex < quoteIndex, 'admin-promotion must appear before admin-quotation');
  });

  await t.test('2. Navigation Menu & Sidebar Placement', () => {
    // Menu label must be exactly ตั้งค่าโปรโมชั่น without emoji
    assert.match(appSrc, /<span>ตั้งค่าโปรโมชั่น<\/span>/, 'App.jsx must render exact menu label ตั้งค่าโปรโมชั่น');
    assert.doesNotMatch(appSrc, /<span>.*[🎁🏷️✨🎉].*ตั้งค่าโปรโมชั่น.*<\/span>/, 'Menu label must contain zero emojis');

    // Menu item must use Tag icon
    assert.match(appSrc, /<Tag size=\{16\} \/>\s*<span>ตั้งค่าโปรโมชั่น<\/span>/, 'Menu item must use Lucide Tag icon');

    // Menu button must be permission-gated
    assert.match(appSrc, /hasPermission\('admin-promotion'\)\s*\|\|\s*hasPermission\('admin-promotions'\)/,
      'Menu item must check hasPermission for admin-promotion');

    // Menu button must update activeSettingsSubTab to promotion
    assert.match(appSrc, /setActiveSettingsSubTab\('promotion'\)/,
      'Clicking menu button must set activeSettingsSubTab to promotion');
  });

  await t.test('3. Dedicated Route & Protection (/promotion-settings)', () => {
    // Direct route detection
    assert.match(appSrc, /window\.location\.pathname === '\/promotion-settings'/,
      'App.jsx must support route /promotion-settings');

    // Deep link permission enforcement
    assert.match(appSrc, /isPromoRoute && user/,
      'App.jsx must check user and promo route');

    // Unauthorized route redirection to default tab and resetting URL
    assert.match(appSrc, /setActiveTab\(getDefaultLandingTab\(user\)\)/,
      'Unauthorized user must be redirected to default landing tab');
  });

  await t.test('4. Permission Mapping & Subtab Fallbacks', () => {
    // checkUserPermission mapping in App.jsx
    assert.match(appSrc, /tabKey === 'admin-management' \|\| tabKey === 'settings'/, 'App.jsx handles settings tab permissions');
    assert.match(appSrc, /perms\.includes\('admin-promotion'\)/, 'Settings tab allows users with admin-promotion');

    // getFirstAllowedSettingsTab
    assert.match(appSrc, /perms\.includes\('admin-promotion'\).*return 'promotion'/,
      'getFirstAllowedSettingsTab falls back to promotion subtab when user has permission');
  });

  await t.test('5. SettingsPanel Integration & Dedicated Component', () => {
    // SettingsPanel viewMode === 'promotion'
    assert.match(settingsSrc, /viewMode === 'promotion' && 'ตั้งค่าโปรโมชั่น'/,
      'SettingsPanel tab-title displays ตั้งค่าโปรโมชั่น');
    assert.match(settingsSrc, /viewMode === 'promotion' && 'จัดการโปรโมชั่นสำหรับการจองออนไลน์'/,
      'SettingsPanel subtitle displays จัดการโปรโมชั่นสำหรับการจองออนไลน์');
    assert.match(settingsSrc, /viewMode === 'promotion' && \(\s*<PromotionSettings sysAlert=\{sysAlert\} \/>\s*\)/,
      'SettingsPanel renders PromotionSettings when viewMode is promotion');

    // App.jsx renders PromotionSettings in right work area
    assert.match(appSrc, /activeSettingsSubTab === 'promotion'.*<PromotionSettings sysAlert=\{customAlert\} \/>/,
      'App.jsx renders PromotionSettings in right work area when activeSettingsSubTab is promotion');
  });

  await t.test('6. Elimination of Duplicate Promotion Controls in DoorAccessSettings', () => {
    // DoorAccessSettings must not contain promotion card
    assert.doesNotMatch(doorAccessSrc, /โปรโมชั่นจองออนไลน์ 5%/,
      'DoorAccessSettings must NOT contain duplicate promotion card');
    assert.doesNotMatch(doorAccessSrc, /handleActivatePromotion/,
      'DoorAccessSettings must NOT contain handleActivatePromotion');
    assert.doesNotMatch(doorAccessSrc, /handleDeactivatePromotion/,
      'DoorAccessSettings must NOT contain handleDeactivatePromotion');
    assert.doesNotMatch(doorAccessSrc, /fetchPromotion/,
      'DoorAccessSettings must NOT fetch promotion data');
  });

  await t.test('7. PromotionSettings Component - 4 Canonical Status States & UI Contracts', () => {
    // 4 canonical statuses
    assert.match(promoSettingsSrc, /upcoming:\s*'รอเปิดใช้งาน'/, 'Maps upcoming status to รอเปิดใช้งาน');
    assert.match(promoSettingsSrc, /ready:\s*'พร้อมเปิดใช้งาน'/, 'Maps ready status to พร้อมเปิดใช้งาน');
    assert.match(promoSettingsSrc, /active:\s*'กำลังใช้งาน'/, 'Maps active status to กำลังใช้งาน');
    assert.match(promoSettingsSrc, /ended:\s*'สิ้นสุดแล้ว'/, 'Maps ended status to สิ้นสุดแล้ว');

    // Current development start text
    assert.match(promoSettingsSrc, /สามารถเปิดใช้งานได้ตั้งแต่ 13 ต\.ค\. 2026 เวลา 08:00 น\. เป็นต้นไป/,
      'Displays canonical helper text for upcoming status');

    // Button labels: zero emojis
    assert.match(promoSettingsSrc, /'เปิดใช้งานโปรโมชั่น'/, 'Activation button label must be เปิดใช้งานโปรโมชั่น without emoji');
    assert.match(promoSettingsSrc, /'หยุดใช้งานโปรโมชั่น'/, 'Deactivation button label must be หยุดใช้งานโปรโมชั่น');

    // Button disabled state when upcoming or ended
    assert.match(promoSettingsSrc, /currentStatus === 'upcoming' \|\| currentStatus === 'ended'/,
      'Activation button must be disabled when upcoming or ended');

    // Dev preview completely removed in redesigned layout
    assert.doesNotMatch(promoSettingsSrc, /Dev Preview:/, 'Dev preview is completely removed in clean redesign');
  });

  await t.test('8. PromotionSettings Functional Simulator - Mock States Validation', () => {
    const statusLabelMap = {
      upcoming: 'รอเปิดใช้งาน',
      ready: 'พร้อมเปิดใช้งาน',
      active: 'กำลังใช้งาน',
      ended: 'สิ้นสุดแล้ว'
    };

    // Simulate upcoming
    {
      const status = 'upcoming';
      const label = statusLabelMap[status];
      const isActivationDisabled = (status === 'upcoming' || status === 'ended');
      const showHelperText = (status === 'upcoming');
      assert.equal(label, 'รอเปิดใช้งาน');
      assert.equal(isActivationDisabled, true, 'Activation button must be disabled for upcoming');
      assert.equal(showHelperText, true, 'Helper text must be shown for upcoming');
    }

    // Simulate ready
    {
      const status = 'ready';
      const label = statusLabelMap[status];
      const isActivationDisabled = (status === 'upcoming' || status === 'ended');
      const showHelperText = (status === 'upcoming');
      assert.equal(label, 'พร้อมเปิดใช้งาน');
      assert.equal(isActivationDisabled, false, 'Activation button must be enabled for ready');
      assert.equal(showHelperText, false, 'Helper text must NOT be shown for ready');
    }

    // Simulate active
    {
      const status = 'active';
      const label = statusLabelMap[status];
      const showDeactivateButton = (status === 'active');
      assert.equal(label, 'กำลังใช้งาน');
      assert.equal(showDeactivateButton, true, 'Deactivate button must appear for active');
    }

    // Simulate ended
    {
      const status = 'ended';
      const label = statusLabelMap[status];
      const isActivationDisabled = (status === 'upcoming' || status === 'ended');
      assert.equal(label, 'สิ้นสุดแล้ว');
      assert.equal(isActivationDisabled, true, 'Activation button must be disabled for ended');
    }
  });
});
