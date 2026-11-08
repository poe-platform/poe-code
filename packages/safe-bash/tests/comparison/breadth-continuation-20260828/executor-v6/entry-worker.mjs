import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { authenticatePacket } from './authorization.mjs';
import { installLoader } from './loader.mjs';
import { installOffline } from '../executor-v3/offline.mjs';
import { transport } from '../executor-v3/transport.mjs';
import { inspectTree, boundFile } from '../executor-v3/projection.mjs';
import { hash, requireThat, errorRecord } from '../executor-v4/safety.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const run = path.join(root, 'runs/entry-01');
const writer = transport();
const report = { attempts: [], late: [], postGuard: false, workerURL: import.meta.url };
process.on('unhandledRejection', error => { report.late.push(errorRecord(error)); process.exitCode = 1; });
process.on('uncaughtException', error => { report.late.push(errorRecord(error)); process.exitCode = 1; });
try {
  const filename = path.resolve(process.argv[2]);
  requireThat(filename.startsWith(`${run}/child-`) && /\/child-\d{3}\.json$/.test(filename), 'STUB_CONFIG_PATH', filename);
  const bytes = fs.readFileSync(filename);
  requireThat(bytes.length <= 4096 && hash(bytes) === process.argv[3], 'STUB_CONFIG_HASH', filename);
  const config = JSON.parse(bytes);
  report.recipeSha256 = authenticatePacket(root);
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'ENTRY-CASES.json')));
  const specimen = fixtures.cases.find(entry => entry.id === config.id);
  requireThat(specimen && config.caseSha256 === hash(JSON.stringify(specimen)) && filename === path.join(run, `child-${String(specimen.ordinal).padStart(3, '0')}.json`), 'STUB_CASE_BINDING', config.id);
  requireThat(process.execArgv.includes('--unhandled-rejections=strict') && process.execArgv.includes('--max-old-space-size=256'), 'STUB_NODE_FLAGS', process.execArgv);
  for (const tool of fixtures.tools) boundFile(tool.path, tool);
  const parent = path.join(run, 'cases', specimen.id);
  const capsule = path.join(parent, 'capsule');
  const view = { root: path.join(capsule, 'view'), engine: specimen.engine, consumerPath: specimen.consumerPath, files: specimen.allowedFiles };
  const consumerURL = pathToFileURL(path.join(view.root, view.consumerPath)).href;
  report.id = specimen.id;
  report.cwd = process.cwd();
  requireThat(report.cwd === path.join(capsule, 'cwd-decoy'), 'STUB_CWD', report.cwd);
  report.before = inspectTree(capsule, specimen.physicalFiles.map(({ text, ...entry }) => entry));
  requireThat(!fs.existsSync(path.join(parent, 'capsule-origin')), 'OLD_ORIGIN', parent);
  fs.writeFileSync(path.join(run, `${specimen.id}.claim`), `${config.caseSha256}\n`, { flag: 'wx', mode: 0o444 });
  for (const [index, step] of specimen.steps.entries()) {
    const attempt = { index, action: step.action, evaluated: false, importAttempted: false, caught: null, cleanupErrors: [], hooksClosed: false, sources: [], entries: [], bareResolutions: [], resources: null, metadataOverrides: [] };
    let loader;
    let offline;
    let parentHook;
    try {
      const options = step.action === 'missing-binding' ? undefined : { entryParentURL: import.meta.url };
      loader = installLoader(view, event => writer.emit({ ...event, attempt: index }), options);
      if (['missing-parent', 'wrong-parent', 'parent-query'].includes(step.action)) {
        parentHook = registerHooks({ resolve(specifier, context, nextResolve) {
          if (specifier !== consumerURL) return nextResolve(specifier, context);
          const changed = { ...context };
          if (step.action === 'missing-parent') changed.parentURL = undefined;
          else changed.parentURL = step.action === 'parent-query' ? `${import.meta.url}?parent-alias` : pathToFileURL(path.join(view.root, 'unauthorized-parent.mjs')).href;
          attempt.metadataOverrides.push({ original: context.parentURL ?? null, forwarded: changed.parentURL ?? null, purpose: 'presealed synthetic hook context countercontrol, not an actual host route' });
          return nextResolve(specifier, changed);
        } });
      }
      offline = installOffline(view, event => writer.emit({ ...event, attempt: index }));
      let requestedURL = step.action === 'intermediate' ? pathToFileURL(path.join(view.root, 'unauthorized-parent.mjs')).href : step.action === 'bare-parent' ? pathToFileURL(path.join(view.root, 'consumer-v5/other.mjs')).href : consumerURL;
      if (step.action === 'entry-query') requestedURL += '?entry-alias';
      if (step.action === 'entry-fragment') requestedURL += '#entry-alias';
      if (step.action === 'entry-percent') requestedURL = requestedURL.replace('consumer.mjs', '%63onsumer.mjs');
      attempt.requestedURL = requestedURL;
      attempt.importAttempted = true;
      const imported = await import(requestedURL);
      attempt.evaluated = true;
      attempt.marker = imported.library?.marker ?? null;
    } catch (error) { attempt.caught = errorRecord(error); }
    finally {
      attempt.sources = loader?.loaded ?? [];
      attempt.entries = loader?.entryResolutions ?? [];
      attempt.bareResolutions = loader?.consumerResolutions ?? [];
      attempt.effects = { entry: globalThis.__breadthEntry ?? null, trap: globalThis.__breadthTrap ?? null, decoy: globalThis.__breadthDecoy ?? null };
      try { attempt.resources = offline?.receipt() ?? null; offline?.close(); } catch (error) { attempt.cleanupErrors.push(errorRecord(error)); }
      try { parentHook?.deregister(); } catch (error) { attempt.cleanupErrors.push(errorRecord(error)); }
      try { loader?.close(); } catch (error) { attempt.cleanupErrors.push(errorRecord(error)); }
      attempt.hooksClosed = attempt.cleanupErrors.length === 0;
      report.attempts.push(attempt);
    }
    requireThat(attempt.hooksClosed && (!attempt.resources || attempt.resources.pending === 0 && attempt.resources.descriptors === 0 && attempt.resources.violations.length === 0), 'STUB_CLEANUP', attempt);
  }
  report.after = inspectTree(capsule, specimen.physicalFiles.map(({ text, ...entry }) => entry));
  report.oldOriginAbsent = !fs.existsSync(path.join(parent, 'capsule-origin'));
  report.postGuard = true;
  if (report.late.length) process.exitCode = 1;
  writer.emit({ kind: 'final', report });
} catch (error) {
  process.exitCode = 1;
  writer.emit({ kind: 'final', report, fatal: errorRecord(error) });
}
