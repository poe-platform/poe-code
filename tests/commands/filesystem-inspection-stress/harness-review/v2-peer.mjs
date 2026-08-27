import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress';
const tree = join(root, 'tree/corrections/n18-positive-depth-v2');
const file = join(root, 'file/corrections/HARN-SIGNAL-001-v2');
const text = path => readFileSync(path, 'utf8');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifests = [];
for (const [folder, filename] of [
  ['tree', 'EVIDENCE-MANIFEST.json'], ['tree/corrections/n18-positive-depth', 'CORRECTION-MANIFEST.json'],
  ['tree/corrections/n18-positive-depth-v2', 'V2-MANIFEST.json'], ['file', 'PUBLICATION.json'],
  ['file/corrections/HARN-SIGNAL-001', 'PUBLICATION.json'], ['file/corrections/HARN-SIGNAL-001-v2', 'PUBLICATION.json'],
]) {
  const directory = join(root, folder);
  const manifest = JSON.parse(text(join(directory, filename)));
  const entries = manifest.entries ?? manifest.files;
  for (const entry of entries) {
    const path = join(directory, entry.path);
    const symlink = lstatSync(path).isSymbolicLink();
    assert.equal(symlink, (entry.kind ?? entry.type ?? 'file') === 'symlink', path);
    const bytes = symlink ? Buffer.from(readlinkSync(path)) : readFileSync(path);
    assert.equal(bytes.length, entry.bytes, path);
    assert.equal(digest(bytes), entry.sha256, path);
  }
  manifests.push({ path: join(folder, filename), entries: entries.length, sha256: digest(readFileSync(join(directory, filename))) });
}
const treeV1Path = join(root, 'tree/corrections/n18-positive-depth/n18-predicate.mjs');
const treeV2Path = join(tree, 'n18-predicate.mjs');
assert.equal(digest(readFileSync(treeV1Path)), 'f4671ade2c36b0c4aaa6fddf04f37d9ebe593f2d28aaadd8061f284ad12b0691');
assert.equal(digest(readFileSync(treeV2Path)), 'c38705fdc2afbecfd3dda00b4867bd6eae82074206001eadbc927e516f22171c');
const v1 = (await import(pathToFileURL(treeV1Path).href)).assertPositiveDepthFailure;
const v2 = (await import(pathToFileURL(treeV2Path).href)).assertPositiveDepthFailure;
const reply = (stderr, overrides = {}) => ({ exitCode: 2, stdout: new Uint8Array(), stderr: Buffer.from(stderr), ...overrides });
const positives = ['tree: Invalid level, must be greater than 0.\n', 'tree: -L must be between 1 and 256\n',
  'tree: depth must be a positive integer', 'tree: level must be at least 1', 'tree: -L valid range: 2..32',
  'tree: depth required range 1 to 4', 'tree: LEVEL must be greater than 2', 'tree: maximum depth must be between 1 and 4096'];
for (const diagnostic of positives) assert.doesNotThrow(() => v2(reply(diagnostic)));
const peerNegatives = ['tree: -L failed; width must be between 1 and 256\n', 'tree: -L must be positive\nvalid range: 0..256\n'];
for (const diagnostic of peerNegatives) {
  assert.doesNotThrow(() => v1(reply(diagnostic)));
  assert.throws(() => v2(reply(diagnostic)), assert.AssertionError);
}
const negatives = ['', ' \n', 'tree: width must be positive', 'tree: -L cannot open file',
  'tree: -l must be positive', 'tree: -L must be between 0 and 256', 'tree: level must be greater than -1',
  'tree: depth must be at least 0', 'tree: depth allowed range 0..64', 'tree: -L must be between 8 and 2',
  'tree: depth must be between 1.5 and 4', 'tree: -L must be between 1 and 9007199254740992',
  'tree: -L must be positive or zero', 'tree: width failed; depth must be positive',
  'tree: -L must be positive; width must be positive', 'tree: -L must be positive\nadditional context'];
for (const diagnostic of negatives) assert.throws(() => v2(reply(diagnostic)), assert.AssertionError);
for (const overrides of [{ exitCode: 0 }, { exitCode: -1 }, { exitCode: 256 }, { stdout: Buffer.from('normal output') }, { stderr: Buffer.alloc(4097, 97) }]) {
  assert.throws(() => v2(reply(positives[0], overrides)), assert.AssertionError);
}
assert.equal(text(join(tree, 'derived/run.mjs')), text(join(root, 'tree/corrections/n18-positive-depth/derived/run.mjs')));
for (const path of ['derived/corpus.mjs', 'derived/native.json', 'derived/fixture-fs.mjs', 'predicate.test.mjs']) {
  assert.equal(text(join(tree, path)), text(join(root, 'tree/corrections/n18-positive-depth', path)), path);
}

const metadata = JSON.parse(text(join(file, 'v2-correction.json')));
const oldRunner = text(join(root, 'file/corrections/HARN-SIGNAL-001/runner/corrected-observed-runner.mjs'));
const newRunner = text(join(file, 'runner/v2-runner.mjs'));
assert.equal(digest(newRunner), 'de11b74f47288916cd7fd486e91754465e53963ae0bc63c9d4a309ee2e77e756');
function splitF29(source) {
  const start = source.indexOf("  await record('F29', async (row) => {");
  const end = source.indexOf("  for (const [id, unknown]", start);
  assert(start > 0 && end > start);
  return { before: source.slice(0, start), callback: source.slice(start, end), after: source.slice(end) };
}
const before = splitF29(oldRunner);
const after = splitF29(newRunner);
assert.equal(before.before, after.before);
assert.equal(before.after, after.after);
let derived = before.callback;
for (const change of [...metadata.observationChanges, ...metadata.assertionChanges]) {
  assert.equal(derived.split(change.before).length, 2);
  derived = derived.replace(change.before, change.after);
}
assert.equal(derived, after.callback);

const fileControls = [];
async function runF29(source, variant) {
  const originalSignal = new AbortController();
  const local = new AbortController();
  const composed = AbortSignal.any([originalSignal.signal, local.signal]);
  if (variant === 'preaborted') local.abort(new Error('pre-entry abort'));
  const signal = variant === 'missing-signal' ? undefined : variant === 'duck-signal' ? { aborted: false } : composed;
  const options = { signal, maxBytes: variant === 'too-small-maxBytes' ? 1 : 65536 };
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  let rig;
  const pending = [];
  let samePromise = true;
  const environment = { assert, AbortSignal, Uint8Array,
    fixture: () => ({ bytes }), fileEntry: value => ({ bytes: value }),
    makeFs() {
      const trace = [];
      const method = name => (path, received) => {
        assert.equal(received, options);
        trace.push({ method: name, path, options: received });
        if (name === 'readFile' && received.maxBytes < bytes.length) throw new Error('mock bounded whole-file guard');
        const promise = Promise.resolve(name === 'readFile' ? bytes : { type: 'file', size: bytes.length });
        pending.push(promise);
        return promise;
      };
      rig = { fs: { lstat: method('lstat'), readFile: method('readFile') }, trace };
      return rig;
    },
    async invoke(fs) {
      const metadataPromise = fs.lstat('/input', options);
      samePromise &&= metadataPromise === pending.at(-1);
      await metadataPromise;
      if (variant !== 'no-readFile') {
        const readPromise = fs.readFile('/input', options);
        samePromise &&= readPromise === pending.at(-1);
        await readPromise;
      }
      if (variant === 'cleanup-after-entry') local.abort(new Error('successful cleanup'));
      return { stdout: variant === 'wrong-PNG' ? 'text/plain\n' : 'image/png; charset=binary\n', stderr: variant === 'wrong-stderr' ? 'unexpected\n' : '', exitCode: variant === 'wrong-status' ? 1 : 0 };
    },
    successful: invocation => { assert.equal(invocation.exitCode, 0); assert.equal(invocation.stderr, ''); },
    stdout: invocation => invocation.stdout, traceJson: trace => trace.map(entry => ({ method: entry.method })),
  };
  const callback = splitF29(source).callback.replace("  await record('F29', ", '').replace(/\);\s*$/u, '');
  const operation = runInNewContext(`(${callback})`, environment, { timeout: 100 });
  const row = { evidence: {} };
  let accepted = true;
  try { await operation(row); } catch { accepted = false; }
  assert.equal(samePromise, true, 'Entry observation must preserve original promise');
  assert.equal(originalSignal.signal.aborted, false);
  return { variant, accepted, snapshots: row.evidence.fsEntrySnapshots?.map(entry => ({ method: entry.method, activeAtEntry: !entry.abortedAtEntry, maxBytesAtEntry: entry.maxBytesAtEntry })) };
}
assert.equal((await runF29(oldRunner, 'cleanup-after-entry')).accepted, false);
for (const variant of ['active', 'cleanup-after-entry', 'preaborted', 'missing-signal', 'duck-signal', 'too-small-maxBytes', 'wrong-PNG', 'wrong-status', 'wrong-stderr', 'no-readFile']) {
  const result = await runF29(newRunner, variant);
  assert.equal(result.accepted, ['active', 'cleanup-after-entry'].includes(variant), variant);
  if (result.accepted) { assert.equal(result.snapshots.length, 2); assert(result.snapshots.every(entry => entry.activeAtEntry && entry.maxBytesAtEntry === 65536)); }
  fileControls.push(result);
}
console.log(JSON.stringify({ at: new Date().toISOString(), boundary: 'Builtin/hash checks, harness-only helper imports and exact extracted F29 callbacks with mocks; zero product/native calls',
  tree: { verdict: 'GO-scoped-finite-single-diagnostic-profile', positives: positives.length, negativeControls: peerNegatives.length + negatives.length + 5, v1FalseAcceptancesPreserved: 2 },
  file: { verdict: 'GO-scoped-F29-entry-time-predicate', controls: fileControls, F33F34OutsideTextUnchanged: true }, manifests,
  treeV2Sha256: digest(readFileSync(treeV2Path)), fileV2Sha256: digest(newRunner) }, null, 2));
