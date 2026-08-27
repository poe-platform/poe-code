import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const previous = '/private/tmp/safe-bash-file-run.WeB7Vfsc';
const sealed = '/private/tmp/safe-bash-file-holdout.KyVGrl0A';
const published = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (location) => JSON.parse(await readFile(location));
const freeze = await json(join(previous, 'freeze.json'));
const build = await json(join(previous, 'build.json'));
assert.equal(freeze.commit, 'd168d18b118592e04a6eec9b00eb50cc2b1e5058');
assert.equal(freeze.sourceSha256, '606adf1a2f78b0668ec1f4cf0c3253115faf089f69c7617abd88b03fb83b5f2f');
for (const entry of [...freeze.files, ...freeze.dependencies, ...build.files]) {
  const location = join(previous, 'candidate', entry.path);
  assert((await lstat(location)).isFile());
  assert.equal(hash(await readFile(location)), entry.sha256, entry.path);
}
const publication = await json(join(published, 'PUBLICATION.json'));
for (const entry of publication.entries) assert.equal(hash(await readFile(join(published, entry.path))), entry.sha256, entry.path);
const catalogBytes = await readFile(join(sealed, 'seal-catalog.json'));
const catalog = JSON.parse(catalogBytes);
const preseal = await json(join(published, 'PRESEAL.json'));
assert.equal(hash(catalogBytes), preseal.privateCatalogSha256);
assert.equal(preseal.artifactRootSha256, '8b4a48a3c4f189b1d98707354a2eb469af3527250cca7e6bc36f02ed86e04297');
for (const entry of catalog.artifacts) {
  const original = join(sealed, entry.relativePath);
  const destination = join(root, 'holdout', entry.relativePath);
  const bytes = entry.type === 'symlink-target' ? Buffer.from(await readlink(original)) : await readFile(original);
  assert.equal(hash(bytes), entry.sha256);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  if (entry.type === 'symlink-target') await symlink(bytes.toString(), destination);
  else await writeFile(destination, bytes, { flag: 'wx', mode: 0o400 });
}
await writeFile(join(root, 'holdout/seal-catalog.json'), catalogBytes, { flag: 'wx', mode: 0o400 });
await mkdir(join(root, 'history'));
await mkdir(join(root, 'results'));
const original = await readFile(join(previous, 'holdout/isolated-runner.mjs'), 'utf8');
await writeFile(join(root, 'history/original-isolated-runner.mjs'), original, { flag: 'wx', mode: 0o400 });
await copyFile(join(sealed, 'run-holdouts.mjs'), join(root, 'history/original-sealed-runner.mjs'));
for (const name of ['freeze.json', 'build.json', 'binding.json']) await copyFile(join(previous, name), join(root, name));
const corrections = [
  {
    cases: ['F29'], reason: 'ROOT HARN-SIGNAL-001: require actual active AbortSignal, not caller signal reference identity.',
    before: '    for (const entry of rig.trace) assert.equal(entry.options?.signal, invocation.context.signal);',
    after: '    for (const entry of rig.trace) {\n      assert(entry.options?.signal instanceof AbortSignal);\n      assert.equal(entry.options.signal.aborted, false);\n      assert.equal(entry.options.signal.reason, undefined);\n    }',
  },
  {
    cases: ['F33', 'F34'], reason: 'ROOT HARN-SIGNAL-001: require propagated aborted state and exact caller reason identity; composed signal identity is valid.',
    before: '      assert.equal(capturedSignal, controller.signal);',
    after: '      assert(capturedSignal instanceof AbortSignal);\n      assert.equal(capturedSignal.aborted, true);\n      assert.equal(capturedSignal.reason, reason);',
  },
];
function transform(source, replacements) {
  let result = source;
  for (const replacement of replacements) {
    assert.equal(result.split(replacement.before).length, 2, 'Unique source anchor');
    result = result.replace(replacement.before, replacement.after);
  }
  return result;
}
const corrected = transform(original, corrections);
await writeFile(join(root, 'holdout/corrected-assertions-runner.mjs'), corrected, { flag: 'wx', mode: 0o400 });
const observations = [
  {
    before: '      next() { started.resolve(); return pendingRead.promise; },',
    after: '      next() { adapter.observeHoldout?.("source-next", {}); started.resolve(); return pendingRead.promise; },',
  },
  {
    before: '      return() { returned++; return id === \'F34\' ? pendingReturn.promise : Promise.resolve({ done: true, value: undefined }); },',
    after: '      return() { returned++; adapter.observeHoldout?.("source-return", { returned, pendingCleanup: id === "F34" }); return id === \'F34\' ? pendingReturn.promise : Promise.resolve({ done: true, value: undefined }); },',
  },
  {
    before: '      await assert.rejects(deadline(invocation.promise, `${id} cancellation`), (error) => error === reason);',
    after: '      await assert.rejects(deadline(invocation.promise, `${id} cancellation`), (error) => error === reason);\n      adapter.observeHoldout?.("exact-caller-reason-verified", {});',
  },
  {
    before: '      assert.equal(capturedSignal.reason, reason);',
    after: '      assert.equal(capturedSignal.reason, reason);\n      adapter.observeHoldout?.("fs-abort-propagation-verified", { aborted: capturedSignal.aborted, exactReason: capturedSignal.reason === reason });',
  },
  {
    before: '      pendingRead.reject(lateReadError);',
    after: '      pendingRead.reject(lateReadError);\n      adapter.observeHoldout?.("late-read-rejection-injected", { message: lateReadError.message });',
  },
  {
    before: '      if (id === \'F34\') pendingReturn.reject(lateReturnError);',
    after: '      if (id === \'F34\') {\n        pendingReturn.reject(lateReturnError);\n        adapter.observeHoldout?.("late-return-rejection-injected", { message: lateReturnError.message });\n      }',
  },
  {
    before: '      assert.deepEqual(unhandled, []);',
    after: '      assert.deepEqual(unhandled, []);\n      adapter.observeHoldout?.("late-error-window-verified", { unhandledCount: unhandled.length, readInjected: true, returnInjected: id === "F34", eventLoopTurns: 2 });',
  },
  {
    before: '      pendingReturn.resolve({ done: true, value: undefined });',
    after: '      pendingReturn.resolve({ done: true, value: undefined });\n      adapter.observeHoldout?.("cleanup-gates-released", { returned });',
  },
];
const observed = transform(corrected, observations);
await writeFile(join(root, 'holdout/corrected-observed-runner.mjs'), observed, { flag: 'wx', mode: 0o400 });
let child = await readFile(join(previous, 'child.mjs'), 'utf8');
const bridgeChanges = [
  { before: "from './candidate/dist/commands/file/index.js'", after: `from '${previous}/candidate/dist/commands/file/index.js'` },
  { before: "from './candidate/dist/contracts/index.js'", after: `from '${previous}/candidate/dist/contracts/index.js'` },
  { before: "from './candidate/dist/shell/index.js'", after: `from '${previous}/candidate/dist/shell/index.js'` },
  { before: "from './holdout/isolated-runner.mjs'", after: "from './holdout/corrected-observed-runner.mjs'" },
  { before: 'assert.match(caseId, /^F(?:0[1-9]|[123][0-9]|40)$/u);', after: "assert(['F29', 'F33', 'F34'].includes(caseId), 'Only the three root-authorized correction cases');" },
  { before: '  caseStarted(id) { event(\'case-start\', { id }); },', after: '  caseStarted(id) { event(\'case-start\', { id }); },\n  observeHoldout(kind, details) { event(`holdout-${kind}`, details); },' },
];
child = transform(child, bridgeChanges);
await writeFile(join(root, 'child.mjs'), child, { flag: 'wx', mode: 0o400 });
let loader = await readFile(join(previous, 'audit-loader.mjs'), 'utf8');
loader = transform(loader, [{ before: "    if (!location.startsWith(`${root}/`)) throw new Error(`Nonfrozen module import: ${location}`);", after: "    if (!location.startsWith(`${root}/`) && !location.startsWith(\"/private/tmp/safe-bash-file-run.WeB7Vfsc/candidate/dist/\")) throw new Error(`Nonfrozen module import: ${location}`);" }]);
await writeFile(join(root, 'audit-loader.mjs'), loader, { flag: 'wx', mode: 0o400 });
const correction = {
  issue: 'HARN-SIGNAL-001', authorizedCases: ['F29', 'F33', 'F34'], candidateCommit: freeze.commit,
  preparedAt: new Date().toISOString(), originalPreseal: preseal.artifactRootSha256,
  originalSealedRunnerSha256: hash(await readFile(join(root, 'history/original-sealed-runner.mjs'))),
  originalIsolatedRunnerSha256: hash(original), correctedAssertionsRunnerSha256: hash(corrected), correctedObservedRunnerSha256: hash(observed),
  corrections, observations, bridgeChanges,
  retainedAssertions: ['exact caller rejection reason identity', 'iterator.return count exactly one', 'late read rejection injection', 'late return rejection injection F34', 'two event-loop turns then empty unhandled array'],
  observationPolicy: 'Telemetry only in F33/F34; no additional then/catch handler attached to tested promises. Original rejection injections and assertions remain. No other scenario/fixture/MIME/status predicate altered.',
  previousPublicationRootSha256: publication.publicationRootSha256,
  verifiedBefore: { frozenSourceDevBuildFiles: freeze.files.length + freeze.dependencies.length + build.files.length, originalPublishedFiles: publication.entries.length, originalSealedArtifacts: catalog.artifacts.length },
  inheritedOptions: (await json(join(root, 'binding.json'))).options,
};
await writeFile(join(root, 'correction.json'), `${JSON.stringify(correction, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ oldCandidate: freeze.commit, correctedCases: correction.authorizedCases, originalIsolatedRunnerSha256: correction.originalIsolatedRunnerSha256, correctedAssertionsRunnerSha256: correction.correctedAssertionsRunnerSha256, originalArtifactsUnchanged: 54, priorPublicationUnchanged: publication.entries.length }, null, 2));
