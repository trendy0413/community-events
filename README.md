# Community Events

A REST API for community events: organizers create events with a capacity, attendees register and cancel, and the capacity holds even when many people register at the same moment. The same API also runs a jobsite supply flow: suppliers publish delivery slots, contractors order material to a jobsite, and exactly one driver takes each delivery job. A web client and a "Try to overbook it" page sit on top of it.

**Live demo** (fake data, nothing to install, reset every night): [community-events-web.vercel.app](https://community-events-web.vercel.app) · [Try to overbook it](https://community-events-web.vercel.app/proof) · [API docs](https://community-events-web.vercel.app/docs)

## What to check first

- **The seat limit is enforced by the database.** One conditional `UPDATE ... WHERE registered_count < capacity` plus a `CHECK` constraint ([the SQL](src/modules/registrations/repository.ts)). [The race tests](test/integration/registrations.test.ts) send 50 parallel registrations for 10 seats on real PostgreSQL, with a pool of 60 connections so the calls really overlap; [the lock-wait tests](test/integration/lock-wait.test.ts) show the second booking waiting for the first.
- **Retry-safe register and cancel.** A phone that resends on a weak network never books twice and never gets an error for a booking that worked: `PUT` and `DELETE` on `/v1/events/{id}/registrations/me` (R2, R3 tests in the same file, and [the dropped-connection tests](test/integration/registrations-retry.test.ts)).
- **One deny-by-default permission check.** Every `/v1` route except `/v1/health` calls `can()` ([src/auth/policy.ts](src/auth/policy.ts)); [a test](test/unit/policy.test.ts) checks every cell of the role-by-action table.
- **Every rule has a test, and the tests are tested.** CI fails if a SPEC rule has no test named after it, and [13 deliberate breaks](mutants/mutants.json) must each fail a test.
- **One driver per delivery job.** Ten drivers taking one job at once: exactly one gets it ([the supply tests](test/integration/supply.test.ts), [the SQL](src/modules/supply/repository.ts)). Slots never book more deliveries than they have, and a phone can resend an order safely.
- **No personal data can enter the demo.** No sign-up; only seeded `@example.com` people; the reset refuses a database with anyone else.

## Instructions for running the application

**One command, only Docker needed:**

```bash
docker compose up --build
```

Then open http://localhost:8080 (web client) or http://localhost:3000/docs (Swagger UI). It starts PostgreSQL, applies the migrations, loads fresh demo data, and starts the API and the web client. Stop with `docker compose down`. Each start resets the demo data in that database, which is the same one `npm run db:up` uses below.

**For development** you need **Node.js 24** and **PostgreSQL 16**:

```bash
npm install
npm run db:up      # PostgreSQL 16 in Docker on localhost:15432
npm run migrate    # create the tables
npm run seed       # demo people and events from seed/personas.json
npm run dev        # API on http://localhost:3000, Swagger UI on http://localhost:3000/docs
```

- **No Docker?** Put the connection string of any PostgreSQL 16 database in a `.env` file (see [.env.example](.env.example)) and skip `npm run db:up`.
- **Web client:** `npm --prefix web install`, then `npm --prefix web run dev` (http://localhost:5173, forwards `/v1` to the API).
- **Tests:** `npm test` (unit and integration; without a database it stops in seconds with a clear message and never skips), `npm run lint`, `npm run typecheck`, `npm run mutants`, and `npm --prefix web test`.
- **Nothing to set up:** [CI](.github/workflows/ci.yml) runs all of this on every push, including both Docker paths: `docker compose up --build` on a fresh clone with the live checks against it, and `db:up`, migrate, seed, test.

The integration tests use their own database (`<your database>_test`, created on the first run) and empty it at the start, so your dev data is never touched. `npm run demo:reset` wipes the dev database and seeds it again with some seats taken.

## The brief, item by item

| The brief asks | Where |
|---|---|
| An organizer creates an event with a date, time, and capacity limit | `POST /v1/events` · [events module](src/modules/events) · R5, R10 |
| An attendee registers for the event | `PUT /v1/events/{id}/registrations/me` · [registrations module](src/modules/registrations) · R2 |
| The system prevents registrations once capacity is reached | [The SQL](src/modules/registrations/repository.ts) · R1 race tests |
| An attendee can cancel their registration, making the spot available again | `DELETE /v1/events/{id}/registrations/me` · R3 |
| REST APIs | [SPEC section 6](docs/SPEC.md#6-api-v1) · [OpenAPI](openapi/openapi.json) · Swagger UI at `/docs` |
| A database or persistent data store | PostgreSQL 16 · [migrations/001_init.sql](migrations/001_init.sql) |
| Basic input validation and error handling | Zod on every route (R10) · one `problem+json` error shape ([SPEC section 7](docs/SPEC.md#7-errors)) |
| Describe role-based authorization (implementation not required) | Described in [ARCHITECTURE section 4](docs/ARCHITECTURE.md#4-how-the-user-types-access-the-system), and implemented: `can()` on every route |
| At least one automated test covering a critical workflow | [The brief's 4 steps over HTTP](test/integration/workflow.test.ts), plus the race tests |
| A high-level architecture diagram | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

## Key architecture and technology decisions

| Choice | Why |
|---|---|
| TypeScript, Node.js 24, Fastify 5 | One language with the web client and React Native later. Fastify is schema-first: one Zod schema validates, types and documents each route. |
| PostgreSQL 16, Kysely, plain SQL migrations | Transactions and constraints enforce the seat rule; the SQL that matters stays visible. |
| A counter with a conditional `UPDATE` | Exactly one request gets the last seat, with one short row lock and no retries ([SPEC section 8](docs/SPEC.md#8-how-the-last-seat-stays-safe)). |
| OpenAPI generated from the route schemas | Typed clients for web now, Swift and Kotlin later; CI fails if the contract drifts. |
| Spec first | [docs/SPEC.md](docs/SPEC.md) holds rules R1-R10, S1-S8 (jobsite supply), W1-W6 (web client) and O1-O3 (monitoring); test names start with the rule ID. |
| Light monitoring | Sentry for server errors, a request id on every log line, one uptime check and one count alert ([SPEC section 15](docs/SPEC.md#15-running-and-monitoring-beyond-the-brief)). No tracing or dashboards yet. |

More, with diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Assumptions, limitations and tradeoffs

- Registration and cancellation close when the event starts (R4). Capacity cannot drop below the seats taken (R7).
- Only the event's organizer and admins see who registered; only admins see other people's emails (R6).
- Events are public to every signed-in user. Times are stored in UTC and shown in the event's own time zone.
- Admins are read-only in this build.

| Not built on purpose | Why | When to add |
|---|---|---|
| Real sign-in | The brief: auth *"implementation is not required"*. A dev stub names the user; permissions are real. | Before any real user (managed login, ARCHITECTURE section 4) |
| Waitlists, paid tickets, seat holds | Not in the brief | When paid events arrive; holds change the seat SQL (SPEC section 8) |
| Notifications | Not in the brief | With a queue and an outbox table |
| Organizations (multi-company data) | Not in the brief | With the first business customer |
| Editing events beyond capacity; admin actions | Not in the brief; designed in ARCHITECTURE section 4 | With the admin screens |
| Mobile apps | The brief: *"A frontend or mobile application is not required."* | On the same contract |
| A startup check that every route has a policy action | The R6 and R8 tests already fail when a route the server answers is missing from their lists | If routes are added often |

## Authorization: what is real, what is stubbed

- **Real:** roles live in the database and are read on every request; `can()` decides every `/v1` route and denies by default; the acting user never comes from the request body.
- **Stubbed:** who the caller is. The client sends `X-Dev-User-Id` with a seeded user's id. The server refuses to start unless `AUTH_MODE=dev-stub` is set (R9), and `/v1/health` reports the stub.

## What I would prioritize before deploying to production

1. Managed sign-in with tokens verified at the API, MFA for admins. Today anyone can act as anyone.
2. Company-owned accounts, paid hosting tiers, separate staging and production databases, backups with a tested restore.
3. Monitoring: the MVP set is built and on for the live demo (Sentry errors, request ids, Sentry's uptime check on `/v1/health` every 20 minutes, and a count alert every 30 minutes, [monitor.yml](.github/workflows/monitor.yml)). For real users: a Sentry project per environment with an on-call route, and uptime checks every minute from more than one region.
4. Per-user rate limits and abuse protection.
5. Retention rules and in-app account deletion.

The full table, with what to add when: [ARCHITECTURE section 9](docs/ARCHITECTURE.md#9-demo-hosting-versus-production).

## Beyond the brief

The brief says a frontend is not required. The backend was finished first (git tag `brief-complete`). Then I added a web client and a proof page, so a non-engineer can check the seat and role rules in a browser. The web client holds no business rules: it shows what the server answered, and a lint rule stops it from importing the API's code. Delete `web/` and the backend does not change. The real product UI and the mobile apps belong to the design team.

## How I used AI

I built this with Claude Code (an AI coding agent). [CLAUDE.md](CLAUDE.md), [web/CLAUDE.md](web/CLAUDE.md) and [.claude/](.claude) are the setup it worked with: the invariants, a `/spec-change` skill (SPEC first, then a failing test named by rule ID, then the code), a `/verify` skill, a read-only `spec-reviewer` agent, and a hook that blocks edits to `.env` files, generated files and committed migrations.

- **I decided** the scope and the cut order, the rules and their wording, the product assumptions, the stack, and what is demo-only.
- **The AI drafted** the code, tests and docs, one commit per step, from the SPEC.
- **How I checked:** CI on every push, the rule-to-test check, the mutants, the reviewer agent on each core change, and live runs of the proof page.
- **Real corrections along the way:** the reviewer found that the demo reset's `TRUNCATE` contradicted "rows are never deleted" as the SPEC worded it, and that a seed test had been loosened (fixed in `f69bbda`); the first deploy failed three ways (Vercel picked the wrong entry file, an awaited `listen()` never returned, and an ES-module dependency could not be loaded; `4229f70`); and the mutant check first reported every mutant as surviving in CI because of terminal color codes (`96f56cf`).

## Time spent

From git timestamps (planning and the first spec draft before the first commit are not counted): the brief's scope, from the first commit to the `brief-complete` tag, took about 3.5 hours. The rest of the history is the client endpoints, the contract export, the demo, the web client and the docs.

## Where to look

| File | What it holds |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Rules R1-R10, S1-S8 and W1-W6 with their tests, permissions, API, errors, how the last seat stays safe |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diagrams, entities, access by role, stack, MVP vs later, production plan |
| [src/modules/registrations/repository.ts](src/modules/registrations/repository.ts) | The SQL that keeps the last seat safe |
| [test/integration/](test/integration) | Race, lock-wait, workflow, permission and privacy tests on real PostgreSQL |
| [openapi/openapi.json](openapi/openapi.json) | The API contract, generated from the route schemas |
| [web/](web) | The web client and the proof page |

## Evidence

From [CI run #38](https://github.com/trendy0413/community-events/actions/runs/40563671852) on commit `5106dc4`, 2026-10-27:

| Check | Result |
|---|---|
| API tests on PostgreSQL 16 (unit and integration, 21 files) | 143 passed |
| The same tests on the `docker-compose.yml` database (the README's Docker path) | 143 passed |
| `docker compose up --build` on a fresh checkout: page, script bundle, request id, smoke and count checks | passed |
| Mutants: deliberate breaks of R1-R7, S1, S3, S4 and O3 | 13 of 13 caught |
| Tests the SPEC lists by rule ID | 72 of 72 exist |
| OpenAPI contract | valid, matches the routes |
| Web client: lint (with the W1 rule), format, types, generated types, build | passed |
| Web logic tests (proof page, error wording, client) | 17 passed |
| Windows: lint, typecheck, contract, unit tests | 51 passed |

On the live demo the same day: the proof page gave 10 seats, 40 "full" and "No overbooking" on runs in a row; the cancel panel freed one seat once and gave it to exactly one of 39; all 20 permission checks matched the SPEC. After the supply release, the driver panel sent 10 drivers at one job: one got it, nine were told it was taken, and the order read back was claimed by the winner. The [nightly job](https://github.com/trendy0413/community-events/actions/workflows/demo-ops.yml) checks the live counts against the active registrations, resets the data, and checks again.
