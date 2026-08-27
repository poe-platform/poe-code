import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const directory = fileURLToPath(new URL('./', import.meta.url));
const base = 'tests/stress/harness-timing-20260827/';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const read = path => readFileSync(root + path);
assert(!existsSync(directory + 'acceptance-freeze.json'), 'freeze is immutable');
assert(!existsSync('/tmp/harness-timing-author-ready.txt'), 'freeze must precede handoff');
const manifest = JSON.parse(read(base + 'frozen/manifest.json'));
const verified = manifest.records.map(record => {
  const path = `${base}frozen/${record.origin}/${record.path}.txt`;
  const bytes = read(path);
  assert.equal(digest(bytes), record.sha256, path);
  assert.equal(bytes.length, record.bytes, path);
  assert.deepEqual(bytes, git('show', `7e828a4:${path}`), path);
  if (record.origin !== 'initial-working') {
    const revision = record.origin === 'fullgate-source' ? manifest.baseline : manifest.routing;
    assert.deepEqual(bytes, git('show', `${revision}:${record.path}`), path);
  }
  return { ...record, snapshot: path, verified: true };
});
const fixturePath = 'tests/commands/structured-stress/jq-grammar-author-20260827/native-boundary-frozen.json';
const fixture = JSON.parse(read(`${base}frozen/fullgate-source/${fixturePath}.txt`));
const transports = ['whole', 'bytewise', ...[1, 2, 3, 16381, 16382, 16383, 16384, 16385, 16386].map(offset => `split:${offset}`)];
assert.equal(fixture.vectors.length, 15);
const expectations = fixture.vectors.flatMap(vector => ['direct', 'shell'].flatMap(route => transports.map(transport => ({
  id: vector.id, route, transport, argv: vector.argv,
  inputSha256: digest(Buffer.from(vector.inputHex, 'hex')),
  inputBytes: vector.inputHex.length / 2, files: vector.files ?? {}, expected: vector.expected,
}))));
assert.equal(expectations.length, 330);
assert.equal(manifest.failures.length, 14);
const sourceBaseline = manifest.sourceHashes.files ?? manifest.sourceHashes;
const source = Object.fromEntries(Object.keys(sourceBaseline).filter(path => path.startsWith('src/')).map(path => [path, digest(read(path))]));
const result = {
  frozenAt: new Date().toISOString(), activity: 'static reads only; no product/native execution',
  head: git('rev-parse', 'HEAD').toString().trim(), staticFreeze: '7e828a4',
  status: git('status', '--short').toString(), index: git('diff', '--cached', '--name-only').toString(),
  acceptanceSha256: digest(read(base + 'review/ACCEPTANCE.md')),
  manifestSha256: digest(read(base + 'frozen/manifest.json')), verified,
  fixtureSha256: digest(read(`${base}frozen/fullgate-source/${fixturePath}.txt`)),
  vectors: 15, executions: expectations.length, expectations,
  productLimits: { maxInputBytes: 65536, maxOutputBytes: 65536, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000 },
  native: { argv: ['rg', '--no-config', 'foo', '-'], originalIntervalMs: 25,
    inputHex: '666f6f0a000a6e6f0a', expected: { code: 0, stdout: 'foo\nbinary file matches (found "\\0" byte around offset 4)\n', stderr: '' },
    wholeWrite: { code: 0, stdout: 'binary file matches (found "\\0" byte around offset 4)\n', stderr: '' } },
  source, sourceChangesSinceAuthorStaticFreeze: Object.keys(source).filter(path => source[path] !== sourceBaseline[path]),
  historical: { routing: manifest.routing, baseline: manifest.baseline, tests: 15958, pass: 15769, fail: 110, skip: 79, selectedFailures: manifest.failures },
  rootNotes: readFileSync('/tmp/harness-timing-root-notes.txt', 'utf8'),
  checkpoint: readFileSync('/tmp/regex-production-checkpoint-closed.txt', 'utf8'),
};
writeFileSync(directory + 'acceptance-freeze.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verifiedSnapshots: verified.length, vectors: 15, expectations: expectations.length, sourceFiles: Object.keys(source).length, sourceChanges: result.sourceChangesSinceAuthorStaticFreeze }));
