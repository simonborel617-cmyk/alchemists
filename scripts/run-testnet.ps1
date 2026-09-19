# Starts the CPU miner (and the keeper unless -NoKeeper) as detached processes; PIDs go to .testnet-pids.json.
# The keeper needs its own funded KEEPER_KEY in .env, otherwise it collides with the miner on nonces.
param([switch]$NoKeeper)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:NET = "robinhoodTestnet"
if (-not $env:KEEPER_INTERVAL_MS) { $env:KEEPER_INTERVAL_MS = "10000" }

$keeper = $null
if (-not $NoKeeper) {
  $keeper = Start-Process -FilePath "node" -ArgumentList "scripts\keeper.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$root\keeper.testnet.log" -RedirectStandardError "$root\keeper.testnet.err.log"
}
$miner = Start-Process -FilePath "node" -ArgumentList "scripts\miner.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\miner.testnet.log" -RedirectStandardError "$root\miner.testnet.err.log"

$kid = if ($keeper) { $keeper.Id } else { 0 }
@{ keeper = $kid; miner = $miner.Id; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 "$root\.testnet-pids.json"
Write-Output "keeper pid $kid, miner pid $($miner.Id); logs in $root"
