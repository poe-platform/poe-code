import fs from 'node:fs';
import { readConfig, encode } from './records.mjs';
import { writeClaim } from './evidence.mjs';
import { profile, authenticateBootstrap, createQueryWindow, importWithWindow, closeQueryWindow } from './bootstrap.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authority } from './authorization.mjs';
import { inspectTree, authenticateView } from './projection.mjs';
import { installLoader } from './loader.mjs';
import { installOffline } from '../executor-v3/offline.mjs';
import { transport } from './transport.mjs';
import { observe } from '../executor-v4/adapter.mjs';
import { requireThat, hash, errorRecord, settle } from '../executor-v4/safety.mjs';
import { publicAdmission } from '../executor-overlay-v2/admission.mjs';
import { instrumentFilesystem } from '../executor-v3/w07.mjs';
import { authorizeOperation } from '../executor-v4/operations.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const writer = transport();
const write = fs.writeSync.bind(fs);
const readJson = filename => JSON.parse(fs.readFileSync(filename));
let loader;
let offline;
let report;
let config;
let permission;
let primaryPresent = false;
let primary;
let queryWindow;
const cleanupErrors = [];
const authorityMetadata = [];
const late = [];
process.on('unhandledRejection', error => { late.push(errorRecord(error)); process.exitCode = 1; });
process.on('uncaughtException', error => { late.push(errorRecord(error)); process.exitCode = 1; });
try {
  const configPath = path.resolve(process.argv[2]);
  requireThat(configPath.startsWith(`${root}/runs/`) && /\/child-\d{3}\.json$/.test(configPath), 'CONFIG_PATH', configPath);
  config = readConfig(path.dirname(configPath), path.basename(configPath), process.argv[3]);
  const projection = readJson(path.join(root, '../executor-v3/PROJECTION.json'));
  permission = authority({ ...config.authorization, root, metadataChildren: authorityMetadata, observe: row => writer.emit(row) });
  const operation = authorizeOperation(permission.approved, config, permission.plan, permission.context, 'engine');
  requireThat(Number.isInteger(config.launchOrdinal) && config.launchOrdinal >= 1 && config.launchOrdinal <= permission.plan.limits[permission.phase === 'admission' ? 'admissionChildren' : 'cohortChildren'] && configPath === path.join(permission.context.outputRoot, `child-${String(config.launchOrdinal).padStart(3, '0')}.json`), 'CONFIG_OPERATION_PATH', configPath);
  requireThat(process.execArgv.includes('--unhandled-rejections=strict'), 'STRICT_UNHANDLED_POLICY', process.execArgv);
  writeClaim(config, operation, permission.recipe, permission.context.outputRoot);
  authenticateView(projection, config.view);
  inspectTree(config.view.root, config.view.files);
  if (config.view.oldOrigin) requireThat(!fs.existsSync(config.view.oldOrigin), 'OLD_LAYOUT_PRESENT', config.view.oldOrigin);
  const bindings = readJson(path.join(root, '../BINDINGS.json'));
  const namespaces = readJson(path.join(root, '../executor-overlay-v2/NAMESPACES.json'));
  loader = installLoader(config.view, value => writer.emit(value), { entryParentURL: import.meta.url });
  offline = installOffline(config.view, value => writer.emit(value));
  const consumerURL = pathToFileURL(path.join(config.view.root, config.view.consumerPath)).href;
  let imported;
  if (config.view.engine === 'just-bash') {
    const binding = authenticateBootstrap(config.view, import.meta.url, pathToFileURL(path.join(root, 'worker.mjs')).href, projection);
    requireThat(binding.entryURL === consumerURL, 'BOOTSTRAP_ENTRY_URL', consumerURL);
    queryWindow = createQueryWindow(value => writer.emit(value));
    imported = await importWithWindow({ host: process, window: queryWindow, load: () => import(consumerURL) });
    for (const [filename, bytes, sha256] of profile.files) requireThat(loader.loaded.some(entry => entry.path === filename && entry.bytes === bytes && entry.sha256 === sha256), 'BOOTSTRAP_RETURNED_SOURCE', filename);
  } else imported = await import(consumerURL);
  requireThat(loader.entryResolutions.length === 1 && loader.entryResolutions[0].accepted === true, 'CONSUMER_ENTRY_REQUIRED', loader.entryResolutions);
  requireThat(loader.consumerResolutions.length === 1 && loader.consumerResolutions[0].accepted === true, 'CONSUMER_RESOLUTION_REQUIRED', loader.consumerResolutions);
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
 } catch (error) { primaryPresent = true; primary = error; }
finally {
  queryWindow?.revoke();
  try { closeQueryWindow(queryWindow); } catch (error) { cleanupErrors.push({ phase: 'bootstrap-close', error: errorRecord(error) }); }
  const loads = loader ? { count: loader.loaded.length, evaluated: Boolean(report), denied: loader.denied, entryResolutions: loader.entryResolutions, consumerResolutions: loader.consumerResolutions } : null;
  let resources = null;
  try { resources = offline?.receipt() ?? null; } catch (error) { cleanupErrors.push({ phase: 'resource-receipt', error: errorRecord(error) }); }
  for (const [phase, operation] of [['offline-close', () => offline?.close()], ['loader-close', () => loader?.close()], ['post-view', () => { if (config?.view && permission) inspectTree(config.view.root, config.view.files); }]]) {
    try { operation(); } catch (error) { cleanupErrors.push({ phase, error: errorRecord(error) }); }
  }
  if (primaryPresent || cleanupErrors.length || late.length || resources?.pending || resources?.descriptors || resources?.violations.length || loads?.denied.length || report?.safety?.safe === false) process.exitCode = 1;
  if (report) { report.loads = loads; report.resources = resources; report.postGuard = !cleanupErrors.some(row => row.phase === 'post-view'); report.late = late; report.bootstrap = queryWindow?.snapshot() ?? null; report.authorityMetadata = permission?.metadataChildren ?? []; report.cleanupErrors = cleanupErrors; }
  try { writer.emit({ kind: 'final', report: report ?? null, ...(primaryPresent ? { primaryPresent: true, primaryUndefined: primary === undefined, fatal: errorRecord(primary) } : {}), cleanupErrors, late, authorityMetadata }); }
  catch (error) { process.exitCode = 1; try { write(2, encode({ code: 'WORKER_FINAL_PUBLICATION', primaryPresent, primaryUndefined: primary === undefined, cleanupFailures: cleanupErrors.length, publicationCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : null }, 8192)); } catch {} }
}
