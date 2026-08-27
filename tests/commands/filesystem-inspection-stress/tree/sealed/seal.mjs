import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cases, rules } from './corpus.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const ownedScope = join(repository, 'tests/commands/filesystem-inspection-stress/tree');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const original = JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'));
const sourceInputsAtSeal = [];
for (const input of original.inputs) {
  const sha256 = hash(await readFile(join(repository, input.path)));
  sourceInputsAtSeal.push({ path: input.path, originalSha256: input.sha256, sealSha256: sha256, unchanged: sha256 === input.sha256 });
}
const check = spawnSync(process.execPath, ['--test', join(directory, 'selftest.mjs')], { encoding: 'utf8', timeout: 10000 });
assert.equal(check.error, undefined);
assert.equal(check.status, 0, check.stdout + check.stderr);
await writeFile(join(directory, 'selftest.tap'), check.stdout, { flag: 'wx', mode: 0o600 });
const runnerCheck = spawnSync(process.execPath, ['--check', join(directory, 'run.mjs')], { encoding: 'utf8', timeout: 10000 });
assert.equal(runnerCheck.status, 0, runnerCheck.stderr);
const embargo = spawnSync(process.execPath, [join(directory, 'run.mjs'), '--execute', '/deliberately-nonexistent-bridge.mjs', '/deliberately-nonexistent-profile.json'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, TREE_HOLDOUT_ROOT_RESUMED: '' } });
assert.notEqual(embargo.status, 0);
assert.match(embargo.stderr, /PREP embargo/u);
await writeFile(join(directory, 'embargo-check.txt'), json({ status: embargo.status, signal: embargo.signal, stdout: embargo.stdout, stderr: embargo.stderr, purpose: 'Denied before reading profile or importing any bridge; no product calls' }), { flag: 'wx', mode: 0o600 });
const git = (args) => spawnSync('git', args, { cwd: repository, encoding: 'utf8' }).stdout.trim();
const sealedAt = new Date().toISOString();
const preseal = {
  sealedAt, initialObservedClock: '2026-08-27T08:00:47Z', originalCaptureAt: original.preparedAt,
  headAtSeal: git(['rev-parse', 'HEAD']), statusAtSeal: git(['status', '--short']), indexAtSeal: git(['diff', '--cached', '--name-only']),
  authorCandidateReadiness: 'No author-finished/candidate handoff received. Author source and author tests not inspected at any time in PREP.',
  productCalls: 0, productImports: 0, authorImplementationReads: 0, authorTestReads: 0,
  sourceInputsAtSeal, intendedCases: cases, rules,
  preparationChecks: { verifierSelftests: 7, passed: 7, failed: 0, runnerSyntax: 'pass', embargoDenialBeforeImport: 'pass', nativeCaptures: 20, productCasesExecuted: 0 },
  presealClarifications: [
    'N14 raw oracle output revealed global sibling-alias suppression before any author inspection. Kept original native bytes; final acceptance is the user ancestor-only invariant, not native-byte parity.',
    'N20 requires explicit native JSON schema rather than interpreting arbitrary JSON support as native compatibility.',
    'A36 always exercises real adapter plus poison stdin, independent of optional native exact flags.',
    'A37 always runs actual Shell with a JSON consumer if supported, otherwise its already sealed text-consumer branch; unsupported JSON is not a JSON pass.',
    'Original provenance capture remains unchanged, including its initial intended-case declarations; this preseal snapshot is the final pre-candidate corpus.',
  ],
  evidenceLimits: original.limitations,
};
await writeFile(join(directory, 'preseal.json'), json(preseal), { flag: 'wx', mode: 0o600 });
const inventory = [];
async function collect(relative = '') {
  const entries = await readdir(join(directory, relative), { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { await collect(name); continue; }
    const destination = join(directory, name);
    const bytes = entry.isSymbolicLink() ? Buffer.from(await readlink(destination)) : await readFile(destination);
    inventory.push({ path: name, kind: entry.isSymbolicLink() ? 'symlink' : 'file', bytes: bytes.length, sha256: hash(bytes) });
  }
}
await collect();
const inventoryBytes = Buffer.from(json(inventory));
const payloadSha256 = hash(JSON.stringify(inventory));
await writeFile(join(directory, 'inventory.json'), inventoryBytes, { flag: 'wx', mode: 0o600 });
const detail = `INDEPENDENT TREE VERIFIER — PREP SEALED; STOPPED BEFORE PRODUCT EXECUTION

Sealed UTC: ${sealedAt}
First recorded inspection clock: 2026-08-27T08:00:47Z
Actual recorded elapsed: ${Math.round((Date.parse(sealedAt) - Date.parse('2026-08-27T08:00:47Z')) / 1000)} seconds (not a 72-hour completion claim).
Repo: ${repository}
Private corpus: ${directory}
Owned publish scope: tests/commands/filesystem-inspection-stress/tree/** only.
No staging, commits, branches, product/root/FS/contracts/core/metadata changes.
Root assignment confirms this verifier owns only NEW tree stress scope and /tmp.
Ancestor/project AGENTS read. No nested applicable AGENTS in owned scope.

Preseal payload SHA256: ${payloadSha256}
Private inventory SHA256: ${hash(inventoryBytes)}
Public seal: ${ownedScope}/PRESEAL-MANIFEST.json
Root-only named case plan and exact fixtures: corpus.mjs, native.json, preseal.json.
Root-only resume/API binding protocol: RESUME.md.
Author must not read corpus until root failure handoff. Mode 0700 is not an
enforceable same-user agent security boundary; embargo is a coordination rule.

INDEPENDENCE
No new author implementation/tests inspected. No product calls/new plugin imports.
No author-finished/candidate evidence received; no candidate profile inferred.
Derived only from user requirements, current contract snapshots, primary tree
manual/tag checked using web, and the already existing pinned native tool.
Contract input hashes before/after are in preseal.json; original snapshots remain.
HEAD at native capture: ${original.headAtCapture}
HEAD at seal: ${preseal.headAtSeal}
Concurrent repo state is dirty; neither hash claims a frozen product gate.
Source input drift: ${sourceInputsAtSeal.filter((item) => !item.unchanged).length} files.

CORPUS AND NATIVE PROVENANCE
38 targeted intended product cases, not a broad parity suite:
20 native-derived captures and 18 positive/adversarial probes. Three provider
boundary/missing-method characterizations are NOT pass claims. Optional options
will be classified against the author's supported profile before execution;
unsupported remains unsupported, never counted as pass.
Existing binary: ${original.oracle.originalOracle}/unix-tree-2.2.1/tree
Reported version: ${Buffer.from(original.oracle.version.stdoutBase64, 'base64').toString().trim()}
Binary SHA256: ${original.oracle.binarySha256}
Archive SHA256: ${original.oracle.archiveSha256}
Manual SHA256: ${original.oracle.manualSha256}
No native download/build performed by this verifier. The existing binary/archive
and manual were copied into private oracle/ for a frozen identity. Exact build
command/compiler provenance remains UNVERIFIED pending author/root provenance.
Native profile: Darwin ${original.host.release} ${original.host.arch}; LC_ALL=C,
LANG=C, TERM=dumb, TZ=UTC, -n --charset=ASCII, stdin empty, non-TTY; 2500ms native
timeout, 256KiB capture ceiling; only private temp fixtures and internal links.
This is pinned tree 2.2.1, not current-upstream/latest or GNU/Linux evidence.
Primary source: https://gitlab.com/OldManProgrammer/unix-tree/-/raw/2.2.1/doc/tree.1
Tag: https://gitlab.com/OldManProgrammer/unix-tree/-/tags/2.2.1
Current upstream manual was identified as different, not substituted for 2.2.1.

Coverage includes C sorting/reverse/dirsfirst, hidden/depth/filter/prune/reports,
Unicode/control/newline/raw/JSON names, root/file/dangling/follow/sibling aliases,
ancestor loops, disjoint provider inode collisions, unknown/partial identity,
ENOTSUP and absent realpath, malformed/duplicate readdir, EACCES/late EIO,
pre-abort and pending FS/sink/late rejection, backpressure/chunk ownership,
multibyte output and global entry bounds, real rooted VFS, unused stdin, and
actual Shell pipeline/subshell/redirection with JSON or text stdin consumer.
Every fixture/case is frozen before any product invocation. Bridge remains a
new post-candidate artifact because final standalone API is not yet inspected.

ORACLE / CONTRACT DISCLOSURES
N14 original native capture suppresses sibling alias-b as recursive. Preserved
exactly. User ancestor-cycle rule instead requires sibling traversal; its
invariant acceptance cannot be labeled native-byte parity. This discrepancy
was found in native output, never inferred from candidate output.
N17/N18 retain original error bytes/status but require meaningful failure, not
universal native diagnostic spelling. N20 native JSON exact schema is explicit.
DirectoryEntry documents name/type but no stronger validity/uniqueness rule;
malicious/duplicate cases characterize defensive handling without inventing a
mandatory rejection/deduplication policy. Missing realpath method is explicitly
nonconforming; conforming unknown-identity tests instead return ENOTSUP.
Direct cancellation tests reject false success and retain thrown reason identity;
they do not establish exact public Shell cancellation-result behavior by proxy.
No product static subprocess/dependency audit, public export/packed consumer,
remote provider deployment, benchmark, full suite or superiority evidence yet.

VALIDATION
20 bounded native captures recorded, including original errors and alias defect.
7/7 verifier-only selftests passed. run.mjs syntax passes. PREP execution guard
rejects before profile access/bridge import. Product cases executed: ZERO.
Raw selftest and denied-execution logs are private sealed artifacts.
Root resumes only after author candidate: verify manifest, freeze candidate/API
and supported profile, bind real APIs in a new adapter, execute independently,
then route failures to author. Never edit expectations merely to match product.
STOP: no staging/commit and no author/product work follows this PREP handoff.
`;
await writeFile('/tmp/safe-bash-tree-holdout-prep-detail.txt', detail, { flag: 'wx', mode: 0o600 });
await mkdir(ownedScope, { recursive: true });
const manifest = {
  schema: 1, phase: 'PREP_SEALED_AUTHOR_EMBARGO', sealedAt, privateDirectory: directory,
  intendedCases: 38, nativeCaptures: 20, verifierSelftestsPassed: 7, productExecutions: 0,
  payloadSha256, privateInventorySha256: hash(inventoryBytes), artifactCount: inventory.length,
  corpusSha256: hash(await readFile(join(directory, 'corpus.mjs'))),
  runnerSha256: hash(await readFile(join(directory, 'run.mjs'))),
  nativeCaptureSha256: hash(await readFile(join(directory, 'native.json'))),
  prepDetailSha256: hash(detail),
  embargo: 'Author must not inspect private artifacts before root failure handoff. Public manifest intentionally omits fixture/case names.',
  validation: 'Verifier/native preparation checks only; unsupported is not pass; no product execution, parity or completion claim.',
};
await writeFile(join(ownedScope, 'PRESEAL-MANIFEST.json'), json(manifest), { flag: 'wx' });
assert.equal((await lstat(directory)).isDirectory(), true);
console.log(json({ sealedAt, payloadSha256, artifacts: inventory.length, productExecutions: 0 }));
