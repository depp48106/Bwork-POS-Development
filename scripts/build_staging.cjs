/**
 * BWORK-POS — STAGING BUILD WORKFLOW & FAIL-CLOSED VALIDATOR
 * Phase: RELEASE-2B.3
 *
 * Builds frontend and booking-app in staging mode (--mode staging)
 * into dedicated dist-staging directories, rewrites _redirects to
 * point strictly to the staging Worker API, and verifies that zero
 * production API or Pages endpoints exist in the compiled assets.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PROD_WORKER_HOST = 'bwork-pos-api.ohnatza74185-ky.workers.dev';
const STAGING_WORKER_HOST = 'bwork-pos-api-staging.ohnatza74185-ky.workers.dev';
const STAGING_API_URL = `https://${STAGING_WORKER_HOST}`;
const PROD_PAGES_HOSTS = ['bwork-pos.pages.dev', 'bwork-booking.pages.dev'];

const STAGING_REDIRECTS_CONTENT = `/api/*  https://${STAGING_WORKER_HOST}/api/:splat  200\n/*      /index.html                                                           200\n`;

function assertCondition(cond, msg) {
  if (!cond) {
    throw new Error(`[FAIL-CLOSED AUDIT ERROR] ${msg}`);
  }
}

/**
 * Validates the contents of a dist-staging directory for fail-closed safety.
 */
function validateStagingDist(appDir, distDir) {
  const redirectsPath = path.join(distDir, '_redirects');
  assertCondition(fs.existsSync(redirectsPath), `_redirects file is missing in ${distDir}`);

  const redirectsContent = fs.readFileSync(redirectsPath, 'utf8');
  assertCondition(
    redirectsContent.includes(`https://${STAGING_WORKER_HOST}/api/:splat`),
    `_redirects in ${distDir} does not route /api/* to staging Worker API (${STAGING_WORKER_HOST})`
  );
  assertCondition(
    redirectsContent.includes('/*      /index.html'),
    `_redirects in ${distDir} is missing SPA fallback rule`
  );
  assertCondition(
    !redirectsContent.includes(PROD_WORKER_HOST),
    `CRITICAL SECURITY VIOLATION: Production Worker host (${PROD_WORKER_HOST}) found in _redirects of ${distDir}`
  );
  for (const prodPage of PROD_PAGES_HOSTS) {
    assertCondition(
      !redirectsContent.includes(prodPage),
      `CRITICAL SECURITY VIOLATION: Production Pages host (${prodPage}) found in _redirects of ${distDir}`
    );
  }

  // Scan all compiled assets (JS, CSS, HTML)
  const assetFiles = [];
  function scanDir(dir) {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) scanDir(full);
      else assetFiles.push(full);
    }
  }
  scanDir(distDir);

  let stagingEndpointFoundInJs = false;
  for (const file of assetFiles) {
    if (!file.endsWith('.js') && !file.endsWith('.html') && !file.endsWith('.css')) continue;
    const content = fs.readFileSync(file, 'utf8');

    // Fail closed if production Worker API host is found
    if (content.includes(PROD_WORKER_HOST)) {
      throw new Error(`CRITICAL SECURITY VIOLATION: Production Worker host (${PROD_WORKER_HOST}) found in compiled asset ${file}`);
    }

    if (file.endsWith('.js') && content.includes(STAGING_WORKER_HOST)) {
      stagingEndpointFoundInJs = true;
    }
  }

  assertCondition(
    stagingEndpointFoundInJs,
    `Staging Worker endpoint (${STAGING_WORKER_HOST}) was not embedded in JavaScript bundles in ${distDir}`
  );
  console.log(`  [PASS] Staging dist validation passed for ${path.basename(appDir)} (${assetFiles.length} files audited)`);
}

/**
 * Builds a given frontend app for staging with fail-closed safeguards.
 */
function buildAppStaging(appDirName) {
  const appDir = path.join(ROOT, appDirName);
  const distDir = path.join(appDir, 'dist-staging');
  console.log(`\n====================================================`);
  console.log(`Building ${appDirName} for Staging (--mode staging)`);
  console.log(`====================================================`);

  // 1. Verify .env.staging pre-requisites
  const envStagingPath = path.join(appDir, '.env.staging');
  assertCondition(fs.existsSync(envStagingPath), `.env.staging missing in ${appDirName}`);
  const envContent = fs.readFileSync(envStagingPath, 'utf8');
  assertCondition(
    envContent.includes(`VITE_API_BASE=${STAGING_API_URL}`),
    `VITE_API_BASE in ${appDirName}/.env.staging must be ${STAGING_API_URL}`
  );
  assertCondition(
    !envContent.includes(PROD_WORKER_HOST),
    `Production Worker host found in ${appDirName}/.env.staging`
  );

  // 2. Clean previous staging dist if any
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }

  // 3. Execute Vite build into dist-staging
  console.log(`Executing: npx vite build --mode staging --outDir dist-staging in ${appDirName}...`);
  try {
    execSync('npx vite build --mode staging --outDir dist-staging', {
      cwd: appDir,
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
    });
  } catch (err) {
    console.error(`Build failed in ${appDirName}:`, err.stdout?.toString() || err.message);
    throw err;
  }

  // 4. Overwrite dist-staging/_redirects with verified staging-only rules
  const redirectsPath = path.join(distDir, '_redirects');
  fs.writeFileSync(redirectsPath, STAGING_REDIRECTS_CONTENT, 'utf8');
  console.log(`  [OK] Generated staging-only _redirects routing /api/* to ${STAGING_WORKER_HOST}`);

  // 5. Fail-Closed Audit on generated output
  validateStagingDist(appDir, distDir);

  return distDir;
}

function runAll() {
  console.log('====================================================');
  console.log('  BWORK-POS SAFE STAGING BUILD WORKFLOW (RELEASE-2B.3)');
  console.log('====================================================');

  const frontendDist = buildAppStaging('frontend');
  const bookingDist = buildAppStaging('booking-app');

  console.log('\n====================================================');
  console.log('STATUS: BOTH STAGING BUILDS COMPLETED & PASSED FAIL-CLOSED AUDIT!');
  console.log(`  - POS Frontend: ${frontendDist}`);
  console.log(`  - Booking App:  ${bookingDist}`);
  console.log('====================================================\n');
}

if (require.main === module) {
  try {
    runAll();
    process.exit(0);
  } catch (err) {
    console.error('\n[BUILD BLOCKED - FAIL CLOSED]');
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  buildAppStaging,
  validateStagingDist,
  STAGING_REDIRECTS_CONTENT,
  STAGING_WORKER_HOST,
  PROD_WORKER_HOST,
  PROD_PAGES_HOSTS
};
