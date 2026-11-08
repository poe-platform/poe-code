import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const capture = fs.mkdtempSync('/tmp/conditional-v5-publication-');
const descriptor = fs.openSync(path.join(capture, 'receipt.json'), 'wx');
try {
  assert.deepEqual(process.argv.slice(2), ['--publish']);
  const own = path.dirname(new URL(import.meta.url).pathname);
  const root = '/tmp/conditional-author-gq4Ndd';
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const read = (filename, maximum = 16 * 1024 * 1024) => {
    assert.notEqual(path.basename(filename), 'AGENTS.md');
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
    return fs.readFileSync(filename);
  };
  const result = JSON.parse(read(path.join(root, 'RESULT.json')));
  assert.equal(result.status, 'AUTHOR_SCOPED_PASS');
  assert.equal(result.source.computedTree, '74dfe69135a3fc5ba89396b20dd32d9c9daae131');
  for (const row of result.source.inputs) assert.equal(hash(read(path.join(root, 'source', row.path))), row.sha256);
  const records = [];
  let rawBytes = 0;
  const append = (filename, name) => {
    const bytes = read(filename);
    rawBytes += bytes.length;
    assert.ok(rawBytes <= 40 * 1024 * 1024);
    records.push({ name, bytes: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64') });
  };
  for (const name of fs.readdirSync(root).sort()) {
    const filename = path.join(root, name);
    if (fs.lstatSync(filename).isFile()) append(filename, 'run/' + name);
  }
  for (const [label, outer] of [['v4', '/tmp/bash-conditional-launch-28iNV1'], ['v5', '/tmp/bash-conditional-launch-5syhIf']]) {
    for (const name of fs.readdirSync(outer).sort()) append(path.join(outer, name), label + '/' + name);
  }
  const packageBytes = read(result.package.file);
  assert.equal(hash(packageBytes), result.package.sha256);
  append(result.package.file, 'package/product.tgz');
  const archive = gzipSync(Buffer.from(JSON.stringify(records)), { level: 9 });
  const restored = JSON.parse(gunzipSync(archive, { maxOutputLength: 60 * 1024 * 1024 }));
  assert.equal(restored.length, records.length);
  for (const record of restored) {
    const bytes = Buffer.from(record.base64, 'base64');
    assert.equal(bytes.length, record.bytes); assert.equal(hash(bytes), record.sha256);
  }
  const destination = path.join(own, 'results-v5');
  fs.mkdirSync(destination);
  const summary = {
    candidate: result.source.computedTree, sourceCommit: result.source.overlay,
    sourceManifestSha256: hash(read(path.join(own, 'SOURCE-v4.json'))),
    package: { bytes: result.package.bytes, sha256: result.package.sha256, members: result.package.members.length },
    main: { pass: 531, cases: 531, perLayout: { conditional: 67, strict: 50, redirections: 48, arrays: 12 } },
    restored: result.cohorts.filter(row => row.label.endsWith('-restored')).map(row => ({ label: row.label, pass: row.pass })),
    lifecycle: result.cohorts.flatMap(cohort => (cohort.cases ?? []).filter(row => ['H02-v4', 'S01-registered'].includes(row.id)).map(row => ({ layout: cohort.label, ...row }))),
    types: result.types.map(row => ({ label: row.label, negative: row.negative, pass: row.pass, diagnostics: row.errors.length })),
    controls: result.controls, cleanup: result.cleanup, elapsedMs: result.elapsedMs,
    captureBytes: result.captureBytes, scratchBytes: result.actualScratchBytes,
    archive: { records: records.length, rawBytes, compressedBytes: archive.length, sha256: hash(archive) },
    qualification: 'Versioned author checks, not historical H02 rescore or independent/native acceptance. V4 launcher syntax failure retained; V5 same source and grant origin. Selected110 retained identities/layout, other91 not rerun. No private/native/engine execution.'
  };
  fs.writeFileSync(path.join(destination, 'RAW.json.gz'), archive, { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'RESULT.json'), read(path.join(root, 'RESULT.json')), { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'SUMMARY.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'CAPTURE-INVENTORY.json'), JSON.stringify(records.map(({ base64, ...record }) => record), null, 2) + '\n', { flag: 'wx' });
  fs.writeSync(descriptor, JSON.stringify({ capture, destination, summary }, null, 2));
  console.log(JSON.stringify({ destination, package: summary.package, archive: summary.archive }));
} catch (error) {
  fs.writeSync(descriptor, JSON.stringify({ error: String(error?.stack ?? error) }));
  throw error;
} finally {
  fs.closeSync(descriptor);
}
