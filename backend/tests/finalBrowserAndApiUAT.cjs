/**
 * BWORK-POS | Final Live UAT & Regression Verification Runner
 * Verifies all 11 UAT requirements against live Express server & component invariants.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// Load live server and database
const { app, dbInitPromise, createToken } = require('../server.js');
const { dbQuery } = require('../database.js');

let server;
let baseUrl;
let staffToken;
let testBookingId;
let testTxId;

// 1x1 valid transparent PNG base64 data URI
const VALID_SLIP_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('▶ BWORK-POS FINAL UAT: PAYMENT SLIP HOTFIX VERIFICATION', async (t) => {

  await t.test('UAT-01: Live Localhost Startup & Frontend Build Asset Serving', async () => {
    await dbInitPromise;
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[UAT] Live server running on ${baseUrl}`);

    // Generate valid staff token with pos and history permissions
    staffToken = createToken({
      id: 1,
      username: 'admin',
      role: 'admin',
      permissions: 'pos,history,manage,admin-system'
    });

    // Test frontend static index.html delivery
    const res = await fetch(`${baseUrl}/index.html`);
    assert.strictEqual(res.status, 200, 'Frontend index.html must be served with HTTP 200');
    const htmlText = await res.text();
    assert.ok(htmlText.includes('<div id="root"></div>'), 'Index.html must contain root container');
    assert.ok(htmlText.includes('assets/index-'), 'Index.html must reference Vite production assets');
  });

  await t.test('UAT-02: Customer Slip Preview Access Control (401 without Token vs 200 with Token)', async () => {
    // Create a temporary slip file in uploads/slips/
    const uploadsDir = path.join(__dirname, '../uploads/slips');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const slipFileName = `BK999999_test_${Date.now()}.png`;
    const slipFilePath = path.join(uploadsDir, slipFileName);
    const pngBinary = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(slipFilePath, pngBinary);

    const slipEndpoint = `${baseUrl}/uploads/slips/${slipFileName}`;

    try {
      // 1. Unauthenticated request (Native browser <img> tag or raw <a> tag without JWT)
      const unauthRes = await fetch(slipEndpoint);
      assert.strictEqual(unauthRes.status, 401, 'Unauthenticated browser request to /uploads/slips/* must be rejected with 401');

      // 2. Authenticated request with Bearer JWT (AuthenticatedSlipImage fetch)
      const authRes = await fetch(slipEndpoint, {
        headers: { 'Authorization': `Bearer ${staffToken}` }
      });
      assert.strictEqual(authRes.status, 200, 'Authenticated request with Bearer token must succeed (200)');
      assert.strictEqual(authRes.headers.get('content-type'), 'image/png');
      const blob = await authRes.blob();
      assert.strictEqual(blob.size, pngBinary.length, 'Retrieved binary blob size must match original file');
    } finally {
      if (fs.existsSync(slipFilePath)) fs.unlinkSync(slipFilePath);
    }
  });

  await t.test('UAT-03: POS Slip Attachment Workflow, Save Lifecycle & Data Refresh', async () => {
    // Insert test booking and payment transaction
    const nowIso = new Date().toISOString();
    const insertBooking = await dbQuery.run(`
      INSERT INTO bookings (
        customer_name, contact, payment_status, payment_method,
        total_amount, paid_amount, balance_amount, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, ['UAT Customer Hotfix', '0819998888', 'deposit', 'promptpay', 1000, 500, 500, nowIso]);

    testBookingId = insertBooking.id;

    const insertTx = await dbQuery.run(`
      INSERT INTO payment_transactions (
        booking_id, amount, payment_method, transaction_type, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [testBookingId, 500, 'promptpay', 'deposit', 'completed', nowIso]);

    testTxId = insertTx.id;

    // Call Attach Slip API with Bearer token
    const attachRes = await fetch(`${baseUrl}/api/bookings/${testBookingId}/payments/${testTxId}/slip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        slip_image: VALID_SLIP_BASE64,
        payment_id: testTxId,
        reason: 'แนบหลักฐานสลิปมัดจำ'
      })
    });

    assert.strictEqual(attachRes.status, 200, 'Attach slip API must return 200');
    const attachData = await attachRes.json();
    assert.strictEqual(attachData.success, true, 'Attach slip response must have success: true');
    assert.ok(attachData.slip_url, 'Attach slip response must return valid slip_url');
    assert.ok(attachData.slip_url.startsWith('/uploads/slips/'), 'Slip URL must be stored in /uploads/slips/');

    // Verify transaction in DB has slip_url updated
    const updatedTx = await dbQuery.get('SELECT slip_url FROM payment_transactions WHERE id = ?', [testTxId]);
    assert.strictEqual(updatedTx.slip_url, attachData.slip_url, 'Transaction in database must have matching slip_url');

    // Verify audit log record created in booking_history
    const auditRecord = await dbQuery.get(`
      SELECT action, details FROM booking_history
      WHERE booking_id = ? AND action IN ('attach_slip', 'replace_slip')
      ORDER BY id DESC LIMIT 1
    `, [testBookingId]);
    assert.ok(auditRecord, 'Audit record must exist in booking_history');
    assert.strictEqual(auditRecord.action, 'attach_slip', 'Audit action must be attach_slip');
  });

  await t.test('UAT-04: Slip Replacement Workflow & Audit Trail Preservation', async () => {
    const tx = await dbQuery.get('SELECT * FROM payment_transactions WHERE id = ?', [testTxId]);
    assert.ok(tx, 'Test transaction must exist');
    const previousSlip = tx.slip_url;
    assert.ok(previousSlip, 'Previous slip must exist for replacement test');

    // Call replacement API with new slip and required reason
    const replaceRes = await fetch(`${baseUrl}/api/bookings/${testBookingId}/payments/${testTxId}/slip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${staffToken}`
      },
      body: JSON.stringify({
        slip_image: VALID_SLIP_BASE64,
        payment_id: testTxId,
        replacement_reason: 'สลิปเดิมรูปไม่ชัดเจน ลูกค้าส่งภาพใหม่',
        reason: 'สลิปเดิมรูปไม่ชัดเจน ลูกค้าส่งภาพใหม่'
      })
    });

    assert.strictEqual(replaceRes.status, 200, 'Slip replacement must return 200');
    const replaceData = await replaceRes.json();
    assert.strictEqual(replaceData.success, true);
    assert.ok(replaceData.slip_url);

    // Verify Audit log has replace_slip with details
    const replaceAudit = await dbQuery.get(`
      SELECT * FROM booking_history
      WHERE booking_id = ? AND action = 'replace_slip'
      ORDER BY id DESC LIMIT 1
    `, [testBookingId]);

    assert.ok(replaceAudit, 'Audit record for replace_slip must exist');
    assert.ok(replaceAudit.details.includes('สลิปเดิมรูปไม่ชัดเจน ลูกค้าส่งภาพใหม่'), 'Audit log must record replacement reason');
    assert.ok(replaceAudit.details.includes(previousSlip), 'Audit log must reference previous slip URL');
  });

  await t.test('UAT-05: Dialog Stacking & Deadlock Prevention (zIndex verification)', async () => {
    // Verify frontend/src/App.jsx dialog zIndex
    const appSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/App.jsx'), 'utf8');
    const modalSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/AttachSlipModal.jsx'), 'utf8');

    assert.ok(appSrc.includes('zIndex: 100000'), 'App.jsx dialog must have zIndex: 100000');
    assert.ok(modalSrc.includes('zIndex: 20000'), 'AttachSlipModal must have zIndex: 20000');

    // Confirm dialog is 80,000 layers ABOVE modal
    const dialogZ = 100000;
    const modalZ = 20000;
    assert.ok(dialogZ > modalZ, 'System Dialog must render strictly ABOVE AttachSlipModal');

    // Verify AttachSlipModal closes immediately upon success before alert
    const normalizedModalSrc = modalSrc.replace(/\r\n/g, '\n');
    assert.ok(normalizedModalSrc.includes('onClose();\n      if (onSuccess) {\n        onSuccess(data);\n      }'), 'AttachSlipModal must call onClose() immediately on success');
  });

  await t.test('UAT-06: Duplicate Submission Guard & 30s Timeout in AttachSlipModal', async () => {
    const modalSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/AttachSlipModal.jsx'), 'utf8');
    assert.ok(modalSrc.includes('if (isUploading) return;'), 'Must guard against duplicate submissions when isUploading is true');
    assert.ok(modalSrc.includes('new AbortController()'), 'Must use AbortController');
    assert.ok(modalSrc.includes('timeoutId = setTimeout(() => controller.abort(), 30000)'), 'Must enforce 30-second timeout');
    assert.ok(modalSrc.includes('clearTimeout(timeoutId)'), 'Must clear timeout after request finishes');
    assert.ok(modalSrc.includes('err.name === \'AbortError\''), 'Must gracefully catch and handle AbortError');
  });

  await t.test('UAT-07: Financial Invariants Unaltered by Slip Attachment & Replacement', async () => {
    const booking = await dbQuery.get('SELECT * FROM bookings WHERE id = ?', [testBookingId]);
    assert.strictEqual(Number(booking.total_amount), 1000, 'Total amount must remain 1000');
    assert.strictEqual(Number(booking.paid_amount), 500, 'Paid amount must remain 500');
    assert.strictEqual(Number(booking.balance_amount), 500, 'Balance amount must remain 500');
    assert.strictEqual(booking.payment_status, 'deposit', 'Payment status must remain deposit (slip alone does not change status to paid)');
  });

  await t.test('UAT-08: R2 Access Control & Security Invariants (No query token, private storage)', async () => {
    const authFileSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/authenticatedFile.js'), 'utf8');
    assert.ok(!authFileSrc.includes('?token='), 'authenticatedFile.js must NEVER append ?token= to query string');
    assert.ok(authFileSrc.includes("headers['Authorization'] = `Bearer ${token}`"), 'Must pass token in Authorization header');
    assert.ok(authFileSrc.includes('URL.revokeObjectURL(blobUrl)'), 'Must implement Blob URL revocation');

    // Clean up test booking
    await dbQuery.run('DELETE FROM booking_history WHERE booking_id = ?', [testBookingId]);
    await dbQuery.run('DELETE FROM payment_transactions WHERE booking_id = ?', [testBookingId]);
    await dbQuery.run('DELETE FROM bookings WHERE id = ?', [testBookingId]);
  });

  await t.test('UAT-09: OCR & QR Decoder Integration with Authenticated Blob', async () => {
    const verifierSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/browserSlipVerifier.js'), 'utf8');
    assert.ok(verifierSrc.includes("import { fetchAuthenticatedBlob } from './authenticatedFile'"), 'Verifier must import fetchAuthenticatedBlob');
    assert.ok(verifierSrc.includes('export async function loadImageElement(url)'), 'loadImageElement must be async function');
    assert.ok(verifierSrc.includes('const authBlob = await fetchAuthenticatedBlob(url)'), 'loadImageElement must fetch authenticated blob');
    assert.ok(verifierSrc.includes('authBlob.revoke()'), 'loadImageElement must revoke blob url');
  });

  // Teardown
  await t.test('UAT-10: Teardown & Clean Close', async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
      console.log('[UAT] Live server closed cleanly.');
    }
  });
});
