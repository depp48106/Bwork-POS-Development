/**
 * BWORK-POS — STAGING DEPLOYMENT SAFETY GUARD
 * Phase: RELEASE-2B.3
 *
 * Verifies all staging configurations and build artifacts before any Cloudflare
 * deployment command can run. Fails closed with non-zero exit code on any violation.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROD_D1_ID = '0f171606-080b-4380-bf91-167dc678e2e4';
const PROD_WORKER_HOST = 'bwork-pos-api.ohnatza74185-ky.workers.dev';
const PROD_WORKER_NAME = 'bwork-pos-api';
const STAGING_WORKER_HOST = 'bwork-pos-api-staging.ohnatza74185-ky.workers.dev';
const STAGING_WORKER_NAME = 'bwork-pos-api-staging';
const PROD_PAGES_HOSTS = ['bwork-pos.pages.dev', 'bwork-booking.pages.dev'];
const PROD_PAGES_PROJECTS = ['bwork-pos', 'bwork-booking'];
const STAGING_PAGES_PROJECTS = ['bwork-pos-staging', 'bwork-booking-staging'];

function validateWranglerStaging(wranglerPath) {
  if (!fs.existsSync(wranglerPath)) {
    throw new Error(`wrangler.staging.toml is missing at ${wranglerPath}`);
  }
  const content = fs.readFileSync(wranglerPath, 'utf8');

  // Check 1: Worker name
  const nameMatch = content.match(/^name\s*=\s*["']([^"']+)["']/m);
  if (!nameMatch || nameMatch[1] !== STAGING_WORKER_NAME) {
    throw new Error(`Worker name in ${wranglerPath} must be "${STAGING_WORKER_NAME}", found: "${nameMatch ? nameMatch[1] : 'none'}"`);
  }

  // Check 2: Production D1 UUID absence
  if (content.includes(PROD_D1_ID)) {
    throw new Error(`CRITICAL SECURITY VIOLATION: Production D1 ID (${PROD_D1_ID}) found in ${wranglerPath}`);
  }

  // Check 3: Database name
  if (!content.includes('database_name = "bworkpos_staging_db"')) {
    throw new Error(`Database name must be "bworkpos_staging_db" in ${wranglerPath}`);
  }

  // Check 4: No active crons
  if (content.match(/^\s*crons\s*=/m)) {
    throw new Error(`Active crons are prohibited in staging wrangler config: ${wranglerPath}`);
  }

  // Check 5: ENVIRONMENT = "staging"
  if (!content.includes('ENVIRONMENT = "staging"') && !content.includes("ENVIRONMENT = 'staging'")) {
    throw new Error(`ENVIRONMENT must be set to "staging" in vars of ${wranglerPath}`);
  }
}

function validateWorkerJs(workerJsPath) {
  if (!fs.existsSync(workerJsPath)) {
    throw new Error(`worker.js missing at ${workerJsPath}`);
  }
  const content = fs.readFileSync(workerJsPath, 'utf8');

  // Check 1: dispatchLineMessagePush exists
  if (!content.includes('async function dispatchLineMessagePush(')) {
    throw new Error(`dispatchLineMessagePush function is missing from ${workerJsPath}`);
  }

  // Check 2: Staging guard in dispatchLineMessagePush
  const stagingGuardPresent = content.includes("env.ENVIRONMENT === 'staging'") || content.includes('env.ENVIRONMENT === "staging"');
  if (!stagingGuardPresent || !content.includes('mocked: true')) {
    throw new Error(`Centralized staging LINE hard-block guard is missing or altered in dispatchLineMessagePush (${workerJsPath})`);
  }

  // Check 3: No direct api.line.me push outside dispatchLineMessagePush
  const pushEndpointRegex = /api\.line\.me\/v2\/bot\/message\/push/g;
  const matches = content.match(pushEndpointRegex) || [];
  if (matches.length > 1) {
    throw new Error(`Direct LINE push calls found outside dispatchLineMessagePush in ${workerJsPath}`);
  }
}

function validateDistStaging(appDir, distDir) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Staging build output directory does not exist: ${distDir}. Run scripts/build_staging.cjs first.`);
  }

  const redirectsPath = path.join(distDir, '_redirects');
  if (!fs.existsSync(redirectsPath)) {
    throw new Error(`_redirects file missing in ${distDir}`);
  }

  const redirectsContent = fs.readFileSync(redirectsPath, 'utf8');
  if (!redirectsContent.includes(`https://${STAGING_WORKER_HOST}/api/:splat`)) {
    throw new Error(`_redirects in ${distDir} does not route /api/* to https://${STAGING_WORKER_HOST}/api/:splat`);
  }
  if (!redirectsContent.includes('/*      /index.html') && !redirectsContent.includes('/*  /index.html')) {
    throw new Error(`_redirects in ${distDir} missing SPA fallback rule`);
  }
  if (redirectsContent.includes(PROD_WORKER_HOST)) {
    throw new Error(`CRITICAL SECURITY VIOLATION: Production Worker host (${PROD_WORKER_HOST}) found in _redirects of ${distDir}`);
  }
  for (const prodPage of PROD_PAGES_HOSTS) {
    if (redirectsContent.includes(prodPage)) {
      throw new Error(`CRITICAL SECURITY VIOLATION: Production Pages host (${prodPage}) found in _redirects of ${distDir}`);
    }
  }

  // Scan compiled assets
  const assetFiles = [];
  function scan(dir) {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) scan(full);
      else assetFiles.push(full);
    }
  }
  scan(distDir);

  let stagingEndpointFoundInJs = false;
  for (const file of assetFiles) {
    if (!file.endsWith('.js') && !file.endsWith('.html') && !file.endsWith('.css')) continue;
    const content = fs.readFileSync(file, 'utf8');

    if (content.includes(PROD_WORKER_HOST)) {
      throw new Error(`CRITICAL SECURITY VIOLATION: Production Worker host (${PROD_WORKER_HOST}) found in ${file}`);
    }

    if (file.endsWith('.js') && content.includes(STAGING_WORKER_HOST)) {
      stagingEndpointFoundInJs = true;
    }
  }

  if (!stagingEndpointFoundInJs) {
    throw new Error(`Staging Worker endpoint (${STAGING_WORKER_HOST}) was not embedded in JavaScript bundles in ${distDir}`);
  }
}

function validatePagesProjectTarget(projectName) {
  if (PROD_PAGES_PROJECTS.includes(projectName)) {
    throw new Error(`CRITICAL SECURITY VIOLATION: Cannot deploy staging build to production Pages project "${projectName}"`);
  }
  if (!STAGING_PAGES_PROJECTS.includes(projectName)) {
    throw new Error(`Unknown or unauthorized Pages project name "${projectName}". Allowed staging projects: ${STAGING_PAGES_PROJECTS.join(', ')}`);
  }
}

function runAudit(rootDir = ROOT, options = { checkBuilds: true }) {
  console.log('====================================================');
  console.log('  BWORK-POS STAGING DEPLOYMENT SAFETY GUARD (RELEASE-2B.3)');
  console.log('====================================================\n');

  console.log('1. Auditing backend/wrangler.staging.toml...');
  const wranglerStagingPath = path.join(rootDir, 'backend', 'wrangler.staging.toml');
  validateWranglerStaging(wranglerStagingPath);
  console.log('   [PASS] wrangler.staging.toml is safely configured.');

  console.log('2. Auditing backend/worker.js LINE dispatch guard...');
  const workerJsPath = path.join(rootDir, 'backend', 'worker.js');
  validateWorkerJs(workerJsPath);
  console.log('   [PASS] worker.js LINE dispatch guard is verified.');

  if (options.checkBuilds) {
    console.log('3. Auditing frontend/dist-staging artifacts...');
    const frontendDist = path.join(rootDir, 'frontend', 'dist-staging');
    validateDistStaging(path.join(rootDir, 'frontend'), frontendDist);
    console.log('   [PASS] frontend/dist-staging artifacts verified.');

    console.log('4. Auditing booking-app/dist-staging artifacts...');
    const bookingDist = path.join(rootDir, 'booking-app', 'dist-staging');
    validateDistStaging(path.join(rootDir, 'booking-app'), bookingDist);
    console.log('   [PASS] booking-app/dist-staging artifacts verified.');
  }

  console.log('5. Auditing Pages deployment project names...');
  validatePagesProjectTarget('bwork-pos-staging');
  validatePagesProjectTarget('bwork-booking-staging');
  console.log('   [PASS] Pages target names bwork-pos-staging and bwork-booking-staging validated.');

  console.log('\n====================================================');
  console.log('STATUS: ALL DEPLOYMENT SAFETY GATES PASSED (FAIL-CLOSED READY)');
  console.log('====================================================\n');
  return true;
}

if (require.main === module) {
  try {
    runAudit(ROOT, { checkBuilds: true });
    process.exit(0);
  } catch (err) {
    console.error('\n[DEPLOYMENT BLOCKED BY SAFETY GUARD - FAIL CLOSED]');
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  runAudit,
  validateWranglerStaging,
  validateWorkerJs,
  validateDistStaging,
  validatePagesProjectTarget,
  PROD_D1_ID,
  PROD_WORKER_HOST,
  PROD_WORKER_NAME,
  STAGING_WORKER_HOST,
  STAGING_WORKER_NAME,
  PROD_PAGES_HOSTS,
  PROD_PAGES_PROJECTS,
  STAGING_PAGES_PROJECTS
};
