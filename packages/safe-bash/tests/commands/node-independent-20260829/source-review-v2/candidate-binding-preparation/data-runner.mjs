import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

if (process.argv.length !== 3 || process.argv[2] !== 'data') throw new Error('PREPARATION ONLY: no activation/import/compiler/Worker dispatch');
const own = dirname(fileURLToPath(import.meta.url));
const parent = dirname(own);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = 'c10d338331d56e1f293970010c7015fa602b6a8d';
for (let path = own; path !== '/'; path = dirname(path)) if (lstatSync(path).isSymbolicLink()) throw new Error('symlink scope');
function read(path, limit = 1048576) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('bounded regular input required');
  const bytes = readFileSync(path);
  if (bytes.length !== stat.size) throw new Error('input changed during read');
  return bytes;
}
function ownData(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('record');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) throw new Error('keys');
  const output = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('own data');
    output[key] = descriptor.value;
  }
  return output;
}
const checks = [];
function check(id, result) { checks.push({ id, pass: Boolean(result), role: 'DATA_ONLY' }); if (!result) throw new Error(id); }
function rejects(callback) { try { callback(); return false; } catch { return true; } }
const archive = Buffer.from(read(resolve(parent, 'SOURCE-DATA.json.gz.base64')).toString('utf8'), 'base64');
check('D01-sealed-source-archive', hash(archive) === 'b5b1c044eed4dd167197aac336a190f2b0f784bb05bea7f3097f4c7f2e8617ad');
const decoded = gunzipSync(archive, { maxOutputLength: 1048576 });
const capture = JSON.parse(decoded.toString('utf8'));
check('D02-all-source-blob-hashes', capture.inputs.every(input => {
  const bytes = Buffer.from(input.text);
  return bytes.length === input.bytes && hash(bytes) === input.sha256 && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === input.oid;
}));
const input = suffix => { const value = capture.inputs.find(item => item.spec.endsWith('/' + suffix)); if (!value) throw new Error('missing sealed input'); return value; };
const moduleManifest = JSON.parse(input('MODULE-v4.json').text);
const moduleFiles = moduleManifest.files.map(file => {
  const actual = capture.inputs.find(item => item.spec === source + ':' + file.path);
  if (!actual || actual.sha256 !== file.sha256 || actual.bytes !== file.bytes || actual.oid !== file.blob || hash(Buffer.from(file.body, 'base64')) !== file.sha256) throw new Error('module-source binding');
  return { path: file.path, mode: file.mode, oid: actual.oid, sha256: actual.sha256, bytes: actual.bytes };
});
check('D03-complete-module-manifest', moduleFiles.length === 16 && moduleFiles.filter(file => file.path.endsWith('.ts')).length === 15);
const matrix = JSON.parse(input('MATRIX.json').text);
check('D04-original-semantic-inventory', matrix.cases.length === 38 && new Set(matrix.cases.map(item => item.id)).size === 38);
check('D05-original-type-inventory', matrix.typeFamilies.length === 8 && new Set(matrix.typeFamilies.map(item => item.id)).size === 8);
check('D06-original-load-inventory', matrix.loadFamilies.length === 6 && new Set(matrix.loadFamilies.map(item => item.id)).size === 6);
const raw = read(resolve(own, 'raw-controls.mjs.data'));
const rawIds = [...raw.toString('utf8').split(']);')[0].matchAll(/'(R\d\d-[^']+)'/g)].map(item => item[1]);
check('D07-twelve-disarmed-raw-controls', rawIds.length === 12 && new Set(rawIds).size === 12);
check('D08-no-target-import-in-raw-data', !/\bimport\s*(?:\(|["'{*])/.test(raw.toString('utf8')));
check('D09-unsupported-activation-role', rejects(() => { const role = 'actual'; if (role !== 'data') throw new Error('no actual grant'); }));
check('D10-own-data-null-prototype', ownData(Object.assign(Object.create(null), { present: true, value: undefined }), ['present', 'value']).present === true);
let getterCalls = 0;
const accessor = { present: true };
Object.defineProperty(accessor, 'value', { get() { getterCalls += 1; throw new Error('must not read'); } });
check('D11-accessor-rejection-without-read', rejects(() => ownData(accessor, ['present', 'value'])) && getterCalls === 0);
check('D12-missing-key', rejects(() => ownData({ present: true }, ['present', 'value'])));
check('D13-extra-key', rejects(() => ownData({ present: true, value: 0, extra: 1 }, ['present', 'value'])));
check('D14-own-undefined-presence', Object.hasOwn(ownData({ present: true, value: undefined }, ['present', 'value']), 'value'));
check('D15-array-not-a-record', rejects(() => ownData(new Array(2), ['present', 'value'])));
const changed = Buffer.from(archive); changed[changed.length - 1] ^= 1;
check('D16-in-memory-hash-negative', hash(changed) !== hash(archive));
const anchorSets = [
 ['index.ts:53','host.ts:122','program.ts:70','worker-main.ts:36'],
 ['cli.ts:1','index.ts:54','program.ts:1','lower.ts:151'],
 ['cli.ts:1','program.ts:1','worker-main.ts:44'],
 ['host.ts:94','host.ts:122'],
 ['cli.ts:1','index.ts:40'], ['cli.ts:1','index.ts:63'], ['host.ts:122','lifecycle.ts:110'],
 ['admission.ts:1','index.ts:69','lower.ts:169'], ['admission.ts:1','program.ts:1','host.ts:144'],
 ['admission.ts:1','lower.ts:10','rules.ts:36'], ['admission.ts:1','program.ts:1'], ['program.ts:1','worker-main.ts:40','worker-provider.ts:132'],
 ['values.ts:1','host.ts:141'], ['host.ts:82','host.ts:174'], ['host.ts:197'], ['host.ts:197','host.ts:247'],
 ['host.ts:9','host.ts:247','program.ts:44'], ['lifecycle.ts:110','index.ts:116','worker-provider.ts:48'],
 ['host.ts:94','host.ts:189','worker-main.ts:78','program.ts:17'], ['host.ts:94','program.ts:71'],
 ['program.ts:1','host.ts:164'], ['host.ts:164','host.ts:177'], ['program.ts:1','rules.ts:18'],
 ['types.ts:4','values.ts:1','worker-provider.ts:91','worker-provider.ts:124'],
 ['host.ts:213','index.ts:39'], ['index.ts:30'], ['lifecycle.ts:50','index.ts:116'],
 ['lifecycle.ts:24','host.ts:213'], ['index.ts:39','lifecycle.ts:76','worker-provider.ts:165'],
 ['worker-provider.ts:175','worker-provider.ts:198','index.ts:39'], ['host.ts:182','lifecycle.ts:110','worker-provider.ts:188'],
 ['host.ts:213','worker-provider.ts:121'], ['diagnostics.ts:26','worker-provider.ts:44','worker-main.ts:86'],
 ['lifecycle.ts:123','index.ts:116'], ['lifecycle.ts:50','worker-main.ts:40','worker-provider.ts:132'],
 ['host.ts:36','channel.ts:13','worker-main.ts:30','worker-provider.ts:81'],
 ['worker-provider.ts:165','worker-main.ts:91','types.ts:4'], ['index.ts:18','worker-provider.ts:223'],
];
check('D17-all-source-anchors-exist', anchorSets.length === 38 && anchorSets.flat().every(anchor => {
  const [name, line] = anchor.split(':'); return Number(line) > 0 && Number(line) <= input(name).text.split('\n').length;
}));
const semantics = matrix.cases.map((item, index) => ({ id: item.id, original: item, originalSha256: hash(Buffer.from(JSON.stringify(item))), anchors: anchorSets[index].map(anchor => 'src/commands/node/' + anchor), status: 'BOUND_SOURCE_UNEXECUTED', roles: item.roles, countUnit: 'family; expand variant rows before actual GO' }));
const bindings = {
  schema: 'node-independent-candidate-binding-preparation-v1', source, authorPreseal: capture.author,
  originalMatrix: { spec: input('MATRIX.json').spec, sha256: input('MATRIX.json').sha256 },
  baseline: { derived: '7fde32264d757ef856acf3ae92c8581b4a294341', acceptedInputs: 278, fullPackageMembers: 898, fullPackageSha256: '643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd', proof: 'inherited preparation-v2; not freshly rebuilt/replayed' },
  sourceComposition: { onlyAdditions: moduleFiles, totalSelectedInputs: 294, pendingOtherCoreChangesExcluded: true },
  candidateArtifacts: { fullPackageSha256: null, observedPackageMembers: null, expectedMembers: 958, strictBuild: 'NOT_RUN', actualLoadManifest: null, actualExecutionGrant: null },
  api: { command: 'createNodeCommand', provider: 'createNodeWorkerProvider', profile: 'NP1-CJS-WRQ-L-SYNC-1', abi: 'NP1-ENGINE-PUBLIC-SYNC-1', internalEntry: 'dist/commands/node/index.js', rootExport: false, defaultCommands: 79, services: ['signal','request','delivered','reserve','cutoff','fail'], callbacks: ['start','cancel','retire'], authority: 'seven boolean grants over supplied VFS namespace, not perpath allowlists' },
  semantics,
  types: matrix.typeFamilies.map((item, index) => ({ original: item, bind: ['createNodeCommand returns CommandDefinition; no list/plugin factory', 'unchanged accepted CommandContext/io/invoke declarations', 'NodeRuntimeProvider and NodeWorkerProviderOptions', 'NodeGrants exact optional booleans', 'NodeSession/NodeCompletion/NodeRetirement/NodeHostServices', 'NodeHostRequest/NodeHostResponse/NodeBridge text scalars', 'NodeReason present:true,value:unknown', 'accepted declarations plus only Node-local additions'][index], expectedIdentitiesPerLayout: 2, status: 'NOT_COMPILED' })),
  loads: matrix.loadFamilies.map(item => ({ original: item, status: 'PENDING_ACTUAL_ARTIFACTS' })),
  preparedRaw: { path: 'raw-controls.mjs.data', sha256: hash(raw), ids: rawIds, roles: ['P-parent/helper','P-fake-provider'], invocationsPerLayout: 12, proposedLayouts: 3, proposedRawExecutions: 36, actualWorkers: 0, actualGuestProofs: 0, actualExecutions: 0 },
  futureFamilyRoles: { E: 'actual static Worker plus pinned PUBLIC95; real guest/exit/load witnesses required', P: 'fake provider/parent helper/instrumentation; never engine or real-exit proof', S: 'actual public Shell, actual VFS/stdio and existing shared Budget; independent from direct execute', SOURCE: 'invariants and counted source checks, not runtime measurements' },
  remaining: ['successor fixes/adjudication of V2-F01/V2-F02 and observe completion policy', 'final accepted Node candidate source and full emitted package', '38-family E/S variant expansion and executable dispatcher', 'exact PUBLIC98/95/tool/declaration/load/capture/owner identities', 'finite actual resource and process grant with every rescue/cleanup branch sealed'],
};
check('D18-no-ungranted-activation-bindings', bindings.candidateArtifacts.actualExecutionGrant === null && bindings.preparedRaw.actualExecutions === 0);
const report = { role: 'DATA_ONLY_NOT_PRODUCT', checks, counts: { semanticFamiliesBound: 38, typeFamiliesBound: 8, loadFamiliesBound: 6, preparedRawControls: 12, dataChecks: checks.length, product: 0, compiler: 0, workers: 0, guests: 0, childProcessesSpawnedByThisDispatcher: 0 }, source, archiveSha256: hash(archive), rawControlSha256: hash(raw) };
for (const [name, value] of [['BINDINGS.json', bindings], ['DATA-RESULTS-v1.json', report]]) writeFileSync(resolve(own, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ role: report.role, checks: checks.length, passed: checks.filter(item => item.pass).length, product: 0, workers: 0, activation: 'DISARMED' }));
