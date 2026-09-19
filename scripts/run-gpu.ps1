# Starts the GPU orchestrator (scripts/gpu-miner.py) as a detached process driving hb-miner on a Vast box.
#   powershell -ExecutionPolicy Bypass -File scripts\run-gpu.ps1 -SshHost ssh9.vast.ai -Port 30596
#   ... -Net robinhoodTestnet -Key C:\Users\fortu\.ssh\id_ed25519
param(
  [string]$SshHost = "ssh9.vast.ai",
  [int]$Port = 30596,
  [string]$Net = "robinhoodTestnet",
  [string]$Key = "$env:USERPROFILE\.ssh\id_ed25519",
  [string]$Remote = "./hb-miner",
  [string]$MinersFile = ""
)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$keyFwd = $Key -replace "\\", "/"
$box = "ssh -i $keyFwd -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o BatchMode=yes -p $Port root@$SshHost $Remote"
# clear miner processes left on the box by a previous run (best effort)
& ssh -i $keyFwd -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15 -p $Port "root@$SshHost" "pkill -x hb-miner; pkill -x hb-miner-linux-x64; true" 2>$null | Out-Null
$args = @("scripts\gpu-miner.py", "--net", $Net, "--box", ('"' + $box + '"'))
if ($MinersFile -ne "") { $args += @("--miners-file", $MinersFile) }
$p = Start-Process -FilePath "python" -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\gpu-miner.out.log" -RedirectStandardError "$root\gpu-miner.err.log"
@{ pid = $p.Id; box = $box; net = $Net; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 "$root\.gpu-pid.json"
Write-Output "gpu orchestrator pid $($p.Id) -> $box"
