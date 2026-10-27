/**
 * BWORK-POS — STAGING SECRETS & WI-FI FIXTURE PROVISIONER
 * Phase: RELEASE-2C
 *
 * Securely generates staging JWT_SECRET and WIFI_CREDENTIAL_ENCRYPTION_KEY in memory,
 * pipes them directly to `wrangler secret put` stdin (zero CLI argument or log leakage),
 * encrypts Room 5 Wi-Fi credentials with the provisioned key, and applies the fixture to Staging D1.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execSync } = require('child_process');
const { parseWifiKey, encryptWifiPassword, decryptWifiPassword } = require('./generate_staging_wifi_fixture.cjs');

const ROOT = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const WRANGLER_STAGING = path.join(BACKEND_DIR, 'wrangler.staging.toml');

function putSecretViaStdin(secretName, secretValue) {
  console.log(`Provisioning staging secret: ${secretName}...`);
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'cmd.exe' : 'npx';
  const args = isWin
    ? ['/c', `npx wrangler secret put ${secretName} --config wrangler.staging.toml`]
    : ['wrangler', 'secret', 'put', secretName, '--config', 'wrangler.staging.toml'];

  const res = spawnSync(cmd, args, {
    cwd: BACKEND_DIR,
    input: secretValue + '\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (res.status !== 0) {
    throw new Error(`Failed to set secret ${secretName}: ${res.stderr || res.stdout}`);
  }
  console.log(`  [OK] Secret ${secretName} successfully provisioned on bwork-pos-api-staging.`);
}

function main() {
  console.log('====================================================');
  console.log('  PROVISIONING STAGING SECRETS & WI-FI FIXTURE');
  console.log('====================================================\n');

  // 1. Verify wrangler.staging.toml
  const tomlContent = fs.readFileSync(WRANGLER_STAGING, 'utf8');
  if (!tomlContent.includes('name = "bwork-pos-api-staging"')) {
    throw new Error('wrangler.staging.toml must target bwork-pos-api-staging');
  }
  if (!tomlContent.includes('8511096e-3c57-428f-8b2c-98fdb297f705')) {
    throw new Error('wrangler.staging.toml missing verified staging D1 UUID');
  }

  // 2. Generate secrets in memory
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const wifiKeyHex = crypto.randomBytes(32).toString('hex');
  const wifiKeyBuf = parseWifiKey(wifiKeyHex);

  // 3. Put secrets via stdin
  putSecretViaStdin('JWT_SECRET', jwtSecret);
  putSecretViaStdin('WIFI_CREDENTIAL_ENCRYPTION_KEY', wifiKeyHex);

  // 4. Encrypt Room 5 Wi-Fi password
  const roomId = 5;
  const username = 'staging_room_302';
  const plaintext = 'StagingWiFi2026';
  const payload = encryptWifiPassword(plaintext, wifiKeyBuf, roomId);

  // Verify roundtrip
  const decrypted = decryptWifiPassword(payload, wifiKeyBuf, roomId);
  if (decrypted !== plaintext) {
    throw new Error('Decryption self-test failed');
  }
  console.log('\nRoom 5 encrypted payload generated and verified in-memory.');

  // 5. Update Room 5 in remote Staging D1 via temp sql file
  const os = require('os');
  const tempSqlFile = path.join(os.tmpdir(), `update_room5_${Date.now()}.sql`);
  const sql = `UPDATE rooms SET wifi_username = '${username}', wifi_password_enc = '${payload}' WHERE id = ${roomId};\n`;
  fs.writeFileSync(tempSqlFile, sql, 'utf8');

  console.log('Applying Room 5 encrypted Wi-Fi fixture to remote Staging D1...');
  try {
    const isWin = process.platform === 'win32';
    const d1Cmd = isWin
      ? `cmd.exe /c "npx wrangler d1 execute bworkpos_staging_db --remote --file="${tempSqlFile}" --config wrangler.staging.toml"`
      : `npx wrangler d1 execute bworkpos_staging_db --remote --file="${tempSqlFile}" --config wrangler.staging.toml`;

    execSync(d1Cmd, { cwd: BACKEND_DIR, stdio: 'inherit' });
    console.log('  [OK] Staging D1 Room 5 Wi-Fi credentials updated successfully.\n');
  } finally {
    if (fs.existsSync(tempSqlFile)) {
      fs.unlinkSync(tempSqlFile);
    }
  }

  console.log('====================================================');
  console.log('STATUS: SECRETS PROVISIONED & FIXTURE APPLIED SECURELY');
  console.log('====================================================');
}

main();
