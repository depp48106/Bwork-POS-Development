/**
 * supportTickets/customerAuth.js
 * Server-Authoritative Customer Identity & Ticket Ownership Verification Engine
 */

const crypto = require('crypto');

// Standard LINE Channel ID for Bwork-POS
const DEFAULT_LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID || '2011136579';
const MOCK_LINE_SECRET = 'mock_line_test_hmac_secret_2026';

/**
 * Constant-time string equality check to protect against timing attacks
 */
function safeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates an unguessable high-entropy capability token for the ticket creator
 * Format: tkt_sec_<48 hex chars> (192 bits of entropy)
 */
function generateSecureTicketToken() {
  return 'tkt_sec_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Base64URL decode helper
 */
function decodeBase64Url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Base64URL encode helper
 */
function encodeBase64Url(strOrBuf) {
  const buf = Buffer.isBuffer(strOrBuf) ? strOrBuf : Buffer.from(strOrBuf);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Verifies a synthetic LINE ID Token (JWT) signed with trusted test key
 * Rejects unsigned ('none'), mismatched signature, wrong issuer, wrong audience, or expired tokens.
 */
function verifyMockLineIdToken(tokenString, expectedAudience = DEFAULT_LINE_CHANNEL_ID) {
  if (!tokenString || typeof tokenString !== 'string') return null;
  const parts = tokenString.trim().split('.');
  if (parts.length !== 3) return null;

  try {
    // 1. Verify Header & Algorithm Confusion
    const headerJson = decodeBase64Url(parts[0]);
    const header = JSON.parse(headerJson);
    if (!header || header.alg !== 'HS256') {
      return null; // Reject 'none' or unsupported algorithm
    }

    // 2. Verify Cryptographic Signature
    const expectedSig = crypto.createHmac('sha256', MOCK_LINE_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    const expectedSigB64 = encodeBase64Url(expectedSig);

    if (!safeEqualString(parts[2], expectedSigB64)) {
      return null; // Reject forged / invalid signature
    }

    // 3. Verify Payload Claims
    const payloadJson = decodeBase64Url(parts[1]);
    const payload = JSON.parse(payloadJson);

    // Issuer check (must be issued by LINE)
    if (payload.iss !== 'https://access.line.me') {
      return null;
    }

    // Expiration check (with 60-second clock skew grace)
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || typeof payload.exp !== 'number' || payload.exp < (nowSec - 60)) {
      return null;
    }

    // Subject (LINE User ID) check
    if (!payload.sub || typeof payload.sub !== 'string' || !payload.sub.trim()) {
      return null;
    }

    // Audience (Channel ID) check
    if (expectedAudience) {
      if (payload.aud !== expectedAudience && !String(expectedAudience).includes(payload.aud)) {
        return null;
      }
    }

    return {
      userId: payload.sub.trim(),
      name: payload.name || null,
      picture: payload.picture || null,
      payload
    };
  } catch (err) {
    return null;
  }
}

/**
 * Verifies a LINE ID Token (JWT) issued by LINE
 * Validates cryptographic signature, issuer, audience, and expiration.
 * In test mode: verifies signature against trusted test HMAC key.
 * In production mode: calls official LINE Verify API.
 */
async function verifyLineIdToken(tokenString, expectedAudience = DEFAULT_LINE_CHANNEL_ID) {
  if (!tokenString || typeof tokenString !== 'string') return null;
  const trimmed = tokenString.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;

  // 1. In Test / Offline environment: use strict test verification engine
  if (process.env.NODE_ENV === 'test' || process.env.ALLOW_MOCK_LINE_TOKENS === 'true') {
    return verifyMockLineIdToken(trimmed, expectedAudience);
  }

  // 2. In Production: Call official LINE Verify API
  try {
    const params = new URLSearchParams();
    params.append('id_token', trimmed);
    if (expectedAudience) {
      params.append('client_id', expectedAudience);
    }

    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!res.ok) {
      return null;
    }

    const payload = await res.json();
    if (payload.iss !== 'https://access.line.me' || !payload.sub) {
      return null;
    }
    if (expectedAudience && payload.aud !== expectedAudience) {
      return null;
    }

    return {
      userId: payload.sub.trim(),
      name: payload.name || null,
      picture: payload.picture || null,
      payload
    };
  } catch (err) {
    console.error('[LineAuth] LINE verification network error:', err.message);
    return null;
  }
}

/**
 * Creates a synthetic LINE ID Token (JWT) for offline negative security testing
 */
function createMockLineIdToken(userId, options = {}) {
  const header = { alg: options.alg || 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: options.invalidIssuer ? 'https://attacker.example.com' : 'https://access.line.me',
    sub: userId,
    aud: options.audience || DEFAULT_LINE_CHANNEL_ID,
    exp: options.expired ? now - 3600 : now + 3600,
    iat: now,
    name: options.name || 'Mock Customer'
  };

  const headerB64 = encodeBase64Url(JSON.stringify(header));
  const payloadB64 = encodeBase64Url(JSON.stringify(payload));

  if (options.alg === 'none') {
    return `${headerB64}.${payloadB64}.`;
  }

  if (options.invalidSignature) {
    return `${headerB64}.${payloadB64}.forged_invalid_signature_xyz`;
  }

  const signature = crypto.createHmac('sha256', MOCK_LINE_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const signatureB64 = encodeBase64Url(signature);

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Extracts and verifies trusted customer credentials from Express HTTP Request
 * Strictly parses headers/body to prevent token leakage via URL Query Parameters.
 */
async function extractCustomerAuth(req) {
  const getHeader = (name) => req.headers[name.toLowerCase()] || req.headers[name] || null;

  // 1. Direct Ticket Token (Creator Secret) — Only from Header or Body (NO query param!)
  const ticketToken = getHeader('x-ticket-token') || (req.body && typeof req.body === 'object' ? req.body.ticket_token : null) || null;

  // Multiple Ticket Tokens — Only from Header (NO query param!)
  let ticketTokens = [];
  const rawTokens = getHeader('x-ticket-tokens') || (req.body && typeof req.body === 'object' ? req.body.ticket_tokens : null);
  if (rawTokens) {
    if (Array.isArray(rawTokens)) {
      ticketTokens = rawTokens.map(t => String(t).trim()).filter(Boolean);
    } else if (typeof rawTokens === 'string') {
      try {
        const parsed = JSON.parse(rawTokens);
        if (Array.isArray(parsed)) ticketTokens = parsed.map(t => String(t).trim()).filter(Boolean);
      } catch (e) {
        ticketTokens = rawTokens.split(',').map(t => t.trim()).filter(Boolean);
      }
    }
  }
  if (ticketToken && !ticketTokens.includes(ticketToken)) {
    ticketTokens.push(String(ticketToken).trim());
  }

  // 2. Booking Capability Token — Only from Header or Body (NO query param!)
  const bookingToken = getHeader('x-booking-token') || (req.body && typeof req.body === 'object' ? req.body.booking_token : null) || null;

  // 3. LINE Verified ID Token
  let lineUserId = null;
  const lineIdToken = getHeader('x-line-id-token') || (
    getHeader('authorization')?.startsWith('Bearer ') && getHeader('authorization').split(' ')[1].includes('.')
      ? getHeader('authorization').split(' ')[1]
      : null
  );

  if (lineIdToken) {
    const verified = await verifyLineIdToken(lineIdToken, DEFAULT_LINE_CHANNEL_ID);
    if (verified) {
      lineUserId = verified.userId;
    }
  }

  return {
    ticketToken: ticketToken ? String(ticketToken).trim() : null,
    ticketTokens,
    bookingToken: bookingToken ? String(bookingToken).trim() : null,
    lineUserId: lineUserId || null,
    rawLineIdToken: lineIdToken || null
  };
}

/**
 * Enforces ownership on a specific support ticket
 * Returns true if client has verified proof of ownership, false otherwise.
 */
async function verifyTicketOwnership(dbQuery, ticket, auth = {}) {
  if (!ticket) return false;

  // Staff override
  if (auth.is_staff) return true;

  // 1. Direct Ticket Secret Token (highest priority for creator)
  if (auth.ticketToken && ticket.access_token) {
    if (safeEqualString(auth.ticketToken, ticket.access_token)) {
      return true;
    }
  }

  // 2. Verified LINE User ID (matched against ticket's creator line_user_id)
  if (auth.lineUserId && ticket.line_user_id) {
    if (safeEqualString(auth.lineUserId, ticket.line_user_id)) {
      return true;
    }
  }

  // 3. Trusted Booking Capability Token (if ticket is linked to a booking)
  if (auth.bookingToken && (ticket.booking_id || ticket.booking_code)) {
    const booking = await dbQuery.get(
      'SELECT id, qr_token FROM bookings WHERE id = ? OR receipt_number = ?',
      [ticket.booking_id, ticket.booking_code]
    );
    if (booking && booking.qr_token && safeEqualString(auth.bookingToken, booking.qr_token)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  DEFAULT_LINE_CHANNEL_ID,
  safeEqualString,
  generateSecureTicketToken,
  verifyLineIdToken,
  verifyMockLineIdToken,
  createMockLineIdToken,
  extractCustomerAuth,
  verifyTicketOwnership
};
