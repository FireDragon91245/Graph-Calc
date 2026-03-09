# C# Backend Upgrade Plan

## What We Are Doing

This project is migrating the current Python backend to a single ASP.NET Core application written in C#. The goal is to keep the backend simple and consolidated while improving throughput, reliability, and maintainability.

The new backend will use:

- ASP.NET Core hosting with a single project and the built-in `Program.cs` startup model.
- Minimal API endpoints for the simple CRUD and auth-style routes.
- Dependency injection for shared services such as persistence, authentication, and solver orchestration.
- MongoDB.Driver for fully async database access.
- Google OR-Tools `linear_solver` in C# for the graph solver.
- The native .NET thread pool for CPU-bound solver execution.
- Cancellation tokens threaded through every request to avoid stuck work and reduce deadlock risk.
- Native ASP.NET Core authentication/authorization middleware instead of hand-rolled request auth checks.
- ASP.NET Core rate limiting to protect the solver from abuse and request spikes.

This is not a redesign of the product. The intent is to preserve the existing HTTP contract and behavior while replacing the Python implementation with a C# implementation that is better aligned with async I/O, multithreaded execution, and built-in platform features.

## Upgrade Checklist

### 1. Foundation

- [x] Create a single ASP.NET Core Web API project for the entire backend.
- [x] Use the built-in hosting model with a single `Program.cs` entrypoint.
- [x] Add strongly typed configuration for server, auth, cookies, MongoDB, TLS, solver concurrency, and timeout settings.
- [x] Keep the current HTTP contract stable so the frontend does not need to change during the migration.
- [x] Add structured logging and request correlation at startup.

### 2. Core Packages

- [x] Add `MongoDB.Driver` for persistence.
- [x] Add Google OR-Tools for C# with `linear_solver` support.
- [x] Add ASP.NET Core authentication and authorization packages.
- [x] Add ASP.NET Core rate limiting middleware.
- [x] Add Swagger/OpenAPI for route verification during migration.

### 3. Hosting and Middleware

- [x] Configure HTTPS and CORS to match the current frontend origins.
- [x] Add centralized exception handling with consistent JSON error responses.
- [x] Enable native ASP.NET Core authentication middleware.
- [x] Enable native ASP.NET Core authorization middleware.
- [x] Add rate limiting policies, with stricter limits on solver endpoints than CRUD endpoints.
- [x] Ensure every request uses `HttpContext.RequestAborted` as the base cancellation token.

### 4. Models and Contracts

- [x] Port all current request and response models from Python to C# DTOs.
- [x] Preserve field names and JSON shapes for auth, projects, graphs, store, and solver responses.
- [x] Configure JSON serialization to match the current API behavior.
- [ ] Add input validation for required fields and invalid payloads.

### 5. Authentication and Session Management

- [x] Implement cookie-based authentication using native ASP.NET Core middleware.
- [x] Preserve the existing login, logout, session, and account lifecycle behavior.
- [x] Port password hashing to PBKDF2 using .NET cryptography primitives.
- [x] Preserve `sessionVersion`-style invalidation so password changes revoke older sessions.
- [x] Restrict all protected routes through ASP.NET Core auth policies, leaving only register/authenticate anonymous.

### 6. MongoDB Persistence

- [x] Port the current persistence layer to async services using `MongoDB.Driver`.
- [x] Recreate collections for users, workspaces, projects, graphs, and settings.
- [x] Recreate the existing indexes during startup.
- [x] Port legacy import and migration logic into application startup.
- [x] Replace whole-collection load/save patterns with targeted async reads and writes.
- [x] Pass `CancellationToken` to every MongoDB operation.

### 7. Minimal API CRUD Endpoints

- [x] Implement Minimal API endpoints for auth routes.
- [x] Implement Minimal API endpoints for account/profile routes.
- [x] Implement Minimal API endpoints for project CRUD and activation.
- [x] Implement Minimal API endpoints for graph CRUD and activation.
- [x] Implement Minimal API endpoints for graph load/save.
- [x] Implement Minimal API endpoints for store load/save.
- [x] Keep endpoint handlers thin and move reusable logic into injected services.

### 8. Solver Service Design

- [x] Port the solver into a DI-managed service inside the same ASP.NET Core project.
- [x] Expose the solver through an interface such as `ISolverService`.
- [x] Split solver logic into internal stages: graph normalization, SCC/cycle analysis, LP model construction, solve execution, and result extraction.
- [x] Preserve the current solver behavior before attempting performance tuning or refactoring.
- [ ] Add tests for disconnected graphs, recipe tags, mixed ports, constrained inputs, constrained outputs, and cycle handling.

### 9. Thread Pool and Throughput

- [x] Use the native .NET thread pool for CPU-bound solver execution.
- [x] Keep CRUD endpoints fully async and non-blocking.
- [x] Use a bounded concurrency mechanism such as `SemaphoreSlim` or `Channel` for solver execution so solver traffic cannot overwhelm the process.
- [x] Keep solver concurrency configurable based on available hardware.
- [x] Separate async MongoDB work from CPU-bound solver execution so request threads are not pinned unnecessarily.

### 10. Cancellation and Deadlock Prevention

- [x] Accept a `CancellationToken` on every endpoint.
- [x] Pass cancellation through all service and repository methods.
- [x] Respect cancellation before queueing solver work, before starting solver work, and after solver completion boundaries.
- [x] Add per-request timeout handling for solver requests.
- [x] Return a clear timeout or cancellation response when work is aborted.
- [x] Avoid sync-over-async, `.Result`, `.Wait()`, and blocking coordination primitives in request code.

### 11. Rate Limiting and Abuse Protection

- [x] Add a baseline global rate limiter for authenticated API traffic.
- [x] Add a stricter per-user and per-IP rate limiter for the solver endpoint.
- [x] Return `429 Too Many Requests` responses when limits are exceeded.
- [x] Add rate limiting for anonymous auth attempts to reduce brute force abuse.
- [ ] Log rate limiter hits so solver spam is observable.

### 12. Solver Reliability Safeguards

- [ ] Add metrics for solver queue depth, active solver count, and solve duration.
- [ ] Add logs for infeasible, unbounded, timed out, canceled, and failed solver runs.
- [x] Add guards for malformed graphs and empty solver inputs before invoking OR-Tools.
- [ ] Verify that concurrent solver requests do not share mutable state incorrectly.
- [ ] Confirm that solver service lifetime and dependencies are safe under concurrent load.

### 13. Testing and Verification

- [ ] Add integration tests for CRUD endpoints against a test MongoDB instance.
- [ ] Add auth tests for register, authenticate, session, logout, password change, and account deletion.
- [ ] Add solver parity tests against representative graphs from the current Python implementation.
- [ ] Add cancellation tests to confirm client disconnects and timeouts stop request processing cleanly.
- [ ] Add load tests for mixed CRUD and solver traffic.

### 14. Migration Execution

- [x] Port models and configuration first.
- [x] Port auth and MongoDB persistence second.
- [x] Port CRUD endpoints third.
- [x] Port solver logic fourth.
- [ ] Run the C# backend against the existing frontend in development until endpoint parity is acceptable.
- [ ] Cut over only after CRUD parity, solver parity, cancellation behavior, and load testing are verified.

### 15. Definition of Done

- [x] The backend is a single ASP.NET Core project.
- [x] All current backend routes exist and preserve the existing contract.
- [x] MongoDB persistence is fully async.
- [x] Authentication uses native ASP.NET Core middleware.
- [x] The solver runs through DI using bounded thread-pool-backed execution.
- [x] Cancellation tokens are threaded through the full request path.
- [x] Rate limiting is active, especially for solver requests.
- [ ] Integration, parity, cancellation, and load tests pass.
- [ ] The frontend works against the new C# backend without contract changes.