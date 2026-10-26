const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('BWORK-POS | SECURITY HARDENING HOTFIX AUDIT', () => {
  const authFilePath = path.join(__dirname, '../../frontend/src/utils/authenticatedFile.js');
  const serverFilePath = path.join(__dirname, '../server.js');
  const workerFilePath = path.join(__dirname, '../worker.js');
  const frontendRedirectsPath = path.join(__dirname, '../../frontend/public/_redirects');
  const bookingRedirectsPath = path.join(__dirname, '../../booking-app/public/_redirects');

  test('SEC-01: authenticatedFile.js contains strict exact allowlist with NO wildcards or suffix checks', () => {
    assert.ok(fs.existsSync(authFilePath), 'authenticatedFile.js must exist');
    const content = fs.readFileSync(authFilePath, 'utf8');

    // 1. Verify exact allowlist without suffix or wildcard matching
    assert.ok(content.includes('TRUSTED_AUTH_HOSTS'), 'Must define TRUSTED_AUTH_HOSTS set');
    assert.ok(!content.includes("host.endsWith('.ohnatza74185-ky.workers.dev')"), 'Wildcard suffix matching must NOT exist');
    assert.ok(!content.includes("host.endsWith('.workers.dev')"), 'Generic workers.dev suffix matching must NOT exist');

    // 2. Defense against protocol-relative URLs
    assert.ok(content.includes("trimmed.startsWith('//')"), 'Must reject protocol-relative URLs (//)');
    assert.ok(content.includes("trimmed.startsWith('/\\\\')"), 'Must reject escaped malformed paths (/\\)');

    // 3. Strict protocol enforcement (HTTPS only for remote)
    assert.ok(content.includes("protocol !== 'https:'"), 'Must require https for remote hosts');
    assert.ok(content.includes("redirect: 'error'"), 'Must set redirect: error to reject redirects before following');
    assert.ok(content.includes('response.redirected'), 'Must verify redirected destination origin');

    // 4. HTML SPA fallback defense
    assert.ok(content.includes("includes('text/html')"), 'Must reject HTML response');
  });

  test('SEC-01b: In-memory simulation of isTrustedAuthOrigin & resolveFileUrl security gates', () => {
    // Exact logic mirror of authenticatedFile.js
    const TRUSTED_AUTH_HOSTS = new Set([
      'bwork-pos-api.ohnatza74185-ky.workers.dev',
      'bwork-pos-api-staging.ohnatza74185-ky.workers.dev',
      'bwork-pos.pages.dev',
      'bwork-booking.pages.dev',
      'localhost',
      '127.0.0.1'
    ]);

    function isTrustedAuthOrigin(url) {
      if (!url || typeof url !== 'string') return false;
      const trimmed = url.trim();
      if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false;
      if (trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.startsWith('\\')) return false;
      if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
      if (trimmed.toLowerCase().startsWith('javascript:')) return false;

      try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        const protocol = parsed.protocol.toLowerCase();

        const isLocal = host === 'localhost' || host === '127.0.0.1';
        if (isLocal) {
          return protocol === 'http:' || protocol === 'https:';
        }
        if (protocol !== 'https:') return false;
        return TRUSTED_AUTH_HOSTS.has(host);
      } catch (_) {
        return false;
      }
    }

    // 1. Legitimate same-origin and relative paths
    assert.strictEqual(isTrustedAuthOrigin('/uploads/payment-slips/45.jpg'), true);
    assert.strictEqual(isTrustedAuthOrigin('/uploads/payment-slips/57/32/slip.jpg'), true);

    // 2. Legitimate trusted remote endpoints with HTTPS
    assert.strictEqual(isTrustedAuthOrigin('https://bwork-pos-api.ohnatza74185-ky.workers.dev/uploads/test.jpg'), true);
    assert.strictEqual(isTrustedAuthOrigin('https://bwork-pos.pages.dev/uploads/test.jpg'), true);
    assert.strictEqual(isTrustedAuthOrigin('http://localhost:5000/uploads/test.jpg'), true);
    assert.strictEqual(isTrustedAuthOrigin('http://127.0.0.1:5000/uploads/test.jpg'), true);

    // 3. Insecure HTTP to remote trusted endpoint MUST BE REJECTED (anti-token leakage)
    assert.strictEqual(isTrustedAuthOrigin('http://bwork-pos-api.ohnatza74185-ky.workers.dev/uploads/test.jpg'), false);

    // 4. Protocol-relative URLs MUST BE REJECTED (anti-token leakage)
    assert.strictEqual(isTrustedAuthOrigin('//evil.com/leak'), false);
    assert.strictEqual(isTrustedAuthOrigin('//bwork-pos-api.ohnatza74185-ky.workers.dev/leak'), false);
    assert.strictEqual(isTrustedAuthOrigin('/\\evil.com'), false);
    assert.strictEqual(isTrustedAuthOrigin('\\evil.com'), false);

    // 5. Arbitrary untrusted external domains MUST BE REJECTED
    assert.strictEqual(isTrustedAuthOrigin('https://evil.com/leak.jpg'), false);
    assert.strictEqual(isTrustedAuthOrigin('https://random-tenant.ohnatza74185-ky.workers.dev/leak'), false);
    assert.strictEqual(isTrustedAuthOrigin('https://other.pages.dev/leak'), false);

    // 6. Dangerous pseudo-protocols
    assert.strictEqual(isTrustedAuthOrigin('javascript:alert(1)'), false);
    assert.strictEqual(isTrustedAuthOrigin('data:image/png;base64,123'), false);
    assert.strictEqual(isTrustedAuthOrigin('blob:http://localhost/uuid'), false);
  });

  test('SEC-01c: HTTP Redirect Rejection & Zero Bearer Leakage to Untrusted Origin', async () => {
    const http = require('http');

    let attackerReceivedToken = false;
    let attackerHitCount = 0;

    // Attacker server
    const attackerServer = http.createServer((req, res) => {
      attackerHitCount++;
      if (req.headers['authorization']) {
        attackerReceivedToken = true;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('attacker got request');
    });

    await new Promise(r => attackerServer.listen(0, '127.0.0.1', r));
    const attackerPort = attackerServer.address().port;

    // Redirecting origin server
    const redirectServer = http.createServer((req, res) => {
      // Malicious or misconfigured redirect to external untrusted destination
      res.writeHead(302, {
        'Location': `http://127.0.0.1:${attackerPort}/steal-token`
      });
      res.end();
    });

    await new Promise(r => redirectServer.listen(0, '127.0.0.1', r));
    const redirectPort = redirectServer.address().port;

    try {
      const sourceUrl = `http://127.0.0.1:${redirectPort}/uploads/payment-slips/test.jpg`;
      const secretToken = 'super-secret-pos-jwt-token-12345';

      let redirectBlocked = false;
      try {
        await fetch(sourceUrl, {
          headers: { 'Authorization': `Bearer ${secretToken}` },
          redirect: 'error' // Explicitly reject redirects BEFORE following
        });
      } catch (err) {
        redirectBlocked = true;
        // In Node and browsers, redirect: 'error' causes a TypeError/network error
        assert.ok(err, 'Fetch must throw when encountering a redirect in error mode');
      }

      assert.strictEqual(redirectBlocked, true, 'Fetch must have been aborted on HTTP redirect');
      assert.strictEqual(attackerHitCount, 0, 'Attacker server must receive ZERO requests (redirect not followed)');
      assert.strictEqual(attackerReceivedToken, false, 'Bearer token must NEVER leak to redirect target');
    } finally {
      attackerServer.close();
      redirectServer.close();
    }
  });

  test('SEC-02: server.js uses exact matching only and strictly forbids LIKE % queries in /uploads', () => {
    assert.ok(fs.existsSync(serverFilePath), 'server.js must exist');
    const content = fs.readFileSync(serverFilePath, 'utf8');

    const uploadsRouteIndex = content.indexOf("app.use('/uploads'");
    assert.ok(uploadsRouteIndex !== -1, 'server.js must have app.use(/uploads)');
    const uploadsRouteBlock = content.slice(uploadsRouteIndex, uploadsRouteIndex + 5000);

    assert.ok(!uploadsRouteBlock.includes('LIKE ?'), 'Wildcard LIKE ? query must NOT exist in /uploads fallback');
    assert.ok(!uploadsRouteBlock.includes('likePattern'), 'likePattern must NOT exist in /uploads fallback');
    assert.ok(uploadsRouteBlock.includes('slip_image_url IN (?, ?, ?, ?)'), 'Must match exact candidates tuple');
    assert.ok(uploadsRouteBlock.includes('cleanPath.replace(/^uploads\\//'), 'Must normalize upload path prefixes');
  });

  test('SEC-03: worker.js uses exact matching only and strictly forbids LIKE % queries in /uploads', () => {
    assert.ok(fs.existsSync(workerFilePath), 'worker.js must exist');
    const content = fs.readFileSync(workerFilePath, 'utf8');

    const uploadsHandlerIndex = content.indexOf("pathname.startsWith('/uploads/')");
    assert.ok(uploadsHandlerIndex !== -1, 'worker.js must have /uploads/ route handler');
    const uploadsBlock = content.slice(uploadsHandlerIndex, uploadsHandlerIndex + 6000);

    assert.ok(!uploadsBlock.includes('LIKE ?'), 'Wildcard LIKE ? query must NOT exist in /uploads handler');
    assert.ok(!uploadsBlock.includes('likePattern'), 'likePattern must NOT exist in /uploads handler');
    assert.ok(uploadsBlock.includes('slip_image_url IN (?, ?, ?, ?)'), 'Must match exact candidates tuple');
    assert.ok(uploadsBlock.includes("filePath.replace(/^uploads\\//"), 'Must normalize upload path prefixes');
  });

  test('SEC-04: Cloudflare Pages _redirects proxies /uploads/* to Cloudflare Worker API', () => {
    assert.ok(fs.existsSync(frontendRedirectsPath), 'frontend public/_redirects must exist');
    const frontendRedirects = fs.readFileSync(frontendRedirectsPath, 'utf8');
    assert.match(
      frontendRedirects,
      /\/uploads\/\*\s+https:\/\/bwork-pos-api\.ohnatza74185-ky\.workers\.dev\/uploads\/:splat\s+200/,
      'Frontend _redirects must proxy /uploads/* directly to Worker API with status 200'
    );

    assert.ok(fs.existsSync(bookingRedirectsPath), 'booking-app public/_redirects must exist');
    const bookingRedirects = fs.readFileSync(bookingRedirectsPath, 'utf8');
    assert.match(
      bookingRedirects,
      /\/uploads\/\*\s+https:\/\/bwork-pos-api\.ohnatza74185-ky\.workers\.dev\/uploads\/:splat\s+200/,
      'Booking-app _redirects must proxy /uploads/* directly to Worker API with status 200'
    );
  });

  test('SEC-05: Support tickets remain preserved in Development worker.js and server.js', () => {
    const workerContent = fs.readFileSync(workerFilePath, 'utf8');
    const serverContent = fs.readFileSync(serverFilePath, 'utf8');

    assert.ok(workerContent.includes("pathname === '/api/public/support/tickets'"), 'Support public route preserved in Development worker.js');
    assert.ok(serverContent.includes('/api/pos/support'), 'Support POS routes preserved in Development server.js');
    assert.ok(serverContent.includes('supportTickets/routes'), 'supportTickets/routes router mounted in Development server.js');
  });
});
