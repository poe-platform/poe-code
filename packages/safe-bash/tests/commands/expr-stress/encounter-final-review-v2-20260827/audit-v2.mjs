import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const candidate = 'c3e40f8bd721da5e496f3b3abfd51aee45db5a84';
const quota = 'c25e682a7baa2f2abf70cebf8c01d11d0ad5daee';
const freeze = '30dda5b930c6e5ea29a54348926fc02b81f9d8e6';
const quotaFreeze = '2fc54ff376e56b8865fafdc5409f3d64501d78e7';
const baselineEvidence = '8a997c8f';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const save = (name, data) => writeFileSync(join(owned, name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
const sourceFiles = ['src/commands/expr/syntax.ts', 'src/commands/expr/evaluate.ts', 'src/commands/expr/index.ts', 'src/commands/expr/internal.ts', 'src/commands/expr/bre-worker.ts', 'src/commands/regex-execution/client.ts', 'src/commands/regex-execution/protocol.ts', 'src/commands/regex-execution/worker.ts', 'src/index.ts', 'package.json', 'package-lock.json'];
const changes = git('diff', '--name-only', quota, candidate, '--', 'src', 'package.json', 'package-lock.json').toString().trim().split('\n');
assert.deepEqual(changes, sourceFiles.slice(0, 3).sort());
const sources = sourceFiles.map(filename => ({ filename, sha256: hash(git('show', `${candidate}:${filename}`)), blob: git('rev-parse', `${candidate}:${filename}`).toString().trim(), sameAsQuotaCandidate: git('rev-parse', `${candidate}:${filename}`).equals(git('rev-parse', `${quota}:${filename}`)) }));
const baselinePath = 'tests/commands/expr-stress/encounter-independent-v2-20260827/baseline-01/original-results.json';
const baselineBytes = git('show', `${baselineEvidence}:${baselinePath}`);
assert.equal(hash(baselineBytes), hash(readFileSync(join(root, baselinePath))));
const historical = [{ filename: baselinePath, commit: git('rev-parse', baselineEvidence).toString().trim(), sha256: hash(baselineBytes) }];
const quotaPath = 'tests/commands/expr-stress/output-quota-independent-v2-20260827';
const quotaData = JSON.parse(git('show', `${quotaFreeze}:${quotaPath}/FREEZE.json`));
for (const filename of ['FREEZE.json', ...quotaData.drivers.map(driver => driver.path)]) {
  const bytes = git('show', `${quotaFreeze}:${quotaPath}/${filename}`);
  assert.equal(hash(bytes), hash(readFileSync(join(root, quotaPath, filename))));
  historical.push({ filename: `${quotaPath}/${filename}`, commit: quotaFreeze, sha256: hash(bytes) });
}
const shared = JSON.parse(readFileSync(join(owned, 'candidate-01/candidate.json'))).sharedPaths.filter(filename => filename.endsWith('.test.ts'));
assert.equal(shared.length, 11);
const sharedHashes = shared.map(filename => {
  const actual = hash(git('show', `${candidate}:${filename}`));
  const qualified = hash(git('show', `cf5caabebff6eaec146700d4dd8c707ff8958e96:${filename}`));
  return { filename, sha256: actual, qualifiedSha256: qualified, sameAsQualified: actual === qualified, diffFromQualified: actual === qualified ? null : git("diff", "cf5caabebff6eaec146700d4dd8c707ff8958e96", candidate, "--", filename).toString() };
});
const sourceBefore = JSON.parse(readFileSync(join(owned, 'candidate-01/source-before.json')));
const sourceFileRecords = Object.entries(sourceBefore).filter(([, entry]) => entry.kind === 'file');
for (const [filename, entry] of sourceFileRecords) assert.equal(hash(git('show', `${candidate}:${filename}`)), entry.sha256, filename);
const parser = git('show', `${candidate}:src/commands/expr/syntax.ts`).toString();
const entry = git('show', `${candidate}:src/commands/expr/index.ts`).toString();
const worker = git('show', `${candidate}:src/commands/expr/bre-worker.ts`).toString();
assert(!parser.includes('new Budget') && !parser.includes('new RegExp') && !parser.includes('parseExpression'));
assert.equal((entry.match(/new Budget\(/gu) ?? []).length, 1);
assert(worker.includes('backreference to a capture in nullable repetition'));
assert(worker.includes('if (isMainThread) throw new Error'));
const receiptPath = '/tmp/expr-encounter-author-v2-20260827-candidate.txt';
save('SOURCE-AUDIT.json', {
  candidate, quota, freeze, auditedAt: new Date().toISOString(), sourceFiles: sources,
  productionChanges: changes, extractedSourceAndFixtureFilesIndividuallyAuthenticated: sourceFileRecords.length,
  sharedHashes, authenticatedHistoricalInputs: historical,
  authorReceipt: existsSync(receiptPath) ? { path: receiptPath, present: true, text: readFileSync(receiptPath, 'utf8') } : { path: receiptPath, present: false, qualification: 'Not needed to authenticate the committed source candidate.' },
  manualFindings: [
    { paths: ['src/commands/expr/syntax.ts:14', 'src/commands/expr/syntax.ts:47', 'src/commands/expr/syntax.ts:84'], finding: 'Single monotonic token position; active literals and reductions execute while descending precedence. Each active nested call/binary reduction is awaited before continuing. No replay parse/evaluate pass, matcher job cache or budget replacement.' },
    { paths: ['src/commands/expr/syntax.ts:47', 'src/commands/expr/syntax.ts:68', 'src/commands/expr/syntax.ts:97'], finding: 'Inactive traversal keeps structural operands/depth only; no value field, encode, evaluateCall or evaluateBinary is produced/called for an inactive operand. Empty structural arrays/objects still exist; this is not a zero-JavaScript-allocation claim. Syntax diagnostics may encode the offending token for quoting.' },
    { paths: ['src/commands/expr/index.ts:19', 'src/commands/expr/index.ts:28'], finding: 'One Budget per admitted invocation; one withRegexSession scope. Regex limits use the existing remaining budget, result.steps are charged back, and captured bytes are copied once from the owned match subject. No replay-driven numeric/string/worker allocations.' },
    { paths: ['src/commands/expr/internal.ts:29', 'src/commands/expr/internal.ts:67', 'src/commands/regex-execution/protocol.ts:68'], finding: 'Existing argument byte/count, numeric, node/depth, work, string/output and worker limits remain. Parser nodes and inactive structure remain charged. Hard parser maximum 256 and protocol worker ceilings unchanged.' },
    { paths: ['src/commands/regex-execution/client.ts:28', 'src/commands/regex-execution/client.ts:281', 'src/commands/regex-execution/client.ts:289'], finding: 'Cleanup synchronously registers before executor.open; synchronous close prevents admission. Shared close promise and finally await pending work and retirements. Explicit rejected flag and signal.throwIfAborted preserve falsy caller/sink reasons; no truthiness fallback.' },
    { paths: ['src/commands/expr/index.ts:51', 'src/commands/expr/index.ts:69'], finding: 'Stdout write stays outside evaluation diagnostic catch, so sink rejection is exact rather than recast. Normal/emergency stderr writes are awaited. Frozen quota21 and moved falsy controls exercise these branches.' },
    { paths: ['src/commands/regex-execution/worker.ts:3', 'src/commands/expr/bre-worker.ts:186', 'src/commands/expr/bre-worker.ts:272'], finding: 'BRE remains worker-only, with explicit isMainThread refusal and live nullable-repeat/backreference unsupported guard. No repeat-history candidate overlay. Root exports and package inputs are identical to quota candidate; no expr root/subpath promotion.' },
  ],
  noGenuineProductBugEstablished: true,
  knownLimits: ['Source inspection is not a formal proof or unbounded semantic guarantee.', 'One original nearby, one original quota, one legacy canonical and one old-core assertion conflict with the authorized exact sink-identity contract.', 'Shared 275/276 has a native rg parent-repository fixture-location defect, retained as a validation blocker; no input or native argv correction was applied.', 'Four native-dependent legacy tests in two files were not run to avoid native expr recapture.'],
});
console.log(JSON.stringify({ authenticatedFiles: sourceFileRecords.length, sharedFiles: shared.length, sourceChanges: changes }));
