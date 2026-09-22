# Full portable build: GNU linker setup -> tauri release -> zip.
# Invoked by build-portable.bat (keeps a console open for errors).

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

. (Join-Path $PSScriptRoot "app-version.ps1")
$version = Get-AppVersion -RepoRoot $root
$archiveName = "StructureLab-$version-x64-portable.zip"

Write-Host ""
Write-Host "=== StructureLab portable build (64-bit) ==="
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
Write-Host "[1/2] Building Tauri release binary (--no-bundle, windows-gnu)..."
npm run tauri -- build --no-bundle --target x86_64-pc-windows-gnu
if ($LASTEXITCODE -ne 0) { throw "tauri build failed." }

Write-Host ""
Write-Host "[2/2] Packaging portable folder + zip..."
Write-Host "(Copies ~17k Minecraft textures then zips them - can look idle for a bit.)"
& (Join-Path $PSScriptRoot "package-portable.ps1")

Write-Host ""
Write-Host "=== Done ==="
Write-Host "  Folder:      $(Join-Path $root 'portable\StructureLab.exe')"
Write-Host "  Release zip: $(Join-Path $root $archiveName)"
Write-Host "  64-bit portable. Upload this filename to GitHub Releases."
