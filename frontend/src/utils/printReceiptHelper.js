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
  if (!element || typeof window === 'undefined') return;
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

    // 2. Measure and apply dynamic page size
    applyDynamicReceiptPageSize(el);

    // 3. Register single-use afterprint cleanup
    const handleAfterPrint = () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      cleanupDynamicReceiptPageSize();
    };
    window.addEventListener('afterprint', handleAfterPrint);

    // 4. Trigger print
    window.print();

    // 5. Fallback cleanup after 5 seconds in case afterprint does not fire in some browsers
    setTimeout(() => {
      cleanupDynamicReceiptPageSize();
    }, 5000);
  } catch (err) {
    console.error('printReceipt error:', err);
    window.print();
  }
}

// Global beforeprint listener for keyboard shortcut (Ctrl+P) print jobs
if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => {
    const el = document.getElementById('print-receipt-area');
    if (el && el.offsetParent !== null) {
      applyDynamicReceiptPageSize(el);
    }
  });

  window.addEventListener('afterprint', () => {
    cleanupDynamicReceiptPageSize();
  });
}
