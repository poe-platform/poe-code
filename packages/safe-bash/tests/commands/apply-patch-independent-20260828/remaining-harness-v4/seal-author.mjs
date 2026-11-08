import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, sha256 } from './primitives.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, '../../../..');
const prefix = path.relative(repository, own);
const frozen = 'tests/commands/apply-patch-independent-20260828/capture-membership-v3/future-v3';
const parent = path.dirname(frozen);
const prior = 'tests/commands/apply-patch-independent-20260828/path-transport-v2';
const sourceNames = [
  ...['controller.mjs', 'supervisor.mjs', 'bootstrap.mjs', 'loader.mjs', 'worker.mjs', 'guard-control.mjs', 'capture-io.mjs', 'deadline.mjs', 'path-bytes.mjs', 'independent-tree.mjs', 'freeze-inventory.mjs', 'freeze-seals.mjs', 'data-controls.mjs', 'METADATA.json', 'EXECUTION-SEAL.json', 'REPORT.md', 'runs/materialize.mjs', 'runs/seal-runtime.mjs', 'runs/verify-results.mjs', 'runs/OPERATOR-PROCESS-QUALIFICATION.md'].map(name => `${frozen}/${name}`),
  ...['controller-admission.mjs', 'capture-io.mjs', 'manifest-bindings.mjs', 'compose-future.mjs'].map(name => `${parent}/${name}`),
  `${prior}/path-bytes.mjs`,
  'tests/commands/apply-patch-independent-20260828/postrun-diagnosis-v1/FINDINGS.md',
  'node_modules/typescript/bin/tsc', 'node_modules/typescript/lib/tsc.js', 'node_modules/typescript/lib/_tsc.js',
];
const sourceBindings = Object.fromEntries(sourceNames.sort().map(name => [name, describe(path.join(repository, name))]));
assert.equal(sourceBindings[`${frozen}/controller.mjs`].bytes, 32318);
assert.equal(sourceBindings[`${frozen}/controller.mjs`].sha256, '89af8472d1f19e2e0dee02c3f09d7d011e7c677cec755b4c614aa8b6a5b8ab3d');
assert.equal(sourceBindings[`${frozen}/EXECUTION-SEAL.json`].sha256, 'ec2f19e1825970b662d60a99f2128158ab7ab494b4161ce2a4b0f121f4dcc8e5');
const execution = JSON.parse(fs.readFileSync(path.join(repository, frozen, 'EXECUTION-SEAL.json')));
assert.equal(execution.jobs.length, 70);
const expectedIds = [
  ...['positive', 'bad-value', 'bad-value-repair', 'root-negative', 'root-repair'].map(name => `types-moved-${name}`),
  ...['L01', 'L02', 'L05', 'L06', 'L07', 'L10'].flatMap(name => ['minus', 'at', 'over'].map(endpoint => `cap-${name}-${endpoint}`)),
  'real-scoped', 'mock-s3-scoped',
  ...['M01', 'M03', 'M04', 'M09', 'M12', 'M18'].flatMap(name => ['before', 'mutant', 'restored'].map(phase => `mutation-${name}-${phase}`)),
];
assert.deepEqual(execution.jobs.slice(27).map(job => job.id), expectedIds);
const remaining = JSON.stringify({ classification: 'UNRUN; separate root GO only', frozenSealSha256: sourceBindings[`${frozen}/EXECUTION-SEAL.json`].sha256, originalBounds: execution.bounds, originalCounts: execution.counts, jobs: execution.jobs.slice(27) }, null, 2) + '\n';
const input = JSON.parse(fs.readFileSync(path.join(own, 'INPUTS.json')));
const oid = (kind, bytes) => crypto.createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const blob = oid('blob', Buffer.from(input.gitBlob));
const tree = oid('tree', Buffer.concat(input.gitPaths.map(name => Buffer.concat([Buffer.from(`100644 ${name}\0`), Buffer.from(blob, 'hex')]))));
const commit = oid('commit', Buffer.from(`tree ${tree}\n${input.gitCommitTail}`));
const expectedStdout = Buffer.concat(input.gitPaths.map(name => Buffer.from(`100644 blob ${blob}\t${name}\0`)));
const output = 'attempt-01';
const work = path.join(own, output, 'work');
const empty = path.join(work, 'empty');
const git = '/Library/Developer/CommandLineTools/usr/bin/git';
const env = { PATH: empty, HOME: path.join(work, 'home'), TMPDIR: path.join(work, 'tmp'), LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1', GIT_EXEC_PATH: empty, GIT_PAGER: '', PAGER: '' };
const gitArgs = ['--no-pager', '--no-replace-objects', '-c', `core.hooksPath=${empty}`, '-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'gc.autoPackLimit=0', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'core.attributesFile=/dev/null', `--git-dir=${path.join(work, 'metadata.git')}`, 'ls-tree', '-rz', '--full-tree', commit];
const names = ['PROPOSAL.md', 'CALLGRAPH.md', 'INPUTS.json', 'primitives.mjs', 'nested-child.mjs', 'controls.mjs', 'seal-author.mjs'];
assert.deepEqual(fs.readdirSync(own).filter(name => name !== '.preseal.patch').sort(), names.toSorted());
const files = Object.fromEntries(names.sort().map(name => [name, describe(path.join(own, name))]));
files['REMAINING.json'] = { bytes: Buffer.byteLength(remaining), mode: 0o644, sha256: sha256(remaining) };
const seal = {
  schema: 'remaining-harness-v4-preseal', classification: 'harmless controls only; not remaining-cohort GO',
  files, sourceBindings, tools: { node: { path: process.execPath, binding: describe(process.execPath) }, git: { path: git, binding: describe(git) } }, nodeVersion: process.version,
  output, launch: { shell: '/bin/zsh', login: false, environment: {}, commandTemplate: `exec -c ${process.execPath} ${path.join(own, 'controls.mjs')} <presealCommit40> <presealSha25664>`, substitutions: 'Only committed preseal identity and its SHA256, authenticated before launch; controller does not run repository Git.' },
  bounds: { totalMs: 600000, admissionCutoffMs: 540000, actualChildren: 2, authorizedMaximumChildren: 12, peakProcesses: 2, rawBytes: 1048576, persistedBytes: 2097152, authorizedCaptureBytes: 33554432, workBytes: 1048576, authorizedWorkBytes: 134217728, inventoryEntries: 128, childTimeoutMs: 15000, retirementGraceMs: 2500 },
  gitFixture: { blob, tree, commit, expectedStdoutBase64: expectedStdout.toString('base64'), expectedStdoutSha256: sha256(expectedStdout) },
  controls: [
    { id: 'R01', expected: 'rename noerror; old5 exact preserved; five expected EEXIST; distinct moved5 wx-created exact' },
    { id: 'R02', expected: 'five exact-existing auth positive, no writes' },
    { id: 'R03', expected: 'different bytes, mode, symlink, hardlink alias each refuse without writes' },
    { id: 'B01', expected: '64-byte admission, 65-byte refusal before retention; helper only' },
    { id: 'G01', expected: 'one direct Git; exact NUL two-path bytes; exit0, empty stderr, close then ESRCH' },
    { id: 'P01', expected: 'one actual Node PID/PPID; ERR_ACCESS_DENIED ChildProcess before nested spawn; occupied admission refuses; release, exit0, empty stderr, close then ESRCH' },
  ],
  children: [
    { id: 'G01', executable: git, args: gitArgs, env, timeoutMs: 15000, maxBytes: 65536 },
    { id: 'P01', executable: process.execPath, args: ['--no-warnings', '--permission', `--allow-fs-read=${path.join(own, 'nested-child.mjs')}`, path.join(own, 'nested-child.mjs')], env: { PATH: empty, HOME: path.join(work, 'home'), TMPDIR: path.join(work, 'tmp'), LC_ALL: 'C' }, timeoutMs: 15000, maxBytes: 65536 },
  ],
  expectedOutcome: { controls: 6, actualChildren: 2, peak: 2, productExecutions: 0, candidateLoads: 0, remainingJobsExecuted: 0, cleanup: 'all exact child close+ESRCH; owned work removed; any unknown => STOP and preserve' },
  postsealPolicy: 'one launch; no retries, added controls, source correction or permission changes; unexpected failures only evidence/report',
};
console.log('*** Begin Patch');
for (const [name, text] of [['REMAINING.json', remaining], ['PRESEAL.json', JSON.stringify(seal, null, 2) + '\n']]) console.log(`*** Add File: ${prefix}/${name}\n` + text.trimEnd().split('\n').map(line => '+' + line).join('\n'));
console.log('*** End Patch');
