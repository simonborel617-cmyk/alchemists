# (Re)starts the watcher as a detached process (alerts: no ticks, keeper balance, pause, RPC). Stopgap for a PC;
# on a VPS use deploy/vps/alchemists-watch.service.
#   powershell -ExecutionPolicy Bypass -File scripts\run-watch.ps1 [-Net robinhood]
param([string]$Net = "robinhoodTestnet")
$root = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\lib\stop-owned.ps1"
Set-Location $root
$tag = if ($Net -eq "robinhood") { "mainnet" } else { "testnet" }
$file = "$root\.$tag-watch.json"
if (Test-Path $file) {
  $info = Get-Content $file -Raw | ConvertFrom-Json
  if ($info.watch -gt 0) { Write-Output ("old watcher: " + (Stop-Owned $info.watch "node" $info.startedAt)) }
}
$env:NET = $Net
$w = Start-Process -FilePath "node" -ArgumentList "scripts\watch.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\watch.$tag.log" -RedirectStandardError "$root\watch.$tag.err.log"
@{ watch = $w.Id; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 $file
Write-Output "watcher pid $($w.Id) net=$Net log=watch.$tag.log"
