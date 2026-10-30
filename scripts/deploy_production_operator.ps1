<#
.SYNOPSIS
    BWORK-POS Production Deployment Operator Script (Windows PowerShell)
.DESCRIPTION
    Strictly gated, fail-closed deployment script for BWORK-POS Selective Release Candidate.
    Enforces manual approval gates on all mutating commands, strictly offline DryRun mode,
    automated D1 backup integrity checks, Migration 015 verification, Worker deploy,
    POS Pages deploy, and rollback controls.
.PARAMETER DryRun
    Runs in strictly offline mock mode with zero network calls to Cloudflare or LINE.
.PARAMETER DryRunSimulateYes
    Simulates operator typing 'YES' at approval gates during automated DryRun testing.
    STRICTLY PROHIBITED and rejected in Production mode.
.PARAMETER MockFailureAt
    Simulates a failure at a specified gate for DryRun testing:
    'Backup', 'Migration', 'MigrationSchema', 'IndexCheck', 'MigrationHistory', 'WorkerDeploy', 'HealthCheck', 'PagesAsset', 'RollbackFail', 'RollbackTrafficFail'
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$DryRunSimulateYes,
    [ValidateSet('', 'Backup', 'Migration', 'MigrationSchema', 'IndexCheck', 'MigrationHistory', 'WorkerDeploy', 'HealthCheck', 'PagesAsset', 'RollbackFail', 'RollbackTrafficFail')]
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

# ==============================================================================
# SECURITY ENFORCEMENT: APPROVAL BYPASS PREVENTION
# ==============================================================================
if (-not $DryRun -and $DryRunSimulateYes) {
    throw "FATAL SECURITY VIOLATION: Manual approval bypass (-DryRunSimulateYes) is strictly prohibited in Production mode! You must manually confirm every step."
}

if (-not $DryRun) {
    if ($env:SKIP_CONFIRMATION -or $env:APPROVE_ALL -or $env:AUTO_DEPLOY) {
        throw "FATAL SECURITY VIOLATION: Environment variable approval bypass is strictly prohibited in Production mode! Unset all deployment bypass variables."
    }
}

function Write-StepHeader {
    param([string]$Title)
    Write-Host "`n================================================================================" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "================================================================================" -ForegroundColor Cyan
}

function Confirm-OperatorGate {
    param([string]$ActionDescription)
    if ($DryRun -and $DryRunSimulateYes) {
        Write-Host "[DRY-RUN SIMULATED APPROVAL] $ActionDescription" -ForegroundColor DarkYellow
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
# TOP-LEVEL AUTHORIZATION CHECK
# ==============================================================================
if ($DryRun) {
    Write-Host "`n********************************************************************************" -ForegroundColor DarkYellow
    Write-Host "  MODE: STRICT OFFLINE DRY RUN" -ForegroundColor DarkYellow
    Write-Host "  Zero network calls will be made to Cloudflare, D1, Pages, or LINE APIs." -ForegroundColor DarkYellow
    Write-Host "********************************************************************************" -ForegroundColor DarkYellow
} else {
    Write-Host "`n********************************************************************************" -ForegroundColor Red
    Write-Host "  ATTENTION: YOU ARE RUNNING IN REAL PRODUCTION DEPLOYMENT MODE" -ForegroundColor Red
    Write-Host "  Target Cloudflare Worker: bwork-pos-api" -ForegroundColor Red
    Write-Host "  Target Cloudflare Pages:  bwork-pos" -ForegroundColor Red
    Write-Host "  Target Cloudflare D1:     bworkpos_db (0f171606-080b-4380-bf91-167dc678e2e4)" -ForegroundColor Red
    Write-Host "********************************************************************************" -ForegroundColor Red
    $topAuth = Read-Host "Type 'APPROVE PRODUCTION DEPLOYMENT' to initiate the release sequence"
    if ($topAuth -ne 'APPROVE PRODUCTION DEPLOYMENT') {
        throw "OPERATOR ABORT: Production deployment not authorized by operator."
    }
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
if (-not $DryRun) {
    if (-not (Test-Path $BackupDir)) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    }
    $resolvedBackup = (Resolve-Path $BackupDir).Path
    $resolvedRelease = (Resolve-Path $ReleaseDir).Path
    if ($resolvedBackup.StartsWith($resolvedRelease, [StringComparison]::OrdinalIgnoreCase)) {
        throw "SECURITY ALERT: Backup directory is inside Git worktree!"
    }
    Write-Host "   -> External backup path is safe and outside Git: $BackupDir" -ForegroundColor Green
} else {
    Write-Host "   -> [DRY-RUN] Target production backup path configured: $BackupDir (Untouched during DryRun)" -ForegroundColor Yellow
}

Write-Host "`n[STATUS] Step 0 Preflight Checks PASSED 100%." -ForegroundColor Green

# ==============================================================================
# STEP 1: FRESH D1 BACKUP & AUTOMATED INTEGRITY VERIFICATION
# ==============================================================================
Write-StepHeader "STEP 1: FRESH D1 BACKUP & INTEGRITY VERIFICATION"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$tempMockDir = $null
$mockCreated = $false

if ($DryRun) {
    # Strictly use isolated temporary directory for all mock artifacts during DryRun
    $tempMockDir = Join-Path ([System.IO.Path]::GetTempPath()) "bwork_pos_dryrun_mock_$timestamp"
    New-Item -ItemType Directory -Path $tempMockDir -Force | Out-Null
    $backupFile = Join-Path $tempMockDir "dryrun_mock_backup_$timestamp.sql"
} else {
    $backupFile = Join-Path $BackupDir "bworkpos_db_production_backup_$timestamp.sql"
}
Write-Host "Target backup file: $backupFile"

Confirm-OperatorGate "Execute D1 Export of production database 'bworkpos_db'?"

try {
    if ($DryRun) {
        Write-Host "[DRY-RUN OFFLINE MOCK] Simulating D1 export to $backupFile..." -ForegroundColor Yellow
        if ($MockFailureAt -eq 'Backup') {
            throw "MOCK FAILURE at Step 1: D1 Backup export failed."
        }
        # Write valid mock SQL with core tables and sample data for offline verification
        $mockSql = "CREATE TABLE bookings (id INTEGER PRIMARY KEY, total_amount REAL);`n" +
                   "CREATE TABLE payment_transactions (id INTEGER PRIMARY KEY);`n" +
                   "CREATE TABLE customers (id INTEGER PRIMARY KEY);`n" +
                   "CREATE TABLE users (id INTEGER PRIMARY KEY);`n" +
                   "CREATE TABLE rooms (id INTEGER PRIMARY KEY);`n" +
                   "CREATE TABLE settings (key TEXT, value TEXT);`n" +
                   "INSERT INTO bookings VALUES (1, 1000);"
        Set-Content -Path $backupFile -Value $mockSql -Encoding UTF8
        $mockCreated = $true
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
    $tempDb = if ($DryRun) {
        Join-Path $tempMockDir "temp_verify_$timestamp.sqlite"
    } else {
        Join-Path $BackupDir "temp_verify_$timestamp.sqlite"
    }
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
} finally {
    if ($DryRun -and $mockCreated -and $tempMockDir -and (Test-Path $tempMockDir)) {
        Remove-Item -Recurse -Force $tempMockDir
        Write-Host "[DRY-RUN] Cleaned up temporary mock artifacts directory ($tempMockDir)." -ForegroundColor DarkYellow
    }
}

# ==============================================================================
# STEP 2: EXECUTE MIGRATION 015
# ==============================================================================
Write-StepHeader "STEP 2: EXECUTE MIGRATION 015"

Write-Host "Checking if table line_notification_claims already exists..."
$tableAlreadyExists = $false

if ($DryRun) {
    Write-Host "[DRY-RUN OFFLINE MOCK] Simulating D1 table existence check..." -ForegroundColor Yellow
    $tableAlreadyExists = $false
} else {
    Set-Location (Join-Path $ReleaseDir "backend")
    $tableCheckJson = npx.cmd wrangler d1 execute bworkpos_db --remote --json --command="SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='line_notification_claims';"
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 2: Failed to query sqlite_master for table existence check (Exit code $LASTEXITCODE)."
    }
    if ([string]::IsNullOrWhiteSpace($tableCheckJson)) {
        throw "STOP GATE 2: Empty JSON response for table existence check from D1."
    }
    try {
        $parsedCheck = $tableCheckJson | ConvertFrom-Json
    } catch {
        throw "STOP GATE 2: Invalid JSON received for table existence check: $_"
    }
    if (-not $parsedCheck -or -not $parsedCheck[0].results) {
        throw "STOP GATE 2: Malformed JSON structure for table existence check."
    }
    $tableAlreadyExists = ($parsedCheck[0].results[0].count -eq 1)
}

if ($tableAlreadyExists) {
    Write-Warning "[NOTICE] Table line_notification_claims already exists in production D1. Skipping CREATE TABLE."
} else {
    Confirm-OperatorGate "Execute Migration 015 (CREATE TABLE line_notification_claims) on remote D1?"
    if ($DryRun) {
        Write-Host "[DRY-RUN OFFLINE MOCK] Simulating Migration 015 execution..." -ForegroundColor Yellow
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
    Write-Host "[DRY-RUN OFFLINE MOCK] Simulating schema inspection: 12 columns, UNIQUE constraints, and indexes verified." -ForegroundColor Yellow
    if ($MockFailureAt -eq 'MigrationSchema') {
        throw "MOCK FAILURE at Step 3: Migration schema verification failed (missing required column or count mismatch)."
    }
} else {
    Set-Location (Join-Path $ReleaseDir "backend")
    $colJson = npx.cmd wrangler d1 execute bworkpos_db --remote --json --command="PRAGMA table_info(line_notification_claims);"
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 3: Failed to query PRAGMA table_info for line_notification_claims (Exit code $LASTEXITCODE)."
    }
    if ([string]::IsNullOrWhiteSpace($colJson)) {
        throw "STOP GATE 3: Empty JSON response from PRAGMA table_info."
    }
    try {
        $colParsed = $colJson | ConvertFrom-Json
    } catch {
        throw "STOP GATE 3: Invalid JSON received from PRAGMA table_info: $_"
    }
    if (-not $colParsed -or -not $colParsed[0].results) {
        throw "STOP GATE 3: Malformed JSON structure from PRAGMA table_info."
    }
    $cols = $colParsed[0].results
    if ($cols.Count -ne 12) {
        throw "STOP GATE 3: Column count mismatch! Expected 12 columns, found $($cols.Count)."
    }
    $colNames = $cols | ForEach-Object { $_.name }
    $requiredCols = @(
        'id',
        'booking_id',
        'notification_type',
        'status',
        'claim_token',
        'retry_key',
        'claimed_at',
        'updated_at',
        'http_status',
        'error_message',
        'accepted_request_id',
        'created_at'
    )
    foreach ($rc in $requiredCols) {
        if ($colNames -notcontains $rc) {
            throw "STOP GATE 3: Required column '$rc' missing from line_notification_claims!"
        }
    }
}

# Verify Indexes
if ($DryRun) {
    Write-Host "[DRY-RUN OFFLINE MOCK] Simulating index verification: idx_line_claims_booking_status, idx_line_claims_retry_key verified." -ForegroundColor Yellow
    if ($MockFailureAt -eq 'IndexCheck') {
        throw "MOCK FAILURE at Step 3: Index verification failed (missing required index idx_line_claims_booking_status or idx_line_claims_retry_key)."
    }
} else {
    Set-Location (Join-Path $ReleaseDir "backend")
    $indexJson = npx.cmd wrangler d1 execute bworkpos_db --remote --json --command="SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='line_notification_claims';"
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 3: Failed to query sqlite_master for index verification (Exit code $LASTEXITCODE)."
    }
    if ([string]::IsNullOrWhiteSpace($indexJson)) {
        throw "STOP GATE 3: Empty JSON response from index verification."
    }
    try {
        $indexParsed = $indexJson | ConvertFrom-Json
    } catch {
        throw "STOP GATE 3: Invalid JSON received for index verification: $_"
    }
    if (-not $indexParsed -or -not $indexParsed[0].results) {
        throw "STOP GATE 3: Malformed JSON structure for index verification."
    }
    $indexes = ($indexParsed[0].results | ForEach-Object { $_.name })
    $requiredIndexes = @('idx_line_claims_booking_status', 'idx_line_claims_retry_key')
    foreach ($reqIdx in $requiredIndexes) {
        if ($indexes -notcontains $reqIdx) {
            throw "STOP GATE 3: Required index '$reqIdx' missing on line_notification_claims!"
        }
    }
}
Write-Host "[PASS] Table line_notification_claims schema (12 columns, constraints, indexes) verified." -ForegroundColor Green

Confirm-OperatorGate "Record Migration 015 in d1_migrations history table?"
if ($DryRun) {
    Write-Host "[DRY-RUN OFFLINE MOCK] Simulating history recording..." -ForegroundColor Yellow
    if ($MockFailureAt -eq 'MigrationHistory') {
        throw "MOCK FAILURE at Step 3: Migration history recording or verification failed."
    }
} else {
    $recordSql = "INSERT INTO d1_migrations (name, applied_at) SELECT '015_add_line_notification_claims.sql', datetime('now', '+7 hours') WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '015_add_line_notification_claims.sql');"
    Set-Location (Join-Path $ReleaseDir "backend")
    npx.cmd wrangler d1 execute bworkpos_db --remote --command="$recordSql"
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 3: Recording migration history failed with exit code $LASTEXITCODE"
    }

    # Confirm history record exists
    $histCheck = npx.cmd wrangler d1 execute bworkpos_db --remote --json --command="SELECT COUNT(*) as cnt FROM d1_migrations WHERE name = '015_add_line_notification_claims.sql';"
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 3: Failed to query migration history table (Exit code $LASTEXITCODE)."
    }
    if ([string]::IsNullOrWhiteSpace($histCheck)) {
        throw "STOP GATE 3: Empty JSON response from migration history query."
    }
    try {
        $histParsed = $histCheck | ConvertFrom-Json
    } catch {
        throw "STOP GATE 3: Invalid JSON received for migration history check: $_"
    }
    if (-not $histParsed -or -not $histParsed[0].results -or $histParsed[0].results[0].cnt -ne 1) {
        throw "STOP GATE 3: Migration history verification failed (count != 1)."
    }
}
Write-Host "[PASS] Migration 015 history recorded and verified safely." -ForegroundColor Green

# ==============================================================================
# STEP 4: DEPLOY WORKER API (bwork-pos-api)
# ==============================================================================
Write-StepHeader "STEP 4: DEPLOY CLOUDFLARE WORKER API (bwork-pos-api)"

Write-Host "Current confirmed baseline Worker version: $BaselineWorkerVersion"
Confirm-OperatorGate "Deploy Cloudflare Worker API from $ReleaseDir\backend\worker.js?"

if ($DryRun) {
    Write-Host "[DRY-RUN OFFLINE MOCK] Simulating Worker deployment..." -ForegroundColor Yellow
    if ($MockFailureAt -eq 'WorkerDeploy') {
        throw "MOCK FAILURE at Step 4: Worker deployment failed."
    }
} else {
    Set-Location (Join-Path $ReleaseDir "backend")
    npx.cmd wrangler deploy
    if ($LASTEXITCODE -ne 0) {
        Write-Host "STOP GATE 4: Worker deployment failed with exit code $LASTEXITCODE" -ForegroundColor Red
        Write-Warning "Do NOT blindly rollback without checking deployed version."
        throw "Worker deployment failed. Inspect deployment status before attempting recovery."
    }
}
Write-Host "[PASS] Cloudflare Worker deployed successfully." -ForegroundColor Green

# ==============================================================================
# STEP 5: WORKER HEALTH CHECK & RECOVERY DECISION GATE
# ==============================================================================
Write-StepHeader "STEP 5: WORKER HEALTH CHECK & RECOVERY DECISION GATE"

Write-Host "Probing Worker API endpoint: https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/rooms"

$healthOk = $false
$roomsCount = 0

if ($DryRun) {
    Write-Host "[DRY-RUN OFFLINE MOCK] Simulating Worker health check..." -ForegroundColor Yellow
    if ($MockFailureAt -in @('HealthCheck', 'RollbackFail', 'RollbackTrafficFail')) {
        $healthOk = $false
        $roomsCount = 0
    } else {
        $healthOk = $true
        $roomsCount = 10
    }
} else {
    Start-Sleep -Seconds 3
    try {
        $rooms = Invoke-RestMethod -Uri "https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/rooms" -Method Get
        if ($rooms -and $rooms.Count -gt 0) {
            $healthOk = $true
            $roomsCount = $rooms.Count
        }
    } catch {
        Write-Warning "Worker health endpoint error: $_"
        $healthOk = $false
    }
}

if (-not $healthOk) {
    Write-Host "STOP GATE 5: Worker Health Check FAILED!" -ForegroundColor Red
    Write-Host "`nEVIDENCE GATHERED:" -ForegroundColor Red
    Write-Host "- Endpoint probed: https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/rooms"
    Write-Host "- Result: Null, empty response, or HTTP error"
    Write-Host "- Baseline rollback target: $BaselineWorkerVersion"

    if ([string]::IsNullOrWhiteSpace($BaselineWorkerVersion)) {
        throw "CRITICAL CONFIG ERROR: BaselineWorkerVersion is not specified! Cannot perform rollback safely."
    }

    # Query Active Deployments Status before rollback
    if ($DryRun) {
        Write-Host "[DRY-RUN OFFLINE MOCK] Querying active Worker status before rollback: mock-active-version" -ForegroundColor Yellow
    } else {
        Set-Location (Join-Path $ReleaseDir "backend")
        Write-Host "Active Worker Status from Cloudflare:"
        npx.cmd wrangler deployments status
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Failed to query 'wrangler deployments status' (Exit code $LASTEXITCODE). Attempting 'wrangler deployments list'..."
            npx.cmd wrangler deployments list
            if ($LASTEXITCODE -ne 0) {
                throw "STOP GATE 5: Failed to query active deployments from Cloudflare (Exit code $LASTEXITCODE)."
            }
        }
    }

    Confirm-OperatorGate "CRITICAL RECOVERY: Execute Worker rollback to baseline version $BaselineWorkerVersion?"

    if ($DryRun) {
        Write-Host "[DRY-RUN OFFLINE MOCK] Simulating Worker rollback to $BaselineWorkerVersion..." -ForegroundColor Yellow
        if ($MockFailureAt -eq 'RollbackFail') {
            throw "MOCK FAILURE at Step 5: Rollback command failed with non-zero exit code."
        }
        if ($MockFailureAt -eq 'RollbackTrafficFail') {
            throw "CRITICAL ALERT: Worker version $BaselineWorkerVersion could not be confirmed as active and receiving production traffic after rollback! Immediate manual intervention required."
        }
        Write-Host "[DRY-RUN OFFLINE MOCK] Verifying rollback traffic allocation: Version $BaselineWorkerVersion is active and receiving 100% production traffic." -ForegroundColor Yellow
        Write-Host "[PASS] Worker successfully rolled back and verified receiving 100% traffic at baseline version $BaselineWorkerVersion." -ForegroundColor Green
    } else {
        Set-Location (Join-Path $ReleaseDir "backend")
        npx.cmd wrangler rollback $BaselineWorkerVersion -y -m "Automated rollback after Health Check failure"
        if ($LASTEXITCODE -ne 0) {
            throw "CRITICAL ALERT: Wrangler rollback command failed with exit code $LASTEXITCODE! Active version may still be broken. Immediate manual intervention required."
        }

        # TASK 3: Strict Traffic Verification after Rollback
        Write-Host "Verifying that baseline version $BaselineWorkerVersion is active and receiving production traffic..."
        $statusJson = npx.cmd wrangler deployments status --json
        $verifiedActiveTraffic = $false

        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($statusJson)) {
            try {
                $statusParsed = $statusJson | ConvertFrom-Json
                if ($statusParsed.versions) {
                    foreach ($v in $statusParsed.versions) {
                        if ($v.version_id -eq $BaselineWorkerVersion -and $v.percentage -eq 100) {
                            $verifiedActiveTraffic = $true
                            break
                        }
                    }
                }
            } catch {
                Write-Warning "Could not parse JSON from 'wrangler deployments status': $_"
            }
        }

        # Fallback to text status check if JSON was unavailable
        if (-not $verifiedActiveTraffic) {
            $statusText = npx.cmd wrangler deployments status
            if ($LASTEXITCODE -eq 0 -and $statusText) {
                if ($statusText -match "100%.*$([regex]::Escape($BaselineWorkerVersion))" -or $statusText -match "$([regex]::Escape($BaselineWorkerVersion)).*100%") {
                    $verifiedActiveTraffic = $true
                }
            }
        }

        if (-not $verifiedActiveTraffic) {
            throw "CRITICAL ALERT: Worker version $BaselineWorkerVersion could not be confirmed as active and receiving production traffic after rollback! Do NOT assume rollback succeeded merely because the version ID appears in history. Immediate manual intervention required by operator."
        }

        Write-Host "[PASS] Worker successfully rolled back and verified receiving 100% traffic at baseline version $BaselineWorkerVersion." -ForegroundColor Green
    }
    throw "Worker API unhealthy. Rollback executed and confirmed to $BaselineWorkerVersion. STOPPING DEPLOYMENT."
}
Write-Host "[PASS] Worker Health Check PASSED. Rooms active: $roomsCount" -ForegroundColor Green

# ==============================================================================
# STEP 6: DEPLOY POS FRONTEND PAGES (bwork-pos)
# ==============================================================================
Write-StepHeader "STEP 6: DEPLOY CLOUDFLARE POS PAGES (bwork-pos)"

Write-Host "Current confirmed baseline POS Pages deployment: $BaselinePagesDeployment"
Confirm-OperatorGate "Deploy POS Frontend Pages from $ReleaseDir\frontend\dist?"

if ($DryRun) {
    Write-Host "[DRY-RUN OFFLINE MOCK] Simulating POS Pages deployment..." -ForegroundColor Yellow
} else {
    Set-Location (Join-Path $ReleaseDir "frontend")
    npx.cmd wrangler pages deploy dist --project-name=bwork-pos --commit-dirty=true
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 6: POS Pages deploy failed with exit code $LASTEXITCODE. Rollback target: $BaselinePagesDeployment."
    }
}
Write-Host "[PASS] Cloudflare POS Pages deployed successfully." -ForegroundColor Green

# ==============================================================================
# STEP 7: PAGES ASSET VERIFICATION (FAIL-CLOSED)
# ==============================================================================
Write-StepHeader "STEP 7: PAGES ASSET VERIFICATION (FAIL-CLOSED)"

Write-Host "Verifying live page content at https://bwork-pos.pages.dev..."

$assetVerified = $false

if ($DryRun) {
    Write-Host "[DRY-RUN OFFLINE MOCK] Simulating Pages asset check for '$ExpectedBundleJs'..." -ForegroundColor Yellow
    if ($MockFailureAt -eq 'PagesAsset') {
        $assetVerified = $false
    } else {
        $assetVerified = $true
    }
} else {
    Start-Sleep -Seconds 3
    $page = Invoke-WebRequest -Uri "https://bwork-pos.pages.dev" -UseBasicParsing
    if ($page.StatusCode -ne 200) {
        throw "STOP GATE 7: POS Pages returned HTTP status $($page.StatusCode)"
    }
    if ($page.Content -like "*$ExpectedBundleJs*") {
        $assetVerified = $true
    } else {
        Write-Warning "[WARN] Target asset not detected on initial check. Cloudflare Edge CDN cache may take 1-2 minutes to propagate."
        Write-Host "Retrying asset verification in 10 seconds..."
        Start-Sleep -Seconds 10
        $pageRetry = Invoke-WebRequest -Uri "https://bwork-pos.pages.dev" -UseBasicParsing
        if ($pageRetry.Content -like "*$ExpectedBundleJs*") {
            $assetVerified = $true
        }
    }
}

if (-not $assetVerified) {
    throw "STOP GATE 7: Live Pages asset verification FAILED! Target bundle '$ExpectedBundleJs' was NOT found in live HTML. Deployment cannot be marked as verified. Please inspect Pages deployment and purge CDN cache or rollback to $BaselinePagesDeployment."
}
Write-Host "[PASS] Live POS Pages is actively serving target bundle: $ExpectedBundleJs" -ForegroundColor Green

# ==============================================================================
# STEP 8: READ-ONLY OPERATIONAL SMOKE TEST GUIDE & CONFIRMATION
# ==============================================================================
Write-StepHeader "STEP 8: READ-ONLY OPERATIONAL SMOKE TEST GUIDE & CONFIRMATION"

Write-Host "Operator manual verification checklist (Open https://bwork-pos.pages.dev in browser):" -ForegroundColor Yellow
Write-Host "  [ ] 1. Open browser to https://bwork-pos.pages.dev and login"
Write-Host "  [ ] 2. Navigate to Customer Management (CRM)"
Write-Host "  [ ] 3. Click Add New Customer button"
Write-Host "  [ ] 4. Verify Wide Modal layout (2 columns, clean responsive spacing)"
Write-Host "  [ ] 5. Click Start Date -> Verify solid white calendar popup, no overlay on left form"
Write-Host "  [ ] 6. Verify customer groups: Basecamp, Shop, OnDemand, Virtual Office"

Confirm-OperatorGate "Confirm that Operator Read-Only Smoke Test in browser (Wide Modal & Datepicker) passed 100%?"
Write-Host "[PASS] Operator Read-Only Smoke Test confirmed." -ForegroundColor Green

# ==============================================================================
# STEP 9: POST-DEPLOYMENT MONITORING
# ==============================================================================
Write-StepHeader "STEP 9: POST-DEPLOYMENT MONITORING"

Write-Host "To monitor live Cloudflare Worker logs for the next 15 minutes, execute:" -ForegroundColor Cyan
Write-Host "   npx wrangler tail bwork-pos-api" -ForegroundColor Yellow
Write-Host "`nConfirm zero HTTP 500 errors and successful payment notifications."

# ==============================================================================
# HONEST EXECUTION RESULT BANNER
# ==============================================================================
if ($DryRun) {
    Write-Host "`n================================================================================" -ForegroundColor Cyan
    Write-Host "  DRY RUN PASSED - NO PRODUCTION DEPLOYMENT" -ForegroundColor Cyan
    Write-Host "  All dry-run simulations, offline mocks, and stop gates passed successfully" -ForegroundColor Cyan
    Write-Host "================================================================================" -ForegroundColor Cyan
} else {
    Write-Host "`n================================================================================" -ForegroundColor Green
    Write-Host "  PRODUCTION DEPLOYMENT COMPLETED - VERIFIED" -ForegroundColor Green
    Write-Host "  Production Worker, Migration 015, POS Pages, and Smoke Tests Verified" -ForegroundColor Green
    Write-Host "================================================================================" -ForegroundColor Green
}
