import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = JSON.parse(readFileSync(new URL('./CAPTURES.json', import.meta.url)));
const archive = Buffer.from(readFileSync(new URL('./CAPTURES.json.gz.base64', import.meta.url)).toString(), 'base64');
assert.equal(hash(archive), metadata.archiveSha256);
const data = JSON.parse(gunzipSync(archive));
assert.deepEqual(Object.keys(data).sort(), metadata.files.map(file => file.path).sort());
for (const file of metadata.files) {
  const bytes = Buffer.from(data[file.path], 'base64'); assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256, file.path);
}
const text = name => Buffer.from(data[name], 'base64').toString();
const json = name => JSON.parse(text(name));
assert.match(text('author-07.tap'), /# tests 119\n# suites 0\n# pass 119\n# fail 0\n# cancelled 0\n# skipped 0/u);
assert.equal(text('types-06.log'), '');
const compiled = json('compiled-final/REPORT.json');
assert.equal(compiled.status, 'pass'); assert.equal(compiled.runtime.passed, 4); assert.equal(compiled.cleanup, true);
assert.equal(Object.keys(compiled.sourceInputs).length, 21); assert.equal(Object.keys(compiled.emittedBefore).length, 84);
assert.deepEqual(compiled.emittedBefore, compiled.emittedAfter);
for (const [path, expected] of Object.entries({ ...metadata.sourceFiles, ...compiled.sourceInputs })) {
  assert.equal(hash(execFileSync('git', ['--no-replace-objects', 'show', metadata.source + ':' + path])), expected, path);
}
const mutants = json('mutants/REPORT.json');
assert.deepEqual(mutants.rows.map(row => row.status), [0, 1, 0, 1, 0, 1]); assert.equal(mutants.executionRemoved, true);
const reference = json('pandoc/REPORT.json');
assert.deepEqual([reference.total, reference.exact, reference.different, reference.errors], [16, 5, 11, 0]);
console.log(JSON.stringify({ source: metadata.source, rawFiles: metadata.files.length, canonical: '119/119', compiled: '4/4', mutants: '3/3 detected', reference: '5 exact/11 different/0 errors', unchangedEmittedFiles: 84 }));
