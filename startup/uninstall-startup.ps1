$startup = [Environment]::GetFolderPath("Startup")
foreach ($name in "AstenLabs Servers", "AstenLabs Check-in Popup", "AstenLabs Attendance") {
    $link = Join-Path $startup "$name.lnk"
    if (Test-Path $link) { Remove-Item $link; Write-Host "Removed $name" }
}
