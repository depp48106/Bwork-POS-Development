/**
 * printReceiptHelper.js
 * Deterministic dynamic thermal receipt page sizing for 72mm continuous roll printing.
 *
 * Ensures:
 * 1. Receipt images/logo are fully loaded before measuring.
 * 2. Actual rendered receipt content height is measured in pixels and converted to mm (1px = 25.4/96mm).
 * 3. Dynamic @page { size: 72mm <height>mm; margin: 0; } is injected into #receipt-dynamic-page-size.
 * 4. Eliminates Page 2 pagination and multi-page splitting on continuous roll paper.
 * 5. Cleans up dynamic style tag on afterprint without accumulating multiple style tags.
 */

export const STYLE_ELEMENT_ID = 'receipt-dynamic-page-size';
export const SAFETY_BOTTOM_BUFFER_MM = 3.0; // 3mm deterministic safety allowance for subpixel rounding
export const MIN_SAFE_PAGE_HEIGHT_MM = 50.0; // 50mm minimum page height
export const MAX_SAFE_PAGE_HEIGHT_MM = 2000.0; // 2,000mm (2 meters) practical thermal roll safety threshold

/**
 * Ensures all <img> elements inside receipt element are fully loaded or errored.
 * @param {HTMLElement} element
 * @returns {Promise<void>}
 */
export async function ensureReceiptImagesLoaded(element) {
  if (!element || typeof window === 'undefined' || typeof element.querySelectorAll !== 'function') return;
  const images = Array.from(element.querySelectorAll('img'));
  if (images.length === 0) return;

  const promises = images.map((img) => {
    if (img.complete && img.naturalWidth > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const handleDone = () => {
        if (settled) return;
        settled = true;
        img.removeEventListener('load', handleDone);
        img.removeEventListener('error', handleDone);
        resolve();
      };
      img.addEventListener('load', handleDone);
      img.addEventListener('error', handleDone);
      // Failsafe timeout in case image never triggers events
      setTimeout(handleDone, 1200);
    });
  });

  await Promise.all(promises);
}

/**
 * Calculates receipt height in millimeters from CSS pixels.
 * 1 inch = 96 CSS px = 25.4 mm => mm = px * 25.4 / 96
 * @param {HTMLElement} element
 * @param {number} [bufferMm]
 * @returns {number}
 */
export function calculateReceiptHeightMm(element, bufferMm = SAFETY_BOTTOM_BUFFER_MM) {
  if (!element) return 0;
  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : { height: 0 };
  const scrollHeight = Number(element.scrollHeight || 0);
  const offsetHeight = Number(element.offsetHeight || 0);
  const rectHeight = Number(rect.height || 0);

  const heightPx = Math.max(scrollHeight, offsetHeight, rectHeight);
  if (!heightPx || heightPx <= 0) return 0;

  const rawMm = (heightPx * 25.4) / 96;
  const totalMm = rawMm + bufferMm;
  const clampedMm = Math.min(Math.max(totalMm, MIN_SAFE_PAGE_HEIGHT_MM), MAX_SAFE_PAGE_HEIGHT_MM);

  return Number((Math.ceil(clampedMm * 10) / 10).toFixed(1));
}

/**
 * Injects or updates the dedicated <style id="receipt-dynamic-page-size">
 * @param {HTMLElement|string} elementOrId
 * @param {number} [bufferMm]
 * @returns {number|null} Injected height in mm
 */
export function applyDynamicReceiptPageSize(elementOrId, bufferMm = SAFETY_BOTTOM_BUFFER_MM) {
  if (typeof document === 'undefined') return null;
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (!el) return null;

  const heightMm = calculateReceiptHeightMm(el, bufferMm);
  if (!heightMm) return null;

  let styleTag = document.getElementById(STYLE_ELEMENT_ID);
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = STYLE_ELEMENT_ID;
    document.head.appendChild(styleTag);
  }

  styleTag.textContent = `
    @page {
      size: 72mm ${heightMm}mm !important;
      margin: 0 !important;
    }
  `;

  return heightMm;
}

/**
 * Cleans up the dynamic @page style element after print
 */
export function cleanupDynamicReceiptPageSize() {
  if (typeof document === 'undefined') return;
  const styleTag = document.getElementById(STYLE_ELEMENT_ID);
  if (styleTag && styleTag.parentNode) {
    styleTag.parentNode.removeChild(styleTag);
  }
}

// Module-scoped explicit receipt print job tracking
let isReceiptPrintActive = false;

/**
 * Resets explicit receipt print active state (for cleanup / testing)
 */
export function resetReceiptPrintActive() {
  isReceiptPrintActive = false;
}

/**
 * Gets explicit receipt print active state (for inspection / testing)
 * @returns {boolean}
 */
export function getReceiptPrintActive() {
  return isReceiptPrintActive;
}

/**
 * Determines whether the given element is genuinely the intended, visible receipt print target.
 * Enforces strict priority:
 * 1. Explicit non-receipt print markers take absolute precedence (veto any receipt state).
 * 2. Hidden or detached receipt elements (even with scrollHeight > 0 or stale flags) are rejected.
 * 3. Genuinely active / visible receipt prints are accepted.
 *
 * @param {HTMLElement|string} [elementOrId='print-receipt-area']
 * @returns {boolean}
 */
export function isReceiptPrintTarget(elementOrId = 'print-receipt-area') {
  if (typeof window === 'undefined') return false;

  // PRIORITY 1: Explicit non-receipt print markers take absolute precedence.
  // A stale isReceiptPrintActive flag MUST NEVER override an explicit non-receipt document print.
  if (typeof document !== 'undefined' && document.body) {
    if (document.body.classList && typeof document.body.classList.contains === 'function' && (
      document.body.classList.contains('printing-quotation') ||
      document.body.classList.contains('printing-booking-confirmation')
    )) {
      isReceiptPrintActive = false;
      return false;
    }
    // Also check for isolated quotation iframe / canvas or booking confirmation card overlay
    if (typeof document.getElementById === 'function') {
      if (document.getElementById('booking-confirmation-card-overlay')) {
        isReceiptPrintActive = false;
        return false;
      }
      if (document.getElementById('quotation-print-isolated-iframe') ||
          document.getElementById('quotation-printable-canvas') ||
          document.getElementById('quotation-preview-canvas')) {
        const qCanvas = document.getElementById('quotation-printable-canvas') ||
                        document.getElementById('quotation-preview-canvas');
        if (qCanvas && (qCanvas.offsetParent !== null || (typeof qCanvas.getBoundingClientRect === 'function' && qCanvas.getBoundingClientRect().width > 0))) {
          isReceiptPrintActive = false;
          return false;
        }
      }
    }
  }

  const el = typeof elementOrId === 'string'
    ? (typeof document !== 'undefined' && typeof document.getElementById === 'function' ? document.getElementById(elementOrId) : null)
    : elementOrId;
  if (!el) {
    isReceiptPrintActive = false;
    return false;
  }

  // Element must be attached to the active document DOM
  if (typeof el.isConnected === 'boolean' && !el.isConnected) {
    isReceiptPrintActive = false;
    return false;
  }

  // PRIORITY 2: Layout presence and visibility guard.
  // Rejects hidden elements even if scrollHeight > 0 or isReceiptPrintActive is stale from a missed afterprint.
  if (el.offsetParent === null) {
    isReceiptPrintActive = false;
    return false;
  }

  if (typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      isReceiptPrintActive = false;
      return false;
    }
  }

  if (typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      isReceiptPrintActive = false;
      return false;
    }
    const modalOverlay = typeof el.closest === 'function' ? el.closest('.print-modal-overlay') : null;
    if (modalOverlay) {
      const overlayStyle = window.getComputedStyle(modalOverlay);
      if (overlayStyle.display === 'none' || overlayStyle.visibility === 'hidden') {
        isReceiptPrintActive = false;
        return false;
      }
    }
  }

  // PRIORITY 3: Explicit printReceipt invocation on a genuinely present receipt
  if (isReceiptPrintActive) {
    return true;
  }

  // PRIORITY 4: Browser Ctrl+P while receipt modal is actively displayed on screen
  // If we passed Priority 1 and 2, the receipt is actively rendered and visible on screen.
  return true;
}

/**
 * Primary print entry point for receipt printing.
 * Deterministically prepares images, calculates height, applies @page, prints, and cleans up.
 * @param {HTMLElement|string} [elementOrId='print-receipt-area']
 */
export async function printReceipt(elementOrId = 'print-receipt-area') {
  if (typeof window === 'undefined') return;
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (!el) {
    window.print();
    return;
  }

  try {
    // 1. Ensure receipt images/logo are fully resolved
    await ensureReceiptImagesLoaded(el);

    // 2. Mark explicit receipt print target active
    isReceiptPrintActive = true;

    // 3. Measure and apply dynamic page size
    applyDynamicReceiptPageSize(el);

    // 4. Register single-use afterprint cleanup handler
    const handleAfterPrint = () => {
      isReceiptPrintActive = false;
      window.removeEventListener('afterprint', handleAfterPrint);
      cleanupDynamicReceiptPageSize();
    };
    window.addEventListener('afterprint', handleAfterPrint, { once: true });

    // 5. Trigger print
    try {
      window.print();
    } catch (printErr) {
      // Clean up immediately if window.print() throws synchronously
      isReceiptPrintActive = false;
      window.removeEventListener('afterprint', handleAfterPrint);
      cleanupDynamicReceiptPageSize();
      throw printErr;
    }
  } catch (err) {
    isReceiptPrintActive = false;
    console.error('printReceipt error:', err);
    cleanupDynamicReceiptPageSize();
  }
}

// Global print lifecycle listeners for keyboard shortcuts (Ctrl+P) and non-receipt print safety
if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => {
    const el = document.getElementById('print-receipt-area');
    if (el && isReceiptPrintTarget(el)) {
      applyDynamicReceiptPageSize(el);
    } else {
      // Non-receipt print job (e.g. A4 report or document) -> ensure receipt styling is cleared
      cleanupDynamicReceiptPageSize();
    }
  });

  window.addEventListener('afterprint', () => {
    isReceiptPrintActive = false;
    cleanupDynamicReceiptPageSize();
  });
}

/**
 * Generates a safe, sanitized JPEG filename for a Meeting Room Booking Confirmation Card.
 * @param {string|number} bookingRef
 * @returns {string}
 */
export function sanitizeConfirmationCardFilename(bookingRef) {
  const raw = String(bookingRef || 'Booking').trim();
  const safeRef = raw
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'Booking';
  return `BWORK-Booking-Confirmation-${safeRef}.jpg`;
}

/**
 * Exports the rendered Meeting Room Booking Confirmation Card DOM element as a high-resolution JPEG file.
 * - Captures the entire #wifi-customer-card document (including all rooms when taller than viewport)
 * - Excludes modal chrome, backdrop, and .no-print action buttons
 * - Waits for fonts and allowed images to finish loading
 * - Handles broken or CORS-tainted images gracefully without exporting a blank or truncated image
 * - Never logs or transmits sensitive PINs or Wi-Fi credentials externally
 *
 * @param {HTMLElement} element
 * @param {string|number} bookingRef
 * @param {Object} [options]
 * @returns {Promise<{filename: string, mimeType: string, byteSize: number, width: number, height: number, cssWidth: number, cssHeight: number, pixelRatio: number, dataUrl: string}>}
 */
export async function exportConfirmationCardAsJpg(element, bookingRef, options = {}) {
  if (!element) {
    throw new Error('ไม่พบเอกสารใบยืนยันการจองสำหรับการบันทึกเป็นรูปภาพ');
  }

  const filename = sanitizeConfirmationCardFilename(bookingRef);
  const pixelRatio = Number(options.pixelRatio) > 0 ? Number(options.pixelRatio) : 2;
  const quality = Number(options.quality) > 0 && Number(options.quality) <= 1 ? Number(options.quality) : 0.95;

  // 1. Wait for web fonts (Thai glyphs) if supported
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 1500))
      ]);
    } catch (_) {}
  }

  // 2. Ensure all <img> elements inside the card have settled
  await ensureReceiptImagesLoaded(element);

  // 3. Pre-inline loaded same-origin images & guard against broken/CORS-blocked images
  const restoredAttrs = [];
  if (typeof element.querySelectorAll === 'function' && typeof document !== 'undefined') {
    const imgs = Array.from(element.querySelectorAll('img'));
    for (const img of imgs) {
      const origSrc = img.getAttribute('src');
      if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
        img.setAttribute('data-export-hide', 'true');
        restoredAttrs.push(() => img.removeAttribute('data-export-hide'));
        continue;
      }
      if (origSrc && !origSrc.startsWith('data:')) {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const inlined = c.toDataURL('image/png');
            if (inlined && inlined.startsWith('data:image/')) {
              img.setAttribute('src', inlined);
              restoredAttrs.push(() => img.setAttribute('src', origSrc));
            }
          }
        } catch (_) {
          // Cross-origin or untrusted image that cannot be drawn to canvas -> hide broken img node safely
          img.setAttribute('data-export-hide', 'true');
          restoredAttrs.push(() => img.removeAttribute('data-export-hide'));
        }
      }
    }
  }

  try {
    const cssWidth = Math.max(
      Math.round(Number(element.scrollWidth) || 0),
      Math.round(Number(element.offsetWidth) || 0),
      320
    );
    const cssHeight = Math.max(
      Math.round(Number(element.scrollHeight) || 0),
      Math.round(Number(element.offsetHeight) || 0),
      360
    );

    const filterFn = (node) => {
      if (node && node.nodeType === 1) {
        if (node.classList && (node.classList.contains('no-print') || node.classList.contains('bwork-conf-no-export'))) {
          return false;
        }
        if (typeof node.getAttribute === 'function' && node.getAttribute('data-export-hide') === 'true') {
          return false;
        }
      }
      return true;
    };

    const captureConfig = {
      backgroundColor: '#fcfbf9',
      pixelRatio,
      quality,
      cacheBust: false,
      width: cssWidth,
      height: cssHeight,
      style: {
        margin: '0',
        transform: 'none',
        maxHeight: 'none',
        overflow: 'visible',
        boxShadow: 'none'
      },
      filter: filterFn
    };

    let dataUrl = null;
    let exportWidth = Math.round(cssWidth * pixelRatio);
    let exportHeight = Math.round(cssHeight * pixelRatio);

    if (typeof options.toJpegFn === 'function') {
      dataUrl = await options.toJpegFn(element, captureConfig);
    } else {
      const htmlToImage = await import('html-to-image');
      if (typeof htmlToImage.toCanvas === 'function') {
        const canvas = await htmlToImage.toCanvas(element, captureConfig);
        if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
          throw new Error('ไม่สามารถสร้างภาพใบยืนยันการจองได้ (Canvas มีขนาดไม่ถูกต้อง)');
        }
        exportWidth = canvas.width;
        exportHeight = canvas.height;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      } else {
        dataUrl = await htmlToImage.toJpeg(element, captureConfig);
      }
    }

    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) {
      throw new Error('รูปแบบไฟล์ภาพที่สร้างไม่ใช่ JPEG ที่ถูกต้อง');
    }

    const base64Part = dataUrl.slice('data:image/jpeg;base64,'.length);
    const byteSize = Math.floor((base64Part.length * 3) / 4);
    if (byteSize < 512) {
      throw new Error('ไฟล์รูปภาพที่สร้างมีขนาดเล็กผิดปกติ กรุณาลองใหม่อีกครั้ง');
    }

    if (typeof document !== 'undefined' && typeof document.createElement === 'function' && options.triggerDownload !== false) {
      let downloadHref = dataUrl;
      let revokeUrl = null;
      if (typeof window !== 'undefined' && typeof window.atob === 'function' && typeof Blob === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        try {
          const binStr = window.atob(base64Part);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'image/jpeg' });
          downloadHref = URL.createObjectURL(blob);
          revokeUrl = downloadHref;
        } catch (_) {}
      }

      const link = document.createElement('a');
      link.download = filename;
      link.href = downloadHref;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (revokeUrl) {
        setTimeout(() => {
          try { URL.revokeObjectURL(revokeUrl); } catch (_) {}
        }, 5000);
      }
    }

    const meta = {
      filename,
      mimeType: 'image/jpeg',
      byteSize,
      byteLength: byteSize,
      width: exportWidth,
      height: exportHeight,
      cssWidth,
      cssHeight,
      pixelRatio,
      dataUrl
    };

    if (typeof window !== 'undefined') {
      window.__lastConfirmationCardJpgExport = meta;
    }
    if (element && element.dataset) {
      element.dataset.lastJpgExport = JSON.stringify(meta);
    }

    return { ...meta, dataUrl };
  } finally {
    for (const restore of restoredAttrs) {
      try { restore(); } catch (_) {}
    }
  }
}
