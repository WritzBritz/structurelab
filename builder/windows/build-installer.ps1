# 64-bit NSIS installer: GNU linker setup -> tauri nsis bundle -> versioned copy at repo root.
# Invoked by build-installer.bat (keeps a console open for errors).

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

. (Join-Path $PSScriptRoot "app-version.ps1")
$version = Get-AppVersion -RepoRoot $root
$installerName = "StructureLab-$version-x64-setup.exe"

Write-Host ""
Write-Host "=== StructureLab Windows installer (64-bit NSIS) ==="
Write-Host "Repo:    $root"
Write-Host "Version: $version"
Write-Host ""
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js not found on PATH. Install Node 22+ and try again."
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "Rust/cargo not found on PATH. Install Rust stable and try again."
}

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Host "Installing npm dependencies..."
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  Write-Host ""
}

Write-Host "Preparing GNU linker (dlltool)..."
. (Join-Path $PSScriptRoot "use-gnu-linker.ps1")
if (-not (Get-Command dlltool -ErrorAction SilentlyContinue)) {
  throw "dlltool.exe still not on PATH after use-gnu-linker.ps1"
}

Write-Host ""
Write-Host "Copying local Minecraft palettes/icons/block textures..."
npm run sync:assets
if ($LASTEXITCODE -ne 0) { throw "sync:assets failed." }

Write-Host ""
Write-Host "Building Tauri NSIS installer (x86_64-pc-windows-gnu)..."
$nsisDirs = @(
  (Join-Path $root "src-tauri\target-gnu\x86_64-pc-windows-gnu\release\bundle\nsis"),
  (Join-Path $root "src-tauri\target\x86_64-pc-windows-gnu\release\bundle\nsis"),
  (Join-Path $root "src-tauri\target\release\bundle\nsis")
)
foreach ($dir in $nsisDirs) { Remove-OutputPath $dir }

npm run tauri -- build --bundles nsis --target x86_64-pc-windows-gnu
if ($LASTEXITCODE -ne 0) { throw "tauri installer build failed." }

$setup = $nsisDirs |
  Where-Object { Test-Path $_ } |
  ForEach-Object { Get-ChildItem $_ -Filter "*.exe" -ErrorAction SilentlyContinue } |
  Sort-Object LastWriteTime |
  Select-Object -Last 1

if (-not $setup) {
  throw "NSIS installer .exe not found under src-tauri\target*\release\bundle\nsis\"
}

$dest = Join-Path $root $installerName
Get-ChildItem $root -Filter "StructureLab-*-x64-setup.exe" -File -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-OutputPath $_.FullName }
Copy-ReplaceFile -From $setup.FullName -To $dest

Write-Host ""
Write-Host "=== Done ==="
Write-Host "  Release file: $dest"
Write-Host "  Tauri output: $($setup.FullName)"
Write-Host "  64-bit NSIS (Start Menu + uninstall). Upload this filename to GitHub Releases."
