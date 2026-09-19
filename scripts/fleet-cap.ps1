# Rental cap: at the deadline stops the orchestrator (gpu-stop.txt, then kill) and destroys every Vast instance with the given label.
#   powershell -ExecutionPolicy Bypass -File scripts\fleet-cap.ps1 -DeadlineUtc 2026-09-16T23:45:00Z
param(
  [Parameter(Mandatory=$true)][string]$DeadlineUtc,
  [string]$Label = "alch-fleet"
)
$root = Split-Path -Parent $PSScriptRoot
$log = "$root\fleet-cap.log"
$deadline = [DateTime]::Parse($DeadlineUtc).ToUniversalTime()
"armed at $((Get-Date).ToUniversalTime().ToString('o')) for $($deadline.ToString('o')) label=$Label" | Add-Content $log
while ((Get-Date).ToUniversalTime() -lt $deadline) { Start-Sleep -Seconds 30 }
"deadline reached $((Get-Date).ToUniversalTime().ToString('o'))" | Add-Content $log
Set-Content -Path "$root\gpu-stop.txt" -Value "cap"
$opid = 0
try { $info = Get-Content "$root\.gpu-pid.json" -Raw | ConvertFrom-Json; $opid = [int]$info.pid } catch { $opid = 0 }
$waited = 0
while ($opid -gt 0 -and (Get-Process -Id $opid -ErrorAction SilentlyContinue) -and $waited -lt 180) { Start-Sleep -Seconds 5; $waited += 5 }
if ($opid -gt 0 -and (Get-Process -Id $opid -ErrorAction SilentlyContinue)) { Stop-Process -Id $opid -Force; "killed orchestrator $opid" | Add-Content $log } else { "orchestrator $opid exited (waited $waited s)" | Add-Content $log }
$out = & python "$env:USERPROFILE\.claude\skills\vast\scripts\destroy.py" --label $Label --yes 2>&1
$out | Add-Content $log
"done $((Get-Date).ToUniversalTime().ToString('o'))" | Add-Content $log
