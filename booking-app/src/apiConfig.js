// API Base URL configuration:
// In local dev & on-premise production: '' (uses relative path to local server)
// If on Cloudflare Pages (*.pages.dev) or explicitly configured, use Cloudflare Worker API
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

