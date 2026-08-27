import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { artifact } from './artifacts.mjs';
import { digest, git } from '../jq-42-independent-review/common.mjs';

if (process.argv[2] === 'capture') {
  const paths = git(['ls-files', 'tests/commands/structured', 'tests/commands/structured-stress']).toString().trim().split('\n').filter(path => !path.includes('/jq-42-review-fixes/'));
  const files = Object.fromEntries(paths.map(path => [path, digest(readFileSync(path))]));
  artifact('immutable-before.json', { head: git(['rev-parse', 'HEAD']).toString().trim(), files });
  console.log(`froze ${paths.length} existing tracked evidence paths`);
} else {
  const { files } = JSON.parse(readFileSync(new URL('./immutable-before.json', import.meta.url)));
  for (const [path, hash] of Object.entries(files)) assert.equal(digest(readFileSync(path)), hash, path);
  console.log(`unchanged ${Object.keys(files).length} evidence paths`);
}
