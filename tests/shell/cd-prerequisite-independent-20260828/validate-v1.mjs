import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  authenticate, blob, directory, evidence, exclusiveJson, foreignIndex, git,
  inventory, json, ownPath, root, sha256,
} from './audit.mjs';
import { cases, defaults, diagnosticCases, integrationControls, invariants } from './cases-v1.mjs';

const expectedGroups = { behavior: 16, permissions: 14, adapters: 6, state: 9, output: 5, cancellation: 5, limits: 27 };
const observedGroups = Object.fromEntries(Object.keys(expectedGroups).map(group => [group, cases.filter(row => row.group === group).length]));
assert.deepEqual(observedGroups, expectedGroups);
assert.equal(cases.length, 82);
assert.equal(diagnosticCases.length, 4);
assert.equal(invariants.length, 12);
assert.equal(integrationControls.length, 7);
assert.equal(new Set([...cases, ...diagnosticCases, ...integrationControls].map(row => row.id)).size, 93);
const byId = id => cases.find(row => row.id === id);

function materialize(recipe) {
  if (typeof recipe === 'string') return recipe;
  if (Array.isArray(recipe?.repeat)) {
    const [text, count] = recipe.repeat;
    assert.equal(typeof text, 'string');
    assert(Number.isSafeInteger(count) && count >= 0 && count <= 100000);
    return text.repeat(count);
  }
  assert(Array.isArray(recipe?.concat), 'unknown input recipe');
  return recipe.concat.map(materialize).join('');
}

for (const row of cases) {
  assert.match(row.id, /^[BPASOCL]\d{2}$/u);
  assert(Object.hasOwn(expectedGroups, row.group));
  assert(row.input && row.expected && typeof row.basis === 'string');
  assert.equal(typeof (row.input.source ?? defaults.source), 'string');
  assert(row.expected.cdStatus !== undefined || row.expected.rejects !== undefined);
  if (Array.isArray(row.expected.calls)) for (const call of row.expected.calls) {
    assert(['stat', 'access'].includes(call.method));
    assert.equal(typeof call.path, 'string');
    assert(call.path.startsWith('/'));
    if (call.method === 'access') assert.equal(call.mode, 1);
  }
}

const bytes = value => Buffer.byteLength(materialize(value));
assert.equal(bytes(byId('L08').input.env.TARGET), 65536);
assert.equal(bytes(byId('L09').input.env.TARGET), 65537);
assert.equal(bytes(byId('L10').input.cwd), 65536);
assert.equal(bytes(byId('L11').input.cwd), 65537);
assert.equal(bytes(byId('L12').input.env.TARGET) + 3, 65539);
assert.equal(bytes(byId('L13').input.env.CDPATH), 65536);
assert.equal(bytes(byId('L14').input.env.CDPATH), 65537);
assert.equal(bytes(byId('L22').input.env.TARGET), 65536);
assert.equal(materialize(byId('L22').input.env.TARGET).length, 32769);
assert.equal(bytes(byId('L23').input.env.TARGET), 65537);
assert.equal(bytes(byId('L24').input.env.TARGET), 65536);

function firstCdpathViolation(text) {
  let byteCount = 0;
  let slots = text ? 1 : 0;
  for (const scalar of text) {
    byteCount += Buffer.byteLength(scalar);
    if (scalar === ':') slots++;
    if (byteCount > 65536) return { kind: 'bytes', byteCount, slots };
    if (slots > 4096) return { kind: 'slots', byteCount, slots };
  }
  return { kind: 'none', byteCount, slots };
}
assert.deepEqual(firstCdpathViolation(materialize(byId('L16').input.env.CDPATH)), { kind: 'bytes', byteCount: 65537, slots: 4097 });
assert.deepEqual(firstCdpathViolation(materialize(byId('L17').input.env.CDPATH)), { kind: 'slots', byteCount: 4096, slots: 4097 });
assert.deepEqual(firstCdpathViolation(materialize(byId('L18').input.env.CDPATH)), { kind: 'none', byteCount: 4095, slots: 4096 });

const workArithmetic = {
  maximumCalls: { work: 1 + 2 + 4095 + 4097 * (2 * 4 + 4 + 2), probes: 4097, publicCalls: 4097 * 2 },
  exact: { work: 48768 + 1 + 55 + 57 * (2 * 48770 + 48770 + 2), probes: 57, publicCalls: 114 },
  nextUnit: { unconstrainedWork: 48768 + 1 + 55 + 57 * (2 * 48770 + 48770 + 2) + 1 + 4 - 4, statCalls: 57, accessCalls: 52 },
  rejectedReservation: { spent: 40000 + 1 + 99 + 69 * (2 * 40002 + 40002 + 2), request: 2 * 40002 },
};
assert.equal(workArithmetic.maximumCalls.work, byId('L18').expected.work);
assert.equal(workArithmetic.maximumCalls.publicCalls, 8194);
assert.equal(Math.floor(workArithmetic.maximumCalls.work / 128), 480);
assert.equal(workArithmetic.exact.work, byId('L19').expected.work);
assert.equal(workArithmetic.exact.work / 128, 65536);
assert.equal(workArithmetic.nextUnit.unconstrainedWork, byId('L20').expected.unconstrainedWork);
assert.equal(workArithmetic.rejectedReservation.spent, byId('L21').expected.work);
assert.equal(8388608 - workArithmetic.rejectedReservation.spent, 67956);
assert(workArithmetic.rejectedReservation.request > 8388608 - workArithmetic.rejectedReservation.spent);

const suffix = ' [truncated]';
assert.equal(Buffer.byteLength(suffix), 12);
assert.equal(65792 - Buffer.byteLength(suffix), 65780);
const diagnosticArithmetic = diagnosticCases.map(row => {
  const payload = materialize(row.payload);
  let result = payload;
  let retainedBytes = Buffer.byteLength(payload);
  if (Buffer.byteLength(payload) > 65792) {
    const retained = [];
    retainedBytes = 0;
    for (const scalar of payload) {
      const count = Buffer.byteLength(scalar);
      if (retainedBytes + count > 65780) break;
      retained.push(scalar);
      retainedBytes += count;
    }
    result = retained.join('') + suffix;
  }
  assert.equal(Buffer.byteLength(result), row.outputBytes, row.id);
  assert.equal(result.endsWith(suffix), row.truncated, row.id);
  if (row.retainedBytes !== undefined) assert.equal(retainedBytes, row.retainedBytes);
  if (row.originalBytes !== undefined) assert.equal(Buffer.byteLength(payload), row.originalBytes);
  assert.equal(Buffer.from(result).toString(), result, 'Unicode scalar split');
  return { id: row.id, inputBytes: Buffer.byteLength(payload), retainedBytes, outputBytes: Buffer.byteLength(result), truncated: row.truncated };
});
assert.equal(Buffer.byteLength('shell: line 1: ') + 65792 + 1, 65808);

const nativeBytes = Buffer.from(blob(evidence, 'tests/shell/cd-prerequisite-20260828/observations-01.json.gz.base64').toString().trim(), 'base64');
assert.equal(sha256(nativeBytes), 'b9f81d6f6507a5d110d0a196cabebe5d4ea1e803994d817485ed0c71520df592');
const native = JSON.parse(gunzipSync(nativeBytes));
assert.equal(native.native.length, 28);
assert.equal(native.native.filter(row => row.observed.stdout.includes('status=0\n')).length, 21);
assert.equal(native.native.filter(row => row.observed.stdout.includes('status=1\n')).length, 7);

const typeBinding = json('TYPE-BINDING-v1.json');
assert.equal(typeBinding.positiveAssertions, 10);
assert.equal(typeBinding.negativeAssertions, 10);
assert.equal(typeBinding.package.runtimeModulesImported, 0);
for (const result of typeBinding.results) assert.equal(sha256(readFileSync(resolve(directory, result.fixtureName))), result.fixtureSha256);
for (const [path, entry] of Object.entries(typeBinding.toolInputs)) assert.equal(sha256(readFileSync(resolve(root, path))), entry.sha256, path);
assert.equal(sha256(readFileSync(resolve(root, typeBinding.compiler.path))), typeBinding.compiler.sha256);
authenticate(json('INPUTS-v1.json').inputs);
authenticate(json('EXPOSURES-v1.json').inputs);
assert.equal(json('EXPOSURES-v1.json').runtimeStillBaseline, true);
const before = json('PROTECTED-BEFORE-v1.json');
assert.deepEqual(inventory(before.roots), before.entries, 'protected additions/removals/bytes changed');
assert.deepEqual(foreignIndex(), before.foreignIndex, 'foreign staging changed');

const syntaxFiles = readdirSync(directory).filter(name => name.endsWith('.mjs')).sort();
for (const name of syntaxFiles) execFileSync(process.execPath, ['--check', resolve(directory, name)], { cwd: root, stdio: 'pipe' });

const mode = process.argv[2];
if (mode === '--sealed' || mode === '--committed') {
  const manifest = json('MANIFEST-v1.json');
  assert.deepEqual(manifest.excluded, [`${ownPath}/MANIFEST-v1.json`]);
  assert.deepEqual(inventory([ownPath], new Set(manifest.excluded)), manifest.entries, 'owned additions/removals/bytes changed');
  assert.deepEqual(json('PROTECTED-AFTER-v1.json').entries, before.entries);
  if (mode === '--committed') {
    const commit = process.argv[3];
    assert.match(commit ?? '', /^[a-f0-9]{40}$/u);
    const names = git(['ls-tree', '-r', '--name-only', commit, '--', ownPath]).toString().trim().split('\n').sort();
    const expectedNames = [...Object.entries(manifest.entries).filter(([, entry]) => entry.kind === 'file').map(([path]) => path), ...manifest.excluded].sort();
    assert.deepEqual(names, expectedNames, 'commit membership mismatch');
    for (const path of names) assert.equal(sha256(blob(commit, path)), sha256(readFileSync(resolve(root, path))), path);
    const changed = git(['diff-tree', '--no-commit-id', '--name-status', '-r', commit]).toString().trim().split('\n');
    assert(changed.every(line => line.startsWith(`A\t${ownPath}/`)), 'commit contains foreign/non-addition changes');
  }
}

const result = {
  schema: 'cd-independent-static-validation/v1', checkedAt: new Date().toISOString(),
  kind: 'Own syntax/schema/arithmetic/authentication and baseline-public-type evidence only',
  groups: expectedGroups, commandCases: 82, diagnosticCases: 4, futureSemanticCases: 86,
  positiveTypes: 10, negativeTypes: 10, invariants: 12, integrationControls: 7,
  workArithmetic, diagnosticArithmetic, syntaxFiles,
  protectedEntries: Object.keys(before.entries).length,
  retainedNative: { observations: 28, successes: 21, diagnosticStatus1: 7, newRuns: 0 },
  productCasesRun: 0, providerRuns: 0, nativeRuns: 0, builds: 0, sourceInstalledMovedRuns: 0,
  futureCasesStatus: 'NOT RUN; runtime author awaits ROOT go',
  ownedInputs: Object.fromEntries(readdirSync(directory).sort()
    .filter(name => !['MANIFEST-v1.json', 'VALIDATION-v2.json', 'PROTECTED-AFTER-v1.json'].includes(name))
    .map(name => [name, sha256(readFileSync(resolve(directory, name)))])),
};
if (mode === '--capture') exclusiveJson('VALIDATION-v2.json', result);
console.log(JSON.stringify({ static: 'valid', commandCases: 82, diagnosticCases: 4, baselineTypes: '10 positive / 10 intended negatives', invariants: 12, futureControls: 7, implementationPasses: 0, mode }));
