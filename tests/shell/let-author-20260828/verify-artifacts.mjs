import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, lstatSync, readlinkSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url));
const evidence = join(own, 'evidence-v1');
const inputs = JSON.parse(readFileSync(join(evidence, 'INPUTS.json')));
const report = JSON.parse(readFileSync(join(evidence, 'REPORT.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tools = new Map(inputs.tools.filter(row => !row.metadataOnly).map(row => [row.path, row]));
for (const row of inputs.tools) {
  if (row.metadataOnly) { assert(lstatSync(row.path).isSymbolicLink()); assert.equal(readlinkSync(row.path), row.alias); }
  else { assert(lstatSync(row.path).isFile()); assert.equal(hash(readFileSync(row.path)), row.sha256, row.path); }
}
const loads = join(evidence, 'archive-validator-v2-tool-loads.jsonl'); writeFileSync(loads, '', { flag: 'wx' });
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith('node:')) return nextLoad(url, context);
  const filename = fileURLToPath(url); const binding = tools.get(filename); assert(binding, `UNBOUND_TOOL:${url}`);
  assert.equal(hash(readFileSync(filename)), binding.sha256); const result = nextLoad(url, context);
  if (result.source != null) assert.equal(hash(typeof result.source === 'string' ? Buffer.from(result.source) : result.source), binding.sha256);
  appendFileSync(loads, JSON.stringify({ url, sha256: binding.sha256 }) + '\n'); return result;
} });
const { list } = await import(pathToFileURL(join(inputs.npm, 'node_modules/tar/dist/esm/index.js')));
const verifyArchive = async (filename, expected, prefix, expectedSHA256) => {
  assert.equal(hash(readFileSync(filename)), expectedSHA256);
  const seen = new Set(); const rows = [];
  await list({ file: filename, strict: true, maxReadSize: 65536, onReadEntry(entry) {
    assert.equal(entry.type, 'File', entry.path); assert(entry.path.startsWith(prefix));
    const name = entry.path.slice(prefix.length); assert(!name.split('/').includes('AGENTS.md')); assert(!seen.has(name));
    const binding = expected[name]; assert(binding, `UNLISTED_ARCHIVE_ENTRY:${name}`); seen.add(name);
    assert.equal(entry.mode & 0o777, binding.mode & 0o777, name);
    assert.equal(entry.size, binding.bytes, name);
    const digest = createHash('sha256'); let count = 0;
    entry.on('data', bytes => { count += bytes.length; assert(count <= binding.bytes); digest.update(bytes); });
    entry.on('end', () => { const sha256 = digest.digest('hex'); assert.equal(count, binding.bytes); assert.equal(sha256, binding.sha256, name); rows.push({ path: name, bytes: count, mode: entry.mode & 0o777, sha256 }); });
  } });
  assert.deepEqual([...seen].sort(), Object.keys(expected).sort()); assert.equal(rows.length, seen.size);
  assert.equal(hash(readFileSync(filename)), expectedSHA256);
  return { filename, sha256: expectedSHA256, members: rows.length, totalBytes: rows.reduce((total, row) => total + row.bytes, 0), regularFilesOnly: true, materialized: false };
};
const sourceExpected = Object.fromEntries(inputs.sourceInputs.map(row => [row.path, { mode: row.mode, bytes: row.bytes, sha256: row.sha256 }]));
const packInfo = JSON.parse(readFileSync(join(evidence, 'pack-first.stdout.data')))[0];
const sourceBinding = JSON.parse(readFileSync(join(evidence, 'source.binding.json')));
const packageExpected = Object.fromEntries(packInfo.files.map(row => [row.path, { mode: row.mode, bytes: row.size, sha256: sourceBinding.files[row.path] }]));
const archiveBinding = JSON.parse(readFileSync(join(evidence, 'SELECTED-ARCHIVE-V2.json')));
assert.equal(archiveBinding.candidate, inputs.candidate);
const sourceArchive = await verifyArchive(join(evidence, archiveBinding.file), sourceExpected, '', archiveBinding.sha256);
const packageArchive = await verifyArchive(join(evidence, 'pack-first', packInfo.filename), packageExpected, 'package/', report.pack.sha256);
assert.equal(hash(readFileSync(join(evidence, 'pack-second', packInfo.filename))), report.pack.sha256);
for (const command of readFileSync(join(evidence, 'COMMANDS.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)) {
  assert.equal(command.failure, null); assert.equal(command.signal, null); assert.equal(command.groupAbsent, true);
  for (const stream of ['stdout', 'stderr']) assert.equal(hash(readFileSync(join(evidence, `${command.id}.${stream}.data`))), command[`${stream}SHA256`]);
}
for (const layout of ['source', 'moved']) {
  const rows = readFileSync(join(evidence, `${layout}.stdout.data`), 'utf8').trim().split('\n').map(JSON.parse);
  const observations = rows.filter(row => row.observation).map(row => row.observation);
  assert.equal(observations.length, 103); assert.equal(observations.filter(row => row.pass).length, 100);
  assert.deepEqual(observations.filter(row => !row.pass).map(row => row.id), ['P39', 'P58', 'A23-child-drain']);
  for (const row of observations) assert.equal(row.created, row.disposed);
}
assert.equal(report.mutants.length, 7); assert(report.mutants.every(row => row.killed));
assert.equal(report.regressions.code, 0); assert(report.regressions.tail.includes('# pass 167'));
assert.equal(report.types.filter(row => row.pass).length, 4);
assert.equal(report.types.find(row => row.name === 'negative-api').diagnostics[0], 'negative-api.mts(1,10): error TS2724: \'"virtual-bash"\' has no exported member named \'createLetCommands\'. Did you mean \'createFileCommands\'?');
const result = { schema: 'let-author-artifact-validation-v2', sourceArchive, packageArchive, commandReceipts: 32, sourceAndMovedHistoricalFailuresPreserved: true, mutantsQualified: 7, originalTypeMatcherRejectPreserved: true, rejectedArchiveV1Preserved: true, productReruns: 0, nativeExecutions: 0 };
writeFileSync(join(evidence, 'ARTIFACT-VALIDATION.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
