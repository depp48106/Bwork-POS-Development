<#
.SYNOPSIS
    BWORK-POS Production Git Fast-Forward Sync Script
.DESCRIPTION
    Safely synchronizes GitHub Production repository 'main' branch to the 
    already-deployed and verified Release Candidate (2b56b8500f9eb53b45a1c03c87c010de9f67adf9).
    Enforces strict Fail-Closed Stop Gates:
      - Cloudflare Pages auto-deploy pause verification
      - Clean working tree check
      - Local and remote baseline HEAD matching bd694759
      - Exact RC SHA verification
      - Fast-forward ancestry validation
      - Exact ahead/behind commit counts (2 ahead, 0 behind)
      - Pure fast-forward merge (--ff-only)
      - Post-push remote ref verification
#>
[CmdletBinding()]
param(
    [switch]$DryRun = $false,
    [switch]$SkipCloudflareCheck = $false
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedBaseline = "bd6947590d9fe0b994248e964d9feec5505b26a0"
$ExpectedRcSha    = "2b56b8500f9eb53b45a1c03c87c010de9f67adf9"
$ProductionDir    = "D:\Project BL\Bwork-POS"
$ReleaseDir       = "D:\Project BL\Bwork-POS-Release"

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "  BWORK-POS | PRODUCTION GIT FAST-FORWARD SYNC" -ForegroundColor Cyan
Write-Host "  Mode: $(if ($DryRun) { 'DRY-RUN INSPECTION' } else { 'LIVE EXECUTION' })" -ForegroundColor $(if ($DryRun) { 'Yellow' } else { 'Green' })
Write-Host "  Baseline: $ExpectedBaseline" -ForegroundColor Gray
Write-Host "  Target:   $ExpectedRcSha" -ForegroundColor Gray
Write-Host "================================================================================" -ForegroundColor Cyan

# ------------------------------------------------------------------------------
# STOP GATE 0: CLOUDFLARE PAGES AUTO-DEPLOY PROTECTION CHECK
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 0] Verifying Cloudflare Pages Auto-Deployment Protection..." -ForegroundColor Cyan

if (-not $SkipCloudflareCheck) {
    $tomlPath = Join-Path $env:APPDATA "xdg.config\.wrangler\config\default.toml"
    if (-not (Test-Path $tomlPath)) {
        throw "STOP GATE 0: Wrangler configuration file not found at '$tomlPath'. Cannot verify Cloudflare auto-deploy status."
    }

    $tomlContent = Get-Content $tomlPath -Raw
    $token = ""
    foreach ($line in ($tomlContent -split "`r?`n")) {
        if ($line -match '^oauth_token\s*=\s*"([^"]+)"') {
            $token = $matches[1]
            break
        }
    }

    if (-not $token) {
        throw "STOP GATE 0: Unable to extract oauth_token from '$tomlPath'."
    }

    $accId = "8cfd6bbc5cd3025b0139f49d05ae2ad4"
    $headers = @{
        'Authorization' = "Bearer $token"
        'Content-Type'  = "application/json"
    }

    try {
        $posProj = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accId/pages/projects/bwork-pos" -Headers $headers -Method Get
        $bookingProj = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accId/pages/projects/bwork-booking" -Headers $headers -Method Get
    } catch {
        throw "STOP GATE 0: Cloudflare API call failed. Error: $_"
    }

    $posAutoDeploy = $posProj.result.source.config.production_deployments_enabled
    $bookingAutoDeploy = $bookingProj.result.source.config.production_deployments_enabled

    Write-Host "  bwork-pos production_deployments_enabled:     $posAutoDeploy"
    Write-Host "  bwork-booking production_deployments_enabled: $bookingAutoDeploy"

    if ($posAutoDeploy -eq $true -or $bookingAutoDeploy -eq $true) {
        throw "STOP GATE 0 FAILED: Cloudflare Pages automatic deployments are still ACTIVE on main! Pushing would trigger unintended builds. Please pause automatic deployments in Cloudflare Pages Dashboard before proceeding."
    }
    Write-Host "  -> Cloudflare Pages auto-deployments are confirmed PAUSED." -ForegroundColor Green
} else {
    Write-Host "  -> [WARNING] Cloudflare auto-deploy check skipped by operator flag." -ForegroundColor Yellow
}

# ------------------------------------------------------------------------------
# STOP GATE 1: WORKSPACE & BRANCH VERIFICATION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 1] Verifying Workspace and Active Branch..." -ForegroundColor Cyan
if (-not (Test-Path $ProductionDir)) {
    throw "STOP GATE 1: Production workspace directory does not exist at '$ProductionDir'."
}
Set-Location -LiteralPath $ProductionDir

$branchOutput = & git branch --show-current
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 1: Failed to query git branch in '$ProductionDir'. Exit code: $LASTEXITCODE"
}
$currentBranch = $branchOutput.Trim()
if ($currentBranch -ne 'main') {
    throw "STOP GATE 1: Expected branch 'main' in Production workspace but found '$currentBranch'."
}
Write-Host "  -> Active branch is 'main'." -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 2: CLEAN WORKING TREE VERIFICATION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 2] Verifying Clean Working Tree..." -ForegroundColor Cyan
$statusOutput = & git status --porcelain
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 2: Failed to query git status. Exit code: $LASTEXITCODE"
}
if ($statusOutput -and $statusOutput.Length -gt 0) {
    throw "STOP GATE 2: Production working tree is dirty! Commit or stash all changes before syncing."
}
Write-Host "  -> Working tree is clean." -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 3: LOCAL BASELINE HEAD VERIFICATION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 3] Verifying Local Baseline HEAD..." -ForegroundColor Cyan
$localHeadOutput = & git rev-parse HEAD
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 3: Failed to query local HEAD. Exit code: $LASTEXITCODE"
}
$localHead = $localHeadOutput.Trim()
if ($localHead -ne $ExpectedBaseline) {
    throw "STOP GATE 3: Local HEAD ($localHead) does NOT match expected baseline ($ExpectedBaseline)!"
}
Write-Host "  -> Local HEAD matches baseline: $localHead" -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 4: REMOTE ORIGIN HEAD VERIFICATION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 4] Verifying Remote origin/main HEAD..." -ForegroundColor Cyan
& git fetch origin main
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 4: Failed to fetch origin main. Exit code: $LASTEXITCODE"
}

$remoteHeadOutput = & git rev-parse origin/main
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 4: Failed to query remote origin/main HEAD. Exit code: $LASTEXITCODE"
}
$remoteHead = $remoteHeadOutput.Trim()
if ($remoteHead -ne $ExpectedBaseline) {
    throw "STOP GATE 4: Remote origin/main HEAD ($remoteHead) does NOT match expected baseline ($ExpectedBaseline)!"
}
Write-Host "  -> Remote origin/main matches baseline: $remoteHead" -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 5: FETCH DEPLOYED RC & VERIFY EXACT SHA
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 5] Fetching and Verifying Deployed RC SHA..." -ForegroundColor Cyan
& git fetch $ReleaseDir release/selective-customer-quota-line-confirmation-20261029:sync-candidate-rc
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 5: Failed to fetch RC branch from '$ReleaseDir'. Exit code: $LASTEXITCODE"
}

$rcShaOutput = & git rev-parse sync-candidate-rc
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 5: Failed to resolve ref 'sync-candidate-rc'. Exit code: $LASTEXITCODE"
}
$rcSha = $rcShaOutput.Trim()
if ($rcSha -ne $ExpectedRcSha) {
    & git branch -D sync-candidate-rc
    throw "STOP GATE 5: Fetched ref SHA ($rcSha) does NOT match expected deployed RC SHA ($ExpectedRcSha)!"
}
Write-Host "  -> Deployed RC SHA verified: $rcSha" -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 6: FAST-FORWARD ANCESTRY VERIFICATION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 6] Verifying Fast-Forward Ancestry..." -ForegroundColor Cyan
& git merge-base --is-ancestor $ExpectedBaseline $ExpectedRcSha
if ($LASTEXITCODE -ne 0) {
    & git branch -D sync-candidate-rc
    throw "STOP GATE 6: Baseline ($ExpectedBaseline) is NOT an ancestor of target RC ($ExpectedRcSha)! Pure fast-forward is impossible."
}
Write-Host "  -> Ancestry verified: Target is a direct fast-forward descendant." -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 7: COMMIT COUNTS VERIFICATION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 7] Verifying Ahead / Behind Commit Counts..." -ForegroundColor Cyan
$aheadOutput = (& git rev-list --count "${ExpectedBaseline}..${ExpectedRcSha}")
if ($LASTEXITCODE -ne 0) {
    & git branch -D sync-candidate-rc
    throw "STOP GATE 7: Failed to count commits ahead. Exit code: $LASTEXITCODE"
}
$ahead = [int]($aheadOutput.Trim())

$behindOutput = (& git rev-list --count "${ExpectedRcSha}..${ExpectedBaseline}")
if ($LASTEXITCODE -ne 0) {
    & git branch -D sync-candidate-rc
    throw "STOP GATE 7: Failed to count commits behind. Exit code: $LASTEXITCODE"
}
$behind = [int]($behindOutput.Trim())

Write-Host "  Commits ahead:  $ahead (Expected: 2)"
Write-Host "  Commits behind: $behind (Expected: 0)"

if ($ahead -ne 2 -or $behind -ne 0) {
    & git branch -D sync-candidate-rc
    throw "STOP GATE 7: Commit count discrepancy! Ahead: $ahead (expected 2), Behind: $behind (expected 0)."
}
Write-Host "  -> Commit count check PASSED (2 ahead, 0 behind)." -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 8: EXECUTE PURE FAST-FORWARD MERGE
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 8] Executing Pure Fast-Forward Merge (--ff-only)..." -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "  [DRY-RUN] Simulating 'git merge --ff-only sync-candidate-rc'..." -ForegroundColor Yellow
} else {
    & git merge --ff-only sync-candidate-rc
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 8: Fast-forward merge failed! Exit code: $LASTEXITCODE"
    }

    $mergedHeadOutput = & git rev-parse HEAD
    $mergedHead = $mergedHeadOutput.Trim()
    if ($mergedHead -ne $ExpectedRcSha) {
        throw "STOP GATE 8: Local HEAD after merge ($mergedHead) does NOT match target RC ($ExpectedRcSha)!"
    }
    Write-Host "  -> Local main fast-forwarded successfully to: $mergedHead" -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# STOP GATE 9: PUSH TO REMOTE & POST-PUSH VERIFICATION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 9] Pushing to Remote origin/main & Verifying Ref..." -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "  [DRY-RUN] Simulating 'git push origin main'..." -ForegroundColor Yellow
    & git branch -D sync-candidate-rc
    Write-Host "`n================================================================================" -ForegroundColor Cyan
    Write-Host "  DRY-RUN COMPLETED SUCCESSFULLY" -ForegroundColor Cyan
    Write-Host "  All stop gates and verifications PASSED (Zero production mutations)." -ForegroundColor Cyan
    Write-Host "================================================================================" -ForegroundColor Cyan
} else {
    & git push origin main
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 9: Push to origin main failed! Exit code: $LASTEXITCODE"
    }

    & git fetch origin main
    $finalRemoteOutput = & git rev-parse origin/main
    $finalRemoteHead = $finalRemoteOutput.Trim()
    if ($finalRemoteHead -ne $ExpectedRcSha) {
        throw "STOP GATE 9: Remote origin/main ($finalRemoteHead) does NOT match target RC ($ExpectedRcSha) after push!"
    }

    & git branch -D sync-candidate-rc
    Write-Host "  -> Remote origin/main verified matching target RC: $finalRemoteHead" -ForegroundColor Green

    Write-Host "`n================================================================================" -ForegroundColor Green
    Write-Host "  PRODUCTION GIT SYNC COMPLETED SUCCESSFULLY" -ForegroundColor Green
    Write-Host "  GitHub Production main is now synchronized to Deployed RC $ExpectedRcSha" -ForegroundColor Green
    Write-Host "================================================================================" -ForegroundColor Green
}
