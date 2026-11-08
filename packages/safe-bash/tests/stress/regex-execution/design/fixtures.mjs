export const vectors = [
  { name: 'nested-positive', pattern: '^(a+)+$', text: 'aaaa', expected: [[0, 4, ['aaaa', 'aaaa']]] },
  { name: 'alternation', pattern: '(a|aa)', text: 'aa', expected: [[0, 1, ['a', 'a']], [1, 2, ['a', 'a']]] },
  { name: 'captures', pattern: '(a)(b)?', text: 'a', expected: [[0, 1, ['a', 'a', null]]] },
  { name: 'zero-width', pattern: '^|$', text: 'a', expected: [[0, 0, ['']], [1, 1, ['']]] },
  { name: 'empty-subject', pattern: '^$', text: '', expected: [[0, 0, ['']]] },
  { name: 'empty-pattern', pattern: '', text: 'ab', expected: [[0, 0, ['']], [1, 1, ['']], [2, 2, ['']]] },
  { name: 'ascii-fold', pattern: 'a', text: 'A', insensitive: true, expected: [[0, 1, ['A']]] },
  { name: 'unicode-dot', pattern: '.', text: '😀', rgExpected: [[0, 2, ['😀']]], grepExpectedHex: ['f0', '9f', '98', '80'] },
  { name: 'unicode-fold', pattern: 'k', text: 'K', insensitive: true, rgExpected: [[0, 1, ['K']]], grepExpectedHex: [] },
  { name: 'unicode-empty', pattern: 'a*', text: '😀', rgExpected: [[0, 0, ['']], [2, 2, ['']]], grepExpectedHex: [] },
  { name: 'backreference', pattern: '(a)\\1', text: 'aa', expected: [[0, 2, ['aa', 'a']]], rgReject: true },
  { name: 'named-backreference-current-gap', pattern: '(?<part>a)\\k<part>', text: 'aa', rgExpected: [[0, 2, ['aa', 'a']]], grepReject: true },
  { name: 'special-group', pattern: '(?:a)', text: 'a', rgExpected: [[0, 1, ['a']]], grepReject: true },
  { name: 'lookahead-rejected', pattern: 'a(?=b)', text: 'ab', rgReject: true, grepReject: true },
  { name: 'digit-class', pattern: '[[:digit:]]', text: '7', grepExpectedHex: ['37'], rgReject: true },
];
export const risk = Object.freeze({ source: '^(a+)+$', text: 'aaaaaaaaaaaaaaaaaaaaaaaa!', bytes: 25, author: ['bounded', 'worker-default', 'worker-abort'], historicalExecutions: 7, reviewerReserved: 2, cumulativeCeiling: 12 });
export const workloads = [
  ...['ascii', 'unicode'].flatMap(alphabet => [1, 4].map(count => ({ name: `long-${alphabet}-${count}`, alphabet, count, lines: 1, bytes: 65536, expectedMatches: 0, expectedResponseBytes: 4 }))),
  ...[1000, 10000].map(lines => ({ name: `short-${lines}`, lines, count: 1, bytes: lines * 8, expectedMatches: lines })),
];
export function expectedWorkerBytes(spec, batchSize) {
  if (spec.lines === 1) return 4;
  const hitBytes = JSON.stringify({ pattern: 0, start: 0, end: 3, captures: ['hit'] }).length;
  return spec.lines * (hitBytes + 3) + Math.ceil(spec.lines / batchSize);
}
export function workload(spec) {
  const patterns = spec.lines === 1 ? ['Z$', 'Y$', 'X$', 'W$'].slice(0, spec.count) : ['hit'];
  const text = spec.lines === 1 ? spec.alphabet === 'ascii' ? 'a'.repeat(65536) : 'é'.repeat(32768) : 'hit 123';
  return { patterns, rows: Array.from({ length: spec.lines }, () => ({ text, all: true })) };
}
