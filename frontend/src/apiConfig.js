// API Base URL configuration:
// In development: '' (uses Vite proxy)
// In production: Uses VITE_API_BASE environment variable or defaults to Cloudflare Workers API URL
export const API_BASE = import.meta.env.VITE_API_BASE !== undefined 
  ? import.meta.env.VITE_API_BASE 
  : (import.meta.env.PROD ? 'https://bwork-pos-api.ohnatza74185-ky.workers.dev' : '');
