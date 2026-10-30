<#
.SYNOPSIS
    BWORK-POS Production Git Fast-Forward Sync Script
.DESCRIPTION
    Safely synchronizes GitHub Production repository 'main' branch to the 
    already-deployed and verified Release Candidate (2b56b8500f9eb53b45a1c03c87c010de9f67adf9).
    
    Safety Invariants:
      1. Cloudflare Pages auto-deploy protection verified explicitly boolean false for both projects.
      2. No bypass flags (-SkipCloudflareCheck removed).
      3. Strict two-stage human approval gate required in live mode.
      4. Fully non-mutating DryRun mode (no branches created/deleted, no merges, no pushes).
      5. Full pre-push recheck of Cloudflare protection, remote baseline, and local HEAD.
      6. Non-destructive failure recovery guidance (no automated git reset --hard).
#>
[CmdletBinding()]
param(
    [switch]$DryRun = $false,
    [string]$MockFailureAt = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $DryRun -and -not [string]::IsNullOrEmpty($MockFailureAt)) {
    throw "SAFETY VIOLATION: Mock failure testing parameter is strictly forbidden in live production mode."
}

$ExpectedBaseline = "bd6947590d9fe0b994248e964d9feec5505b26a0"
$ExpectedRcSha    = "2b56b8500f9eb53b45a1c03c87c010de9f67adf9"
$ProductionDir    = "D:\Project BL\Bwork-POS"
$ReleaseDir       = "D:\Project BL\Bwork-POS-Release"

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "  BWORK-POS | PRODUCTION GIT FAST-FORWARD SYNC" -ForegroundColor Cyan
Write-Host "  Execution Mode: $(if ($DryRun) { 'GENUINE READ-ONLY DRY-RUN' } else { 'LIVE PRODUCTION EXECUTION' })" -ForegroundColor $(if ($DryRun) { 'Yellow' } else { 'Green' })
Write-Host "  Expected Baseline: $ExpectedBaseline" -ForegroundColor Gray
Write-Host "  Target RC SHA:     $ExpectedRcSha" -ForegroundColor Gray
Write-Host "================================================================================" -ForegroundColor Cyan

# ------------------------------------------------------------------------------
# CLOUDFLARE PROTECTION VALIDATION FUNCTION
# ------------------------------------------------------------------------------
function Test-CloudflareAutoDeployProtection {
    [CmdletBinding()]
    param(
        [string]$MockFailure = ''
    )

    if ($MockFailure -eq 'CloudflareApiError') {
        throw "STOP GATE 0: Cloudflare API request failed with HTTP 500 (Simulated Test)."
    }

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

    $projects = @('bwork-pos', 'bwork-booking')
    foreach ($projName in $projects) {
        $proj = $null
        try {
            $proj = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accId/pages/projects/$projName" -Headers $headers -Method Get
        } catch {
            throw "STOP GATE 0: Cloudflare API request for project '$projName' failed. Error: $($_.Exception.Message)"
        }

        if ($null -eq $proj -or -not $proj.success -or $null -eq $proj.result) {
            throw "STOP GATE 0: Cloudflare API returned invalid or empty response for project '$projName'."
        }

        # Mock behavior injection for unit testing (DryRun only)
        if ($MockFailure -in @('ApprovalRejection', 'RemoteHeadMismatch', 'RcShaMismatch', 'PushFailure', 'MockCloudflarePassed')) {
            $proj.result.source.config.production_deployments_enabled = $false
        }
        if ($MockFailure -eq 'CloudflareMissingFields' -and $projName -eq 'bwork-pos') {
            $proj.result.source.config.production_deployments_enabled = $null
        }
        if ($MockFailure -eq 'CloudflareWrongRepo' -and $projName -eq 'bwork-pos') {
            $proj.result.source.config.repo_name = 'Wrong-Repo'
        }
        if ($MockFailure -eq 'CloudflareWrongBranch' -and $projName -eq 'bwork-pos') {
            $proj.result.production_branch = 'develop'
        }
        if ($MockFailure -eq 'CloudflareBookingEnabled' -and $projName -eq 'bwork-booking') {
            $proj.result.source.config.production_deployments_enabled = $true
        }

        # 1. Project name check
        if ($proj.result.name -ne $projName) {
            throw "STOP GATE 0: Project name mismatch. Expected '$projName' but got '$($proj.result.name)'."
        }

        # 2. Source and GitHub integration check
        if ($null -eq $proj.result.source -or $proj.result.source.type -ne 'github') {
            throw "STOP GATE 0: Project '$projName' is not connected via GitHub provider (source.type: '$($proj.result.source.type)')."
        }
        $cfg = $proj.result.source.config
        if ($null -eq $cfg) {
            throw "STOP GATE 0: Project '$projName' missing source.config configuration."
        }

        # 3. Connected GitHub repo check
        if ($cfg.owner -ne 'depp48106' -or $cfg.repo_name -ne 'Bwork-POS') {
            throw "STOP GATE 0: Project '$projName' connected to unexpected repository ('$($cfg.owner)/$($cfg.repo_name)'). Expected 'depp48106/Bwork-POS'."
        }

        # 4. Production branch check
        if ($proj.result.production_branch -ne 'main' -or $cfg.production_branch -ne 'main') {
            throw "STOP GATE 0: Project '$projName' production branch is not 'main' (Project: '$($proj.result.production_branch)', Config: '$($cfg.production_branch)')."
        }

        # 5. Strict boolean false check for production_deployments_enabled
        $prodDeploy = $cfg.production_deployments_enabled
        $allDeploy  = $cfg.deployments_enabled

        Write-Host "  Project '$projName':" -ForegroundColor Cyan
        Write-Host "    production_branch:              $($proj.result.production_branch)"
        Write-Host "    connected_repo:                 $($cfg.owner)/$($cfg.repo_name)"
        Write-Host "    deployments_enabled:            $allDeploy"
        Write-Host "    production_deployments_enabled: $prodDeploy"

        if ($null -eq $prodDeploy) {
            throw "STOP GATE 0: Project '$projName' has null/missing 'production_deployments_enabled'. Cannot assume safe."
        }
        if ($prodDeploy -isnot [bool]) {
            throw "STOP GATE 0: Project '$projName' 'production_deployments_enabled' is not a valid boolean (Type: $($prodDeploy.GetType().FullName))."
        }
        if ($prodDeploy -ne $false) {
            throw "STOP GATE 0 FAILED: Project '$projName' has 'production_deployments_enabled = $prodDeploy'! Automatic deployments on 'main' are still ACTIVE. You must Pause automatic deployments in Cloudflare Pages Dashboard before proceeding."
        }
    }

    Write-Host "  -> Cloudflare Pages auto-deployments verified explicitly PAUSED on 'main' for all projects." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# STOP GATE 0: VERIFY CLOUDFLARE AUTO-DEPLOY PROTECTION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 0] Verifying Cloudflare Pages Auto-Deployment Protection..." -ForegroundColor Cyan
Test-CloudflareAutoDeployProtection -MockFailure $MockFailureAt

# ------------------------------------------------------------------------------
# STOP GATE 1: WORKSPACE & ACTIVE BRANCH VERIFICATION
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
# STOP GATE 4: REMOTE ORIGIN HEAD VERIFICATION (NON-MUTATING)
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 4] Verifying Remote origin/main HEAD..." -ForegroundColor Cyan
if ($MockFailureAt -eq 'RemoteHeadMismatch') {
    $remoteHead = "0000000000000000000000000000000000000000"
} else {
    $lsRemoteOutput = & git ls-remote origin refs/heads/main
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 4: Failed to query remote origin/main via ls-remote. Exit code: $LASTEXITCODE"
    }
    $remoteHead = ($lsRemoteOutput -split "\s+")[0].Trim()
}

if ($remoteHead -ne $ExpectedBaseline) {
    throw "STOP GATE 4: Remote origin/main HEAD ($remoteHead) does NOT match expected baseline ($ExpectedBaseline)!"
}
Write-Host "  -> Remote origin/main matches baseline: $remoteHead" -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 5: RESOLVE & VERIFY TARGET RC SHA
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 5] Resolving and Verifying Deployed RC SHA..." -ForegroundColor Cyan
if ($MockFailureAt -eq 'RcShaMismatch') {
    $rcSha = "1111111111111111111111111111111111111111"
} else {
    $rcShaOutput = & git -C $ReleaseDir rev-parse refs/heads/release/selective-customer-quota-line-confirmation-20261029
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 5: Failed to resolve RC branch SHA in '$ReleaseDir'. Exit code: $LASTEXITCODE"
    }
    $rcSha = $rcShaOutput.Trim()
}

if ($rcSha -ne $ExpectedRcSha) {
    throw "STOP GATE 5: Resolved RC SHA ($rcSha) does NOT match expected deployed RC SHA ($ExpectedRcSha)!"
}
Write-Host "  -> Deployed RC SHA verified: $rcSha" -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 6: FAST-FORWARD ANCESTRY VERIFICATION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 6] Verifying Fast-Forward Ancestry..." -ForegroundColor Cyan
& git -C $ReleaseDir merge-base --is-ancestor $ExpectedBaseline $ExpectedRcSha
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 6: Baseline ($ExpectedBaseline) is NOT an ancestor of target RC ($ExpectedRcSha)! Pure fast-forward is impossible."
}
Write-Host "  -> Ancestry verified: Target is a direct fast-forward descendant." -ForegroundColor Green

# ------------------------------------------------------------------------------
# STOP GATE 7: COMMIT COUNTS VERIFICATION
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 7] Verifying Ahead / Behind Commit Counts..." -ForegroundColor Cyan
$aheadOutput = (& git -C $ReleaseDir rev-list --count "${ExpectedBaseline}..${ExpectedRcSha}")
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 7: Failed to count commits ahead. Exit code: $LASTEXITCODE"
}
$ahead = [int]($aheadOutput.Trim())

$behindOutput = (& git -C $ReleaseDir rev-list --count "${ExpectedRcSha}..${ExpectedBaseline}")
if ($LASTEXITCODE -ne 0) {
    throw "STOP GATE 7: Failed to count commits behind. Exit code: $LASTEXITCODE"
}
$behind = [int]($behindOutput.Trim())

Write-Host "  Commits ahead:  $ahead (Expected: 2)"
Write-Host "  Commits behind: $behind (Expected: 0)"

if ($ahead -ne 2 -or $behind -ne 0) {
    throw "STOP GATE 7: Commit count discrepancy! Ahead: $ahead (expected 2), Behind: $behind (expected 0)."
}
Write-Host "  -> Commit count check PASSED (2 ahead, 0 behind)." -ForegroundColor Green

# ------------------------------------------------------------------------------
# HUMAN APPROVAL GATE 1: PRE-MERGE MUTATION AUTHORIZATION
# ------------------------------------------------------------------------------
if ($DryRun) {
    Write-Host "`n[DRY-RUN INSPECTION] Skipping Gate 1 human prompt. Simulated approval." -ForegroundColor Yellow
    if ($MockFailureAt -eq 'ApprovalRejection') {
        throw "APPROVAL REJECTED: Operator rejected approval gate (Simulated Test)."
    }
} else {
    Write-Host "`n================================================================================" -ForegroundColor Yellow
    Write-Host "  MANUAL APPROVAL GATE 1: PRODUCTION GIT FAST-FORWARD CONFIRMATION" -ForegroundColor Yellow
    Write-Host "  Target local workspace: $ProductionDir" -ForegroundColor Yellow
    Write-Host "  Advancing branch 'main' from $ExpectedBaseline to $ExpectedRcSha" -ForegroundColor Yellow
    Write-Host "================================================================================" -ForegroundColor Yellow
    Write-Host "Type exactly 'APPROVE PRODUCTION GIT SYNC' to authorize local fast-forward merge:" -ForegroundColor Yellow
    $userInput1 = Read-Host "Confirmation"
    if ($userInput1 -ne 'APPROVE PRODUCTION GIT SYNC') {
        throw "APPROVAL REJECTED: Operator entered '$userInput1'. Expected exact phrase 'APPROVE PRODUCTION GIT SYNC'. Execution aborted."
    }
    Write-Host "  -> Approval 1 granted." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# STOP GATE 8: EXECUTE PURE FAST-FORWARD MERGE
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 8] Executing Pure Fast-Forward Merge (--ff-only)..." -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "  [DRY-RUN] Simulating fast-forward merge to $ExpectedRcSha (No Git mutation performed)..." -ForegroundColor Yellow
} else {
    # Fetch directly into FETCH_HEAD (non-destructive, creates no temporary named branch)
    Write-Host "  Fetching RC commit directly into FETCH_HEAD from '$ReleaseDir'..."
    & git fetch $ReleaseDir release/selective-customer-quota-line-confirmation-20261029
    if ($LASTEXITCODE -ne 0) {
        throw "STOP GATE 8: Failed to fetch RC commit from '$ReleaseDir'. Exit code: $LASTEXITCODE"
    }

    $fetchedSha = (& git rev-parse FETCH_HEAD).Trim()
    if ($fetchedSha -ne $ExpectedRcSha) {
        throw "STOP GATE 8: FETCH_HEAD ($fetchedSha) does NOT match expected target RC ($ExpectedRcSha)!"
    }

    & git merge --ff-only FETCH_HEAD
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
# TASK 5: PRE-PUSH ATOMIC RECHECKS
# ------------------------------------------------------------------------------
Write-Host "`n[TASK 5 PRE-PUSH RECHECK] Performing atomic pre-push verifications..." -ForegroundColor Cyan

# 1. Reconfirm Cloudflare auto-deploy protection
Write-Host "  1. Re-checking Cloudflare Pages auto-deploy status..."
Test-CloudflareAutoDeployProtection -MockFailure $MockFailureAt

# 2. Reconfirm remote main baseline
Write-Host "  2. Re-verifying remote origin/main HEAD..."
$prePushRemoteCheck = & git ls-remote origin refs/heads/main
if ($LASTEXITCODE -ne 0) {
    throw "STOP PRE-PUSH: Failed to query remote origin/main HEAD before push. Exit code: $LASTEXITCODE"
}
$prePushRemoteSha = ($prePushRemoteCheck -split "\s+")[0].Trim()
if ($prePushRemoteSha -ne $ExpectedBaseline) {
    throw "STOP PRE-PUSH: Remote origin/main HEAD changed to '$prePushRemoteSha'! Expected baseline was '$ExpectedBaseline'. PUSH ABORTED."
}
Write-Host "     Remote origin/main confirmed still at baseline: $prePushRemoteSha" -ForegroundColor Green

# 3. Reconfirm local HEAD equals target RC
Write-Host "  3. Re-verifying local HEAD equals target RC..."
if (-not $DryRun) {
    $currentLocalHead = (& git rev-parse HEAD).Trim()
    if ($currentLocalHead -ne $ExpectedRcSha) {
        throw "STOP PRE-PUSH: Local HEAD ($currentLocalHead) does NOT match target RC ($ExpectedRcSha)! PUSH ABORTED."
    }
    Write-Host "     Local HEAD confirmed at target RC: $currentLocalHead" -ForegroundColor Green
} else {
    Write-Host "     [DRY-RUN] Local HEAD check simulated." -ForegroundColor Yellow
}

# ------------------------------------------------------------------------------
# HUMAN APPROVAL GATE 2: PRE-PUSH MUTATION AUTHORIZATION
# ------------------------------------------------------------------------------
if ($DryRun) {
    Write-Host "`n[DRY-RUN INSPECTION] Skipping Gate 2 human prompt. Simulated approval." -ForegroundColor Yellow
} else {
    Write-Host "`n================================================================================" -ForegroundColor Yellow
    Write-Host "  MANUAL APPROVAL GATE 2: PRODUCTION GIT PUSH CONFIRMATION" -ForegroundColor Yellow
    Write-Host "  This will push commit $ExpectedRcSha to remote 'origin/main' on GitHub." -ForegroundColor Yellow
    Write-Host "================================================================================" -ForegroundColor Yellow
    Write-Host "Type exactly 'CONFIRM PUSH TO PRODUCTION' to authorize git push:" -ForegroundColor Yellow
    $userInput2 = Read-Host "Confirmation"
    if ($userInput2 -ne 'CONFIRM PUSH TO PRODUCTION') {
        throw "APPROVAL REJECTED: Operator entered '$userInput2'. Expected exact phrase 'CONFIRM PUSH TO PRODUCTION'. Push aborted."
    }
    Write-Host "  -> Approval 2 granted." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# STOP GATE 9: PUSH EXECUTION & NON-DESTRUCTIVE RECOVERY
# ------------------------------------------------------------------------------
Write-Host "`n[STOP GATE 9] Pushing to Remote origin/main & Verifying Ref..." -ForegroundColor Cyan
if ($DryRun) {
    if ($MockFailureAt -eq 'PushFailure') {
        throw "STOP GATE 9: Simulated push failure in DryRun mode."
    }
    Write-Host "  [DRY-RUN] Simulating 'git push origin main' (Zero remote mutation performed)..." -ForegroundColor Yellow
    Write-Host "`n================================================================================" -ForegroundColor Cyan
    Write-Host "  GENUINE READ-ONLY DRY-RUN COMPLETED SUCCESSFULLY" -ForegroundColor Cyan
    Write-Host "  Zero local branches created/deleted. Zero Git mutations. Zero remote changes." -ForegroundColor Cyan
    Write-Host "================================================================================" -ForegroundColor Cyan
} else {
    try {
        if ($MockFailureAt -eq 'PushFailure') {
            throw "Simulated push failure (Network/Remote Error)"
        }
        $pushOutput = & git push origin main 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "git push origin main exited with code $LASTEXITCODE. Output: $pushOutput"
        }
    } catch {
        $failedLocalHead = (& git rev-parse HEAD).Trim()
        $failedRemoteCheck = & git ls-remote origin refs/heads/main
        $failedRemoteHead = ($failedRemoteCheck -split "\s+")[0].Trim()

        Write-Host "`n********************************************************************************" -ForegroundColor Red
        Write-Host "  CRITICAL ALERT: GIT PUSH TO PRODUCTION REMOTE FAILED!" -ForegroundColor Red
        Write-Host "********************************************************************************" -ForegroundColor Red
        Write-Host "  Local HEAD:     $failedLocalHead (Fast-forwarded to Target RC)" -ForegroundColor Yellow
        Write-Host "  Remote HEAD:    $failedRemoteHead (Still at Baseline on GitHub)" -ForegroundColor Yellow
        Write-Host "  Push Error:     $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "`n  INCIDENT REPORT & MANUAL INVESTIGATION REQUIRED:" -ForegroundColor Cyan
        Write-Host "    - Local Branch HEAD:   $failedLocalHead" -ForegroundColor White
        Write-Host "    - Remote origin/main:  $failedRemoteHead" -ForegroundColor White
        Write-Host "    - Push Failure Detail: $($_.Exception.Message)" -ForegroundColor White
        Write-Host "`n  OPERATIONAL DIRECTIVE:" -ForegroundColor Yellow
        Write-Host "    1. STOP immediately. Do NOT run git reset, git update-ref, or force push." -ForegroundColor Yellow
        Write-Host "    2. Collect Git status, network telemetry, and GitHub permission logs." -ForegroundColor Yellow
        Write-Host "    3. Escalate for manual investigation and senior authorization before any retry." -ForegroundColor Yellow
        Write-Host "`n  STATUS: PRODUCTION GIT SYNC HAS NOT COMPLETED. REMOTE MAIN UNMODIFIED." -ForegroundColor Red
        Write-Host "********************************************************************************`n" -ForegroundColor Red
        throw "STOP GATE 9: Production push failed. Remote remains at $failedRemoteHead. STOPPING. Manual investigation required."
    }

    $finalRemoteCheck = & git ls-remote origin refs/heads/main
    $finalRemoteHead = ($finalRemoteCheck -split "\s+")[0].Trim()
    if ($finalRemoteHead -ne $ExpectedRcSha) {
        throw "STOP GATE 9: Remote origin/main ($finalRemoteHead) does NOT match target RC ($ExpectedRcSha) after push!"
    }

    Write-Host "  -> Remote origin/main verified matching target RC: $finalRemoteHead" -ForegroundColor Green

    Write-Host "`n================================================================================" -ForegroundColor Green
    Write-Host "  PRODUCTION GIT SYNC COMPLETED SUCCESSFULLY - 100% VERIFIED" -ForegroundColor Green
    Write-Host "  GitHub Production main is now synchronized to Deployed RC $ExpectedRcSha" -ForegroundColor Green
    Write-Host "================================================================================" -ForegroundColor Green
}
