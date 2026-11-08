import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticatePacket } from './authorization.mjs';
import { installLoader } from './loader.mjs';
import { installLoader as legacyLoader } from '../executor-v3/loader.mjs';
import { installOffline } from '../executor-v3/offline.mjs';
import { transport } from '../executor-v3/transport.mjs';
import { inspectTree, boundFile } from '../executor-v3/projection.mjs';
import { hash, requireThat, errorRecord } from '../executor-v4/safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const writer = transport();
let loader;
let offline;
const report = { evaluated: false, caught: null, cleanupErrors: [], late: [], sources: [], resolutions: [], denied: [], resources: null, postGuard: false };
process.on('unhandledRejection', error => { report.late.push(errorRecord(error)); process.exitCode = 1; });
process.on('uncaughtException', error => { report.late.push(errorRecord(error)); process.exitCode = 1; });
try {
  const configPath = path.resolve(process.argv[2]);
  const run = path.join(root, 'runs/resolution-01');
  requireThat(configPath.startsWith(`${run}/child-`) && /\/child-\d{3}\.json$/.test(configPath), 'SYNTHETIC_CONFIG_PATH', configPath);
  const bytes = fs.readFileSync(configPath);
  requireThat(bytes.length <= 4096 && hash(bytes) === process.argv[3], 'SYNTHETIC_CONFIG_HASH', configPath);
  const config = JSON.parse(bytes);
  report.recipeSha256 = authenticatePacket(root);
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'RESOLUTION-CASES.json')));
  const specimen = fixtures.cases.find(entry => entry.id === config.id);
  requireThat(specimen && configPath === path.join(run, `child-${String(specimen.ordinal).padStart(3, '0')}.json`) && config.caseSha256 === hash(JSON.stringify(specimen)), 'SYNTHETIC_CASE_BINDING', config.id);
  requireThat(process.execArgv.includes('--unhandled-rejections=strict') && process.execArgv.includes('--max-old-space-size=256'), 'SYNTHETIC_NODE_FLAGS', process.execArgv);
  for (const tool of fixtures.tools) boundFile(tool.path, tool);
  const capsule = path.join(run, 'cases', specimen.id, 'capsule');
  const origin = path.join(run, 'cases', specimen.id, 'capsule-origin');
  requireThat(!fs.existsSync(origin), 'SYNTHETIC_OLD_ORIGIN', origin);
  report.id = specimen.id;
  report.cwd = process.cwd();
  requireThat(report.cwd === path.join(capsule, 'cwd-decoy'), 'SYNTHETIC_CWD', report.cwd);
  report.before = inspectTree(capsule, specimen.physicalFiles.map(({ text, ...file }) => file));
  fs.writeFileSync(path.join(run, `${specimen.id}.claim`), `${config.caseSha256}\n`, { flag: 'wx', mode: 0o444 });
  const view = { root: path.join(capsule, 'view'), engine: specimen.engine, consumerPath: specimen.consumerPath, files: specimen.allowedFiles };
  try {
    loader = specimen.profile === 'legacy-self-reference-diagnosis' ? legacyLoader(view, event => writer.emit(event)) : installLoader(view, event => writer.emit(event));
    offline = installOffline(view, event => writer.emit(event));
    const imported = await import(pathToFileURL(path.join(view.root, specimen.importPath)).href);
    report.marker = imported.library?.marker ?? null;
    report.evaluated = true;
  } catch (error) { report.caught = errorRecord(error); }
  finally {
    report.sources = loader?.loaded ?? [];
    report.resolutions = loader?.consumerResolutions ?? [];
    report.denied = loader?.denied ?? [];
    report.effects = { entry: globalThis.__breadthEntry ?? null, trap: globalThis.__breadthTrap ?? null, decoy: globalThis.__breadthDecoy ?? null };
    try { report.resources = offline?.receipt() ?? null; offline?.close(); } catch (error) { report.cleanupErrors.push(errorRecord(error)); }
    try { loader?.close(); } catch (error) { report.cleanupErrors.push(errorRecord(error)); }
    loader = null; offline = null;
  }
  report.after = inspectTree(capsule, specimen.physicalFiles.map(({ text, ...file }) => file));
  report.oldOriginAbsent = !fs.existsSync(origin);
  report.postGuard = true;
  if (report.cleanupErrors.length || report.late.length || report.resources?.pending || report.resources?.violations.length) process.exitCode = 1;
  writer.emit({ kind: 'final', report });
} catch (error) {
  try { offline?.close(); } catch (cleanup) { report.cleanupErrors.push(errorRecord(cleanup)); }
  try { loader?.close(); } catch (cleanup) { report.cleanupErrors.push(errorRecord(cleanup)); }
  process.exitCode = 1;
  writer.emit({ kind: 'final', report, fatal: errorRecord(error) });
}
