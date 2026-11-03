$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$install = Join-Path $env:LOCALAPPDATA "QBIT Extension"
$extensionTarget = Join-Path $install "extension"
New-Item -ItemType Directory -Force -Path $extensionTarget | Out-Null
Copy-Item -Path (Join-Path $source "extension\*") -Destination $extensionTarget -Recurse -Force
Copy-Item -LiteralPath (Join-Path $source "qbit-console.ps1") -Destination $install -Force
Copy-Item -LiteralPath (Join-Path $source "start-qbit-console.bat") -Destination $install -Force

$protocol = "Registry::HKEY_CURRENT_USER\Software\Classes\qbit-console"
New-Item -Path $protocol -Force | Out-Null
Set-Item -Path $protocol -Value "URL:QBIT Console Protocol"
New-ItemProperty -Path $protocol -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
$commandKey = Join-Path $protocol "shell\open\command"
New-Item -Path $commandKey -Force | Out-Null
$bat = Join-Path $install "start-qbit-console.bat"
$command = '"{0}\System32\cmd.exe" /d /c ""{1}" %1"' -f $env:SystemRoot, $bat
Set-Item -Path $commandKey -Value $command

Write-Host "QBIT Extension quedó instalada en:" -ForegroundColor Green
Write-Host "  $extensionTarget"
Write-Host "El botón Conectar IA de QBIT abrirá la consola local." -ForegroundColor Green
Write-Host "En Chrome, activá Modo de desarrollador > Cargar descomprimida y seleccioná esa carpeta." -ForegroundColor Yellow
$chromeCandidates = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if ($chromeCandidates) {
  Start-Process -FilePath $chromeCandidates[0] -ArgumentList "chrome://extensions"
  Start-Process -FilePath $chromeCandidates[0] -ArgumentList "https://gotti23b.github.io/QBIT/"
} else {
  Start-Process "https://gotti23b.github.io/QBIT/"
}
Write-Host ""
Write-Host "Cuando la extensión esté cargada, hacé clic en Conectar IA en QBIT." -ForegroundColor Cyan
Read-Host "Presioná Enter para cerrar el instalador"
