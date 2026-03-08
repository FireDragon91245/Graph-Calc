# GraphCalc

Starter implementation for the node-based factory calculator.

## Frontend
- Location: frontend/
- ReactFlow canvas with empty-by-default project and graph state
- API requests go through the Vite `/api` proxy in development

## Backend
- Location: backend/
- FastAPI solver stub at /solve
- Runtime configuration lives in `backend/config.json`
- Persistence is stored in MongoDB, using the `graphcalc` database by default
