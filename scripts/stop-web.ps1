# Stops the web server started by run-web.ps1.
$root = Split-Path -Parent $PSScriptRoot
$file = "$root\.web-pid.json"
if (-not (Test-Path $file)) { Write-Output "no .web-pid.json"; exit 0 }
$info = Get-Content $file -Raw | ConvertFrom-Json
try { Stop-Process -Id $info.pid -Force -ErrorAction Stop; Write-Output "stopped pid $($info.pid)" } catch { Write-Output "pid $($info.pid) already gone" }
Remove-Item $file -Force
