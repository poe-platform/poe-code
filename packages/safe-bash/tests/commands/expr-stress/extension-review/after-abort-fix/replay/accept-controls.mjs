import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { containedJob } from './watchdog.mjs';
import { addEvidence, frozenJson, originalBase, originalCommit, extensionBase, extensionCommit, owned, verifyFrozen, sha256 } from './review.mjs';

const stage = JSON.parse(readFileSync(`${owned}/candidate-27a77935/stage.json`));
const label = process.argv[2];
if (!label) { verifyFrozen(); console.log('Read-only verification complete. Control capture requires a NEW explicit label.'); process.exit(0); }
assert(/^[a-z0-9-]+$/.test(label));
const destination = `${owned}/${label}`;
assert(!existsSync(destination));
const freeze = verifyFrozen(), rows = [];
const original = frozenJson(originalCommit, `${originalBase}/controls.json`);
const extension = frozenJson(extensionCommit, `${extensionBase}/controls.json`);
const driverHashes = ['runtime-driver.mjs', 'protocol-driver.mjs', 'lifecycle-driver.mjs', 'watchdog.mjs'].map(path => ({ path, sha256: sha256(readFileSync(`${owned}/${path}`)) }));
async function check(id, file, payload, expect = () => true) {
  const outer = await containedJob(pathToFileURL(resolve(owned, file)).href, { installed: stage.installed, ...payload });
  const value = outer.state === 'returned' && outer.value?.state === 'fulfilled' ? outer.value.value : null;
  let passed = Boolean(value && !value.controlFailure && (value.activeBeforeSafetyCleanup ?? 0) === 0 && (value.liveWorkers ?? 0) === 0);
  let assertion = null;
  try { if (passed) assert(expect(value), `expectation false: ${id}`); } catch (error) { passed = false; assertion = error.message; }
  rows.push({ id, payload, passed, assertion, ...outer, value: value ? { ...value, imports: value.imports ? [...new Set(value.imports.map(item => item.resolved))] : undefined } : outer.value });
  if (!passed) console.log(`FAILED ${id}: ${value?.controlFailure?.message ?? assertion ?? outer.state}`);
}
const runtime = (id, payload, expect) => check(id, 'runtime-driver.mjs', payload, expect);
const status = expected => value => value.result?.status === expected;
const text = (expected, code = 0) => value => value.result?.status === code && value.result.stdoutBase64 === Buffer.from(expected).toString('base64');
for (const implicit of [false, true]) for (const [index, argv] of original.controls.find(item => item.id === 'direct-zero-stdin-reads').inputs.entries()) {
  await runtime(`direct-zero-stdin-${implicit}-${index}`, { mode: 'direct', argv, stdinIsDefault: implicit }, value => [0, 1, 2].includes(value.result.status) && value.result.stdinAccess === 0 && value.result.fsAccess === 0 && value.result.invokeAccess === 0 && value.result.mainCompiles === 0);
}
for (const stderr of [false, true]) await runtime(`backpressure-${stderr ? 'stderr' : 'stdout'}`, { mode: 'backpressure', stderr });
await runtime('sink-rejection', { mode: 'sink-rejection' });
for (const stage of ['pre', 'output']) for (const reason of ['zero', 'error', 'undefined-native']) await runtime(`direct-abort-${stage}-${reason}`, { mode: 'abort', stage, reason });
for (const variant of ['close', 'throw-zero', 'throw-error']) await runtime(`registration-${variant}`, { mode: 'cleanup-registration', variant });
for (const [index, argv] of original.controls.find(item => item.id === 'short-circuit-worker-admission').inputs.entries()) await runtime(`shortcircuit-${index}`, { mode: 'direct', argv }, value => value.events.filter(event => event.type === 'request' || event.type === 'workerStart').length === 0 && value.result.status === (index === 0 ? 0 : 1));
await runtime('evaluated-regex-positive', { mode: 'direct', argv: ['abc', ':', 'a'] }, value => text('1\n')(value) && value.events.some(event => event.type === 'request') && value.result.mainCompiles === 0);
await runtime('evaluated-regex-invalid', { mode: 'direct', argv: ['abc', ':', '['] }, value => status(2)(value) && value.events.some(event => event.type === 'request'));
await runtime('empty-subject-invalid-compiles', { mode: 'direct', argv: ['', ':', '['] }, value => status(2)(value) && value.events.some(event => event.type === 'request'));
for (const [index, literal] of ['aaaaaa', 'aaaaaaa', 'aaaaaaaa', 'ééé', 'éééa', 'éééé'].entries()) await runtime(`argument-bytes-${index}`, { mode: 'direct', argv: ['+', literal], options: { limits: { maxArgumentBytes: 8 } } }, status(Buffer.byteLength(literal) + 1 <= 8 ? 0 : 3));
await runtime('argument-bytes-skipped', { mode: 'direct', argv: ['kept', '|', '+', 'aaaaaaaa'], options: { limits: { maxArgumentBytes: 8 } } }, status(3));
for (const digits of [7, 8, 9]) for (const prefix of ['', '-', '0']) await runtime(`numeric-digits-${digits}-${prefix || 'positive'}`, { mode: 'direct', argv: [`${prefix}${'1'.repeat(digits)}`, '+', '0'], options: { limits: { maxNumericDigits: 8 } } }, status(digits + (prefix === '0' ? 1 : 0) <= 8 ? 0 : 3));
await runtime('numeric-128-positive', { mode: 'direct', argv: ['1'.repeat(128), '+', '0'] }, text(`${'1'.repeat(128)}\n`));
await runtime('numeric-product-growth', { mode: 'direct', argv: ['9999', '*', '9999'], options: { limits: { maxNumericDigits: 4 } } }, status(3));
for (const nodes of [4, 5, 6]) await runtime(`nodes-${nodes}`, { mode: 'direct', argv: [...Array(nodes - 1).fill('length'), 'x'], options: { limits: { maxNodes: 5 } } }, status(nodes <= 5 ? 0 : 3));
for (const [id, argv, expected] of [['chain-below', ['1', '+', '1'], 0], ['chain-at', ['1', '+', '1', '+', '1'], 0], ['chain-above', ['1', '+', '1', '+', '1', '+', '1'], 3], ['chain-skipped', ['kept', '|', '1', '+', '1', '+', '1'], 3]]) await runtime(id, { mode: 'direct', argv, options: { limits: { maxNodes: 5 } } }, status(expected));
for (const depth of [7, 8, 9]) for (const form of ['group', 'prefix']) await runtime(`depth-${form}-${depth}`, { mode: 'direct', argv: form === 'group' ? [...Array(depth - 1).fill('('), '1', ...Array(depth - 1).fill(')')] : [...Array(depth - 1).fill('length'), 'x'], options: { limits: { maxDepth: 8 } } }, status(depth <= 8 ? 0 : 3));
for (const maxSteps of [1, 100000]) await runtime(`work-${maxSteps}`, { mode: 'direct', argv: ['(', 'a', ':', 'a', ')', '+', '(', 'a', ':', 'a', ')'], options: { limits: { maxSteps } } }, maxSteps === 1 ? status(3) : text('2\n'));
for (const size of [6, 7, 8]) for (const capture of [false, true]) await runtime(`output-${size}-${capture}`, { mode: 'direct', argv: capture ? ['a'.repeat(size), ':', '\\(a*\\)'] : ['+', 'a'.repeat(size)], options: { limits: { maxOutputBytes: 8 } } }, status(size + 1 <= 8 ? 0 : 3));
for (const [index, argv] of original.controls.find(item => item.id === 'unicode-contract').inputs.entries()) await runtime(`unicode-${index}`, { mode: 'direct', argv, environment: { LC_ALL: 'C.UTF-8' } }, index === 0 ? text('5\n') : index === 1 ? text('😀\n') : status(2));
for (const [index, input] of original.controls.find(item => item.id === 'bounded-redos').inputs.entries()) await runtime(`redos-original-${index}`, { mode: 'direct', argv: input.argv, options: { regex: { requestTimeoutMs: 80, startupTimeoutMs: 200 } } }, value => [0, 1, 2, 3].includes(value.result.status) && value.events.some(event => event.type === 'workerStart') && value.result.mainCompiles === 0);
const native = frozenJson(originalCommit, `${originalBase}/evidence/original-20260827/oracle.json`).profiles[0].results;
for (const workflow of original.shellWorkflows) await runtime(`shell-${workflow.id}`, { mode: 'shell', script: workflow.script, readFiles: Object.keys(workflow.vfsFiles ?? {}) }, value => {
  const expectedStderr = workflow.stderrFromGnuCase ? native.find(item => item.id === workflow.stderrFromGnuCase).stderrBase64 : Buffer.from(workflow.stderr).toString('base64');
  return text(workflow.stdout, workflow.exitCode)(value) && value.result.stderrBase64 === expectedStderr && Object.entries(workflow.vfsFiles ?? {}).every(([path, text]) => value.result.files[path] === Buffer.from(text).toString('base64'));
});
const realRoot = mkdtempSync(join(tmpdir(), 'expr-final-real-vfs-'));
try {
  await runtime('real-vfs-artifact-pipeline', { mode: 'shell', realRoot, script: "expr 'v12.4.7' : 'v\\([0-9][0-9]*\\)\\.' | cat > /build-number; cat /build-number", readFiles: ['/build-number'] }, value => text('12\n')(value) && value.result.files['/build-number'] === Buffer.from('12\n').toString('base64'));
  assert.deepEqual(readdirSync(realRoot), ['build-number']);
} finally { rmSync(realRoot, { recursive: true }); }
for (const profile of ['byte', 'utf8-scalar']) {
  await runtime(`wire-whole-${profile}`, { mode: 'spans', subject: 'Aé😀Z', pattern: 'A..', profile }, value => value.result.offsetUnit === 'byte' && value.result.overall.end === (profile === 'byte' ? 3 : 7));
  await runtime(`wire-shifted-${profile}`, { mode: 'spans', subject: 'Aé😀Z', pattern: 'A.\\(.\\)', profile }, value => value.result.capture.start === (profile === 'byte' ? 2 : 3) && value.result.capture.end === (profile === 'byte' ? 3 : 7));
}
for (const [id, pattern, subject, expected] of [['absent', 'a', 'a', { hasCapture: false, matched: true, capture: null }], ['unmatched', '\\(a\\)\\?z', 'z', { hasCapture: true, matched: true, capture: null }], ['empty', '\\(a*\\)z', 'z', { hasCapture: true, matched: true, capture: { start: 0, end: 0 } }], ['no-match', '\\(a\\)', 'z', { hasCapture: true, matched: false, capture: null }], ['repeated', '\\(ab\\)*', 'abab', { hasCapture: true, matched: true, capture: { start: 2, end: 4 } }]]) await runtime(`wire-state-${id}`, { mode: 'spans', subject, pattern, profile: 'byte' }, value => Object.entries(expected).every(([key, expected]) => JSON.stringify(value.result[key]) === JSON.stringify(expected)));
for (const mutation of frozenJson(extensionCommit, `${extensionBase}/mutations.json`).mutations) await check(`protocol-${mutation.id}`, 'protocol-driver.mjs', { mutation: mutation.id }, value => value.passed);
for (const mutation of ['extra-property', 'negative-work', 'fractional-work', 'nan-work']) await check(`protocol-${mutation}`, 'protocol-driver.mjs', { mutation }, value => value.passed);
await check('protocol-M26-byte-positive', 'protocol-driver.mjs', { mutation: 'M26', byte: true }, value => value.passed);
for (const scenario of ['queue', 'owned-bytes', 'startup-timeout', 'active-timeout', 'malformed', 'termination-latch', 'late-admission', 'late-startup-error', 'undefined-rejection']) await check(`lifecycle-${scenario}`, 'lifecycle-driver.mjs', { scenario });
await check('lifecycle-queue-byte-minus-one', 'lifecycle-driver.mjs', { scenario: 'queue', byteLimit: 257 });
for (const stage of ['pre', 'startup', 'active']) for (const reason of ['zero', 'error', 'undefined-native']) await check(`lifecycle-abort-${stage}-${reason}`, 'lifecycle-driver.mjs', { scenario: 'abort', stage, reason });
assert.deepEqual(verifyFrozen(), freeze);
addEvidence(`${destination}/controls.json`, { candidate: stage.commit, driverHashes, installedArtifactSha256: stage.installedArtifactSha256, createdAt: new Date().toISOString(), subcaseCount: rows.length, failedSubcases: rows.filter(row => !row.passed).map(row => row.id), rows,
  qualification: 'Subcase results only. Original and extension control coverage must be reviewed individually; unexecuted subcases remain open. Synthetic transport success is not worker algorithm proof.', frozenControls: { original: original.controls.map(item => item.id), extension: extension.controls.map(item => item.id) }, realVfsScratchRemoved: !existsSync(realRoot) });
console.log(JSON.stringify({ subcases: rows.length, failed: rows.filter(row => !row.passed).map(row => row.id), destination }));
