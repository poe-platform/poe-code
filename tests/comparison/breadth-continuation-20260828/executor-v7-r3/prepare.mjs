import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const patch = ['*** Begin Patch'];
for (const name of ['authorization', 'body', 'coordinator', 'production', 'worker', 'synthetic-worker', 'launch']) {
  const bytes = fs.readFileSync(path.join(root, `../executor-v7-r2/${name}.mjs`), 'utf8');
  patch.push(`*** Add File: ${path.join(root, `${name}.mjs`)}`, ...bytes.trimEnd().split('\n').map(line => `+${line}`));
}
for (const name of ['bootstrap', 'contracts', 'records', 'report', 'outer', 'projection', 'loader', 'supervisor', 'launch-ledger', 'evidence', 'schema', 'transport']) patch.push(`*** Add File: ${path.join(root, `${name}.mjs`)}`, `+export * from '../executor-v7-r2/${name}.mjs';`);
patch.push(`*** Add File: ${path.join(root, 'OPERATION-PLAN.json')}`, ...fs.readFileSync(path.join(root, '../executor-v7-r2/OPERATION-PLAN.json'), 'utf8').trimEnd().split('\n').map(line => `+${line}`));
patch.push(`*** Add File: ${path.join(root, 'runs/.keep')}`, '+');
patch.push('*** End Patch');
process.stdout.write(`${patch.join('\n')}\n`);
