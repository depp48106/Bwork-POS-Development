/**
 * BWORK-POS — STAGING WI-FI FIXTURE GENERATOR
 * Phase: RELEASE-2B.3 Hardened
 *
 * Generates valid AES-256-GCM encrypted Wi-Fi credentials for staging rooms
 * using the staging encryption key and room-specific AAD.
 *
 * Security:
 *   Keys are NEVER accepted via CLI arguments (to avoid process table / shell history leakage).
 *   Keys must be provided via STAGING_WIFI_KEY environment variable or piped via stdin.
 *   Use --generate for in-memory temporary test key generation.
 *
 * Usage:
 *   $env:STAGING_WIFI_KEY="<key>"; node scripts/generate_staging_wifi_fixture.cjs [--room 5] [--username "staging_room_302"] [--password "StagingWiFi2026"]
 *   echo "<key>" | node scripts/generate_staging_wifi_fixture.cjs --stdin
 *   node scripts/generate_staging_wifi_fixture.cjs --generate
 */

const fs = require('fs');
const crypto = require('crypto');

function parseWifiKey(keyInput) {
  if (!keyInput || typeof keyInput !== 'string') {
    throw new Error('WIFI_CREDENTIAL_ENCRYPTION_KEY is required (64-char hex or 44-char base64)');
  }
  const trimmed = keyInput.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    return Buffer.from(trimmed, 'base64');
  }
  throw new Error('Invalid key format. Must be 64 hex characters or 44 base64 characters');
}

function encryptWifiPassword(plaintext, keyBuffer, roomId) {
  const iv = crypto.randomBytes(12); // 96-bit IV
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const aad = Buffer.from(`room:${roomId}`, 'utf8');
  cipher.setAAD(aad);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 128-bit tag

  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptWifiPassword(payload, keyBuffer, roomId) {
  const match = payload.match(/^v1:([0-9a-fA-F]{24}):([0-9a-fA-F]{32}):([0-9a-fA-F]+)$/);
  if (!match) throw new Error('Invalid payload format');

  const iv = Buffer.from(match[1], 'hex');
  const tag = Buffer.from(match[2], 'hex');
  const ct = Buffer.from(match[3], 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAAD(Buffer.from(`room:${roomId}`, 'utf8'));
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
  return decrypted.toString('utf8');
}

function getKey(args) {
  // Disallow keys passed directly on command line
  for (const arg of args) {
    if (/^[0-9a-fA-F]{64}$/.test(arg) || /^[A-Za-z0-9+/]{43}=$/.test(arg)) {
      throw new Error(
        'SECURITY VIOLATION: Providing encryption keys via command line arguments is prohibited.\n' +
        'Keys are exposed in OS process listings and shell history.\n' +
        'Please pass via STAGING_WIFI_KEY environment variable, pipe via stdin (--stdin), or use --generate.'
      );
    }
  }

  if (args.includes('--generate')) {
    // Generate in-memory 32-byte key
    return { keyStr: crypto.randomBytes(32).toString('hex'), isGenerated: true };
  }

  if (args.includes('--stdin') || (!process.stdin.isTTY && !args.includes('--help'))) {
    try {
      const stdinData = fs.readFileSync(0, 'utf-8').trim();
      if (stdinData) {
        return { keyStr: stdinData, isGenerated: false };
      }
    } catch {
      // stdin not readable
    }
  }

  const envKey = process.env.STAGING_WIFI_KEY || process.env.WIFI_CREDENTIAL_ENCRYPTION_KEY;
  if (envKey) {
    return { keyStr: envKey.trim(), isGenerated: false };
  }

  return null;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage:
  node scripts/generate_staging_wifi_fixture.cjs [options]

Options:
  --generate                 Generate a random 32-byte key in-memory for testing
  --stdin                    Read encryption key securely from standard input
  --room <number>            Room ID (default: 5)
  --username <string>        Wi-Fi Username (default: staging_room_302)
  --password <string>        Plaintext Password to encrypt (default: StagingWiFi2026)

Environment Variables:
  STAGING_WIFI_KEY           64-hex character encryption key
  WIFI_CREDENTIAL_ENCRYPTION_KEY  Fallback env var for key
`);
    return;
  }

  // Parse options
  let roomId = 5;
  let username = 'staging_room_302';
  let plaintext = 'StagingWiFi2026';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--room' && args[i + 1]) {
      roomId = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--username' && args[i + 1]) {
      username = args[i + 1];
      i++;
    } else if (args[i] === '--password' && args[i + 1]) {
      plaintext = args[i + 1];
      i++;
    }
  }

  const keyResult = getKey(args);
  if (!keyResult) {
    console.error('ERROR: No encryption key provided.');
    console.error('Set STAGING_WIFI_KEY environment variable, pipe via stdin, or pass --generate.');
    process.exit(1);
  }

  const { keyStr, isGenerated } = keyResult;
  const keyBuf = parseWifiKey(keyStr);
  const payload = encryptWifiPassword(plaintext, keyBuf, roomId);
  const decrypted = decryptWifiPassword(payload, keyBuf, roomId);

  if (decrypted !== plaintext) {
    throw new Error('Self-test roundtrip verification failed');
  }

  console.log('====================================================');
  console.log('  STAGING ROOM WI-FI CREDENTIAL FIXTURE GENERATOR');
  console.log('====================================================');
  console.log(`  Room ID:           ${roomId}`);
  console.log(`  Wi-Fi Username:    ${username}`);
  console.log(`  Encrypted Payload: ${payload}`);
  console.log(`  Decryption Check:  VERIFIED MATCH`);
  if (isGenerated) {
    console.log('  Key Mode:          IN-MEMORY GENERATED (Key was NOT printed to avoid logging)');
  } else {
    console.log('  Key Source:        SECURE ENVIRONMENT / STDIN');
  }
  console.log('\nCloudflare D1 SQL command to apply in staging:');
  console.log(`npx wrangler d1 execute bworkpos_staging_db --remote --command "UPDATE rooms SET wifi_username = '${username}', wifi_password_enc = '${payload}' WHERE id = ${roomId};" --config wrangler.staging.toml`);
  console.log('====================================================');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

module.exports = { parseWifiKey, encryptWifiPassword, decryptWifiPassword, getKey };
