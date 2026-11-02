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
    [string]$MockFailureAt = '',
    [switch]$ExportFunctionsOnly = $false,
    [string]$ProductionDir = "D:\Project BL\Bwork-POS",
    [string]$ReleaseDir = "D:\Project BL\Bwork-POS-Release"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $DryRun -and -not $ExportFunctionsOnly -and -not [string]::IsNullOrEmpty($MockFailureAt)) {
    throw "SAFETY VIOLATION: Mock failure testing parameter is strictly forbidden in live production mode."
}

$ExpectedBaseline = "bd6947590d9fe0b994248e964d9feec5505b26a0"
$ExpectedRcSha    = "2b56b8500f9eb53b45a1c03c87c010de9f67adf9"

if (-not $ExportFunctionsOnly) {
    Write-Host "================================================================================" -ForegroundColor Cyan
    Write-Host "  BWORK-POS | PRODUCTION GIT FAST-FORWARD SYNC" -ForegroundColor Cyan
    Write-Host "  Execution Mode: $(if ($DryRun) { 'GENUINE READ-ONLY DRY-RUN' } else { 'LIVE PRODUCTION EXECUTION' })" -ForegroundColor $(if ($DryRun) { 'Yellow' } else { 'Green' })
    Write-Host "  Expected Baseline: $ExpectedBaseline" -ForegroundColor Gray
    Write-Host "  Target RC SHA:     $ExpectedRcSha" -ForegroundColor Gray
    Write-Host "================================================================================" -ForegroundColor Cyan
}

# ------------------------------------------------------------------------------
# NATIVE PROCESS HELPER FOR SAFE GIT EXECUTION IN POWERSHELL 5.1
# ------------------------------------------------------------------------------
function Invoke-GitSafe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [string]$WorkingDirectory = '',
        [string]$Executable = 'git.exe',
        [int]$TimeoutMs = 60000
    )
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $Executable
    $escapedArgs = $Arguments | ForEach-Object {
        if ($_ -match '[\s"]') {
            $escaped = $_ -replace '(\\*)(")', '$1$1\"'
            $escaped = $escaped -replace '(\\+)$', '$1$1'
            "`"$escaped`""
        } else {
            $_
        }
    }
    $psi.Arguments = ($escapedArgs -join ' ')
    if ($WorkingDirectory) {
        $psi.WorkingDirectory = $WorkingDirectory
    }
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    try {
        if (-not $proc.Start()) {
            throw "Failed to start process '$Executable'."
        }

        # Concurrently read stdout and stderr via ReadToEndAsync to avoid pipe buffer deadlock
        $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
        $stderrTask = $proc.StandardError.ReadToEndAsync()

        if (-not $proc.WaitForExit($TimeoutMs)) {
            try { $proc.Kill() } catch {}
            throw "Process '$Executable $($psi.Arguments)' timed out after $TimeoutMs ms."
        }

        [System.Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask))

        $stdout = $stdoutTask.Result
        $stderr = $stderrTask.Result
        $combined = ($stdout + "`n" + $stderr).Trim()

        return [PSCustomObject]@{
            ExitCode = $proc.ExitCode
            Output   = $combined
            Stdout   = $stdout.Trim()
            Stderr   = $stderr.Trim()
        }
    } finally {
        $proc.Dispose()
    }
}

# ------------------------------------------------------------------------------
# POST-PUSH REMOTE STATUS EVALUATION & INCIDENT REPORTING
# ------------------------------------------------------------------------------
function Test-ProductionGitPushResult {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetRcSha,
        [Parameter(Mandatory = $true)]
        [string]$BaselineSha,
        [Parameter(Mandatory = $true)]
        [string]$LocalHead,
        [string]$VerifiedRemoteHead = $null,
        [string]$RemoteCheckError = $null,
        [bool]$PushHadError = $false,
        [string]$PushErrorMessage = '',
        [string]$PushOutput = ''
    )

    # --------------------------------------------------------------------------
    # 1. VERIFY REMOTE QUERY INTEGRITY & VALID SHA FORMAT FIRST (FAIL-CLOSED)
    # Strictly forbid reporting success or baseline if remote query errored or SHA is invalid
    # --------------------------------------------------------------------------
    $hasRemoteError = -not [string]::IsNullOrEmpty($RemoteCheckError)
    $hasEmptySha    = [string]::IsNullOrWhiteSpace($VerifiedRemoteHead)
    $hasInvalidSha  = (-not $hasEmptySha) -and ($VerifiedRemoteHead.Trim() -notmatch '^[0-9a-fA-F]{40}$')

    if ($hasRemoteError -or $hasEmptySha -or $hasInvalidSha) {
        Write-Host "`n********************************************************************************" -ForegroundColor Red
        Write-Host "  CRITICAL ALERT: UNABLE TO VERIFY REMOTE ORIGIN/MAIN AFTER PUSH!" -ForegroundColor Red
        Write-Host "********************************************************************************" -ForegroundColor Red
        Write-Host "  Local HEAD:        $LocalHead" -ForegroundColor Yellow
        Write-Host "  Remote Status:     UNCONFIRMED (Failed to query or validate remote origin/main)" -ForegroundColor Yellow

        $detailMsg = ""
        if ($hasRemoteError) {
            $detailMsg = $RemoteCheckError
            Write-Host "  Verification Error:$RemoteCheckError" -ForegroundColor Red
        } elseif ($hasEmptySha) {
            $detailMsg = "Remote origin/main ref query returned empty SHA"
            Write-Host "  Verification Error:$detailMsg" -ForegroundColor Red
        } else {
            $detailMsg = "Invalid SHA format received from remote query: '$VerifiedRemoteHead'"
            Write-Host "  Verification Error:$detailMsg" -ForegroundColor Red
        }

        if ($PushHadError) {
            Write-Host "  Push Error:        $PushErrorMessage" -ForegroundColor Red
        } else {
            Write-Host "  Push Command:      Completed with exit code 0" -ForegroundColor Green
        }
        Write-Host "`n  OPERATIONAL DIRECTIVE:" -ForegroundColor Yellow
        Write-Host "    1. STOP immediately. Do NOT retry blindly." -ForegroundColor Yellow
        Write-Host "    2. Check network connectivity and GitHub status." -ForegroundColor Yellow
        Write-Host "    3. Run 'git ls-remote origin refs/heads/main' manually to inspect remote ref." -ForegroundColor Yellow
        Write-Host "********************************************************************************`n" -ForegroundColor Red
        throw "STOP GATE 9: Unable to verify remote origin/main ref after push attempt. Remote query error: $detailMsg"
    }

    $cleanRemoteHead = $VerifiedRemoteHead.Trim()

    # --------------------------------------------------------------------------
    # 2. COMPARE AGAINST TARGET RC & BASELINE (ONLY WHEN REMOTE SHA IS VERIFIED)
    # --------------------------------------------------------------------------

    # Case A: Remote matches Target RC (Goal achieved!)
    if ($cleanRemoteHead -eq $TargetRcSha) {
        if ($PushHadError) {
            Write-Host "`n[WARNING] Git push command reported an error or non-zero exit code: $PushErrorMessage" -ForegroundColor Yellow
            Write-Host "  However, remote origin/main HEAD was verified updated to target RC: $cleanRemoteHead" -ForegroundColor Green
            Write-Host "  Target synchronization has been achieved successfully on GitHub." -ForegroundColor Green
        } else {
            Write-Host "  -> Remote origin/main verified matching target RC: $cleanRemoteHead" -ForegroundColor Green
        }

        Write-Host "`n================================================================================" -ForegroundColor Green
        Write-Host "  PRODUCTION GIT SYNC COMPLETED SUCCESSFULLY - 100% VERIFIED" -ForegroundColor Green
        Write-Host "  GitHub Production main is now synchronized to Deployed RC $TargetRcSha" -ForegroundColor Green
        Write-Host "================================================================================" -ForegroundColor Green
        return $true
    }

    # Case B: Remote is still at Baseline (Not updated)
    if ($cleanRemoteHead -eq $BaselineSha) {
        Write-Host "`n********************************************************************************" -ForegroundColor Red
        Write-Host "  CRITICAL ALERT: GIT PUSH TO PRODUCTION REMOTE FAILED!" -ForegroundColor Red
        Write-Host "********************************************************************************" -ForegroundColor Red
        Write-Host "  Local HEAD:     $LocalHead (Fast-forwarded to Target RC)" -ForegroundColor Yellow
        Write-Host "  Remote HEAD:    $cleanRemoteHead (Still at Baseline $BaselineSha on GitHub - Unmodified)" -ForegroundColor Yellow
        if ($PushHadError) {
            Write-Host "  Push Error:     $PushErrorMessage" -ForegroundColor Red
        }
        Write-Host "`n  INCIDENT REPORT & MANUAL INVESTIGATION REQUIRED:" -ForegroundColor Cyan
        Write-Host "    - Local Branch HEAD:   $LocalHead" -ForegroundColor White
        Write-Host "    - Remote origin/main:  $cleanRemoteHead" -ForegroundColor White
        Write-Host "    - Push Failure Detail: $PushErrorMessage" -ForegroundColor White
        Write-Host "`n  OPERATIONAL DIRECTIVE:" -ForegroundColor Yellow
        Write-Host "    1. STOP immediately. Do NOT run git reset, git update-ref, or force push." -ForegroundColor Yellow
        Write-Host "    2. Collect Git status, network telemetry, and GitHub permission logs." -ForegroundColor Yellow
        Write-Host "    3. Escalate for manual investigation and senior authorization before any retry." -ForegroundColor Yellow
        Write-Host "`n  STATUS: PRODUCTION GIT SYNC HAS NOT COMPLETED. REMOTE MAIN UNMODIFIED." -ForegroundColor Red
        Write-Host "********************************************************************************`n" -ForegroundColor Red
        throw "STOP GATE 9: Production push failed. Remote main was not updated (remains at baseline $BaselineSha). Push error: $PushErrorMessage"
    }

    # Case C: Remote has an unexpected SHA (neither Target RC nor Baseline)
    Write-Host "`n********************************************************************************" -ForegroundColor Red
    Write-Host "  CRITICAL ALERT: UNEXPECTED REMOTE HEAD DETECTED AFTER PUSH!" -ForegroundColor Red
    Write-Host "********************************************************************************" -ForegroundColor Red
    Write-Host "  Local HEAD:     $LocalHead (Target RC: $TargetRcSha)" -ForegroundColor Yellow
    Write-Host "  Remote HEAD:    $cleanRemoteHead (UNEXPECTED SHA - Neither Baseline nor Target RC!)" -ForegroundColor Red
    if ($PushOutput) {
        Write-Host "  Push Output:    $PushOutput" -ForegroundColor White
    }
    if ($PushHadError) {
        Write-Host "  Push Error:     $PushErrorMessage" -ForegroundColor Red
    }
    Write-Host "`n  OPERATIONAL DIRECTIVE:" -ForegroundColor Yellow
    Write-Host "    1. STOP immediately. Do NOT run git reset, git update-ref, or force push." -ForegroundColor Yellow
    Write-Host "    2. Collect Git log and network telemetry to determine why remote diverged." -ForegroundColor Yellow
    Write-Host "    3. Escalate for senior manual investigation." -ForegroundColor Yellow
    Write-Host "********************************************************************************`n" -ForegroundColor Red
    throw "STOP GATE 9: Remote origin/main has unexpected commit ($cleanRemoteHead). Expected Target RC ($TargetRcSha) or Baseline ($BaselineSha)."
}

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
            if ($null -eq $proj.result.PSObject.Properties['source'] -or $null -eq $proj.result.source) {
                $proj.result | Add-Member -NotePropertyName 'source' -NotePropertyValue ([PSCustomObject]@{
                    type   = 'github'
                    config = [PSCustomObject]@{
                        owner                          = 'depp48106'
                        repo_name                      = 'Bwork-POS'
                        production_branch              = 'main'
                        production_deployments_enabled = $false
                        deployments_enabled            = $false
                    }
                }) -Force
            } else {
                $proj.result.source.config.production_deployments_enabled = $false
            }
        }
        if ($MockFailure -eq 'CloudflareMissingFields' -and $projName -eq 'bwork-pos') {
            $proj.result | Add-Member -NotePropertyName 'source' -NotePropertyValue ([PSCustomObject]@{
                type   = 'github'
                config = [PSCustomObject]@{
                    owner                          = 'depp48106'
                    repo_name                      = 'Bwork-POS'
                    production_branch              = 'main'
                    production_deployments_enabled = $null
                    deployments_enabled            = $false
                }
            }) -Force
        }
        if ($MockFailure -eq 'CloudflareWrongRepo' -and $projName -eq 'bwork-pos') {
            $proj.result | Add-Member -NotePropertyName 'source' -NotePropertyValue ([PSCustomObject]@{
                type   = 'github'
                config = [PSCustomObject]@{
                    owner                          = 'depp48106'
                    repo_name                      = 'Wrong-Repo'
                    production_branch              = 'main'
                    production_deployments_enabled = $false
                    deployments_enabled            = $false
                }
            }) -Force
        }
        if ($MockFailure -eq 'CloudflareWrongBranch' -and $projName -eq 'bwork-pos') {
            $proj.result.production_branch = 'develop'
            $proj.result | Add-Member -NotePropertyName 'source' -NotePropertyValue ([PSCustomObject]@{
                type   = 'github'
                config = [PSCustomObject]@{
                    owner                          = 'depp48106'
                    repo_name                      = 'Bwork-POS'
                    production_branch              = 'develop'
                    production_deployments_enabled = $false
                    deployments_enabled            = $false
                }
            }) -Force
        }
        if ($MockFailure -eq 'CloudflareBookingEnabled' -and $projName -eq 'bwork-booking') {
            $proj.result | Add-Member -NotePropertyName 'source' -NotePropertyValue ([PSCustomObject]@{
                type   = 'github'
                config = [PSCustomObject]@{
                    owner                          = 'depp48106'
                    repo_name                      = 'Bwork-POS'
                    production_branch              = 'main'
                    production_deployments_enabled = $true
                    deployments_enabled            = $true
                }
            }) -Force
        }

        # 1. Project name check
        if ($proj.result.name -ne $projName) {
            throw "STOP GATE 0: Project name mismatch. Expected '$projName' but got '$($proj.result.name)'."
        }

        # Check if Git integration is connected
        $hasSource = ($proj.result.PSObject.Properties['source'] -ne $null -and $null -ne $proj.result.source)
        if (-not $hasSource) {
            Write-Host "  Project '$projName':" -ForegroundColor Cyan
            Write-Host "    production_branch:              $($proj.result.production_branch)"
            Write-Host "    git_provider:                   None / Disconnected (Direct Upload mode)"
            Write-Host "    auto_deploy_protection:         VERIFIED (No Git repository connected; zero trigger risk on push)"
            continue
        }

        # 2. Source and GitHub integration check
        if ($proj.result.source.type -ne 'github') {
            throw "STOP GATE 0: Project '$projName' is connected via unexpected provider '$($proj.result.source.type)' (expected 'github')."
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

if ($ExportFunctionsOnly) {
    return
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
    $pushExitCode = $null
    $pushOutputText = ""
    $pushHadError = $false
    $pushErrorMessage = ""

    try {
        if ($MockFailureAt -eq 'PushFailure') {
            throw "Simulated push failure (Network/Remote Error)"
        }
        $pushResult = Invoke-GitSafe -Arguments @('push', 'origin', 'main') -WorkingDirectory $ProductionDir
        $pushExitCode = $pushResult.ExitCode
        $pushOutputText = $pushResult.Output
        if ($pushExitCode -ne 0) {
            $pushHadError = $true
            $pushErrorMessage = "git push origin main exited with code $pushExitCode. Output: $pushOutputText"
        }
    } catch {
        $pushHadError = $true
        $pushErrorMessage = $_.Exception.Message
    }

    # Query remote origin/main HEAD
    $remoteCheckError = $null
    $verifiedRemoteHead = $null

    try {
        $lsRemoteResult = Invoke-GitSafe -Arguments @('ls-remote', 'origin', 'refs/heads/main') -WorkingDirectory $ProductionDir
        if ($lsRemoteResult.ExitCode -eq 0 -and $lsRemoteResult.Stdout) {
            $verifiedRemoteHead = ($lsRemoteResult.Stdout -split "\s+")[0].Trim()
        } else {
            $remoteCheckError = "git ls-remote failed with exit code $($lsRemoteResult.ExitCode): $($lsRemoteResult.Output)"
        }
    } catch {
        $remoteCheckError = $_.Exception.Message
    }

    $currentLocalHead = (Invoke-GitSafe -Arguments @('rev-parse', 'HEAD') -WorkingDirectory $ProductionDir).Stdout.Trim()

    Test-ProductionGitPushResult `
        -TargetRcSha $ExpectedRcSha `
        -BaselineSha $ExpectedBaseline `
        -LocalHead $currentLocalHead `
        -VerifiedRemoteHead $verifiedRemoteHead `
        -RemoteCheckError $remoteCheckError `
        -PushHadError $pushHadError `
        -PushErrorMessage $pushErrorMessage `
        -PushOutput $pushOutputText
}
