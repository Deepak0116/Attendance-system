<#
  Sets this computer up so that, every time you sign in to Windows:
    1. the attendance servers start in the background, and
    2. the small check-in window opens.
  Usage (normal PowerShell, no admin needed):
      .\install-startup.ps1
      .\install-startup.ps1 -Url "https://attendance.yourcompany.com/welcome"   # if the app runs on a server
  Remove with .\uninstall-startup.ps1
#>
param([string]$Url = "http://localhost:5173/welcome")

$startup = [Environment]::GetFolderPath("Startup")
$shell = New-Object -ComObject WScript.Shell
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function New-StartupLink([string]$name, [string]$script, [string]$extra = "") {
    $sc = $shell.CreateShortcut((Join-Path $startup "$name.lnk"))
    $sc.TargetPath = $ps
    $sc.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" $extra"
    $sc.WorkingDirectory = $PSScriptRoot
    $sc.WindowStyle = 7   # minimised
    $sc.Save()
    Write-Host "Installed: $name"
}

# Only start the local servers when the app address is this computer.
if (([uri]$Url).IsLoopback) {
    New-StartupLink "AstenLabs Servers" (Join-Path $PSScriptRoot "start-servers.ps1")
}
New-StartupLink "AstenLabs Check-in Popup" (Join-Path $PSScriptRoot "open-popup.ps1") "-Url `"$Url`""
Write-Host "Done. The check-in window will open the next time you sign in to Windows."
