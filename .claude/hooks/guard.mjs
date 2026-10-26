#!/usr/bin/env node
// PreToolUse hook for Edit and Write.
// Blocks edits that would break repo invariants. Exit code 2 blocks the tool
// call and sends stderr back to the agent, so it can take the right path.
// process.exitCode is used instead of process.exit() so stderr is flushed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const GENERATED = ['openapi/openapi.json', 'web/src/api/schema.d.ts'];

main();

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    // A guard that cannot read its input must not block all edits.
    process.stderr.write('guard: could not parse hook input; edit not checked\n');
    process.exitCode = 1;
    return;
  }

  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== 'string' || filePath === '') return;

  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');

  // Files outside the project are not this guard's concern.
  if (rel.startsWith('../') || path.isAbsolute(rel)) return;

  const reason = reasonToBlock(rel, root);
  if (reason) {
    process.stderr.write(`Blocked edit to ${rel}: ${reason}\n`);
    process.exitCode = 2;
  }
}

function reasonToBlock(rel, root) {
  const base = path.posix.basename(rel);
  if (base.startsWith('.env') && base !== '.env.example') {
    return 'env files hold secrets and are not edited by agents. Document new variables in .env.example.';
  }
  if (GENERATED.includes(rel)) {
    return 'this file is generated. Change the route schemas, then run `npm run openapi`.';
  }
  // A committed migration may already be applied to a database; editing it
  // would make environments drift. New behavior goes into a new migration.
  if (/^migrations\/[^/]+\.sql$/.test(rel) && isInHead(rel, root)) {
    return 'committed migrations are add-only. Create a new migration file instead.';
  }
  return null;
}

function isInHead(relPath, root) {
  try {
    execFileSync('git', ['cat-file', '-e', `HEAD:${relPath}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
