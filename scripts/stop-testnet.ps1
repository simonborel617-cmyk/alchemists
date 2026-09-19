# Stops the processes started by run-testnet.ps1 (and their worker threads).
$root = Split-Path -Parent $PSScriptRoot
$file = "$root\.testnet-pids.json"
if (-not (Test-Path $file)) { Write-Output "no .testnet-pids.json, nothing to stop"; exit 0 }
$pids = Get-Content $file | ConvertFrom-Json
foreach ($name in @("keeper", "miner")) {
  $id = $pids.$name
  if ($id) {
    try { Stop-Process -Id $id -Force -ErrorAction Stop; Write-Output "stopped $name pid $id" }
    catch { Write-Output "$name pid $id already gone" }
  }
}
Remove-Item $file -Force
