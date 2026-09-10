import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { API_BASE } from './apiConfig';
import { authManager } from './authManager';

// Global API Interceptor: rewrite API URLs in production & attach JWT token to protected requests
const ORIGINAL_FETCH = window.fetch;
window.fetch = function(url, options = {}) {
  let targetUrl = url;
  if (typeof url === 'string') {
    if (url.startsWith('/api/') && API_BASE) {
      targetUrl = `${API_BASE}${url}`;
    }
  }

  // Attach JWT token to all API requests except login and public endpoints
  if (typeof url === 'string' && url.includes('/api/') && !url.includes('/api/auth/login') && !url.includes('/api/public/')) {
    const token = authManager.getToken();
    if (token) {
      if (options.headers instanceof Headers) {
        if (!options.headers.has('Authorization')) {
          options.headers.set('Authorization', `Bearer ${token}`);
        }
      } else {
        options.headers = {
          ...(options.headers || {}),
          'Authorization': `Bearer ${token}`
        };
      }
    }
  }
  return ORIGINAL_FETCH(targetUrl, options);
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
