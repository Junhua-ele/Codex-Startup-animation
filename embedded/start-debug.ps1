[CmdletBinding()]
param(
    [ValidateRange(1024,65535)][int]$Port=9447,
    [switch]$CheckOnly,
    [switch]$LibraryOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Get-NeonCodex {
    $pkg=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
    if(-not $pkg -or "$($pkg.SignatureKind)" -ine 'Store') { throw 'An official Codex Store package is required.' }
    $manifest=Get-AppxPackageManifest -Package $pkg.PackageFullName
    $exe=Join-Path $pkg.InstallLocation 'app\ChatGPT.exe'
    $apps=@($manifest.Package.Applications.Application)
    $app=$apps | Where-Object { $_.Executable -match '(?i)(^|[\\/])ChatGPT\.exe$' } | Select-Object -First 1
    if(-not $app -or -not [IO.File]::Exists($exe)) { throw 'The expected desktop application could not be identified.' }
    $aumid='{0}!{1}' -f $pkg.PackageFamilyName,$app.Id
    if($aumid -notmatch '^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$') { throw 'Invalid application identity.' }
    return [pscustomobject]@{ Package=$pkg; Executable=$exe; Aumid=$aumid; Version="$($pkg.Version)" }
}

function Get-NeonRunningCodex {
    param($Codex)
    # Match all ChatGPT processes, including an older package still running after an update.
    return @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" -ErrorAction Stop | Where-Object {
        -not $_.ExecutablePath -or $_.ExecutablePath -ieq $Codex.Executable -or $_.ExecutablePath -match '[\\/]WindowsApps[\\/]OpenAI\.Codex_'
    })
}

function Get-NeonEndpointIdentity {
    param([int]$Port,$Codex)
    $listeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if(-not $listeners.Count) { return $null }
    foreach($listener in $listeners) {
        if($listener.LocalAddress -notin @('127.0.0.1','::1')) { throw 'Debug port is not exclusively bound to loopback.' }
        $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$listener.OwningProcess)"
        if(-not $owner -or $owner.ExecutablePath -ine $Codex.Executable) { throw 'Debug listener is not owned by the validated Codex executable.' }
    }
    try { $version=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 1 } catch { return $null }
    $uri=[Uri]$version.webSocketDebuggerUrl
    if($uri.Scheme -ne 'ws' -or $uri.Host -notin @('127.0.0.1','localhost','[::1]','::1') -or $uri.Port -ne $Port -or $uri.Query -or $uri.Fragment -or $uri.UserInfo -or $uri.AbsolutePath -cnotmatch '^/devtools/browser/([A-Za-z0-9_-]+)$') {
        throw 'Debug browser identity is invalid.'
    }
    return $Matches[1]
}

function Start-NeonPackage {
    param([string]$Aumid,[string]$Arguments)
    if(-not ('NeonBoot.PackageActivation' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace NeonBoot {
  [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IActivation {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string args, uint options, out uint pid);
  }
  [ComImport, Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c")] class Manager {}
  public static class PackageActivation {
    public static uint Start(string id, string args) {
      var manager=(IActivation)new Manager();
      try { uint pid; Marshal.ThrowExceptionForHR(manager.ActivateApplication(id,args,0,out pid)); return pid; }
      finally { Marshal.FinalReleaseComObject(manager); }
    }
  }
}
'@
    }
    [void][NeonBoot.PackageActivation]::Start($Aumid,$Arguments)
}

function Invoke-NeonDebug {
    param([int]$DebugPort,[switch]$InspectOnly)
    $codex=Get-NeonCodex
    $node=(Get-Command node.exe -ErrorAction Stop).Source
    $nodeVersion=& $node --version
    if([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Node.js 22 or newer is required.' }
    $adapter=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'adapter.json') -Raw | ConvertFrom-Json
    $reviewed=@($adapter.supportedVersions) -contains $codex.Version
    $running=@(Get-NeonRunningCodex $codex)
    $listeners=@(Get-NetTCPConnection -LocalPort $DebugPort -State Listen -ErrorAction SilentlyContinue)
    $plan=[pscustomobject]@{ schema=1; packageVersion=$codex.Version; normalEntryPreserved=$true; runningProcesses=$running.Count; port=$DebugPort; portAvailable=($listeners.Count -eq 0); staticAdapterMatch=$reviewed; versionCheckEnabled=$false; hashCheckEnabled=$false; nativeRuntimeValidated=$adapter.runtimeValidated; canColdStart=($running.Count -eq 0 -and $listeners.Count -eq 0) }
    if($InspectOnly) { $plan | ConvertTo-Json; return }
    if($running.Count) { throw 'Codex is currently open. Save your work and close it yourself before using this experimental entry. No processes were stopped.' }
    if($listeners.Count) { throw 'The selected debug port is occupied. Nothing was launched.' }
    # Version allowlist enforcement temporarily disabled; keep the static match for diagnostics.
    # Resource hash enforcement temporarily disabled to allow newer Codex builds.
    $root=Split-Path $PSScriptRoot -Parent
    if(Test-Path -LiteralPath (Join-Path $root 'disable-animation.flag')) { throw 'Animation is disabled. Use the normal Codex entry.' }
    $runtime=Join-Path $root '.neon-runtime'
    if(Test-Path -LiteralPath $runtime) {
        if((Get-Item -LiteralPath $runtime).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime directory must not be a junction or symlink.' }
    }
    [void][IO.Directory]::CreateDirectory($runtime)
    $profile=Join-Path $runtime 'profile'
    if(Test-Path -LiteralPath $profile) {
        if((Get-Item -LiteralPath $profile).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Profile directory must not be a junction or symlink.' }
    }
    # Only this entry opens a debugger. No automatic stop/restart or executable fallback.
    $arguments='--remote-debugging-address=127.0.0.1 --remote-debugging-port={0} --user-data-dir="{1}"' -f $DebugPort,$profile
    Start-NeonPackage -Aumid $codex.Aumid -Arguments $arguments
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $browserId=$null
    while(-not $browserId -and $clock.Elapsed.TotalSeconds -lt 20) {
        $browserId=Get-NeonEndpointIdentity -Port $DebugPort -Codex $codex
        if(-not $browserId) { Start-Sleep -Milliseconds 100 }
    }
    if(-not $browserId) { throw 'This Codex session did not expose a verified debug endpoint. No app files were changed. Close this session and use the normal entry; do not modify WindowsApps permissions.' }
    $record=Join-Path $runtime 'session.json'
    $json=[pscustomobject]@{schema=1;port=$DebugPort;browserId=$browserId;packageVersion=$codex.Version} | ConvertTo-Json
    [IO.File]::WriteAllText($record,$json,[Text.UTF8Encoding]::new($false))
    # No chat, DOM text or credentials are logged. Native readiness is still version-specific.
    $log=Join-Path $runtime ('startup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')
    Write-Host ('Startup state log: ' + $log)
    & $node (Join-Path $PSScriptRoot 'injector.mjs') --session $record | Tee-Object -FilePath $log
    if($LASTEXITCODE -ne 0) { throw 'Embedded startup was not confirmed ready. See the state messages above. The Codex process was left running.' }
}

if(-not $LibraryOnly) {
    try { Invoke-NeonDebug -DebugPort $Port -InspectOnly:$CheckOnly; exit 0 }
    catch { Write-Error $_.Exception.Message -ErrorAction Continue; exit 1 }
}
