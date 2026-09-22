# Shared helpers for Windows packagers. ASCII-only for Windows PowerShell 5.

function Get-AppVersion {
  param([string]$RepoRoot)
  $pkgPath = Join-Path $RepoRoot "package.json"
  if (-not (Test-Path -LiteralPath $pkgPath)) {
    throw "package.json not found - cannot read app version."
  }
  # Read as UTF-8 text. Piping Get-Content into ConvertFrom-Json can fail on
  # Windows PowerShell 5 when the path has spaces or the file has a BOM.
  $raw = [System.IO.File]::ReadAllText($pkgPath)
  if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) {
    $raw = $raw.Substring(1)
  }
  try {
    $pkg = $raw | ConvertFrom-Json
  } catch {
    if ($raw -match '"version"\s*:\s*"([^"]+)"') {
      $version = $Matches[1]
      if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
        throw "Unexpected version in package.json: '$version' (expected semver like 0.9.0-beta)."
      }
      return $version
    }
    throw "Failed to parse package.json: $($_.Exception.Message)"
  }
  $version = [string]$pkg.version
  if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
    throw "Unexpected version in package.json: '$version' (expected semver like 0.9.0-beta)."
  }
  return $version
}

# Delete a file or folder. Throws if Windows has it locked (running exe, open zip).
function Remove-OutputPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  try {
    Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
      ForEach-Object { $_.Attributes = 'Normal' }
    Remove-Item -LiteralPath $Path -Force -Recurse -ErrorAction Stop
  } catch {
    throw @"
Cannot replace '$Path'.
Close StructureLab if that build is running, and close the file if Explorer has it open, then rebuild.
$($_.Exception.Message)
"@
  }
}

# Remove dest first, then copy, so a locked previous build cannot be left in place.
function Copy-ReplaceFile {
  param(
    [Parameter(Mandatory = $true)][string]$From,
    [Parameter(Mandatory = $true)][string]$To
  )
  if (-not (Test-Path -LiteralPath $From)) {
    throw "Source file not found: $From"
  }
  $dir = Split-Path -Parent $To
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  Remove-OutputPath $To
  Copy-Item -LiteralPath $From -Destination $To -Force
  if (-not (Test-Path -LiteralPath $To)) {
    throw "Copy failed: $From -> $To"
  }
}
