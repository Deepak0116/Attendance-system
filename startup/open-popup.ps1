<#
  Waits until the attendance app is up, then opens the small check-in window.
  Run automatically at Windows sign-in by install-startup.ps1.
#>
param([string]$Url = "http://localhost:5173/welcome")

$base = ([uri]$Url).GetLeftPart([UriPartial]::Authority)
$ready = $false
for ($i = 0; $i -lt 60; $i++) {          # wait up to ~2 minutes for the servers to start
    try {
        $r = Invoke-WebRequest "$base/api/health" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}
if (-not $ready) { exit 1 }

$browser = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { exit 1 }

# --app opens a small window without tabs or an address bar, like a popup
Start-Process -FilePath $browser -ArgumentList "--app=$Url", "--window-size=380,560", "--window-position=1500,300"
