import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const peerPath = join(repository, 'tests/commands/filesystem-inspection-stress/harness-review/V2_REVIEW.md');
const peerBytes = await readFile(peerPath);
const peer = peerBytes.toString();
const runnerSha256 = 'de11b74f47288916cd7fd486e91754465e53963ae0bc63c9d4a309ee2e77e756';
assert(peer.includes('**File F29 v2: GO**'));
assert(peer.includes('**File F33/F34: prior scoped GO retained**'));
assert(peer.includes(runnerSha256));
assert.equal(hash(await readFile(join(root, 'holdout/v2-runner.mjs'))), runnerSha256);
const previousChild = await readFile('/tmp/safe-bash-file-harness-correction.RN51tj5j/child.mjs', 'utf8');
const replacements = [
  ["'/private/tmp/safe-bash-file-run.WeB7Vfsc/candidate/dist/commands/file/index.js'", "'./candidate/dist/commands/file/index.js'"],
  ["'/private/tmp/safe-bash-file-run.WeB7Vfsc/candidate/dist/contracts/index.js'", "'./candidate/dist/contracts/index.js'"],
  ["'/private/tmp/safe-bash-file-run.WeB7Vfsc/candidate/dist/shell/index.js'", "'./candidate/dist/shell/index.js'"],
  ["'./holdout/corrected-observed-runner.mjs'", "'./holdout/v2-runner.mjs'"],
  ["assert(['F29', 'F33', 'F34'].includes(caseId), 'Only the three root-authorized correction cases');", "assert(/^F(?:0[1-9]|[12][0-9]|3[0-9]|40)$/u.test(caseId), 'Only the forty root-authorized frozen cases');"],
];
let derived = previousChild;
for (const [before, after] of replacements) {
  assert.equal(derived.split(before).length, 2);
  derived = derived.replace(before, after);
}
const child = await readFile(join(root, 'child.mjs'));
assert.equal(derived, child.toString(), 'No unreviewed bridge edits');
const loader = await readFile(join(root, 'audit-loader.mjs'));
assert.equal(hash(loader), hash(await readFile(join(repository, 'tests/commands/filesystem-inspection-stress/file/harness/audit-loader.mjs'))));
const binding = { approvedAt: new Date().toISOString(), candidateCommit: 'cd37ce07c1f41f3797e19e0f701b662823338843', peerPath, peerReportSha256: hash(peerBytes), approval: 'Root explicitly accepts durable V2_REVIEW.md GO F29v2 and prior F33/F34 GO; previous required tmp path superseded for availability only', rootAuthorization: 'Full original40 exactly once on already READY frozen candidate; zero new native calls; no retries or source/oracle edits', runnerSha256, previousChildSha256: hash(previousChild), childSha256: hash(child), loaderSha256: hash(loader), bridgeReplacements: replacements, options: { limits: { maxSniffBytes: 65536, maxReadFileBytes: 65536 } }, unsupportedFormats: [], predicateChangesThisPhase: [], fixtureChanges: [], oracleChanges: [], policyQualification: 'PREP policy.candidateExecutions=0 is historical seal metadata, not live execution telemetry', buildAndTypes: 'REUSED_READY_NOT_RERUN', standaloneConsumer: 'NOT_RUN_NOT_CLAIMED' };
await writeFile(join(root, 'execution-peer-report.md'), peerBytes, { flag: 'wx', mode: 0o400 });
await writeFile(join(root, 'binding.json'), `${JSON.stringify(binding, null, 2)}\n`, { flag: 'wx', mode: 0o400 });
await mkdir(join(root, 'results'));
for (const name of ['child.mjs', 'audit-loader.mjs']) await chmod(join(root, name), 0o400);
console.log(JSON.stringify({ peerReportSha256: binding.peerReportSha256, runnerSha256, childSha256: binding.childSha256, mechanicalBridgeReplacements: replacements.length, productCalls: 0 }, null, 2));
