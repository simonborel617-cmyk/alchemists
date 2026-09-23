# Assembles the miner release after a deploy: rebuilds alchemists-miner.exe from scripts/gpu-miner.py, copies the CUDA
# hasher, the README and deployments/<net>.json, writes SHA256SUMS and prints the gh command for a DRAFT release.
# It publishes nothing: the owner reviews the folder and runs the printed command.
#   powershell -ExecutionPolicy Bypass -File scripts\release-miner.ps1 -Version v1.0.0 [-Net robinhood]
param([Parameter(Mandatory = $true)][string]$Version, [string]$Net = "robinhood")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$dep = "deployments\$Net.json"
if (-not (Test-Path $dep)) { throw "$dep is missing: deploy first, then commit the deployment record" }
$d = Get-Content $dep -Raw | ConvertFrom-Json
Write-Output "deployment: $Net chain $($d.chainId), Mine $($d.contracts.Mine)"

python -m PyInstaller --onefile --noconfirm --name alchemists-miner --distpath dist --workpath build/pyi --specpath build scripts/gpu-miner.py | Out-Null
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
if (-not (Test-Path "dist\hb-miner-linux-x64")) { throw "dist\hb-miner-linux-x64 is missing (build it with miner/build-dist.sh on a CUDA box)" }

$out = "dist\release-$Version"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force "$out\deployments" | Out-Null
Copy-Item "dist\alchemists-miner.exe", "dist\hb-miner-linux-x64" $out
Copy-Item "dist\README-miner.md" "$out\README.md"
Copy-Item "scripts\gpu-miner.py" "$out\gpu-miner.py"
Copy-Item $dep "$out\deployments\$Net.json"
$sums = foreach ($f in @("alchemists-miner.exe", "hb-miner-linux-x64", "gpu-miner.py", "deployments\$Net.json")) {
  $h = (Get-FileHash -Algorithm SHA256 "$out\$f").Hash.ToLower(); "$h  $($f -replace '\','/')"
}
$sums | Set-Content -Encoding ascii "$out\SHA256SUMS"
& "$out\alchemists-miner.exe" --help | Select-Object -First 3
Write-Output ""
Write-Output "release folder: $out"
Get-ChildItem -Recurse $out | Where-Object { -not $_.PSIsContainer } | ForEach-Object { "  {0,-40} {1,12:N0} bytes" -f $_.FullName.Substring((Resolve-Path $out).Path.Length + 1), $_.Length }
Write-Output ""
Write-Output "review, then (also copy gpu-miner.py into orchestrator/ of the alchemists-miner repo and push):"
Write-Output "gh release create $Version -R simonborel617-cmyk/alchemists-miner --draft --title `"$Version, Robinhood Chain mainnet`" --notes-file dist\README-miner.md $out\alchemists-miner.exe $out\hb-miner-linux-x64 $out\SHA256SUMS $out\deployments\$Net.json"
