import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cases } from './cases.mjs';
import { addArtifact, auditCommit, auditPath, bytesResult, cohortFiles, digest, directory, frozenFile, handoffPath, sourceSnapshot } from './common.mjs';

assert.equal(process.argv.length, 2, 'one-time freeze takes no arguments');
assert.equal(existsSync(join(directory, 'native-frozen.json')), false, 'native freeze already exists');
assert.equal(existsSync(join(directory, 'manifest.json')), false, 'manifest already exists');
const executable = '/usr/bin/jq';
const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1' };
const executableSha256 = digest(readFileSync(executable));
assert.equal(executableSha256, '1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f');
let invocations = 0;
function invoke(argv, inputHex = '', files = {}) {
  const temporary = mkdtempSync(join(directory, '.native-'));
  try {
    for (const [name, hex] of Object.entries(files)) {
      assert.match(name, /^[a-z]+\.txt$/u);
      writeFileSync(join(temporary, name), Buffer.from(hex, 'hex'), { flag: 'wx' });
    }
    const result = spawnSync(executable, argv, { input: Buffer.from(inputHex, 'hex'), cwd: temporary, env: { ...environment, HOME: temporary }, shell: false, timeout: 2000, maxBuffer: 65536 });
    invocations++;
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    return { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
const version = invoke(['--version']);
const build = invoke(['--build-configuration']);
assert.equal(Buffer.from(version.stdoutHex, 'hex').toString(), 'jq-1.7.1-apple\n');
assert.equal(version.status, 0);
assert.equal(build.status, 0);
const auditBytes = frozenFile(auditPath);
const handoffBytes = frozenFile(handoffPath);
const original42 = Object.entries(JSON.parse(auditBytes)).flatMap(([classification, rows]) => rows.map(row => ({
  classification, auditName: row.name, id: row.name.replace(/^(additive )?native exact bytes: /u, ''),
  cohort: row.name.startsWith('additive ') ? 'additive' : 'independent',
})));
assert.equal(original42.length, 42);
const cohorts = cohortFiles.map(specification => {
  const bytes = frozenFile(specification.path);
  const data = JSON.parse(bytes);
  assert.equal(data.cases.length, specification.count);
  assert.equal(data.provenance.executableSha256, executableSha256);
  return { ...specification, sha256: digest(bytes), cases: data.cases, profile: data.provenance };
});
const historical = cohorts.flatMap(cohort => cohort.cases.map(vector => ({ ...vector, cohort: cohort.cohort })));
assert.equal(historical.length, 236);
assert.equal(new Set(historical.map(vector => vector.id)).size, 236);
for (const original of original42) assert.equal(historical.filter(vector => vector.id === original.id && vector.cohort === original.cohort).length, 1);
function capture(vector) {
  if (!vector.stages) return { ...vector, expected: invoke(vector.argv, vector.inputHex, vector.files) };
  let inputHex = vector.inputHex;
  const stages = vector.stages.map(stage => {
    const argv = Array.isArray(stage) ? stage : stage.argv;
    const expected = invoke(argv, inputHex, vector.files);
    const captured = { argv, inputHex, expected };
    inputHex = expected.stdoutHex;
    return captured;
  });
  return { ...vector, stages, expected: { status: stages.at(-1).expected.status, stdoutHex: inputHex, stderrHex: stages.map(stage => stage.expected.stderrHex).join('') } };
}
const historicalRecheck = [];
for (const vector of historical) {
  const captured = capture(vector);
  assert.deepEqual(captured.expected, bytesResult(vector.expected), vector.id);
  if (vector.stages) for (const [index, stage] of vector.stages.entries()) assert.deepEqual(captured.stages[index].expected, bytesResult(stage.expected), `${vector.id} stage ${index}`);
  historicalRecheck.push({ id: vector.id, cohort: vector.cohort, nativeExact: true });
}
assert.equal(cases.length, 20);
assert.equal(new Set(cases.map(vector => vector.id)).size, 20);
const frozen = cases.map(vector => {
  const captured = capture(vector);
  return {
    ...captured,
    inputSha256: digest(Buffer.from(vector.inputHex, 'hex')),
    stdoutSha256: digest(Buffer.from(captured.expected.stdoutHex, 'hex')),
    stderrSha256: digest(Buffer.from(captured.expected.stderrHex, 'hex')),
  };
});
assert.equal(digest(readFileSync(executable)), executableSha256);
const document = {
  phase: 'PREPARATION ONLY; native expectations, not production validation', capturedAt: new Date().toISOString(),
  provenance: { executable, executableSha256, version, build, environment, platform: process.platform, architecture: process.arch, node: process.version,
    timeoutMs: 2000, maxBytesPerStream: 65536, shell: false, inputEncoding: 'hex', fixtureIsolation: 'fresh directory below owned subtree per native argv spawn',
    transport: 'native whole writes; virtual all-boundary splits checked later; native OS read coalescing is not controlled',
    pipelineOracle: 'sequential native argv stages, last-stage status and concatenated stage stderr; no native shell spawned',
    invocationsIncludingMetadata: invocations },
  cases: frozen,
};
const nativeSha256 = addArtifact('native-frozen.json', document);
const manifest = {
  phase: 'PREP; source moving; no final author handoff received', capturedAt: document.capturedAt,
  auditCommit, audit: { path: auditPath, sha256: digest(auditBytes) }, handoff: { path: handoffPath, sha256: digest(handoffBytes) },
  original42, cohorts: cohorts.map(({ cases: unused, ...specification }) => specification),
  historicalNativeRecheck: { total: 236, pass: 236, results: historicalRecheck },
  independent: { path: 'native-frozen.json', sha256: nativeSha256, count: 20, caseSpecificationSha256: digest(readFileSync(join(directory, 'cases.mjs'))) },
  movingSourceAtFreeze: sourceSnapshot(),
};
const manifestSha256 = addArtifact('manifest.json', manifest);
console.log(JSON.stringify({ historicalNative: 236, independentNative: 20, invocations, nativeSha256, manifestSha256 }, null, 2));
