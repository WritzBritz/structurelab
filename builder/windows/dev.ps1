# Hot-reload dev session (Vite + Tauri debug binary).
# Uses the GNU linker like build-portable.ps1 — no Visual Studio / link.exe required.

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

Write-Host ""
Write-Host "=== StructureLab dev (64-bit, GNU toolchain) ==="
Write-Host "Repo: $root"
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
Write-Host "Starting Vite + Tauri dev (save files to hot-reload the UI)..."
Write-Host ""

npm run tauri dev
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
