// The build step of the demo on Vercel (package.json "vercel-build").
// Production deploys apply migrations first, on the direct connection. If
// that fails, the deploy stops, so new code never runs on an old schema.
// Migrations are add-only, so the code still serving meanwhile keeps working.
import { migrate } from '../src/db/migrate.js';

if (process.env.VERCEL_ENV === 'production') {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error('vercel-build: set DATABASE_URL_UNPOOLED for production deploys');
  const { applied } = await migrate(url);
  console.log(applied.length > 0 ? `Applied migration(s): ${applied.join(', ')}` : 'Schema is up to date.');
}
