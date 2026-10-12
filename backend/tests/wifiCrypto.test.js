const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  isValidKey,
  parseKey,
  encryptWifiPasswordNode,
  decryptWifiPasswordNode,
  encryptWifiPasswordWebCrypto,
  decryptWifiPasswordWebCrypto,
  encryptWifiPassword,
  decryptWifiPassword,
  isEncryptedWifiPayload
} = require('../wifiCryptoHelper');

// Generate test-only keys
const TEST_KEY_HEX = crypto.randomBytes(32).toString('hex');
const TEST_KEY_2_HEX = crypto.randomBytes(32).toString('hex');
const TEST_KEY_BASE64 = crypto.randomBytes(32).toString('base64');

test('BWORK-POS Wi-Fi Credential Encryption Foundation (AES-256-GCM)', async (t) => {

  await t.test('1. Secret Key Validation & Parsing', () => {
    // Valid 64-char hex key
    assert.strictEqual(isValidKey(TEST_KEY_HEX), true, 'Valid 64-hex key is recognized');
    const parsedHex = parseKey(TEST_KEY_HEX);
    assert.strictEqual(parsedHex.length, 32, 'Parsed hex key is exactly 32 bytes');

    // Valid 44-char base64 key
    assert.strictEqual(isValidKey(TEST_KEY_BASE64), true, 'Valid 44-char base64 key is recognized');
    const parsedBase64 = parseKey(TEST_KEY_BASE64);
    assert.strictEqual(parsedBase64.length, 32, 'Parsed base64 key is exactly 32 bytes');

    // Invalid keys
    assert.strictEqual(isValidKey(''), false, 'Empty string is rejected');
    assert.strictEqual(isValidKey(null), false, 'Null is rejected');
    assert.strictEqual(isValidKey(undefined), false, 'Undefined is rejected');
    assert.strictEqual(isValidKey('short-key'), false, 'Short key is rejected');
    assert.strictEqual(isValidKey('g'.repeat(64)), false, 'Non-hex 64-char string is rejected');
    assert.strictEqual(isValidKey(TEST_KEY_HEX.substring(0, 62)), false, 'Truncated hex key is rejected');

    // Missing key error code
    assert.throws(() => parseKey(null), (err) => {
      return err.code === 'ERR_WIFI_KEY_MISSING';
    }, 'Throws ERR_WIFI_KEY_MISSING when key is null');

    // Invalid key error code
    assert.throws(() => parseKey('invalid-key-length'), (err) => {
      return err.code === 'ERR_WIFI_KEY_INVALID';
    }, 'Throws ERR_WIFI_KEY_INVALID when key is malformed');
  });

  await t.test('2. Node.js Crypto Roundtrip & Payload Format', () => {
    const originalPassword = 'P@ssw0rd_Bw#2026_รหัสไวไฟ';
    const roomId = 5;

    const encrypted = encryptWifiPasswordNode(originalPassword, TEST_KEY_HEX, roomId);
    assert.ok(isEncryptedWifiPayload(encrypted), 'Encrypted string matches versioned format v1:<iv>:<tag>:<ct>');

    const [ver, ivHex, tagHex, ctHex] = encrypted.split(':');
    assert.strictEqual(ver, 'v1', 'Uses version tag v1');
    assert.strictEqual(ivHex.length, 24, 'IV is 12 bytes (24 hex characters)');
    assert.strictEqual(tagHex.length, 32, 'Auth tag is 16 bytes (32 hex characters)');
    assert.ok(ctHex.length > 0, 'Ciphertext is non-empty');

    const decrypted = decryptWifiPasswordNode(encrypted, TEST_KEY_HEX, roomId);
    assert.strictEqual(decrypted, originalPassword, 'Decrypted password matches original text with Thai & symbols');
  });

  await t.test('3. Unique IV Generation (No IV Reuse)', () => {
    const password = 'StaticPassword123';
    const roomId = 1;

    const enc1 = encryptWifiPasswordNode(password, TEST_KEY_HEX, roomId);
    const enc2 = encryptWifiPasswordNode(password, TEST_KEY_HEX, roomId);

    assert.notStrictEqual(enc1, enc2, 'Two encryptions of the same plaintext produce different outputs');
    const iv1 = enc1.split(':')[1];
    const iv2 = enc2.split(':')[1];
    assert.notStrictEqual(iv1, iv2, 'IVs are cryptographically distinct across calls');
  });

  await t.test('4. Room-Specific AAD Binding & Wrong-Room Rejection', () => {
    const password = 'Room1SecretPassword';
    const encRoom1 = encryptWifiPasswordNode(password, TEST_KEY_HEX, 101);

    // Decrypting with correct room succeeds
    const decRoom1 = decryptWifiPasswordNode(encRoom1, TEST_KEY_HEX, 101);
    assert.strictEqual(decRoom1, password, 'Decrypts with matching room ID 101');

    // Attempting to decrypt with different room ID fails authentication
    assert.throws(() => {
      decryptWifiPasswordNode(encRoom1, TEST_KEY_HEX, 102);
    }, (err) => {
      return err.code === 'ERR_WIFI_AUTH_FAILED';
    }, 'Throws ERR_WIFI_AUTH_FAILED when room ID does not match AAD');
  });

  await t.test('5. Cryptographic Tampering Detection', () => {
    const password = 'TamperTestPassword';
    const roomId = 3;
    const enc = encryptWifiPasswordNode(password, TEST_KEY_HEX, roomId);
    const parts = enc.split(':');

    // 1. Tamper IV
    const tamperedIv = parts[0] + ':' + (parts[1].startsWith('a') ? 'b' : 'a') + parts[1].substring(1) + ':' + parts[2] + ':' + parts[3];
    assert.throws(() => decryptWifiPasswordNode(tamperedIv, TEST_KEY_HEX, roomId), (err) => err.code === 'ERR_WIFI_AUTH_FAILED', 'Tampered IV rejected');

    // 2. Tamper Tag
    const tamperedTag = parts[0] + ':' + parts[1] + ':' + (parts[2].startsWith('a') ? 'b' : 'a') + parts[2].substring(1) + ':' + parts[3];
    assert.throws(() => decryptWifiPasswordNode(tamperedTag, TEST_KEY_HEX, roomId), (err) => err.code === 'ERR_WIFI_AUTH_FAILED', 'Tampered Tag rejected');

    // 3. Tamper Ciphertext
    const tamperedCt = parts[0] + ':' + parts[1] + ':' + parts[2] + ':' + (parts[3].startsWith('a') ? 'b' : 'a') + parts[3].substring(1);
    assert.throws(() => decryptWifiPasswordNode(tamperedCt, TEST_KEY_HEX, roomId), (err) => err.code === 'ERR_WIFI_AUTH_FAILED', 'Tampered Ciphertext rejected');
  });

  await t.test('6. Wrong Key Rejection', () => {
    const password = 'KeyTestPassword';
    const roomId = 7;
    const enc = encryptWifiPasswordNode(password, TEST_KEY_HEX, roomId);

    assert.throws(() => {
      decryptWifiPasswordNode(enc, TEST_KEY_2_HEX, roomId);
    }, (err) => {
      return err.code === 'ERR_WIFI_AUTH_FAILED';
    }, 'Throws ERR_WIFI_AUTH_FAILED when decrypted with a different key');
  });

  await t.test('7. Cross-Runtime Parity: Node.js Encrypt -> Web Crypto Decrypt', async () => {
    const password = 'CrossRuntime_Node_To_WebCrypto';
    const roomId = 12;

    const encNode = encryptWifiPasswordNode(password, TEST_KEY_HEX, roomId);
    const decWeb = await decryptWifiPasswordWebCrypto(encNode, TEST_KEY_HEX, roomId, globalThis.crypto.subtle);

    assert.strictEqual(decWeb, password, 'Web Crypto decrypts ciphertext produced by Node.js crypto');
  });

  await t.test('8. Cross-Runtime Parity: Web Crypto Encrypt -> Node.js Decrypt', async () => {
    const password = 'CrossRuntime_WebCrypto_To_Node';
    const roomId = 15;

    const encWeb = await encryptWifiPasswordWebCrypto(password, TEST_KEY_HEX, roomId, globalThis.crypto.subtle);
    assert.ok(isEncryptedWifiPayload(encWeb), 'Web Crypto output satisfies versioned payload regex');

    const decNode = decryptWifiPasswordNode(encWeb, TEST_KEY_HEX, roomId);
    assert.strictEqual(decNode, password, 'Node.js crypto decrypts ciphertext produced by Web Crypto');
  });

  await t.test('9. Web Crypto Pure Roundtrip', async () => {
    const password = 'Pure_WebCrypto_Roundtrip_Pass!#';
    const roomId = 20;

    const enc = await encryptWifiPasswordWebCrypto(password, TEST_KEY_HEX, roomId, globalThis.crypto.subtle);
    const dec = await decryptWifiPasswordWebCrypto(enc, TEST_KEY_HEX, roomId, globalThis.crypto.subtle);

    assert.strictEqual(dec, password, 'Web Crypto encrypt & decrypt roundtrips accurately');
  });

  await t.test('10. Fail-Closed on Missing Environment Key', () => {
    const oldEnv = process.env.WIFI_CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.WIFI_CREDENTIAL_ENCRYPTION_KEY;

    try {
      assert.throws(() => {
        encryptWifiPassword('any_pass', 1);
      }, (err) => err.code === 'ERR_WIFI_KEY_MISSING', 'Fails closed on encrypt when env key missing');

      assert.throws(() => {
        decryptWifiPassword('v1:012345678901234567890123:01234567890123456789012345678901:abcd', 1);
      }, (err) => err.code === 'ERR_WIFI_KEY_MISSING', 'Fails closed on decrypt when env key missing');
    } finally {
      if (oldEnv) process.env.WIFI_CREDENTIAL_ENCRYPTION_KEY = oldEnv;
    }
  });
});
