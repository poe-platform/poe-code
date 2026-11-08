import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readConfig, digest } from '../../../breadth-continuation-20260828/executor-v7-r2/records.mjs';
import { writeClaim } from '../../../breadth-continuation-20260828/executor-v7-r2/evidence.mjs';
import { transport } from '../../../breadth-continuation-20260828/executor-v7-r2/transport.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(home, 'evidence-01');
const [role, identifier] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(home, 'MATRIX.json')));
assert(manifest.children.some(row => row.id === identifier && row.role === role));
function readBound(binding) {
  assert.equal(typeof binding.path, 'string');
  assert(binding.path.startsWith(`${evidence}/`));
  const info = fs.lstatSync(binding.path);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= 65536);
  const bytes = fs.readFileSync(binding.path);
  assert.equal(digest(bytes), binding.sha256);
  return bytes;
}
if (role === 'metadata') {
  assert(['metadata-review', 'metadata-grant'].includes(identifier));
  fs.writeSync(1, `{"fixture":"independent-inert-${identifier === 'metadata-review' ? 'review' : 'grant'}"}\n`);
  transport(3, 65536).emit({ kind: 'final', report: { literalMetadataOnly: true, realAuthority: false } });
} else if (role === 'worker') {
  const dispatch = JSON.parse(fs.readFileSync(path.join(evidence, 'dispatch', `${identifier}.json`)));
  assert(dispatch.root.startsWith(`${evidence}/`) && /^child-\d{3}\.json$/.test(dispatch.name));
  const config = readConfig(dispatch.root, dispatch.name, dispatch.sha256);
  assert.equal(config.authorization.syntheticOnly, true);
  const operation = config.authorization.operations.find(row => row.id === config.operationId);
  assert(operation && operation.kind === config.kind);
  writeClaim(config, operation, config.authorization.recipe, dispatch.root);
  transport(3, 65536).emit({ kind: 'final', report: { exportEvaluation: true, literalStub: true, operationId: operation.id } });
  process.exitCode = identifier === 'worker-status' ? 7 : 0;
} else if (role === 'config') {
  const dispatch = JSON.parse(fs.readFileSync(path.join(evidence, 'dispatch', 'config.json')));
  const rows = dispatch.map(entry => {
    let value, error;
    try { value = readConfig(entry.root, entry.name, entry.sha256); } catch (caught) { error = caught.code; }
    assert.equal(error ?? null, entry.expectedError);
    if (!error) assert.equal(value.length, entry.length);
    return { bytesIncludingLF: entry.bytes, accepted: !error, error: error ?? null };
  });
  transport(3, 65536).emit({ kind: 'final', report: { readerRole: identifier, sharedActualReadConfig: true, wholeWorkerNotInvoked: true, rows } });
} else if (role === 'replay') {
  const dispatch = JSON.parse(fs.readFileSync(path.join(evidence, 'dispatch', `${identifier}.json`)));
  const stdout = readBound(dispatch.stdout);
  const records = readBound(dispatch.records);
  fs.writeSync(1, stdout);
  fs.writeSync(3, records);
  process.exitCode = identifier === 'outer-status' ? 7 : 0;
} else throw new Error('STUB_ROLE');
