# Development helper: launches the built app with an isolated profile, optionally
# runs UI steps, and saves screenshots. Never touches the real user profile.
param(
  [Parameter(Mandatory)] [string]$Profile,
  [Parameter(Mandatory)] [string]$Out,
  [int]$Delay = 6000,
  [int]$Step = 2500,
  [string]$Js = ''
)
$env:MB_USERDATA = $Profile
$env:MB_SHOT = $Out
$env:MB_SHOT_DELAY = "$Delay"
$env:MB_SHOT_STEP = "$Step"
$env:MB_SHOT_JS = $Js
$exe = Join-Path $PSScriptRoot '..\node_modules\electron\dist\electron.exe'
$log = "$Out.log"
$p = Start-Process -FilePath $exe -ArgumentList '.' -WorkingDirectory (Join-Path $PSScriptRoot '..') -PassThru -RedirectStandardError $log -RedirectStandardOutput "$Out.out.log"
if (-not $p.WaitForExit(120000)) { $p.Kill(); 'TIMEOUT' }
Get-Content $log -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch 'DevTools|GPU|cache' } | Select-Object -First 15
