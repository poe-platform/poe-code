import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const target = '/Users/kjopek/Workspace/safe-bash/tests/commands/filesystem-inspection-stress/file/final-candidate-cd37ce07-execute';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const summary = JSON.parse(await readFile(join(root, 'final-summary.json')));
assert.equal(summary.freshCases, 40);
assert.equal(summary.reusedCasesAsFinalEvidence, 0);
const processState = { recordedAt: new Date().toISOString(), productChildrenStarted: 40, productChildrenSettled: 40, productChildrenRemaining: 0, timeouts: summary.run.timeouts, retries: 0, nativeChildrenStarted: 0, backgroundWorkersStarted: 0, shellStarted: summary.eventCounts['shell-start'], shellDisposed: summary.eventCounts['shell-disposed'], rawFailureIds: summary.rawFailureIds, routedFailureIds: summary.routedFailureIds, actualProductModulesLoaded: summary.loadedProductFiles, actualHarnessModulesLoaded: summary.loadedHarnessFiles, productUnhandledRejectionEvents: summary.eventCounts['unhandled-rejection'] ?? 0, unhandledQualification: 'Observed across completed40 and explicit two-turn late-rejection windows only, not arbitrary future host work', buildsThisPhase: 0, scopedTypes: 'REUSED_READY_NOT_RERUN', standaloneConsumerCalls: 0, fullGateRuns: 0, commitsCreated: 0, stagedByVerifier: [] };
await writeFile(join(root, 'final-process-state.json'), `${JSON.stringify(processState, null, 2)}\n`, { flag: 'wx' });
await mkdir(target);
await copyFile(join(root, 'FINAL_EXECUTION_REPORT.md'), join(target, 'README.md'));
const evidence = ['binding.json', 'execution-peer-report.md', 'execution-preflight.json', 'execution-postflight.json', 'execution-mechanics-note.txt', 'freeze.json', 'build.json', 'static-closure.json', 'source-deltas.json', 'sqlite-source.diff', 'text-source.diff', 'shell-source.diff', 'final-run.claim.json', 'final-run.progress.json', 'final-run.json', 'final-execution.stdout.txt', 'final-execution.stderr.txt', 'final-summary.json', 'final-adjudication.json', 'final-content-comparisons.json', 'final-native-differences.json', 'final-native-reference-inventory.json', 'final-lifecycle.json', 'final-loaded-closure.json', 'final-history-comparison.json', 'final-process-state.json'];
await mkdir(join(target, 'evidence'));
for (const path of evidence) await copyFile(join(root, path), join(target, 'evidence', path));
await mkdir(join(target, 'tools'));
for (const path of ['verify-execution-inputs.mjs', 'bind-execution.mjs', 'run-final-once.mjs', 'summarize-final.mjs', 'publish-final.mjs', 'child.mjs', 'audit-loader.mjs']) await copyFile(join(root, path), join(target, 'tools', path));
await mkdir(join(target, 'history'));
await copyFile(join(root, 'run-final-once.syntax-invalid.artifact'), join(target, 'history/run-final-once.syntax-invalid.artifact'));
await mkdir(join(target, 'runner'));
await copyFile(join(root, 'holdout/v2-runner.mjs'), join(target, 'runner/v2-runner.mjs'));
await mkdir(join(target, 'results'));
for (const name of (await readdir(join(root, 'results'))).sort()) {
  assert(/^F(?:0[1-9]|[12][0-9]|3[0-9]|40)\.(?:json|events\.jsonl|modules\.jsonl|stdout\.txt|stderr\.txt)$/u.test(name), name);
  await copyFile(join(root, 'results', name), join(target, 'results', name));
}
const entries = [];
async function collect(directory = '') {
  for (const name of (await readdir(join(target, directory))).sort()) {
    const path = join(directory, name);
    const stat = await lstat(join(target, path));
    if (stat.isDirectory()) await collect(path);
    else {
      assert(stat.isFile() && !stat.isSymbolicLink(), path);
      const bytes = await readFile(join(target, path));
      entries.push({ path, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
await collect();
const publication = { schema: 1, publishedAt: new Date().toISOString(), candidateCommit: summary.candidateCommit, sourceSha256: summary.sourceSha256, dependencySha256: summary.dependencySha256, productClosureSha256: summary.productClosureSha256, runnerSha256: summary.runnerSha256, peerReportSha256: summary.peerReportSha256, originalPreseal: '8b4a48a3c4f189b1d98707354a2eb469af3527250cca7e6bc36f02ed86e04297', readyPublicationRetainedUnchanged: '48ebe095071e2f5bf1872bdc46e55adea79bc44545696b22a64daae5194353ac', freshCases: 40, reusedProductCases: 0, retries: 0, nativeCalls: 0, dependenciesVendored: false, artifactCount: entries.length, publicationRootSha256: hash(entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join('')), entries };
await writeFile(join(target, 'PUBLICATION.json'), `${JSON.stringify(publication, null, 2)}\n`, { flag: 'wx' });
await writeFile(join(root, 'final-publication.json'), `${JSON.stringify(publication, null, 2)}\n`, { flag: 'wx' });
for (const entry of entries) assert.equal(hash(await readFile(join(target, entry.path))), entry.sha256, entry.path);
console.log(JSON.stringify({ target, artifactCount: entries.length, publicationRootSha256: publication.publicationRootSha256, freshCases: 40, rawFailures: summary.rawFailureIds, profileConflictIds: summary.nativeProfileConflictIds, backendCharacterizationIds: summary.backendCharacterizationIds }, null, 2));
