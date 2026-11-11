import { API_BASE } from '../apiConfig.js';

/**
 * Resolves room image URLs:
 * - Dynamic room images (/uploads/rooms/...) are stored in Cloudflare R2 -> routes through API_BASE.
 * - Legacy room images (/uploads/img_...) are bundled in Cloudflare Pages static assets -> keeps relative path.
 * - Supports classroom layout via room.classroom_image_url when isClassroom is true.
 * - Preserves data:, blob:, and full http(s) URLs as-is.
 *
 * @param {string|object} roomOrUrl - Room object or image URL string
 * @param {boolean} [isClassroom=false] - Whether classroom layout image should be preferred
 * @param {string|null} [apiBaseOverride=null] - Optional override for API_BASE (for testing)
 * @returns {string} - Fully resolved URL or relative path for <img> tag
 */
export function getRoomImageUrl(roomOrUrl, isClassroom = false, apiBaseOverride = null) {
  if (!roomOrUrl) return '';

  let rawUrl = '';
  if (typeof roomOrUrl === 'object' && roomOrUrl !== null) {
    if (isClassroom && roomOrUrl.classroom_image_url) {
      rawUrl = roomOrUrl.classroom_image_url;
    } else {
      rawUrl = roomOrUrl.image_url || roomOrUrl.room_image_url || '';
    }
  } else if (typeof roomOrUrl === 'string') {
    rawUrl = roomOrUrl;
  }

  if (!rawUrl || typeof rawUrl !== 'string') return '';

  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Ensure standard leading slash
  const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  const baseToUse = apiBaseOverride !== null ? apiBaseOverride : API_BASE;

  // /uploads/rooms/ is uploaded to R2 -> route to API_BASE if configured
  if (cleanPath.startsWith('/uploads/rooms/') && baseToUse) {
    const base = baseToUse.replace(/\/+$/, '');
    return `${base}${cleanPath}`;
  }

  // /uploads/img_ is bundled in Pages static assets -> keep relative to Pages domain
  return cleanPath;
}

/**
 * Handles image load errors with a single-attempt fallback between API_BASE and relative Pages path.
 * Strictly prevents infinite onError loops using an element dataset flag.
 *
 * @param {Event} e - Image error event
 * @param {string} [originalUrl] - Original relative URL of the image
 * @param {string|null} [apiBaseOverride=null] - Optional override for API_BASE (for testing)
 * @returns {boolean} Whether a fallback image request was started
 */
export function handleRoomImageError(e, originalUrl, apiBaseOverride = null) {
  const img = e?.currentTarget;
  if (!img) return false;

  // Prevent infinite looping: only attempt fallback ONCE per <img> element
  if (img.dataset && img.dataset.fallbackTried === 'true') {
    img.style.display = 'none';
    return false;
  }
  if (img.dataset) {
    img.dataset.fallbackTried = 'true';
  }

  const original = typeof originalUrl === 'string' ? originalUrl.trim() : '';
  const baseToUse = apiBaseOverride !== null ? apiBaseOverride : API_BASE;

  if (!original || !baseToUse || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(original)) {
    img.style.display = 'none';
    return false;
  }

  const cleanOriginal = original.startsWith('/') ? original : `/${original}`;
  const apiBase = baseToUse.replace(/\/+$/, '');

  // If currently attempted via API_BASE, try falling back to relative Pages path
  if (img.src && img.src.startsWith(`${apiBase}/`)) {
    img.src = cleanOriginal;
  }
  // If currently attempted via relative Pages path, try falling back to API_BASE
  else {
    img.src = `${apiBase}${cleanOriginal}`;
  }
  return true;
}
