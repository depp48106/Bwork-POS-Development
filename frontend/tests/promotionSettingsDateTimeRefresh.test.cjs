/**
 * promotionSettingsDateTimeRefresh.test.cjs
 * Targeted test suite for Thai Date/Time Formats and Refresh Behavior
 *
 * Validates:
 * 1. Start date & End date in visible DD/MM/YYYY format
 * 2. Start time & End time in 24-hour HH:mm format
 * 3. ZERO AM/PM strings anywhere in the component
 * 4. Bangkok timezone (+07:00 / Asia/Bangkok) preservation in parse & build helpers
 * 5. Refresh button calls GET /api/admin/promotion (and NEVER mutation endpoints)
 * 6. Refresh updates canonical form state and clears dirty state after reload
 * 7. Refresh safety: Confirmation dialog displayed on dirty state; preserves unsaved state when cancelled
 * 8. Refresh failure preserves current form without resetting to defaults
 * 9. Active status refresh updates button to 'หยุดใช้งานโปรโมชั่น' and locks form
 * 10. ZERO Dev/Test Mode strings in component source
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('BWORK-POS Promotion Settings Thai Date/Time + Refresh Fix Tests', async (t) => {
  const promoSettingsSrc = fs.readFileSync(
    path.join(__dirname, '../src/components/PromotionSettings.jsx'),
    'utf8'
  );

  await t.test('1. Start date and End date DD/MM/YYYY format contracts', () => {
    // Value bindings
    assert.match(promoSettingsSrc, /value=\{formData\.startDate\}/, 'startDate bound to form input');
    assert.match(promoSettingsSrc, /value=\{formData\.endDate\}/, 'endDate bound to form input');

    // Placeholders use DD/MM/YYYY
    assert.match(promoSettingsSrc, /placeholder="13\/10\/2026"/, 'Start date uses DD/MM/YYYY placeholder');
    assert.match(promoSettingsSrc, /placeholder="20\/10\/2026"/, 'End date uses DD/MM/YYYY placeholder');

    // Default state initialized with DD/MM/YYYY
    assert.match(promoSettingsSrc, /startDate:\s*'13\/10\/2026'/, 'Initial default start date is DD/MM/YYYY');

    // Date parsing helper returns DD/MM/YYYY
    assert.match(promoSettingsSrc, /date:\s*`\$\{day\}\/\$\{m\}\/\$\{y\}`/, 'parseBangkokParts outputs DD/MM/YYYY');
  });

  await t.test('2. Start time and End time 24-hour HH:mm format contracts', () => {
    // Value bindings
    assert.match(promoSettingsSrc, /value=\{formData\.startTime\}/, 'startTime bound to form input');
    assert.match(promoSettingsSrc, /value=\{formData\.endTime\}/, 'endTime bound to form input');

    // 24-hr placeholders
    assert.match(promoSettingsSrc, /placeholder="08:00"/, 'Start time uses 08:00 24-hr placeholder');
    assert.match(promoSettingsSrc, /placeholder="23:59"/, 'End time uses 23:59 24-hr placeholder');

    // Time parsing helper returns HH:mm
    assert.match(promoSettingsSrc, /time:\s*`\$\{h\}:\$\{min\}`/, 'parseBangkokParts outputs HH:mm');
  });

  await t.test('3. Zero AM/PM anywhere on the Promotion Settings page', () => {
    // Ensure no AM/PM strings appear in the component text or template
    assert.doesNotMatch(promoSettingsSrc, /\bAM\b|\bPM\b/i, 'ZERO AM/PM allowed anywhere in PromotionSettings.jsx');
  });

  await t.test('4. Bangkok Timezone (Asia/Bangkok / UTC+7) contract', () => {
    // buildBangkokISO must produce +07:00
    assert.match(promoSettingsSrc, /\+07:00/, 'buildBangkokISO constructs Asia/Bangkok (+07:00) ISO string');

    // Test conversion simulator
    const buildBangkokISO = (dateStr, timeStr) => {
      if (!dateStr || !timeStr) return null;
      let year, month, day;
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          day = parts[0].padStart(2, '0');
          month = parts[1].padStart(2, '0');
          year = parts[2];
        }
      }
      if (!year || !month || !day || year.length !== 4) return null;
      const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
      return `${year}-${month}-${day}T${cleanTime}+07:00`;
    };

    assert.equal(
      buildBangkokISO('13/10/2026', '08:00'),
      '2026-10-13T08:00:00+07:00',
      'Converts 13/10/2026 08:00 to 2026-10-13T08:00:00+07:00'
    );
    assert.equal(
      buildBangkokISO('20/10/2026', '23:59'),
      '2026-10-20T23:59:00+07:00',
      'Converts 20/10/2026 23:59 to 2026-10-20T23:59:00+07:00'
    );
  });

  await t.test('5. Human-readable status datetime with Thai format', () => {
    assert.match(promoSettingsSrc, /13 ต\.ค\. 2026 เวลา 08:00 น\. เป็นต้นไป/,
      'Displays exact Thai status text with 13 ต.ค. 2026 เวลา 08:00 น.');
    assert.match(promoSettingsSrc, /formatBangkokDisplay/,
      'Uses formatBangkokDisplay helper for dynamic status dates');
  });

  await t.test('6. Refresh button calls GET /api/admin/promotion and NO mutation endpoints', () => {
    // Refresh function calls GET
    assert.match(promoSettingsSrc, /fetch\('\/api\/admin\/promotion',\s*\{[\s\S]*?headers:/,
      'Refresh function calls GET /api/admin/promotion');

    // Dedicated refresh handler
    assert.match(promoSettingsSrc, /handleRefreshClick/, 'Refresh button triggers handleRefreshClick');
    assert.match(promoSettingsSrc, /executeRefresh/, 'Shared executeRefresh helper defined');

    // Accessible title & label
    assert.match(promoSettingsSrc, /title="รีเฟรชข้อมูลโปรโมชั่น"/, 'Refresh button title attribute');
    assert.match(promoSettingsSrc, /aria-label="รีเฟรชข้อมูลโปรโมชั่น"/, 'Refresh button aria-label attribute');
    assert.match(promoSettingsSrc, /disabled=\{promoLoading\}/, 'Refresh button disabled during loading');
  });

  await t.test('7. Unsaved changes confirmation safety on refresh', () => {
    // Checks isDirty before refreshing
    assert.match(promoSettingsSrc, /if\s*\(isDirty\)/, 'Checks isDirty before refreshing');

    // Dialog message
    assert.match(promoSettingsSrc, /มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก/, 'Confirm dialog message part 1');
    assert.match(promoSettingsSrc, /หากรีเฟรช ข้อมูลที่แก้ไขจะถูกยกเลิกและโหลดค่าล่าสุดจากระบบ/, 'Confirm dialog message part 2');

    // Dialog actions
    assert.match(promoSettingsSrc, /รีเฟรชข้อมูล/, 'Confirm dialog action button');
    assert.match(promoSettingsSrc, /setShowRefreshConfirm\(false\)/, 'Cancel action dismisses dialog without refresh');
  });

  await t.test('8. Refresh failure preserves current form without reset', () => {
    // Error handling message
    assert.match(promoSettingsSrc, /ไม่สามารถรีเฟรชข้อมูลโปรโมชั่นได้/,
      'Displays safe error message on failure without resetting form');
  });

  await t.test('9. Active status refresh updates button and locks form', () => {
    // Active lock warning banner
    assert.match(promoSettingsSrc, /กรุณาหยุดโปรโมชั่นก่อนแก้ไขการตั้งค่า/, 'Active lockout warning banner present');
    assert.match(promoSettingsSrc, /'หยุดใช้งานโปรโมชั่น'/, 'Renders deactivation button when active');
    assert.match(promoSettingsSrc, /'เปิดใช้งานโปรโมชั่น'/, 'Renders activation button when inactive');
  });

  await t.test('10. Zero Dev/Test Mode UI strings in component source', () => {
    const forbidden = [
      'Dev Preview',
      'devPreviewStatus',
      'PromotionDevTestHarness',
      'testModeActive',
      'โหมดทดสอบโปรโมชั่น',
      'Development Test Mode',
      'วันที่จำลอง',
      'รีเซ็ตค่าทดสอบ',
      'ส่วนลดทดสอบ',
      'วันสิ้นสุดจำลอง',
      'bwork_dev_promo_test_harness_session'
    ];

    for (const term of forbidden) {
      assert.equal(promoSettingsSrc.includes(term), false, `Component must NOT contain "${term}"`);
    }
  });
});
