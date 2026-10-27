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
| R1 | Registrations never go above the event's capacity, even when many requests arrive at the same moment. | brief | An attendee shows up and has no seat. The organizer has more people than the room holds. | `R1 rejects registration when the event is full`, `R1 50 parallel registrations for 10 seats give exactly 10`, `R1 R3 mixed registers and cancels keep the count equal to the active rows`, `R1 R3 the brief workflow works over HTTP: create, register, full, cancel, register again`, `R1 50 parallel HTTP registrations for 10 seats give exactly 10`, `R1 a second booking waits for the first and is told full when the first commits`, `R1 a second booking waits for the first and gets the seat when the first rolls back` |
| R2 | One active registration per attendee per event. Registering again returns the existing registration. | brief (implied) | One person takes two seats. A retry on a weak network books twice. | `R2 registering twice returns the same registration`, `R2 10 parallel requests by one person give one registration`, `R2 parallel register and cancel by one person never return 500`, `R2 register retries when the same person's cancel commits in between`, `R2 register is retried once when the database connection drops` |
| R3 | Cancelling frees the seat right away. Cancelling again changes nothing. | brief | A freed seat stays blocked. A repeated cancel frees two seats. | `R3 cancel frees the seat`, `R3 double cancel frees the seat only once`, `R3 can register again after cancelling`, `R3 cancel is retried once when the database connection drops` |
| R4 | After an event starts, new registrations and cancellations are rejected. | assumption | People join or leave an event that is already running. | `R4 rejects registration after the event starts`, `R4 rejects cancellation after the event starts`, `R4 a booking that waits on a lock past the start is rejected` |
| R5 | Only organizers create events. An organizer changes only their own events. | brief | One organizer edits another organizer's event. | `R5 attendee cannot create an event`, `R5 organizer cannot change another organizer's event`, `R5 capacity change checks the owner again in SQL` |
| R6 | Only the event's organizer and admins see who registered. Only admins see other people's emails. | assumption (privacy) | Personal data leaks to other users. | `R6 attendee cannot see the attendee list`, `R6 no endpoint shows another user's email to an attendee`, `R6 no endpoint shows another user's email to an organizer` |
| R7 | Capacity can't be set below the number of people already registered, and can't be changed after the event starts. | assumption | Registered people lose their seat without notice. | `R7 rejects capacity below registered count`, `R7 rejects capacity change after the event starts`, `R7 capacity decrease racing registrations never overbooks`, `R7 capacity change retries when a cancel commits in between` |
| R8 | Every `/v1` route except `/v1/health` needs an identity. A missing, malformed or unknown user id gets 401. | added | Anyone could change data without an identity. | `R8 request without identity gets 401`, `R8 unknown user gets 401`, `R8 health answers without an identity` |
| R9 | The dev identity stub (section 9) runs only when `AUTH_MODE=dev-stub`. If `AUTH_MODE` is missing or has another value, the server refuses to start. | added | On a real deployment, anyone can act as any user. | `R9 server refuses to start without AUTH_MODE` |
| R10 | Input limits: title 3-80 characters, description up to 500, no NUL characters in either, capacity 1-500, start time in the future and less than 1 year away, a valid IANA time zone. Unknown fields are rejected. | brief (exact limits added) | Bad or huge input breaks pages or fills the database. | `R10 rejects invalid event input`, `R10 rejects invalid capacity change input` |

Source: `brief` = stated in the brief. `brief (implied)` = follows from the brief. `assumption` = a product choice (see also section 11). `added` = a safety rule the brief does not ask for.

Test names start with the rule ID, so `grep -rw R3 docs test` finds the rule and its tests. `npm run check:rules` checks this both ways: every rule has its tests, and every rule test is listed here.

The shared HTTP contract in sections 6 and 7 (one error shape, no caching) applies to every route, so it has no rule ID. The tests in `test/unit/http.test.ts` cover it.

## 4. Permissions

Each column shows one role alone. A person with two roles gets the rights of both.

| Action | Attendee | Organizer (owner) | Organizer (not owner) | Admin |
|---|---|---|---|---|
| List and view upcoming events | yes | yes | yes | yes |
| View one event by its id, also a past one | yes | yes | yes | yes |
| See their own profile (`/v1/me`) | yes | yes | yes | yes |
| List past events (`scope=past`) | no | no | no | yes |
| Create an event | no | yes | yes | no |
| Change an event's capacity | no | yes | no | no |
| See who registered for an event | no | yes | no | yes |
| Register and cancel for themselves | yes | no | no | no |
| See their own registrations | yes | no | no | no |
| See all users (with emails) | no | no | no | yes |

All checks go through one function, `can(actor, action, resource)`. It denies by default. The actor always comes from the identity header (section 9), never from the request body.

Rows outside R5 and R6 have no rule ID of their own. `test/unit/policy.test.ts` checks every cell of this table.

## 5. Data model

Data-model constraints have no rule ID of their own: they back up the rules in the database. `test/integration/schema.test.ts` covers each one.

**users**
- `id` uuid, `email`, `name`, `roles` (a set of `organizer`, `attendee`, `admin`, and the supply roles `supplier`, `contractor`, `driver` of section 14), `created_at`
- Emails are unique, ignoring upper and lower case.
- `roles` holds at least one role, and only these six.

**events**
- `id` uuid, `organizer_id` → users, `title`, `description` (optional)
- `starts_at` timestamptz (stored in UTC), `timezone` (IANA name, for example `America/New_York`)
- `capacity`, `registered_count` (starts at 0), `created_at`, `updated_at`
- `CHECK (capacity > 0)`
- `CHECK (registered_count BETWEEN 0 AND capacity)`

**registrations**
- `id` uuid, `event_id` → events, `attendee_id` → users
- `status` (`active` or `cancelled`), `created_at`, `cancelled_at`
- `cancelled_at` is set exactly when `status` is `cancelled`.
- Partial unique index on `(event_id, attendee_id) WHERE status = 'active'`. A plain unique index would block registering again after a cancel.
- Rows are never deleted. A cancelled row stays as history. Registering again creates a new row. A database trigger rejects any `DELETE` on registrations. The one exception is the demo reset (W5) and the test setup: they empty all tables in one `TRUNCATE`, so counts and rows reach zero together. One table is never emptied alone.
- The foreign keys from registrations to events and users use `ON DELETE RESTRICT`. The app never deletes events or users, so no delete can change the seat count behind the registration service.

## 6. API (`/v1`)

| Method | Path | Who | Success |
|---|---|---|---|
| GET | `/v1/health` | anyone | 200 `{status, db, identity}`. 503 with the same body if the database is down (not problem+json). |
| GET | `/v1/me` | any user | 200 the current user |
| GET | `/v1/users` | admin | 200 all users |
| GET | `/v1/events` | any user | 200 upcoming events, soonest first. Query: `organizer=me`, `scope=past` (admin only: started events, newest first), `limit` 1-50 (default 20) |
| POST | `/v1/events` | organizer | 201 the event, with a `Location` header |
| GET | `/v1/events/{id}` | any user | 200 the event |
| PATCH | `/v1/events/{id}` | the event's organizer | 200 the event. Body: `{capacity}` |
| GET | `/v1/events/{id}/registrations` | the event's organizer, admin | 200 active registrations: attendee name and time, no emails |
| PUT | `/v1/events/{id}/registrations/me` | attendee | 201 a new registration, or 200 if already registered. Safe to retry. |
| DELETE | `/v1/events/{id}/registrations/me` | attendee | 204, also when already cancelled or never registered. 404 if the event does not exist. Safe to retry. |
| GET | `/v1/me/registrations` | attendee | 200 my registrations (active and cancelled), newest first. Query: `limit` 1-50 (default 20) |
| GET | `/docs`, `/openapi.json` | anyone | Swagger UI and the OpenAPI contract |

`anyone` = no identity needed. `any user` = any known user (R8).

**Response schemas:** every `/v1` route declares a response schema. The server sends only the fields listed in it (an allow-list), so a new database column can never leak to clients.

**Changing `/v1`:** responses may gain fields, so clients must ignore fields they do not know. The contract (`openapi/openapi.json`) allows extra response fields for that reason. Removing or renaming a field, or changing its meaning, needs a new version. Request bodies are the other way round: unknown fields are rejected (R10). The R6 leak tests call every endpoint, as an attendee and as an organizer, and fail if a route the server answers is missing from their list.

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

**Create event** body: `{title, description?, startsAt, timezone, capacity}`.
- `startsAt` is an RFC 3339 date-time (the strict form of ISO 8601) with an offset or `Z`, for example `2026-11-05T18:00:00-05:00`. A time without an offset is rejected.
- `startsAt` is stored in UTC, whatever offset the client sent.
- `timezone` is stored with its standard spelling, so `america/new_york` becomes `America/New_York`. A current name is never replaced by an older alias (`Europe/Kyiv` stays `Europe/Kyiv`).
- An empty `description` is stored as `null`, the same as leaving it out.

**Attendee list** (`GET /v1/events/{id}/registrations`)

```json
{
  "registrations": [
    { "id": "…", "attendee": { "id": "…", "name": "Ana Silva" }, "registeredAt": "2026-10-26T15:04:05.000Z" }
  ]
}
```

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

**Event list** (`GET /v1/events`): `{"events": [Event, …]}`.
- By default: events that have not started, soonest first.
- `organizer=me`: only the caller's own events.
- `scope=past` (admins only): only events that have started, newest first. Upcoming and past events are separate lists, because in one list either kind could fill every row up to `limit` and hide the other.
- `limit`: 1-50, default 20. There are no pages beyond it (section 12).
- Unknown query parameters are rejected.

**Change capacity** (`PATCH /v1/events/{id}`): body `{"capacity": 1-500}`, nothing else. Answers the Event.

**My registrations** (`GET /v1/me/registrations`), active and cancelled, newest first, at most `limit` (1-50, default 20):

```json
{
  "registrations": [
    {
      "id": "…",
      "status": "cancelled",
      "createdAt": "2026-10-26T15:04:05.000Z",
      "cancelledAt": "2026-10-26T16:00:00.000Z",
      "event": { "id": "…", "title": "Board game night", "startsAt": "2026-11-05T23:00:00.000Z", "timezone": "America/New_York" }
    }
  ]
}
```

**Me** (`GET /v1/me`): `{"id", "name", "email", "roles"}`. **Users** (`GET /v1/users`, admins only): `{"users": [Me, …]}`.

**Health** (`GET /v1/health`): `{"status": "ok", "db": "ok", "identity": "dev-stub"}`. If the database does not answer: 503 with `"status": "unavailable", "db": "down"`.

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
  "errors": [{ "field": "capacity", "message": "Too small: expected number to be >=1" }]
}
```

`errors` appears only for validation errors. Stack traces are never sent.

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad body, query or path value (for example a malformed UUID) |
| `UNAUTHENTICATED` | 401 | Missing, malformed or unknown identity (R8) |
| `FORBIDDEN` | 403 | The identity is known but not allowed (R5, R6, S5, S6, `scope=past` without the admin role, another contractor's order, or any role that lacks the action in sections 4 and 14) |
| `NOT_FOUND` | 404 | The event, slot, order or route does not exist |
| `EVENT_FULL` | 409 | No seats left (R1) |
| `EVENT_STARTED` | 409 | The event has started (R4, R7) |
| `CAPACITY_BELOW_REGISTERED` | 409 | New capacity is below the registered count (R7) |
| `INTERNAL_ERROR` | 500 | Unexpected server error. The detail is generic. |

## 8. How the last seat stays safe

The seat count is kept in `events.registered_count`. It changes only inside these transactions. (The demo reset and the test setup remove events with their counts in one `TRUNCATE`, section 5.)

**Register** (one transaction):
1. `INSERT INTO registrations … ON CONFLICT (event_id, attendee_id) WHERE status = 'active' DO NOTHING RETURNING *`.
   - If the insert fails with a foreign key error, the event does not exist: return `NOT_FOUND`.
   - If no row comes back, the person is already registered. Select the active registration and return it (200).
   - If that select finds no active row, the same person's cancel committed in between. Roll back and run the whole transaction again, up to 3 attempts in total. A retry must never turn into a 500. (After 3 attempts, return `INTERNAL_ERROR`. That needs three cancels by the same person during one request, so it is not expected in practice.)
2. `UPDATE events SET registered_count = registered_count + 1 WHERE id = $1 AND registered_count < capacity AND starts_at > clock_timestamp() RETURNING id`.
   - If no row comes back, roll back. Read the event again: return `EVENT_STARTED` if it has started, otherwise `EVENT_FULL`.

**Cancel** (one transaction):
1. `UPDATE registrations SET status = 'cancelled', cancelled_at = now() WHERE event_id = $1 AND attendee_id = $2 AND status = 'active' RETURNING *`.
   - If no row comes back, check that the event exists: `NOT_FOUND` if not, otherwise 204 (nothing changes).
2. Only when a row changed: `UPDATE events SET registered_count = registered_count - 1 WHERE id = $1 AND starts_at > clock_timestamp() RETURNING id`.
   - If no row comes back, the event has started: roll back and return `EVENT_STARTED`.

**Capacity change:** `can()` first checks that the caller owns the event (`FORBIDDEN` if not). Then one `UPDATE events SET capacity = $2, updated_at = now() WHERE id = $1 AND organizer_id = $3 AND registered_count <= $2 AND starts_at > clock_timestamp() RETURNING id`. The `organizer_id` condition is a second guard. If no row comes back, read the event again and return the first reason that still holds: `NOT_FOUND`, `FORBIDDEN` (another owner), `EVENT_STARTED`, or `CAPACITY_BELOW_REGISTERED` (more people registered than the new capacity). If none holds, a cancel committed in between: run the `UPDATE` again, up to 3 attempts in total (then `INTERNAL_ERROR`, as for register).

Why this is safe:
- Under READ COMMITTED, a second `UPDATE` on the same event row waits for the first transaction to finish. Then it checks its `WHERE` again on the newest row. So the last seat goes to exactly one transaction.
- The same person sending two requests at once: the second `INSERT` waits for the first one's uncommitted row. If the first commits, the second hits the conflict, and its next statement sees the committed row and returns it. If the first rolls back (for example, the event was full), the second continues normally.
- Register and cancel both lock the registration row first, then the event row. The same order means no deadlocks.
- The start is compared with `clock_timestamp()`, the time of the check itself. `now()` is the time the transaction began, so a request that waited on a lock past the start would still get in (R4).
- The `WHERE` guard gives users a clear `EVENT_FULL` error. The `CHECK` constraint is a backup if future code forgets the guard.
- The count is kept by the registration service, not by a database trigger. Three things keep it equal to the active rows: it changes only in the transactions above, no delete can bypass them (`ON DELETE RESTRICT` and the no-delete trigger; only the demo reset and the test setup empty the tables, all at once, section 5), and every race test ends by checking that `registered_count` equals the number of active rows. A trigger is the upgrade path if more write paths appear.
- "Check, then insert" (count the rows, then insert) is not used. Two requests can both see one free seat.
- If the database connection drops during a register or a cancel, the service runs it once more. Both are idempotent, so this is safe. If the first try never committed, the retry does the work. If it did commit, the retry gets the same answer a client retry would: the existing registration (200), or nothing to cancel (204). A retry can never take a second seat or free one twice.

The rule tests R1-R4 cover these steps. The `NOT_FOUND` paths have no rule ID; `test/integration/registrations.test.ts` covers them too. The same-person race between register's insert and select needs exact timing, so `test/integration/registrations-retry.test.ts` forces it with a real cancel at that moment. `test/integration/events-retry.test.ts` does the same for a cancel between a failed capacity change and its read. `test/integration/lock-wait.test.ts` shows the first point below directly: it holds one booking's transaction open on the last seat, checks in `pg_blocking_pids` that a second booking is waiting for it, then commits or rolls back the first.

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
| W3 | Each run on the proof page ("Try to overbook it") creates its own event, or its own delivery slot and order for the driver race, so runs from different visitors never mix. | `W3 each proof run creates its own event`, `W3 each driver race creates its own slot and order` |
| W4 | The "No overbooking" badge shows only when three numbers equal the capacity: successful registrations, the event's `registeredCount`, and the active rows in the attendee list. This only displays numbers the server returned. It is not a business rule (W1). | `W4 badge shows only when all three counts equal the capacity` |
| W5 | The demo holds only seeded fake people (`@example.com`). It has no sign-up. A reset script (`npm run demo:reset`) wipes and re-seeds the data, then takes each seeded event's `crowdRegistrations` seats through the registration service, and places each seeded slot's orders (and the drivers' claims) through the supply service. It refuses a database that holds anyone outside the seed file. If taking the seats or placing the orders fails, run it again. | `W5 seed data holds only @example.com people`, `W5 demo reset refuses a database with people outside the seed file`, `W5 demo reset wipes the data and seeds it again` |
| W6 | The "Exactly one driver" badge on the proof page shows only when one claim got 200, every other claim got `409 JOB_TAKEN`, and the order read back is claimed by that same driver. Like W4, it only compares answers the server gave. | `W6 badge shows only when one driver got the job and the order read back is claimed by that driver` |

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
- W1-W6 are checked as their table in section 10 says.
- On the live demo, the proof page shows "No overbooking" on two runs in a row.

**End-to-end check:**

```bash
npm install
npm run db:up      # or set DATABASE_URL to any PostgreSQL 16
npm run migrate
npm test
```

Then start the API (`npm run dev`) and the web client (`npm --prefix web run dev`), open the proof page, and run "50 people, 10 seats" twice. Both runs must show exactly 10 seats taken and the "No overbooking" badge.

## 14. Jobsite supply (beyond the brief)

The same platform pattern, applied to construction supply: a contractor on a jobsite needs material, a local supplier delivers it, and a driver takes the delivery. It sits next to the events API and changes nothing in it. It reuses the brief's hard part twice: a limited capacity that holds under a rush (S1), and a job that exactly one driver can take (S4).

**Roles** (added to the role set of section 2):

| Role | Can do |
|---|---|
| Supplier | Publish delivery slots, see the orders in their own slots |
| Contractor | See slots, place an order in a slot, cancel their own order, see their own orders |
| Driver | See open delivery jobs and their own, claim a job, mark their own job delivered |

Admins also see every slot's orders. One person can hold several roles.

**A delivery slot** is a time window in which a supplier can make a fixed number of deliveries (`capacity`, for example one per truck). **An order** books one delivery in a slot: what to bring (`items`) and where (`jobsite`). Once booked, an order is also a **delivery job** that drivers can claim.

An order moves: `booked` → `claimed` (a driver took it) → `delivered`, or `booked` → `cancelled`.

### Rules

| ID | Rule | Source | Who is hurt if this breaks | Test |
|---|---|---|---|---|
| S1 | A slot never takes more orders than its capacity, even when many contractors order at the same moment. A slot that has started takes no new orders. | supply | A truck is promised to more jobsites than it can reach; a crew waits for material that never comes. | `S1 rejects an order when the slot is full`, `S1 50 parallel orders for 5 deliveries give exactly 5`, `S1 rejects an order after the slot starts` |
| S2 | Placing an order is safe to retry. The client names the order with its own id; sending the same order again (same contractor, slot, items and jobsite) returns it as it is now (200), even if it was cancelled since, and books nothing more. Any other use of an existing id is refused, so a changed body is never silently dropped. | supply | A phone on a jobsite with weak signal resends and books two deliveries. | `S2 sending the same order twice books it once`, `S2 10 parallel retries of one order book it once`, `S2 an order id cannot be reused for another order` |
| S3 | A contractor can cancel their own order until a driver claims it or the slot starts. The capacity comes back at once; cancelling again changes nothing. | supply | A driver drives to a jobsite that cancelled; a cancelled order keeps a truck blocked. | `S3 cancel frees the capacity once`, `S3 cannot cancel after a driver claimed the order`, `S3 rejects cancellation after the slot starts` |
| S4 | Exactly one driver gets each delivery job, even when many drivers claim it at the same moment, and a cancel and a claim at the same moment never both go through. The same driver claiming again keeps the job. A job can be taken until it is cancelled or delivered, also after its slot starts (a late truck still delivers); the open-jobs list shows only upcoming slots. | supply | Two drivers drive to the same jobsite, or none does because each thought the other had it. | `S4 10 drivers claiming one job at once: exactly one gets it`, `S4 the same driver claiming twice keeps the job`, `S4 a cancelled order cannot be claimed`, `S3 S4 a parallel cancel and claim: exactly one wins` |
| S5 | Only the driver who claimed a job can mark it delivered. Marking it again changes nothing. | supply | A delivery shows as done when nobody delivered it. | `S5 only the claiming driver can mark a job delivered` |
| S6 | Only suppliers publish slots, only contractors order, only drivers claim. A supplier sees orders only in their own slots. | supply | One supplier reads another supplier's customers and jobsites. | `S6 a contractor cannot publish a slot`, `S6 a supplier cannot see another supplier's orders`, `S6 only contractors can place an order`, `S6 only drivers can claim a job` |
| S7 | Privacy: no supply endpoint shows another user's email to a non-admin. A contractor sees only their own orders. Drivers see a job's items, jobsite and slot, never the contractor. | supply | Contact details of contractors leak to every driver and supplier. | `S7 no supply endpoint shows another user's email to a contractor, driver or supplier` |
| S8 | Input limits: slot title 3-80 characters, area 2-80, capacity 1-50, start in the future and less than 1 year away, a valid IANA time zone; order items 3-500, jobsite 3-200; no NUL characters; unknown fields rejected. | supply (exact limits added) | Bad or huge input breaks pages or fills the database. | `S8 rejects invalid slot input`, `S8 rejects invalid order input` |

`supply` = the construction-supply use case this section adds.

### Permissions

| Action | Contractor | Supplier (owner) | Supplier (other) | Driver | Admin |
|---|---|---|---|---|---|
| See slots | yes | yes | yes | yes | yes |
| Publish a slot | no | yes | yes | no | no |
| See a slot's orders | no | yes | no | no | yes |
| Place, cancel and list their own orders | yes | no | no | no | no |
| See jobs, claim a job, mark their own job delivered | no | no | no | yes | no |

`test/unit/policy.test.ts` checks every cell, as for section 4.

### Data model

- **delivery_slots:** `id`, `supplier_id` → users, `title`, `area`, `starts_at`, `timezone`, `capacity` (1 or more), `booked_count` (0 to capacity, `CHECK`), `created_at`.
- **orders:** `id` (chosen by the client, S2), `slot_id` → delivery_slots, `contractor_id` → users, `items`, `jobsite`, `status`, `driver_id` → users (set exactly when `claimed` or `delivered`), `created_at`, `claimed_at`, `delivered_at`, `cancelled_at` (each set exactly when the order reached that status).
- Orders are never deleted (a trigger rejects `DELETE`; foreign keys use `ON DELETE RESTRICT`), as for registrations. `booked_count` equals the number of orders in the slot that are not cancelled.

### API

| Method | Path | Who | Success |
|---|---|---|---|
| GET | `/v1/slots` | any user | 200 upcoming slots, soonest first. Query: `supplier=me`, `limit` 1-50 (default 20) |
| POST | `/v1/slots` | supplier | 201 the slot, with a `Location` header. Body: `{title, area, startsAt, timezone, capacity}` |
| GET | `/v1/slots/{id}` | any user | 200 the slot |
| GET | `/v1/slots/{id}/orders` | the slot's supplier, admin | 200 the slot's orders: contractor name, items, jobsite, status, driver name |
| PUT | `/v1/slots/{id}/orders/{orderId}` | contractor | 201 a new order, or 200 the same order again. Body: `{items, jobsite}`. 404 if the slot does not exist. Safe to retry. |
| DELETE | `/v1/orders/{orderId}` | the order's contractor | 204, also when already cancelled. 403 for another contractor's order, 404 if it does not exist. Safe to retry. |
| GET | `/v1/me/orders` | contractor | 200 my orders, newest first. Query: `limit` 1-50 (default 20) |
| GET | `/v1/jobs` | driver | 200 `{open, mine}`: jobs nobody has claimed in upcoming slots, and my claimed and delivered jobs; at most 50 in each list |
| PUT | `/v1/jobs/{orderId}/driver` | driver | 200 the job, now mine; also when it was already mine. Safe to retry. |
| PUT | `/v1/jobs/{orderId}/delivered` | the job's driver | 200 the job, delivered; also when it was already delivered. Safe to retry. |

A slot answers `{id, title, area, startsAt, timezone, capacity, bookedCount, deliveriesLeft, supplier: {id, name}}`. `deliveriesLeft` is `capacity - bookedCount`, computed by the server.

### Errors

Added to the codes of section 7:

| Code | Status | When |
|---|---|---|
| `SLOT_FULL` | 409 | The slot has no deliveries left (S1) |
| `SLOT_STARTED` | 409 | The slot has started: no new orders and no cancellations (S3) |
| `ORDER_ID_IN_USE` | 409 | The order id belongs to another contractor's or another slot's order (S2) |
| `ORDER_CLAIMED` | 409 | A driver has claimed the order, so it can no longer be cancelled (S3) |
| `JOB_TAKEN` | 409 | Another driver has claimed the job (S4) |
| `JOB_NOT_OPEN` | 409 | The order is cancelled or delivered, so it cannot be claimed (S4) |

### How the capacity and the job stay safe

The same mechanisms as section 8:

- **Order** (one transaction): `INSERT ... ON CONFLICT (id) DO NOTHING RETURNING`, then `UPDATE delivery_slots SET booked_count = booked_count + 1 WHERE id = $1 AND booked_count < capacity AND starts_at > clock_timestamp()`. If the insert returned nothing, the order exists: return it when it is the same contractor's order in the same slot (200), otherwise `ORDER_ID_IN_USE`. If the update matches no row, roll back and answer `SLOT_FULL` or `SLOT_STARTED`.
- **Cancel** (one transaction): `UPDATE orders SET status = 'cancelled' ... WHERE id = $1 AND contractor_id = $2 AND status = 'booked'`, then, only if a row changed, `booked_count - 1` on the slot, guarded by the slot's start. Lock order is the order row, then the slot row, as for registrations.
- **Claim:** one `UPDATE orders SET status = 'claimed', driver_id = $2 ... WHERE id = $1 AND status = 'booked' AND driver_id IS NULL`. Under READ COMMITTED a second claim waits for the first, re-checks its `WHERE`, and matches nothing. Then read the order: mine means 200 (a retry), another driver's means `JOB_TAKEN`, cancelled or delivered means `JOB_NOT_OPEN`.
- **Deliver:** one `UPDATE ... SET status = 'delivered' WHERE id = $1 AND driver_id = $2 AND status = 'claimed'`; if nothing matched, read the order to tell a retry (already delivered, 200) from someone else's job (`FORBIDDEN`).
- `CHECK` constraints back up each step: `booked_count` between 0 and capacity, and `driver_id` set exactly when the status is `claimed` or `delivered`.
