import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const home = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const statePath = path.join(home, 'STATE.json');
const state = JSON.parse(fs.readFileSync(statePath));
state.processes += 2;
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
const observations = [];
function read(filename, expected, maximum = 16777216) {
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum || path.basename(filename).toUpperCase() === 'AGENTS.MD') throw Error('READ_METADATA');
  if (expected && (info.size !== expected.bytes || (expected.mode !== undefined && (info.mode & 4095) !== expected.mode))) throw Error('EXPECTED_METADATA');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const chunks = [];
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.ino !== info.ino || opened.dev !== info.dev || opened.size !== info.size) throw Error('OPEN_IDENTITY');
    for (let offset = 0; offset < info.size;) {
      const chunk = Buffer.alloc(Math.min(65536, info.size - offset));
      if (fs.readSync(descriptor, chunk, 0, chunk.length, offset) !== chunk.length) throw Error('SHORT_READ');
      chunks.push(chunk); offset += chunk.length;
    }
  } finally { fs.closeSync(descriptor); }
  const bytes = Buffer.concat(chunks), sha256 = hash(bytes);
  if (expected && sha256 !== expected.sha256) throw Error('READ_HASH');
  observations.push({ path: filename, bytes: bytes.length, mode: info.mode & 4095, sha256 });
  return bytes;
}
function captured(id) {
  const row = state.files.find(value => value.id === id);
  if (!row) throw Error('MISSING_CAPTURE');
  return read(path.join(home, 'captures', id + (row.blob ? '.stdout' : '.data')), { bytes: row.bytes, sha256: row.sha256 });
}
const json = id => JSON.parse(captured(id));
const write = (name, value) => fs.writeFileSync(path.join(home, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const projection = json('projection'), original = json('original-seal'), functional = json('functional-seal'), evidence = json('actual-evidence-manifest');
const projectionBinding = original.files.find(row => row.path === '../executor-v3/PROJECTION.json');
if (projectionBinding.sha256 !== hash(captured('projection'))) throw Error('PROJECTION_SEAL');
const adapterBinding = functional.files.find(row => row.path === 'adapter.mjs');
if (adapterBinding.sha256 !== hash(captured('functional-adapter'))) throw Error('ADAPTER_SEAL');
const rawBindings = [];
for (const row of state.files.filter(value => /^op(7|9|10)-/.test(value.id))) {
  const bound = evidence.files.find(file => path.join(file.root, file.path) === row.path);
  if (!bound || bound.sha256 !== row.sha256 || bound.bytes !== row.bytes || bound.mode !== row.mode) throw Error('ACTUAL_EVIDENCE_BINDING');
  rawBindings.push({ id: row.id, ...bound });
}
const pack = projection.target.pack;
read(pack.physical, pack, 2097152);
const resources = captured('public80-1').toString('utf8');
const closure = JSON.parse(/^const closure = (\{.*\});$/m.exec(resources)[1]);
const installed = path.dirname(path.dirname(path.dirname(path.dirname(state.files.find(row => row.id === 'target-1').path))));
const closureProof = [];
for (const [relative, member] of Object.entries(closure.members)) {
  const projected = projection.target.files.find(row => row.path === relative);
  if (!projected || member.sha256 !== projected.sha256 || member.bytes !== projected.bytes) throw Error('CLOSURE_DIFFERENCE');
  for (const layout of ['target-installed', 'target-moved']) {
    const selected = path.join(installed.replace('/target-installed/', '/' + layout + '/'), relative);
    const bytes = read(selected, projected, 2093056);
    if (fs.realpathSync(selected) !== selected) throw Error('ASSET_ALIAS');
    const text = bytes.toString('utf8');
    const imports = [...text.matchAll(/^import .*? from ["']([^"']+)["'];/gm)].map(match => match[1]);
    if (JSON.stringify(imports) !== JSON.stringify(member.imports)) throw Error('IMPORT_INVENTORY');
    closureProof.push({ layout, path: relative, ...projected, imports, public80Equal: true, proof: 'fresh static bytes/mode/realpath; NOT nested nextLoad' });
  }
}
const client = captured('target-0').toString('utf8');
const clientBinding = projection.target.files.find(row => row.path === 'dist/commands/regex-execution/client.js');
read(path.join(installed.replace('/target-installed/', '/target-moved/'), clientBinding.path), clientBinding);
const extra = {};
for (const relative of ['dist/shell/runtime.js', 'dist/shell/pattern.js', 'dist/commands/expr/expr.js']) {
  const row = projection.target.files.find(value => value.path === relative);
  if (!row) { extra[relative] = { selected: false }; continue; }
  const bytes = read(path.join(installed, relative), row, 2093056);
  const filename = 'source-' + relative.replaceAll('/', '_') + '.data';
  fs.writeFileSync(path.join(home, filename), bytes, { flag: 'wx', mode: 0o600 });
  extra[relative] = { selected: true, ...row, references: bytes.toString('utf8').split('\n').map((text, index) => ({ line: index + 1, text })).filter(row => /regex-execution|new Worker|matchPattern|glob|RegexExecutor/.test(row.text)).slice(0,30) };
}
const sourceAuth = json('run02-source-auth');
const prior = path.join(home, '..', 'regex-worker-du-source-analysis-20260829', 'captures');
const sourceEquality = [];
for (const [name, id] of [['client', 'regex-client.stdout'], ['worker', 'regex-worker.stdout'], ['protocol', 'regex-protocol.stdout'], ['matching', 'regex-matching.stdout']]) {
  const row = sourceAuth.rows.find(value => value.expression.endsWith('/regex-execution/' + name + '.ts'));
  read(path.join(prior, id), row);
  sourceEquality.push({ ...row, freshComparison: true, kind: 'complete earlier capture, not missing stream reconstruction' });
}
const bre = sourceAuth.rows.find(row => row.expression.endsWith('/expr/bre-worker.ts'));
if (hash(captured('bre-source')) !== bre.sha256) throw Error('BRE_SOURCE_IDENTITY');
sourceEquality.push(bre);
const du = [];
for (const operation of [7,9,10]) {
  const input = json('op' + operation + '-input'), manifest = json('op' + operation + '-receipt');
  const bytes = Buffer.concat(manifest.parts.map((part, index) => { const value = captured('op' + operation + '-part' + index); if (value.length !== part.bytes || hash(value) !== part.sha256) throw Error('PART_BINDING'); return value; }));
  if (bytes.length !== manifest.bytes || hash(bytes) !== manifest.sha256) throw Error('LOGICAL_DOCUMENT');
  const raw = JSON.parse(bytes), final = raw.records.findLast(row => row.kind === 'final'), report = final.report;
  const assets = report.resources.assets.filter(row => /\/fs\/memory\/index\.js$|\/commands\/du\/du\.js$|\/regex-execution\/client\.js$/.test(row.path));
  for (const asset of assets) {
    const projected = projection.target.files.find(row => 'node_modules/virtual-bash/' + row.path === asset.path);
    if (!projected || projected.sha256 !== asset.sha256 || projected.bytes !== asset.bytes) throw Error('ACTUAL_PARENT_ASSET');
  }
  const snapshots = ['before', 'after'].map(phase => ({ phase, complete: report[phase].complete, entries: report[phase].entries.map(({ base64, ...row }) => ({ ...row, contentBytes: base64 === undefined ? null : Buffer.from(base64, 'base64').length, contentSha256: base64 === undefined ? null : hash(Buffer.from(base64, 'base64')) })) }));
  const fixture = Object.fromEntries(Object.entries(input.specimen.files).map(([name, file]) => [name, { keys: Object.keys(file), bytes: Buffer.from(file.base64, 'base64').length, sha256: hash(Buffer.from(file.base64, 'base64')), mode: file.mode }]));
  du.push({ operation, caseId: input.specimen.id, script: input.specimen.script, expected: input.specimen.expected, intent: input.specimen.intent, proofLimit: input.specimen.proofLimit, fixture, result: report.result, stdout: Buffer.from(raw.stdout, 'base64').toString('utf8'), stderr: Buffer.from(raw.stderr, 'base64').toString('utf8'), snapshots, assets, denial: raw.records.filter(row => row.kind === 'offline-denied'), reaped: raw.reaped, natural: raw.natural, cleanup: report.cleanup, late: final.late, cleanupErrors: final.cleanupErrors, rawDocumentSha256: manifest.sha256 });
}
const legacy = json('case-data-1').rows.map(row => row.recipe), workflows = json('case-data-2').rows, operations = json('operations').cohort;
const regexCases = new Set(['egrep-positive', 'fgrep-positive', 'W01', 'W05']);
const programs = [...legacy, ...workflows];
if (programs.length !== 33 || operations.length !== 99) throw Error('CASE_COUNT');
const schedule = programs.map(row => ({ id: row.id, script: row.effectiveScript ?? row.script, binding: operations.filter(operation => operation.caseId === row.id), targetInstalled: { maximumStarts: regexCases.has(row.id) ? 8 : 0, maximumActive: regexCases.has(row.id) ? 1 : 0 }, targetMoved: { maximumStarts: regexCases.has(row.id) ? 8 : 0, maximumActive: regexCases.has(row.id) ? 1 : 0 }, comparator: { maximumRegexStarts: 0, applicationWorkerDenialUnchanged: true }, qualification: regexCases.has(row.id) ? 'PROPOSED fail-closed budget, not expected count; idle retirement can cause more than one Worker' : 'PROPOSED zero allowance; unexpected legitimate need is unqualified and needs new review, not a command defect' }));
if (schedule.some(row => row.binding.length !== 3)) throw Error('IDENTITY_COUNT');
write('CLOSURE-PROOF.json', { target: projection.candidate, pack, binaryHashOnly: true, fullArchiveReproduction: false, projectionSeal: projectionBinding, public80: { candidate: closure.candidate, packageSha256: closure.packageSha256, staticClosure: true }, closureProof, client: clientBinding, clientConstructorLines: client.split('\n').map((text,index)=>({ line: index + 1, text })).filter(row => /new Worker|execArgv|resourceLimits|workerOld|workerStack/.test(row.text)), sourceEquality, extra, actualArgumentBrand: 'UNKNOWN', run02CompiledRuntimeTraceEqualityClaim: false });
write('DU-RAW-QUALIFICATION.json', { rawBindings, operations: du, conclusion: 'SOURCE_CORRELATED_UNKNOWN_ALLOCATION_PROFILE_GAP_NOT_DEMONSTRATED_KNOWN_ALLOCATION_FAILURE', qualification: 'raw snapshots omit allocatedBytes; source supplies metadata provenance, not recovered numeric stat observations', originalDUMismatches: 2, rescored: false });
write('WORKER-SCHEDULE-PROPOSAL.json', { status: 'ROOT_DECISION_REQUIRED_NOT_RUNTIME_AUTHORIZATION', schema: 'REGEX_WORKER_INSTRUMENTED_FUNCTIONAL_PROPOSAL_V1', cases: schedule, semanticIdentities: 99, freshSetupCalls: 66, semanticCalls: 99, C11: 0, regexEligibleTargetWorkers: 8, maximumApplicationRegexStarts: 64, maximumActiveApplicationRegexWorkers: 1, comparatorRegexStarts: 0, emptySetupRegexStarts: 0, ordinaryOsPlanUnchangedIfNoHelperProcessAdded: 302, totalOsCapRequiresRevalidation: 336, internalThreadsNotOsProcessCounts: true, nestedPreloadChangesEffectiveExecArgv: true, notLatencyOrPassClaim: true });
write('SOURCE-READ-RECEIPTS.json', { observations, productExecutions: 0, workerExecutions: 0, controlsExecuted: 0, sourceOnly: true });
console.log(JSON.stringify({ closureRows: closureProof.length, sourceMatches: sourceEquality.length, rawRows: du.map(row => ({ operation: row.operation, status: row.result.exitCode, stderr: row.stderr, assets: row.assets.length })), schedule: { identities: 99, eligibleTargetWorkers: 8, proposedStarts: 64 }, extra, processes: state.processes }));
