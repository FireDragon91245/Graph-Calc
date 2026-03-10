# GraphCalc
A node based fully configurable node based factory planer/calculator using a linear solver.

# Config & Building
By default you configure runtime and build time in a single `config.json` by default the `config.json` is searched for in the projekt root.
You can manually override `config.json` location by setting `CONFIG_JSON` environment variable.

example config.json:
```json
{
  "server": {
    "host": "localhost",
    "port": 8000,
    "frontendOrigins": [
      "https://localhost:5173",
      "https://127.0.0.1:5173"
    ],
    "logRequests": false,
    "ssl": {
      "certFile": "../certs/localhost-cert.pem",
      "keyFile": "../certs/localhost-key.pem"
    }
  },
  "auth": {
    "jwtAlgorithm": "HS256",
    "jwtTtlSeconds": 604800,
    "passwordHashIterations": 200000,
    "defaultSessionVersion": 1,
    "cookie": {
      "name": "graphcalc_session",
      "httpOnly": true,
      "secure": true,
      "sameSite": "lax",
      "path": "/"
    }
  },
  "mongo": {
    "host": "localhost",
    "port": 27017,
    "authenticationMode": "none",
    "username": "",
    "password": "",
    "authDatabase": "graphcalc",
    "database": "graphcalc",
    "allowNoAuthFallback": true,
    "tls": {
      "enabled": false,
      "verifyServerCertificate": true,
      "checkCertificateRevocation": true,
      "clientCertificate": {
        "pfxFile": "",
        "pfxPassword": "",
        "certFile": "",
        "keyFile": ""
      }
    }
  },
  "solver": {
    "maxConcurrency": 2,
    "requestTimeoutSeconds": 5,
    "queueLimit": 32
  },
  "caching": {
    "sweepIntervalSeconds": 15,
    "entryIdleTtlSeconds": 300,
    "dirtyWriteBackSeconds": 30
  },
  "rateLimiting": {
    "global": {
      "authRequestsPerMinute": 120,
      "solveRequestsPerMinute": 40,
      "guestSolveRequestsPerMinute": 20,
      "crudRequestsPerMinute": 2000
    },
    "perUserOrIp": {
      "authRequestsPerMinute": 20,
      "solveRequestsPerMinute": 8,
      "guestSolveRequestsPerMinute": 4,
      "crudRequestsPerMinute": 300
    }
  }
}
```

### Windows:
Run backend with:
```ps1
./run_backend.ps1
```
Run frontent with:
```ps1
./run.ps1
```

### Linux/Mac:
First generate self signed certificates for dev, make sure to configure the relative or absoulute path in `config.json`

#### Run frontent with:
```bash
npm --prefix $PATH_TO_FRONTENT run dev
```
so from the project root:
```bash
npm --prefix ./frontend run dev
```

#### Run backend with:
```bash
dotnet run --project $PATH_TO_BACKEND_API_PROJECT
```
so from the project root:
```bash
dotnet run --project ./backend/GraphCalc.Api/GraphCalc.Api.csproj
```

## Backend
The backend is written in c# using ASP.NET using a MongoDB database using Google OR-Tools linear solver for solving.

## Frontent
The Frontent is a React + React-Flow Vite app.
