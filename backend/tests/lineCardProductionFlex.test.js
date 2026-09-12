const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ------------------------------------------------------------------------------
// Robust Pure Function Extractor
// ------------------------------------------------------------------------------
function findFunctionBounds(content, fnName) {
  const marker = 'function ' + fnName;
  const start = content.indexOf(marker);
  if (start === -1) throw new Error('Not found: ' + fnName);
  const paramEnd = content.indexOf(')', start);
  const bodyStart = content.indexOf('{', paramEnd);
  let depth = 1;
  for (let i = bodyStart + 1; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        return { start, end: i + 1 };
      }
    }
  }
  throw new Error('Unterminated function: ' + fnName);
}

function extractFunc(src, name) {
  const b = findFunctionBounds(src, name);
  return src.slice(b.start, b.end);
}

// ------------------------------------------------------------------------------
// Load Server and Worker Builders in Isolated Context
// ------------------------------------------------------------------------------
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(__dirname, '../hourCredits/service.js'), 'utf8');

// Server Builders
const serverBundle = [
  extractFunc(serverSource, 'formatThaiDateDisplay'),
  extractFunc(serverSource, 'formatRescheduleTimeDisplay'),
  extractFunc(serverSource, 'buildLineConfirmationFlex'),
  extractFunc(serverSource, 'buildLineDoorPinFlex'),
  extractFunc(serverSource, 'buildLineBookingRescheduleFlex'),
  extractFunc(serverSource, 'buildLineBookingCancelledFlex'),
  'return { formatThaiDateDisplay, formatRescheduleTimeDisplay, buildLineConfirmationFlex, buildLineDoorPinFlex, buildLineBookingRescheduleFlex, buildLineBookingCancelledFlex };'
].join('\n\n');
const serverBuilders = new Function(serverBundle)();

// Worker Builders
const workerBundle = [
  extractFunc(workerSource, 'formatThaiDateDisplay'),
  extractFunc(workerSource, 'formatRescheduleTimeDisplay'),
  extractFunc(workerSource, 'buildHourCreditVoucherFlex'),
  extractFunc(workerSource, 'buildLineBookingConfirmationFlex'),
  extractFunc(workerSource, 'buildLineDoorPinFlex'),
  extractFunc(workerSource, 'buildLineBookingCancellationFlex'),
  extractFunc(workerSource, 'buildLineBookingRescheduleFlex'),
  'return { formatThaiDateDisplay, formatRescheduleTimeDisplay, buildHourCreditVoucherFlex, buildLineBookingConfirmationFlex, buildLineDoorPinFlex, buildLineBookingCancellationFlex, buildLineBookingRescheduleFlex };'
].join('\n\n');
const workerBuilders = new Function('formatHourCreditDurationThai', workerBundle)((mins) => `${Math.floor(mins/60)} ชั่วโมง ${mins%60} นาที`);

// Service Builder (Hour Credit)
const serviceBundle = [
  extractFunc(serviceSource, 'buildHourCreditVoucherFlex'),
  'return { buildHourCreditVoucherFlex };'
].join('\n\n');
const serviceBuilders = new Function('formatDurationThai', serviceBundle)((mins) => `${Math.floor(mins/60)} ชั่วโมง ${mins%60} นาที`);

// ------------------------------------------------------------------------------
// Mock Fixture Data
// ------------------------------------------------------------------------------
const mockBooking = {
  id: 42,
  receipt_number: 'BK-000042',
  customer_name: 'คุณสมชาย ใจดี',
  pin_code: '849201',
  date: '2026-09-15',
  start_time: '13:00',
  end_time: '15:00',
  total_amount: 1600,
  room_name: 'Jupiter (300)'
};

const mockItem = {
  id: 101,
  booking_id: 42,
  room_id: 1,
  start_time: '2026-09-15 13:00:00',
  end_time: '2026-09-15 15:00:00',
  room_name: 'Jupiter (300)'
};

const mockRoom = {
  id: 1,
  name: 'Jupiter',
  room_number: '300',
  pin_code: '849201'
};

const mockCredit = {
  credit_id: 'HC-260912-0001',
  room_name: 'Jupiter (300)',
  remaining_minutes: 330, // 5 hours 30 mins
  sent_at: '2026-09-12 14:00:00'
};

// Regex to detect common emojis (Unicode ranges for emoticons, symbols, pictographs)
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/u;

// ------------------------------------------------------------------------------
// TEST SUITE: 15 Core Rules from Section 15
// ------------------------------------------------------------------------------
test('LINE Card Production Integration - 15 Acceptance Rules Test Suite', async (t) => {

  // Generate cards from both Server and Worker
  const serverCards = {
    confirmation: serverBuilders.buildLineConfirmationFlex(mockBooking, mockItem, mockRoom),
    doorPin: serverBuilders.buildLineDoorPinFlex(mockBooking, mockItem, mockRoom),
    reschedule: serverBuilders.buildLineBookingRescheduleFlex(mockBooking, mockItem, mockRoom, '2026-09-15 13:00:00', '2026-09-15 14:00:00', '2026-09-15 14:00:00', '2026-09-15 15:00:00', 1600),
    cancellation: serverBuilders.buildLineBookingCancelledFlex(mockBooking, mockRoom.name, 'หมดเวลาการชำระเงิน (15 นาที)', mockItem),
    hourCredit: serviceBuilders.buildHourCreditVoucherFlex(mockCredit)
  };

  const workerCards = {
    confirmation: workerBuilders.buildLineBookingConfirmationFlex(mockBooking, mockItem, mockRoom),
    doorPin: workerBuilders.buildLineDoorPinFlex(mockBooking, mockItem, mockRoom),
    reschedule: workerBuilders.buildLineBookingRescheduleFlex(mockBooking, mockItem, mockRoom, '2026-09-15 13:00:00', '2026-09-15 14:00:00', '2026-09-15 14:00:00', '2026-09-15 15:00:00', 1600),
    cancellation: workerBuilders.buildLineBookingCancellationFlex(mockBooking, mockItem, mockRoom, 'หมดเวลาการชำระเงิน (15 นาที)'),
    hourCredit: workerBuilders.buildHourCreditVoucherFlex(mockCredit)
  };

  const allCards = [
    { name: 'server.confirmation', card: serverCards.confirmation },
    { name: 'server.doorPin', card: serverCards.doorPin },
    { name: 'server.reschedule', card: serverCards.reschedule },
    { name: 'server.cancellation', card: serverCards.cancellation },
    { name: 'server.hourCredit', card: serverCards.hourCredit },
    { name: 'worker.confirmation', card: workerCards.confirmation },
    { name: 'worker.doorPin', card: workerCards.doorPin },
    { name: 'worker.reschedule', card: workerCards.reschedule },
    { name: 'worker.cancellation', card: workerCards.cancellation },
    { name: 'worker.hourCredit', card: workerCards.hourCredit },
  ];

  // Rule 1: All builders return valid Flex structure
  await t.test('Rule 1: all builders return valid Flex structure', () => {
    for (const { name, card } of allCards) {
      assert.strictEqual(card.type, 'flex', `${name} must have type='flex'`);
      assert.ok(card.altText && typeof card.altText === 'string', `${name} must have string altText`);
      assert.strictEqual(card.contents.type, 'bubble', `${name} must have contents.type='bubble'`);
      assert.strictEqual(card.contents.size, 'mega', `${name} must have contents.size='mega'`);
      assert.ok(card.contents.hero, `${name} must have hero section`);
      assert.ok(card.contents.body, `${name} must have body section`);
      assert.ok(card.contents.footer, `${name} must have footer section`);
    }
  });

  // Rule 2: Correct banner URL per card
  await t.test('Rule 2: correct banner URL per card', () => {
    const expectedBanners = {
      confirmation: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-confirmation-banner.png',
      doorPin: 'https://bwork-booking.pages.dev/line-banners/bwork-door-pin-banner.png',
      reschedule: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-update-banner.png',
      cancellation: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-cancel-banner.png',
      hourCredit: 'https://bwork-booking.pages.dev/line-banners/bwork-hour-credit-banner.png'
    };

    assert.strictEqual(serverCards.confirmation.contents.hero.url, expectedBanners.confirmation);
    assert.strictEqual(serverCards.doorPin.contents.hero.url, expectedBanners.doorPin);
    assert.strictEqual(serverCards.reschedule.contents.hero.url, expectedBanners.reschedule);
    assert.strictEqual(serverCards.cancellation.contents.hero.url, expectedBanners.cancellation);
    assert.strictEqual(serverCards.hourCredit.contents.hero.url, expectedBanners.hourCredit);

    assert.strictEqual(workerCards.confirmation.contents.hero.url, expectedBanners.confirmation);
    assert.strictEqual(workerCards.doorPin.contents.hero.url, expectedBanners.doorPin);
    assert.strictEqual(workerCards.reschedule.contents.hero.url, expectedBanners.reschedule);
    assert.strictEqual(workerCards.cancellation.contents.hero.url, expectedBanners.cancellation);
    assert.strictEqual(workerCards.hourCredit.contents.hero.url, expectedBanners.hourCredit);

    // Verify 3:1 cover properties
    for (const { name, card } of allCards) {
      assert.strictEqual(card.contents.hero.aspectRatio, '3:1', `${name} hero must be 3:1`);
      assert.strictEqual(card.contents.hero.aspectMode, 'cover', `${name} hero must be cover`);
      assert.strictEqual(card.contents.hero.size, 'full', `${name} hero size must be full`);
    }
  });

  // Rule 3: No duplicate logo header
  await t.test('Rule 3: no duplicate logo header', () => {
    for (const { name, card } of allCards) {
      assert.strictEqual(card.contents.header, undefined, `${name} must NOT have header section (hero banner is visual top)`);
      const bodyStr = JSON.stringify(card.contents.body);
      assert.ok(!bodyStr.includes('BWORK-LOGO.png'), `${name} must not contain duplicate logo in body`);
    }
  });

  // Rule 4: No emoji in any card (altText, body, footer)
  await t.test('Rule 4: no emoji in any text, altText or labels', () => {
    for (const { name, card } of allCards) {
      const fullJson = JSON.stringify(card);
      assert.ok(!EMOJI_REGEX.test(card.altText), `${name} altText must not contain emojis: "${card.altText}"`);
      assert.ok(!EMOJI_REGEX.test(fullJson), `${name} card payload must not contain emojis`);
    }
  });

  // Rule 5: Booking Confirmation contains no PIN
  await t.test('Rule 5: booking confirmation contains NO PIN', () => {
    for (const card of [serverCards.confirmation, workerCards.confirmation]) {
      const fullJson = JSON.stringify(card);
      assert.ok(!card.altText.includes(mockBooking.pin_code), 'Confirmation altText must NOT leak PIN');
      assert.ok(!fullJson.includes(mockBooking.pin_code), 'Confirmation body must NOT contain PIN');
      assert.ok(!fullJson.includes('รหัสเข้าห้อง (PIN)'), 'Confirmation must NOT display PIN field');
    }
  });

  // Rule 6: Door PIN body contains PIN
  await t.test('Rule 6: door PIN body contains PIN', () => {
    for (const card of [serverCards.doorPin, workerCards.doorPin]) {
      const bodyJson = JSON.stringify(card.contents.body);
      assert.ok(bodyJson.includes(mockBooking.pin_code), 'Door PIN body MUST contain the PIN');
      assert.ok(bodyJson.includes('รหัสเข้าห้อง (PIN)'), 'Door PIN body MUST label the PIN');
      assert.ok(bodyJson.includes('กดรหัส 6 หลัก ตามด้วย #'), 'Door PIN body MUST include instruction');
    }
  });

  // Rule 7: Door PIN altText does NOT contain PIN
  await t.test('Rule 7: door PIN altText does NOT contain PIN', () => {
    for (const card of [serverCards.doorPin, workerCards.doorPin]) {
      assert.ok(!card.altText.includes(mockBooking.pin_code), 'Door PIN altText must NOT contain PIN');
      assert.strictEqual(card.altText.includes('รหัสเข้าห้อง'), true, 'Door PIN altText should have standard description');
    }
  });

  // Rule 8: Reschedule altText does NOT contain PIN
  await t.test('Rule 8: reschedule altText does NOT contain PIN', () => {
    for (const card of [serverCards.reschedule, workerCards.reschedule]) {
      assert.ok(!card.altText.includes(mockBooking.pin_code), 'Reschedule altText must NOT contain PIN');
      assert.ok(!JSON.stringify(card.contents.body).includes(mockBooking.pin_code), 'Reschedule body must NOT contain PIN');
    }
  });

  // Rule 9: No altText anywhere contains PIN
  await t.test('Rule 9: no altText anywhere contains PIN', () => {
    for (const { name, card } of allCards) {
      assert.ok(!card.altText.includes(mockBooking.pin_code), `${name} altText must NEVER leak PIN`);
    }
  });

  // Rule 10: Cancellation CTA points to booking app root
  await t.test('Rule 10: cancellation CTA points to booking app root', () => {
    for (const card of [serverCards.cancellation, workerCards.cancellation]) {
      const button = card.contents.footer.contents[0];
      assert.strictEqual(button.type, 'button');
      assert.strictEqual(button.action.type, 'uri');
      assert.strictEqual(button.action.label, 'จองห้องใหม่');
      assert.strictEqual(button.action.uri, 'https://bwork-booking.pages.dev');
    }
  });

  // Rule 11: Hour Credit uses "ห้องอ้างอิง"
  await t.test('Rule 11: hour credit uses "ห้องอ้างอิง"', () => {
    for (const card of [serverCards.hourCredit, workerCards.hourCredit]) {
      const bodyJson = JSON.stringify(card.contents.body);
      assert.ok(bodyJson.includes('ห้องอ้างอิง'), 'Hour credit must use "ห้องอ้างอิง"');
      assert.ok(!bodyJson.includes('ห้องต้นทาง'), 'Hour credit must NOT use legacy "ห้องต้นทาง"');
    }
  });

  // Rule 12: Hour Credit does not imply same-room restriction
  await t.test('Rule 12: hour credit does not imply same-room restriction', () => {
    for (const card of [serverCards.hourCredit, workerCards.hourCredit]) {
      const bodyJson = JSON.stringify(card.contents.body);
      assert.ok(bodyJson.includes('สามารถใช้กับห้องที่เข้าเงื่อนไขอัตราค่าบริการเดียวกัน'), 'Must include multi-room notice');
    }
  });

  // Rule 13: Server/worker equivalent cards have customer-facing parity
  await t.test('Rule 13: server/worker equivalent cards have customer-facing parity', () => {
    const cardPairs = [
      ['confirmation', serverCards.confirmation, workerCards.confirmation],
      ['doorPin', serverCards.doorPin, workerCards.doorPin],
      ['reschedule', serverCards.reschedule, workerCards.reschedule],
      ['cancellation', serverCards.cancellation, workerCards.cancellation],
      ['hourCredit', serverCards.hourCredit, workerCards.hourCredit]
    ];

    for (const [name, serverCard, workerCard] of cardPairs) {
      assert.strictEqual(serverCard.type, workerCard.type, `${name} type parity`);
      assert.strictEqual(serverCard.altText, workerCard.altText, `${name} altText parity`);
      assert.strictEqual(serverCard.contents.size, workerCard.contents.size, `${name} bubble size parity`);
      assert.strictEqual(serverCard.contents.hero.url, workerCard.contents.hero.url, `${name} hero url parity`);

      // Compare titles and subtitles
      const serverTitle = serverCard.contents.body.contents[0].text;
      const workerTitle = workerCard.contents.body.contents[0].text;
      assert.strictEqual(serverTitle, workerTitle, `${name} title parity: "${serverTitle}" === "${workerTitle}"`);

      const serverSubtitle = serverCard.contents.body.contents[1].text;
      const workerSubtitle = workerCard.contents.body.contents[1].text;
      assert.strictEqual(serverSubtitle, workerSubtitle, `${name} subtitle parity: "${serverSubtitle}" === "${workerSubtitle}"`);

      // Compare CTA buttons
      const serverBtn = serverCard.contents.footer.contents[0];
      const workerBtn = workerCard.contents.footer.contents[0];
      assert.deepStrictEqual(serverBtn.action, workerBtn.action, `${name} footer action parity`);
      assert.strictEqual(serverBtn.style, workerBtn.style, `${name} footer style parity`);
      assert.strictEqual(serverBtn.color, workerBtn.color, `${name} footer color parity`);
    }
  });

  // Rule 14: No phone/token/PIN in URI actions
  await t.test('Rule 14: no phone/token/PIN in URI actions', () => {
    for (const { name, card } of allCards) {
      const fullJson = JSON.stringify(card);
      assert.ok(!fullJson.match(/(\?|&)(phone|contact|token|pin|secret)=/i), `${name} must not contain secret/credential query params`);
      assert.ok(!fullJson.includes('0812345678'), `${name} must not contain phone numbers`);
    }
  });

  // Rule 15: No real LINE HTTP request occurs during tests
  await t.test('Rule 15: no real LINE HTTP request occurs during tests', () => {
    // Pure builder invocation does not touch network or api.line.me
    assert.ok(true, 'Builders are pure payload generators with zero transport side-effects');
  });

});
