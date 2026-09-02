// API Base URL configuration:
// 1. If VITE_API_BASE is explicitly set, use that
// 2. If on Cloudflare Pages (*.pages.dev) or production domain, use Cloudflare Worker API
// 3. Otherwise (localhost / 127.0.0.1 / 192.168.x.x), use '' (relative path to local backend)
export const API_BASE = (() => {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host.includes('pages.dev') || host.includes('workers.dev') || (host !== 'localhost' && host !== '127.0.0.1' && !host.startsWith('192.168.'))) {
      return 'https://bwork-pos-api.ohnatza74185-ky.workers.dev';
    }
  }
  return '';
})();

