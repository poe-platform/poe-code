import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const prior = path.resolve(root, '../executor-v7');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = JSON.parse(fs.readFileSync(path.join(prior, 'SEAL.json')));
const files = new Map();
const deltas = [];
for (const name of ['bootstrap.mjs', 'worker.mjs', 'synthetic-worker.mjs', 'coordinator.mjs', 'launch.mjs', 'authorization.mjs', 'production.mjs', 'OPERATION-PLAN.json']) {
  const bytes = fs.readFileSync(path.join(prior, name));
  if (hash(bytes) !== source.files.find(entry => entry.path === name).sha256) throw new Error('ORIGINAL_SOURCE_DRIFT');
  let text = bytes.toString();
  if (name === 'bootstrap.mjs') {
    const old = 'entry?.sha256 === sha256 && entry.bytes === bytes && entry.mode === 0o644';
    if (text.split(old).length !== 2) throw new Error('NONUNIQUE_MODE_PATCH');
    text = text.replace(old, 'entry?.sha256 === sha256 && entry.bytes === bytes && entry.mode === 0o444');
  }
  files.set(name, text);
  deltas.push({ path: name, oldSha256: hash(bytes), newSha256: hash(Buffer.from(text)), bytesIdentical: text === bytes.toString(), change: name === 'bootstrap.mjs' ? 'Exact projected comparator-source mode 0444; consumer remains 0644. No hash/source/capability change.' : 'Only entrypoint location changes; exact original source bytes.' });
}
for (const [name, exports] of Object.entries({ 'body.mjs': 'runCoordinator', 'outer.mjs': 'observeCoordinator, allocation', 'records.mjs': 'createStore, readDocument, encode, digest, limits', 'evidence.mjs': 'createEvidenceBudget, writeReserved, claimBytes, writeClaim', 'report.mjs': 'publish, assessTerminal, reason, selection', 'schema.mjs': 'dataObject, denseArray, hashString, nonnegative', 'projection.mjs': 'viewProjection, stage, authenticateView, inspectTree, boundFile', 'loader.mjs': 'installLoader', 'transport.mjs': 'transport, parseTransport', 'supervisor.mjs': 'supervise', 'launch-ledger.mjs': 'createLedger, launchTracked' })) {
  files.set(name, `export { ${exports} } from '../executor-v7/${name}';\n`);
  deltas.push({ path: name, change: 'Explicit shared immutable harness component; not engine fallback', origin: `../executor-v7/${name}`, originSha256: source.files.find(entry => entry.path === name).sha256 });
}
files.set('DELTA.json', `${JSON.stringify({ schema: 'V7_R1_EXPLICIT_DELTA', oldPreseal: '0036d968', oldEvidence: 'd180c3e4', oldResult: '31/33, two failures, zero unrun; unchanged', onlySemanticSourceChange: 'Comparator source binding 0644 to exact frozen 0444', newRoot: root, deltas, observerCorrection: 'B16 final report children is an integer, while terminal children is an array. Use distinct own-data schemas and post-capture qualification; no old invocation rerun.' }, null, 2)}\n`);
const patch = ['*** Begin Patch'];
for (const [name, text] of files) { if (fs.existsSync(path.join(root, name))) throw new Error('NO_OVERWRITE'); patch.push(`*** Add File: ${path.join(root, name)}`, ...text.trimEnd().split('\n').map(line => `+${line}`)); }
patch.push('*** End Patch'); process.stdout.write(`${patch.join('\n')}\n`);
