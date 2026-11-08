import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const targets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = targets.map(target => {
  const resolved = import.meta.resolve(target.name, pathToFileURL(target.packageJson).href);
  assert.equal(resolved, pathToFileURL(target.entry).href);
  return { ...target, resolved, productImportPerformed: false };
});
process.stdout.write(`${JSON.stringify({ results, productImports: 0 }, null, 2)}\n`);
