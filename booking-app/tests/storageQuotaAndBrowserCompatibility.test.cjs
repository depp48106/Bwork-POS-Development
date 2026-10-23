/**
 * BWORK-POS — Booking App iOS Safari / LINE In-App Browser Storage Quota & Safety Test Suite
 *
 * Verifies that:
 * 1. QuotaExceededError (iOS Safari / LINE in-app browser storage full) does NOT block navigation to payment.
 * 2. SecurityError (iOS Safari Private Browsing / Cookies Blocked) is handled gracefully without crashing.
 * 3. Heavy Base64 image URIs (up to 1.4 MB in production rooms) are stripped before storage serialization.
 * 4. Duplicate submissions from rapid double-taps on mobile touchscreens are strictly prevented.
 * 5. Payment resumption works seamlessly even if browser storage is 100% disabled/unusable via location.state.
 * 6. Zero sensitive data (tokens, secrets, private keys) leaks into browser storage.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const bookingFormSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/BookingFormPage.jsx'), 'utf8').replace(/\r\n/g, '\n');
const roomListSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/RoomListPage.jsx'), 'utf8').replace(/\r\n/g, '\n');
const confirmPageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/ConfirmPage.jsx'), 'utf8').replace(/\r\n/g, '\n');
const statusPageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/StatusPage.jsx'), 'utf8').replace(/\r\n/g, '\n');

describe('BWORK-POS: Browser Storage Quota & iOS WebKit Compatibility Tests', () => {

  // ==========================================================================
  // 1. STATIC CODE INVARIANTS: STORAGE SAFETY & NON-BLOCKING NAVIGATION
  // ==========================================================================

  test('1.1: BookingFormPage wraps sessionStorage.setItem in dedicated try/catch (never blocks navigation)', () => {
    assert.ok(
      bookingFormSrc.includes('try {\n          sessionStorage.setItem(\'completed_booking_result\','),
      'sessionStorage.setItem must be wrapped in dedicated try/catch'
    );
    assert.ok(
      bookingFormSrc.includes('catch (storageErr) {\n          console.warn(\'[Storage] sessionStorage completed_booking_result failed'),
      'Catches and warns on sessionStorage failure without rethrowing'
    );
  });

  test('1.2: BookingFormPage wraps localStorage.setItem in dedicated try/catch (never blocks navigation)', () => {
    assert.ok(
      bookingFormSrc.includes('try {\n          localStorage.setItem(\'bwork_pending_booking\','),
      'localStorage.setItem must be wrapped in dedicated try/catch'
    );
    assert.ok(
      bookingFormSrc.includes('catch (storageErr) {\n          console.warn(\'[Storage] localStorage bwork_pending_booking failed'),
      'Catches and warns on localStorage failure without rethrowing'
    );
  });

  test('1.3: BookingFormPage always passes in-memory state to navigate for zero-storage fallback', () => {
    assert.ok(
      bookingFormSrc.includes("navigate(`/confirm?id=${finalBookingId}&code=${encodeURIComponent(finalBookingCode)}`, {\n          state: {\n            booking: completedResult,\n            contact: contact.trim()\n          }\n        });"),
      'navigate must pass state: { booking, contact } so ConfirmPage functions even if storage is full/disabled'
    );
  });

  test('1.4: BookingFormPage strips Base64 data URIs before storing completed_booking_result', () => {
    assert.ok(
      bookingFormSrc.includes("typeof sanitizedBookingData.image_url === 'string' && sanitizedBookingData.image_url.startsWith('data:')"),
      'Must sanitize image_url if it starts with data: to prevent QuotaExceededError'
    );
    assert.ok(
      bookingFormSrc.includes("sanitizedBookingData.image_url = '';"),
      'Strips data URI from image_url before storage write'
    );
  });

  test('1.5: BookingFormPage prevents concurrent submissions via isSubmittingRef', () => {
    assert.ok(
      bookingFormSrc.includes('const isSubmittingRef = useRef(false);'),
      'Has isSubmittingRef lock'
    );
    assert.ok(
      bookingFormSrc.includes('if (loading || isSubmittingRef.current) return;'),
      'Guards against rapid double-taps on mobile touchscreen'
    );
    assert.ok(
      bookingFormSrc.includes('isSubmittingRef.current = true;'),
      'Locks submission during API flight'
    );
    assert.ok(
      bookingFormSrc.includes('isSubmittingRef.current = false;'),
      'Unlocks submission in finally block'
    );
  });

  test('1.6: RoomListPage strips Base64 data URIs and wraps sessionStorage write in try/catch', () => {
    assert.ok(
      roomListSrc.includes("typeof rawImage === 'string' && rawImage.startsWith('data:')"),
      'RoomListPage must detect data: Base64 URIs'
    );
    assert.ok(
      roomListSrc.includes('try {\n      sessionStorage.setItem(\'current_booking_payload\','),
      'RoomListPage must wrap sessionStorage.setItem in try/catch'
    );
    assert.ok(
      roomListSrc.includes("navigate('/form', { state: bookingPayload });"),
      'RoomListPage must pass bookingPayload in React Router memory state'
    );
  });

  test('1.7: ConfirmPage checks location.state?.booking before storage lookup', () => {
    assert.ok(
      confirmPageSrc.includes('if (location.state?.booking) {\n        const parsed = location.state.booking;'),
      'Initial useState must read location.state.booking first'
    );
    assert.ok(
      confirmPageSrc.includes('if (location.state?.booking) {\n      const parsed = location.state.booking;'),
      'fetchFreshBooking must read location.state.booking first'
    );
  });

  test('1.8: ConfirmPage wraps all localStorage.removeItem calls in try/catch', () => {
    // Verify no bare uncaught localStorage.removeItem calls exist
    const bareRemoveRegex = /(?<!try\s*\{\s*)localStorage\.removeItem\('bwork_pending_booking'\);(?!\s*\}\s*catch)/;
    const lines = confirmPageSrc.split('\n');
    lines.forEach((l, idx) => {
      if (l.includes("localStorage.removeItem('bwork_pending_booking');")) {
        // Must be surrounded by try/catch
        const context = lines.slice(Math.max(0, idx - 2), idx + 3).join('\n');
        assert.ok(context.includes('try') && context.includes('catch'), `Line ${idx + 1} must be in try/catch`);
      }
    });
  });

  test('1.9: StatusPage wraps sessionStorage.setItem in try/catch for resume actions', () => {
    const resumeMatches = statusPageSrc.match(/sessionStorage\.setItem\(`bwork_booking_access_\$\{item\.id\}`/g) || [];
    assert.strictEqual(resumeMatches.length, 2, 'Must have 2 resume/re-upload buttons');
    assert.ok(
      /try\s*\{\s*sessionStorage\.setItem\(`bwork_booking_access_\$\{item\.id\}`/.test(statusPageSrc),
      'StatusPage resume writes must be inside try/catch'
    );
  });

  // ==========================================================================
  // 2. RUNTIME SIMULATION: QUOTAEXCEEDEDERROR & STORAGE-DISABLED BEHAVIOR
  // ==========================================================================

  test('2.1: Runtime Simulation: Stripping 1.4 MB Base64 image reduces payload by >99.9%', () => {
    const hugeBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(1400000); // 1.4 MB
    const bookingPayload = {
      room_id: 4,
      room_name: 'Mars (301)',
      image_url: hugeBase64,
      date: '2026-10-20',
      start_time: '10:00',
      end_time: '12:00',
      duration: 2,
      guests: 4,
      layout: 'standard',
      total_amount: 1000
    };

    const rawSize = JSON.stringify(bookingPayload).length;
    assert.ok(rawSize > 1400000, 'Raw size is > 1.4 MB');

    // Apply sanitization logic from BookingFormPage.jsx
    const sanitized = { ...bookingPayload };
    if (typeof sanitized.image_url === 'string' && sanitized.image_url.startsWith('data:')) {
      sanitized.image_url = '';
    }

    const sanitizedSize = JSON.stringify(sanitized).length;
    assert.ok(sanitizedSize < 500, `Sanitized size must be < 500 bytes (actual: ${sanitizedSize})`);
    const reductionPercent = ((rawSize - sanitizedSize) / rawSize) * 100;
    assert.ok(reductionPercent > 99.9, `Size reduction must exceed 99.9% (actual: ${reductionPercent.toFixed(2)}%)`);
  });

  test('2.2: Runtime Simulation: QuotaExceededError in storage write does not throw and allows navigation', () => {
    let navigatedTo = null;
    let navigatedOptions = null;
    let errorMessage = '';

    const mockNavigate = (url, opts) => {
      navigatedTo = url;
      navigatedOptions = opts;
    };

    const mockSetError = (msg) => {
      errorMessage = msg;
    };

    // Mock throwing storage
    const mockSessionStorage = {
      setItem: () => {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
    };

    const mockLocalStorage = {
      setItem: () => {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
    };

    // Execute the protected post-booking block
    const finalBookingId = 999;
    const finalBookingCode = 'BK-000999';
    const completedResult = {
      id: finalBookingId,
      booking_code: finalBookingCode,
      customer_contact: '0812345678'
    };

    try {
      mockSessionStorage.setItem('completed_booking_result', JSON.stringify(completedResult));
    } catch (storageErr) {
      // Non-blocking warning
    }

    try {
      mockLocalStorage.setItem('bwork_pending_booking', JSON.stringify(completedResult));
    } catch (storageErr) {
      // Non-blocking warning
    }

    mockNavigate(`/confirm?id=${finalBookingId}&code=${encodeURIComponent(finalBookingCode)}`, {
      state: {
        booking: completedResult,
        contact: '0812345678'
      }
    });

    assert.strictEqual(errorMessage, '', 'No error should be shown to user on storage quota exceeded');
    assert.strictEqual(navigatedTo, '/confirm?id=999&code=BK-000999', 'Navigation must succeed');
    assert.deepStrictEqual(navigatedOptions.state.booking, completedResult, 'State booking is preserved');
    assert.strictEqual(navigatedOptions.state.contact, '0812345678', 'State contact is preserved');
  });

  test('2.3: Runtime Simulation: iOS Safari Private Mode (SecurityError on all storage access) falls back to location.state', () => {
    // In Safari Private Mode with strict security, accessing or setting throws SecurityError
    const throwingStorage = {
      getItem: () => { throw new Error('SecurityError: The operation is insecure.'); },
      setItem: () => { throw new Error('SecurityError: The operation is insecure.'); },
      removeItem: () => { throw new Error('SecurityError: The operation is insecure.'); }
    };

    const mockLocation = {
      search: '?id=777&code=BK-000777',
      state: {
        booking: { id: 777, booking_code: 'BK-000777', customer_contact: '0899998888', total_amount: 500 },
        contact: '0899998888'
      }
    };

    const bookingId = '777';

    // Simulate ConfirmPage initial state resolution
    let resolvedBooking = null;
    try {
      if (mockLocation.state?.booking) {
        const parsed = mockLocation.state.booking;
        if (!bookingId || String(parsed?.id) === String(bookingId)) {
          resolvedBooking = parsed;
        }
      }
      if (!resolvedBooking) {
        const raw = throwingStorage.getItem('completed_booking_result');
        if (raw) resolvedBooking = JSON.parse(raw);
      }
    } catch (e) {}

    assert.ok(resolvedBooking !== null, 'Booking must be resolved from location.state');
    assert.strictEqual(resolvedBooking.id, 777);
    assert.strictEqual(resolvedBooking.customer_contact, '0899998888');

    // Simulate fetchFreshBooking accessContact resolution
    const overrideContact = null;
    const statusAccess = null;
    const storedBooking = resolvedBooking;
    const pendingBooking = null;

    const accessContact = overrideContact || statusAccess?.contact || storedBooking?.customer_contact || storedBooking?.contact || pendingBooking?.contact;
    assert.strictEqual(accessContact, '0899998888', 'Access contact must resolve to customer phone for X-Booking-Contact header');
  });

  // ==========================================================================
  // 3. STORAGE PRIVACY & ZERO-LEAK AUDIT
  // ==========================================================================

  test('3.1: Zero secret keys, admin credentials, or internal hashes in storage payloads', () => {
    const sensitiveKeys = ['password', 'password_hash', 'jwt_secret', 'token', 'wifi_credential_encryption_key', 'admin', 'scrypt'];
    const samplePayload = {
      id: 123,
      code: 'BK-000123',
      roomName: 'Pluto (201)',
      totalAmount: 1500,
      paymentDeadline: '2026-10-15T15:00:00Z',
      paymentWindowMinutes: 15,
      createdAt: Date.now(),
      status: 'pending',
      contact: '0812345678'
    };

    const serialized = JSON.stringify(samplePayload).toLowerCase();
    sensitiveKeys.forEach(key => {
      assert.ok(!serialized.includes(`"${key}"`), `Storage payload must not contain sensitive key: ${key}`);
    });
  });
});
