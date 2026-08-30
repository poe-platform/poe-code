import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const original = '/tmp/safe-bash-file-holdout.KyVGrl0A';
const destination = join(root, 'holdout');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const catalog = JSON.parse(await readFile(join(original, 'seal-catalog.json')));
for (const entry of catalog.artifacts) {
  const source = join(original, entry.relativePath);
  const target = join(destination, entry.relativePath);
  await mkdir(dirname(target), { recursive: true });
  if (entry.type === 'symlink-target') {
    const value = await readlink(source);
    assert.equal(sha256(value), entry.sha256);
    await symlink(value, target);
  } else {
    const bytes = await readFile(source);
    assert.equal(sha256(bytes), entry.sha256);
    await copyFile(source, target);
    assert.equal(sha256(await readFile(target)), entry.sha256);
    await chmod(target, 0o400);
  }
}
const originalRunner = await readFile(join(destination, 'run-holdouts.mjs'), 'utf8');
const substitutions = [
  ['  const record = async (id, operation) => {', '  const record = async (id, operation) => {\n    if (id !== adapter.caseId) return;\n    adapter.caseStarted(id);'],
  ['  assert.equal(reports.length, cases.length);', '  assert.equal(reports.length, 1, "One selected frozen case per isolated child");'],
];
let instrumented = originalRunner;
for (const [before, after] of substitutions) {
  assert.equal(instrumented.split(before).length, 2, 'Unique mechanical instrumentation anchor');
  instrumented = instrumented.replace(before, after);
}
await writeFile(join(destination, 'isolated-runner.mjs'), instrumented, { flag: 'wx', mode: 0o400 });
const binding = {
  recordedAt: new Date().toISOString(),
  candidate: 'd168d18b118592e04a6eec9b00eb50cc2b1e5058',
  originalSealRoot: '8b4a48a3c4f189b1d98707354a2eb469af3527250cca7e6bc36f02ed86e04297',
  originalRunnerSha256: sha256(originalRunner), instrumentedRunnerSha256: sha256(instrumented),
  mechanicalChanges: substitutions,
  predicateChanges: [], fixtureChanges: [], expectedChanges: [],
  execution: 'Forty sequential one-case children, once each; unchanged 80 content-view checks; 60s child / 600s global watchdog. Original sealed runner preserved; derived selection/count instrumentation only.',
  options: { limits: { maxSniffBytes: 65536, maxReadFileBytes: 65536 } },
  profileQualification: 'Explicit strict bounded-read profile; maxReadFileBytes lowered from documented default 1MiB to 64KiB to match frozen fallback probe cap. All other file limits are defaults; not a claim about all default limits.',
  unsupportedFormats: [],
  unsupportedQualification: 'All twenty fixture formats fall within documented content/common-subset support or documented strict text/data fallback. Native legacy text distinctions are profile comparisons, not fabricated unsupported passes.',
  observedPotentialHarnessOverconstraints: ['Some sealed signal assertions demand signal object identity. Candidate composes signals. Composition is contract-valid if cancellation propagates; retain failures unchanged and adjudicate without rewriting assertions.'],
};
await writeFile(join(root, 'binding.json'), `${JSON.stringify(binding, null, 2)}\n`, { flag: 'wx' });
await mkdir(join(root, 'results'));
console.log(JSON.stringify({ inputsVerifiedAndCopied: catalog.artifacts.length, originalRunnerSha256: binding.originalRunnerSha256, predicateChanges: 0 }));
