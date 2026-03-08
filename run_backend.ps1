& "$PSScriptRoot\scripts\generate-dev-cert.ps1"

Set-Location "$PSScriptRoot\backend"
$env:FRONTEND_ORIGINS = "https://localhost:5173,https://127.0.0.1:5173"

$pythonCommand = if (Test-Path "$PSScriptRoot\backend\venv\Scripts\python.exe") {
	"$PSScriptRoot\backend\venv\Scripts\python.exe"
} elseif (Test-Path "$PSScriptRoot\venv\Scripts\python.exe") {
	"$PSScriptRoot\venv\Scripts\python.exe"
} else {
	"python"
}

& $pythonCommand -m uvicorn app.main:app --reload --host localhost --port 8000 --ssl-certfile "$PSScriptRoot\certs\localhost-cert.pem" --ssl-keyfile "$PSScriptRoot\certs\localhost-key.pem"
Set-Location $PSScriptRoot