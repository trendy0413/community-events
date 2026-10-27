// Checks a running deployment from the outside: health, the read API, the
// docs, and that every event's stored count equals its active registrations
// (read as the admin). Run it against the live demo (SMOKE_URL) or a local
// server. Exits 1 on any problem.
import { loadSeedData } from '../src/db/seed.js';

const base = (process.env.SMOKE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const people = loadSeedData().people;
const idOf = (email: string) => {
  const person = people.find((p) => p.email === email);
  if (!person) throw new Error(`smoke: seed file has no ${email}`);
  return person.id;
};
const ADMIN = idOf('ada@example.com');
const ATTENDEE = idOf('ana@example.com');

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) problems.push(message);
};

async function get(path: string, as?: string): Promise<{ status: number; body: unknown; type: string }> {
  const response = await fetch(`${base}${path}`, { headers: as ? { 'X-Dev-User-Id': as } : {} });
  const type = response.headers.get('content-type') ?? '';
  return { status: response.status, type, body: type.includes('json') ? await response.json() : await response.text() };
}

interface EventView {
  id: string;
  title: string;
  registeredCount: number;
}

// A database that scales to zero can take a few seconds to wake.
let health = await get('/v1/health');
for (let attempt = 1; health.status !== 200 && attempt < 5; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  health = await get('/v1/health');
}
check(health.status === 200, `health answers 200 (got ${health.status})`);

const events = await get('/v1/events?limit=50', ATTENDEE);
const upcoming = (events.body as { events?: EventView[] }).events ?? [];
check(events.status === 200 && upcoming.length > 0, `an attendee sees upcoming events (${upcoming.length})`);

const docs = await get('/docs');
check(docs.status === 200 && docs.type.includes('html'), 'Swagger UI answers at /docs');
const contract = await get('/openapi.json');
check(contract.status === 200 && (contract.body as { openapi?: string }).openapi === '3.1.0', 'the contract answers');

const past = await get('/v1/events?scope=past&limit=50', ADMIN);
const all = [...upcoming, ...((past.body as { events?: EventView[] }).events ?? [])];
let drift = 0;
for (const event of all) {
  const list = await get(`/v1/events/${event.id}/registrations`, ADMIN);
  const rows = (list.body as { registrations?: unknown[] }).registrations?.length ?? -1;
  if (list.status !== 200 || rows !== event.registeredCount) {
    drift++;
    console.log(`FAIL ${event.title}: count ${event.registeredCount}, active rows ${rows} (status ${list.status})`);
  }
}
check(drift === 0, `every event's count equals its active registrations (${all.length} events)`);

if (problems.length > 0) {
  console.error(`\n${problems.length} check(s) failed at ${base}`);
  process.exitCode = 1;
}
