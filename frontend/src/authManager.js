/**
 * Centralized Authentication & Token Manager for Bwork-POS
 * Provides unified token storage, sliding session (silent auto-refresh),
 * and network fault tolerance to prevent accidental session drops.
 */

const TOKEN_KEY = 'pos_token';
const USER_KEY = 'pos_user';
const LEGACY_TOKEN_KEY = 'token';

// Listeners for auth state changes
const authListeners = new Set();

function notifyListeners(user, token) {
  authListeners.forEach(listener => {
    try {
      listener({ user, token, isAuthenticated: !!(user && token) });
    } catch (e) {
      console.warn('[AuthManager] Listener error:', e);
    }
  });
}

let refreshTimer = null;

export const authManager = {
  /**
   * Get current stored token
   */
  getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Get current stored user profile
   */
  getUser() {
    try {
      const saved = localStorage.getItem(USER_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Check if user has token and session locally
   */
  isAuthenticated() {
    return !!(this.getToken() && this.getUser());
  },

  /**
   * Save authentication session
   */
  setAuth(token, user) {
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(LEGACY_TOKEN_KEY, token);
      }
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      }
      this.startAutoRefresh();
      notifyListeners(user, token);
    } catch (e) {
      console.error('[AuthManager] Failed to persist auth:', e);
    }
  },

  /**
   * Clear authentication session (Logout)
   */
  clearAuth() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      this.stopAutoRefresh();
      notifyListeners(null, null);
    } catch (e) {
      console.error('[AuthManager] Failed to clear auth:', e);
    }
  },

  /**
   * Verify session with backend with Network Fault Tolerance
   * If server is unreachable / offline, it retains session instead of kicking user out.
   */
  async verifySession() {
    const token = this.getToken();
    const localUser = this.getUser();

    if (!token || !localUser) {
      return { success: false, user: null, is401: false };
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          this.setAuth(token, data.user);
          return { success: true, user: data.user, networkError: false };
        }
      }

      if (res.status === 401) {
        // Token is genuinely invalid or expired on backend
        console.warn('[AuthManager] Token is invalid or expired (401). Clearing session.');
        this.clearAuth();
        return { success: false, user: null, is401: true };
      }

      // Other HTTP errors (e.g. 502, 503, 504) -> Retain local session
      console.warn('[AuthManager] Server returned status ' + res.status + '. Retaining local session.');
      return { success: true, user: localUser, networkError: true };
    } catch (networkErr) {
      // Network unreachable / offline -> Retain local session
      console.warn('[AuthManager] Network unreachable. Retaining local session in offline mode.');
      return { success: true, user: localUser, networkError: true };
    }
  },

  /**
   * Perform silent background token refresh
   */
  async refreshToken() {
    const token = this.getToken();
    if (!token) return false;

    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.token) {
          const user = data.user || this.getUser();
          this.setAuth(data.token, user);
          return true;
        }
      } else if (res.status === 401) {
        console.warn('[AuthManager] Refresh failed (401).');
      }
    } catch (err) {
      console.warn('[AuthManager] Background refresh network error:', err);
    }
    return false;
  },

  /**
   * Start periodic sliding session auto-refresh (every 30 minutes)
   */
  startAutoRefresh() {
    this.stopAutoRefresh();
    // Refresh token every 30 minutes while active
    refreshTimer = setInterval(() => {
      if (this.isAuthenticated()) {
        this.refreshToken();
      }
    }, 30 * 60 * 1000);
  },

  /**
   * Stop periodic auto-refresh timer
   */
  stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  },

  /**
   * Subscribe to auth state changes
   */
  onAuthChange(callback) {
    authListeners.add(callback);
    return () => authListeners.delete(callback);
  }
};
