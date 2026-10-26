# community-events: guide for coding agents

Event registration platform: a Fastify + PostgreSQL REST API, plus a React web client in `web/`.
Business rules (R1-R10, W1-W5) and the API contract live in `docs/SPEC.md`. Read it before changing behavior.

## Commands

```bash
npm install
npm --prefix web install   # web client dependencies
npm run db:up              # PostgreSQL 16 in Docker on localhost:15432 (or set DATABASE_URL to any PostgreSQL 16)
npm run migrate            # apply migrations/*.sql
npm run seed               # demo people and events
npm run dev                # API on http://localhost:3000, Swagger UI at /docs
npm test                   # all tests; without PostgreSQL it stops within seconds with a "needs PostgreSQL 16" message (it never skips)
npm run test:unit          # tests that need no database
npm run lint               # ESLint, then the rule-to-test check
npm run check:rules        # SPEC rule IDs vs test names; `npm run check:rules -- --strict` also fails on missing tests
npm run typecheck
npm run openapi            # export openapi/openapi.json and regenerate web/src/api/schema.d.ts
npm run mutants            # only if mutants/ exists: each mutant must be caught by a test
npm --prefix web run dev   # web client on http://localhost:5173 (proxies /v1 to the API)
npm --prefix web run build # production web build
```

`npm run dev` and the test scripts set `AUTH_MODE=dev-stub`. Without it the server refuses to start (R9).

## Code map

```text
src/app.ts               buildApp(): plugins, routes, error handler (used by tests and the server)
src/server.ts            starts the server; also the entry file Vercel detects
src/config.ts            reads and checks environment variables
src/db/                  pg pool and Kysely instance, table types, migration runner, seed
seed/personas.json       fixed fake demo people and events
src/auth/devAuth.ts      dev identity stub (X-Dev-User-Id header)
src/auth/policy.ts       can(actor, action, resource), deny by default
src/http/errors.ts       domain errors -> application/problem+json
src/modules/<feature>/   routes.ts, service.ts, repository.ts, schemas.ts
migrations/*.sql         schema changes, add-only
scripts/                 repo tooling, for example the rule-to-test check
test/unit/               no database
test/integration/        real PostgreSQL
web/                     React client; has its own CLAUDE.md
```

## Invariants (never break)

- **R1 seat limit lives in SQL:** `UPDATE events ... WHERE registered_count < capacity`, backed by `CHECK (registered_count BETWEEN 0 AND capacity)`. Never count rows and then insert.
- `registered_count` changes only in the registrations module (`src/modules/registrations/`), inside a transaction that its service opens. Cancel lowers it only when a registration row actually changed (R3).
- Registrations are never deleted. Their foreign keys use `ON DELETE RESTRICT`, so no delete can change the seat count behind the registration service.
- Lock order in every transaction: the registration row first, then the event row.
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
- OpenAPI regenerated if the contract changed.
- README and `docs/ARCHITECTURE.md` updated if a fact they state changed.

## Don't

- Don't read or write `.env` files, and don't add secrets to code. New variables go in `.env.example`.
- Don't add demo-only API routes. Demo data changes go through `scripts/`.
- Don't add dependencies without a reason in the commit message.
