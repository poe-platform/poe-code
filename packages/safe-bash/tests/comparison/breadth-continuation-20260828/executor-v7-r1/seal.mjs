import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const prior = path.resolve(root, '../executor-v7');
const repository = path.resolve(root, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = new Map();
function bind(filename, expected, role = 'successor-source') {
  const absolute = path.resolve(root, filename);
  if (absolute.split(path.sep).some(name => name.toLowerCase() === 'agents.md')) throw new Error('INSTRUCTION_READ_FORBIDDEN');
  const info = fs.lstatSync(absolute); if (!info.isFile() || info.isSymbolicLink()) throw new Error('NOT_REGULAR');
  const entry = { path: path.relative(root, absolute), bytes: info.size, mode: info.mode & 0o7777, sha256: hash(fs.readFileSync(absolute)), role };
  if (expected && ['bytes', 'mode', 'sha256'].some(key => entry[key] !== expected[key])) throw new Error(`IMMUTABLE_DRIFT:${filename}`);
  files.set(entry.path, entry);
}
const oldBytes = fs.readFileSync(path.join(prior, 'SEAL.json'));
if (hash(oldBytes) !== 'f3abcea2fbe712c6a8c4fbea882e12b81e0e26733ee31fd16bd1a9d83f26b77a') throw new Error('ORIGINAL_SEAL_DRIFT');
const old = JSON.parse(oldBytes);
for (const entry of old.files) bind(path.resolve(prior, entry.path), entry, entry.role);
bind(path.join(prior, 'SEAL.json'), null, 'immutable-old-seal');
for (const filename of ['runs/evidence-v7-01/MANIFEST.json', 'runs/evidence-v7-01/raw-0000.gzpart', 'runs/synthetic-v7-01/receipts/RESULT.json']) bind(path.join(prior, filename), null, 'original-raw-evidence-not-rescored');
const namespace = { path: '.', entries: [], excludedDescendants: ['runs'] };
for (const name of fs.readdirSync(root).sort()) {
  if (['SEAL.json', 'INTERFACE.json'].includes(name)) throw new Error('NO_RESEAL_IN_PLACE');
  const info = fs.lstatSync(path.join(root, name)); if (info.isSymbolicLink()) throw new Error('SYMLINK');
  namespace.entries.push({ path: name, directory: info.isDirectory() });
  if (info.isDirectory()) { if (name !== 'runs') throw new Error('UNEXPECTED_DIRECTORY'); }
  else bind(name);
}
bind('runs/.keep');
for (const name of ['INTERFACE.json', 'SEAL.json']) namespace.entries.push({ path: name, directory: false });
namespace.entries.sort((left, right) => left.path.localeCompare(right.path));
const iface = JSON.parse(fs.readFileSync(path.join(prior, 'INTERFACE.json')));
iface.schema = 'BREADTH_V7_R1_ADMISSION_INTERFACE';
iface.recipe.path = path.relative(repository, path.join(root, 'SEAL.json'));
iface.outerCommand.entry = files.get('launch.mjs');
iface.innerCommand.entry = files.get('coordinator.mjs');
iface.executableBindings = iface.executableBindings.map(entry => files.get(entry.path));
iface.authorization.inputPath = `${root}/runs/ROOT_GRANT_NAMESPACE/AUTH.json`;
iface.authorization.grantRequired.outputRoot = `${root}/runs/FRESH_ROOT_RUN_ID`;
iface.outputs.body = `${root}/runs/FRESH_ROOT_RUN_ID`;
iface.outputs.collector = `${root}/runs/FRESH_ROOT_RUN_ID-supervision`;
iface.composition = { originalPreseal: '0036d968', originalEvidence: 'd180c3e4', originalResult: '31/33 unchanged', actualQualifiedOriginalFamilies: 31, focusedContinuation: 'G08-r1 source-only and B16-r1 post-capture data; no old run replay', sourceSemanticDelta: files.get('DELTA.json'), unchangedOriginalNamespacesAuthenticated: true };
const interfaceBytes = Buffer.from(`${JSON.stringify(iface, null, 2)}\n`);
files.set('INTERFACE.json', { path: 'INTERFACE.json', bytes: interfaceBytes.length, mode: 0o644, sha256: hash(interfaceBytes), role: 'successor-concrete-interface' });
const namespaces = [namespace, ...old.namespaces.map(value => ({ ...value, path: path.relative(root, path.resolve(prior, value.path)) }))];
const seal = { schema: 'BREADTH_V7_R1_PREEXECUTION_SEAL', date: '2026-08-28', permission: 'ONE_FOCUSED_SOURCE_DATA_ONLY_NO_ENGINE_OR_CHILD_LAUNCH', oldSealSha256: hash(oldBytes), interfaceSha256: hash(interfaceBytes), namespaces, files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)) };
const sealBytes = Buffer.from(`${JSON.stringify(seal, null, 2)}\n`);
if (interfaceBytes.length > 262144 || sealBytes.length > 262144) throw new Error('RECORD_CAP');
const patch = ['*** Begin Patch'];
for (const [name, bytes] of [['INTERFACE.json', interfaceBytes], ['SEAL.json', sealBytes]]) patch.push(`*** Add File: ${path.join(root, name)}`, ...bytes.toString().trimEnd().split('\n').map(line => `+${line}`));
patch.push('*** End Patch'); process.stdout.write(`${patch.join('\n')}\n`);
