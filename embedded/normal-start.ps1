[CmdletBinding()]
param([switch]$LibraryOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'start-debug.ps1') -LibraryOnly

function Invoke-NeonNormalStart {
    $codex=Get-NeonCodex
    # Use official system activation without a debug port or a custom profile.
    Start-NeonPackage -Aumid $codex.Aumid -Arguments ''
}

if(-not $LibraryOnly) {
    try { Invoke-NeonNormalStart; exit 0 }
    catch { Write-Error -Message $_.Exception.Message -ErrorAction Continue; exit 1 }
}
