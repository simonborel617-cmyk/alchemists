# Stops a process by a pid saved in one of the *-pid.json files, but only if it is still ours: Windows reuses pids, so a
# saved pid can belong to an unrelated program once our process has died. Ours = the expected process name and, when the
# file recorded one, a start time no earlier than the recorded launch.
function Stop-Owned([int]$Id, [string]$Name, $Since) {
  if ($Id -le 0) { return "no pid" }
  $p = Get-Process -Id $Id -ErrorAction SilentlyContinue
  if (-not $p) { return "pid $Id already gone" }
  if ($p.ProcessName -ne $Name) { return "pid $Id is now $($p.ProcessName), not our ${Name}: left alone" }
  if ($Since) { try { if ($p.StartTime -lt ([datetime]$Since).AddSeconds(-5)) { return "pid $Id started before our launch: left alone" } } catch {} }
  Stop-Process -Id $Id -Force -ErrorAction SilentlyContinue
  return "stopped $Name pid $Id"
}
