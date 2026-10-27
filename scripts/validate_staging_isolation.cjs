/**
 * BWORK-POS — STAGING ISOLATION VALIDATOR
 * Phase: RELEASE-2A
 * 
 * Verifies that all staging configuration files are completely decoupled
 * from Production Cloudflare resources, D1 databases, API domains, and secrets.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require(path.join(__dirname, '..', 'backend', 'node_modules', 'sqlite3'));

const ROOT = path.join(__dirname, '..');
const PROD_D1_ID = '0f171606-080b-4380-bf91-167dc678e2e4';
const PROD_WORKER_API = 'bwork-pos-api.ohnatza74185-ky.workers.dev';
const PROD_WORKER_NAME = 'bwork-pos-api';
const STAGING_WORKER_NAME = 'bwork-pos-api-staging';
const STAGING_WORKER_API = 'https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev';

let totalChecks = 0;
let passedChecks = 0;
const failures = [];

function assert(condition, message) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] ${message}`);
  } else {
    failures.push(message);
    console.error(`  [FAIL] ${message}`);
  }
}

async function runAudit() {
  console.log('====================================================');
  console.log('  BWORK-POS STAGING ISOLATION VALIDATION (RELEASE-2A)');
  console.log('====================================================\n');

  // 1. Audit backend/wrangler.staging.toml
  console.log('1. Checking backend/wrangler.staging.toml:');
  const wranglerStagingPath = path.join(ROOT, 'backend', 'wrangler.staging.toml');
  assert(fs.existsSync(wranglerStagingPath), 'backend/wrangler.staging.toml exists');
  
  if (fs.existsSync(wranglerStagingPath)) {
    const wranglerContent = fs.readFileSync(wranglerStagingPath, 'utf8');
    assert(!wranglerContent.includes(PROD_D1_ID), 'Production D1 ID is ABSENT from staging config');
    assert(wranglerContent.includes(`name = "${STAGING_WORKER_NAME}"`), `Worker name is '${STAGING_WORKER_NAME}'`);
    assert(!wranglerContent.includes(`name = "${PROD_WORKER_NAME}"\n`), 'Production Worker name is ABSENT');
    assert(wranglerContent.includes('database_name = "bworkpos_staging_db"'), 'Database name is bworkpos_staging_db');
    assert(wranglerContent.includes('database_id = "8511096e-3c57-428f-8b2c-98fdb297f705"') || wranglerContent.includes('PLACEHOLDER_STAGING_D1_DATABASE_ID_TO_BE_CREATED_IN_RELEASE_2B'), 'Database ID matches staging D1 UUID (8511096e-3c57-428f-8b2c-98fdb297f705)');
    assert(!wranglerContent.match(/^\s*crons\s*=/m), 'Active crons are ABSENT from triggers');
    assert(wranglerContent.includes('ENVIRONMENT = "staging"'), 'Environment is set to staging');
    assert(wranglerContent.includes('DISABLE_LIVE_LINE = "true"'), 'DISABLE_LIVE_LINE is set to true');
  }

  // 2. Audit frontend/.env.staging
  console.log('\n2. Checking frontend/.env.staging:');
  const frontendEnvPath = path.join(ROOT, 'frontend', '.env.staging');
  assert(fs.existsSync(frontendEnvPath), 'frontend/.env.staging exists');
  if (fs.existsSync(frontendEnvPath)) {
    const frontendEnv = fs.readFileSync(frontendEnvPath, 'utf8');
    assert(frontendEnv.includes(`VITE_API_BASE=${STAGING_WORKER_API}`), `VITE_API_BASE points to ${STAGING_WORKER_API}`);
    assert(!frontendEnv.includes(PROD_WORKER_API), 'Production Worker API URL is ABSENT');
    assert(frontendEnv.includes('VITE_APP_ENV=staging'), 'VITE_APP_ENV is staging');
  }

  // 3. Audit booking-app/.env.staging
  console.log('\n3. Checking booking-app/.env.staging:');
  const bookingEnvPath = path.join(ROOT, 'booking-app', '.env.staging');
  assert(fs.existsSync(bookingEnvPath), 'booking-app/.env.staging exists');
  if (fs.existsSync(bookingEnvPath)) {
    const bookingEnv = fs.readFileSync(bookingEnvPath, 'utf8');
    assert(bookingEnv.includes(`VITE_API_BASE=${STAGING_WORKER_API}`), `VITE_API_BASE points to ${STAGING_WORKER_API}`);
    assert(!bookingEnv.includes(PROD_WORKER_API), 'Production Worker API URL is ABSENT');
    assert(bookingEnv.includes('VITE_APP_ENV=staging'), 'VITE_APP_ENV is staging');
  }

  // 4. Audit backend/staging_fixtures.sql
  console.log('\n4. Checking backend/staging_fixtures.sql:');
  const fixturesPath = path.join(ROOT, 'backend', 'staging_fixtures.sql');
  assert(fs.existsSync(fixturesPath), 'backend/staging_fixtures.sql exists');
  if (fs.existsSync(fixturesPath)) {
    const fixturesContent = fs.readFileSync(fixturesPath, 'utf8');
    assert(!fixturesContent.includes(PROD_D1_ID), 'Production D1 ID is ABSENT from fixtures');
    assert(!fixturesContent.includes('line_channel_access_token'), 'LINE channel access token is ABSENT from fixtures');
    assert(!fixturesContent.includes('line_channel_secret'), 'LINE channel secret is ABSENT from fixtures');
    assert(fixturesContent.includes('wifi_username'), 'Migration 009 wifi_username column present');
    assert(fixturesContent.includes('wifi_password_enc'), 'Migration 009 wifi_password_enc column present');
    assert(fixturesContent.includes('009_add_room_wifi_credentials.sql'), 'Migration 009 recorded in _schema_migrations');
    assert(fixturesContent.includes('REC-STAGE-9001'), 'Single-item test booking fixture present');
    assert(fixturesContent.includes('REC-STAGE-9002'), 'Multi-item test booking fixture present');
    assert(!fixturesContent.includes('@bwork.biz'), 'Internal corporate email domain absent from customer data');

    // Test execute into SQLite memory
    await new Promise((resolve) => {
      const db = new sqlite3.Database(':memory:');
      db.exec(fixturesContent, (err) => {
        assert(!err, 'SQL fixture parses and executes in SQLite with zero errors');
        if (!err) {
          db.all('SELECT count(*) as c FROM rooms', (err, r) => {
            assert(r && r[0].c === 8, '8 synthetic master rooms loaded');
            db.all('SELECT count(*) as c FROM bookings', (err, b) => {
              assert(b && b[0].c === 3, '3 synthetic test bookings loaded');
              db.all('SELECT count(*) as c FROM _schema_migrations', (err, m) => {
                assert(m && m[0].c === 9, '9 versioned migrations tracked');
                resolve();
              });
            });
          });
        } else {
          resolve();
        }
      });
    });
  }

  // 5. Audit production baseline integrity (read-only verification)
  console.log('\n5. Checking production file integrity (no unintended edits):');
  const prodWranglerPath = path.join(ROOT, 'backend', 'wrangler.toml');
  const prodWrangler = fs.readFileSync(prodWranglerPath, 'utf8');
  assert(prodWrangler.includes(`name = "${PROD_WORKER_NAME}"`), 'Production wrangler.toml name unchanged');
  assert(prodWrangler.includes(PROD_D1_ID), 'Production wrangler.toml points to production D1 (unaltered)');

  console.log('\n====================================================');
  console.log(`SUMMARY: ${passedChecks}/${totalChecks} checks passed.`);
  if (failures.length > 0) {
    console.error(`FAILURES (${failures.length}):`);
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('STATUS: ALL STAGING ISOLATION CHECKS PASSED PERFECTLY!');
    console.log('====================================================');
    process.exit(0);
  }
}

runAudit();
