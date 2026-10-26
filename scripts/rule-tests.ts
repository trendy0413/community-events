// Traceability between docs/SPEC.md and the test suite.
// A rule test is a test whose title starts with one or more rule IDs,
// for example "R1 rejects registration when the event is full" or
// "R1 R3 mixed registers and cancels keep the count equal to the active rows".

const ID = String.raw`[RW]\d+`;
const RULE_ROW = new RegExp(String.raw`^\|\s*(${ID})\s*\|`);
const CITED_IDS = new RegExp(String.raw`^((?:${ID}\s+)+)`);
// it(...) or test(...), but not someObject.test(...). Titles may contain
// escaped quotes, as in 'another organizer\'s event'.
const TEST_CALL = /(?<![.\w$])(?:it|test)(?:\.(?:concurrent|sequential))*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
// Modifiers that stop a test from running, or make it pass while the rule is
// broken. A rule test with one of these would look covered without being so.
const DISABLED = /(?<![.\w$])(?:describe|it|test)(?:\.\w+)*\.(?:skip|only|todo|fails|skipIf|runIf)\b/g;

export interface SpecRule {
  id: string;
  /** Test titles the spec promises for this rule (from its Test or "How checked" column). */
  expectedTests: string[];
}

export interface RuleCheckReport {
  expected: number;
  written: number;
  missing: { id: string; title: string }[];
  unknownIds: { title: string; ids: string[] }[];
  unlisted: string[];
  duplicates: string[];
}

export function citedIds(title: string): string[] {
  const prefix = CITED_IDS.exec(title)?.[1];
  return prefix ? prefix.trim().split(/\s+/) : [];
}

export function parseSpecRules(spec: string): SpecRule[] {
  const rules: SpecRule[] = [];
  for (const line of spec.split(/\r?\n/)) {
    const id = RULE_ROW.exec(line)?.[1];
    if (!id) continue;
    const lastCell = line.split('|').slice(1, -1).at(-1) ?? '';
    // Only backticked text that starts with a rule ID is a test title; other
    // backticked text in the cell is a path or a tool name.
    const expectedTests = [...lastCell.matchAll(/`([^`]+)`/g)]
      .map((match) => match[1] ?? '')
      .filter((text) => citedIds(text).length > 0);
    rules.push({ id, expectedTests });
  }
  return rules;
}

/** Problems inside the SPEC tables themselves. */
export function specProblems(rules: SpecRule[]): string[] {
  const problems: string[] = [];
  for (const rule of rules) {
    // Backend rules (R) are always tested. Web rules (W) may be checked by
    // review or lint instead, as their "How checked" column says.
    if (rule.id.startsWith('R') && rule.expectedTests.length === 0) {
      problems.push(`${rule.id} lists no test in docs/SPEC.md`);
    }
    for (const title of rule.expectedTests) {
      if (!citedIds(title).includes(rule.id)) {
        problems.push(`${rule.id} lists a test that does not cite ${rule.id}: "${title}"`);
      }
    }
  }
  return problems;
}

export function findTestTitles(source: string): string[] {
  return [...source.matchAll(TEST_CALL)].map((match) => (match[2] ?? '').replace(/\\(.)/g, '$1'));
}

export function findDisabledTests(source: string): string[] {
  return [...source.matchAll(DISABLED)].map((match) => match[0]);
}

export function checkRuleTests(rules: SpecRule[], titles: string[]): RuleCheckReport {
  const knownIds = new Set(rules.map((rule) => rule.id));
  const promised = new Set(rules.flatMap((rule) => rule.expectedTests));
  const ruleTitles = titles.filter((title) => citedIds(title).length > 0);

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const title of ruleTitles) {
    if (seen.has(title)) duplicates.add(title);
    seen.add(title);
  }

  const unknownIds: RuleCheckReport['unknownIds'] = [];
  const unlisted: string[] = [];
  for (const title of seen) {
    const unknown = citedIds(title).filter((id) => !knownIds.has(id));
    if (unknown.length > 0) unknownIds.push({ title, ids: unknown });
    else if (!promised.has(title)) unlisted.push(title);
  }

  const missing = rules.flatMap((rule) =>
    rule.expectedTests.filter((title) => !seen.has(title)).map((title) => ({ id: rule.id, title })),
  );

  return {
    expected: promised.size,
    written: promised.size - new Set(missing.map((item) => item.title)).size,
    missing,
    unknownIds,
    unlisted,
    duplicates: [...duplicates],
  };
}
