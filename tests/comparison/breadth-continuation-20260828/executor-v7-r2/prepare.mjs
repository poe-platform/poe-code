import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const patch = ['*** Begin Patch'];
const origins = { authorization: 'executor-v7-r1', coordinator: 'executor-v7-r1', production: 'executor-v7-r1', worker: 'executor-v7-r1', 'synthetic-worker': 'executor-v7-r1', launch: 'executor-v7-r1', body: 'executor-v7', report: 'executor-v7', records: 'executor-v7', outer: 'executor-v7' };
for (const [name, source] of Object.entries(origins)) {
  const filename = path.join(root, `${name}.mjs`); if (fs.existsSync(filename)) throw new Error('NO_OVERWRITE');
  const text = fs.readFileSync(path.join(root, '..', source, `${name}.mjs`), 'utf8');
  patch.push(`*** Add File: ${filename}`, ...text.trimEnd().split('\n').map(line => `+${line}`));
}
for (const [name, exports] of Object.entries({ bootstrap: 'profile, authenticateBootstrap, createQueryWindow, importWithWindow, closeQueryWindow', projection: 'viewProjection, stage, authenticateView, inspectTree, boundFile', loader: 'installLoader', supervisor: 'supervise', 'launch-ledger': 'createLedger, launchTracked', evidence: 'createEvidenceBudget, writeReserved, claimBytes, writeClaim', schema: 'dataObject, denseArray, hashString, nonnegative', transport: 'transport, parseTransport' })) {
  const origin = name === 'bootstrap' ? 'executor-v7-r1' : 'executor-v7';
  patch.push(`*** Add File: ${path.join(root, `${name}.mjs`)}`, `+export { ${exports} } from '../${origin}/${name}.mjs';`);
}
patch.push(`*** Add File: ${path.join(root, 'OPERATION-PLAN.json')}`, ...fs.readFileSync(path.join(root, '../executor-v7-r1/OPERATION-PLAN.json'), 'utf8').trimEnd().split('\n').map(line => `+${line}`));
patch.push('*** End Patch'); process.stdout.write(`${patch.join('\n')}\n`);
