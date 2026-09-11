# =============================================================================
#  LRC-401 — Toolchain activation
# =============================================================================
#  Every portable tool this project needs lives in ONE place:
#
#      C:\Users\<you>\tools\
#          nodejs\        <- Node.js + npm (portable, no admin install)
#          _downloads\    <- installers/zips we keep for re-installs
#
#  Node was also added to your USER PATH, so `node` and `npm` work in any NEW
#  terminal. This script exists for terminals that were already open (they
#  still hold the old PATH), and to print a quick status check.
#
#  Usage from the project root:
#
#      . .\tools.ps1          # note the leading dot — "dot-sourcing" applies
#                             # the PATH change to your CURRENT shell
# =============================================================================

$ToolsRoot = Join-Path $env:USERPROFILE 'tools'
$NodeDir   = Join-Path $ToolsRoot 'nodejs'

# --- Put the portable Node at the FRONT of PATH for this shell only ----------
# Prepending (rather than appending) guarantees we use our known-good copy even
# if another Node is installed later.
if (Test-Path $NodeDir) {
    if ($env:Path -notlike "*$NodeDir*") {
        $env:Path = "$NodeDir;$env:Path"
    }
} else {
    Write-Warning "Node not found at $NodeDir. Re-run the install step in docs/03-SETUP.md."
}

# --- Report what we have -----------------------------------------------------
Write-Host ''
Write-Host 'LRC-401 toolchain' -ForegroundColor Red
Write-Host '-----------------'

function Show-Tool {
    param([string]$Label, [scriptblock]$Probe)
    try   { Write-Host ('{0,-12} {1}' -f $Label, (& $Probe 2>$null)) -ForegroundColor Green }
    catch { Write-Host ('{0,-12} MISSING' -f $Label) -ForegroundColor Yellow }
}

Show-Tool 'node'    { node -v }
Show-Tool 'npm'     { npm -v }
Show-Tool 'git'     { (git --version) -replace 'git version ', '' }
Show-Tool 'psql'    { (psql --version) -replace 'psql \(PostgreSQL\) ', '' }

Write-Host ''
Write-Host ('tools home   {0}' -f $ToolsRoot) -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Common commands:' -ForegroundColor Cyan
Write-Host '  npm run setup        install deps for server + client (first time)'
Write-Host '  npm run db:migrate   create/apply database migrations'
Write-Host '  npm run db:seed      load roles, teams, vehicles, demo form'
Write-Host '  npm run dev          run API (:4000) and web (:5173) together'
Write-Host ''
