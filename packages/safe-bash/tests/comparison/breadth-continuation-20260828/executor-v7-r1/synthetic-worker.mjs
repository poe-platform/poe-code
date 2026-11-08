import fs from 'node:fs';
import { readDocument, encode } from './records.mjs';
import { writeClaim } from './evidence.mjs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installLoader } from './loader.mjs';
import { installOffline } from '../executor-v3/offline.mjs';
import { transport } from './transport.mjs';
import { errorRecord, requireThat, hash } from '../executor-v4/safety.mjs';
import { authority, authenticatePacket } from './authorization.mjs';
import { authorizeOperation } from '../executor-v4/operations.mjs';
import { inspectTree } from './projection.mjs';
const writer = transport();
const root = path.dirname(fileURLToPath(import.meta.url));
let config;
let preflightComplete = false;
let loader;
let offline;
const rawWrite = fs.writeSync.bind(fs);
const cleanupErrors = [];
const authorityMetadata = [];
function closeGuards() {
  for (const [phase, guard] of [['offline-close', offline], ['loader-close', loader]]) {
    try { guard?.close(); } catch (error) { cleanupErrors.push({ phase, error: errorRecord(error) }); process.exitCode = 1; }
  }
  offline = null; loader = null;
}
function final(value) {
  try { writer.emit({ ...value, cleanupErrors, authorityMetadata }); }
  catch (error) { process.exitCode = 1; try { rawWrite(2, encode({ code: 'CONTROL_FINAL_PUBLICATION', publicationCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : null, cleanupFailures: cleanupErrors.length }, 8192)); } catch {} }
}
try {
  const configPath = path.resolve(process.argv[2]);
  requireThat(configPath.startsWith(`${root}/runs/`) && /\/child-\d{3}\.json$/.test(configPath), 'CONFIG_PATH', configPath);
  config = readDocument(path.dirname(configPath), path.basename(configPath), process.argv[3], 2 * 1024 * 1024);
  authenticatePacket(root);
  requireThat(process.execArgv.includes('--unhandled-rejections=strict'), 'STRICT_UNHANDLED_POLICY', process.execArgv);
  if (config.authorization) {
    const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
    const permission = authority({ ...config.authorization, root, projection, metadataChildren: authorityMetadata });
    const operation = authorizeOperation(permission.approved, config, permission.plan, permission.context, 'control');
    requireThat(configPath === path.join(permission.context.outputRoot, `child-${String(config.launchOrdinal).padStart(3, '0')}.json`), 'CONFIG_OPERATION_PATH', configPath);
    inspectTree(config.view.root, permission.plan.admission.find(row => row.id === 'C03-esm').files);
    writeClaim(config, operation, permission.recipe, permission.context.outputRoot);
  } else {
    const fixtures = JSON.parse(fs.readFileSync(path.join(root, '../executor-v4/FOCUSED-FIXTURES.json')));
    requireThat(config.kind === 'focused-control' && config.mode === 'load' && fixtures.some(entry => entry.path === config.entry) && JSON.stringify(config.view.files) === JSON.stringify(fixtures) && config.view.root === path.join(path.dirname(configPath), 'focused-view'), 'FOCUSED_FIXTURE_ONLY', config.kind);
    inspectTree(config.view.root, fixtures);
  }
  preflightComplete = true;
  if (config.mode === 'leak') {
    const timer = setInterval(() => {}, 1000);
    process.once('SIGTERM', () => { clearInterval(timer); final({ kind: 'final', report: { timerRetired: true, intentionalNegative: true } }); });
  } else if (config.mode === 'nonzero') {
    final({ kind: 'final', report: { intentionalNegative: true } }); process.exitCode = 7;
  } else {
    loader = installLoader(config.view, value => writer.emit(value));
    if (config.mode === 'offline' || config.mode === 'require') offline = installOffline(config.view, value => writer.emit(value));
    let report;
    if (config.mode === 'offline') {
      try { await fetch('https://invalid.invalid'); } catch (error) { report = { caught: errorRecord(error) }; }
      requireThat(report?.caught?.code === 'OFFLINE_DENIED', 'OFFLINE_CONTROL', report);
      report.denials = [];
      for (const action of [() => fs.readFileSync('/unbound-source-never-opened'), () => fs.writeFileSync('/unbound-write-never-created', ''), () => process.getBuiltinModule('fs'), () => WebAssembly.compile(new Uint8Array())]) {
        try { await action(); report.denials.push('UNEXPECTED_SUCCESS'); }
        catch (error) { report.denials.push(error.code); }
      }
      const processes = await import('node:child_process');
      try { processes.spawn('never-executed'); report.denials.push('UNEXPECTED_SPAWN'); } catch (error) { report.denials.push(error.code); }
      const workerThreads = await import('node:worker_threads');
      try { new workerThreads.Worker('never-created'); report.denials.push('UNEXPECTED_WORKER'); } catch (error) { report.denials.push(error.code); }
      requireThat(report.denials.length === 6 && report.denials.every(code => ['UNBOUND_ASSET', 'OFFLINE_DENIED'].includes(code)), 'OFFLINE_NEGATIVE', report.denials);
      report.resources = offline.receipt();
    } else {
      const module = await import(pathToFileURL(path.join(config.view.root, config.entry ?? 'loaded.mjs')).href);
      report = { evaluated: true, observation: module.execute ? module.execute() : module.default, sourceCount: loader.loaded.length, entrySha256: config.view.files.find(entry => entry.path === (config.entry ?? 'loaded.mjs'))?.sha256 };
    }
    closeGuards();
    final({ kind: 'final', report });
  }
} catch (error) {
  if (!preflightComplete) process.exitCode = 1;
  closeGuards();
  final({ kind: 'final', report: { caught: errorRecord(error), evaluated: false } });
}
