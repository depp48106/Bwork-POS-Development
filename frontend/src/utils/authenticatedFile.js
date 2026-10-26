/**
 * BWORK-POS Authenticated File Utility
 * Secure fetching of private uploads (payment slips, tax invoices) with JWT Authorization headers.
 * Resolves relative and Pages URLs with API_BASE, preventing HTML SPA fallback and 401 Unauthorized errors.
 * Converts server responses into revocable Object URLs (Blob URLs) without exposing tokens in query strings.
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
 * Resolves relative and environment-specific file URLs against API_BASE.
 * Handles data: and blob: URLs, relative paths (/uploads/...), and Cloudflare Pages origins.
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

  // If already an absolute HTTP(S) URL, check if pointing to Pages domain
  if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
    try {
      const parsed = new URL(targetPath);
      if (parsed.hostname.includes('pages.dev')) {
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
  const token = getAuthToken();
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(resolvedUrl, { headers, signal });
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
