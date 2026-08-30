import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, code, detail) => {
  if (!condition) throw Object.assign(new Error(code), { code, detail });
};
const configBytes = fs.readFileSync(process.argv[2]);
requireThat(hash(configBytes) === process.argv[3], 'CONFIG_HASH');
const config = JSON.parse(configBytes);
requireThat(path.dirname(process.argv[2]) === path.join(root, 'capture-01'), 'CONFIG_PATH');
requireThat(config.caseRoot === path.join(root, 'capture-01', config.scenario.id), 'CASE_ROOT');
const fixtureBytes = fs.readFileSync(path.join(root, 'FIXTURES.json'));
requireThat(hash(fixtureBytes) === config.fixturesSha256, 'FIXTURES_HASH');
const fixtures = JSON.parse(fixtureBytes);
const scenario = config.scenario;
const caseRoot = config.caseRoot;
const report = {
  id: scenario.id, entryURL: import.meta.url, cwd: process.cwd(),
  resolutions: [], loads: [], denied: [], observedCode: null, identity: null,
  importStarted: false, wrapperBound: false, oldOrigin: null, oldOriginAbsent: null,
};
globalThis.__syntheticEvaluations = [];
let hooks;
const descriptor = (relative, bytes, mode = 0o644) => ({ path: relative, bytes: Buffer.byteLength(bytes), sha256: hash(bytes), mode });
const write = (relative, bytes) => {
  const filename = path.join(caseRoot, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o755 });
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 });
  fs.chmodSync(filename, 0o644);
};
const snapshot = () => {
  const entries = [];
  const visit = relative => {
    for (const name of fs.readdirSync(path.join(caseRoot, relative)).sort()) {
      const filename = path.join(relative, name);
      const info = fs.lstatSync(path.join(caseRoot, filename));
      requireThat(!info.isSymbolicLink(), 'SYNTHETIC_SYMLINK');
      if (info.isDirectory()) visit(filename);
      else entries.push(descriptor(filename, fs.readFileSync(path.join(caseRoot, filename)), info.mode & 0o7777));
    }
  };
  visit('');
  return entries;
};
const authenticate = (relative, expected, prefix) => {
  const filename = path.join(caseRoot, relative);
  requireThat(fs.existsSync(filename), `${prefix}_MISSING`, relative);
  const info = fs.lstatSync(filename);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.size === expected.bytes && (info.mode & 0o7777) === expected.mode, `${prefix}_METADATA`, relative);
  const bytes = fs.readFileSync(filename);
  requireThat(hash(bytes) === expected.sha256, `${prefix}_HASH`, relative);
  return bytes;
};
try {
  requireThat(process.version === 'v22.22.2', 'NODE_VERSION');
  requireThat(!fs.existsSync(caseRoot), 'CASE_EXISTS');
  const baseline = scenario.library === 'just-bash';
  const origin = scenario.action === 'move' ? 'origin' : 'consumer';
  const destination = scenario.action === 'move' ? 'relocated' : 'consumer';
  const wrapper = ['selfref', 'wrong-target'].includes(scenario.action) ? fixtures.selfReferenceWrapper
    : scenario.action === 'wrong-baseline' ? fixtures.wrongBaselineWrapper : fixtures.wrapper;
  write('package.json', fixtures.outer);
  write('ambient.mjs', fixtures.ambientModule);
  write(`${origin}/consumer.mjs`, baseline ? fixtures.baselineConsumer : fixtures.targetConsumer);
  write(`${origin}/trap.mjs`, fixtures.trapModule);
  write(`${origin}/node_modules/${scenario.library}/package.json`, baseline ? fixtures.baselinePackage : fixtures.targetPackage);
  write(`${origin}/node_modules/${scenario.library}/index.mjs`, baseline ? fixtures.baselineModule : fixtures.targetModule);
  if (scenario.action !== 'missing') write(`${origin}/package.json`, wrapper);
  if (scenario.action === 'move') {
    report.oldOrigin = path.join(caseRoot, origin);
    fs.renameSync(report.oldOrigin, path.join(caseRoot, destination));
    report.oldOriginAbsent = !fs.existsSync(report.oldOrigin);
    requireThat(report.oldOriginAbsent, 'ORIGIN_PRESENT');
  }
  const consumerPath = `${destination}/consumer.mjs`;
  const targetPath = `${destination}/node_modules/${scenario.library}/index.mjs`;
  const wrapperPath = `${destination}/package.json`;
  const consumerURL = pathToFileURL(path.join(caseRoot, consumerPath)).href;
  report.consumerURL = consumerURL;
  report.expectedWrapper = descriptor(wrapperPath, wrapper);
  report.beforeMutation = snapshot();
  if (scenario.action === 'hash') fs.writeFileSync(path.join(caseRoot, targetPath), fixtures.targetModule.replace('target-stub', 'tAmper-stub'));
  if (scenario.action === 'mode') fs.chmodSync(path.join(caseRoot, targetPath), 0o600);
  if (scenario.action === 'wrapper-hash') fs.writeFileSync(path.join(caseRoot, wrapperPath), wrapper.replace('fixture', 'fixturE'));
  if (scenario.action === 'wrapper-mode') fs.chmodSync(path.join(caseRoot, wrapperPath), 0o600);
  report.beforeImport = snapshot();
  if (!scenario.diagnosticBoundaryBypass) {
    const packageData = JSON.parse(authenticate(wrapperPath, report.expectedWrapper, 'BOUNDARY'));
    requireThat(typeof packageData.name === 'string' && packageData.name.length > 0 && !['virtual-bash', 'just-bash'].includes(packageData.name), 'BOUNDARY_NAME', packageData.name);
    requireThat(packageData.private === true && packageData.type === 'module', 'BOUNDARY_SCOPE');
    report.wrapperBound = true;
  }
  const modules = [descriptor(consumerPath, baseline ? fixtures.baselineConsumer : fixtures.targetConsumer)];
  if (scenario.action !== 'unbound') modules.push(descriptor(targetPath, baseline ? fixtures.baselineModule : fixtures.targetModule));
  const allowed = new Map(modules.map(entry => [pathToFileURL(path.join(caseRoot, entry.path)).href, entry]));
  const entryParent = scenario.action === 'entry-parent' ? pathToFileURL(path.join(root, 'nonexistent-entry.mjs')).href : import.meta.url;
  hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        if (specifier === consumerURL) requireThat(context.parentURL === entryParent, 'ENTRY_PARENT', context.parentURL);
        else requireThat(allowed.has(context.parentURL), 'UNBOUND_PARENT', context.parentURL);
        const resolved = nextResolve(specifier, context);
        report.resolutions.push({ specifier, parentURL: context.parentURL, url: resolved.url });
        requireThat(allowed.has(resolved.url), 'UNBOUND_MODULE', resolved.url);
        return resolved;
      } catch (error) {
        report.denied.push({ phase: 'resolve', code: error.code, specifier, parentURL: context.parentURL, detail: error.detail });
        throw error;
      }
    },
    load(url, context, nextLoad) {
      try {
        requireThat(allowed.has(url), 'UNBOUND_MODULE', url);
        const entry = allowed.get(url);
        authenticate(entry.path, entry, 'LOAD');
        const loaded = nextLoad(url, context);
        requireThat(loaded.format === 'module' && loaded.source != null && hash(Buffer.from(loaded.source)) === entry.sha256, 'RETURNED_SOURCE_HASH', url);
        report.loads.push({ url, ...entry });
        return loaded;
      } catch (error) {
        report.denied.push({ phase: 'load', code: error.code, url, detail: error.detail });
        throw error;
      }
    },
  });
  report.importStarted = true;
  const imported = await import(consumerURL);
  report.identity = imported.library.identity;
} catch (error) {
  report.observedCode = error.code ?? error.name;
  report.error = { name: error.name, message: error.message, detail: error.detail };
  process.exitCode = 23;
} finally {
  hooks?.deregister();
  report.evaluations = globalThis.__syntheticEvaluations;
  if (fs.existsSync(caseRoot)) report.afterImport = snapshot();
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
