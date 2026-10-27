# web/: guide for coding agents

The React web client and the proof page ("Try to overbook it"). It is a demo client for the API in `../src`. The rules it must follow are W1-W5 in `../docs/SPEC.md` section 10.

## Commands (run from the repo root)

```bash
npm --prefix web install
npm --prefix web run dev        # http://localhost:5173; forwards /v1, /docs and /openapi.json to the API on :3000
npm --prefix web run lint       # ESLint, including the W1 rule (no imports from ../src)
npm --prefix web run typecheck
npm --prefix web test           # logic tests (proof page counting and checks), no browser
npm --prefix web run build      # writes web/dist
npm run openapi                 # after an API contract change: regenerates src/api/schema.d.ts too
```

## Rules

- **No business rules (W1).** No seat math, no role checks, no copied validation. Show what the server answered. For example, show "Full" because `seatsLeft` is 0, and let the server reject a registration; never disable a button because of a rule.
- **Typed client only.** Every call goes through `src/api/client.ts` (generated from `openapi/openapi.json`). No hand-written `fetch`. No secrets or API URLs in the bundle: paths are relative.
- **Server errors in plain words.** Map each error code to text in one place, `src/api/problems.ts`. The text explains the server's answer; it never decides anything.
- **Identity is a header (W2).** The person switcher only changes the `X-Dev-User-Id` header. The server decides what that person may do.
- **Proof page (W3, W4).** Each run creates its own event. The "No overbooking" badge shows only when the successful registrations, the event's `registeredCount` and the attendee list all equal the capacity.
- **Generated files are not edited:** `src/components/ui/` (shadcn/ui; add components with `npx shadcn add <name>`) and `src/api/schema.d.ts`.
- **Accessibility and phones.** Phone-first layouts. Every control has a label and keyboard focus. Results that change use `aria-live`. Status uses text and color, never color alone. Respect reduced motion.
- No analytics, cookies or external requests. The demo stores only the chosen person, in localStorage.

## Map

```text
src/api/       client.ts (typed client, identity header), problems.ts (error text), queries.ts (TanStack Query hooks)
src/demo/      the seeded demo people, read from ../seed/personas.json
src/pages/     one file per screen
src/proof/     the proof page and its logic (tested in *.test.ts)
src/components/        app shell and shared pieces; ui/ is generated
```
