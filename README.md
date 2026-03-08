# GraphCalc

Starter implementation for the node-based factory calculator.

## Frontend
- Location: frontend/
- ReactFlow canvas with starter nodes
- API base URL via VITE_API_URL (defaults to http://localhost:8000)

## Backend
- Location: backend/
- FastAPI solver stub at /solve
- Persistence is stored in MongoDB, using the `graphcalc` database by default
- Runtime connection can be overridden with `MONGO_URI` and `MONGO_DB_NAME`

## Data
- Sample recipes at data/recipes.json
