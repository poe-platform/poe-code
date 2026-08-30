import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(readFileSync(join(owned, name)));
const legacy = read('candidate-01/legacy-no-native-process.json');
const tests = legacy.stdout.split('✖ failing tests:')[0].split('\n').filter(line => /^[✔✖]/u.test(line));
assert.equal(tests.length, 237);
const starts = [
  ['abort-reason-regression.test.ts', 'structural signal implements EventTarget and AbortSignal; native undefined is a DOMException'],
  ['contracts.test.ts', 'factories register exactly expr with explicit replacement'],
  ['grammar.test.ts', 'expr grammar ["2","+","3","*","4"]'],
  ['regex-lifecycle.test.ts', 'expr skipped regex branches submit/compile zero jobs and never access stdin'],
  ['regex-limits.test.ts', 'expr regex cap: input bytes'],
  ['regex-protocol.test.ts', 'expr replies validate exact shape, original byte bounds and scalar boundaries'],
].map(([filename, firstTitle]) => ({ filename: `tests/commands/expr/${filename}`, firstTitle, index: tests.findIndex(line => line.startsWith(`✔ ${firstTitle} (`)) }));
assert.equal(starts[0].index, 0);
assert(starts.every((row, index) => index === 0 || row.index > starts[index - 1].index));
const perFile = starts.map((row, index) => {
  const rows = tests.slice(row.index, starts[index + 1]?.index ?? tests.length);
  return { ...row, total: rows.length, passed: rows.filter(line => line.startsWith('✔')).length, failures: rows.filter(line => line.startsWith('✖')) };
});
const core = read('core-01/core-controls.json');
const groups = [['protocol', row => row.id.startsWith('protocol-')], ['lifecycle', row => row.id.startsWith('lifecycle-')], ['runtime', row => !row.id.startsWith('protocol-') && !row.id.startsWith('lifecycle-')]].map(([group, predicate]) => {
  const rows = core.rows.filter(predicate);
  return { group, total: rows.length, passed: rows.filter(row => row.passed).length, failures: rows.filter(row => !row.passed).map(row => row.id) };
});
const result = {
  candidate: read('candidate-01/candidate.json').candidate,
  encounter: read('candidate-01/encounter-summary.json'),
  quota: ['quota47', 'quota21'].map(name => { const data = read(`candidate-01/${name}-results.json`); return { cohort: name, total: data.total, passed: data.passed, failures: data.rows.filter(row => !row.passed).map(row => ({ input: row.input, checks: row.checks.filter(check => !check.passed) })) }; }),
  regressions: read('candidate-01/regression-summary.json'),
  legacyPerFile: perFile,
  perFileCountingMethod: 'Actual spec-reporter rows before the duplicated failure footer, partitioned at source-verified first test names in the recorded alphabetic file order; no estimated declaration counts.',
  oldCore: { passed: core.rows.filter(row => row.passed).length, total: core.rows.length, groups },
  physicalMovedSmoke: { passed: read('candidate-01/moved-results.json').passed, total: read('candidate-01/moved-results.json').total },
  overlaps: [
    '44 Darwin semantic and 17 project controls partition the same 61, not additional 61 tests.',
    '19 closure rows are a subset of 61; five actual-Shell checks replay five of those inputs.',
    '16 nearby controls are separately frozen inputs, not 16 new native claims; related properties overlap the original 61.',
    '47 historical quota and 21 corrected quota controls are separate cohorts; they overlap parser/output and lifecycle behaviors in the other suites.',
    '111 reason + 27 contracts + 73 grammar + 11 lifecycle + 10 regex-limits + 5 protocol partition the 237 legacy non-native tests.',
    '338 additional canonical tests are five other files, including encounter-order/output-quota authored tests; they are not 338 newly independent controls.',
    'Old core 146 includes 37 protocol, 19 lifecycle and 90 runtime subcases; behavioral coverage overlaps source tests, frozen controls and moved smoke.',
    'The 19 physical moved smoke cases are a separate packaging execution, not novel semantic coverage.',
  ],
  blockers: [
    'Shared same-path 11-file candidate run is 275/276: native rg detects an ancestor checkout for a no-.git fixture despite GIT_CEILING_DIRECTORIES. Original inputs, assertions and native argv remain unchanged. No workspace-external temp correction executed.',
    'Original nearby is 15/16, quota is 46/47, old core is 145/146, and legacy non-native is 236/237 due to preserved original sink-recasting expectations, not successful original green gates.',
    'Four native-dependent old tests in two files remain unexecuted, not skipped/passed; no new native expr oracle capture.',
    'No public expr/root/subpath or repeat promotion; no Linux/full-parity/superiority/project completion claim.',
  ],
};
writeFileSync(join(owned, 'SUMMARY.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ legacyPerFile: perFile.map(({ filename, total, passed }) => ({ filename, total, passed })), core: groups }));
