import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const candidate = await realpath(join(directory, 'candidate'));
const sealed = await realpath('/tmp/safe-bash-tree-hidden-prep-vyzfHc');
const report = JSON.parse(await readFile(join(directory, 'initial-results.json'), 'utf8'));
const native = JSON.parse(await readFile(join(sealed, 'native.json'), 'utf8'));
const inventory = JSON.parse(await readFile(join(directory, 'full-input-files.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byPath = new Map(inventory.map((item) => [item.path, item]));
const observations = new Map();
const nativeLanes = [];
for (const row of report.cohort) {
  const observation = JSON.parse(await readFile(join(directory, 'raw', row.id, 'observations.json'), 'utf8'));
  observations.set(row.id, observation);
  if (!row.id.startsWith('N')) continue;
  const original = native.find((item) => item.id === row.id);
  const invocation = observation.invocations[0];
  if (!invocation) { nativeLanes.push({ id: row.id, rawExact: 'unsupported-not-run', sealedPredicateStatus: row.status }); continue; }
  const stdout = Buffer.concat(invocation.stdout.filter((item) => item.state === 'fulfilled').map((item) => Buffer.from(item.attemptedBase64, 'base64')));
  const stderr = Buffer.concat(invocation.stderr.filter((item) => item.state === 'fulfilled').map((item) => Buffer.from(item.attemptedBase64, 'base64')));
  const output = { exitCode: invocation.result?.exitCode, stdoutBase64: stdout.toString('base64'), stderrBase64: stderr.toString('base64') };
  const equal = { exitCode: output.exitCode === original.exitCode, stdout: output.stdoutBase64 === original.stdoutBase64, stderr: output.stderrBase64 === original.stderrBase64 };
  let jsonSemantic;
  if (row.id === 'N20') { assert.deepEqual(JSON.parse(stdout), JSON.parse(Buffer.from(original.stdoutBase64, 'base64'))); jsonSemantic = 'equal'; }
  nativeLanes.push({ id: row.id, rawExact: Object.values(equal).every(Boolean) ? 'match' : 'mismatch-not-parity-pass', equal, output, native: original, jsonSemantic, sealedPredicateStatus: row.status, sealedComparison: row.rawPredicate?.evidence?.comparison });
  await writeFile(join(directory, 'raw', row.id, 'product.stdout.bin'), stdout, { flag: 'wx' });
  await writeFile(join(directory, 'raw', row.id, 'product.stderr.bin'), stderr, { flag: 'wx' });
}
const loaded = new Map();
const outside = new Set();
for (const row of report.cohort) {
  const root = join(directory, 'raw', row.id, 'coverage');
  for (const name of await readdir(root)) {
    const coverage = JSON.parse(await readFile(join(root, name), 'utf8'));
    for (const script of coverage.result) {
      let filepath;
      if (script.url.startsWith('file:')) filepath = fileURLToPath(script.url);
      else if (isAbsolute(script.url)) filepath = script.url;
      else continue;
      filepath = await realpath(filepath);
      if (filepath.startsWith(`${candidate}/`)) {
        const name = relative(candidate, filepath);
        const input = byPath.get(name);
        assert.ok(input, `loaded frozen input not manifested: ${name}`);
        assert.equal(hash(await readFile(filepath)), input.sha256, name);
        const item = loaded.get(name) ?? { path: name, sha256: input.sha256, cases: [] };
        if (!item.cases.includes(row.id)) item.cases.push(row.id);
        loaded.set(name, item);
      } else if (!filepath.startsWith(`${sealed}/`) && !filepath.startsWith(`${await realpath(directory)}/`)) outside.add(filepath);
    }
  }
}
const inputDrift = [];
for (const item of inventory) if (hash(await readFile(join(candidate, item.path))) !== item.sha256) inputDrift.push(item.path);
const laneCounts = {};
for (const lane of nativeLanes) laneCounts[lane.rawExact] = (laneCounts[lane.rawExact] ?? 0) + 1;
const n16 = nativeLanes.find((row) => row.id === 'N16');
const n18 = nativeLanes.find((row) => row.id === 'N18');
const outputText = (lane, stream) => Buffer.from(lane.output[`${stream}Base64`], 'base64').toString();
const failures = `TREE INDEPENDENT INITIAL FAILURE ROUTE — ROOT ONLY

Candidate e2d1b9230f4304650651572395523ca9d1644e74, standalone direct module.
Original preseal b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937 remains unchanged.
Source manifest 81eddab7060fcc67dfcf5adc325218b886a4fb50d7e40a1056ad9fe379e83a9a.
38 intended cases once: 30 raw sealed passes, 2 raw sealed failures,
3 unsupported-not-pass, 3 characterizations-not-pass. 35 actual tree invocations.
No source/import errors, timeouts, cancellations, missing/incomplete cases.
No demonstrated product implementation bug or outside-core failure in this cohort.
Do NOT route a source fix merely to make these two sealed predicates green.

N16: RAW EXACT FAILURE / PREDECLARED PROFILE CONFLICT
Exact fixture: rootlink -> links/target; links/target/leaf.txt contains 'leaf'.
Exact argv: ${JSON.stringify(n16.native.argv)}; cwd '/', env C/ASCII profile.
Native status ${n16.native.exitCode}, stdout ${JSON.stringify(Buffer.from(n16.native.stdoutBase64, 'base64').toString())}, stderr ${JSON.stringify(Buffer.from(n16.native.stderrBase64, 'base64').toString())}.
Product status ${n16.output.exitCode}, stdout ${JSON.stringify(outputText(n16, 'stdout'))}, stderr ${JSON.stringify(outputText(n16, 'stderr'))}.
Candidate README explicitly declines to follow root symlinks without -l.
The native expectation remains unchanged and this remains NOT a parity pass.
Root decision: acknowledge chosen profile or request a separate profile change;
this is not an unannounced implementation regression against candidate docs.

N18: RAW SEMANTIC-PREDICATE FAILURE / OVERNARROW SEALED DIAGNOSTIC REGEX
Exact argv: ${JSON.stringify(n18.native.argv)}; fixture contents are irrelevant.
Native status ${n18.native.exitCode}, stderr ${JSON.stringify(Buffer.from(n18.native.stderrBase64, 'base64').toString())}.
Product status ${n18.output.exitCode}, stdout ${JSON.stringify(outputText(n18, 'stdout'))}, stderr ${JSON.stringify(outputText(n18, 'stderr'))}.
Sealed regex /level|depth|invalid|positive|greater/iu excludes a meaningful
'-L must be between 1 and 256' diagnostic. Product rejects zero before VFS work,
matching its documented positive-depth and status2 usage policy. No assertion
was edited or rerun. Original raw failure remains; any future harness correction
must retain it and be separately justified, not a blanket diagnostic relaxation.

Additional raw-native differences (not hidden by semantic passes): N14 sibling
alias traversal, N17 file/missing-root behavior, and N20 JSON formatting.
Full raw exact lane counts: ${JSON.stringify(laneCounts)} across 20 native cases.
N14 ancestor-only behavior is OUR chosen bounded profile, not a literal user
instruction. The original prep attribution was mistaken and is superseded by
the pre-execution profile correction, with original sealed text retained.

Reproduction commands (NOT rerun during initial cohort):
TREE_HOLDOUT_ROOT_RESUMED=AUTHOR_FINISHED TREE_CANDIDATE_DIR=${candidate} \\
node --import ${candidate}/node_modules/tsx/dist/loader.mjs \\
${sealed}/run.mjs --execute ${directory}/bridge.mjs ${directory}/profile.json N16
Use the same command with N18 for the other raw failure. Node -L0 reproduction
uses the actual tree definition; no mock command/parser or modified predicates.
Raw bytes/predicate stacks: ${directory}/raw/N16 and raw/N18.
Authors remain frozen. Root owns any subsequent handoff. No source fixes made.
`;
await writeFile('/tmp/safe-bash-tree-holdout-failures.txt', failures, { flag: 'wx', mode: 0o600 });
const summary = {
  candidate: 'e2d1b9230f4304650651572395523ca9d1644e74', originalSeal: 'b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937',
  rawSealedCounts: report.totals, rawNativeLaneCounts: laneCounts, nativeLanes,
  adjudicated: { sealedPass: 30, declaredProfileConflict: 1, sealedPredicateConflict: 1, unsupported: 3, characterization: 3, demonstratedSourceBugs: 0, outsideCoreFailures: 0, importOrHarnessStartupErrors: 0, timeouts: 0, watchdogCancellations: 0, missing: 0, incomplete: 0 },
  loadedCandidateFiles: [...loaded.values()].sort((left, right) => left.path.localeCompare(right.path)),
  unexpectedLoadedPaths: [...outside], allFrozenInputFilesChecked: inventory.length, inputDrift,
  shellEvidence: observations.get('A37').shells,
  cancellationEvidence: ['A29', 'A30', 'A31'].map((id) => ({ id, sameAsSignalReason: observations.get(id).invocations[0].sameAsSignalReason, rejection: observations.get(id).invocations[0].error })),
  gaps: [
    'A33 bounds C-escaped Unicode name output (actual accepted bytes are ASCII), not a dynamic genuinely multibyte UTF-8 output case. Static Buffer.byteLength accounting is inspected.',
    'A26 duplicate listing hits the entry budget before duplicate validation; it characterizes boundedness, not a deduplication rule.',
    'A25 early malformed entry rejects the listing; not every malformed name path is separately exercised.',
    'Pending FS/sink probes are direct handlers; exact public Shell cancellation behavior is not established by these direct checks.',
    'A37 runs actual Shell JSON pipeline/subshell/redirection and stdin consumer; no jq-specific test.',
    'No new built standalone consumer run or public/default/package integration.',
    'No deployed remote provider, global performance gate, full parity or superiority claim.',
  ],
};
await writeFile(join(directory, 'analysis.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
assert.equal(inputDrift.length, 0);
assert.equal(outside.size, 0);
console.log(JSON.stringify({ rawNativeLaneCounts: laneCounts, loadedCandidateFiles: loaded.size, fullInputFilesUnchanged: inventory.length, unexpectedLoadedPaths: [...outside], rootFailureRoute: '/tmp/safe-bash-tree-holdout-failures.txt' }, null, 2));
