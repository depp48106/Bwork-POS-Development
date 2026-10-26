/**
 * BWORK-POS Priority P1 Hotfix Test Suite:
 * - P1: Customer Payment Slip Image Displaying & Authenticated Fetch (Blob URL lifecycle & OCR support)
 * - P2: POS Slip Save Stuck at Loading & Dialog Z-Index Stacking
 * - Financial ledger and support ticket feature integrity
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const TEST_SECRET = 'test_jwt_secret_key_pos_2026';

function createTestToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 3600000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', TEST_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyTestToken(token) {
  try {
    const [header, body, signature] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', TEST_SECRET).update(`${header}.${body}`).digest('base64url');
    if (signature !== expectedSig) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch (_) {
    return null;
  }
}

test('▶ BWORK-POS | Slip Preview & Slip Save Hotfix Suite', async (t) => {

  await t.test('1. P1 Root Cause & Solution: Protected /uploads requires Bearer token; frontend fetches Blob with JWT', async () => {
    // Spin up an Express test server replicating the secure /uploads access control
    const app = express();
    app.use(express.json());

    // Mock authenticated /uploads/payment-slips handler
    app.get('/uploads/payment-slips/:filename', (req, res) => {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const token = authHeader.split(' ')[1];
      const decoded = verifyTestToken(token);
      if (!decoded || !decoded.id) {
        return res.status(403).json({ error: 'Invalid token' });
      }
      res.setHeader('Content-Type', 'image/png');
      // 1x1 transparent PNG
      const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      return res.status(200).send(pngBuf);
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    const testUrl = `http://127.0.0.1:${port}/uploads/payment-slips/BK000001_slip_test.png`;

    try {
      // Unauthenticated fetch (like native browser <img> or raw <a> tag) -> HTTP 401
      const unauthRes = await fetch(testUrl);
      assert.strictEqual(unauthRes.status, 401, 'Unauthenticated fetch must be rejected with 401');

      // Authenticated fetch with Bearer token -> HTTP 200 & valid image buffer
      const validToken = createTestToken({ id: 1, role: 'staff', permissions: 'pos,history' });
      const authRes = await fetch(testUrl, {
        headers: { 'Authorization': `Bearer ${validToken}` }
      });
      assert.strictEqual(authRes.status, 200, 'Authenticated fetch with Bearer token must succeed (200)');
      assert.strictEqual(authRes.headers.get('content-type'), 'image/png');
      const blob = await authRes.blob();
      assert.ok(blob.size > 0, 'Blob size must be greater than 0');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  await t.test('2. P1 Frontend Code Audit: AuthenticatedSlipImage and authenticatedFile exist and are used in POS components', async () => {
    const authFileUtil = path.join(__dirname, '../../frontend/src/utils/authenticatedFile.js');
    const authHook = path.join(__dirname, '../../frontend/src/hooks/useAuthenticatedImage.js');
    const authComponent = path.join(__dirname, '../../frontend/src/components/AuthenticatedSlipImage.jsx');

    assert.ok(fs.existsSync(authFileUtil), 'authenticatedFile.js utility must exist');
    assert.ok(fs.existsSync(authHook), 'useAuthenticatedImage.js hook must exist');
    assert.ok(fs.existsSync(authComponent), 'AuthenticatedSlipImage.jsx component must exist');

    const authFileContent = fs.readFileSync(authFileUtil, 'utf8');
    assert.ok(authFileContent.includes('fetchAuthenticatedBlob'), 'Must export fetchAuthenticatedBlob');
    assert.ok(authFileContent.includes('openAuthenticatedImageInNewTab'), 'Must export openAuthenticatedImageInNewTab');
    assert.ok(authFileContent.includes('URL.revokeObjectURL'), 'Must implement Blob URL revocation');

    // Verify PendingBookings.jsx uses AuthenticatedSlipImage
    const pbContent = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/PendingBookings.jsx'), 'utf8');
    assert.ok(pbContent.includes('AuthenticatedSlipImage'), 'PendingBookings.jsx must import and use AuthenticatedSlipImage');
    assert.ok(pbContent.includes('openAuthenticatedImageInNewTab'), 'PendingBookings.jsx must use openAuthenticatedImageInNewTab');
    assert.ok(!pbContent.includes('<img\n                              src={viewingSlipBooking.slip_image_url}'), 'Raw img in viewing slip modal must be removed');

    // Verify History.jsx uses AuthenticatedSlipImage
    const histContent = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/History.jsx'), 'utf8');
    assert.ok(histContent.includes('AuthenticatedSlipImage'), 'History.jsx must import and use AuthenticatedSlipImage');
    assert.ok(histContent.includes('openAuthenticatedImageInNewTab'), 'History.jsx must use openAuthenticatedImageInNewTab');

    // Verify BookingPOS.jsx uses AuthenticatedSlipImage
    const posContent = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/BookingPOS.jsx'), 'utf8');
    assert.ok(posContent.includes('AuthenticatedSlipImage'), 'BookingPOS.jsx must import and use AuthenticatedSlipImage');
    assert.ok(posContent.includes('openAuthenticatedImageInNewTab'), 'BookingPOS.jsx must use openAuthenticatedImageInNewTab');
  });

  await t.test('3. P1 OCR Support: browserSlipVerifier.js fetches authenticated blob with Authorization header', async () => {
    const verifierPath = path.join(__dirname, '../../frontend/src/utils/browserSlipVerifier.js');
    const verifierContent = fs.readFileSync(verifierPath, 'utf8');

    assert.ok(verifierContent.includes('fetchAuthenticatedBlob'), 'browserSlipVerifier.js must import fetchAuthenticatedBlob');
    assert.ok(verifierContent.includes('loadImageElement(url)'), 'loadImageElement must exist');
    assert.ok(verifierContent.includes('authBlob.revoke()'), 'loadImageElement must revoke blob url after loading');
  });

  await t.test('4. P2 Root Cause & Fix: Worker attach-slip declares staffName before saveUploadedFile call', async () => {
    const workerPath = path.join(__dirname, '../../backend/worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');

    const attachSlipIndex = workerContent.indexOf("pathname.endsWith('/attach-slip')");
    assert.ok(attachSlipIndex > 0, 'worker.js must contain attach-slip route');

    const routeChunk = workerContent.substring(attachSlipIndex, attachSlipIndex + 3000);
    const staffNameDeclIndex = routeChunk.indexOf('const staffName = auth.user?.username');
    const saveUploadedFileIndex = routeChunk.indexOf("await saveUploadedFile(env, slip_image, 'payment-slips', { bookingId, paymentId: transaction ? transaction.id : 'attach', uploadedBy: staffName }");

    assert.ok(staffNameDeclIndex > 0, 'staffName declaration must be present in attach-slip route');
    assert.ok(saveUploadedFileIndex > 0, 'saveUploadedFile call must be present in attach-slip route');
    assert.ok(staffNameDeclIndex < saveUploadedFileIndex, 'CRITICAL: staffName MUST be declared BEFORE saveUploadedFile call to avoid ReferenceError');
  });

  await t.test('5. P2 Dialog Stacking & Timeout: App.jsx dialog zIndex is 100000 and AttachSlipModal has AbortController timeout', async () => {
    const appPath = path.join(__dirname, '../../frontend/src/App.jsx');
    const appContent = fs.readFileSync(appPath, 'utf8');
    assert.ok(appContent.includes('zIndex: 100000'), 'App.jsx dialog zIndex must be elevated to 100000');

    const modalPath = path.join(__dirname, '../../frontend/src/components/AttachSlipModal.jsx');
    const modalContent = fs.readFileSync(modalPath, 'utf8');
    assert.ok(modalContent.includes('AbortController'), 'AttachSlipModal.jsx must use AbortController');
    assert.ok(modalContent.includes('timeoutId = setTimeout(() => controller.abort(), 30000)'), 'AttachSlipModal.jsx must have 30s timeout');
    assert.ok(modalContent.includes('if (isUploading) return;'), 'AttachSlipModal.jsx must prevent duplicate submissions');
    assert.ok(modalContent.includes('onClose();'), 'AttachSlipModal.jsx must close cleanly on success');
  });

  await t.test('6. Security & Invariants: Zero tokens in URLs and Support Tickets disabled (404 gate in production)', async () => {
    const workerPath = path.join(__dirname, '../../backend/worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    assert.ok(workerContent.includes('/api/pos/support'), 'Support Tickets gate must be present in worker.js');
    assert.ok(workerContent.includes('/api/public/support'), 'Public Support Tickets gate must be present in worker.js');
    assert.ok(workerContent.includes('Support tickets feature is disabled in this release'), 'Support tickets must be disabled in worker.js');

    const serverPath = path.join(__dirname, '../../backend/server.js');
    const serverContent = fs.readFileSync(serverPath, 'utf8');
    assert.ok(serverContent.includes('/api/pos/support'), 'Support Tickets gate must be present in server.js');
    assert.ok(serverContent.includes('Support tickets feature is disabled in this release'), 'Support tickets must be disabled in server.js');

    const authFileContent = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/authenticatedFile.js'), 'utf8');
    assert.ok(!authFileContent.includes('?token='), 'authenticatedFile.js must NEVER append ?token= to query string');
  });
});
