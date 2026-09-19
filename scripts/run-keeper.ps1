# (Re)starts the testnet keeper alone as a detached process; keeps the miner pid in .testnet-pids.json untouched.
#   powershell -ExecutionPolicy Bypass -File scripts\run-keeper.ps1 [-Reveal none|all|0xaddr,0xaddr]
param([string]$Reveal = "none", [string]$Net = "robinhoodTestnet")
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$file = "$root\.testnet-pids.json"
$minerPid = 0
if (Test-Path $file) {
  $info = Get-Content $file -Raw | ConvertFrom-Json
  $minerPid = [int]$info.miner
  if ($info.keeper -gt 0) { try { Stop-Process -Id $info.keeper -Force -ErrorAction Stop; Write-Output "stopped old keeper $($info.keeper)" } catch {} }
}
$env:NET = $Net
$env:KEEPER_REVEAL = $Reveal
if (-not $env:KEEPER_INTERVAL_MS) { $env:KEEPER_INTERVAL_MS = "10000" }
$keeper = Start-Process -FilePath "node" -ArgumentList "scripts\keeper.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\keeper.testnet.log" -RedirectStandardError "$root\keeper.testnet.err.log"
@{ keeper = $keeper.Id; miner = $minerPid; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 $file
Write-Output "keeper pid $($keeper.Id) reveal=$Reveal net=$Net"
