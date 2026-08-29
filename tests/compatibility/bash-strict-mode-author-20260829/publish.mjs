import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url));
const outer = process.argv[2];
assert.ok(typeof outer === 'string' && outer.startsWith('/tmp/bash-strict-unit2-launch-'));
const log = fs.openSync(path.join(outer, 'publication-start.json'), 'wx');
fs.writeSync(log, JSON.stringify({ role: 'EVIDENCE_PUBLICATION_ONLY', started: new Date().toISOString() })); fs.closeSync(log);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = [];
try {
  function read(filename, max = 8 * 1024 * 1024) {
    assert.ok(!filename.split('/').includes('AGENTS.md'));
    const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= max);
    const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size); return bytes;
  }
  const terminal = JSON.parse(read(path.join(outer, 'TERMINAL.json')));
  assert.equal(terminal.closed, true); assert.equal(terminal.signal, null); assert.deepEqual(terminal.signals, []);
  const lines = read(path.join(outer, 'stdout')).toString().trim().split('\n').map(line => JSON.parse(line));
  const root = lines[0].output;
  assert.ok(root.startsWith('/tmp/strict-mode-author-'));
  const result = JSON.parse(read(path.join(root, 'RESULT.json')));
  assert.equal(result.source.computedTree, '26215b99cb379a9f825f803454f758fab5a3c8e9');
  assert.equal(result.executor.source, terminal.sourceSha256);
  const preparation = JSON.parse(read(path.join(own, 'PREPARATION-ROOT.json'))).root;
  for (const [label, directory] of [['preparation', preparation], ['outer', outer], ['run', root]]) {
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name), stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink());
      if (!stat.isFile() || name.endsWith('.tgz')) continue;
      assert.ok(/\.(?:json|jsonl|stdout|stderr|nul)$/.test(name) || ['stdout', 'stderr'].includes(name), name);
      const bytes = read(filename);
      raw.push({ path: `${label}/${name}`, bytes: bytes.length, sha256: hash(bytes), dataBase64: bytes.toString('base64') });
    }
  }
  const rawBytes = raw.reduce((total, row) => total + row.bytes, 0); assert.ok(rawBytes < 32 * 1024 * 1024);
  const archive = gzipSync(Buffer.from(JSON.stringify({ role: 'SOURCE_BOUND_AUTHOR_RAW_CAPTURE', raw })));
  const destination = path.join(own, 'results-v1'); fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'RAW.json.gz'), archive, { flag: 'wx' });
  const packageBytes = read(path.join(root, result.package.file), 4 * 1024 * 1024);
  assert.equal(hash(packageBytes), result.package.sha256);
  fs.writeFileSync(path.join(destination, result.package.file), packageBytes, { flag: 'wx' });
  const rows = result.cohorts.map(row => ({ label: row.label, cases: row.cases.length, pass: row.pass, fail: row.fail }));
  const receipt = {
    role: 'AUTHOR_RESOLVED_SUBSET_NOT_INDEPENDENT_ACCEPTANCE', date: '2026-08-29',
    sourceCommit: '928be5585f05c15867fbbb5f4b5debe153b0734e', presealCommit: '30af0d840b8b05b8386c14d86143d1ed3ccbd4ad',
    candidate: result.source.computedTree, sourceSha256: result.executor.source, inputCount: result.source.inputs.length,
    status: result.status, terminal, elapsedMs: result.elapsedMs, cohorts: rows,
    types: result.types.map(({ label, negative, pass, errors }) => ({ label, negative, pass, errors })),
    controls: result.controls, failures: result.failures, cleanup: result.cleanup,
    package: { file: result.package.file, sha256: result.package.sha256, bytes: packageBytes.length, members: result.package.manifest.files.length },
    raw: { records: raw.length, bytes: rawBytes, compressedBytes: archive.length, sha256: hash(archive) },
    captureBytes: result.captureBytes, actualScratchBytes: result.actualScratchBytes,
    design: { original: 50, knownExecutedPerLayout: 39, additionalPerLayout: 11, openUnexecuted: ['U06','U07','U17','U27','U28','U31','U32','U33','U34','U35','U36'], nativeGoldens: 0 },
    executionExclusions: { native: result.nativeRuns, private: result.privateRuns, compiler: 'one scoped production build and six strict consumer invocations; no rawHEAD build', engine: 0, network: 0, fullGate: 0 },
    retainedRoots: { preparation, outer, run: root },
    qualification: result.qualification,
  };
  fs.writeFileSync(path.join(destination, 'SUMMARY.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) { fs.writeFileSync(path.join(outer, 'publication-error.json'), JSON.stringify({ error: String(error), stack: error?.stack }), { flag: 'wx' }); throw error; }
