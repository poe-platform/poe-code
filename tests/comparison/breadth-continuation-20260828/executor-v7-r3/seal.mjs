import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url)), prior = path.resolve(root, '../executor-v7-r2');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = value => `${JSON.stringify(value, null, 2)}\n`;
const files = new Map();
function bind(filename, expected) {
  const absolute = path.resolve(root, filename), info = fs.lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink() || absolute.split(path.sep).some(name => name.toUpperCase() === 'AGENTS.MD')) throw new Error('INPUT_ROLE');
  const entry = { path: path.relative(root, absolute), bytes: info.size, mode: info.mode & 0o7777, sha256: hash(fs.readFileSync(absolute)), role: expected?.role ?? 'r3-successor' };
  if (expected && ['bytes', 'mode', 'sha256'].some(key => entry[key] !== expected[key])) throw new Error('PRIOR_CHANGED');
  files.set(entry.path, entry);
}
const oldBytes = fs.readFileSync(path.join(prior, 'SEAL.json'));
if (hash(oldBytes) !== 'b19d04354088d31ac387c82606aaa0a7ce64cf26efd0ffbebcfc4f4e5969a03c') throw new Error('PRIOR_SEAL');
const old = JSON.parse(oldBytes);
for (const entry of old.files) bind(path.resolve(prior, entry.path), entry);
bind(path.join(prior, 'SEAL.json'));
const namespace = { path: '.', entries: [], excludedDescendants: ['runs'] };
for (const name of fs.readdirSync(root).sort()) {
  if (['SEAL.json', 'INTERFACE.json', 'AUTHORIZATION-TEMPLATE.data', 'DELTA.json'].includes(name)) throw new Error('NO_RESEAL');
  const info = fs.lstatSync(path.join(root, name));
  if (info.isSymbolicLink() || (info.isDirectory() && name !== 'runs')) throw new Error('NAMESPACE');
  namespace.entries.push({ path: name, directory: info.isDirectory() });
  if (info.isFile()) bind(name);
}
bind('runs/.keep');
const additions = new Map();
function add(name, value) { const bytes = Buffer.from(text(value)); if (bytes.length > 262144) throw new Error('RECORD_CAP'); additions.set(name, bytes); files.set(name, { path: name, bytes: bytes.length, mode: 0o644, sha256: hash(bytes), role: 'r3-concrete-interface' }); namespace.entries.push({ path: name, directory: false }); }
const exactCopies = ['authorization', 'body', 'coordinator', 'production', 'synthetic-worker', 'launch'];
for (const name of exactCopies) if (!fs.readFileSync(path.join(root, `${name}.mjs`)).equals(fs.readFileSync(path.join(prior, `${name}.mjs`)))) throw new Error('UNEXPECTED_BODY_DELTA');
add('DELTA.json', { parentCandidate: '5110550da057398fffd1fb77bf538121c67c731f', consumedAttempt: '25cbb03f1fa1ced0238749235d37eafb001e009e', exactCopies: exactCopies.map(name => `${name}.mjs`), productionChange: 'worker bootstrap binding authentication before loader/offline installation plus ordered observation events; all consumer evaluation still after both guards', rootIndependentHelpers: 'explicit immutable r2 forwards', noPolicyRelaxation: true, controls: '8 whole-worker stubs; exact function bodies except old-worker reversion and bootstrap profile DATA substitution', permission: 'DATA_STUB_ONLY_NO_REAL_ADMISSION' });
const iface = JSON.parse(fs.readFileSync(path.join(prior, 'INTERFACE.json')));
iface.schema = 'BREADTH_V7_R3_ADMISSION_INTERFACE';
iface.recipe.path = path.relative(path.resolve(root, '../../../..'), path.join(root, 'SEAL.json'));
iface.outerCommand.entry = files.get('launch.mjs'); iface.innerCommand.entry = files.get('coordinator.mjs');
iface.executableBindings = iface.executableBindings.map(entry => files.get(entry.path));
iface.authorization.inputPath = `${root}/runs/ROOT_GRANT_NAMESPACE/AUTH.json`;
iface.authorization.grantRequired.outputRoot = `${root}/runs/FRESH_ROOT_RUN_ID`;
iface.outputs.body = `${root}/runs/FRESH_ROOT_RUN_ID`; iface.outputs.collector = `${root}/runs/FRESH_ROOT_RUN_ID-supervision`;
iface.composition = { prior: '25cbb03f consumed3/14 UNSAFE_STOP; target211loads each, comparator0loads/resource countersUNKNOWN', currentPermission: 'Eight whole-worker harmless-stub controls only; real authority and admission unexecuted', full248Plus8MiBBoundaries: 'STATIC_ONLY', next: 'Different focused review then fresh root grant, potentially deferred for priority commands' };
iface.workerOrdering = ['authority-observed review', 'authority-observed grant', 'operation-authorization/claim', 'view-and-bootstrap-authentication', 'loader-installation', 'offline-installation', 'narrow-getter-window-and-consumer-import', 'revoke-before-factory', 'finally-cleanup-and-postguards'];
add('INTERFACE.json', iface);
const template = JSON.parse(fs.readFileSync(path.join(prior, 'AUTHORIZATION-TEMPLATE.data')));
template.grantDocument = iface.authorization.grantRequired; template.commandShape = iface.outerCommand;
add('AUTHORIZATION-TEMPLATE.data', template);
namespace.entries.push({ path: 'SEAL.json', directory: false }); namespace.entries.sort((left, right) => left.path.localeCompare(right.path));
const seal = { schema: 'BREADTH_R3_WHOLE_WORKER_ORDERING_PRESEAL', date: '2026-08-28', permission: 'EIGHT_DATA_STUB_WORKERS_ONLY', originalSealSha256: hash(oldBytes), interfaceSha256: files.get('INTERFACE.json').sha256, namespaces: [namespace, ...old.namespaces.map(entry => ({ ...entry, path: path.relative(root, path.resolve(prior, entry.path)) }))], files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)), wholeHistoricalImportClosureClaim: false };
const bytes = Buffer.from(text(seal)); if (bytes.length > 262144) throw new Error('SEAL_CAP'); additions.set('SEAL.json', bytes);
const patch = ['*** Begin Patch']; for (const [name, bytes] of additions) patch.push(`*** Add File: ${path.join(root, name)}`, ...bytes.toString().trimEnd().split('\n').map(line => `+${line}`)); patch.push('*** End Patch'); process.stdout.write(`${patch.join('\n')}\n`);
