# Stops the web server started by run-web.ps1.
$root = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\lib\stop-owned.ps1"
$file = "$root\.web-pid.json"
if (-not (Test-Path $file)) { Write-Output "no .web-pid.json"; exit 0 }
$info = Get-Content $file -Raw | ConvertFrom-Json
Write-Output (Stop-Owned $info.pid "python" $info.startedAt)
Remove-Item $file -Force
