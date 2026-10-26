---
name: verify
description: Run every check in this repo (lint, typecheck, unit tests, database tests, OpenAPI drift, mutants, web build) and report a short pass/fail table. Use before each commit and before saying a task is done.
---

# Verify

Run the checks in this order. Stop at the first failing check. Show the failing test names and the first error. Fix the cause, then run the checks again from step 1. Never fix a failure by weakening or skipping a test.

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:unit`
4. `npm test`. This needs PostgreSQL (`DATABASE_URL`, or `npm run db:up`). If it stops with the "needs PostgreSQL 16" message, report that. It is not a pass.
5. Only if `openapi/` exists: `npm run openapi`, then `git diff --exit-code openapi/ web/src/api/`. Any change means the committed contract was out of date: keep the new files and say so.
6. Only if `mutants/` exists: `npm run mutants`. Every mutant must be caught by a test.
7. Only if `web/` exists: `npm --prefix web run build`.

Report a table: check | result | notes. Name any check you did not run, and why.
