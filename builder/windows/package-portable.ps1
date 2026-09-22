$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
. (Join-Path $PSScriptRoot "app-version.ps1")
$version = Get-AppVersion -RepoRoot $root
$archiveName = "StructureLab-$version-x64-portable.zip"
$binaryCandidates = @(
    (Join-Path $root "src-tauri\target\release\structurelab.exe"),
    (Join-Path $root "src-tauri\target-gnu\x86_64-pc-windows-gnu\release\structurelab.exe")
) | Where-Object { Test-Path $_ }

if (-not $binaryCandidates -or $binaryCandidates.Count -eq 0) {
    throw "Release binary not found. Run builder\windows\build-portable.bat first."
}

$binary = $binaryCandidates |
    ForEach-Object { Get-Item $_ } |
    Sort-Object LastWriteTime |
    Select-Object -Last 1 |
    ForEach-Object { $_.FullName }

Write-Host "Packaging from: $binary"

$portableDirectory = Join-Path $root "portable"
$portableBinary = Join-Path $portableDirectory "StructureLab.exe"
$portableWebViewLoader = Join-Path $portableDirectory "WebView2Loader.dll"
$archive = Join-Path $root $archiveName

Get-ChildItem $root -Filter "StructureLab-*-x64-portable.zip" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-OutputPath $_.FullName }
$legacyZip = Join-Path $root "StructureLab Portable.zip"
Remove-OutputPath $legacyZip

Write-Host "  Replacing previous portable folder..."
Remove-OutputPath $portableDirectory
New-Item -ItemType Directory -Force -Path $portableDirectory | Out-Null

Write-Host "  Copying StructureLab.exe..."
Copy-ReplaceFile -From $binary -To $portableBinary
$webViewLoader = Join-Path (Split-Path $binary) "WebView2Loader.dll"
if (Test-Path $webViewLoader) {
    Copy-ReplaceFile -From $webViewLoader -To $portableWebViewLoader
}

# Repo builder helpers are never part of the shipped app.
@(
    (Join-Path $portableDirectory "scripts"),
    (Join-Path $portableDirectory "builder")
) | ForEach-Object {
    if (Test-Path $_) { Remove-Item -Recurse -Force $_ }
}

$minecraftSrc = Join-Path $root "minecraft"
$minecraftDest = Join-Path $portableDirectory "minecraft"
if (-not (Test-Path $minecraftSrc)) {
    throw "minecraft/ folder missing. Run builder\sync-minecraft-assets.ps1 or build-portable.bat (syncs automatically)."
}

Write-Host "  Copying minecraft/ assets (many small PNGs - can take a minute)..."
$copyStarted = Get-Date
Remove-OutputPath $minecraftDest
# robocopy is much faster than Copy-Item for ~10k+ texture files.
# Exit codes 0-7 mean success; 8+ means failure. Native non-zero exits must not abort.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$prevNative = $null
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $prevNative = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
}
& robocopy.exe $minecraftSrc $minecraftDest /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
$roboExit = $LASTEXITCODE
if ($null -ne $prevNative) { $PSNativeCommandUseErrorActionPreference = $prevNative }
$ErrorActionPreference = $prevEap
if ($roboExit -ge 8) {
    throw "robocopy failed copying minecraft/ (exit $roboExit)"
}
Write-Host ("  minecraft/ copied in {0:N1}s" -f ((Get-Date) - $copyStarted).TotalSeconds)

$readme = @"
StructureLab $version for Minecraft (64-bit portable)

Keep the files in this folder together and run StructureLab.exe directly.
Includes Maps and Models (meshes and skins to Minecraft structures).

The "minecraft" folder holds block palette data and preview textures - you can
browse or replace PNGs there (restart the app after changes).
No installation, Node.js, Rust, Java, or Visual Studio is required.
Windows WebView2 is required and is already included with supported Windows 10/11 systems.
"@
[System.IO.File]::WriteAllText((Join-Path $portableDirectory "README.txt"), $readme)

Write-Host "  Creating $archiveName (zipping thousands of textures - please wait)..."
$zipStarted = Get-Date
Remove-OutputPath $archive

# Prefer tar.exe (Windows 10+) - far faster than Compress-Archive on many small files.
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
$zipped = $false
if ($tar) {
    $entries = @("StructureLab.exe", "README.txt", "minecraft")
    if (Test-Path $portableWebViewLoader) { $entries += "WebView2Loader.dll" }
    Push-Location $portableDirectory
    try {
        & tar.exe -a -cf $archive -- $entries
        if ($LASTEXITCODE -eq 0 -and (Test-Path $archive)) { $zipped = $true }
    } finally {
        Pop-Location
    }
}

if (-not $zipped) {
    Write-Host "  tar unavailable or failed; falling back to Compress-Archive (slower)..."
    $archiveFiles = @(
        $portableBinary,
        (Join-Path $portableDirectory "README.txt"),
        $minecraftDest
    )
    if (Test-Path $portableWebViewLoader) {
        $archiveFiles += $portableWebViewLoader
    }
    Compress-Archive -Path $archiveFiles -DestinationPath $archive -Force
}

$zipSizeMb = [math]::Round((Get-Item $archive).Length / 1MB, 1)
Write-Host ("  Zip ready ({0} MB) in {1:N1}s" -f $zipSizeMb, ((Get-Date) - $zipStarted).TotalSeconds)

Write-Host $portableBinary
Write-Host $archive
Get-Item $portableBinary | Format-List FullName, Length, LastWriteTime
