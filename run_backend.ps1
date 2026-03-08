& "$PSScriptRoot\scripts\generate-dev-cert.ps1"

$backendDir = Join-Path $PSScriptRoot "backend"
$config = Get-Content (Join-Path $backendDir "config.json") -Raw | ConvertFrom-Json
$certFile = (Resolve-Path (Join-Path $backendDir $config.server.ssl.certFile)).Path
$keyFile = (Resolve-Path (Join-Path $backendDir $config.server.ssl.keyFile)).Path

Set-Location $backendDir

$pythonCommand = if (Test-Path "$PSScriptRoot\backend\venv\Scripts\python.exe") {
	"$PSScriptRoot\backend\venv\Scripts\python.exe"
} elseif (Test-Path "$PSScriptRoot\venv\Scripts\python.exe") {
	"$PSScriptRoot\venv\Scripts\python.exe"
} else {
	"python"
}

& $pythonCommand -m uvicorn app.main:app --reload --host $config.server.host --port $config.server.port --ssl-certfile $certFile --ssl-keyfile $keyFile
Set-Location $PSScriptRoot