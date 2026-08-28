import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, boundFile, relativeName, requireThat, errorRecord } from './core.mjs';
import { originalProjection, available } from './metadata.mjs';
import { syntheticControls } from './controls.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '..');
const repository = resolve(root, '../../..');
const action = process.argv[2];
const preparation = JSON.parse(readFileSync(resolve(directory, 'BINDINGS.json')));
requireThat(realpathSync(process.execPath) === preparation.tools.find(tool => tool.role === 'node').path && process.version === 'v22.22.2', 'NODE_BINDING', process.execPath);
const recipeBytes = readFileSync(resolve(directory, 'RECIPE-SEAL.json'));
const recipe = JSON.parse(recipeBytes);
function guard() {
  originalProjection(root);
  for (const tool of preparation.tools) boundFile(tool.path, tool);
  for (const entry of recipe.files) boundFile(resolve(directory, relativeName(entry.path)), entry);
  requireThat(hash(readFileSync(resolve(directory, 'RECIPE-SEAL.json'))) === hash(recipeBytes), 'RECIPE_SEAL_CHANGED', 'self');
  const approvedTop = new Set([...recipe.files.map(entry => entry.path.split('/')[0]), 'RECIPE-SEAL.json', 'runs', 'EVIDENCE-MANIFEST.json', 'HANDOFF.md']);
  requireThat(readdirSync(directory).every(name => approvedTop.has(name)), 'NEW_PREPARATION_ENTRY', 'top-level');
  requireThat(JSON.stringify(readdirSync(resolve(directory, 'fixtures')).sort()) === JSON.stringify(recipe.files.filter(entry => entry.path.startsWith('fixtures/')).map(entry => entry.path.slice(9)).sort()), 'NEW_FIXTURE_ENTRY', 'fixtures');
}
guard();
requireThat(action === '--availability' || action === '--synthetic', 'ROOT_GO_REQUIRED', 'Product/comparator/native/timing route is disabled. Different freeze and rootGO have not been supplied.');
const runDirectory = resolve(directory, 'runs');
mkdirSync(runDirectory, { recursive: true });
const name = action === '--availability' ? 'availability-01' : 'synthetic-01';
writeFileSync(resolve(runDirectory, `${name}.lock`), `${JSON.stringify({ recipeSha256: hash(recipeBytes), action })}\n`, { flag: 'wx', mode: 0o644 });
const receipt = { action, recipeSha256: hash(recipeBytes), startedAt: new Date().toISOString(), preGuard: 'passed', productImports: 0, comparatorImports: 0, nativeOracleCalls: 0 };
try {
  receipt.result = action === '--availability'
    ? available(repository, root, preparation)
    : await syntheticControls(directory, root, process.execPath, guard);
  receipt.outcome = action === '--synthetic' && (receipt.result.counts.failed || receipt.result.counts.unrun) ? 'SYNTHETIC_REJECT' : 'PREPARATION_COMPLETED';
} catch (error) { receipt.outcome = 'PREPARATION_REJECT'; receipt.error = errorRecord(error); }
finally {
  try { guard(); receipt.postGuard = 'passed'; }
  catch (error) { receipt.postGuard = errorRecord(error); receipt.outcome = 'PREPARATION_REJECT'; }
  receipt.finishedAt = new Date().toISOString();
  const output = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  requireThat(output.length <= 4 * 1024 * 1024, 'PREPARATION_RECEIPT_LIMIT', output.length);
  writeFileSync(resolve(runDirectory, `${name}.json`), output, { flag: 'wx', mode: 0o644 });
}
console.log(JSON.stringify({ action, outcome: receipt.outcome, postGuard: receipt.postGuard, counts: receipt.result?.counts, comparator: receipt.result?.comparator && { declared: receipt.result.comparator.declaredFiles, authenticated: receipt.result.comparator.authenticatedRegularFiles, forbidden: receipt.result.comparator.forbidden.length, errors: receipt.result.comparator.errors.length }, error: receipt.error }));
if (receipt.outcome !== 'PREPARATION_COMPLETED') process.exitCode = 1;
