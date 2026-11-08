import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authenticate, childRun, consumerCopy, directory, inventory, json } from './harness.mjs';
import { holdoutsV2 } from './holdouts-v2.mjs';

export async function runPublic(prepared, label, rows = holdoutsV2(), worker = 'public-worker.mjs') {
  const evidence = join(directory, label); mkdirSync(evidence);
  const root = consumerCopy(prepared, label);
  json(join(root, 'cases.json'), rows);
  for (const file of ['public-worker.mjs', 'loaded-worker.mjs']) copyFileSync(join(directory, file), join(root, file));
  if (worker !== 'public-worker.mjs') copyFileSync(join(directory, worker), join(root, 'public-worker.mjs'));
  json(join(root, 'module-manifest.json'), inventory(root));
  const result = await childRun(root, ['--test', '--test-reporter=tap', 'loaded-worker.mjs'], join(evidence, 'public'));
  for (const file of ['results.json', 'loaded-proof.json']) copyFileSync(join(root, file), join(evidence, file));
  json(join(evidence, 'cases-manifest.json'), rows.map(row => ({ id: row.id, script: row.script, inputBytes: Buffer.from(row.input, 'base64').length })));
  json(join(evidence, 'integrity.json'), authenticate(prepared));
  return { ...result, root, evidence };
}
if (process.argv[2]) {
  const prepared = JSON.parse(readFileSync(process.argv[2]));
  console.log(JSON.stringify(await runPublic(prepared, process.argv[3])));
}
