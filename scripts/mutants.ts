// Breaks the code on purpose, one rule at a time (mutants/mutants.json), and
// runs the tests for that rule. Every mutant must make a test fail; one that
// survives means the rule could break with all tests green. The source file
// is always restored, and its content is compared afterwards.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const root = path.resolve(import.meta.dirname, '..');
const VITEST = path.join(root, 'node_modules/vitest/vitest.mjs');
const Mutants = z.array(
  z.object({
    id: z.string(),
    rule: z.string(),
    breaks: z.string(),
    file: z.string(),
    find: z.string().min(1),
    replace: z.string(),
    tests: z.array(z.string()).min(1),
    pattern: z.string(),
  }),
);
const mutants = Mutants.parse(JSON.parse(readFileSync(path.join(root, 'mutants/mutants.json'), 'utf8')));
const only = process.argv.slice(2);

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const ESCAPE_CODE = new RegExp(String.raw`\u001b\[[0-9;]*m`, 'g');
let failures = 0;

for (const mutant of mutants.filter((m) => only.length === 0 || only.includes(m.id))) {
  const file = path.join(root, mutant.file);
  const original = readFileSync(file, 'utf8');
  // Code that changed shape must fail here, not pass by mutating nothing.
  if (original.split(mutant.find).length !== 2) {
    console.error(`ERROR   ${mutant.id} ${mutant.rule}: the code to break is not in ${mutant.file} exactly once`);
    failures++;
    continue;
  }
  let caught: boolean;
  let output: string;
  try {
    writeFileSync(file, original.replace(mutant.find, mutant.replace));
    // Vitest runs through node itself, with no shell, so the -t pattern keeps
    // its trailing space ("R1 " must not also match R10).
    const args = [VITEST, 'run', ...mutant.tests, ...(mutant.pattern ? ['-t', mutant.pattern] : [])];
    const run = spawnSync(process.execPath, args, {
      cwd: root,
      // No colors: escape codes inside the summary line would hide the count.
      env: { ...process.env, AUTH_MODE: 'dev-stub', NO_COLOR: '1', FORCE_COLOR: '0' },
      encoding: 'utf8',
      // A failing test prints its diff; the default 1 MB buffer can cut the output.
      maxBuffer: 64 * 1024 * 1024,
    });
    output = `${run.stdout}\n${run.stderr}`.replaceAll(ESCAPE_CODE, '');
    caught = run.status === 1 && /Tests\s+\d+ failed/.test(output);
  } finally {
    writeFileSync(file, original);
  }
  if (hash(readFileSync(file, 'utf8')) !== hash(original)) throw new Error(`mutants: ${mutant.file} was not restored`);
  console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${mutant.id} ${mutant.rule}: ${mutant.breaks}`);
  if (!caught) {
    failures++;
    // The end of the test run says why: tests passed, or they did not run.
    console.log(output.trimEnd().split('\n').slice(-12).join('\n'));
  }
}

process.exitCode = failures > 0 ? 1 : 0;
