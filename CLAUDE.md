# community-events: guide for coding agents

Event registration platform: a Fastify + PostgreSQL REST API, plus a React web client in `web/`.
Business rules (R1-R10, the supply flow's S1-S8, W1-W6, monitoring O1-O3) and the API contract live in `docs/SPEC.md`. Read it before changing behavior.

## Commands

```bash
docker compose up --build # everything: database, setup, API on :3000, web client on :8080 (only Docker needed)
npm install
npm --prefix web install   # web client dependencies
npm run db:up              # PostgreSQL 16 in Docker on localhost:15432 (or set DATABASE_URL to any PostgreSQL 16)
npm run migrate            # apply migrations/*.sql
npm run seed               # demo people and events
npm run demo:reset         # wipe and re-seed; refuses a database with people outside the seed file
npm run smoke              # check a running server from outside (SMOKE_URL, default the local API)
npm run check:counts       # O3: every stored count equals its rows; exits 1 if not (the monitor workflow runs it)
npm run dev                # API on http://localhost:3000, Swagger UI at /docs
npm test                   # all tests; without PostgreSQL it stops within seconds with a "needs PostgreSQL 16" message (it never skips)
npm run test:unit          # tests that need no database
npm run lint               # ESLint, then the rule-to-test check (strict: every test the SPEC lists must exist)
npm run check:rules        # SPEC rule IDs vs test names; `npm run check:rules -- --strict` also fails on missing tests
npm run typecheck
npm run openapi            # export openapi/openapi.json from the route schemas, then regenerate web/src/api/schema.d.ts
npm run check:openapi      # fail if openapi/openapi.json is not valid OpenAPI or is out of date (CI runs this)
npm run mutants            # breaks each rule in mutants/mutants.json on purpose; a test must catch every one
npm --prefix web run dev   # web client on http://localhost:5173 (proxies /v1 to the API)
npm --prefix web run lint  # web lint, including the W1 rule (no imports from src/)
npm --prefix web test      # web logic tests
npm --prefix web run build # production web build into web/dist
```

`npm run dev` and the test scripts set `AUTH_MODE=dev-stub`. Without it the server refuses to start (R9).

## Code map

```text
src/http/app.ts          buildApp(): plugins, routes, error handler (used by tests and the server)
src/server.ts            starts the server; also the entry file Vercel detects
src/config.ts            reads and checks environment variables
src/db/                  pg pool and Kysely instance, table types, migration runner, seed
seed/personas.json       fixed fake demo people, the proof crowd and events
src/auth/devAuth.ts      dev identity stub (X-Dev-User-Id header)
src/auth/policy.ts       can(actor, action, resource), deny by default
src/http/errors.ts       domain errors -> application/problem+json
src/http/schemas.ts      shared Zod schemas (problem shape, event id param, list limit)
src/http/openapi.ts      OpenAPI components: schemas named with .meta({ id }), unused ones dropped
src/http/v1.ts           the /v1 scope: identity check, then the module routes
src/observability/       Sentry start-up (only src/server.ts imports it; tests pass their own reporter)
src/db/count-drift.ts    the O3 count check
src/modules/<feature>/   routes.ts, service.ts, repository.ts, schemas.ts
migrations/*.sql         schema changes, add-only
Dockerfile, docker-compose.yml   the one-command local stack; web/Dockerfile and web/nginx.conf serve the client
.github/workflows/       ci.yml, demo-ops.yml (nightly reset), monitor.yml (uptime and count alert)
vercel.json              demo API on Vercel; its build runs scripts/vercel-build.ts (migrations)
web/vercel.json          demo web client, a second Vercel project that forwards /v1, /docs, /openapi.json to the API
scripts/                 repo tooling, for example the rule-to-test check
test/unit/               no database
test/integration/        real PostgreSQL
web/                     React client; has its own CLAUDE.md
```

## Invariants (never break)

- **R1 seat limit lives in SQL:** `UPDATE events ... WHERE registered_count < capacity`, backed by `CHECK (registered_count BETWEEN 0 AND capacity)`. Never count rows and then insert.
- `registered_count` changes only in the registrations module (`src/modules/registrations/`), inside a transaction that its service opens. Cancel lowers it only when a registration row actually changed (R3).
- Registrations are never deleted. Their foreign keys use `ON DELETE RESTRICT`, so no delete can change the seat count behind the registration service. The same holds for orders (SPEC section 14). Only the demo reset and the test setup empty tables, all of them in one `TRUNCATE`; never empty one alone.
- The same for the jobsite supply flow (SPEC section 14): `delivery_slots.booked_count` changes only in `src/modules/supply/`, inside the service's transactions, guarded by `booked_count < capacity` and its `CHECK`; a delivery job is taken by one conditional `UPDATE ... WHERE driver_id IS NULL`.
- Lock order in every transaction: the registration (or order) row first, then the event (or slot) row.
- Every `/v1` route except `/v1/health` goes through `can()`. The acting user comes from the identity header, never from the body.
- Errors use the problem+json shape and the codes in SPEC section 7.
- `web/` holds no business rules (W1).
- Generated files are regenerated, never edited: `openapi/openapi.json`, `web/src/api/schema.d.ts`.
- Committed migrations are never edited. Add a new migration instead.

## Workflow (spec-driven)

Behavior changes: run `/spec-change`. It guides you through these steps: SPEC first, a failing test named by rule ID, the smallest change, `/verify`, the `spec-reviewer` agent, one commit.
Before saying any task is done, run `/verify`. Each commit must pass all checks on its own.

## Testing rules

- Integration tests use their own database (`<dev database>_test`, created automatically, or `TEST_DATABASE_URL`) and empty it at the start. They never touch the dev data in `DATABASE_URL`.
- Database tests run on real PostgreSQL. Never use SQLite, PGlite or mocks for concurrency tests: they run writes one at a time, so a race test would pass for the wrong reason.
- Race tests: the pool must be larger than the number of parallel calls. Assert totals (successes, failures, final counts), never timing.
- Every race test ends by checking that `registered_count` equals the number of active rows for that event.
- Never weaken, skip or delete a test to make a change pass. Fix the cause.

## Code style

- TypeScript strict. No `any`, no `@ts-ignore`.
- Validate all input with Zod in the route schemas. After that, trust the types.
- Every `/v1` route declares a response schema too. The server sends only its fields (an allow-list), so a new column never leaks.
- Route handlers stay thin: parse, call the service, map the result.
- Comments state constraints and reasons ("why"), not what the next line does. Comments never name people or refer to meetings or chats.
- Commit messages: `type: summary` or `type(scope): summary` (types: `feat`, `fix`, `test`, `docs`, `chore`, `db`, `ci`, `deploy`, `ops`), then the reason in the body.

## Done means

- SPEC updated if behavior changed.
- A test named by rule ID covers each behavior change.
- `/verify` passes (lint, typecheck, all tests, plus mutants and the web build when they exist).
- `npm run openapi` run if the contract changed (CI fails when `openapi/openapi.json` is out of date).
- README and `docs/ARCHITECTURE.md` updated if a fact they state changed.

## Don't

- Don't read or write `.env` files, and don't add secrets to code. New variables go in `.env.example`.
- Don't add demo-only API routes. Demo data changes go through `scripts/`.
- Don't add dependencies without a reason in the commit message.
