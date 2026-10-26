import { describe, expect, it } from 'vitest';
import {
  checkRuleTests,
  citedIds,
  findDisabledTests,
  findTestTitles,
  parseSpecRules,
  specProblems,
} from '../../scripts/rule-tests.js';

const SPEC = [
  '| ID | Rule | Source | Who is hurt | Test |',
  '|---|---|---|---|---|',
  '| R1 | Seats never go above capacity. | brief | Attendees | `R1 rejects when full`, `R1 R3 mixed load keeps the count` |',
  '| R3 | Cancel frees the seat. | brief | Attendees | `R3 cancel frees the seat` |',
  '| W1 | No business rules in the client. | Lint stops `web/` from importing `src/`. |',
].join('\n');

// Fixture source code is built from parts, so the repo's own rule check does
// not read these fixture titles and modifiers as real tests.
const call = (...parts: string[]): string => parts.join('');

describe('rule-to-test check', () => {
  it('reads rule IDs and promised test titles from the SPEC tables', () => {
    expect(parseSpecRules(SPEC)).toEqual([
      { id: 'R1', expectedTests: ['R1 rejects when full', 'R1 R3 mixed load keeps the count'] },
      { id: 'R3', expectedTests: ['R3 cancel frees the seat'] },
      { id: 'W1', expectedTests: [] },
    ]);
  });

  it('reads every rule ID a title starts with', () => {
    expect(citedIds('R1 R3 mixed load keeps the count')).toEqual(['R1', 'R3']);
    expect(citedIds('database is reachable')).toEqual([]);
  });

  it('finds test titles in a test file', () => {
    const source = [call('it', "('R1 rejects when full', () => {})"), call('test', '("plain test", () => {})')].join('\n');
    expect(findTestTitles(source)).toEqual(['R1 rejects when full', 'plain test']);
  });

  it('reads a title with an escaped apostrophe', () => {
    const source = call('it', "('R5 organizer cannot change another organizer\\'s event', () => {})");
    expect(findTestTitles(source)).toEqual(["R5 organizer cannot change another organizer's event"]);
  });

  it('ignores .test( calls on other objects', () => {
    expect(findTestTitles(call('/x/', ".test('R1 not a test')"))).toEqual([]);
  });

  it('finds skipped, focused, todo and failing-by-design tests', () => {
    const source = [
      call('it', '.skip', "('R1 a')"),
      call('describe', '.only', "('b')"),
      call('test', '.todo', "('R1 c')"),
      call('it', '.fails', "('R1 d')"),
      call('it', '.concurrent', '.skip', "('R1 e')"),
      call('describe', '.skipIf', '(true)'),
    ].join('\n');
    expect(findDisabledTests(source)).toHaveLength(6);
  });

  it('flags a backend rule with no test, and a listed test that cites another rule', () => {
    const untested = parseSpecRules('| R2 | One registration. | brief | Attendees | none yet |');
    expect(specProblems(untested)).toEqual(['R2 lists no test in docs/SPEC.md']);
    const mismatched = parseSpecRules('| R4 | Frozen. | brief | Attendees | `R4 ok`, `R1 wrong id` |');
    expect(specProblems(mismatched)).toEqual(['R4 lists a test that does not cite R4: "R1 wrong id"']);
  });

  it('counts written tests and lists the missing ones', () => {
    const report = checkRuleTests(parseSpecRules(SPEC), ['R1 rejects when full', 'plain test']);

    expect(report).toMatchObject({ expected: 3, written: 1, unknownIds: [], unlisted: [], duplicates: [] });
    expect(report.missing).toEqual([
      { id: 'R1', title: 'R1 R3 mixed load keeps the count' },
      { id: 'R3', title: 'R3 cancel frees the seat' },
    ]);
  });

  it('flags a test that cites a rule the SPEC does not have', () => {
    const report = checkRuleTests(parseSpecRules(SPEC), ['R7 rejects capacity below count']);
    expect(report.unknownIds).toEqual([{ title: 'R7 rejects capacity below count', ids: ['R7'] }]);
  });

  it('flags a rule test that the SPEC does not list', () => {
    const report = checkRuleTests(parseSpecRules(SPEC), ['R1 some new behavior']);
    expect(report.unlisted).toEqual(['R1 some new behavior']);
  });

  it('flags two tests with the same title', () => {
    const report = checkRuleTests(parseSpecRules(SPEC), ['R3 cancel frees the seat', 'R3 cancel frees the seat']);
    expect(report.duplicates).toEqual(['R3 cancel frees the seat']);
  });
});
