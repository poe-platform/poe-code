import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const patch = ['*** Begin Patch'];
for (const name of ['prepare-controls.mjs', 'test.mjs']) {
  let source = fs.readFileSync(path.join(root, name), 'utf8');
  source = source.replaceAll("from './", "from '../../");
  source = source.replace("const root = path.dirname(fileURLToPath(import.meta.url));", "const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');");
  source = "import { createEvidenceBudget } from '../../evidence.mjs';\n" + source;
  if (name === 'prepare-controls.mjs') source = source.replace("path.join(root, 'runs', plan.runId)", "path.join(root, 'runs', 'ordering-stubs-v2-01')").replace('createStore(output)', 'createStore(output, { budget: createEvidenceBudget(output, { limit: 67108864 }) })');
  else source = source.replace('runs/ordering-stubs-01', 'runs/ordering-stubs-v2-01').replace('createStore(evidence)', 'createStore(evidence, { budget: createEvidenceBudget(evidence, { limit: 67108864 }) })');
  patch.push(`*** Add File: ${path.join(directory, name)}`, ...source.trimEnd().split('\n').map(line => `+${line}`));
}
patch.push('*** End Patch'); process.stdout.write(`${patch.join('\n')}\n`);
