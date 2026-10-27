// Writes the OpenAPI contract that the route schemas produce to
// openapi/openapi.json. Clients are generated from the committed file, so
// with --check this fails instead of writing when the file is out of date
// (CI runs it that way). Both modes first check that the contract is valid
// OpenAPI with every $ref resolved: client generators reject anything else.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Validator } from '@seriousme/openapi-schema-validator';
import { buildApp } from '../src/http/app.js';
import { createDb } from '../src/db/client.js';

const OUT = new URL('../openapi/openapi.json', import.meta.url);
const OUT_NAME = 'openapi/openapi.json';

async function generate(): Promise<string> {
  // Building the app opens no database connection, so this URL is never used.
  const db = createDb('postgres://unused@127.0.0.1:1/unused');
  const app = await buildApp({ db, authMode: 'dev-stub', logLevel: 'silent' });
  try {
    await app.ready();
    return `${JSON.stringify(app.swagger(), null, 2)}\n`;
  } finally {
    await app.close();
    await db.destroy();
  }
}

async function problemsWith(contract: string): Promise<string | null> {
  const validator = new Validator();
  const result = await validator.validate(JSON.parse(contract) as Record<string, unknown>);
  if (result.valid) return null;
  return typeof result.errors === 'string' ? result.errors : JSON.stringify(result.errors, null, 2);
}

/** The first line where two texts differ, 1-based, for a useful CI message. */
function firstDifference(a: string, b: string): { line: number; committed: string; generated: string } {
  const left = a.split('\n');
  const right = b.split('\n');
  let line = 0;
  while (line < left.length && left[line] === right[line]) line++;
  return { line: line + 1, committed: left[line] ?? '(end of file)', generated: right[line] ?? '(end of file)' };
}

const contract = await generate();
const invalid = await problemsWith(contract);

if (invalid !== null) {
  console.error(`The generated contract is not valid OpenAPI, so ${OUT_NAME} was not changed:\n${invalid}`);
  process.exitCode = 1;
} else if (process.argv.includes('--check')) {
  // A checkout that turned LF into CRLF holds the same contract.
  const committed = await readFile(OUT, 'utf8').then(
    (text) => text.replaceAll('\r\n', '\n'),
    () => null,
  );
  if (committed === null) {
    console.error(`${OUT_NAME} is missing. Run \`npm run openapi\` and commit it.`);
    process.exitCode = 1;
  } else if (committed !== contract) {
    const diff = firstDifference(committed, contract);
    console.error(
      [
        `${OUT_NAME} does not match the route schemas. Run \`npm run openapi\` and commit the result.`,
        `First difference, line ${String(diff.line)}:`,
        `  committed: ${diff.committed.trim()}`,
        `  generated: ${diff.generated.trim()}`,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log(`${OUT_NAME} matches the route schemas.`);
  }
} else {
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, contract);
  console.log(`Wrote ${OUT_NAME}.`);
}
