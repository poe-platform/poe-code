import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const directory = 'tests/commands/git-independent-20260828/preparation-v3';
const names = ['README.md', 'NATIVE-RECIPE.md', 'binding.mjs', 'capture-metadata.mjs', 'fixture-data.mjs', 'module-adapter.mjs', 'native-adapter.mjs', 'package-adapter.mjs', 'records.json', 'seal.mjs', 'synthetic.mjs', 'type-adapter.mjs', 'type-consumer.ts.txt'];
if (existsSync(new URL('PRESEAL.json', import.meta.url))) throw new Error('Existing preseal must not be overwritten');
const files = names.map(path => {
  const bytes = readFileSync(new URL(path, import.meta.url));
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const preseal = {
  schema: 'git-independent-preparation-preseal-v3', sealedAt: new Date().toISOString(),
  timing: 'POST_IMMUTABLE_DESIGN_AND_RATIFICATION_PRE_CANDIDATE_INSPECTION_PRE_SYNTAX_PRE_SYNTHETIC',
  files, closureSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  candidate: null, candidateGO: null, nativeGO: null,
  allowedValidation: { syntaxOnlyFiles: names.filter(path => path.endsWith('.mjs')), synthetic: 'synthetic.mjs', positives: 2, negatives: 18, total: 20 },
  unrun: { nativeWorkflows: 6, sourceModule: true, installed: true, moved: true, type: true, build: true, pack: true, supervisorChildren: true, currentGate: true },
};
const text = `${JSON.stringify(preseal, null, 2)}\n`;
process.stdout.write(`*** Begin Patch\n*** Add File: ${directory}/PRESEAL.json\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`);
