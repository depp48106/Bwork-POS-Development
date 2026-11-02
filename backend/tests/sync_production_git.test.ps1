<#
.SYNOPSIS
    Safety and Regression Test Suite for sync_production_git.ps1
.DESCRIPTION
    Tests all fail-closed Stop Gates, AST validity, dry-run safety, mock failure modes,
    PowerShell 5.1 native stderr push handling, and post-push remote status evaluation.
#>
[CmdletBinding()]
param(
    [string]$ProductionDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Dynamic path resolution based on script location (portable across Home, Office, and CI environments)
$scriptDir  = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$scriptPath = (Resolve-Path (Join-Path $scriptDir "../../scripts/sync_production_git.ps1")).Path

# Export helper functions for direct testing
. $scriptPath -ExportFunctionsOnly

# Dynamic resolution of Production directory across environments
if (-not $ProductionDir) {
    $parentDir = (Resolve-Path "$scriptDir/../../..").Path
    $candidateProd = Join-Path $parentDir "Bwork-POS"
    if (Test-Path $candidateProd) {
        $ProductionDir = (Resolve-Path $candidateProd).Path
    } else {
        $ProductionDir = "D:\Project BL\Bwork-POS"
    }
}
$prodDir    = $ProductionDir
$baseline   = "bd6947590d9fe0b994248e964d9feec5505b26a0"

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "  TEST SUITE: BWORK-POS PRODUCTION GIT SYNC SAFETY GATES" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

$testResults = [System.Collections.Generic.List[PSObject]]::new()

# Mock Cloudflare API calls during unit test runs to ensure offline/cross-machine reproducibility
function Invoke-RestMethod {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromRemainingArguments=$true)]$RemainingArgs,
        [string]$Uri = ''
    )
    if ($Uri -match '/pages/projects/(bwork-[a-z]+)') {
        $projName = $matches[1]
        return [PSCustomObject]@{
            success = $true
            result  = [PSCustomObject]@{
                name              = $projName
                production_branch = 'main'
                source            = [PSCustomObject]@{
                    type   = 'github'
                    config = [PSCustomObject]@{
                        owner                          = 'depp48106'
                        repo_name                      = 'Bwork-POS'
                        production_branch              = 'main'
                        production_deployments_enabled = $false
                        deployments_enabled            = $false
                    }
                }
            }
        }
    }
    return Microsoft.PowerShell.Utility\Invoke-RestMethod @PSBoundParameters
}

function Run-TestCase([string]$TestName, [scriptblock]$TestBlock) {
    Write-Host "`n[TEST] $TestName..." -ForegroundColor Yellow
    try {
        & $TestBlock
        Write-Host "  -> PASS" -ForegroundColor Green
        $testResults.Add([PSCustomObject]@{
            TestName = $TestName
            Passed   = $true
            Error    = $null
        })
    } catch {
        Write-Host "  -> FAIL: $($_.Exception.Message)" -ForegroundColor Red
        $testResults.Add([PSCustomObject]@{
            TestName = $TestName
            Passed   = $false
            Error    = $_.Exception.Message
        })
    }
}

# ------------------------------------------------------------------------------
# SETUP ISOLATED BASELINE TEST FIXTURE (IF PRODUCTION REPO IS ALREADY BEYOND BASELINE)
# ------------------------------------------------------------------------------
$tempFixtureDir = $null
$tempRemoteDir  = $null
$activeProdDir  = $prodDir

$currentProdHead = $null
if (Test-Path $prodDir) {
    try {
        $currentProdHead = (git -C $prodDir rev-parse HEAD 2>$null)
        if ($currentProdHead) { $currentProdHead = $currentProdHead.Trim() }
    } catch {}
}

if ($currentProdHead -ne $baseline) {
    Write-Host "`n[FIXTURE] Production workspace HEAD ($currentProdHead) is not at baseline ($baseline)." -ForegroundColor Cyan
    Write-Host "          Initializing isolated baseline Git test fixture in temporary directory..." -ForegroundColor Cyan
    $tempRemoteDir = Join-Path $env:TEMP "bwork_fixture_rem_$(Get-Random)"
    $tempFixtureDir = Join-Path $env:TEMP "bwork_fixture_loc_$(Get-Random)"

    git init --bare $tempRemoteDir | Out-Null
    git clone --no-hardlinks $prodDir $tempFixtureDir | Out-Null
    git -C $tempFixtureDir checkout -f $baseline -B main | Out-Null
    git -C $tempFixtureDir remote set-url origin $tempRemoteDir | Out-Null
    git -C $tempFixtureDir push origin "$($baseline):refs/heads/main" -u | Out-Null

    $activeProdDir = $tempFixtureDir
    Write-Host "  -> Isolated test fixture ready at: $activeProdDir" -ForegroundColor Green
}

try {
    # 1. PowerShell AST Validation
    Run-TestCase "1. PowerShell AST Syntax Validation (0 parse errors)" {
        $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$parseErrors)
        if ($parseErrors.Count -ne 0) {
            throw "AST parse errors found ($($parseErrors.Count)): $($parseErrors[0].Message)"
        }
    }

    # 2. Cloudflare API Failure (Gate 0 Fail-Closed)
    Run-TestCase "2. Cloudflare API Failure Stop Gate" {
        $err = $null
        try {
            & $scriptPath -DryRun -MockFailureAt 'CloudflareApiError' -ProductionDir $activeProdDir 2>&1
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "Cloudflare API request failed") {
            throw "Expected Cloudflare API error but got: $err"
        }
    }

    # 3. Missing Cloudflare API Fields
    Run-TestCase "3. Missing Cloudflare API Fields Stop Gate" {
        $err = $null
        try {
            & $scriptPath -DryRun -MockFailureAt 'CloudflareMissingFields' -ProductionDir $activeProdDir 2>&1
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "null/missing 'production_deployments_enabled'") {
            throw "Expected missing fields error but got: $err"
        }
    }

    # 4. One project still enabled (bwork-booking)
    Run-TestCase "4. Project Auto-Deploy Still Enabled Stop Gate" {
        $err = $null
        try {
            & $scriptPath -DryRun -MockFailureAt 'CloudflareBookingEnabled' -ProductionDir $activeProdDir 2>&1
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "production_deployments_enabled = True") {
            throw "Expected auto-deploy still active error but got: $err"
        }
    }

    # 5. Wrong connected GitHub repository
    Run-TestCase "5. Wrong Connected GitHub Repository Stop Gate" {
        $err = $null
        try {
            & $scriptPath -DryRun -MockFailureAt 'CloudflareWrongRepo' -ProductionDir $activeProdDir 2>&1
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "connected to unexpected repository") {
            throw "Expected wrong repository error but got: $err"
        }
    }

    # 6. Wrong production branch
    Run-TestCase "6. Wrong Production Branch Stop Gate" {
        $err = $null
        try {
            & $scriptPath -DryRun -MockFailureAt 'CloudflareWrongBranch' -ProductionDir $activeProdDir 2>&1
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "production branch is not 'main'") {
            throw "Expected wrong production branch error but got: $err"
        }
    }

    # 7. Attempted approval bypass in live mode
    Run-TestCase "7. Attempted Approval Bypass in Live Mode" {
        $err = $null
        try {
            # Use ProcessStartInfo to capture stdout and stderr cleanly without PowerShell 5.1 2>&1 ErrorRecord trap
            $psi = [System.Diagnostics.ProcessStartInfo]::new()
            $psi.FileName = "powershell.exe"
            $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"`$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; 'yes' | powershell -NoProfile -ExecutionPolicy Bypass -File '$scriptPath' -ProductionDir '$activeProdDir'`""
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError = $true
            $psi.UseShellExecute = $false
            $psi.CreateNoWindow = $true
            $proc = [System.Diagnostics.Process]::Start($psi)
            $stdout = $proc.StandardOutput.ReadToEnd()
            $stderr = $proc.StandardError.ReadToEnd()
            $proc.WaitForExit()
            $err = "$stdout`n$stderr"
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "STOP GATE 0" -and $err -notmatch "APPROVAL REJECTED") {
            throw "Expected Stop Gate 0 or Approval Rejection but got: $err"
        }
    }

    # 8. Approval Rejection (in DryRun mock)
    Run-TestCase "8. Approval Rejection Behavior" {
        $err = $null
        try {
            & $scriptPath -DryRun -MockFailureAt 'ApprovalRejection' -ProductionDir $activeProdDir 2>&1
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "APPROVAL REJECTED") {
            throw "Expected Approval Rejection error but got: $err"
        }
    }

    # 9. Remote HEAD Mismatch
    Run-TestCase "9. Remote HEAD Mismatch Stop Gate" {
        $err = $null
        try {
            & $scriptPath -DryRun -MockFailureAt 'RemoteHeadMismatch' -ProductionDir $activeProdDir 2>&1
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "Remote origin/main HEAD .* does NOT match expected baseline") {
            throw "Expected remote HEAD mismatch error but got: $err"
        }
    }

    # 10. Target RC SHA Mismatch
    Run-TestCase "10. Target RC SHA Mismatch Stop Gate" {
        $err = $null
        try {
            & $scriptPath -DryRun -MockFailureAt 'RcShaMismatch' -ProductionDir $activeProdDir 2>&1
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "Resolved RC SHA .* does NOT match expected deployed RC SHA") {
            throw "Expected RC SHA mismatch error but got: $err"
        }
    }

    # 11. Push Failure Handling and Non-Destructive Recovery
    Run-TestCase "11. Push Failure Handling and Non-Destructive Recovery" {
        $err = $null
        try {
            & $scriptPath -DryRun -MockFailureAt 'PushFailure' -ProductionDir $activeProdDir 2>&1
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "Simulated push failure") {
            throw "Expected push failure error but got: $err"
        }
    }

    # 12. Normal DryRun & Zero Production Mutation Verification
    Run-TestCase "12. Normal DryRun & Zero Production Mutation Verification" {
        # Check baseline HEAD and branches before
        $headBefore = (git -C $activeProdDir rev-parse HEAD).Trim()
        $statusBefore = @(git -C $activeProdDir status --porcelain).Count
        $branchesBefore = (git -C $activeProdDir branch | Out-String).Trim()

        # Live Cloudflare Pages check will fail Gate 0 if not paused, which is correct fail-closed!
        $dryRunOutput = $null
        $gate0Failed = $false
        try {
            $dryRunOutput = & $scriptPath -DryRun -ProductionDir $activeProdDir 2>&1
        } catch {
            $gate0Failed = $true
            $dryRunOutput = $_.Exception.Message
        }

        # Verify fail-closed behavior: either passed (if paused) or halted at Stop Gate 0
        if ($gate0Failed) {
            if ($dryRunOutput -notmatch "STOP GATE 0") {
                throw "Unexpected failure in normal DryRun: $dryRunOutput"
            }
            Write-Host "     (Note: Correctly stopped at Gate 0 because live Cloudflare auto-deploy is currently Active)" -ForegroundColor Cyan
        }

        # Also test DryRun with MockCloudflarePassed to verify full read-only execution through Gate 9
        $mockDryRunOutput = & $scriptPath -DryRun -MockFailureAt 'MockCloudflarePassed' -ProductionDir $activeProdDir *>&1
        $mockStr = ($mockDryRunOutput | Out-String)
        if ($mockStr -notmatch "GENUINE READ-ONLY DRY-RUN COMPLETED SUCCESSFULLY") {
            throw "DryRun failed to complete successfully: $mockStr"
        }

        # Check baseline HEAD after (Must be identical)
        $headAfter = (git -C $activeProdDir rev-parse HEAD).Trim()
        $statusAfter = @(git -C $activeProdDir status --porcelain).Count

        if ($headBefore -ne $baseline -or $headAfter -ne $baseline) {
            throw "Production HEAD mutated! Before: $headBefore, After: $headAfter"
        }
        if ($statusBefore -ne 0 -or $statusAfter -ne 0) {
            throw "Production working tree dirty after test!"
        }

        # Verify no branches were created or modified
        $branchesAfter = (git -C $activeProdDir branch | Out-String).Trim()
        if ($branchesBefore -ne $branchesAfter) {
            throw "Unexpected local branches modified or created! Before: $branchesBefore, After: $branchesAfter"
        }
        if ($branchesAfter -match "sync-candidate-rc") {
            throw "Temporary sync branch 'sync-candidate-rc' was left behind!"
        }
        $currentBranchAfter = (git -C $activeProdDir branch --show-current).Trim()
        if ($currentBranchAfter -ne "main") {
            throw "Active branch was changed! Expected 'main' but found: $currentBranchAfter"
        }
    }

    # 13. Temporary Local Git Repo - Push with Stderr Output in PowerShell 5.1
    Run-TestCase "13. Temporary Local Git Repo - Push with Stderr Output in PowerShell 5.1" {
        $tempRemote = Join-Path $env:TEMP "ps51_push_rem_$(Get-Random)"
        $tempLocal  = Join-Path $env:TEMP "ps51_push_loc_$(Get-Random)"
        try {
            git init --bare $tempRemote | Out-Null
            git init $tempLocal | Out-Null
            git -C $tempLocal config user.name "Test User"
            git -C $tempLocal config user.email "test@example.com"
            "Initial" | Set-Content (Join-Path $tempLocal "test.txt")
            git -C $tempLocal add test.txt | Out-Null
            git -C $tempLocal commit -m "initial commit" | Out-Null
            git -C $tempLocal branch -M main | Out-Null
            git -C $tempLocal remote add origin $tempRemote | Out-Null

            # In PowerShell 5.1, git push writes progress to stderr.
            # Invoke-GitSafe must capture it without throwing an ErrorRecord exception under $ErrorActionPreference = 'Stop'
            $pushResult = Invoke-GitSafe -Arguments @('push', '-u', 'origin', 'main') -WorkingDirectory $tempLocal
            if ($pushResult.ExitCode -ne 0) {
                throw "Expected ExitCode 0 but got $($pushResult.ExitCode). Output: $($pushResult.Output)"
            }
            if ($pushResult.Stderr -notmatch 'main -> main' -and $pushResult.Stderr -notmatch 'To ') {
                throw "Expected git push progress on stderr, but Stderr was: '$($pushResult.Stderr)'"
            }
            $remoteHead = (git -C $tempLocal ls-remote origin refs/heads/main).Split("`t")[0].Trim()
            $localHead  = (git -C $tempLocal rev-parse HEAD).Trim()
            if ($remoteHead -ne $localHead) {
                throw "Remote HEAD ($remoteHead) did not match local HEAD ($localHead) after push!"
            }
        } finally {
            if (Test-Path $tempLocal)  { Remove-Item -Recurse -Force $tempLocal }
            if (Test-Path $tempRemote) { Remove-Item -Recurse -Force $tempRemote }
        }
    }

    # 14. Temporary Local Git Repo - Push Failure Handling & Remote Unchanged
    Run-TestCase "14. Temporary Local Git Repo - Push Failure Handling & Remote Unchanged" {
        $tempRemote = Join-Path $env:TEMP "ps51_fail_rem_$(Get-Random)"
        $tempLocalA = Join-Path $env:TEMP "ps51_fail_locA_$(Get-Random)"
        $tempLocalB = Join-Path $env:TEMP "ps51_fail_locB_$(Get-Random)"
        try {
            git init --bare $tempRemote | Out-Null

            # Clone repo A, make commit 1, push to origin
            git clone $tempRemote $tempLocalA | Out-Null
            git -C $tempLocalA config user.name "Test User"
            git -C $tempLocalA config user.email "test@example.com"
            "Base" | Set-Content (Join-Path $tempLocalA "base.txt")
            git -C $tempLocalA add base.txt | Out-Null
            git -C $tempLocalA commit -m "base commit" | Out-Null
            git -C $tempLocalA branch -M main | Out-Null
            git -C $tempLocalA push -u origin main | Out-Null
            $baseSha = (git -C $tempLocalA rev-parse HEAD).Trim()

            # Set bare remote HEAD to main so downstream clones check out main by default
            git -C $tempRemote symbolic-ref HEAD refs/heads/main | Out-Null

            # Clone repo B from origin at base commit
            git clone $tempRemote $tempLocalB | Out-Null
            git -C $tempLocalB config user.name "Test User"
            git -C $tempLocalB config user.email "test@example.com"

            # Repo A creates commit 2 and pushes to origin
            "Commit 2 on A" | Set-Content (Join-Path $tempLocalA "fileA.txt")
            git -C $tempLocalA add fileA.txt | Out-Null
            git -C $tempLocalA commit -m "commit 2 on A" | Out-Null
            git -C $tempLocalA push origin main | Out-Null
            $remoteShaAfterA = (git -C $tempLocalA ls-remote origin refs/heads/main).Split("`t")[0].Trim()

            # Repo B creates conflicting commit 3 without pulling (non-fast-forward push will be rejected)
            "Commit 3 on B" | Set-Content (Join-Path $tempLocalB "fileB.txt")
            git -C $tempLocalB add fileB.txt | Out-Null
            git -C $tempLocalB commit -m "commit 3 on B" | Out-Null
            $localBSha = (git -C $tempLocalB rev-parse HEAD).Trim()

            # Invoke push from B: must fail with non-zero exit code and error captured
            $pushResult = Invoke-GitSafe -Arguments @('push', 'origin', 'main') -WorkingDirectory $tempLocalB
            if ($pushResult.ExitCode -eq 0) {
                throw "Expected non-zero exit code for rejected push, but got 0!"
            }
            if ($pushResult.Stderr -notmatch 'rejected' -and $pushResult.Output -notmatch 'rejected') {
                throw "Expected rejection notice in output/stderr: $($pushResult.Output)"
            }

            # Remote HEAD must remain unchanged at repo A's commit
            $remoteShaCurrent = (git -C $tempLocalB ls-remote origin refs/heads/main).Split("`t")[0].Trim()
            if ($remoteShaCurrent -ne $remoteShaAfterA) {
                throw "Remote HEAD was modified despite push rejection! Remote: $remoteShaCurrent"
            }

            # Test-ProductionGitPushResult should evaluate this as Case B (remains at baseline/unmodified)
            $evalError = $null
            try {
                Test-ProductionGitPushResult `
                    -TargetRcSha $localBSha `
                    -BaselineSha $remoteShaAfterA `
                    -LocalHead $localBSha `
                    -VerifiedRemoteHead $remoteShaAfterA `
                    -PushHadError $true `
                    -PushErrorMessage $pushResult.Stderr `
                    -PushOutput $pushResult.Output
            } catch {
                $evalError = $_.Exception.Message
            }
            if ($evalError -notmatch "STOP GATE 9: Production push failed\. Remote main was not updated \(remains at baseline") {
                throw "Expected Case B error but got: $evalError"
            }
        } finally {
            if (Test-Path $tempLocalA)  { Remove-Item -Recurse -Force $tempLocalA }
            if (Test-Path $tempLocalB)  { Remove-Item -Recurse -Force $tempLocalB }
            if (Test-Path $tempRemote) { Remove-Item -Recurse -Force $tempRemote }
        }
    }

    # 15. Post-Push Evaluation - Case A: Target RC Verified Despite Push Command Warnings
    Run-TestCase "15. Post-Push Evaluation - Case A: Target RC Verified Despite Push Command Warnings" {
        $targetSha   = "2b56b8500f9eb53b45a1c03c87c010de9f67adf9"
        $baselineSha = "bd6947590d9fe0b994248e964d9feec5505b26a0"

        # Push command reported an error/warning (e.g. Broken pipe or stderr warning), but remote origin/main matches target RC
        $result = Test-ProductionGitPushResult `
            -TargetRcSha $targetSha `
            -BaselineSha $baselineSha `
            -LocalHead $targetSha `
            -VerifiedRemoteHead $targetSha `
            -PushHadError $true `
            -PushErrorMessage "Write error: Broken pipe during progress display" `
            -PushOutput "Everything up-to-date"

        if ($result -ne $true) {
            throw "Expected Case A to return true (target reached successfully) but got: $result"
        }
    }

    # 16. Post-Push Evaluation - Case C: Unexpected Remote SHA Divergence
    Run-TestCase "16. Post-Push Evaluation - Case C: Unexpected Remote SHA Divergence" {
        $targetSha   = "2b56b8500f9eb53b45a1c03c87c010de9f67adf9"
        $baselineSha = "bd6947590d9fe0b994248e964d9feec5505b26a0"
        $otherSha    = "8888888888888888888888888888888888888888"

        $err = $null
        try {
            Test-ProductionGitPushResult `
                -TargetRcSha $targetSha `
                -BaselineSha $baselineSha `
                -LocalHead $targetSha `
                -VerifiedRemoteHead $otherSha `
                -PushHadError $false
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "STOP GATE 9: Remote origin/main has unexpected commit \($otherSha\)") {
            throw "Expected Case C unexpected commit error with actual SHA but got: $err"
        }
    }

    # 17. Post-Push Evaluation - Case D: Remote Unverifiable / Network Failure
    Run-TestCase "17. Post-Push Evaluation - Case D: Remote Unverifiable / Network Failure" {
        $targetSha   = "2b56b8500f9eb53b45a1c03c87c010de9f67adf9"
        $baselineSha = "bd6947590d9fe0b994248e964d9feec5505b26a0"

        $err = $null
        try {
            Test-ProductionGitPushResult `
                -TargetRcSha $targetSha `
                -BaselineSha $baselineSha `
                -LocalHead $targetSha `
                -VerifiedRemoteHead $null `
                -RemoteCheckError "Could not resolve host: github.com" `
                -PushHadError $false
        } catch {
            $err = $_.Exception.Message
        }
        if ($err -notmatch "STOP GATE 9: Unable to verify remote origin/main ref after push attempt") {
            throw "Expected Case D unverifiable error but got: $err"
        }
        if ($err -notmatch "Could not resolve host: github\.com") {
            throw "Expected error to contain original remote query error message but got: $err"
        }
    }

    # 18. Concurrent High-Volume Stream Draining (Deadlock Prevention Test)
    Run-TestCase "18. Concurrent High-Volume Stream Draining (Deadlock Prevention)" {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        # Generates ~2,000 lines of stdout and ~2,000 lines of stderr simultaneously (>240 KB total)
        # Without ReadToEndAsync(), this deadlocks on OS pipe buffer overflow (>64 KB).
        $cmdArgs = @('/c', 'for /L %i in (1,1,2000) do @(echo %i stdout stream padding data line & echo %i stderr stream padding data line 1>&2)')
        $result = Invoke-GitSafe -Executable 'cmd.exe' -Arguments $cmdArgs -TimeoutMs 10000
        $sw.Stop()

        if ($result.ExitCode -ne 0) {
            throw "Expected ExitCode 0 but got $($result.ExitCode)"
        }
        if ($result.Stdout.Length -lt 50000 -or $result.Stderr.Length -lt 50000) {
            throw "Expected high volume output (>50KB each), got Stdout: $($result.Stdout.Length) bytes, Stderr: $($result.Stderr.Length) bytes"
        }
        if ($sw.ElapsedMilliseconds -gt 8000) {
            throw "Stream draining took too long ($($sw.ElapsedMilliseconds) ms). Process may have stalled."
        }
    }

    # 19. Remote Error Precedence Over Matching Target SHA (Fail-Closed Gate)
    Run-TestCase "19. Remote Error Precedence Over Matching Target SHA (Fail-Closed Gate)" {
        $targetSha   = "2b56b8500f9eb53b45a1c03c87c010de9f67adf9"
        $baselineSha = "bd6947590d9fe0b994248e964d9feec5505b26a0"

        $err = $null
        try {
            # VerifiedRemoteHead matches Target RC, BUT remote query reported an error.
            # Must strictly forbid reporting success!
            Test-ProductionGitPushResult `
                -TargetRcSha $targetSha `
                -BaselineSha $baselineSha `
                -LocalHead $targetSha `
                -VerifiedRemoteHead $targetSha `
                -RemoteCheckError "TLS handshake reset during remote query" `
                -PushHadError $false
        } catch {
            $err = $_.Exception.Message
        }

        if ($err -notmatch "STOP GATE 9: Unable to verify remote origin/main ref after push attempt") {
            throw "Expected Case D unverifiable error due to query error precedence, but got: $err"
        }
        if ($err -notmatch "TLS handshake reset during remote query") {
            throw "Expected error to contain original RemoteCheckError detail, but got: $err"
        }
    }

    # 20. Process Invocation with Spaces in Paths and Arguments
    Run-TestCase "20. Process Invocation with Spaces in Paths and Arguments" {
        $tempWithSpaces = Join-Path $env:TEMP "bwork test space repo $(Get-Random)"
        try {
            git init $tempWithSpaces | Out-Null
            git -C $tempWithSpaces config user.name "Space User"
            git -C $tempWithSpaces config user.email "space@example.com"
            "sample content" | Set-Content (Join-Path $tempWithSpaces "sample file with space.txt")

            # Test git add with filename containing spaces
            $addResult = Invoke-GitSafe -Arguments @('add', 'sample file with space.txt') -WorkingDirectory $tempWithSpaces
            if ($addResult.ExitCode -ne 0) {
                throw "git add failed in directory with spaces: $($addResult.Output)"
            }

            # Test git commit with message containing multiple spaces and special characters
            $testMsg = "feat: initial commit with multiple spaces and (parentheses) & quotes"
            $commitResult = Invoke-GitSafe -Arguments @('commit', '-m', $testMsg) -WorkingDirectory $tempWithSpaces
            if ($commitResult.ExitCode -ne 0) {
                throw "git commit failed with spaced arguments: $($commitResult.Output)"
            }

            # Verify that git received the exact message intact
            $logResult = Invoke-GitSafe -Arguments @('log', '-1', '--format=%s') -WorkingDirectory $tempWithSpaces
            if ($logResult.Stdout.Trim() -ne $testMsg) {
                throw "Commit message corrupted! Expected '$testMsg', but got '$($logResult.Stdout.Trim())'"
            }
        } finally {
            if (Test-Path $tempWithSpaces) {
                Remove-Item -Recurse -Force $tempWithSpaces
            }
        }
    }
} finally {
    if ($tempFixtureDir -and (Test-Path $tempFixtureDir)) {
        Remove-Item -Recurse -Force $tempFixtureDir -ErrorAction SilentlyContinue
    }
    if ($tempRemoteDir -and (Test-Path $tempRemoteDir)) {
        Remove-Item -Recurse -Force $tempRemoteDir -ErrorAction SilentlyContinue
    }
}

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "  TEST SUMMARY" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
$failedCount = @($testResults | Where-Object { -not $_.Passed }).Count
$passedCount = @($testResults | Where-Object { $_.Passed }).Count
Write-Host "Total Tests: $($testResults.Count)"
Write-Host "Passed:      $passedCount" -ForegroundColor Green
Write-Host "Failed:      $failedCount" -ForegroundColor $(if ($failedCount -eq 0) { 'Green' } else { 'Red' })

if ($failedCount -gt 0) {
    exit 1
} else {
    Write-Host "`nALL 20 PRODUCTION SAFETY TESTS PASSED 100%!" -ForegroundColor Green
}
