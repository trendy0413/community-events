// Checks that docs/SPEC.md and the tests agree. Always fails on: a problem in
// the SPEC tables, a skipped/focused/todo/failing-by-design test, a test that
// cites an unknown rule, a rule test the spec does not list, or a duplicate
// title. Missing tests are reported as progress; --strict makes them fail.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { checkRuleTests, findDisabledTests, findTestTitles, parseSpecRules, specProblems } from './rule-tests.js';

const root = path.resolve(import.meta.dirname, '..');
const strict = process.argv.includes('--strict');
// The folders the test runners include. A test outside them never runs, so
// it must not count as written.
const TEST_DIRS = ['test/unit', 'test/integration', 'web/src'];
const TEST_FILE = /\.test\.tsx?$/;

function testFiles(): string[] {
  return TEST_DIRS.map((dir) => path.join(root, dir))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((file) => TEST_FILE.test(file) && !file.includes('node_modules'))
        .map((file) => path.join(dir, file)),
    );
}

const rules = parseSpecRules(readFileSync(path.join(root, 'docs/SPEC.md'), 'utf8'));
const errors: string[] = specProblems(rules);
const titles: string[] = [];

for (const file of testFiles()) {
  const source = readFileSync(file, 'utf8');
  titles.push(...findTestTitles(source));
  for (const call of findDisabledTests(source)) {
    errors.push(`${path.relative(root, file)} uses ${call}: tests must run and must fail when the rule breaks`);
  }
}

const report = checkRuleTests(rules, titles);
for (const { title, ids } of report.unknownIds) {
  errors.push(`test cites a rule that is not in docs/SPEC.md (${ids.join(', ')}): "${title}"`);
}
for (const title of report.unlisted) {
  errors.push(`rule test is not listed in docs/SPEC.md; add it to the rule's Test column: "${title}"`);
}
for (const title of report.duplicates) {
  errors.push(`two tests share one title: "${title}"`);
}
if (strict) {
  for (const { id, title } of report.missing) errors.push(`${id} has no test yet: "${title}"`);
}

console.log(`Rule tests: ${report.written} of ${report.expected} written (${rules.length} rules in docs/SPEC.md).`);
if (!strict) {
  for (const { id, title } of report.missing) console.log(`todo   ${id} has no test yet: "${title}"`);
}
for (const message of errors) console.error(`ERROR  ${message}`);

process.exitCode = errors.length > 0 ? 1 : 0;
