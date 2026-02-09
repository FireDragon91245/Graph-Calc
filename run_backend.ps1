Set-Location .\backend
python -m uvicorn app.main:app --reload --port 8000
Set-Location ..