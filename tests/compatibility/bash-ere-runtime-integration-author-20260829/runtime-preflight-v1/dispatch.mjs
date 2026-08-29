import * as fs from 'node:fs';
import { grant, sha } from './controller-core.mjs';
const [sealPath, grantPath, confirmedGrantSha, capturePath] = process.argv.slice(2);
const output = fs.openSync(capturePath, 'wx');
fs.writeSync(output, `${JSON.stringify({ event: 'startup', pid: process.pid })}\n`);
try {
  const bytes = fs.readFileSync(sealPath);
  const seal = JSON.parse(bytes);
  const rawGrant = fs.readFileSync(grantPath);
  grant(JSON.parse(rawGrant), sha(bytes), confirmedGrantSha, rawGrant);
  if (seal.deferredCells.length) throw new Error(`RUNTIME_GATES_UNSATISFIED: ${seal.deferredCells.join(',')}`);
  throw new Error('ACTUAL_CONTROLLER_RELEASE_REQUIRED: no runtime launch implementation is enabled by this preparation');
} catch (error) {
  fs.writeSync(output, `${JSON.stringify({ event: 'REFUSED_BEFORE_PRODUCT', message: String(error) })}\n`);
  process.exitCode = 78;
} finally { fs.closeSync(output); }
