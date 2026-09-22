# Puts a Windows GNU linker (dlltool) on PATH for this shell when MSVC link.exe is absent.
# Toolchain cache: %LOCALAPPDATA%\structurelab-gnu-linker (~700 MB, outside the repo).
# Also selects the windows-gnu Rust toolchain for this shell so host build-scripts
# link with dlltool (repo rust-toolchain.toml is host-agnostic for Linux/macOS).

$ErrorActionPreference = "Stop"

& rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install stable-x86_64-pc-windows-gnu via rustup"
}
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"

$destRoot = Join-Path $env:LOCALAPPDATA "structurelab-gnu-linker"
# Migrate older cache folder names if present.
foreach ($legacyName in @("structurelab-llvm-mingw", "mapart-llvm-mingw")) {
  $legacyRoot = Join-Path $env:LOCALAPPDATA $legacyName
  if (-not (Test-Path $destRoot) -and (Test-Path $legacyRoot)) {
    Rename-Item -Path $legacyRoot -NewName "structurelab-gnu-linker"
    break
  }
}

$toolchain = Get-ChildItem $destRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "bin\dlltool.exe") } |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $toolchain) {
    Write-Host "GNU linker not found. Downloading once to $destRoot ..."
    New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
    $zip = Join-Path $env:TEMP "structurelab-gnu-linker.zip"
    # Upstream release used for the Windows GNU toolchain binaries.
    $release = Invoke-RestMethod 'https://api.github.com/repos/mstorsjo/llvm-mingw/releases/latest'
    $asset = $release.assets | Where-Object { $_.name -match 'ucrt-x86_64\.zip$' } | Select-Object -First 1
    if (-not $asset) { throw "No UCRT x86_64 GNU toolchain zip in latest upstream release" }
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $destRoot -Force
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
    $toolchain = Get-ChildItem $destRoot -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName "bin\dlltool.exe") } |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $toolchain) { throw "Extracted GNU toolchain but dlltool.exe is missing" }

    $libDir = Join-Path $toolchain "x86_64-w64-mingw32\lib"
    $clangRt = Get-ChildItem (Join-Path $toolchain "lib\clang") -Recurse -Filter "libclang_rt.builtins-x86_64.a" -EA SilentlyContinue | Select-Object -First 1
    if (Test-Path (Join-Path $libDir "libunwind.a")) {
        Copy-Item -Force (Join-Path $libDir "libunwind.a") (Join-Path $libDir "libgcc_eh.a")
    }
    if ($clangRt) {
        Copy-Item -Force $clangRt.FullName (Join-Path $libDir "libgcc.a")
    }
}

$env:PATH = "$(Join-Path $toolchain 'bin');$env:USERPROFILE\.cargo\bin;$env:PATH"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$env:CARGO_TARGET_DIR = Join-Path $root "src-tauri\target-gnu"

Write-Host "GNU linker ready: $toolchain"
Write-Host "RUSTUP_TOOLCHAIN=$env:RUSTUP_TOOLCHAIN"
Write-Host "CARGO_TARGET_DIR=$env:CARGO_TARGET_DIR"
Write-Host "Example: npm run tauri -- build --no-bundle --target x86_64-pc-windows-gnu"
