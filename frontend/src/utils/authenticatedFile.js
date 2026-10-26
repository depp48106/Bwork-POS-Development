/**
 * BWORK-POS Authenticated File Utility
 * Secure fetching of private uploads (payment slips, tax invoices) with JWT Authorization headers.
 * Resolves relative and Pages URLs with API_BASE, preventing HTML SPA fallback and 401 Unauthorized errors.
 * Converts server responses into revocable Object URLs (Blob URLs) without exposing tokens in query strings.
 * Enforces strict Origin & Protocol Allowlist to prevent JWT Token Leakage, Protocol-Relative URL bypasses,
 * Insecure HTTP Token transmission, and Open Redirect vulnerabilities.
 */

import { API_BASE } from '../apiConfig';

export function getAuthToken() {
  try {
    return localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
  } catch (_) {
    return '';
  }
}

/**
 * Strict exact list of trusted hostnames for Authorization header transmission.
 * Explicitly avoids wildcard (*.) and broad suffix matching (.workers.dev) to prevent cross-tenant token leakage.
 */
export const TRUSTED_AUTH_HOSTS = new Set([
  'bwork-pos-api.ohnatza74185-ky.workers.dev',
  'bwork-pos-api-staging.ohnatza74185-ky.workers.dev',
  'bwork-pos.pages.dev',
  'bwork-booking.pages.dev',
  'localhost',
  '127.0.0.1'
]);

/**
 * Checks if a target URL belongs to a trusted BWORK-POS origin.
 * Prevents Bearer JWT token leakage to arbitrary external domains,
 * protocol-relative URLs (//attacker.com), insecure HTTP schemes, and untrusted hosts.
 *
 * @param {string} url - Target URL
 * @returns {boolean} - True only if origin and protocol are strictly trusted for Authorization headers
 */
export function isTrustedAuthOrigin(url) {
  if (!url || typeof url !== 'string') return false;

  const trimmed = url.trim();

  // Reject data: and blob: URLs (they do not use HTTP Authorization headers)
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false;

  // Strict defense against protocol-relative URLs and malformed paths
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.startsWith('\\')) {
    return false;
  }

  // Pure relative paths (starting with / followed by valid path character) are same-origin
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return true;
  }

  // Reject pseudo-protocols and dangerous schemes
  if (trimmed.toLowerCase().startsWith('javascript:')) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const protocol = parsed.protocol.toLowerCase();

    // Protocol check: Only https: allowed for remote; http: ONLY allowed for localhost/127.0.0.1
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (isLocal) {
      return protocol === 'http:' || protocol === 'https:';
    }

    // Remote hosts MUST strictly use https: (prevents plaintext JWT leakage over HTTP)
    if (protocol !== 'https:') {
      return false;
    }

    // 1. Same-origin as current window (if running in browser)
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      if (window.location.hostname.toLowerCase() === host) {
        return window.location.protocol === 'https:' || window.location.hostname === 'localhost';
      }
    }

    // 2. API_BASE host check (if configured)
    if (API_BASE) {
      try {
        const apiParsed = new URL(API_BASE);
        if (apiParsed.hostname.toLowerCase() === host && apiParsed.protocol.toLowerCase() === 'https:') {
          return true;
        }
      } catch (_) {}
    }

    // 3. Exact allowlist match (NO wildcards, NO suffix matching)
    if (TRUSTED_AUTH_HOSTS.has(host)) {
      return true;
    }
  } catch (_) {
    return false;
  }

  return false;
}

/**
 * Resolves relative and environment-specific file URLs against API_BASE.
 * Handles data: and blob: URLs, relative paths (/uploads/...), and Cloudflare Pages origins.
 * Upgrades insecure HTTP to HTTPS for trusted remote hosts to prevent plaintext leakage.
 *
 * @param {string} url - Target file path or URL
 * @returns {string} - Fully qualified or correctly formatted URL for fetching
 */
export function resolveFileUrl(url) {
  if (!url || typeof url !== 'string' || url === 'uploaded') {
    return '';
  }

  // Pass-through data URLs and blob URLs
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  let targetPath = url.trim();

  // Guard against dangerous schemes, protocol-relative URLs, and path trickery
  if (
    targetPath.toLowerCase().startsWith('javascript:') ||
    targetPath.startsWith('//') ||
    targetPath.startsWith('/\\') ||
    targetPath.startsWith('\\')
  ) {
    return '';
  }

  // If already an absolute HTTP(S) URL, check if pointing to Pages domain or unencrypted HTTP
  if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
    try {
      const parsed = new URL(targetPath);
      const host = parsed.hostname.toLowerCase();

      // Upgrade insecure HTTP to HTTPS for trusted remote hosts to prevent plaintext token transmission
      if (parsed.protocol === 'http:' && host !== 'localhost' && host !== '127.0.0.1') {
        let isConfiguredApiBase = false;
        if (API_BASE) {
          try {
            isConfiguredApiBase = new URL(API_BASE).hostname.toLowerCase() === host;
          } catch (_) {}
        }
        if (TRUSTED_AUTH_HOSTS.has(host) || isConfiguredApiBase) {
          parsed.protocol = 'https:';
          targetPath = parsed.toString();
        }
      }

      if (host.includes('pages.dev')) {
        // Strip Pages origin so it routes to Worker API via API_BASE
        targetPath = parsed.pathname + parsed.search;
      } else {
        return targetPath;
      }
    } catch (_) {
      return targetPath;
    }
  }

  // Ensure standard leading slash
  if (!targetPath.startsWith('/')) {
    targetPath = '/' + targetPath;
  }

  // Ensure /uploads prefix for known protected categories if missing
  if (
    targetPath.startsWith('/slips/') ||
    targetPath.startsWith('/payment-slips/') ||
    targetPath.startsWith('/tax-invoices/') ||
    targetPath.startsWith('/tax_invoices/')
  ) {
    targetPath = '/uploads' + targetPath;
  }

  // Prepend API_BASE if defined and targetPath is relative
  if (API_BASE) {
    const base = API_BASE.replace(/\/+$/, '');
    return `${base}${targetPath}`;
  }

  return targetPath;
}

/**
 * Fetches an authenticated file and creates an Object URL.
 * Automatically handles data: and blob: URLs without extra network requests.
 * Only sends Bearer JWT token to verified trusted origins and protocols.
 * Detects and blocks HTTP redirects to untrusted external domains.
 *
 * @param {string} url - Target URL or data/blob URL
 * @param {AbortSignal} [signal] - Optional AbortSignal
 * @returns {Promise<{ blobUrl: string, blob: Blob|null, contentType: string, revoke: () => void }>}
 */
export async function fetchAuthenticatedBlob(url, signal) {
  if (!url || typeof url !== 'string' || url === 'uploaded') {
    throw new Error('URL ไฟล์ไม่ถูกต้อง');
  }

  // Already a data URL or blob URL - no fetch needed
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return {
      blobUrl: url,
      blob: null,
      contentType: url.startsWith('data:') ? (url.slice(5).split(';')[0] || '') : '',
      revoke: () => {}
    };
  }

  const resolvedUrl = resolveFileUrl(url);
  if (!resolvedUrl) {
    throw new Error('URL ไฟล์ไม่ปลอดภัยหรือรูปแบบไม่ถูกต้อง');
  }

  const headers = {};
  // Security Gate: Only attach Bearer JWT if target is an allowed trusted origin and protocol
  if (isTrustedAuthOrigin(resolvedUrl)) {
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  let response;
  try {
    response = await fetch(resolvedUrl, {
      headers,
      signal,
      redirect: 'error' // Strictly reject HTTP redirects BEFORE following to prevent JWT token leakage
    });
  } catch (fetchErr) {
    if (fetchErr && fetchErr.name === 'AbortError') {
      throw fetchErr;
    }
    const errStr = String(fetchErr).toLowerCase();
    if (errStr.includes('redirect')) {
      const err = new Error('การส่งต่อ (HTTP Redirect) ถูกปฏิเสธเพื่อป้องกัน Token รั่วไหล');
      err.status = 403;
      throw err;
    }
    throw fetchErr;
  }
  if (!response.ok) {
    let errMsg = `โหลดไฟล์ล้มเหลว (HTTP ${response.status})`;
    try {
      const errorData = await response.json();
      if (errorData?.error) errMsg = errorData.error;
    } catch (_) {}
    const err = new Error(errMsg);
    err.status = response.status;
    throw err;
  }

  // HTTP Redirect Protection: If redirected, verify destination origin is strictly trusted
  if (response.redirected && response.url) {
    if (!isTrustedAuthOrigin(response.url)) {
      const err = new Error('การส่งต่อ (HTTP Redirect) ไปยังโดเมนภายนอกที่ไม่ได้รับอนุญาตถูกบล็อกเพื่อความปลอดภัย');
      err.status = 403;
      throw err;
    }
  }

  // Sanity check Content-Type: Reject HTML responses (SPA fallback / routing error)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('text/html')) {
    const err = new Error('เซิร์ฟเวอร์ส่งคืนหน้าเว็บ HTML แทนรูปภาพ (อาจเกิดจากเซสชันหมดอายุหรือปัญหาการเชื่อมต่อ API)');
    err.status = 502;
    throw err;
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  return {
    blobUrl,
    blob,
    contentType: blob.type || contentType,
    revoke: () => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch (_) {}
    }
  };
}

/**
 * Opens an authenticated image or document in a new browser tab without query parameter tokens.
 * Pre-opens blank tab to prevent browser popup blockers on async fetch.
 *
 * @param {string} url - Target file URL
 * @param {string} [title='Payment Slip'] - Tab title
 */
export async function openAuthenticatedImageInNewTab(url, title = 'หลักฐานสลิปการชำระเงิน') {
  if (!url || typeof url !== 'string' || url === 'uploaded') return;

  // Block dangerous schemes
  if (url.trim().toLowerCase().startsWith('javascript:')) return;

  if (url.startsWith('data:') || url.startsWith('blob:')) {
    window.open(url, '_blank');
    return;
  }

  // Pre-open tab to prevent popup blocker
  const newTab = window.open('about:blank', '_blank');
  if (newTab) {
    try {
      newTab.document.write(`
        <!DOCTYPE html>
        <html lang="th">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title} - BWORK POS</title>
            <style>
              body {
                margin: 0;
                background-color: #0b0f17;
                color: #f1f5f9;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
              }
              .spinner {
                width: 40px;
                height: 40px;
                border: 3px solid rgba(56, 189, 248, 0.2);
                border-top-color: #38bdf8;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
              }
              .label {
                margin-top: 16px;
                font-size: 14px;
                font-weight: 500;
                color: #94a3b8;
              }
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            </style>
          </head>
          <body>
            <div class="spinner"></div>
            <div class="label">กำลังโหลดรูปภาพเอกสารที่ปลอดภัย...</div>
          </body>
        </html>
      `);
    } catch (_) {}
  }

  try {
    const result = await fetchAuthenticatedBlob(url);
    if (newTab && !newTab.closed) {
      try {
        newTab.location.href = result.blobUrl;
      } catch (_) {
        newTab.document.body.innerHTML = `
          <div style="margin: 0; background: #0b0f17; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
            <img src="${result.blobUrl}" alt="${title}" style="max-width: 100%; max-height: 100vh; object-fit: contain;" />
          </div>
        `;
      }
    } else {
      window.open(result.blobUrl, '_blank');
    }

    // Auto-revoke after 5 minutes to release object URL memory
    setTimeout(() => {
      result.revoke();
    }, 5 * 60 * 1000);
  } catch (err) {
    console.error('[AuthenticatedFile] Failed to open document in new tab:', err);
    if (newTab && !newTab.closed) {
      try {
        newTab.document.body.innerHTML = `
          <div style="text-align: center; padding: 24px;">
            <div style="font-size: 36px; margin-bottom: 12px;">⚠️</div>
            <h3 style="color: #f87171; margin: 0 0 8px 0; font-size: 16px;">ไม่สามารถเปิดเอกสารได้</h3>
            <p style="color: #94a3b8; font-size: 13px; margin: 0 0 16px 0;">${err.message || 'เซิร์ฟเวอร์ปฏิเสธการเข้าถึง หรือไฟล์หมดอายุ'}</p>
            <button onclick="window.close()" style="padding: 8px 16px; background: #1e293b; color: #fff; border: 1px solid #334155; border-radius: 6px; cursor: pointer;">ปิดหน้านี้</button>
          </div>
        `;
      } catch (_) {}
    }
  }
}
