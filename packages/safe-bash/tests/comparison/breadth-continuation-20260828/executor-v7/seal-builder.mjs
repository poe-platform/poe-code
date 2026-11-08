import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(root, '../../../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const entries = new Map();
function add(filename, expected, role = 'inherited-immutable-input') {
  const absolute = path.resolve(root, filename);
  if (absolute.split(path.sep).some(name => name.toLowerCase() === 'agents.md')) throw new Error('NO_INSTRUCTION_PLAINTEXT');
  const info = fs.lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`NOT_REGULAR:${filename}`);
  const entry = { path: path.relative(root, absolute), bytes: info.size, mode: info.mode & 0o7777, sha256: digest(fs.readFileSync(absolute)), role };
  if (expected && ['bytes', 'mode', 'sha256'].some(key => entry[key] !== expected[key])) throw new Error(`IMMUTABLE_DRIFT:${filename}`);
  entries.set(entry.path, entry);
}
const previous = JSON.parse(fs.readFileSync(path.join(root, '../executor-v6/SEAL.json')));
for (const entry of previous.files) add(path.resolve(root, '../executor-v6', entry.path), entry);
add('../executor-v6/SEAL.json');
for (const name of ['README.md', 'OBSERVATIONS.json', 'REFERENCES.json', 'inspect.mjs']) add(`../builtin-bootstrap-diagnosis-v1/${name}`, null, 'source-diagnosis-immutable');
for (const name of ['SEAL.json', 'publisher.mjs']) add(`../coordinator-report-v1/${name}`, null, 'original-report-component-immutable');
for (const name of ['source-policy/REVIEW.md', 'report-component/REPORT.md']) add(`../../breadth-continuation-independent-20260828/executor-v6-postadmission-review/${name}`, null, 'different-review');
for (const name of ['RESULT.json', 'child-003.json']) add(`../executor-v6/runs/admission-v6-01/${name}`, null, 'historical-oversized-input-not-new-record');
add('../executor-v6/runs/grant-admission-v6-01/coordinator.stdout', null, 'historical-retained-prefix-only');
const config = JSON.parse(fs.readFileSync(path.join(root, '../executor-v6/runs/admission-v6-01/child-003.json')));
for (const entry of config.view.files.filter(entry => [config.view.consumerPath, 'benchmarks/node_modules/just-bash/dist/bundle/index.js', 'benchmarks/node_modules/just-bash/dist/bundle/chunks/chunk-NCUTH6QL.js', 'benchmarks/node_modules/just-bash/dist/bundle/chunks/chunk-ZBUZKIPX.js'].includes(entry.path))) add(path.join(config.view.root, entry.path), entry, 'existing-comparator-source-only-never-imported');
const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
for (const tool of projection.tools) add(tool.path, tool, `tool-${tool.role}`);
const namespace = { path: '.', entries: [], excludedDescendants: ['runs'] };
function walk(relative) {
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const member = path.join(relative, name);
    if (member === 'SEAL.json' || member === 'INTERFACE.json') continue;
    const info = fs.lstatSync(path.join(root, member));
    if (info.isSymbolicLink()) throw new Error('RECIPE_SYMLINK');
    namespace.entries.push({ path: member, directory: info.isDirectory() });
    if (info.isDirectory()) { if (member !== 'runs') walk(member); }
    else add(member, null, 'successor-source-or-presealed-test');
  }
}
walk('');
add('runs/.keep', null, 'immutable-output-namespace-marker');
for (const name of ['SEAL.json', 'INTERFACE.json']) namespace.entries.push({ path: name, directory: false });
namespace.entries.sort((left, right) => left.path.localeCompare(right.path));
const plan = JSON.parse(fs.readFileSync(path.join(root, 'OPERATION-PLAN.json')));
const planSha256 = digest(JSON.stringify({ limits: plan.limits, command: plan.command, phase: 'admission', operations: plan.admission }));
const entry = filename => entries.get(filename);
const iface = {
  schema: 'BREADTH_V7_ADMISSION_INTERFACE', date: '2026-08-28', authorizationNow: 'IMPLEMENTATION_DATA_STUB_ONLY', freshDifferentReviewAndRootGrantRequired: true,
  candidate: '67eab12e315054907ef4ef435c6bbca2f59e0c36', packSha256: '6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06', comparatorVersion: '3.4.2', latestClaim: false,
  recipe: { path: path.relative(repository, path.join(root, 'SEAL.json')), hashRule: 'SHA256 of exact final SEAL.json bytes, supplied in final handoff; no circular placeholder hash is accepted' },
  planSha256, command: { entry: 'coordinator.mjs', phase: 'admission', runId: 'FRESH_ROOT_RUN_ID', nodeArgs: ['--unhandled-rejections=strict', '--max-old-space-size=256'] },
  outerCommand: { node: projection.tools.find(tool => tool.role === 'node'), nodeArgs: ['--unhandled-rejections=strict', '--max-old-space-size=256'], entry: entry('launch.mjs'), argv: ['admission', 'FRESH_ROOT_RUN_ID', 'ABSOLUTE_AUTH_JSON', 'EXACT_AUTH_JSON_SHA256'] },
  innerCommand: { entry: entry('coordinator.mjs'), argv: ['admission', 'FRESH_ROOT_RUN_ID', 'ABSOLUTE_AUTH_JSON', 'EXACT_AUTH_JSON_SHA256'], stdio: ['ignore', 'pipe', 'pipe', 'pipe'] },
  executableBindings: ['body.mjs', 'production.mjs', 'worker.mjs', 'synthetic-worker.mjs', 'bootstrap.mjs', 'authorization.mjs', 'loader.mjs', 'supervisor.mjs', 'launch-ledger.mjs', 'outer.mjs', 'report.mjs', 'records.mjs', 'evidence.mjs', 'transport.mjs', 'schema.mjs'].map(entry),
  authorization: { inputKeys: ['review', 'grant'], referenceKeys: ['commit', 'path', 'sha256'], inputPath: `${root}/runs/ROOT_GRANT_NAMESPACE/AUTH.json`, inputMaxBytes: 65536, inputMode: 420, grantRequired: { role: 'root', phase: 'admission', attempts: 1, runId: 'FRESH_ROOT_RUN_ID', outputRoot: `${root}/runs/FRESH_ROOT_RUN_ID`, recipeSha256: 'FINAL_SEAL_SHA256', reviewSha256: 'EXACT_POSITIVE_DIFFERENT_REVIEW_SHA256', planSha256, bootstrapProfile: 'JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1', reportProtocol: 'BOUNDED_TERMINAL_V2' }, reviewRequired: { role: 'different-reviewer', verdict: 'PREEXECUTION_ACCEPTED', recipeSha256: 'FINAL_SEAL_SHA256' }, actualGitChildrenSeparatelyAccounted: true },
  outputs: { body: `${root}/runs/FRESH_ROOT_RUN_ID`, collector: `${root}/runs/FRESH_ROOT_RUN_ID-supervision`, bodyBudget: 260046848, collectorBudget: 8388608, combinedBudget: 268435456, perRecordBytes: 262144, logicalDocumentBytes: 33554432, configAndStagedBytes: 2097152, stdoutBytes: 65536, stderrBytes: 65536, metadataStreamBytes: 262144, instructionPlaintextAllowed: false },
  lifecycle: { workersPlanned: 14, workerCap: 27, concurrency: 1, C11EmptySetups: 2, semanticCalls: 0, childOldSpaceMiB: 256, childMs: 30000, termGraceMs: 2000, killGraceMs: 1000, outerCheckedMs: 4500000, heapIsNotRSS: true, notHardPreemption: true },
  acceptance: ['default production assessTerminal true', 'ADMISSION_ACCEPTED', 'unsafe false', 'all PASS', 'all actual exit/close and reaping', 'natural outer exit zero, no truncation/signals/failures', 'all closure/projection/load/asset/C11 predicates', 'postintegrity and full registered evidence census'],
  exclusions: ['No existing grant authorizes V7', 'No actual engine or C11 executed by synthetic tests', 'W07 comparator nonexecution remains UNQUALIFIED and UNCREDITED', 'Separate 99 semantic authorization required', 'No native/private/network/capability-equivalence/caller-authentication/full-gate claims'],
};
iface.authorization.grantRequired.candidate = iface.candidate;
iface.authorization.grantRequired.packSha256 = iface.packSha256;
iface.authorization.grantRequired.command = iface.command;
const interfaceBytes = Buffer.from(json(iface));
entries.set('INTERFACE.json', { path: 'INTERFACE.json', bytes: interfaceBytes.length, mode: 0o644, sha256: digest(interfaceBytes), role: 'concrete-successor-interface' });
const seal = { schema: 'BREADTH_V7_PREEXECUTION_SEAL', date: '2026-08-28', permission: 'ONE_PRESEALED_DATA_STUB_RUN_ONLY', previousSealSha256: digest(fs.readFileSync(path.join(root, '../executor-v6/SEAL.json'))), interfaceSha256: digest(interfaceBytes), namespaces: [namespace], files: [...entries.values()].sort((left, right) => left.path.localeCompare(right.path)) };
const sealBytes = Buffer.from(json(seal));
if (sealBytes.length > 262144 || interfaceBytes.length > 262144) throw new Error('SEAL_RECORD_CAP');
const patch = ['*** Begin Patch'];
for (const [name, bytes] of [['INTERFACE.json', interfaceBytes], ['SEAL.json', sealBytes]]) {
  if (fs.existsSync(path.join(root, name))) throw new Error('NEVER_OVERWRITE_EXISTING_PRESEAL');
  patch.push(`*** Add File: ${path.join(root, name)}`, ...bytes.toString().trimEnd().split('\n').map(line => `+${line}`));
}
patch.push('*** End Patch');
process.stdout.write(`${patch.join('\n')}\n`);
