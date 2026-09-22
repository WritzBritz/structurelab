# Assemble minecraft/{version}/ at the repo root for every palette under
# src-tauri/resources/minecraft/{version}/blocks.json.

$ErrorActionPreference = "Stop"

$root = if ($RepoRoot) { $RepoRoot } else { Resolve-Path (Join-Path $PSScriptRoot "..") }
Set-Location $root

& node (Join-Path $PSScriptRoot "sync-minecraft-assets.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "sync-minecraft-assets.mjs failed"
}
