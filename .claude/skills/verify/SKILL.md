---
name: verify
description: Run every check in this repo (lint, typecheck, unit tests, database tests, OpenAPI drift, mutants, web checks and build) and report a short pass/fail table. Use before each commit and before saying a task is done.
---

# Verify

Run the checks in this order. Stop at the first failing check. Show the failing test names and the first error. Fix the cause, then run the checks again from step 1. Never fix a failure by weakening or skipping a test.

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:unit`
4. `npm test`. This needs PostgreSQL (`DATABASE_URL`, or `npm run db:up`). If it stops with the "needs PostgreSQL 16" message, report that. It is not a pass.
5. `npm run check:openapi`. It fails if the contract is not valid OpenAPI or `openapi/openapi.json` is out of date. If it is out of date, run `npm run openapi`, keep the new file and say so.
6. `npm run mutants` (needs PostgreSQL, like step 4). Every mutant must be caught by a test.
7. Only if `web/` exists: `npm --prefix web run lint`, `npm --prefix web run format:check`, `npm --prefix web run typecheck`, `npm --prefix web test`, `npm --prefix web run api:types` (then `git diff --exit-code web/src/api/schema.d.ts`: the generated types must match the contract), then `npm --prefix web run build`.

Report a table: check | result | notes. Name any check you did not run, and why.
