import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const owned = join(repository, 'tests/commands/filesystem-inspection-stress/tree');
const evidence = join(owned, 'evidence/initial');
const json = async (name) => JSON.parse(await readFile(join(directory, name), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = await json('initial-results.json');
const analysis = await json('analysis.json');
const freeze = await json('freeze.json');
const originalSealBytes = await readFile(join(owned, 'PRESEAL-MANIFEST.json'));
const originalSeal = JSON.parse(originalSealBytes);
assert.equal(originalSeal.payloadSha256, 'b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937');
const git = (args) => spawnSync('git', args, { cwd: repository, encoding: 'utf8' }).stdout.trim();
const state = {
  observedAt: new Date().toISOString(), candidate: freeze.commit, liveHeadObservedOnly: git(['rev-parse', 'HEAD']),
  scopedGitStatus: git(['status', '--short', '--', 'tests/commands/filesystem-inspection-stress/tree']),
  indexObservedOnly: git(['diff', '--cached', '--name-only']),
  stagingOrCommitByVerifier: false, productionEditsByVerifier: false,
  children: report.cohort.map((row) => ({ id: row.id, pid: row.pid, completion: row.completion, killedFor: row.killedFor })),
  childCloseEventsReceived: 38, activeOwnedCohortChildren: 0, ownedWatchersOrServersStarted: 0,
  shellInstances: { created: analysis.shellEvidence.length, disposed: analysis.shellEvidence.filter((item) => item.disposed).length },
  cleanup: 'Every cohort child closed; no watchdog fired. No daemon/watch/server was started. All own temp fixtures, snapshot, raw logs and original coverage are retained; no unowned process/temp cleanup attempted.',
};
await writeFile(join(evidence, 'process-state.json'), `${JSON.stringify(state, null, 2)}\n`);
await copyFile(join(directory, 'durable-evidence-tests.tap'), join(evidence, 'durable-evidence-tests.tap'));
const detail = `INDEPENDENT TREE VERIFIER — COHERENT INITIAL SOURCE CHECKPOINT; STOPPED

Finalized UTC: ${state.observedAt}
Authorized candidate: ${freeze.commit}
Candidate commit tree: ${freeze.tree}
Standalone API: direct frozen src/commands/tree/index.ts, createTreeCommand,
createTreeCommands, treeCommands and documented option types. Only
createTreeCommand is executed by this bridge; actual Shell uses CommandRegistry.
No root/package-subpath/default integration or public-consumer acceptance claim.

ORIGINAL PRESEAL / INDEPENDENCE
Payload ${originalSeal.payloadSha256}
Private inventory ${originalSeal.privateInventorySha256}
Original corpus ${originalSeal.corpusSha256}
Original runner ${originalSeal.runnerSha256}
Original native captures ${originalSeal.nativeCaptureSha256}
Sealed at ${originalSeal.sealedAt}, before candidate commit08:16:49Z.
Verified before binding, after source execution, and after durable publication.
All 97 artifacts, expected bytes, fixtures and predicates remain unchanged.
Author-finished/root authorization preceded all 35 product invocations.
The mistaken original attribution of ancestor-only policy as a literal user
instruction is explicitly corrected in pre-execution profile and PRESEAL-ERRATA.
It is our chosen bounded profile; user requested cycle handling/no false identity.

FROZEN INPUTS
Full candidate regular files: ${freeze.candidateFileCount}, ${freeze.candidateBytes} bytes.
Copied dependency regular files: ${freeze.dependencyFileCount}, ${freeze.dependenciesBytes} bytes.
Source manifest SHA256 ${freeze.sourceManifestSha256}
Candidate regular-file manifest SHA256 ${freeze.commitManifestSha256}
Dependency manifest SHA256 ${freeze.dependencyManifestSha256}
Full input manifest SHA256 ${freeze.fullInputManifestSha256}
All ${analysis.allFrozenInputFilesChecked} input files hash identically after the run.
31 source modules plus22 loader/tool modules observed in V8 coverage were inside
the frozen snapshot; unexpected moving file-backed imports:0. Snapshot copied
all exact-commit regular files, not a dirty live-source overlay. Files are
read-only; this is not an OS security boundary against trusted same-user code.
Installed dependency versions match candidate package-lock.json; no install,
download or rebuild was used. Test tool subprocesses are not product commands.
Snapshot: ${directory}/candidate
Full raw/V8 evidence: ${directory}/raw
Live worktree was concurrently dirty and was not used as product source.

EXACT INITIAL COUNTS
Selected38 once each; source cohort ${report.startedAt} to ${report.finishedAt}.
Elapsed ${report.elapsedMs}ms. 35 tree invocations;3 unsupported selections invoke none.
Raw sealed predicates:30 pass,2 fail,3 unsupported-not-pass,3 characterized-not-pass.
Native exact-predicate selections:12 pass,1 fail,3 unsupported (16 total).
Other native-derived semantic selections:3 pass,1 fail (4 total).
Adversarial/positive selections:15 pass,3 characterizations (18 total).
Raw native stdout/stderr/status across all20 captured cases:12 exact matches,
5 mismatches (N14,N16,N17,N18,N20),3 unsupported/not-run (N09,N12,N19).
N20 parsed JSON equals native despite whitespace mismatch. N14/N17 semantic
passes are NOT native parity. Native captures retained:20; new native runs:0.
Adjudication:30 sealed passes,1 declared-profile conflict,1 overnarrow sealed
predicate conflict,3 unsupported,3 characterizations. Demonstrated source bugs:0.
Outside-core failures:0. Source/import startup errors:0. Timeouts:0.
Watchdog cancellations:0. Missing/incomplete:0. No covert rerun or source fix.
Per-case process cap120000ms, cohort cap600000ms; original sealed internal
settlement guard2000ms unchanged. No cap fired; longest case667ms.

FAILURE ROUTING
/tmp/safe-bash-tree-holdout-failures.txt contains raw minimal fixtures/argv,
exact expected/actual bytes/status, preserved stacks and reproducible commands.
N16: explicit root symlink stays untraversed by predeclared nofollow profile;
native follows it. Original native failure remains NOT a parity pass.
N18: candidate rejects -L0 with status2 and 'tree: -L must be between 1 and 256'.
Original regex demands one of level/depth/invalid/positive/greater; it rejects
this meaningful diagnostic. Original failure remains; no regex/oracle edits.
Root decides any future profile/harness revision while retaining this cohort.
No demonstrated implementation bug to send for a source fix. Author stays stopped.

NATIVE PROVENANCE CORROBORATED
Official archive recorded in exact candidate tests/commands/tree/native-fixtures.json:
https://gitlab.com/OldManProgrammer/unix-tree/-/archive/2.2.1/unix-tree-2.2.1.tar.bz2
Archive e911c4a2bea53586cc7be6f3d7d7f4d9c2f2bcbbad77d30700b31046e38f4bc5
Binary 34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a
Pinned manual 0900385101aa663c970b3e558ed3eec8b4fc96e175b70bedefcf32cf4f8bc3dd
Existing originals and sealed copies match. Fifteen relevant source/header/
Makefile/manual files in the build tree equal archive members. Exact original
build log corroborates make CC=cc CFLAGS='-O2 -std=c11 -Wall -Wextra' LDFLAGS= tree,
Apple clang21.0.0, one stddata_fd unused-variable warning, successful execution.
This is recorded-build corroboration, not a new reproducible rebuild or fresh
network attestation. Darwin arm64/C locale/ASCII profile, not GNU/Linux/latest.
The author's six declared profile differences remain explicit; error-JSON and
file-root-JSON differences are not measured by these38 original cases.

VALIDATION / LIMITS
Scoped frozen candidate source/tests typecheck passes (noEmit); no full gate.
Twelve durable evidence/fixture checks pass; these execute no product commands.
Actual Shell/registry JSON pipeline, subshell, redirection and byte stdin
consumer execute successfully; one Shell instance is disposed. Not a stub.
Direct pre-abort/pending-FS/pending-sink reasons preserve exact identity and
late rejection observation; this is not public Shell cancellation proof.
Static review found no tree content reads, hostFS/subprocess/network use or
runtime dependencies; globs use budgeted DP rather than regex backtracking;
scoped identity is not inferred from realpath strings. No universal audit claim.
A33's output is C-escaped ASCII despite Unicode input names, so genuine UTF-8
multibyte output-budget coverage is incomplete. A26 reaches entry cap before
duplicate validation; A25 stops at first invalid entry. Unknown/malicious
provider cases do not invent contract validation/deduplication requirements.
No jq-specific case, newly built standalone consumer, public/default/package
integration, deployed provider gate, performance comparison, full native parity,
superiority or72-hour completion claim. All gaps remain recorded.

DURABLE PUBLICATION / PROCESS STATE
Owned scope: tests/commands/filesystem-inspection-stress/tree/** only, plus /tmp.
Original seal/corpus and raw initial results are published there. Full large
candidate snapshot and76 original V8 coverage files remain /tmp; published
manifests/coverage indexes bind them. run-frozen.mjs supports an explicitly
authorized new cohort against identical inputs, never overwriting this one.
All38 cohort children emitted close; active owned cohort children:0.
Watchers/servers started:0; created/disposed Shell instances:1/1.
All temp fixture/snapshot/raw evidence retained. No unowned cleanup performed.
No production/author-test/root/FS/contracts/core/default/private edits.
No staging, commit or branch created. Index observed at finish: ${JSON.stringify(state.indexObservedOnly)}.
STOP at initial checkpoint. Root owns any subsequent author handoff.
`;
await writeFile('/tmp/safe-bash-tree-holdout-run-detail.txt', detail, { flag: 'wx', mode: 0o600 });
await copyFile('/tmp/safe-bash-tree-holdout-run-detail.txt', join(evidence, 'run-detail.txt'));
await copyFile(fileURLToPath(import.meta.url), join(owned, 'driver/finalize.mjs'));
const entries = [];
async function inventory(relative = '') {
  const children = await readdir(join(owned, relative), { withFileTypes: true });
  children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const child of children) {
    const name = relative ? `${relative}/${child.name}` : child.name;
    if (name === 'EVIDENCE-MANIFEST.json') continue;
    if (child.isDirectory()) { await inventory(name); continue; }
    const destination = join(owned, name);
    const bytes = child.isSymbolicLink() ? Buffer.from(await readlink(destination)) : await readFile(destination);
    entries.push({ path: name, kind: child.isSymbolicLink() ? 'symlink' : 'file', bytes: bytes.length, sha256: hash(bytes) });
  }
}
await inventory();
const manifest = { schema: 1, candidate: freeze.commit, originalPresealPayload: originalSeal.payloadSha256, originalManifestSha256: hash(originalSealBytes), payloadSha256: hash(JSON.stringify(entries)), entries };
await writeFile(join(owned, 'EVIDENCE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const item of entries) {
  const destination = join(owned, item.path);
  const metadata = await lstat(destination);
  const bytes = metadata.isSymbolicLink() ? Buffer.from(await readlink(destination)) : await readFile(destination);
  assert.equal(hash(bytes), item.sha256, item.path);
}
console.log(JSON.stringify({ durableArtifactsVerified: entries.length, payloadSha256: manifest.payloadSha256, detail: '/tmp/safe-bash-tree-holdout-run-detail.txt', activeCohortChildren: 0, rawResults: report.totals }, null, 2));
