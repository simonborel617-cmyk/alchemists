# (Re)starts the keeper alone as a detached process; keeps the miner pid in .<tag>-pids.json untouched.
#   powershell -ExecutionPolicy Bypass -File scripts\run-keeper.ps1 [-Reveal none|all|0xaddr,0xaddr] [-Net robinhood]
# Testnet uses .testnet-pids.json and keeper.testnet.log, mainnet .mainnet-pids.json and keeper.mainnet.log.
param([string]$Reveal = "none", [string]$Net = "robinhoodTestnet")
$root = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\lib\stop-owned.ps1"
Set-Location $root
$tag = if ($Net -eq "robinhood") { "mainnet" } else { "testnet" }
$file = "$root\.$tag-pids.json"
$minerPid = 0
if (Test-Path $file) {
  $info = Get-Content $file -Raw | ConvertFrom-Json
  $minerPid = [int]$info.miner
  if ($info.keeper -gt 0) { Write-Output ("old keeper: " + (Stop-Owned $info.keeper "node" $info.startedAt)) }
}
$env:NET = $Net
$env:KEEPER_REVEAL = $Reveal
if (-not $env:KEEPER_INTERVAL_MS) { $env:KEEPER_INTERVAL_MS = "10000" }
$keeper = Start-Process -FilePath "node" -ArgumentList "scripts\keeper.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\keeper.$tag.log" -RedirectStandardError "$root\keeper.$tag.err.log"
@{ keeper = $keeper.Id; miner = $minerPid; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 $file
Write-Output "keeper pid $($keeper.Id) reveal=$Reveal net=$Net"
