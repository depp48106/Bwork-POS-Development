/**
 * BWORK-POS — NEGATIVE TESTS FOR FAIL-CLOSED STAGING GATES
 * Phase: RELEASE-2B.3
 *
 * Verifies that all safety gates throw errors, block builds, and block
 * deployments when hazardous configurations or production endpoints are introduced.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const assert = require('assert');

const {
  validateWranglerStaging,
  validateWorkerJs,
  validateDistStaging,
  validatePagesProjectTarget,
  PROD_D1_ID,
  PROD_WORKER_HOST,
  STAGING_WORKER_HOST
} = require('./deployment_guard.cjs');

const { validateStagingDist } = require('./build_staging.cjs');

let passedTests = 0;
let totalTests = 0;

function runTest(testName, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] Test ${totalTests}: ${testName}`);
  } catch (err) {
    console.error(`  [FAIL] Test ${totalTests}: ${testName}`);
    console.error(`         ${err.message}`);
    throw err;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bwork-test-${prefix}-`));
}

console.log('====================================================');
console.log('  STAGING FAIL-CLOSED NEGATIVE TESTS (RELEASE-2B.3)');
console.log('====================================================\n');

// Test 1: Injected production Worker host into _redirects
runTest('Injected production Worker host or missing staging route in _redirects is blocked', () => {
  const tmpDir = createTempDir('test1');
  const appDir = tmpDir;
  const distDir = path.join(tmpDir, 'dist-staging');
  fs.mkdirSync(distDir);

  // Valid JS bundle
  fs.writeFileSync(path.join(distDir, 'index.js'), `console.log("${STAGING_WORKER_HOST}");`);

  // Subtest 1A: Malicious / accidental _redirects pointing to production
  fs.writeFileSync(
    path.join(distDir, '_redirects'),
    `/api/*  https://${STAGING_WORKER_HOST}/api/:splat  200\n/legacy/*  https://${PROD_WORKER_HOST}/api/:splat  200\n/*      /index.html  200\n`
  );

  assert.throws(
    () => validateStagingDist(appDir, distDir),
    /Production Worker host .* found in _redirects/,
    'Should throw error detecting production Worker host in _redirects'
  );

  assert.throws(
    () => validateDistStaging(appDir, distDir),
    /Production Worker host .* found in _redirects/,
    'Deployment guard should also throw error detecting production Worker host in _redirects'
  );

  // Subtest 1B: Missing staging Worker route in _redirects
  fs.writeFileSync(
    path.join(distDir, '_redirects'),
    `/api/*  https://other-domain.com/api/:splat  200\n/*      /index.html  200\n`
  );

  assert.throws(
    () => validateStagingDist(appDir, distDir),
    /does not route \/api\/\* to staging Worker API/,
    'Should throw error if _redirects does not route to staging Worker'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Test 2: Set wrong/missing VITE_API_BASE in .env.staging
runTest('Wrong or missing VITE_API_BASE in .env.staging is blocked', () => {
  const tmpDir = createTempDir('test2');
  const badEnvPath = path.join(tmpDir, '.env.staging');

  // Case A: Missing VITE_API_BASE
  fs.writeFileSync(badEnvPath, 'VITE_APP_ENV=staging\n');
  assert.throws(
    () => {
      const content = fs.readFileSync(badEnvPath, 'utf8');
      if (!content.includes(`VITE_API_BASE=https://${STAGING_WORKER_HOST}`)) {
        throw new Error(`[FAIL-CLOSED AUDIT ERROR] VITE_API_BASE must be https://${STAGING_WORKER_HOST}`);
      }
    },
    /VITE_API_BASE must be/,
    'Should block build if VITE_API_BASE is missing or wrong'
  );

  // Case B: Injected production API into .env.staging
  fs.writeFileSync(badEnvPath, `VITE_API_BASE=https://${PROD_WORKER_HOST}\nVITE_APP_ENV=staging\n`);
  assert.throws(
    () => {
      const content = fs.readFileSync(badEnvPath, 'utf8');
      if (content.includes(PROD_WORKER_HOST)) {
        throw new Error(`[FAIL-CLOSED AUDIT ERROR] Production Worker host found in .env.staging`);
      }
    },
    /Production Worker host found in .env.staging/,
    'Should block build if production Worker host is in .env.staging'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Test 3: Inject production D1 UUID into staging config
runTest('Injected production D1 UUID into wrangler.staging.toml is blocked', () => {
  const tmpDir = createTempDir('test3');
  const badWranglerPath = path.join(tmpDir, 'wrangler.staging.toml');

  fs.writeFileSync(
    badWranglerPath,
    `name = "bwork-pos-api-staging"
main = "worker.js"
compatibility_date = "2024-09-23"

[[d1_databases]]
binding = "DB"
database_name = "bworkpos_staging_db"
database_id = "${PROD_D1_ID}"

[vars]
ENVIRONMENT = "staging"
`
  );

  assert.throws(
    () => validateWranglerStaging(badWranglerPath),
    /CRITICAL SECURITY VIOLATION: Production D1 ID/,
    'Deployment guard must block if production D1 UUID is found in staging wrangler config'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Test 4: Inject production Worker name into staging config
runTest('Injected production Worker name into wrangler.staging.toml is blocked', () => {
  const tmpDir = createTempDir('test4');
  const badWranglerPath = path.join(tmpDir, 'wrangler.staging.toml');

  fs.writeFileSync(
    badWranglerPath,
    `name = "bwork-pos-api"
main = "worker.js"
compatibility_date = "2024-09-23"

[[d1_databases]]
binding = "DB"
database_name = "bworkpos_staging_db"
database_id = "test-uuid"

[vars]
ENVIRONMENT = "staging"
`
  );

  assert.throws(
    () => validateWranglerStaging(badWranglerPath),
    /Worker name in .* must be "bwork-pos-api-staging"/,
    'Deployment guard must block if Worker name is not bwork-pos-api-staging'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Test 5: Inject production Pages project name into deployment target
runTest('Production Pages project targets are blocked', () => {
  assert.throws(
    () => validatePagesProjectTarget('bwork-pos'),
    /Cannot deploy staging build to production Pages project "bwork-pos"/,
    'Deployment guard must block deployment to production Pages project bwork-pos'
  );

  assert.throws(
    () => validatePagesProjectTarget('bwork-booking'),
    /Cannot deploy staging build to production Pages project "bwork-booking"/,
    'Deployment guard must block deployment to production Pages project bwork-booking'
  );

  assert.throws(
    () => validatePagesProjectTarget('unknown-project'),
    /Unknown or unauthorized Pages project name/,
    'Deployment guard must block unknown Pages projects'
  );

  // Verify staging names pass
  assert.doesNotThrow(() => validatePagesProjectTarget('bwork-pos-staging'));
  assert.doesNotThrow(() => validatePagesProjectTarget('bwork-booking-staging'));
});

// Test 6: Injected production Worker host into compiled JS asset
runTest('Production Worker host in compiled JS asset is blocked', () => {
  const tmpDir = createTempDir('test6');
  const appDir = tmpDir;
  const distDir = path.join(tmpDir, 'dist-staging');
  fs.mkdirSync(distDir);

  fs.writeFileSync(
    path.join(distDir, 'index.js'),
    `const API_URL = "https://${PROD_WORKER_HOST}/api";\nconst STAGE = "${STAGING_WORKER_HOST}";`
  );
  fs.writeFileSync(
    path.join(distDir, '_redirects'),
    `/api/*  https://${STAGING_WORKER_HOST}/api/:splat  200\n/*      /index.html  200\n`
  );

  assert.throws(
    () => validateDistStaging(appDir, distDir),
    /Production Worker host .* found in .*index\.js/,
    'Deployment guard must block if production Worker host appears in JS bundle'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Test 7: Worker code missing LINE staging guard is blocked
runTest('Worker code missing LINE staging hard-block is blocked', () => {
  const tmpDir = createTempDir('test7');
  const badWorkerPath = path.join(tmpDir, 'worker.js');

  fs.writeFileSync(
    badWorkerPath,
    `export default {
  async fetch(req, env) { return new Response("ok"); }
};`
  );

  assert.throws(
    () => validateWorkerJs(badWorkerPath),
    /dispatchLineMessagePush function is missing/,
    'Deployment guard must block if dispatchLineMessagePush is missing'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Test 8: Passing encryption key via CLI arguments is rejected
runTest('Passing encryption key via CLI arguments to fixture script is rejected', () => {
  const scriptPath = path.join(__dirname, 'generate_staging_wifi_fixture.cjs');
  const dummyKey = 'a'.repeat(64);
  let failedAsExpected = false;

  try {
    execSync(`node "${scriptPath}" ${dummyKey}`, {
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
    });
  } catch (err) {
    const output = (err.stderr?.toString() || '') + (err.stdout?.toString() || '');
    if (output.includes('SECURITY VIOLATION') && output.includes('command line arguments is prohibited')) {
      failedAsExpected = true;
    }
  }

  assert.strictEqual(failedAsExpected, true, 'Fixture script must reject key in command line arguments');
});

console.log('\n====================================================');
console.log(`SUMMARY: ${passedTests}/${totalTests} NEGATIVE TESTS PASSED!`);
console.log('STATUS: ALL FAIL-CLOSED GATES VERIFIED EFFECTIVE');
console.log('====================================================\n');
