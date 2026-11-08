import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { containedJob } from './watchdog.mjs';
import { addEvidence, owned, sha256, frozenJson, originalCommit, originalBase, compare, verifyFrozen } from './review.mjs';

const destination = `${owned}/supplement-fe7083d9-first`;
if (process.argv[2] !== 'capture') { console.log('Version-specific supplemental audit: explicit capture required; no files written.'); process.exit(0); }
assert(!existsSync(destination));
const stage = JSON.parse(readFileSync(`${owned}/candidate-fe7083d9-20260827/stage.json`));
const baseline = JSON.parse(readFileSync(`${owned}/baseline-8f19a9d5-20260827/stage.json`));
const rows = [];
async function run(id, file, payload, installed = stage.installed) {
  const outer = await containedJob(pathToFileURL(resolve(owned, file)).href, { installed, ...payload });
  const value = outer.state === 'returned' && outer.value?.state === 'fulfilled' ? outer.value.value : null;
  rows.push({ id, installed, payload, outer, passed: Boolean(value && !value.controlFailure && value.passed !== false) });
  return value;
}
for (const variant of ['null', 'id-string', 'missing-subject', 'pattern-string', 'limit-negative', 'limit-fractional', 'limit-unsafe', 'wrong-kind']) await run(`malformed-request-${variant}`, 'extra-driver.mjs', { mode: 'malformed-request', variant });
await run('cache-and-response-isolation', 'extra-driver.mjs', { mode: 'cache' });
await run('shared-work-remaining', 'extra-driver.mjs', { mode: 'shared-work' });
for (const [key, pattern, subject] of [['maxPatternBytes', 'aa', 'aa'], ['maxSubjectBytes', 'a', 'aa'], ['maxNodes', 'a', 'a'], ['maxDepth', '\\(\\(a\\)\\)', 'a'], ['maxSteps', 'a', 'a'], ['maxStates', 'a\\|b', 'a'], ['maxAllocatedUnits', 'a', 'a']]) await run(`worker-cap-${key}`, 'extra-driver.mjs', { mode: 'worker-limits', pattern, subject, limits: { [key]: 1 } });
await run('synthetic-undefined-abort', 'lifecycle-driver.mjs', { scenario: 'synthetic-undefined-abort' });
const legacyProtocol = {};
for (const [label, installed] of [['baseline', baseline.installed], ['candidate', stage.installed]]) legacyProtocol[label] = await run(`legacy-protocol-${label}`, 'extra-driver.mjs', { mode: 'legacy-protocol' }, installed);
addEvidence(`${destination}/legacy-protocol-comparison.json`, { baselineCommit: baseline.commit, candidateCommit: stage.commit, ...legacyProtocol, equal: JSON.stringify(legacyProtocol.baseline) === JSON.stringify(legacyProtocol.candidate), note: 'Same real installed session executes grep, rg and glob; default options and old byte spans retained. Legacy glob zero-length sentinel is not an expr span.' });
const transcript = [
  { id: 'grep-ordered-alternative', script: "printf 'ab\\n' | grep -Eo 'a|ab'" },
  { id: 'grep-fixed', script: "printf 'a.b\\naxb\\n' | grep -F 'a.b'" },
  { id: 'grep-no-match', script: "printf 'ab\\n' | grep z" },
  { id: 'rg-unicode-byte-offset', script: "printf 'éa\\n' | rg -bo a -" },
  { id: 'rg-fixed', script: "printf 'a.b\\naxb\\n' | rg -F 'a.b' -" },
  { id: 'rg-no-match', script: "printf 'ab\\n' | rg z -" },
  { id: 'rg-glob', script: "rg --files -g '*.ts' /", files: { '/a.ts': 'a\n', '/b.js': 'b\n' } },
];
const transcriptResults = [];
for (const item of transcript) {
  const before = await run(`legacy-transcript-${item.id}-baseline`, 'runtime-driver.mjs', { mode: 'legacy', ...item }, baseline.installed);
  const after = await run(`legacy-transcript-${item.id}-candidate`, 'runtime-driver.mjs', { mode: 'legacy', ...item });
  transcriptResults.push({ ...item, baseline: before?.result, candidate: after?.result, same: before?.result && after?.result && compare(before.result, after.result).strict, baselineControlFailure: before?.controlFailure, candidateControlFailure: after?.controlFailure });
}
addEvidence(`${destination}/legacy-transcript.json`, { baselineCommit: baseline.commit, candidateCommit: stage.commit, transcriptResults, mismatches: transcriptResults.filter(row => !row.same).map(row => row.id), classification: 'Actual moved-installed Shell commands, same literal scripts and files, baseline/candidate bytes status diagnostics compared without new semantics.' });
const original = frozenJson(originalCommit, `${originalBase}/evidence/original-20260827/oracle.json`);
const binary = original.identities.gnu.actualPath;
assert.equal(sha256(readFileSync(binary)), original.identities.gnu.sha256);
const cwd = mkdtempSync(join(tmpdir(), 'expr-nullable-final-native-'));
const nullable = [];
try {
  const cases = [
    ['empty', '', '\\(a*\\)*\\1'], ['a', 'a', '\\(a*\\)*\\1'], ['aa', 'aa', '\\(a*\\)*\\1'], ['aaa', 'aaa', '\\(a*\\)*\\1'],
    ['no-reference', 'aaa', '\\(a*\\)*'], ['not-repeated', 'aaa', '\\(a*\\)\\1'], ['nonnullable', 'aaa', '\\(a\\)*\\1'], ['mandatory-empty', '', '\\(a*\\)\\{2\\}\\1'],
  ];
  for (const [id, subject, pattern] of cases) {
    const argv = ['+', subject, ':', pattern];
    const native = spawnSync(binary, argv, { cwd, argv0: 'expr', env: original.profiles[0].environment, stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 65536 });
    const expected = { status: native.status, signal: native.signal, failure: native.error?.message ?? null, stdoutBase64: native.stdout.toString('base64'), stderrBase64: native.stderr.toString('base64') };
    const actual = await run(`nullable-${id}`, 'runtime-driver.mjs', { mode: 'direct', argv });
    nullable.push({ id, argv, expected, actual: actual?.result, comparison: actual?.result && compare(expected, actual.result) });
  }
  assert.deepEqual(readdirSync(cwd), []);
} finally { rmSync(cwd, { recursive: true }); }
addEvidence(`${destination}/nullable-separate-cohort.json`, { source: 'Eight explicit user-disclosed nullable diagnosis reproductions/negative controls. Additional independent cohort, NOT part of frozen95/extension20/correction1 and never merged.', candidate: stage.commit, nativeIdentity: original.identities.gnu, environment: original.profiles[0].environment, host: original.host, rows: nullable, scratchRemoved: !existsSync(cwd), productionChanged: false });
if (existsSync('/tmp/expr-nullable-diagnosis.txt')) { const bytes = readFileSync('/tmp/expr-nullable-diagnosis.txt'); addEvidence(`${destination}/independent-nullable-diagnosis.txt`, bytes.toString()); addEvidence(`${destination}/independent-nullable-diagnosis-provenance.json`, { path: '/tmp/expr-nullable-diagnosis.txt', sha256: sha256(bytes), role: 'External readonly diagnosis, not sealed-candidate acceptance. Source/dist historical identity limitations preserved in full.' }); }
verifyFrozen();
addEvidence(`${destination}/controls.json`, { candidate: stage.commit, rows, failed: rows.filter(row => !row.passed).map(row => row.id), driverHashes: ['extra-driver.mjs', 'runtime-driver.mjs', 'lifecycle-driver.mjs', 'watchdog.mjs'].map(path => ({ path, sha256: sha256(readFileSync(`${owned}/${path}`)) })) });
console.log(JSON.stringify({ rows: rows.length, failed: rows.filter(row => !row.passed).map(row => row.id), legacyProtocolEqual: JSON.stringify(legacyProtocol.baseline) === JSON.stringify(legacyProtocol.candidate), transcriptMismatches: transcriptResults.filter(row => !row.same).map(row => row.id), nullableMismatches: nullable.filter(row => !row.comparison?.strict).map(row => row.id) }));
