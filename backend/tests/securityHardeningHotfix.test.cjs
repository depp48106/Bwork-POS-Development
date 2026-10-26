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

  test('SEC-01: authenticatedFile.js contains isTrustedAuthOrigin with strict allowlist', () => {
    assert.ok(fs.existsSync(authFilePath), 'authenticatedFile.js must exist');
    const content = fs.readFileSync(authFilePath, 'utf8');

    assert.ok(content.includes('function isTrustedAuthOrigin'), 'Must export isTrustedAuthOrigin function');
    assert.ok(content.includes('bwork-pos-api.ohnatza74185-ky.workers.dev'), 'Allowlist must include production Worker API');
    assert.ok(content.includes('bwork-pos.pages.dev'), 'Allowlist must include POS Pages');
    assert.ok(content.includes('bwork-booking.pages.dev'), 'Allowlist must include Booking Pages');
    assert.ok(content.includes('localhost'), 'Allowlist must include localhost');
    assert.ok(content.includes('127.0.0.1'), 'Allowlist must include 127.0.0.1');

    // Anti-leakage gate
    assert.ok(content.includes('if (isTrustedAuthOrigin(resolvedUrl))'), 'Must check isTrustedAuthOrigin before attaching Bearer token');
    assert.ok(content.includes('javascript:'), 'Must block javascript: pseudo-protocol');
  });

  test('SEC-02: server.js uses exact matching only and strictly forbids LIKE % queries in /uploads', () => {
    assert.ok(fs.existsSync(serverFilePath), 'server.js must exist');
    const content = fs.readFileSync(serverFilePath, 'utf8');

    // Find the /uploads route
    const uploadsRouteIndex = content.indexOf("app.use('/uploads'");
    assert.ok(uploadsRouteIndex !== -1, 'server.js must have app.use(/uploads)');
    const uploadsRouteBlock = content.slice(uploadsRouteIndex, uploadsRouteIndex + 5000);

    // Verify NO wildcard LIKE search
    assert.ok(!uploadsRouteBlock.includes('LIKE ?'), 'Wildcard LIKE ? query must NOT exist in /uploads fallback');
    assert.ok(!uploadsRouteBlock.includes('likePattern'), 'likePattern must NOT exist in /uploads fallback');

    // Verify exact tuple matching
    assert.ok(uploadsRouteBlock.includes('slip_image_url IN (?, ?, ?, ?)'), 'Must match exact candidates tuple');
    assert.ok(uploadsRouteBlock.includes('cleanPath.replace(/^uploads\\//'), 'Must normalize upload path prefixes');
  });

  test('SEC-03: worker.js uses exact matching only and strictly forbids LIKE % queries in /uploads', () => {
    assert.ok(fs.existsSync(workerFilePath), 'worker.js must exist');
    const content = fs.readFileSync(workerFilePath, 'utf8');

    // Find the /uploads handler in worker.js
    const uploadsHandlerIndex = content.indexOf("pathname.startsWith('/uploads/')");
    assert.ok(uploadsHandlerIndex !== -1, 'worker.js must have /uploads/ route handler');
    const uploadsBlock = content.slice(uploadsHandlerIndex, uploadsHandlerIndex + 6000);

    // Verify NO wildcard LIKE search
    assert.ok(!uploadsBlock.includes('LIKE ?'), 'Wildcard LIKE ? query must NOT exist in /uploads handler');
    assert.ok(!uploadsBlock.includes('likePattern'), 'likePattern must NOT exist in /uploads handler');

    // Verify exact candidate matching
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

  test('SEC-05: Support tickets remain disabled in Production worker.js', () => {
    const workerContent = fs.readFileSync(workerFilePath, 'utf8');
    assert.ok(
      workerContent.includes("Support tickets feature is disabled in this release"),
      'Support tickets must be feature-gated and disabled in production worker.js'
    );
  });
});
