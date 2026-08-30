import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { digest, git, inventory, json, owned, policy } from './common.mjs';

const [directory, outputName] = process.argv.slice(2);
assert.match(directory ?? '', /^\/private\/tmp\/native-data-tap-independent-[A-Za-z0-9]+$/u);
assert.match(outputName ?? '', /^evidence-v\d+$/u);
const output = join(owned, outputName);
assert.equal(existsSync(output), false);
const report = JSON.parse(readFileSync(join(directory, 'REPORT.json'))), audit = JSON.parse(readFileSync(join(directory, 'AUDIT.json')));
assert.equal(audit.status, 'qualified-pass'); assert.equal(audit.executionRepeated, false);
assert.equal(report.candidate, policy.candidate); assert.equal(report.status, 'fail');
for (const row of audit.rows) { assert.deepEqual(row.resources.remaining, []); assert.deepEqual(row.resources.observedSurvivors, []); assert.equal(row.resources.killed, null); }
const preparation = JSON.parse(readFileSync(join(owned, 'preexecution.json')));
const authorBase = 'tests/integration/native-data-tap-author-20260827/evidence-v1';
const authorManifest = JSON.parse(git('show', `${policy.authorEvidence}:${authorBase}/MANIFEST.json`));
const compressed = Buffer.from(git('show', `${policy.authorEvidence}:${authorBase}/RAW.json.gz.base64`).toString().trim(), 'base64');
assert.equal(digest(compressed), authorManifest.compressedSha256);
const payload = gunzipSync(compressed); assert.equal(digest(payload), authorManifest.payloadSha256);
const authorEntries = new Map();
for (const [index, entry] of JSON.parse(payload).entries.entries()) {
  const { base64, ...metadata } = entry, bytes = Buffer.from(base64, 'base64');
  assert.deepEqual(metadata, authorManifest.entries[index]); assert.equal(digest(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes);
  authorEntries.set(entry.name, bytes);
}
const history = { authorCommit: policy.authorEvidence, priorCommit: policy.priorIndependent, authenticatedAuthorEntries: authorEntries.size, authorRows: [], prior: preparation.prior,
  distinction: 'Authenticated old/author receipt content is historical evidence only; no author score substitutes for the independently executed captures.' };
for (const name of ['baseline-node22', 'baseline-node24', 'candidate-node22', 'candidate-node24']) {
  const bytes = authorEntries.get(`final/${name}.json`), row = JSON.parse(bytes);
  for (const input of row.inputs) {
    const original = git('show', `${row.commit}:${input.path}`);
    assert.equal(digest(original), input.sha256); assert.equal(git('rev-parse', `${row.commit}:${input.path}`).toString().trim(), input.blob);
  }
  assert.deepEqual(row.beforeInventory, row.afterInventory);
  for (const child of row.children) { assert.equal(child.executable, row.executable); assert.equal(child.version, preparation.runtimeVersions.find(tool => tool.path === row.executable).version); }
  assert.equal(row.signal, null); assert.equal(row.error, undefined);
  history.authorRows.push({ name, commit: row.commit, sha256: digest(bytes), inputs: row.inputs.length, status: row.status, counts: row.counts, executable: row.executable });
}
const priorRaw = git('show', `${preparation.prior.commit}:${preparation.prior.path}`);
assert.equal(digest(priorRaw), preparation.prior.sha256);
const prior = JSON.parse(gunzipSync(priorRaw)); assert.equal(prior.status, 1); assert.match(prior.stdout, /^# pass 7$/mu); assert.match(prior.stdout, /^# fail 1$/mu);
history.prior = { ...history.prior, status: prior.status, args: prior.args, executable: prior.executable, stdoutSha256: digest(Buffer.from(prior.stdout)), stderrSha256: digest(Buffer.from(prior.stderr)) };
json(join(directory, 'history-bindings.json'), history);
const files = ['REPORT.json', 'AUDIT.json', 'history-bindings.json', 'candidate-node22.json.gz', 'candidate-node24.json.gz', 'remove-current-tap-node24.json.gz', 'historical-tap-after-glob-node24.json.gz', 'historical-forced-spec-node24.json.gz', 'guard-controls.json.gz', 'tool-guards.json.gz', 'audit-attempt-01.json.gz'];
const entries = files.map(name => { const bytes = readFileSync(join(directory, name)); return { name, bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString('base64') }; });
for (const path of ['replay.mjs', 'observe.mjs']) {
  const bytes = git('show', `aa7541ee437de93b6bc1f80b9861f795c1e35b1f:tests/integration/native-data-tap-independent-20260827/${path}`);
  assert.equal(digest(bytes), report.harness.find(entry => entry.path === path).sha256);
  entries.push({ name: `executed-${path}`, bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString('base64') });
}
const raw = Buffer.from(JSON.stringify({ schema: 1, entries }) + '\n'), archive = gzipSync(raw, { level: 9 });
const ownedFiles = inventory(owned);
for (const entry of ownedFiles) { assert.doesNotMatch(entry.path, /(?:^|\/)AGENTS\.md$|\.(?:[cm]?ts|tsx)$|\.test\./u); assert.notEqual(entry.kind, 'link'); }
mkdirSync(output);
writeFileSync(join(output, 'RAW.json.gz'), archive, { flag: 'wx' });
json(join(output, 'MANIFEST.json'), {
  schema: 1, candidate: policy.candidate, preparationCommit: report.preparationCommit, executionHarnessCommit: 'aa7541ee437de93b6bc1f80b9861f795c1e35b1f',
  rawSha256: digest(raw), archiveSha256: digest(archive), rawBytes: raw.length, archiveBytes: archive.length,
  entries: entries.map(({ base64, ...metadata }) => metadata), verdict: audit.status,
  canonical: audit.rows.filter(row => row.name.startsWith('candidate-')).map(({ name, counts, status }) => ({ name, counts, status })),
  negativeControls: audit.rows.filter(row => !row.name.startsWith('candidate-')).map(({ name, counts, status, observation }) => ({ name, counts, status, observation })),
  originalHarnessStatus: report.status, originalHarnessPassingChecks: report.checks.filter(entry => entry.pass).length, originalHarnessTotalChecks: report.checks.length,
  offlineAuditChecks: audit.checks.length, fixtureExecutionsRepeated: false, authorAndPrior: history,
  hygiene: { ownedTypeScriptFiles: 0, ownedCanonicalTestFiles: 0, ownedAgentsCopies: 0, nativeArchivesCopied: false, note: 'Only explicit JSON/gzip/.mjs/Markdown evidence; no discovery exclusions/configuration changes' },
  harnessFiles: ['common.mjs', 'policy.json', 'prepare.mjs', 'replay.mjs', 'observe.mjs', 'audit.mjs', 'seal.mjs', 'verify.mjs'].map(path => ({ path, sha256: digest(readFileSync(join(owned, path))) }))
});
const processes = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,comm=']).toString();
for (const row of audit.rows) assert.equal(processes.split('\n').some(line => Number(line.trim().split(/\s+/u)[2]) === row.resources.group), false);
rmSync(directory, { recursive: true });
assert.equal(existsSync(directory), false);
json(join(output, 'CLEANUP.json'), { at: new Date().toISOString(), directory, removed: true, observedGroups: audit.rows.map(row => row.resources.group), noGroupsRemainingBeforeRemoval: true, originalCaptureChildrenAllNatural: true,
  killTimeoutOutputLeakCount: 0, removedOnlyOwnedTemporaryDirectory: true, rawEvidencePreserved: entries.map(entry => entry.name), noFixtureRerun: true });
console.log(JSON.stringify({ output, rawArchiveBytes: archive.length, entries: entries.length, candidate: policy.candidate, verdict: audit.status, temporaryDirectoryRemoved: true }));
