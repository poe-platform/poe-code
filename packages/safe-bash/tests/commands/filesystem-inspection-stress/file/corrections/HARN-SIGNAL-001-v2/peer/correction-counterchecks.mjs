import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress';
const tree = join(root, 'tree/corrections/n18-positive-depth');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const text = path => readFileSync(path, 'utf8');
const manifest = JSON.parse(text(join(tree, 'CORRECTION-MANIFEST.json')));
for (const entry of manifest.files) {
  const bytes = readFileSync(join(tree, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(digest(bytes), entry.sha256, entry.path);
}
const original = text(join(tree, 'original-run.mjs'));
const derived = text(join(tree, 'derived/run.mjs'));
assert.equal(digest(original), '3068e51fece206bdcab38a53f5fb47b61cdfc5a71f35900f7241bf9f291fc03d');
assert.equal(derived.replace("import { assertPositiveDepthFailure } from '../n18-predicate.mjs';\n", '')
  .replace("    if (entry.id === 'N18') assertPositiveDepthFailure({ exitCode: outcome.result.exitCode, stdout: run.stdout.bytes(), stderr: run.stderr.bytes() });", "    if (entry.id === 'N18') assert.match(text, /level|depth|invalid|positive|greater/iu);"), original);
const predicatePath = join(tree, 'n18-predicate.mjs');
assert.equal(digest(readFileSync(predicatePath)), 'f4671ade2c36b0c4aaa6fddf04f37d9ebe593f2d28aaadd8061f284ad12b0691');
const { assertPositiveDepthFailure } = await import(pathToFileURL(predicatePath).href);
const observations = [];
for (const [id, stderr, semanticallyAcceptable] of [
  ['positive-control', 'tree: -L must be between 1 and 256\n', true],
  ['irrelevant-same-line-constraint', 'tree: -L failed; width must be between 1 and 256\n', false],
  ['contradictory-next-line-zero-range', 'tree: -L must be positive\nvalid range: 0..256\n', false],
]) {
  let accepted = true;
  try { assertPositiveDepthFailure({ exitCode: 2, stdout: new Uint8Array(), stderr: new TextEncoder().encode(stderr) }); }
  catch (error) { assert(error instanceof assert.AssertionError); accepted = false; }
  observations.push({ id, stderr, semanticallyAcceptable, accepted });
}
assert.equal(observations[0].accepted, true);
assert.equal(observations[1].accepted, true);
assert.equal(observations[2].accepted, true);

const filePath = join(root, 'file/corrections/HARN-SIGNAL-001/runner/corrected-assertions-runner.mjs');
const fileSource = text(filePath);
assert.equal(digest(fileSource), '25b7344b991b97faef2c7454e2820dd7dcad0c3d32a37dc959c5afa368f8971c');
const start = fileSource.indexOf('    for (const entry of rig.trace) {');
const end = fileSource.indexOf('    row.evidence.trace', start);
assert(start >= 0 && end > start);
const caller = new AbortController();
const local = new AbortController();
const signal = AbortSignal.any([caller.signal, local.signal]);
const rig = { trace: [{ method: 'readFile', options: { signal } }] };
assert.equal(signal.aborted, false);
runInNewContext(fileSource.slice(start, end), { assert, AbortSignal, rig }, { timeout: 100 });
local.abort(new Error('successful invocation-owned cleanup'));
assert.equal(caller.signal.aborted, false);
let postCompletionAccepted = true;
try { runInNewContext(fileSource.slice(start, end), { assert, AbortSignal, rig }, { timeout: 100 }); }
catch (error) { assert(error instanceof assert.AssertionError); postCompletionAccepted = false; }
assert.equal(postCompletionAccepted, false);
observations.push({ id: 'F29-valid-composed-signal-cleaned-after-success', activeAtFsEntry: true, callerStillActive: true, postCompletionAccepted });
console.log(JSON.stringify({ at: new Date().toISOString(), treeCorrectionFilesVerified: manifest.files.length,
  boundary: 'Actual harness predicate and exact F29 assertion block only; builtins/mocks; zero product/native calls',
  meaningOfExitZero: 'Known acceptance gaps reproduced, NOT correction approval', observations }, null, 2));
