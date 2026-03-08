& "$PSScriptRoot\scripts\generate-dev-cert.ps1"
Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
npm --prefix "$PSScriptRoot\frontend" run dev