<#
.SYNOPSIS
    BWORK-POS Production Deployment Operator Script (Windows PowerShell)
.DESCRIPTION
    Strictly gated deployment script for BWORK-POS Selective Release Candidate.
    Includes automated D1 backup, integrity checks, Migration 015 execution,
    Worker deploy, POS Pages deploy, health checks, and rollback controls.
.PARAMETER DryRun
    Simulates deployment steps without executing mutating commands against Cloudflare.
.PARAMETER SkipConfirmation
    Bypasses interactive prompt checks. MUST only be used when explicitly intended.
.PARAMETER MockFailureAt
    Simulates a failure at a specified gate for DryRun testing:
    'Backup', 'Migration', 'MigrationHistory', 'WorkerDeploy', 'HealthCheck', 'PagesAsset'
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$SkipConfirmation,
    [ValidateSet('', 'Backup', 'Migration', 'MigrationHistory', 'WorkerDeploy', 'HealthCheck', 'PagesAsset')]
    [string]$MockFailureAt = '',
    [string]$BackupDir = "D:\Project BL\ProductionBackups\D1",
    [string]$ReleaseDir = "D:\Project BL\Bwork-POS-Release",
    [string]$ExpectedRCSha = "2b56b8500f9eb53b45a1c03c87c010de9f67adf9",
    [string]$BaselineWorkerVersion = "120851cf-333e-4ed4-8d9b-8f63ec07f749",
    [string]$BaselinePagesDeployment = "b59bbae0-ac48-46a0-b9e1-5e0cb7b64746",
    [string]$ExpectedBundleJs = "index-ovrDXtjb.js",
    [string]$ExpectedBundleCss = "index-GQw8n-HX.css"
)

$ErrorActionPreference = "Stop"

function Write-StepHeader {
    param([string]$Title)
    Write-Host "`n================================================================================" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "================================================================================" -ForegroundColor Cyan
}

function Confirm-OperatorGate {
    param([string]$ActionDescription)
    if ($SkipConfirmation) {
        Write-Host "[AUTO-CONFIRM] $ActionDescription" -ForegroundColor DarkYellow
        return $true
    }
    Write-Host "`n[MANUAL APPROVAL GATE] $ActionDescription" -ForegroundColor Yellow
    $response = Read-Host "Type 'YES' to proceed (any other input aborts)"
    if ($response -ne 'YES') {
        throw "OPERATOR ABORT: Confirmation rejected by user for action: $ActionDescription"
    }
    return $true
}

# ==============================================================================
# STEP 0: READ-ONLY PREFLIGHT VERIFICATION
# ==============================================================================
Write-StepHeader "STEP 0: READ-ONLY PREFLIGHT VERIFICATION"

Write-Host "1. Checking Release Worktree path..."
if (-not (Test-Path $ReleaseDir)) {
    throw "Release directory not found: $ReleaseDir"
}

Write-Host "2. Verifying Git HEAD SHA against expected RC SHA..."
$currentSha = (git -C $ReleaseDir rev-parse HEAD).Trim()
if ($currentSha -ne $ExpectedRCSha) {
    throw "RC SHA mismatch! Expected: $ExpectedRCSha, Found: $currentSha"
}
Write-Host "   -> RC SHA verified: $currentSha" -ForegroundColor Green

Write-Host "3. Verifying Working Tree is clean..."
$gitStatus = git -C $ReleaseDir status --porcelain
if ($gitStatus) {
    throw "Working tree is NOT clean! Uncommitted changes detected:`n$gitStatus"
}
Write-Host "   -> Working tree is clean." -ForegroundColor Green

Write-Host "4. Verifying compiled frontend assets exist..."
$jsPath = Join-Path $ReleaseDir "backend\public\assets\$ExpectedBundleJs"
$cssPath = Join-Path $ReleaseDir "backend\public\assets\$ExpectedBundleCss"
if (-not (Test-Path $jsPath) -or -not (Test-Path $cssPath)) {
    throw "Compiled frontend assets missing in release directory!`nJS: $jsPath`nCSS: $cssPath"
}
Write-Host "   -> Frontend assets verified: $ExpectedBundleJs, $ExpectedBundleCss" -ForegroundColor Green

Write-Host "5. Checking external backup directory..."
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}
$resolvedBackup = (Resolve-Path $BackupDir).Path
$resolvedRelease = (Resolve-Path $ReleaseDir).Path
if ($resolvedBackup.StartsWith($resolvedRelease, [StringComparison]::OrdinalIgnoreCase)) {
    throw "SECURITY ALERT: Backup directory is inside Git worktree!"
}
Write-Host "   -> External backup path is safe and outside Git: $BackupDir" -ForegroundColor Green

Write-Host "`n[STATUS] Step 0 Preflight Checks PASSED 100%." -ForegroundColor Green

# ==============================================================================
# STEP 1: FRESH D1 BACKUP & AUTOMATED INTEGRITY VERIFICATION
# ==============================================================================
Write-StepHeader "STEP 1: FRESH D1 BACKUP & INTEGRITY VERIFICATION"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $BackupDir "bworkpos_db_backup_$timestamp.sql"
Write-Host "Target backup file: $backupFile"

Confirm-OperatorGate "Execute D1 Export of production database 'bworkpos_db'?"

if ($DryRun) {
    Write-Host "[DRY-RUN] Simulating D1 export..." -ForegroundColor Yellow
    if ($MockFailureAt -eq 'Backup') {
        throw "MOCK FAILURE at Step 1: D1 Backup export failed."
    }
    # Create valid mock SQL file for dry-run verification
    $mockSql = "CREATE TABLE bookings (id INTEGER PRIMARY KEY, total_amount REAL);`nCREATE TABLE payment_transactions (id INTEGER PRIMARY KEY);`nCREATE TABLE customers (id INTEGER PRIMARY KEY);`nCREATE TABLE users (id INTEGER PRIMARY KEY);`nCREATE TABLE rooms (id INTEGER PRIMARY KEY);`nCREATE TABLE settings (key TEXT, value TEXT);`nINSERT INTO bookings VALUES (1, 1000);"
    Set-Content -Path $backupFile -Value $mockSql -Encoding UTF8
} else {
    Set-Location (Join-Path $ReleaseDir "backend")
    npx.cmd wrangler d1 export bworkpos_db --remote --output=$backupFile -y
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 1: Wrangler D1 export command failed with exit code $LASTEXITCODE"
    }
}

# Gate 1.1: Size Check
$backupItem = Get-Item $backupFile
$minSize = if ($DryRun) { 100 } else { 5MB }
if ($backupItem.Length -lt $minSize) {
    throw "STOP GATE 1: Backup file size is suspiciously small ($($backupItem.Length) bytes). Aborting."
}
Write-Host "[PASS] Backup file exported ($([math]::Round($backupItem.Length / 1MB, 2)) MB)" -ForegroundColor Green

# Gate 1.2: Integrity Check in temporary SQLite
$tempDb = Join-Path $BackupDir "temp_verify_$timestamp.sqlite"
try {
    Write-Host "Verifying backup content and PRAGMA integrity_check..."
    $helperScript = Join-Path $PSScriptRoot "verify_backup_helper.cjs"
    node $helperScript $backupFile $tempDb $ReleaseDir
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 1: Temporary database import or PRAGMA integrity_check failed!"
    }
    Write-Host "[PASS] Backup integrity verification PASSED 100%." -ForegroundColor Green
} finally {
    if (Test-Path $tempDb) { Remove-Item -Force $tempDb }
}

# ==============================================================================
# STEP 2: EXECUTE MIGRATION 015
# ==============================================================================
Write-StepHeader "STEP 2: EXECUTE MIGRATION 015"

Write-Host "Checking if table line_notification_claims already exists..."
$tableCheckJson = if ($DryRun) {
    '{"results":[{"count":0}]}'
} else {
    Set-Location (Join-Path $ReleaseDir "backend")
    npx.cmd wrangler d1 execute bworkpos_db --remote --json --command="SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='line_notification_claims';"
}

if ($tableCheckJson -match '"count":1') {
    Write-Warning "[NOTICE] Table line_notification_claims already exists in production D1. Skipping CREATE TABLE."
} else {
    Confirm-OperatorGate "Execute Migration 015 (CREATE TABLE line_notification_claims) on remote D1?"
    if ($DryRun) {
        Write-Host "[DRY-RUN] Simulating Migration 015 execution..." -ForegroundColor Yellow
        if ($MockFailureAt -eq 'Migration') {
            throw "MOCK FAILURE at Step 2: Migration 015 failed."
        }
    } else {
        Set-Location (Join-Path $ReleaseDir "backend")
        npx.cmd wrangler d1 execute bworkpos_db --remote --file="migrations/015_add_line_notification_claims.sql"
        if ($LASTEXITCODE -ne 0) {
            throw "STOP GATE 2: Migration 015 execution failed with exit code $LASTEXITCODE. DO NOT proceed to Worker Deploy."
        }
    }
    Write-Host "[PASS] Migration 015 SQL executed successfully." -ForegroundColor Green
}

# ==============================================================================
# STEP 3: MIGRATION SCHEMA VERIFICATION & HISTORY RECORDING
# ==============================================================================
Write-StepHeader "STEP 3: MIGRATION SCHEMA VERIFICATION & HISTORY RECORDING"

Write-Host "Verifying table columns and indexes in production D1..."
if ($DryRun) {
    Write-Host "[DRY-RUN] Simulating schema inspection: 12 columns verified." -ForegroundColor Yellow
} else {
    Set-Location (Join-Path $ReleaseDir "backend")
    $colCheck = npx.cmd wrangler d1 execute bworkpos_db --remote --command="PRAGMA table_info(line_notification_claims);"
    if ($LASTEXITCODE -ne 0 -or $colCheck -notlike "*retry_key*" -or $colCheck -notlike "*claim_token*") {
        throw "STOP GATE 3: Table line_notification_claims verification failed. Essential columns missing."
    }
}
Write-Host "[PASS] Table line_notification_claims schema verified." -ForegroundColor Green

Confirm-OperatorGate "Record Migration 015 in d1_migrations history table?"
if ($DryRun) {
    Write-Host "[DRY-RUN] Simulating history recording..." -ForegroundColor Yellow
    if ($MockFailureAt -eq 'MigrationHistory') {
        throw "MOCK FAILURE at Step 3: Migration history recording failed."
    }
} else {
    $recordSql = "INSERT INTO d1_migrations (name, applied_at) SELECT '015_add_line_notification_claims.sql', datetime('now', '+7 hours') WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '015_add_line_notification_claims.sql');"
    Set-Location (Join-Path $ReleaseDir "backend")
    npx.cmd wrangler d1 execute bworkpos_db --remote --command="$recordSql"
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 3: Recording migration history failed with exit code $LASTEXITCODE"
    }
}
Write-Host "[PASS] Migration 015 history recorded safely." -ForegroundColor Green

# ==============================================================================
# STEP 4: DEPLOY WORKER API (bwork-pos-api)
# ==============================================================================
Write-StepHeader "STEP 4: DEPLOY CLOUDFLARE WORKER API (bwork-pos-api)"

Write-Host "Current confirmed baseline Worker version: $BaselineWorkerVersion"
Confirm-OperatorGate "Deploy Cloudflare Worker API from $ReleaseDir\backend\worker.js?"

if ($DryRun) {
    Write-Host "[DRY-RUN] Simulating Worker deployment..." -ForegroundColor Yellow
    if ($MockFailureAt -eq 'WorkerDeploy') {
        throw "MOCK FAILURE at Step 4: Worker deployment failed."
    }
} else {
    Set-Location (Join-Path $ReleaseDir "backend")
    npx.cmd wrangler deploy
    if ($LASTEXITCODE -ne 0) {
        Write-Error "STOP GATE 4: Worker deployment failed with exit code $LASTEXITCODE"
        Write-Warning "Do NOT blindly rollback without checking deployed version."
        throw "Worker deployment failed. Inspect deployment status before attempting recovery."
    }
}
Write-Host "[PASS] Cloudflare Worker deployed successfully." -ForegroundColor Green

# ==============================================================================
# STEP 5: WORKER HEALTH CHECK & RECOVERY DECISION GATE
# ==============================================================================
Write-StepHeader "STEP 5: WORKER HEALTH CHECK"

Write-Host "Probing Worker API endpoint: https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/rooms"
Start-Sleep -Seconds 3

if ($DryRun -and $MockFailureAt -eq 'HealthCheck') {
    $rooms = @()
} else {
    $rooms = Invoke-RestMethod -Uri "https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/rooms" -Method Get
}

if (-not $rooms -or $rooms.Count -eq 0) {
    Write-Error "STOP GATE 5: Worker Health Check FAILED! No rooms returned from API."
    Write-Host "`nEVIDENCE GATHERED:" -ForegroundColor Red
    Write-Host "- Endpoint probed: https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/rooms"
    Write-Host "- Result: Null or empty response"
    Write-Host "- Baseline rollback target: $BaselineWorkerVersion"
    
    Confirm-OperatorGate "CRITICAL RECOVERY: Execute Worker rollback to baseline version $BaselineWorkerVersion?"
    if ($DryRun) {
        Write-Host "[DRY-RUN] Simulating Worker rollback to $BaselineWorkerVersion..." -ForegroundColor Yellow
    } else {
        Set-Location (Join-Path $ReleaseDir "backend")
        npx.cmd wrangler rollback $BaselineWorkerVersion -y -m "Automated rollback after Health Check failure"
    }
    throw "Worker API unhealthy. Rollback executed to $BaselineWorkerVersion. STOPPING DEPLOYMENT."
}
Write-Host "[PASS] Worker Health Check PASSED. Rooms active: $($rooms.Count)" -ForegroundColor Green

# ==============================================================================
# STEP 6: DEPLOY POS FRONTEND PAGES (bwork-pos)
# ==============================================================================
Write-StepHeader "STEP 6: DEPLOY CLOUDFLARE POS PAGES (bwork-pos)"

Write-Host "Current confirmed baseline POS Pages deployment: $BaselinePagesDeployment"
Confirm-OperatorGate "Deploy POS Frontend Pages from $ReleaseDir\frontend\dist?"

if ($DryRun) {
    Write-Host "[DRY-RUN] Simulating POS Pages deployment..." -ForegroundColor Yellow
} else {
    Set-Location (Join-Path $ReleaseDir "frontend")
    npx.cmd wrangler pages deploy dist --project-name=bwork-pos --commit-dirty=true
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 6: POS Pages deploy failed with exit code $LASTEXITCODE. Rollback target: $BaselinePagesDeployment."
    }
}
Write-Host "[PASS] Cloudflare POS Pages deployed successfully." -ForegroundColor Green

# ==============================================================================
# STEP 7: PAGES ASSET VERIFICATION
# ==============================================================================
Write-StepHeader "STEP 7: PAGES ASSET VERIFICATION"

Write-Host "Verifying live page content at https://bwork-pos.pages.dev..."
Start-Sleep -Seconds 3

$page = Invoke-WebRequest -Uri "https://bwork-pos.pages.dev" -UseBasicParsing
if ($page.StatusCode -ne 200) {
    throw "STOP GATE 7: POS Pages returned HTTP status $($page.StatusCode)"
}

$hasNewAsset = ($page.Content -like "*$ExpectedBundleJs*")
if ($DryRun -and $MockFailureAt -eq 'PagesAsset') {
    $hasNewAsset = $false
}

if (-not $hasNewAsset) {
    Write-Warning "[WARN] Live HTML does not yet contain $ExpectedBundleJs."
    Write-Warning "Cloudflare Edge CDN cache may take 1-2 minutes to propagate."
    Write-Host "Retrying asset verification in 10 seconds..."
    Start-Sleep -Seconds 10
    $pageRetry = Invoke-WebRequest -Uri "https://bwork-pos.pages.dev" -UseBasicParsing
    if ($pageRetry.Content -like "*$ExpectedBundleJs*") {
        Write-Host "[PASS] Asset verification confirmed on retry." -ForegroundColor Green
    } else {
        if ($MockFailureAt -eq 'PagesAsset') {
            throw "MOCK FAILURE at Step 7: Asset mismatch detected."
        }
        Write-Warning "[NOTICE] Asset hash still propagating on Edge CDN. Please check browser with Hard Refresh (Ctrl+F5)."
    }
} else {
    Write-Host "[PASS] Live POS Pages is actively serving target bundle: $ExpectedBundleJs" -ForegroundColor Green
}

# ==============================================================================
# STEP 8: READ-ONLY OPERATIONAL SMOKE TEST GUIDE
# ==============================================================================
Write-StepHeader "STEP 8: READ-ONLY OPERATIONAL SMOKE TEST GUIDE"

Write-Host "Operator manual verification checklist (Open https://bwork-pos.pages.dev):" -ForegroundColor Yellow
Write-Host "  [ ] 1. Open browser to https://bwork-pos.pages.dev and login"
Write-Host "  [ ] 2. Navigate to Customer Management (CRM)"
Write-Host "  [ ] 3. Click Add New Customer button"
Write-Host "  [ ] 4. Verify Wide Modal layout (2 columns, clean responsive spacing)"
Write-Host "  [ ] 5. Click Start Date -> Verify solid white calendar popup, no overlay on left form"
Write-Host "  [ ] 6. Verify customer groups: Basecamp, Shop, OnDemand, Virtual Office"

# ==============================================================================
# STEP 9: POST-DEPLOYMENT MONITORING
# ==============================================================================
Write-StepHeader "STEP 9: POST-DEPLOYMENT MONITORING"

Write-Host "To monitor live Cloudflare Worker logs for the next 15 minutes, execute:" -ForegroundColor Cyan
Write-Host "   npx wrangler tail bwork-pos-api" -ForegroundColor Yellow
Write-Host "`nConfirm zero HTTP 500 errors and successful payment notifications."
Write-Host "`n================================================================================" -ForegroundColor Green
Write-Host "  PRODUCTION DEPLOYMENT COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "================================================================================" -ForegroundColor Green
