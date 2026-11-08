import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const binding = JSON.parse(readFileSync(process.env.LET_BINDING));
assert.equal(binding.root, process.env.LET_EXPECT_ROOT, 'WRONG_ROOT');
if (process.env.LET_CONTROL === 'source-fallback') await import(pathToFileURL(resolve(process.env.LET_SOURCE, 'src/index.ts')));
else await import(pathToFileURL(resolve(binding.root, 'dist/index.js')));
console.log('GUARD_ACCEPTED');
