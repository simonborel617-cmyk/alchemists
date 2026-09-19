# Serves web/ on http://localhost:8788 as a detached process (pid in .web-pid.json). Independent of any editor or preview pane.
#   powershell -ExecutionPolicy Bypass -File scripts\run-web.ps1 [-Port 8788]
param([int]$Port = 8788)
$root = Split-Path -Parent $PSScriptRoot
$proc = Start-Process -FilePath "python" -ArgumentList @("-m", "http.server", "$Port", "-d", "$root\web", "--bind", "127.0.0.1") -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\web.out.log" -RedirectStandardError "$root\web.err.log"
@{ pid = $proc.Id; port = $Port; startedAt = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding utf8 "$root\.web-pid.json"
Write-Output "web server pid $($proc.Id) on http://localhost:$Port"
