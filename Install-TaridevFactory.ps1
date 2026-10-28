param([switch]$SkipNpm)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Taridev Factory 2.0 - instalación local" -ForegroundColor Cyan
foreach ($cmd in @("node","npm","git","opencode")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Falta $cmd. Instálalo y vuelve a ejecutar el instalador."
  }
}
node --version
opencode --version
if (-not $SkipNpm) { npm install; if ($LASTEXITCODE -ne 0) { throw "npm install falló" } }
Write-Host "Instalación lista. Ejecuta: npm run dev" -ForegroundColor Green
Write-Host "Abre: http://127.0.0.1:5173"
