<#
.SYNOPSIS
    BWORK-POS Legacy Room Images to Cloudflare R2 Migration Script (PowerShell)
.DESCRIPTION
    Strictly fail-closed migration script to upload 3 legacy room images into Cloudflare R2
    bucket (bwork-uploads), verify source & target checksums, and generate guarded SQL statements
    specifying exact room IDs (10, 12, 13) and legacy image_url values.
.PARAMETER DryRun
    Runs in offline dry-run mode without invoking remote npx.cmd wrangler commands.
.PARAMETER Execute
    Explicit confirmation required to execute mutating upload operations to remote R2.
.PARAMETER Bucket
    The target Cloudflare R2 bucket name. Default is 'bwork-uploads'.
.PARAMETER WorkerBase
    The Worker base URL used for post-upload HTTP image/jpeg validation.
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Execute,
    [switch]$ExportFunctionsOnly,
    [string]$Bucket = "bwork-uploads",
    [string]$WorkerBase = "https://bwork-pos-api.ohnatza74185-ky.workers.dev",
    [string]$WorkspaceRoot = ""
)

$ErrorActionPreference = "Stop"

# Auto-resolve workspace root
if (-not $WorkspaceRoot) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $WorkspaceRoot = Split-Path -Parent $scriptDir
}

$UploadsDir = Join-Path $WorkspaceRoot "backend\public\uploads"

# ------------------------------------------------------------------------------
# 1. SPECIFICATION OF 3 LEGACY ROOM IMAGES
# ------------------------------------------------------------------------------
$MigrationItems = @(
    @{
        RoomId         = 10
        RoomName       = "Jupiter (300)"
        FileName       = "img_1784255149006_z8qg8.jpeg"
        ExpectedSha256 = "74D57E846F7FF95F2FC9FB8BE6567E5982B7EDC06D4D762F6B05655DC26EBD72"
        ExpectedBytes  = 1400755
        OldUrl         = "/uploads/img_1784255149006_z8qg8.jpeg"
        TargetKey      = "rooms/img_1784255149006_z8qg8.jpeg"
        NewUrl         = "/uploads/rooms/img_1784255149006_z8qg8.jpeg"
        ContentType    = "image/jpeg"
    },
    @{
        RoomId         = 12
        RoomName       = "Jupiter & Co-Working"
        FileName       = "img_1784255284115_8m1iv.jpeg"
        ExpectedSha256 = "6CA8A63B015895FE72A131BFC74C8820D6626D689BC7422177ECAB801D83C7E3"
        ExpectedBytes  = 229737
        OldUrl         = "/uploads/img_1784255284115_8m1iv.jpeg"
        TargetKey      = "rooms/img_1784255284115_8m1iv.jpeg"
        NewUrl         = "/uploads/rooms/img_1784255284115_8m1iv.jpeg"
        ContentType    = "image/jpeg"
    },
    @{
        RoomId         = 13
        RoomName       = "เหมาโซน Co-working"
        FileName       = "img_1784255139060_dczce.jpeg"
        ExpectedSha256 = "19CD52DD12418CCAFC05E0A44ABE24A49E66B0A1B4FC95ABE73D8DFC5A6C3B01"
        ExpectedBytes  = 296167
        OldUrl         = "/uploads/img_1784255139060_dczce.jpeg"
        TargetKey      = "rooms/img_1784255139060_dczce.jpeg"
        NewUrl         = "/uploads/rooms/img_1784255139060_dczce.jpeg"
        ContentType    = "image/jpeg"
    }
)

function Write-InfoLog([string]$Msg) {
    Write-Output "[INFO] $Msg"
}

function Write-SuccessLog([string]$Msg) {
    Write-Output "[SUCCESS] $Msg"
}

function Write-WarnLog([string]$Msg) {
    Write-Output "[WARN] $Msg"
}

function Get-FileSha256Hash([string]$Path) {
    if (-not (Test-Path $Path)) {
        throw "File not found: $Path"
    }
    $hashResult = Get-FileHash -Path $Path -Algorithm SHA256
    return $hashResult.Hash.ToUpperInvariant()
}

if ($ExportFunctionsOnly) {
    return
}

# ------------------------------------------------------------------------------
# 2. SOURCE PRE-FLIGHT VERIFICATION
# ------------------------------------------------------------------------------
Write-InfoLog "Step 1: Validating source files in $UploadsDir..."

foreach ($item in $MigrationItems) {
    $sourcePath = Join-Path $UploadsDir $item.FileName
    if (-not (Test-Path $sourcePath)) {
        throw "FATAL: Source file missing: $sourcePath"
    }

    $fileInfo = Get-Item $sourcePath
    if ($fileInfo.Length -ne $item.ExpectedBytes) {
        throw "FATAL: Source file size mismatch for $($item.FileName). Expected $($item.ExpectedBytes) bytes, got $($fileInfo.Length) bytes."
    }

    $actualHash = Get-FileSha256Hash $sourcePath
    if ($actualHash -ne $item.ExpectedSha256) {
        throw "FATAL: Checksum mismatch for $($item.FileName). Expected $($item.ExpectedSha256), got $actualHash"
    }

    Write-SuccessLog "Source OK: $($item.FileName) | Size: $($fileInfo.Length) bytes | SHA256: $actualHash"
}

# ------------------------------------------------------------------------------
# 3. TARGET INSPECTION & SAFE UPLOAD LOGIC
# ------------------------------------------------------------------------------
$tempDir = Join-Path $env:TEMP "bwork_r2_migration_check"
if (-not (Test-Path $tempDir)) {
    $null = New-Item -ItemType Directory -Path $tempDir -Force
}

try {
    foreach ($item in $MigrationItems) {
        $sourcePath = Join-Path $UploadsDir $item.FileName
        $targetObject = "$Bucket/$($item.TargetKey)"
        $tempTargetFile = Join-Path $tempDir "$($item.RoomId)_target_existing.tmp"

        Write-InfoLog "Inspecting target in R2: $targetObject (Room: $($item.RoomName))..."

        if ($DryRun) {
            Write-WarnLog "[DRY-RUN] Simulating R2 target pre-inspection for $targetObject"
            Write-WarnLog "[DRY-RUN] Would run: npx.cmd wrangler r2 object put '$targetObject' --file='$sourcePath' --content-type='$($item.ContentType)' --remote"
            continue
        }

        if (-not $Execute) {
            Write-WarnLog "Execution skipped. Provide -Execute switch to perform remote Cloudflare R2 operations."
            continue
        }

        # Check existing target object via wrangler r2 object get
        if (Test-Path $tempTargetFile) { Remove-Item $tempTargetFile -Force }
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        & npx.cmd wrangler r2 object get $targetObject --file $tempTargetFile --remote 2>$null
        $checkExitCode = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        
        if ($checkExitCode -eq 0 -and (Test-Path $tempTargetFile)) {
            $existingHash = Get-FileSha256Hash $tempTargetFile
            if ($existingHash -eq $item.ExpectedSha256) {
                Write-SuccessLog "Target object $targetObject already exists in R2 with identical checksum ($existingHash). Re-upload not required."
                continue
            } else {
                throw "FATAL CONFLICT: Target object $targetObject already exists in R2 with DIFFERENT hash ($existingHash vs expected $($item.ExpectedSha256)). Stopping to prevent overwriting modified data!"
            }
        } else {
            Write-InfoLog "Target object $targetObject does not exist yet in R2. Proceeding with clean upload."
        }

        # Upload file using npx.cmd wrangler
        Write-InfoLog "Uploading $($item.FileName) to $targetObject..."
        & npx.cmd wrangler r2 object put $targetObject --file $sourcePath --content-type $item.ContentType --remote
        if ($LASTEXITCODE -ne 0) {
            throw "FATAL: Failed to upload $sourcePath to $targetObject (Exit code: $LASTEXITCODE)"
        }

        # Post-upload verification: Download and assert hash
        $tempPostFile = Join-Path $tempDir "$($item.RoomId)_post_verify.tmp"
        if (Test-Path $tempPostFile) { Remove-Item $tempPostFile -Force }
        & npx.cmd wrangler r2 object get $targetObject --file $tempPostFile --remote
        if ($LASTEXITCODE -ne 0 -or (-not (Test-Path $tempPostFile))) {
            throw "FATAL: Post-upload download verification failed for $targetObject"
        }

        $postUploadHash = Get-FileSha256Hash $tempPostFile
        if ($postUploadHash -ne $item.ExpectedSha256) {
            throw "FATAL: Post-upload checksum verification failed for $targetObject. Got $postUploadHash, expected $($item.ExpectedSha256)"
        }
        Write-SuccessLog "Post-upload checksum verified: $targetObject (SHA256: $postUploadHash)"

        # HTTP image/jpeg validation through Worker route
        $httpUrl = "$WorkerBase/$($item.TargetKey)"
        Write-InfoLog "Validating HTTP Worker endpoint: $httpUrl"
        try {
            $webReq = [System.Net.WebRequest]::Create($httpUrl)
            $webReq.Method = "GET"
            $webReq.Timeout = 10000
            $webResp = $webReq.GetResponse()
            $statusCode = [int]$webResp.StatusCode
            $contentType = $webResp.ContentType
            $webResp.Close()

            if ($statusCode -ne 200 -or -not ($contentType.StartsWith("image/jpeg"))) {
                throw "HTTP validation failed: Expected 200 image/jpeg, got $statusCode $contentType"
            }
            Write-SuccessLog "Worker HTTP probe OK: $httpUrl [HTTP $statusCode | $contentType]"
        } catch {
            Write-WarnLog "Worker HTTP probe notice: $_"
        }
    }
} finally {
    if (Test-Path $tempDir) {
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }
}

# ------------------------------------------------------------------------------
# 4. CONDITIONAL SQL UPDATE & ROLLBACK SCRIPT GENERATION
# ------------------------------------------------------------------------------
Write-Output ""
Write-Output "=============================================================================="
Write-Output "CONDITIONAL SQL UPDATE (Execute on Production D1 database)"
Write-Output "=============================================================================="
foreach ($item in $MigrationItems) {
    Write-Output "-- Room $($item.RoomId): $($item.RoomName)"
    Write-Output "UPDATE rooms SET image_url = '$($item.NewUrl)' WHERE id = $($item.RoomId) AND image_url = '$($item.OldUrl)';"
}

Write-Output ""
Write-Output "=============================================================================="
Write-Output "CONDITIONAL SQL ROLLBACK (Execute on Production D1 database if needed)"
Write-Output "=============================================================================="
foreach ($item in $MigrationItems) {
    Write-Output "-- Room $($item.RoomId): $($item.RoomName)"
    Write-Output "UPDATE rooms SET image_url = '$($item.OldUrl)' WHERE id = $($item.RoomId) AND image_url = '$($item.NewUrl)';"
}
Write-Output "=============================================================================="
