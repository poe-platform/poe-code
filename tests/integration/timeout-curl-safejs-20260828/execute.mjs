import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url)), repository = resolve(own, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(join(own, 'MANIFEST.json'));
assert.equal(hash(bytes), process.argv[2], 'EXPLICIT_RECIPE_SEAL');
const manifest = JSON.parse(bytes), binding = JSON.parse(fs.readFileSync(join(own, 'BINDINGS.json')));
for (const row of manifest.files) assert.equal(hash(fs.readFileSync(join(own, row.path))), row.sha256, `PRE_RUN_RECIPE:${row.path}`);
for (const row of binding.references) assert.equal(hash(fs.readFileSync(join(repository, row.path))), row.sha256, `PRE_RUN_REFERENCE:${row.path}`);
for (const row of binding.tools) assert.equal(hash(fs.readFileSync(row.path)), row.sha256, `PRE_RUN_TOOL:${row.path}`);
assert.equal(process.execPath, binding.tools[0].path); assert.equal(process.version, 'v22.22.2');
await import('./run.mjs');
