import fs from 'node:fs';
import path from 'node:path';
import { readConfig, encode } from './records.mjs';
import { writeClaim } from './evidence.mjs';
import { transport } from './transport.mjs';
const [role, filename, sha256] = process.argv.slice(2);
if (role === 'metadata') {
  const bytes = Buffer.from(filename, 'base64');
  if (bytes.length > 2048) throw new Error('STUB_METADATA_CAP');
  fs.writeSync(1, bytes); process.exitCode = sha256 === 'nonzero' ? 7 : 0;
} else {
  const value = readConfig(path.dirname(filename), path.basename(filename), sha256);
  if (role === 'config') transport().emit({ kind: 'final', report: { stringLength: value.length, encodedBytesIncludingLF: encode(value).length, noEngine: true } });
  else {
    if (role !== 'worker' || value.authorization?.syntheticOnly !== true) throw new Error('STUB_ONLY');
    const operation = value.authorization.operations.find(row => row.id === value.operationId);
    if (!operation || operation.kind !== value.kind) throw new Error('STUB_OPERATION');
    writeClaim(value, operation, value.authorization.recipe, path.dirname(filename));
    transport().emit({ kind: 'final', report: { exportEvaluation: true, noEngine: true, operationId: operation.id } });
    process.exitCode = operation.id === 'C09-status' ? 7 : 0;
  }
}
