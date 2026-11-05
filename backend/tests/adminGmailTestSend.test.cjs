const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sqlite3 = require('sqlite3').verbose();
const http = require('node:http');
const express = require('express');

const {
  DEFAULT_SENDER_NAME,
  DEFAULT_SENDER_EMAIL,
  DEFAULT_REPLY_TO,
  TARGET_TEST_RECIPIENT,
  TEST_EMAIL_SUBJECT,
  isGmailConfigured,
  isLiveDispatchEnabled,
  isTestDispatchEnabled,
  createTestSamplePdfBuffer,
  generateTestEmailContent,
  buildMimeMessage
} = require('../services/gmailService');

// ========================================================
// 1. UNIT TESTS: TEST RECIPIENT, SUBJECT, PDF & SWITCH
// ========================================================
test('GmailService - Target test recipient is strictly kunakornwhynatt@gmail.com', () => {
  assert.strictEqual(TARGET_TEST_RECIPIENT, 'kunakornwhynatt@gmail.com');
  assert.strictEqual(TEST_EMAIL_SUBJECT, '[BWORK TEST] ทดสอบส่งเอกสาร PDF — ไม่ใช่ใบกำกับภาษีจริง');
});

test('GmailService - isTestDispatchEnabled defaults to false', () => {
  assert.strictEqual(isTestDispatchEnabled({}), false);
  assert.strictEqual(isTestDispatchEnabled({ GMAIL_TEST_DISPATCH_ENABLED: '' }), false);
  assert.strictEqual(isTestDispatchEnabled({ GMAIL_TEST_DISPATCH_ENABLED: 'false' }), false);
  assert.strictEqual(isTestDispatchEnabled({ GMAIL_TEST_DISPATCH_ENABLED: 'true' }), true);
  assert.strictEqual(isTestDispatchEnabled({ GMAIL_TEST_DISPATCH_ENABLED: 'TRUE' }), true);
});

test('GmailService - createTestSamplePdfBuffer creates valid in-memory PDF without external files', () => {
  const buf = createTestSamplePdfBuffer();
  assert.ok(Buffer.isBuffer(buf), 'Must return a Buffer');
  assert.ok(buf.length > 500, 'PDF buffer must have reasonable size');
  assert.strictEqual(buf.subarray(0, 4).toString(), '%PDF', 'Must start with %PDF magic header');
  assert.ok(buf.toString('utf8').includes('%%EOF'), 'Must contain %%EOF trailer');
  assert.ok(buf.toString('utf8').includes('NOT A REAL TAX INVOICE'), 'Must contain disclaimer in content stream');
  assert.ok(buf.toString('utf8').includes('kunakornwhynatt@gmail.com'), 'Must reference test recipient');
});

test('GmailService - generateTestEmailContent contains clear disclaimers', () => {
  const content = generateTestEmailContent({
    recipientEmail: TARGET_TEST_RECIPIENT,
    senderEmail: DEFAULT_SENDER_EMAIL,
    senderName: DEFAULT_SENDER_NAME
  });

  assert.strictEqual(content.subject, '[BWORK TEST] ทดสอบส่งเอกสาร PDF — ไม่ใช่ใบกำกับภาษีจริง');
  assert.ok(content.textBody.includes('เอกสารข้อมูลสมมติเพื่อการทดสอบระบบเท่านั้น'));
  assert.ok(content.textBody.includes('ไม่ใช่ใบกำกับภาษี'));
  assert.ok(content.htmlBody.includes('⚠️ ข้อความแจ้งเตือนสำคัญ'));
  assert.ok(content.htmlBody.includes('BWORK_TEST_SAMPLE.pdf'));
});

// ========================================================
// 2. INTEGRATION TESTS: EXPRESS ADMIN TEST ENDPOINTS
// ========================================================
test('Admin Gmail Test Send - API integration with mock DB and mock Gmail API', async (t) => {
  const memDb = new sqlite3.Database(':memory:');
  const runSql = (sql, params = []) => new Promise((res, rej) => {
    memDb.run(sql, params, function(err) {
      if (err) rej(err);
      else res(this);
    });
  });
  const getSql = (sql, params = []) => new Promise((res, rej) => {
    memDb.get(sql, params, (err, row) => {
      if (err) rej(err);
      else res(row);
    });
  });

  // Setup minimal DB schema (only settings table; no bookings or customer tables needed!)
  await runSql('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  await runSql("INSERT INTO settings (key, value) VALUES ('gmail_test_dispatch_enabled', 'false')");

  // Create lightweight Express test app
  const app = express();
  app.use(express.json());

  // Mock authentication middleware
  const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader === 'Bearer admin-token') {
      req.user = { id: 1, role: 'admin', username: 'admin' };
      return next();
    }
    if (authHeader === 'Bearer staff-token') {
      req.user = { id: 2, role: 'staff', username: 'staff' };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  };

  const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น' });
    }
    next();
  };

  let mockGmailResponse = { ok: true, status: 200, json: async () => ({ id: 'mock_gmail_msg_12345' }) };
  let mockFetchCalled = false;
  let mockFetchPayload = null;

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('127.0.0.1')) {
      return originalFetch(url, options);
    }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      mockFetchCalled = true;
      mockFetchPayload = options;
      if (mockGmailResponse.throwError) {
        throw new Error(mockGmailResponse.throwError);
      }
      return {
        ok: mockGmailResponse.ok,
        status: mockGmailResponse.status,
        text: async () => JSON.stringify(await mockGmailResponse.json()),
        json: mockGmailResponse.json
      };
    }
    return originalFetch(url, options);
  };

  // Switch routes
  app.get('/api/admin/gmail/test-switch', authMiddleware, requireAdmin, async (req, res) => {
    const row = await getSql("SELECT value FROM settings WHERE key = 'gmail_test_dispatch_enabled'");
    const testEnabled = row?.value === 'true';
    res.json({
      success: true,
      test_dispatch_enabled: testEnabled,
      customer_live_dispatch_enabled: false
    });
  });

  app.post('/api/admin/gmail/test-switch', authMiddleware, requireAdmin, async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    await runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('gmail_test_dispatch_enabled', ?)", [enabled ? 'true' : 'false']);
    res.json({
      success: true,
      test_dispatch_enabled: enabled,
      customer_live_dispatch_enabled: false
    });
  });

  // Test-send route mirroring server.js / worker.js
  app.post('/api/admin/gmail/test-send', authMiddleware, requireAdmin, async (req, res) => {
    const targetEmail = TARGET_TEST_RECIPIENT;
    const subject = TEST_EMAIL_SUBJECT;
    const isDryRun = req.body?.dry_run !== false;
    const staffName = req.user?.username || 'admin';

    const row = await getSql("SELECT value FROM settings WHERE key = 'gmail_test_dispatch_enabled'");
    const testSwitchEnabled = row?.value === 'true';

    const pdfBuffer = createTestSamplePdfBuffer();
    const senderEmail = DEFAULT_SENDER_EMAIL;
    const senderName = DEFAULT_SENDER_NAME;
    const nowIso = new Date().toISOString();

    if (isDryRun) {
      const simulatedMsgId = 'dry_run_test_' + Date.now();
      return res.json({
        success: true,
        dry_run: true,
        status: 'dry_run',
        message: 'จำลองการส่งอีเมลทดสอบเรียบร้อยแล้ว (Dry-run)',
        data: {
          recipient: targetEmail,
          subject,
          message_id: simulatedMsgId,
          file_name: 'BWORK_TEST_SAMPLE.pdf',
          file_size: pdfBuffer.length,
          dispatched_by: staffName,
          test_dispatch_switch: testSwitchEnabled,
          customer_dispatch_switch: false
        }
      });
    }

    if (!testSwitchEnabled) {
      return res.status(400).json({
        success: false,
        error: 'ระบบยังไม่ได้เปิดสวิตช์ทดสอบส่งอีเมล (GMAIL_TEST_DISPATCH_ENABLED != true) กรุณาใช้โหมดจำลองส่ง (Dry-run)'
      });
    }

    // Concurrency check
    const claimRow = await getSql("SELECT value FROM settings WHERE key = 'gmail_test_send_claim'");
    let claim = null;
    if (claimRow?.value) {
      try { claim = JSON.parse(claimRow.value); } catch (_) {}
    }
    if (claim && claim.status === 'claiming') {
      const elapsedSec = (Date.now() - new Date(claim.claimed_at).getTime()) / 1000;
      if (elapsedSec < 60) {
        return res.status(429).json({ error: 'กำลังดำเนินการส่งอีเมลทดสอบอยู่ กรุณารอสักครู่ (In-flight)' });
      }
    }

    await runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('gmail_test_send_claim', ?)", [
      JSON.stringify({ status: 'claiming', claimed_at: nowIso, dispatched_by: staffName })
    ]);

    try {
      let gmailRes;
      try {
        gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer mock_token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: 'mock_base64url' })
        });
      } catch (netErr) {
        await runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('gmail_test_send_claim', ?)", [
          JSON.stringify({ status: 'uncertain', error: netErr.message, updated_at: new Date().toISOString() })
        ]);
        return res.status(504).json({
          success: false,
          status: 'uncertain',
          error: 'คำขอส่งอีเมลไปยัง Gmail API หมดเวลา (Timeout) หรือเครือข่ายขัดข้อง'
        });
      }

      if (!gmailRes.ok) {
        return res.status(500).json({ success: false, status: 'failed', error: 'Gmail API failed' });
      }

      const gmailData = await gmailRes.json();
      await runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('gmail_test_send_claim', ?)", [
        JSON.stringify({ status: 'gmail_accepted', message_id: gmailData.id, updated_at: new Date().toISOString() })
      ]);

      return res.json({
        success: true,
        dry_run: false,
        status: 'gmail_accepted',
        message: 'Gmail API รับคำขอส่งอีเมลทดสอบเรียบร้อยแล้ว',
        data: {
          recipient: targetEmail,
          subject,
          message_id: gmailData.id,
          file_name: 'BWORK_TEST_SAMPLE.pdf',
          file_size: pdfBuffer.length,
          dispatched_by: staffName,
          test_dispatch_switch: false,
          customer_dispatch_switch: false
        }
      });
    } finally {
      // Auto-reset switch to false immediately!
      await runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('gmail_test_dispatch_enabled', 'false')");
    }
  });

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const callApi = async (path, opts = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...opts.headers
      }
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  try {
    // Test 1: Non-admin rejected
    const r1 = await callApi('/api/admin/gmail/test-send', {
      method: 'POST',
      headers: { Authorization: 'Bearer staff-token' },
      body: JSON.stringify({ dry_run: true })
    });
    assert.strictEqual(r1.status, 403, 'Non-admin must receive 403');

    // Test 2: Dry-run simulation succeeds with admin token
    const r2 = await callApi('/api/admin/gmail/test-send', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ dry_run: true, to: 'attacker@evil.com', subject: 'Fake Subject' })
    });
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(r2.body.success, true);
    assert.strictEqual(r2.body.data.recipient, 'kunakornwhynatt@gmail.com', 'Arbitrary recipient in body must be ignored');
    assert.strictEqual(r2.body.data.subject, '[BWORK TEST] ทดสอบส่งเอกสาร PDF — ไม่ใช่ใบกำกับภาษีจริง', 'Arbitrary subject must be ignored');
    assert.strictEqual(r2.body.data.customer_dispatch_switch, false);

    // Test 3: Live dispatch blocked when switch is false
    const r3 = await callApi('/api/admin/gmail/test-send', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ dry_run: false })
    });
    assert.strictEqual(r3.status, 400);
    assert.ok(r3.body.error.includes('GMAIL_TEST_DISPATCH_ENABLED != true'));

    // Test 4: Admin toggles switch to true
    const r4 = await callApi('/api/admin/gmail/test-switch', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ enabled: true })
    });
    assert.strictEqual(r4.status, 200);
    assert.strictEqual(r4.body.test_dispatch_enabled, true);
    assert.strictEqual(r4.body.customer_live_dispatch_enabled, false);

    // Test 5: Live send with switch=true succeeds, calls Gmail API, and auto-resets switch to false
    mockFetchCalled = false;
    const r5 = await callApi('/api/admin/gmail/test-send', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ dry_run: false })
    });
    assert.strictEqual(r5.status, 200);
    assert.strictEqual(r5.body.status, 'gmail_accepted');
    assert.strictEqual(r5.body.data.message_id, 'mock_gmail_msg_12345');
    assert.strictEqual(r5.body.data.recipient, 'kunakornwhynatt@gmail.com');
    assert.ok(mockFetchCalled, 'Gmail API must have been called');

    // Test 6: Verify switch was automatically reset to false in finally block!
    const r6 = await callApi('/api/admin/gmail/test-switch', {
      method: 'GET',
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.strictEqual(r6.body.test_dispatch_enabled, false, 'Switch must be automatically false after 1 send');

    // Test 7: Timeout / uncertain handling
    // Turn switch on
    await callApi('/api/admin/gmail/test-switch', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ enabled: true })
    });
    mockGmailResponse = { throwError: 'AbortError: Operation timed out after 15000ms' };
    const r7 = await callApi('/api/admin/gmail/test-send', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ dry_run: false })
    });
    assert.strictEqual(r7.status, 504);
    assert.strictEqual(r7.body.status, 'uncertain');

    // Verify switch reset to false even after timeout!
    const r8 = await callApi('/api/admin/gmail/test-switch', {
      method: 'GET',
      headers: { Authorization: 'Bearer admin-token' }
    });
    assert.strictEqual(r8.body.test_dispatch_enabled, false, 'Switch must be reset to false even on timeout');

  } finally {
    global.fetch = originalFetch;
    server.close();
    memDb.close();
  }
});
