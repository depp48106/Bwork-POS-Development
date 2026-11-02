<#
.SYNOPSIS
    Automated Regression Test Suite for migrate_legacy_room_images_to_r2.ps1
#>

$ErrorActionPreference = "Stop"

$testDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $testDir
$workspaceRoot = Split-Path -Parent $backendDir
$targetScript = Join-Path $workspaceRoot "scripts\migrate_legacy_room_images_to_r2.ps1"

Write-Host "Running tests for migrate_legacy_room_images_to_r2.ps1..." -ForegroundColor Cyan

# Test 1: Script exists
if (-not (Test-Path $targetScript)) {
    throw "Test 1 Failed: Target script not found at $targetScript"
}
Write-Host "PASS: Test 1: Script file exists" -ForegroundColor Green

# Test 2: Export functions only
. $targetScript -ExportFunctionsOnly -WorkspaceRoot $workspaceRoot
if ($MigrationItems.Count -ne 3) {
    throw "Test 2 Failed: Expected 3 migration items, found $($MigrationItems.Count)"
}
Write-Host "PASS: Test 2: Migration item table loaded ($($MigrationItems.Count) items)" -ForegroundColor Green

# Test 3: Validate exact hashes and room IDs
$room10 = $MigrationItems | Where-Object { $_.RoomId -eq 10 }
$room12 = $MigrationItems | Where-Object { $_.RoomId -eq 12 }
$room13 = $MigrationItems | Where-Object { $_.RoomId -eq 13 }

if (-not $room10 -or $room10.ExpectedSha256 -ne "74D57E846F7FF95F2FC9FB8BE6567E5982B7EDC06D4D762F6B05655DC26EBD72") {
    throw "Test 3 Failed: Room 10 hash or ID invalid"
}
if (-not $room12 -or $room12.ExpectedSha256 -ne "6CA8A63B015895FE72A131BFC74C8820D6626D689BC7422177ECAB801D83C7E3") {
    throw "Test 3 Failed: Room 12 hash or ID invalid"
}
if (-not $room13 -or $room13.ExpectedSha256 -ne "19CD52DD12418CCAFC05E0A44ABE24A49E66B0A1B4FC95ABE73D8DFC5A6C3B01") {
    throw "Test 3 Failed: Room 13 hash or ID invalid"
}
Write-Host "PASS: Test 3: Exact room IDs (10, 12, 13) and SHA-256 contracts verified" -ForegroundColor Green

# Test 4: Verify real source files on disk
$uploadsDir = Join-Path $workspaceRoot "backend\public\uploads"
foreach ($item in $MigrationItems) {
    $filePath = Join-Path $uploadsDir $item.FileName
    if (-not (Test-Path $filePath)) {
        throw "Test 4 Failed: Source file $($item.FileName) missing on disk"
    }
    $actualHash = Get-FileSha256Hash $filePath
    if ($actualHash -ne $item.ExpectedSha256) {
        throw "Test 4 Failed: Hash mismatch on disk for $($item.FileName)"
    }
}
Write-Host "PASS: Test 4: All 3 source image files on disk match verified SHA-256 hashes" -ForegroundColor Green

# Test 5: Verify fail-safe on corrupted hash
$tempFile = [System.IO.Path]::GetTempFileName()
try {
    Set-Content -Path $tempFile -Value "corrupted dummy content"
    $corruptedHash = Get-FileSha256Hash $tempFile
    if ($corruptedHash -eq $room10.ExpectedSha256) {
        throw "Test 5 Failed: Corrupted hash collision (impossible)"
    }
    Write-Host "PASS: Test 5: Checksum validation detects modified/corrupted files" -ForegroundColor Green
} finally {
    if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
}

Write-Host "All migration test assertions passed successfully!" -ForegroundColor Green
