# Community Events: Spec

This spec comes first. Code and tests follow it. When behavior changes, this file changes first.

"The brief" means the original product requirements this project starts from. The README quotes it.

## 1. Purpose

A platform for community events, such as local meetups.

- Organizers create events with a date, a time and a capacity limit.
- Attendees register for events, or cancel their registration.
- Administrators see all users and events. Managing users (suspend, change roles) comes later (section 12).
- Planned clients: web, iOS and Android, all on the same REST API (`/v1`). This build has only the web client (section 10).

Scope of this build: the backend workflow (section 13) and rules R1-R10 (section 3), plus a web client and a live demo (section 10).

## 2. Users and roles

| Role | Can do |
|---|---|
| Attendee | See events, register, cancel their own registration, see their own registrations |
| Organizer | See events, create events, change the capacity of their own events, and see who registered for them |
| Admin | See all users (with emails), all events (also past ones) and who registered for each event. Read-only in this build. |

One person can hold more than one role, for example organizer and attendee. The person can do everything that any of their roles allows.

## 3. Rules

| ID | Rule | Source | Who is hurt if this breaks | Test |
|---|---|---|---|---|
| R1 | Registrations never go above the event's capacity, even when many requests arrive at the same moment. | brief | An attendee shows up and has no seat. The organizer has more people than the room holds. | `R1 rejects registration when the event is full`, `R1 50 parallel registrations for 10 seats give exactly 10` |
| R2 | One active registration per attendee per event. Registering again returns the existing registration. | brief (implied) | One person takes two seats. A retry on a weak network books twice. | `R2 registering twice returns the same registration`, `R2 10 parallel requests by one person give one registration` |
| R3 | Cancelling frees the seat right away. Cancelling again changes nothing. | brief | A freed seat stays blocked. A repeated cancel frees two seats. | `R3 cancel frees the seat`, `R3 double cancel frees the seat only once`, `R3 can register again after cancelling` |
| R4 | After an event starts, new registrations and cancellations are rejected. | assumption | People join or leave an event that is already running. | `R4 rejects registration after the event starts`, `R4 rejects cancellation after the event starts` |
| R5 | Only organizers create events. An organizer changes only their own events. | brief | One organizer edits another organizer's event. | `R5 attendee cannot create an event`, `R5 organizer cannot change another organizer's event` |
| R6 | Only the event's organizer and admins see who registered. Only admins see other people's emails. | assumption (privacy) | Personal data leaks to other users. | `R6 attendee cannot see the attendee list`, `R6 no endpoint shows another user's email to an attendee` |
| R7 | Capacity can't be set below the number of people already registered. | assumption | Registered people lose their seat without notice. | `R7 rejects capacity below registered count` |
| R8 | Every `/v1` route except `/v1/health` needs an identity. A missing, malformed or unknown user id gets 401. | added | Anyone could change data without an identity. | `R8 request without identity gets 401`, `R8 unknown user gets 401` |
| R9 | The dev identity stub (section 9) runs only when `AUTH_MODE=dev-stub`. If `AUTH_MODE` is missing or has another value, the server refuses to start. | added | On a real deployment, anyone can act as any user. | `R9 server refuses to start without AUTH_MODE` |
| R10 | Input limits: title 3-80 characters, description up to 500, capacity 1-500, start time in the future and less than 1 year away, a valid IANA time zone. Unknown fields are rejected. | brief (exact limits added) | Bad or huge input breaks pages or fills the database. | `R10 rejects invalid event input` |

Source: `brief` = stated in the brief. `brief (implied)` = follows from the brief. `assumption` = a product choice (see also section 11). `added` = a safety rule the brief does not ask for.

Test names start with the rule ID, so `grep -rw R3 docs test` finds the rule and its tests.

## 4. Permissions

Each column shows one role alone. A person with two roles gets the rights of both.

| Action | Attendee | Organizer (owner) | Organizer (not owner) | Admin |
|---|---|---|---|---|
| List and view upcoming events | yes | yes | yes | yes |
| List past events (`scope=all`) | no | no | no | yes |
| Create an event | no | yes | yes | no |
| Change an event's capacity | no | yes | no | no |
| See who registered for an event | no | yes | no | yes |
| Register and cancel for themselves | yes | no | no | no |
| See their own registrations | yes | no | no | no |
| See all users (with emails) | no | no | no | yes |

All checks go through one function, `can(actor, action, resource)`. It denies by default. The actor always comes from the identity header (section 9), never from the request body.

## 5. Data model

**users**
- `id` uuid, `email` (unique), `name`, `roles` (a set of `organizer`, `attendee`, `admin`), `created_at`

**events**
- `id` uuid, `organizer_id` → users, `title`, `description` (optional)
- `starts_at` timestamptz (stored in UTC), `timezone` (IANA name, for example `America/New_York`)
- `capacity`, `registered_count` (starts at 0), `created_at`, `updated_at`
- `CHECK (capacity > 0)`
- `CHECK (registered_count BETWEEN 0 AND capacity)`

**registrations**
- `id` uuid, `event_id` → events, `attendee_id` → users
- `status` (`active` or `cancelled`), `created_at`, `cancelled_at`
- Partial unique index on `(event_id, attendee_id) WHERE status = 'active'`. A plain unique index would block registering again after a cancel.
- Rows are never deleted. A cancelled row stays as history. Registering again creates a new row.

## 6. API (`/v1`)

| Method | Path | Who | Success |
|---|---|---|---|
| GET | `/v1/health` | anyone | 200 `{status, db, identity}`. 503 with the same body if the database is down (not problem+json). |
| GET | `/v1/me` | any user | 200 the current user |
| GET | `/v1/users` | admin | 200 all users |
| GET | `/v1/events` | any user | 200 upcoming events, soonest first. Query: `organizer=me`, `scope=all` (admin only, includes past events), `limit` 1-50 (default 20) |
| POST | `/v1/events` | organizer | 201 the event, with a `Location` header |
| GET | `/v1/events/{id}` | any user | 200 the event |
| PATCH | `/v1/events/{id}` | the event's organizer | 200 the event. Body: `{capacity}` |
| GET | `/v1/events/{id}/registrations` | the event's organizer, admin | 200 active registrations: attendee name and time, no emails |
| PUT | `/v1/events/{id}/registrations/me` | attendee | 201 a new registration, or 200 if already registered. Safe to retry. |
| DELETE | `/v1/events/{id}/registrations/me` | attendee | 204, also when already cancelled or never registered. 404 if the event does not exist. Safe to retry. |
| GET | `/v1/me/registrations` | attendee | 200 my registrations (active and cancelled), newest first |
| GET | `/docs`, `/openapi.json` | anyone | Swagger UI and the OpenAPI contract |

`anyone` = no identity needed. `any user` = any known user (R8).

Every `/v1` response sends `Cache-Control: no-store`, so seat counts are never cached by a browser or a proxy.

**Event**

```json
{
  "id": "6f1c…",
  "title": "Board game night",
  "description": "Bring a game.",
  "startsAt": "2026-11-05T23:00:00.000Z",
  "timezone": "America/New_York",
  "capacity": 10,
  "registeredCount": 7,
  "seatsLeft": 3,
  "organizer": { "id": "…", "name": "Olivia Park" },
  "myRegistration": { "id": "…", "status": "active" }
}
```

`myRegistration` is `null` when the caller has no active registration.

**Create event** body: `{title, description?, startsAt, timezone, capacity}`. `startsAt` is ISO 8601 with an offset or `Z`. A time without an offset is rejected.

**Registration**

```json
{
  "id": "…",
  "eventId": "…",
  "attendeeId": "…",
  "status": "active",
  "createdAt": "2026-10-26T15:04:05.000Z",
  "cancelledAt": null
}
```

## 7. Errors

Every error uses one shape, `application/problem+json`. A conflict:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "code": "EVENT_FULL",
  "detail": "All 10 seats are taken."
}
```

A validation error adds `errors`:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "detail": "The request has invalid fields.",
  "errors": [{ "field": "capacity", "message": "Must be at least 1" }]
}
```

`errors` appears only for validation errors. Stack traces are never sent.

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad body, query or path value (for example a malformed UUID) |
| `UNAUTHENTICATED` | 401 | Missing, malformed or unknown identity (R8) |
| `FORBIDDEN` | 403 | The identity is known but not allowed (R5, R6, `scope=all` without the admin role) |
| `NOT_FOUND` | 404 | The event or the route does not exist |
| `EVENT_FULL` | 409 | No seats left (R1) |
| `EVENT_STARTED` | 409 | The event has started (R4) |
| `CAPACITY_BELOW_REGISTERED` | 409 | New capacity is below the registered count (R7) |
| `INTERNAL_ERROR` | 500 | Unexpected server error. The detail is generic. |

## 8. How the last seat stays safe

The seat count is kept in `events.registered_count`. It changes only inside these transactions.

**Register** (one transaction):
1. `INSERT INTO registrations … ON CONFLICT (event_id, attendee_id) WHERE status = 'active' DO NOTHING RETURNING *`.
   - If the insert fails with a foreign key error, the event does not exist: return `NOT_FOUND`.
   - If no row comes back, the person is already registered. Select the active registration and return it (200).
2. `UPDATE events SET registered_count = registered_count + 1 WHERE id = $1 AND registered_count < capacity AND starts_at > now() RETURNING *`.
   - If no row comes back, roll back. Read the event again: return `EVENT_STARTED` if it has started, otherwise `EVENT_FULL`.

**Cancel** (one transaction):
1. `UPDATE registrations SET status = 'cancelled', cancelled_at = now() WHERE event_id = $1 AND attendee_id = $2 AND status = 'active' RETURNING *`.
   - If no row comes back, check that the event exists: `NOT_FOUND` if not, otherwise 204 (nothing changes).
2. Only when a row changed: `UPDATE events SET registered_count = registered_count - 1 WHERE id = $1 AND starts_at > now() RETURNING id`.
   - If no row comes back, the event has started: roll back and return `EVENT_STARTED`.

**Capacity change:** `can()` first checks that the caller owns the event (`FORBIDDEN` if not). Then one `UPDATE events SET capacity = $2, updated_at = now() WHERE id = $1 AND organizer_id = $3 AND registered_count <= $2 RETURNING *`. The `organizer_id` condition is a second guard. If no row comes back, read the event again and return `NOT_FOUND` or `CAPACITY_BELOW_REGISTERED`.

Why this is safe:
- Under READ COMMITTED, a second `UPDATE` on the same event row waits for the first transaction to finish. Then it checks its `WHERE` again on the newest row. So the last seat goes to exactly one transaction.
- The same person sending two requests at once: the second `INSERT` waits for the first one's uncommitted row. If the first commits, the second hits the conflict, and its next statement sees the committed row and returns it. If the first rolls back (for example, the event was full), the second continues normally.
- Register and cancel both lock the registration row first, then the event row. The same order means no deadlocks.
- The `WHERE` guard gives users a clear `EVENT_FULL` error. The `CHECK` constraint is a backup if future code forgets the guard.
- "Check, then insert" (count the rows, then insert) is not used. Two requests can both see one free seat.

Other option: lock the event row with `SELECT … FOR UPDATE`, then count the active rows with `COUNT(*)`. This is also correct, but slower, because every request runs a count. It becomes the better choice if seat holds with an expiry time are added (section 12). An expired hold then stops counting by itself, with no cleanup job.

## 9. Identity in this build (dev stub)

- Real sign-in is not part of the brief. This build uses a stub (a simple stand-in for real sign-in): the client sends `X-Dev-User-Id: <user id>`.
- The stub accepts only users that exist in the database. There is no sign-up endpoint.
- It runs only with `AUTH_MODE=dev-stub` (R9). `/v1/health` reports `identity: "dev-stub"`.
- Permissions (section 4) are real and are checked on every request.
- Production plan: a managed identity provider issues tokens (JWT). The API checks them with the provider's public keys (JWKS). Roles come from our database, so a role change takes effect right away.

## 10. Web client and live demo (beyond the brief)

The brief does not require a frontend. The web client is built after the backend scope is complete. It lets a non-engineer try the rules in a browser.

| ID | Rule | How checked |
|---|---|---|
| W1 | The web client holds no business rules: no seat math, no role checks, no copied validation. It shows the server's answer in plain words. | A lint rule stops `web/` from importing anything from `src/`. The `spec-reviewer` agent checks every `web/` change. |
| W2 | The person switcher (the menu that picks a demo person) changes who you are, never what you may do. The server decides. | The web client only sends the identity header. The permission tests (R5, R6) prove the server decides. |
| W3 | Each run on the proof page ("Try to overbook it") creates its own event, so runs from different visitors never mix. | `W3 each proof run creates its own event` |
| W4 | The "No overbooking" badge shows only when three numbers equal the capacity: successful registrations, the event's `registeredCount`, and the active rows in the attendee list. This only displays numbers the server returned. It is not a business rule (W1). | `W4 badge shows only when all three counts equal the capacity` |
| W5 | The demo holds only seeded fake people (`@example.com`). It has no sign-up. A reset script (`scripts/demo-reset.ts`) wipes and re-seeds the data. | `W5 seed data holds only @example.com people` |

## 11. Assumptions

- Every known user (section 9) can see all upcoming events. Events are not private.
- Times are stored in UTC. Each event keeps its IANA time zone. Clients show the start time in the event's time zone.
- An event has a start time and no end time in this build.
- Capacity is limited to 500 by input validation. The database only requires a positive number.
- In this build, admins can read everything and change nothing.

## 12. Out of scope (for now)

- Real sign-up and sign-in
- Waitlists, paid tickets, seat holds
- Email, push or SMS notifications
- Organizations and companies (multi-tenant data)
- Editing event details other than capacity; an organizer cancelling an event
- Admin actions on users (suspend, change roles)
- Pagination beyond `limit`
- Native iOS and Android apps

## 13. Definition of done

**Brief scope** (git tag `brief-complete`):
- The brief's 4 workflow steps work through the API: an organizer creates an event, an attendee registers, a full event rejects new registrations, and a cancel frees the seat for someone else.
- R1-R6 and R8-R10 each have a passing test on real PostgreSQL. The concurrency tests use real parallel connections. (R7, capacity change, comes right after.)
- Errors use the shape and codes in section 7.
- CI is green.
- The README run steps work on a fresh clone.

**Full build:**
- R7 has a passing test.
- The committed `openapi/openapi.json` matches the code (CI checks this).
- W1-W5 are checked as their table in section 10 says.
- On the live demo, the proof page shows "No overbooking" on two runs in a row.

**End-to-end check:**

```bash
npm install
npm run db:up      # or set DATABASE_URL to any PostgreSQL 16
npm run migrate
npm test
```

Then start the API (`npm run dev`) and the web client (`npm --prefix web run dev`), open the proof page, and run "50 people, 10 seats" twice. Both runs must show exactly 10 seats taken and the "No overbooking" badge.
