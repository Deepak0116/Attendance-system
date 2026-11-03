<#
  Starts the Asten Labs attendance backend (port 8000) and frontend (port 5173) in the background.
  Safe to run more than once: a server that is already listening is left alone.
  Run automatically at Windows sign-in by install-startup.ps1.
#>
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

function Test-Port([int]$port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Port 8000)) {
    $py = Join-Path $backend ".venv\Scripts\python.exe"
    Start-Process -FilePath $py -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
        -WorkingDirectory $backend -WindowStyle Hidden
}

if (-not (Test-Port 5173)) {
    $npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npx) { $npx = "C:\Program Files\nodejs\npx.cmd" }
    if (-not (Test-Path (Join-Path $frontend "dist\index.html"))) {
        Start-Process -FilePath $npx -ArgumentList "vite", "build" -WorkingDirectory $frontend -WindowStyle Hidden -Wait
    }
    # preview serves the production build (stable, no dev tooling) and forwards /api to the backend
    Start-Process -FilePath $npx -ArgumentList "vite", "preview", "--port", "5173", "--strictPort" `
        -WorkingDirectory $frontend -WindowStyle Hidden
}
