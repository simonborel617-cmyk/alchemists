# Stops the processes started by run-testnet.ps1 (and their worker threads).
$root = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\lib\stop-owned.ps1"
$file = "$root\.testnet-pids.json"
if (-not (Test-Path $file)) { Write-Output "no .testnet-pids.json, nothing to stop"; exit 0 }
$pids = Get-Content $file | ConvertFrom-Json
foreach ($name in @("keeper", "miner")) {
  $id = $pids.$name
  if ($id) { Write-Output ("${name}: " + (Stop-Owned $id "node" $pids.startedAt)) }
}
Remove-Item $file -Force
