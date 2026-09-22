# Stops the GPU orchestrator started by run-gpu.ps1 (asks it to QUIT the miner first, then kills the process tree).
$root = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\lib\stop-owned.ps1"
$file = "$root\.gpu-pid.json"
if (-not (Test-Path $file)) { Write-Output "no .gpu-pid.json"; exit 0 }
$info = Get-Content $file | ConvertFrom-Json
New-Item -ItemType File -Path "$root\gpu-stop.txt" -Force | Out-Null
Start-Sleep -Seconds 4
Write-Output (Stop-Owned $info.pid "python" $info.startedAt)
Remove-Item "$root\gpu-stop.txt" -Force -ErrorAction SilentlyContinue
Remove-Item $file -Force
