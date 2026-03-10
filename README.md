# GraphCalc

Starter implementation for the node-based factory calculator.

## Frontend
- Location: frontend/
- ReactFlow canvas with empty-by-default project and graph state
- API requests go through the Vite `/api` proxy in development
- Frontend build config is read from `CONFIG_JSON` when set, otherwise `config.json` at the repository root

## Backend
- Location: backend/
- FastAPI solver stub at /solve
- Runtime configuration is read from `CONFIG_JSON` when set, otherwise `config.json` at the repository root
- Persistence is stored in MongoDB, using the `graphcalc` database by default

### MongoDB connection modes
- `mongo.authenticationMode: "none"` for local instances without Mongo auth
- `mongo.authenticationMode: "password"` for username/password auth, with optional `allowNoAuthFallback` for mixed local setups
- `mongo.authenticationMode: "x509"` for MongoDB X.509 auth; this requires `mongo.tls.enabled: true`, a configured client certificate, and `mongo.username` set to the certificate subject/username
- `mongo.tls.enabled: true` uses TLS for the Mongo connection; with `verifyServerCertificate: true`, the backend verifies the remote server certificate and hostname against the machine trust store, so use the real DNS name in `mongo.host`
- `mongo.tls.clientCertificate` accepts either a `pfxFile`/`pfxPassword` pair or a PEM `certFile`/`keyFile` pair; relative paths are resolved from the directory containing the active config file
- `CONFIG_JSON` must be an absolute path when set
