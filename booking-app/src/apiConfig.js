// API Base URL configuration:
// In local dev & on-premise production: '' (uses relative path to local server)
// If VITE_API_BASE is explicitly set in .env, use that
export const API_BASE = import.meta.env.VITE_API_BASE || '';
