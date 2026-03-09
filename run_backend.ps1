& "$PSScriptRoot\scripts\generate-dev-cert.ps1"

$backendDir = Join-Path $PSScriptRoot "backend"
$projectPath = Join-Path $backendDir "GraphCalc.Api\GraphCalc.Api.csproj"

Set-Location $backendDir
dotnet run --project $projectPath
Set-Location $PSScriptRoot