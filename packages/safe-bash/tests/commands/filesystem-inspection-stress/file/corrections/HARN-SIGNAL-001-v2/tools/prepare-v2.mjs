import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const originalRoot = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file';
const v1Root = join(originalRoot, 'corrections/HARN-SIGNAL-001');
const peerRoot = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/harness-review';
const sealed = '/private/tmp/safe-bash-file-holdout.KyVGrl0A';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const verified = [];
for (const directory of [originalRoot, v1Root]) {
  const manifest = JSON.parse(await readFile(join(directory, 'PUBLICATION.json')));
  for (const entry of manifest.entries) assert.equal(hash(await readFile(join(directory, entry.path))), entry.sha256, entry.path);
  verified.push({ root: directory, files: manifest.entries.length, publicationRoot: manifest.publicationRootSha256 });
}
const preseal = JSON.parse(await readFile(join(originalRoot, 'PRESEAL.json')));
const catalogBytes = await readFile(join(sealed, 'seal-catalog.json'));
assert.equal(hash(catalogBytes), preseal.privateCatalogSha256);
const catalog = JSON.parse(catalogBytes);
for (const entry of catalog.artifacts) {
  const location = join(sealed, entry.relativePath);
  const bytes = entry.type === 'symlink-target' ? Buffer.from(await readlink(location)) : await readFile(location);
  assert.equal(hash(bytes), entry.sha256, entry.relativePath);
}
for (const directory of ['history', 'runner', 'peer', 'evidence']) await mkdir(join(root, directory));
const original = await readFile(join(v1Root, 'runner/corrected-observed-runner.mjs'), 'utf8');
assert.equal(hash(original), '3eda4cf112e7a30685b67e1ac942b9fc1521eae4e2acef2f657b3c9522a18fb4');
await writeFile(join(root, 'history/v1-corrected-observed-runner.mjs'), original, { flag: 'wx', mode: 0o400 });
await copyFile(join(v1Root, 'runner/corrected-assertions-runner.mjs'), join(root, 'history/v1-corrected-assertions-runner.mjs'));
const peerFiles = [];
for (const [source, name] of [
  [join(peerRoot, 'SAFETY_FINDINGS.md'), 'SAFETY_FINDINGS.md'],
  [join(peerRoot, 'correction-counterchecks.mjs'), 'correction-counterchecks.mjs'],
  ['/tmp/safe-bash-inspection-correction-counterchecks.json', 'original-counterchecks.json'],
]) {
  const bytes = await readFile(source);
  await writeFile(join(root, 'peer', name), bytes, { flag: 'wx', mode: 0o400 });
  assert.equal(hash(await readFile(source)), hash(bytes), 'Peer input changed during capture');
  peerFiles.push({ source, copy: `peer/${name}`, bytes: bytes.length, sha256: hash(bytes) });
}
const peerRaw = JSON.parse(await readFile(join(root, 'peer/original-counterchecks.json')));
const peerF29 = peerRaw.observations.find((entry) => entry.id === 'F29-valid-composed-signal-cleaned-after-success');
assert.equal(peerF29.postCompletionAccepted, false);
await writeFile(join(root, 'peer/F29-original-observation.json'), `${JSON.stringify({ originalFileSha256: peerFiles.at(-1).sha256, observation: peerF29 }, null, 2)}\n`);
const caseStart = "  await record('F29', async (row) => {";
const nextCase = "  for (const [id, unknown] of [['F30', false], ['F31', true]])";
const start = original.indexOf(caseStart);
const end = original.indexOf(nextCase, start);
assert(start >= 0 && end > start);
const oldCase = original.slice(start, end);
const observationChanges = [
  {
    before: "    const invocation = await invoke(rig.fs, ['-b', '--mime', '/input']);",
    after: `    const fsEntrySnapshots = [];
    const entryObservedFs = new Proxy(rig.fs, {
      get(target, method, receiver) {
        const operation = Reflect.get(target, method, receiver);
        if (typeof operation !== 'function') return operation;
        return (...args) => {
          const options = args.findLast((argument) => argument && typeof argument === 'object' && !(argument instanceof Uint8Array));
          const signal = options?.signal;
          fsEntrySnapshots.push(Object.freeze({
            method: String(method), path: args[0], signalPresentAtEntry: signal !== undefined,
            isAbortSignalAtEntry: signal instanceof AbortSignal,
            abortedAtEntry: signal?.aborted, reasonAtEntry: signal?.reason,
            maxBytesAtEntry: options?.maxBytes,
          }));
          return Reflect.apply(operation, target, args);
        };
      },
    });
    const invocation = await invoke(entryObservedFs, ['-b', '--mime', '/input']);`,
  },
  {
    before: '    row.evidence.trace = traceJson(rig.trace);',
    after: '    row.evidence.trace = traceJson(rig.trace);\n    row.evidence.fsEntrySnapshots = fsEntrySnapshots;',
  },
];
const assertionChanges = [
  {
    before: '    for (const entry of rig.trace) {\n      assert(entry.options?.signal instanceof AbortSignal);\n      assert.equal(entry.options.signal.aborted, false);\n      assert.equal(entry.options.signal.reason, undefined);\n    }',
    after: '    for (const entry of fsEntrySnapshots) {\n      assert.equal(entry.signalPresentAtEntry, true);\n      assert.equal(entry.isAbortSignalAtEntry, true);\n      assert.equal(entry.abortedAtEntry, false);\n      assert.equal(entry.reasonAtEntry, undefined);\n    }',
  },
];
function transform(text, changes) {
  for (const change of changes) {
    assert.equal(text.split(change.before).length, 2, 'Unique F29 anchor');
    text = text.replace(change.before, change.after);
  }
  return text;
}
const observedCase = transform(oldCase, observationChanges);
const finalCase = transform(observedCase, assertionChanges);
const observedRunner = original.slice(0, start) + observedCase + original.slice(end);
const finalRunner = original.slice(0, start) + finalCase + original.slice(end);
await writeFile(join(root, 'runner/v2-observation-only-runner.mjs'), observedRunner, { flag: 'wx', mode: 0o400 });
await writeFile(join(root, 'runner/v2-runner.mjs'), finalRunner, { flag: 'wx', mode: 0o400 });
const metadata = {
  issue: 'HARN-SIGNAL-001-v2', preparedAt: new Date().toISOString(), authorizedScope: ['F29 observation time and associated assertions', 'nonproduct lifecycle mocks'],
  productRunsAuthorized: false, productExecutions: 0, nativeCalls: 0,
  reason: 'Peer HOLD: legitimate successful cleanup can abort composed signals after FS entry; test entry-time state instead of settlement-time mutable signal state.',
  originalPreseal: preseal.artifactRootSha256, originalRunnerSha256: hash(original), observationOnlyRunnerSha256: hash(observedRunner), v2RunnerSha256: hash(finalRunner),
  unchangedBeforeF29Sha256: hash(original.slice(0, start)), unchangedAfterF29Sha256: hash(original.slice(end)),
  observationChanges, assertionChanges, verifiedHistory: verified, sealedArtifactsVerified: catalog.artifacts.length, peerFiles,
  preservation: ['F33/F34 exact v1 text including signal propagation, exact reason, return count, genuine late injection and telemetry', 'all other cases', 'successful PNG/stdout/status/stderr and readFile-use assertions', 'original readFile fixture maxBytes guard and exact forwarded arguments/promise', 'all native/MIME/human/status fixtures'],
  maxBytesBoundary: 'Capture maxBytesAtEntry and preserve original options/guard/trace unchanged. Do not invent an exact maxBytes value or new family-limit policy. Nonproduct tests verify exact forwarding and whole-file size guard.',
  observationPolicy: 'Synchronous entry snapshot before Reflect.apply; primitive presence/type/aborted fields and entry-time reason value; no AbortSignal reference retained in snapshots; no await/then/catch or added promise handlers.',
};
await writeFile(join(root, 'v2-correction.json'), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
for (const [before, after, name] of [
  ['history/v1-corrected-observed-runner.mjs', 'runner/v2-observation-only-runner.mjs', 'observation-only.diff'],
  ['runner/v2-observation-only-runner.mjs', 'runner/v2-runner.mjs', 'entry-time-assertions.diff'],
]) {
  const result = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--color=never', join(root, before), join(root, after)], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  await writeFile(join(root, name), result.stdout, { flag: 'wx' });
}
console.log(JSON.stringify({ v2RunnerSha256: metadata.v2RunnerSha256, historyFilesVerified: verified.map((entry) => entry.files), sealedArtifactsVerified: catalog.artifacts.length, peerF29FailurePreserved: true, productExecutions: 0 }, null, 2));
