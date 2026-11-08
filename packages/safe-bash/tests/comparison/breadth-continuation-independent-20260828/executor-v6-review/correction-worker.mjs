import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { installLoader } from '../../breadth-continuation-20260828/executor-v6/loader.mjs';
import { wrapperEntries, wrapperContent, scopeDefinition } from '../../breadth-continuation-20260828/executor-v5/consumer-scope.mjs';
import { installOffline } from '../../breadth-continuation-20260828/executor-v3/offline.mjs';
import { transport } from '../../breadth-continuation-20260828/executor-v3/transport.mjs';
import { hash, errorRecord } from '../../breadth-continuation-20260828/executor-v4/safety.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
const expectations = JSON.parse(fs.readFileSync(path.join(own, 'CORRECTION-EXPECTATIONS.json')));
const specimen = expectations.cases.find(row => row.id === id);
assert(specimen);
const fixtures = JSON.parse(fs.readFileSync(path.join(own, '../executor-v5-review/FIXTURES.json')));
const writer = transport();
const viewRoot = path.join(own, 'capture-02', id);
const files = wrapperEntries('virtual-bash');
const texts = new Map(files.map(entry => [entry.path, wrapperContent('virtual-bash', entry.path)]));
for (const [name, text] of [['node_modules/virtual-bash/package.json', fixtures.targetPackage], ['node_modules/virtual-bash/index.mjs', fixtures.targetModule]]) {
  files.push({ path: name, bytes: Buffer.byteLength(text), sha256: hash(text), mode: 0o644 });
  texts.set(name, text);
}
for (const entry of files) {
  const filename = path.join(viewRoot, entry.path);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o755 });
  fs.writeFileSync(filename, texts.get(entry.path), { flag: 'wx', mode: entry.mode });
}
const tree = () => {
  const rows = [];
  const visit = relative => {
    for (const name of fs.readdirSync(path.join(viewRoot, relative)).sort()) {
      const member = path.join(relative, name);
      const info = fs.lstatSync(path.join(viewRoot, member));
      assert(!info.isSymbolicLink());
      rows.push({ path: member, mode: info.mode & 0o7777, bytes: info.isFile() ? info.size : null, sha256: info.isFile() ? hash(fs.readFileSync(path.join(viewRoot, member))) : null });
      if (info.isDirectory()) visit(member);
    }
  };
  visit(''); return rows;
};
const view = { root: viewRoot, engine: 'virtual-bash', consumerPath: scopeDefinition('virtual-bash').consumerPath, files };
const consumerURL = pathToFileURL(path.join(viewRoot, view.consumerPath)).href;
const report = { id, workerURL: import.meta.url, consumerURL, before: tree(), forwarded: [], events: [], caught: null, cleanupErrors: [], importAttempted: false };
let loader;
let offline;
let parentHook;
globalThis.__syntheticEvaluations = [];
try {
  loader = installLoader(view, event => report.events.push(event), { entryParentURL: import.meta.url });
  parentHook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier !== consumerURL) return nextResolve(specifier, context);
    const original = context.parentURL;
    if (id === 'missing-in-place') delete context.parentURL;
    else context.parentURL = undefined;
    report.forwarded.push({ original, forwarded: context.parentURL ?? null, parentPresent: Object.hasOwn(context, 'parentURL'), method: specimen.method });
    return nextResolve(specifier, context);
  } });
  offline = installOffline(view, event => report.events.push(event));
  report.importAttempted = true;
  await import(consumerURL);
} catch (error) { report.caught = errorRecord(error); }
finally {
  report.resources = offline?.receipt() ?? null;
  for (const close of [() => offline?.close(), () => parentHook?.deregister(), () => loader?.close()]) {
    try { close(); } catch (error) { report.cleanupErrors.push(errorRecord(error)); }
  }
}
report.loaded = loader?.loaded ?? [];
report.entries = loader?.entryResolutions ?? [];
report.evaluations = globalThis.__syntheticEvaluations;
report.after = tree();
const actual = report.events.find(event => event.kind === 'consumer-entry-attempt');
report.pass = report.caught?.code === specimen.expectedCode && report.importAttempted && report.loaded.length === 0 && report.evaluations.length === 0 && report.forwarded.length === 1 && report.forwarded[0].original === import.meta.url && report.forwarded[0].forwarded === null && report.forwarded[0].parentPresent === specimen.parentPresent && actual?.parentURL === null && actual?.parentPresent === specimen.parentPresent && report.cleanupErrors.length === 0 && report.resources?.pending === 0 && report.resources?.descriptors === 0 && report.resources?.violations.length === 0 && JSON.stringify(report.before) === JSON.stringify(report.after);
writer.emit({ kind: 'final', report });
