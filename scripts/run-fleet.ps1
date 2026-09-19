# Starts the GPU orchestrator (scripts/gpu-miner.py) as a detached process driving hb-miner on several ssh boxes.
#   powershell -ExecutionPolicy Bypass -File scripts\run-fleet.ps1 -Boxes ssh3.vast.ai:19528,ssh9.vast.ai:19530 -MinersFile .env.miners
param(
  [Parameter(Mandatory=$true)][string[]]$Boxes,
  [string]$Net = "robinhoodTestnet",
  [string]$Key = "$env:USERPROFILE\.ssh\id_ed25519",
  [string]$Remote = "./hb-miner",
  [string]$MinersFile = ".env.miners"
)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
# -File passes "a,b" as one string: split on commas so both call styles work
$Boxes = @($Boxes | ForEach-Object { $_ -split "," } | Where-Object { $_ -ne "" })
Remove-Item "$root\gpu-stop.txt" -ErrorAction SilentlyContinue
$keyFwd = $Key -replace "\\", "/"
$argList = @("scripts\gpu-miner.py", "--net", $Net, "--miners-file", $MinersFile)
$boxCmds = @()
foreach ($b in $Boxes) {
  $parts = $b.Split(":")
  $h = $parts[0]; $port = $parts[1]
  # clear miner processes left on the box by a previous run (best effort)
  & ssh -i $keyFwd -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15 -p $port "root@$h" "pkill -x hb-miner; true" 2>$null | Out-Null
  $box = "ssh -i $keyFwd -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o BatchMode=yes -p $port root@$h $Remote"
  $boxCmds += $box
  $argList += @("--box", ('"' + $box + '"'))
}
$proc = Start-Process -FilePath "python" -ArgumentList $argList -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\gpu-miner.out.log" -RedirectStandardError "$root\gpu-miner.err.log"
@{ pid = $proc.Id; boxes = $boxCmds; net = $Net; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 "$root\.gpu-pid.json"
Write-Output "gpu orchestrator pid $($proc.Id) with $($Boxes.Count) box(es)"
