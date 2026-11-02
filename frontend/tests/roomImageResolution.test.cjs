const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Set VITE_API_BASE in process.env so apiConfig loads worker API base in Node environment
process.env.VITE_API_BASE = 'https://bwork-pos-api.ohnatza74185-ky.workers.dev';

const frontendHelperPath = path.join(__dirname, '../src/utils/roomImageHelper.js');
const bookingHelperPath = path.join(__dirname, '../../booking-app/src/utils/roomImageHelper.js');

// Test both helper implementations
for (const [appName, helperPath] of [['Frontend POS', frontendHelperPath], ['Booking App', bookingHelperPath]]) {
  test(`${appName}: getRoomImageUrl resolves /uploads/rooms/ through API_BASE`, async () => {
    // Dynamic import ES module
    const { getRoomImageUrl, handleRoomImageError } = await import('file://' + helperPath.replace(/\\/g, '/'));

    // 1. Dynamic room in R2
    const dynamicRoom = {
      id: 4,
      name: 'Mars (301)',
      image_url: '/uploads/rooms/1793494009230_oxx5fl.jpeg'
    };
    const resolvedDynamic = getRoomImageUrl(dynamicRoom);
    assert.match(resolvedDynamic, /^https:\/\/.*\/uploads\/rooms\/1793494009230_oxx5fl\.jpeg$/);
    assert.match(resolvedDynamic, /workers\.dev|API_BASE/);

    // 2. Legacy room in Pages static assets (/uploads/img_)
    const legacyRoom = {
      id: 10,
      name: 'Jupiter (300)',
      image_url: '/uploads/img_1784255149006_z8qg8.jpeg'
    };
    const resolvedLegacy = getRoomImageUrl(legacyRoom);
    assert.equal(resolvedLegacy, '/uploads/img_1784255149006_z8qg8.jpeg');

    // 3. String URLs
    assert.equal(
      getRoomImageUrl('/uploads/rooms/test.jpg').startsWith('https://'),
      true,
      'Direct /uploads/rooms string should prepend API_BASE'
    );
    assert.equal(
      getRoomImageUrl('/uploads/img_test.jpg'),
      '/uploads/img_test.jpg',
      'Direct /uploads/img_ string should remain relative'
    );

    // 4. Data URI and full URLs untouched
    assert.equal(getRoomImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    assert.equal(getRoomImageUrl('https://external.cdn/photo.jpg'), 'https://external.cdn/photo.jpg');

    // 5. Classroom layout support
    const dualLayoutRoom = {
      id: 4,
      image_url: '/uploads/rooms/standard.jpg',
      classroom_image_url: '/uploads/rooms/classroom.jpg'
    };
    const standardResolved = getRoomImageUrl(dualLayoutRoom, false);
    const classroomResolved = getRoomImageUrl(dualLayoutRoom, true);
    assert.match(standardResolved, /standard\.jpg$/);
    assert.match(classroomResolved, /classroom\.jpg$/);

    // 6. Null and empty safety
    assert.equal(getRoomImageUrl(null), '');
    assert.equal(getRoomImageUrl({}), '');
    assert.equal(getRoomImageUrl(''), '');
  });

  test(`${appName}: handleRoomImageError performs fallback and prevents infinite loop`, async () => {
    const { handleRoomImageError } = await import('file://' + helperPath.replace(/\\/g, '/'));

    // Mock an <img> element
    const mockImg = {
      src: 'https://bwork-pos-api.ohnatza74185-ky.workers.dev/uploads/rooms/test.jpg',
      dataset: {},
      style: { display: 'block' }
    };
    const mockEvent = { currentTarget: mockImg };

    // First error: should fallback to relative path
    handleRoomImageError(mockEvent, '/uploads/rooms/test.jpg');
    assert.equal(mockImg.src, '/uploads/rooms/test.jpg');
    assert.equal(mockImg.dataset.fallbackTried, 'true');
    assert.equal(mockImg.style.display, 'block');

    // Second error on the same element: must NOT loop again; should hide image
    handleRoomImageError(mockEvent, '/uploads/rooms/test.jpg');
    assert.equal(mockImg.style.display, 'none', 'Second error must hide element to prevent infinite loop');
    assert.equal(mockImg.src, '/uploads/rooms/test.jpg', 'Src should not change again');
  });

  test(`${appName}: handleRoomImageError falls back from relative to API_BASE`, async () => {
    const { handleRoomImageError } = await import('file://' + helperPath.replace(/\\/g, '/'));

    const mockImg = {
      src: '/uploads/img_test.jpg',
      dataset: {},
      style: { display: 'block' }
    };
    const mockEvent = { currentTarget: mockImg };

    handleRoomImageError(mockEvent, '/uploads/img_test.jpg');
    assert.match(mockImg.src, /^https:\/\/.*\/uploads\/img_test\.jpg$/);
    assert.equal(mockImg.dataset.fallbackTried, 'true');

    // Second error hides image
    handleRoomImageError(mockEvent, '/uploads/img_test.jpg');
    assert.equal(mockImg.style.display, 'none');
  });
}
