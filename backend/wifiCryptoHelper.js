/**
 * BWORK-POS — Wi-Fi Credential Encryption Helper
 *
 * Algorithm: AES-256-GCM (Authenticated Encryption with Associated Data)
 * Key: Dedicated 256-bit (32 bytes) key from WIFI_CREDENTIAL_ENCRYPTION_KEY
 * IV: 96-bit (12 bytes) cryptographically secure random buffer per encryption
 * Tag: 128-bit (16 bytes) authentication tag
 * AAD: Room-specific binding ('room:<roomId>')
 * Payload Format: 'v1:<iv_hex>:<tag_hex>:<ciphertext_hex>'
 *
 * Compatible with Node.js crypto and Cloudflare Worker Web Crypto (crypto.subtle)
 */

const crypto = require('crypto');

const PAYLOAD_REGEX = /^v1:([0-9a-fA-F]{24}):([0-9a-fA-F]{32}):([0-9a-fA-F]+)$/;

/**
 * Validate that a key string represents a valid 256-bit (32-byte) key.
 * Supports:
 * - 64-character hex string
 * - 44-character base64 string
 */
function isValidKey(keyInput) {
  if (!keyInput || typeof keyInput !== 'string') return false;
  const trimmed = keyInput.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return true;
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    return buf.length === 32;
  }
  return false;
}

/**
 * Parses key input into a 32-byte Buffer.
 * Throws explicit error if missing or invalid.
 */
function parseKey(keyInput) {
  if (!keyInput || typeof keyInput !== 'string') {
    const err = new Error('WIFI_CREDENTIAL_ENCRYPTION_KEY is missing');
    err.code = 'ERR_WIFI_KEY_MISSING';
    throw err;
  }
  const trimmed = keyInput.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) return buf;
  }
  const err = new Error('WIFI_CREDENTIAL_ENCRYPTION_KEY must be a 256-bit key (64 hex characters or 44 base64 characters)');
  err.code = 'ERR_WIFI_KEY_INVALID';
  throw err;
}

/**
 * Gets the active encryption key from process.env or argument.
 */
function getActiveKey(customKey) {
  const rawKey = customKey || (typeof process !== 'undefined' && process.env?.WIFI_CREDENTIAL_ENCRYPTION_KEY);
  return parseKey(rawKey);
}

/**
 * Node.js crypto AES-256-GCM Encrypt
 */
function encryptWifiPasswordNode(plaintext, keyInput, roomId) {
  if (plaintext === null || plaintext === undefined || typeof plaintext !== 'string') {
    throw new Error('Plaintext password must be a string');
  }
  if (!roomId && roomId !== 0) {
    throw new Error('roomId is required for room-specific AAD binding');
  }
  const keyBuf = Buffer.isBuffer(keyInput) ? keyInput : parseKey(keyInput);
  const iv = crypto.randomBytes(12); // 96-bit IV
  const aad = Buffer.from(`room:${roomId}`, 'utf8');

  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 128-bit tag

  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Node.js crypto AES-256-GCM Decrypt
 */
function decryptWifiPasswordNode(payload, keyInput, roomId) {
  if (!payload || typeof payload !== 'string') {
    const err = new Error('Invalid payload string');
    err.code = 'ERR_WIFI_BAD_PAYLOAD';
    throw err;
  }
  if (!roomId && roomId !== 0) {
    throw new Error('roomId is required for room-specific AAD verification');
  }
  const match = payload.trim().match(PAYLOAD_REGEX);
  if (!match) {
    const err = new Error('Payload does not match versioned format v1:<iv>:<tag>:<ciphertext>');
    err.code = 'ERR_WIFI_BAD_PAYLOAD';
    throw err;
  }

  const [, ivHex, tagHex, ctHex] = match;
  const keyBuf = Buffer.isBuffer(keyInput) ? keyInput : parseKey(keyInput);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const aad = Buffer.from(`room:${roomId}`, 'utf8');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    const authErr = new Error('Wi-Fi credential authentication failed (wrong key, wrong room, or tampered payload)');
    authErr.code = 'ERR_WIFI_AUTH_FAILED';
    authErr.originalError = err.message;
    throw authErr;
  }
}

/**
 * Web Crypto (crypto.subtle) AES-256-GCM Encrypt
 */
async function encryptWifiPasswordWebCrypto(plaintext, keyInput, roomId, subtleInstance) {
  if (plaintext === null || plaintext === undefined || typeof plaintext !== 'string') {
    throw new Error('Plaintext password must be a string');
  }
  if (!roomId && roomId !== 0) {
    throw new Error('roomId is required for room-specific AAD binding');
  }
  const subtle = subtleInstance || (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle);
  if (!subtle) {
    throw new Error('crypto.subtle is not available in current environment');
  }
  const keyBuf = Buffer.isBuffer(keyInput) ? keyInput : parseKey(keyInput);
  const iv = new Uint8Array(12);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(iv);
  } else {
    const rb = crypto.randomBytes(12);
    iv.set(new Uint8Array(rb));
  }

  const aad = new TextEncoder().encode(`room:${roomId}`);
  const ptBytes = new TextEncoder().encode(plaintext);

  const cryptoKey = await subtle.importKey('raw', keyBuf, 'AES-GCM', false, ['encrypt']);
  const encryptedBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    cryptoKey,
    ptBytes
  );

  const totalBytes = new Uint8Array(encryptedBuf);
  // In Web Crypto, the 16-byte tag is appended at the end of ciphertext
  const ctBytes = totalBytes.slice(0, totalBytes.length - 16);
  const tagBytes = totalBytes.slice(totalBytes.length - 16);

  const ivHex = Buffer.from(iv).toString('hex');
  const tagHex = Buffer.from(tagBytes).toString('hex');
  const ctHex = Buffer.from(ctBytes).toString('hex');

  return `v1:${ivHex}:${tagHex}:${ctHex}`;
}

/**
 * Web Crypto (crypto.subtle) AES-256-GCM Decrypt
 */
async function decryptWifiPasswordWebCrypto(payload, keyInput, roomId, subtleInstance) {
  if (!payload || typeof payload !== 'string') {
    const err = new Error('Invalid payload string');
    err.code = 'ERR_WIFI_BAD_PAYLOAD';
    throw err;
  }
  if (!roomId && roomId !== 0) {
    throw new Error('roomId is required for room-specific AAD verification');
  }
  const match = payload.trim().match(PAYLOAD_REGEX);
  if (!match) {
    const err = new Error('Payload does not match versioned format v1:<iv>:<tag>:<ciphertext>');
    err.code = 'ERR_WIFI_BAD_PAYLOAD';
    throw err;
  }

  const [, ivHex, tagHex, ctHex] = match;
  const subtle = subtleInstance || (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle);
  if (!subtle) {
    throw new Error('crypto.subtle is not available in current environment');
  }

  const keyBuf = Buffer.isBuffer(keyInput) ? keyInput : parseKey(keyInput);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const aad = new TextEncoder().encode(`room:${roomId}`);

  // Recombine ct + tag for Web Crypto decrypt
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(new Uint8Array(ct), 0);
  combined.set(new Uint8Array(tag), ct.length);

  try {
    const cryptoKey = await subtle.importKey('raw', keyBuf, 'AES-GCM', false, ['decrypt']);
    const decryptedBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: aad, tagLength: 128 },
      cryptoKey,
      combined
    );
    return new TextDecoder().decode(decryptedBuf);
  } catch (err) {
    const authErr = new Error('Wi-Fi credential authentication failed (wrong key, wrong room, or tampered payload)');
    authErr.code = 'ERR_WIFI_AUTH_FAILED';
    authErr.originalError = err.message;
    throw authErr;
  }
}

/**
 * Standard environment wrapper for encryption.
 */
function encryptWifiPassword(plaintext, roomId, customKey) {
  const key = getActiveKey(customKey);
  return encryptWifiPasswordNode(plaintext, key, roomId);
}

/**
 * Standard environment wrapper for decryption.
 */
function decryptWifiPassword(payload, roomId, customKey) {
  const key = getActiveKey(customKey);
  return decryptWifiPasswordNode(payload, key, roomId);
}

/**
 * Verify if a string matches the encrypted payload pattern.
 */
function isEncryptedWifiPayload(value) {
  return typeof value === 'string' && PAYLOAD_REGEX.test(value.trim());
}

module.exports = {
  PAYLOAD_REGEX,
  isValidKey,
  parseKey,
  getActiveKey,
  encryptWifiPasswordNode,
  decryptWifiPasswordNode,
  encryptWifiPasswordWebCrypto,
  decryptWifiPasswordWebCrypto,
  encryptWifiPassword,
  decryptWifiPassword,
  isEncryptedWifiPayload
};
