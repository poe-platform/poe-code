import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { own, repo, sha, objectHash } from './prepare.mjs';

assert.deepEqual(process.argv.slice(2), ['--data-only']);
const encoded = fs.readFileSync(path.join(own, 'results-v1/RAW.json.gz.base64'));
assert.equal(sha(encoded), '7d7c98511f17525a756d09ef0eb1ed487d3cd095ecb3062ed3d43097831c348d');
const raw = JSON.parse(gunzipSync(Buffer.from(encoded.toString().trim(), 'base64'), { maxOutputLength: 33554432 }));
const result = raw.result, source = JSON.parse(fs.readFileSync(path.join(own, 'SOURCE.json')));
assert.deepEqual(source, result.source);
for (const row of raw.files) if (Object.hasOwn(row, 'base64')) { const bytes = Buffer.from(row.base64, 'base64'); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); }
const parseTar = (filename, expected) => {
  const gzip = Buffer.from(fs.readFileSync(filename).toString().trim(), 'base64'); assert.equal(sha(gzip), expected);
  const bytes = gunzipSync(gzip, { maxOutputLength: 67108864 }), rows = []; let cursor = 0;
  while (bytes[cursor] !== 0 && cursor + 512 <= bytes.length) {
    const header = bytes.subarray(cursor, cursor + 512), name = header.subarray(0, 100).toString().split('\0')[0], length = Number.parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8), mode = Number.parseInt(header.subarray(100, 108).toString().replace(/\0/g, '').trim(), 8);
    assert.ok(name.startsWith('package/') && !name.split('/').some(part => part === '..' || part === 'AGENTS.md'));
    assert.ok(header[156] === 0 || header[156] === 48); assert.ok(Number.isSafeInteger(length) && length >= 0 && length <= bytes.length - cursor - 512);
    let sum = 0; for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 32 : header[index]; assert.equal(sum, Number.parseInt(header.subarray(148, 156).toString().replace(/\0/g, '').trim(), 8));
    rows.push({ path: name.slice(8), mode, bytes: length, sha256: sha(bytes.subarray(cursor + 512, cursor + 512 + length)) }); cursor += 512 + Math.ceil(length / 512) * 512;
  }
  assert.ok(bytes.subarray(cursor).every(byte => byte === 0)); assert.equal(new Set(rows.map(row => row.path)).size, rows.length); return rows;
};
const previous = parseTar(path.join(repo, 'tests/integration/apply-patch-public-20260829/results-v1/PACKAGE.tgz.base64'), '643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd');
const current = parseTar(path.join(own, 'results-v1/PACKAGE.tgz.base64'), result.package.sha256); assert.deepEqual(current, result.package.members);
const prior = new Map(previous.map(row => [row.path, row])), now = new Map(current.map(row => [row.path, row]));
const added = current.filter(row => !prior.has(row.path)), removed = previous.filter(row => !now.has(row.path));
const changed = current.filter(row => prior.has(row.path) && JSON.stringify(row) !== JSON.stringify(prior.get(row.path)));
assert.equal(added.length, 52); assert.ok(added.every(row => row.path.startsWith('dist/commands/git/'))); assert.equal(removed.length, 0);
assert.deepEqual(changed.map(row => row.path).sort(), ['README.md', 'package.json', ...['index', 'plugins/index'].flatMap(name => ['.js', '.js.map', '.d.ts', '.d.ts.map'].map(suffix => 'dist/' + name + suffix))].sort());
const baseline = JSON.parse(fs.readFileSync(path.join(repo, 'tests/integration/apply-patch-public-20260829/SOURCE-v2.json')));
const module = JSON.parse(fs.readFileSync(path.join(repo, 'tests/commands/git-pack-author-20260828/s01-v3/SOURCE.json')));
for (const row of source.module) { const accepted = module.inputs.find(item => item.path === row.path); assert.ok(accepted); for (const key of ['blob', 'mode', 'bytes', 'sha256']) assert.equal(row[key], accepted[key]); }
const changedBuild = source.inputs.filter(row => { const old = baseline.inputs.find(item => item.path === row.path); return old && old.sha256 !== row.sha256; });
assert.deepEqual(changedBuild.map(row => row.path).sort(), ['README.md', 'package.json', 'src/index.ts', 'src/plugins/index.ts'].sort());
const witnesses = [...source.ancestorTrees, ...source.fetchedTrees, ...source.reconstructedTrees];
for (const row of witnesses) assert.equal(objectHash('tree', Buffer.from(row.base64, 'base64')), row.oid);
assert.ok(witnesses.some(row => row.oid === source.computedTree));
const loads = raw.files.filter(row => row.name.endsWith('-loads.jsonl') && row.base64).map(row => {
  const records = Buffer.from(row.base64, 'base64').toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const item of records) { const marker = item.file.lastIndexOf('/dist/'); assert.ok(marker >= 0); const relative = item.file.slice(marker + 1); const expected = now.get(relative); assert.ok(expected); if (row.name !== 'registration-mutant-loads.jsonl') assert.equal(item.sha256, expected.sha256); }
  return { path: row.name, records: records.length, uniqueModules: new Set(records.map(item => item.file)).size };
});
const original = fs.readFileSync(path.join(own, 'm1a.mjs'), 'utf8'), corrected = fs.readFileSync(path.join(own, 'm1a-public-v2.mjs'), 'utf8');
const before = original.split('\n').find(line => line.startsWith("await record('PUBLIC-NEGATIVE'")), after = corrected.split('\n').find(line => line.startsWith("await record('PUBLIC-REGISTERED'"));
assert.ok(before && after); assert.equal(corrected.replace(after, before), original);
const audit = {
  role: 'POSTRUN_DATA_AUTHENTICATION_ONLY; no additional product/native execution',
  candidate: source.computedTree, sourceSha256: sha(fs.readFileSync(path.join(own, 'SOURCE.json'))), executorSha256: sha(fs.readFileSync(path.join(own, 'EXECUTOR.json'))),
  inputs: source.inputs.length, moduleFilesUnchanged: source.module.length, changedBuildInputs: changedBuild.map(row => row.path), treeWitnessesVerified: witnesses.length,
  package: { sha256: result.package.sha256, bytes: result.package.bytes, members: current.length, previousMembers: previous.length, added: added.map(row => row.path), changed: changed.map(row => row.path), removed: [], unchangedCommon: previous.length - changed.length },
  captures: { descriptors: raw.files.length, embedded: raw.files.filter(row => Object.hasOwn(row, 'base64')).length, rawSha256: sha(encoded) },
  loads, types: result.types.map(row => ({ label: row.label, negative: row.negative, pass: row.pass, diagnostics: row.errors.length, authenticatedDeclarations: row.declarations.length })),
  resources: result.cleanup, controls: result.controls, maintained: result.maintained, streamConsumer: result.streamConsumer,
  fixtureV2: { onlyChangedRow: true, originalSha256: sha(Buffer.from(original)), revisedSha256: sha(Buffer.from(corrected)), before, after, productExecutions: 0, candidateAndPackageUnchanged: true },
  failures: result.failures, qualification: 'Author semantics and exact package proof; no independent public acceptance or native/resource-map closure. Three original module-only export expectations remain failed.'
};
fs.writeFileSync(path.join(own, 'AUDIT.json'), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidate: audit.candidate, package: audit.package.sha256, members: current.length, added: added.length, changed: changed.length, loads: loads.map(row => [row.path, row.uniqueModules]), fixtureV2: audit.fixtureV2.revisedSha256 }));
