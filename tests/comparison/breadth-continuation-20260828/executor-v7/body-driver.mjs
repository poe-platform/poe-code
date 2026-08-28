import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCoordinator } from './body.mjs';
import { supervise } from './supervisor.mjs';
import { transport } from './transport.mjs';
import { inspectTree } from './projection.mjs';
import { hash } from '../executor-v4/safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const scenario = process.argv[2];
const work = path.resolve(process.argv[3]);
const allowed = ['positive', 'configuration', 'authorization-null', 'spawn-callback', 'receipt-persistence', 'tail', 'quota', 'unlisted', 'stdout-failure', 'missing-failures', 'overflow', 'nonzero', 'config-tamper', 'caught-gate', 'late-caught-gate'];
if (!allowed.includes(scenario) || !work.startsWith(`${root}/runs/`)) throw new Error('BODY_DRIVER_SCOPE');
const source = fs.readFileSync(path.join(root, 'fixtures/bootstrap-stub.mjs'));
const sourceEntry = { path: 'bootstrap-stub.mjs', bytes: source.length, mode: 0o644, sha256: hash(source) };
const recipe = hash(fs.readFileSync(path.join(root, 'SEAL.json')));
const operation = { id: 'stub-probe', ordinal: 1, kind: 'probe', worker: 'engine', layout: 'stub-installed' };
const plan = { admission: [operation], cohort: [], limits: { admissionSetup: 0 } };
const error = code => Object.assign(new Error(code), { code });
let stageRoot;
let primaryNull;
let timer;
let retire;
const retired = new Promise(resolve => { retire = resolve; });
if (scenario === 'overflow') {
  timer = setInterval(() => {}, 1000);
  process.once('SIGTERM', () => { clearInterval(timer); timer = null; retire(); });
}
const drivers = {
  evidenceLimit: scenario === 'quota' ? 2048 : 268435456,
  async checkpoint(phase, state) {
    if (scenario === phase && ['configuration', 'receipt-persistence', 'tail'].includes(phase)) throw error(`INJECTED_${phase.toUpperCase()}`);
    if (scenario === 'unlisted' && phase === 'stage-intent') fs.writeFileSync(path.join(state.runRoot, 'unlisted.bin'), 'extra', { flag: 'wx' });
    if (scenario === 'config-tamper' && phase === 'child-prepared') {
      const filename = path.join(state.runRoot, 'child-001.json.part-0000.data');
      const bytes = fs.readFileSync(filename); bytes[0] ^= 1; fs.writeFileSync(filename, bytes);
    }
  },
  configure() { return { recipe, schedule: { rows: [] }, workflows: [], legacy: [], plan }; },
  authorize(context) {
    if (scenario === 'authorization-null') { primaryNull = null; throw primaryNull; }
    return { recipe, synthetic: true, grant: { role: 'synthetic-author-not-root' }, plan, authorization: { syntheticOnly: true, operation, recipe, scenario }, context };
  },
  stageDeclaration(runRoot) { stageRoot = path.join(runRoot, 'views/stub-installed'); return { views: [{ root: stageRoot, files: [sourceEntry] }], aliases: [], evidenceFiles: [] }; },
  stage() {
    fs.mkdirSync(stageRoot, { recursive: true }); fs.writeFileSync(path.join(stageRoot, sourceEntry.path), source, { flag: 'wx', mode: sourceEntry.mode });
    return { views: { 'stub-installed': { name: 'stub-installed', root: stageRoot, files: [sourceEntry], padding: 'p'.repeat(700000) } }, proof: 'SYNTHETIC_STUB_NOT_PRODUCT_PROJECTION' };
  },
  integrity(configuration, staged) { if (staged) inspectTree(stageRoot, [sourceEntry]); },
  selectOperation(permission, config) { if (config.kind !== 'probe' || config.view.name !== 'stub-installed') throw error('STUB_OPERATION'); return operation; },
  supervise(prepared, synthetic, runRoot, attach) {
    if (synthetic) throw error('NO_C11_OR_REAL_CONTROLS_IN_BODY_DRIVER');
    return supervise(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, 'test-worker.mjs'), path.join(runRoot, prepared.filename), prepared.configSha], runRoot, { onSpawn: attach });
  },
  spawnObserved() { if (scenario === 'spawn-callback') throw error('INJECTED_SPAWN_CALLBACK'); },
  defectControls: async () => [{ syntheticOnly: true, pass: true }],
  controls: async () => ({ unsafe: false, rows: Array.from({ length: 12 }, (_, index) => ({ id: `SYNTHETIC-C${index + 1}`, pass: true, status: 'PASS', noActualC11OrSemantics: true })) }),
  cleanup() { if (scenario === 'authorization-null') throw 0; },
  inheritedExitCode: () => 0,
  writeStream(descriptor, bytes) {
    if (scenario === 'stdout-failure' && descriptor === 1) throw error('INJECTED_EPIPE');
    if (scenario === 'missing-failures' && descriptor === 1) { const row = JSON.parse(bytes); delete row.failures; fs.writeSync(descriptor, `${JSON.stringify(row)}\n`); return; }
    if (scenario === 'overflow' && descriptor === 1) { fs.writeSync(descriptor, Buffer.concat([bytes, Buffer.alloc(65537 - bytes.length, 32)])); return; }
    fs.writeSync(descriptor, bytes);
  },
};
const result = await runCoordinator({ root: path.join(work, 'body-root'), repository: path.resolve(root, '../../../..'), mode: 'admission', runId: 'case', authorizationPath: 'NO_REAL_AUTHORIZATION' }, drivers);
if (scenario === 'overflow') await retired;
transport().emit({ kind: 'final', report: { explicitlySyntheticNoEngines: true, scenario, status: result.publication.status, rawPrimaryPresent: Object.hasOwn(result.output, 'fatal'), rawPrimaryNull: result.output.fatal === null, cleanupErrors: result.output.cleanupErrors, children: result.ledger.map(entry => ({ pid: entry.pid, group: entry.group, exit: entry.exit, close: entry.close, reaped: entry.reaped, persisted: entry.persisted })), timerRetired: !timer, factoryBoundaryIsStubOnly: true } });
process.exitCode = scenario === 'nonzero' ? 7 : result.publication.exitCode;
