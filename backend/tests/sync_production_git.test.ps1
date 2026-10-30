<#
.SYNOPSIS
    Safety and Regression Test Suite for sync_production_git.ps1
.DESCRIPTION
    Tests all fail-closed Stop Gates, AST validity, dry-run safety, and mock failure modes.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptPath = "D:\Project BL\Bwork-POS-Development\scripts\sync_production_git.ps1"
$prodDir    = "D:\Project BL\Bwork-POS"
$baseline   = "bd6947590d9fe0b994248e964d9feec5505b26a0"

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "  TEST SUITE: BWORK-POS PRODUCTION GIT SYNC SAFETY GATES" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

$testResults = [System.Collections.Generic.List[PSObject]]::new()

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
        & $scriptPath -DryRun -MockFailureAt 'CloudflareApiError' 2>&1
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
        & $scriptPath -DryRun -MockFailureAt 'CloudflareMissingFields' 2>&1
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
        & $scriptPath -DryRun -MockFailureAt 'CloudflareBookingEnabled' 2>&1
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
        & $scriptPath -DryRun -MockFailureAt 'CloudflareWrongRepo' 2>&1
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
        & $scriptPath -DryRun -MockFailureAt 'CloudflareWrongBranch' 2>&1
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
        # Test wrong input 'yes' via child powershell process
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -Command "& { 'yes' | powershell -NoProfile -ExecutionPolicy Bypass -File '$scriptPath' }" 2>&1
        $err = "$output"
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
        & $scriptPath -DryRun -MockFailureAt 'ApprovalRejection' 2>&1
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
        & $scriptPath -DryRun -MockFailureAt 'RemoteHeadMismatch' 2>&1
    } catch {
        $err = $_.Exception.Message
    }
    if ($err -notmatch "Remote origin/main HEAD .* does NOT match expected baseline") {
        throw "Expected remote HEAD mismatch error but got: $err"
    }
}

# 10. RC SHA Mismatch
Run-TestCase "10. Target RC SHA Mismatch Stop Gate" {
    $err = $null
    try {
        & $scriptPath -DryRun -MockFailureAt 'RcShaMismatch' 2>&1
    } catch {
        $err = $_.Exception.Message
    }
    if ($err -notmatch "Resolved RC SHA .* does NOT match expected deployed RC SHA") {
        throw "Expected RC SHA mismatch error but got: $err"
    }
}

# 11. Simulated Push Failure
Run-TestCase "11. Push Failure Handling and Non-Destructive Recovery" {
    $err = $null
    try {
        & $scriptPath -DryRun -MockFailureAt 'PushFailure' 2>&1
    } catch {
        $err = $_.Exception.Message
    }
    if ($err -notmatch "Simulated push failure") {
        throw "Expected push failure error but got: $err"
    }
}

# 12. Normal DryRun & Zero Mutation Invariant
Run-TestCase "12. Normal DryRun & Zero Production Mutation Verification" {
    # Check baseline HEAD before
    $headBefore = (git -C $prodDir rev-parse HEAD).Trim()
    $statusBefore = @(git -C $prodDir status --porcelain).Count

    # Live Cloudflare Pages check will fail Gate 0 if not paused, which is correct fail-closed!
    $dryRunOutput = $null
    $gate0Failed = $false
    try {
        $dryRunOutput = & $scriptPath -DryRun 2>&1
    } catch {
        $gate0Failed = $true
        $dryRunOutput = $_.Exception.Message
    }

    # Verify fail-closed behavior: either passed (if paused) or halted at Stop Gate 0
    if ($gate0Failed) {
        if ($dryRunOutput -notmatch "STOP GATE 0 FAILED") {
            throw "Unexpected failure in normal DryRun: $dryRunOutput"
        }
        Write-Host "     (Note: Correctly stopped at Gate 0 because live Cloudflare auto-deploy is currently Active)" -ForegroundColor Cyan
    }

    # Also test DryRun with MockCloudflarePassed to verify full read-only execution through Gate 9
    $mockDryRunOutput = & $scriptPath -DryRun -MockFailureAt 'MockCloudflarePassed' *>&1
    $mockStr = ($mockDryRunOutput | Out-String)
    if ($mockStr -notmatch "GENUINE READ-ONLY DRY-RUN COMPLETED SUCCESSFULLY") {
        throw "DryRun failed to complete successfully: $mockStr"
    }

    # Check baseline HEAD after (Must be identical)
    $headAfter = (git -C $prodDir rev-parse HEAD).Trim()
    $statusAfter = @(git -C $prodDir status --porcelain).Count

    if ($headBefore -ne $baseline -or $headAfter -ne $baseline) {
        throw "Production HEAD mutated! Before: $headBefore, After: $headAfter"
    }
    if ($statusBefore -ne 0 -or $statusAfter -ne 0) {
        throw "Production working tree dirty after test!"
    }

    # Verify no branches were created
    $branches = (git -C $prodDir branch).Trim()
    if ($branches -ne "* main") {
        throw "Unexpected local branches created: $branches"
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
    Write-Host "`nALL 12 PRODUCTION SAFETY TESTS PASSED 100%!" -ForegroundColor Green
}
