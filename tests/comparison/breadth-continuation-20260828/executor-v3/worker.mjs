import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authority } from './authorization.mjs';
import { inspectTree, authenticateView } from './projection.mjs';
import { installLoader } from './loader.mjs';
import { installOffline } from './offline.mjs';
import { transport } from './transport.mjs';
import { observe } from './adapter.mjs';
import { requireThat, hash, errorRecord, settle } from './safety.mjs';
import { publicAdmission } from '../executor-overlay-v2/admission.mjs';
import { instrumentFilesystem } from './w07.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const writer = transport();
const write = fs.writeSync.bind(fs);
const readJson = filename => JSON.parse(fs.readFileSync(filename));
let loader;
let offline;
let report;
const late = [];
process.on('unhandledRejection', error => { late.push(errorRecord(error)); process.exitCode = 1; });
process.on('uncaughtException', error => { late.push(errorRecord(error)); process.exitCode = 1; });
try {
  const configBytes = fs.readFileSync(process.argv[2]);
  requireThat(configBytes.length < 2 * 1024 * 1024 && hash(configBytes) === process.argv[3], 'CONFIG_BINDING', process.argv[2]);
  const config = JSON.parse(configBytes);
  const projection = readJson(path.join(root, 'PROJECTION.json'));
  authority({ ...config.authorization, root, projection });
  authenticateView(projection, config.view);
  inspectTree(config.view.root, config.view.files);
  if (config.view.oldOrigin) requireThat(!fs.existsSync(config.view.oldOrigin), 'OLD_LAYOUT_PRESENT', config.view.oldOrigin);
  const bindings = readJson(path.join(root, '../BINDINGS.json'));
  const namespaces = readJson(path.join(root, '../executor-overlay-v2/NAMESPACES.json'));
  loader = installLoader(config.view, value => writer.emit(value));
  offline = installOffline(config.view, value => writer.emit(value));
  const imported = await import(pathToFileURL(path.join(config.view.root, config.view.consumerPath)).href);
  const library = imported.library;
  requireThat(library && (config.view.engine === 'virtual-bash' ? typeof library.Shell === 'function' && typeof library.agentCommands === 'function' : typeof library.Bash === 'function' && typeof library.stdoutAsBytes === 'function'), 'EXPORT_SHAPE', config.view.engine);
  writer.emit({ kind: 'consumer-evaluated', engine: config.view.engine });
  if (config.kind === 'probe') {
    const events = [];
    const filesystem = instrumentFilesystem(config.view.engine === 'virtual-bash' ? library.createMemoryFileSystem() : new library.InMemoryFs(), events, () => 'semantic');
    await filesystem.mkdir('/fixture/bin', { recursive: true });
    await filesystem.writeFile('/fixture/bin/tool', new Uint8Array([120]));
    await filesystem.chmod('/fixture/bin/tool', 0o755);
    const stat = await filesystem.stat('/fixture/bin/tool');
    const accessAvailable = typeof filesystem.access === 'function';
    if (accessAvailable) await filesystem.access('/fixture/bin/tool', 1);
    report = { kind: 'probe', exportEvaluation: true, exportFactoryCall: true, semanticExecCalls: 0, setupExecCalls: 0, observerMechanism: { events, mode: stat.mode, accessAvailable, workflowCredit: false, reason: 'Direct VFS calls only; not which command execution.' } };
  } else if (config.kind === 'C11') {
    requireThat(config.view.engine === 'virtual-bash', 'C11_ENGINE', config.view.engine);
    const filesystem = library.createMemoryFileSystem();
    await filesystem.mkdir('/fixture', { recursive: true });
    await filesystem.writeFile('/fixture/marker', new Uint8Array([1, 2, 3]));
    const initial = Buffer.from(await filesystem.readFile('/fixture/marker')).toString('base64');
    const shell = new library.Shell({ fs: filesystem, cwd: '/fixture', env: { C11_MARKER: 'unchanged' } });
    const sentinel = new Error('SEALED_C11_PLUGIN_REJECTION');
    let admitted = false;
    let caught;
    let dispatches = 0;
    let released;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const barrier = new Promise(resolve => { released = resolve; });
    const lifecycle = await settle({ emit: phase => writer.emit({ kind: 'C11-phase', phase }), dispose: async () => { released(); await shell.dispose(); }, body: async () => {
      shell.use(async (_context, next) => { dispatches++; return next(); });
      shell.use(library.agentCommands());
      shell.use({ name: 'C11-pending-plugin', async setup() { started(); await barrier; if (config.negative) throw sentinel; } });
      let settledAdmission = false;
      const pending = publicAdmission(shell, bindings.target.defaultNames, event => writer.emit({ kind: 'setup', event })).then(() => { admitted = true; settledAdmission = true; }, error => { caught = error; settledAdmission = true; });
      await ready;
      requireThat(!settledAdmission && dispatches === 0, 'C11_PENDING_BOUNDARY', { settledAdmission, dispatches });
      writer.emit({ kind: 'C11-pending-observed', dispatches, settledAdmission });
      released(); await pending;
    } });
    const final = Buffer.from(await filesystem.readFile('/fixture/marker')).toString('base64');
    const result = { admitted, caughtIdentity: caught === sentinel, setupExecCalls: 1, semanticExecCalls: 0, disposed: lifecycle.disposed, dispatches, markerUnchanged: initial === final, pendingPluginBarrierObserved: true, lifecycleErrors: lifecycle.errors };
    report = { kind: 'C11', result, safety: { safe: lifecycle.safe }, pass: lifecycle.safe && dispatches === 0 && initial === final && (config.negative ? !admitted && caught === sentinel : admitted && !caught) };
  } else {
    requireThat(config.kind === 'case', 'WORKER_KIND', config.kind);
    report = await observe({ library, engine: config.view.engine, specimen: config.specimen, bindings, namespaces: namespaces.engines ?? namespaces, emit: value => writer.emit(value), authorization: { rootGo: true, differentFreeze: config.authorization.review.sha256, candidate: projection.candidate } });
    const result = report.result;
    if (result) {
      for (const [descriptor, key] of [[1, 'stdoutBase64'], [2, 'stderrBase64']]) {
        const bytes = Buffer.from(result[key], 'base64');
        let offset = 0;
        while (offset < bytes.length) { const amount = write(descriptor, bytes, offset, bytes.length - offset); requireThat(amount > 0, 'OUTPUT_WRITE', offset); offset += amount; }
      }
      report.result = { exitCode: result.exitCode, stdoutBoundary: result.stdoutBoundary, stderrBoundary: result.stderrBoundary };
    }
  }
  report.loads = { count: loader.loaded.length, evaluated: true, denied: loader.denied };
  report.resources = offline.receipt();
  offline.close(); offline = null;
  loader.close(); loader = null;
  inspectTree(config.view.root, config.view.files);
  report.postGuard = true;
  report.late = late;
  if (late.length || report.resources.pending || report.resources.violations.length || report.loads.denied.length || report.safety?.safe === false) process.exitCode = 1;
  writer.emit({ kind: 'final', report });
} catch (error) {
  offline?.close(); loader?.close();
  process.exitCode = 1;
  try { writer.emit({ kind: 'final', report: report ?? null, fatal: errorRecord(error), late }); }
  catch (transportError) { write(2, `${JSON.stringify({ error: errorRecord(error), transport: errorRecord(transportError) })}\n`); }
}
