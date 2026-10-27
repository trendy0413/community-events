# Community Events API

A REST API for community events. Organizers create events with a capacity, attendees register and cancel, and the capacity holds even when many people register at the same moment.

**Status:** the backend scope of the brief is complete (git tag `brief-complete`). The architecture document, the web client and the full write-up follow.

The rules, the API contract and how the last seat stays safe are in [docs/SPEC.md](docs/SPEC.md).

## Instructions for running the application

You need **Node.js 24** and **PostgreSQL 16**.

```bash
npm install
npm run db:up      # PostgreSQL 16 in Docker on localhost:15432
npm run migrate    # create the tables
npm run seed       # 5 demo people and 3 events
npm run dev        # API on http://localhost:3000, Swagger UI on http://localhost:3000/docs
```

**No Docker?** Put the connection string of any PostgreSQL 16 database in a `.env` file instead (see [.env.example](.env.example)), and skip `npm run db:up`:

```bash
DATABASE_URL=postgres://user:password@host:5432/dbname
```

### Try it

There is no sign-up yet. A dev stand-in for sign-in picks a seeded person by id in the `X-Dev-User-Id` header ([SPEC section 9](docs/SPEC.md#9-identity-in-this-build-dev-stub)). In Swagger UI, paste an id under **Authorize**.

| Person | Role | Id |
|---|---|---|
| Olivia Park | organizer | `0d3c2f6e-1a1b-4c00-8a01-000000000001` |
| Ana Silva | attendee | `0d3c2f6e-1a1b-4c00-8a01-000000000003` |
| Ben Carter | attendee | `0d3c2f6e-1a1b-4c00-8a01-000000000004` |
| Ada Brooks | admin | `0d3c2f6e-1a1b-4c00-8a01-000000000005` |

The seeded event "Intro to pottery" has 2 seats. Ana and Ben take them, and then the event shows 0 seats left:

```bash
EVENT=6f1c0e2a-7b3d-4e00-9b02-000000000002
curl -i -X PUT http://localhost:3000/v1/events/$EVENT/registrations/me -H "X-Dev-User-Id: 0d3c2f6e-1a1b-4c00-8a01-000000000003"
curl -i -X PUT http://localhost:3000/v1/events/$EVENT/registrations/me -H "X-Dev-User-Id: 0d3c2f6e-1a1b-4c00-8a01-000000000004"
curl -i -X GET http://localhost:3000/v1/events/$EVENT -H "X-Dev-User-Id: 0d3c2f6e-1a1b-4c00-8a01-000000000001"
```

## Tests

```bash
npm test           # unit and integration tests; the integration tests need PostgreSQL 16
npm run test:unit  # tests that need no database
npm run lint       # ESLint, then the check that every rule in docs/SPEC.md has its tests
npm run typecheck
npm run check:openapi  # the committed contract is valid OpenAPI and matches the routes
```

- Without a database, `npm test` stops within seconds and says how to fix it. It never skips tests.
- The integration tests use their own database (`<your database name>_test`, created on the first run) and empty it at the start. Your dev data is never touched.
- Concurrency tests run on real PostgreSQL with real parallel connections, for example 50 registrations at once for 10 seats.

## Where to look

| File | What it holds |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Rules R1-R10 with the tests that prove them, permissions, API, errors |
| [src/modules/registrations/repository.ts](src/modules/registrations/repository.ts) | The SQL that keeps the last seat safe |
| [migrations/001_init.sql](migrations/001_init.sql) | The schema and its constraints |
| [test/integration/registrations.test.ts](test/integration/registrations.test.ts) | The race tests |
| [openapi/openapi.json](openapi/openapi.json) | The API contract, generated from the route schemas (`npm run openapi`). Clients are generated from it. |
| [CLAUDE.md](CLAUDE.md) | The guide for coding agents working on this repo |
