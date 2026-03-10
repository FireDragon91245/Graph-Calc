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

### MongoDB connection modes
- `mongo.authenticationMode: "none"` for local instances without Mongo auth
- `mongo.authenticationMode: "password"` for username/password auth, with optional `allowNoAuthFallback` for mixed local setups
- `mongo.authenticationMode: "x509"` for MongoDB X.509 auth; this requires `mongo.tls.enabled: true`, a configured client certificate, and `mongo.username` set to the certificate subject/username
- `mongo.tls.enabled: true` uses TLS for the Mongo connection; with `verifyServerCertificate: true`, the backend verifies the remote server certificate and hostname against the machine trust store, so use the real DNS name in `mongo.host`
- `mongo.tls.clientCertificate` accepts either a `pfxFile`/`pfxPassword` pair or a PEM `certFile`/`keyFile` pair; relative paths are resolved from `backend/`
