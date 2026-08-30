import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url)), original = resolve(own, '..'), repo = resolve(original, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(join(own, 'MANIFEST.json'));
assert.equal(hash(bytes), process.argv[2], 'EXPLICIT_CONTINUATION_SEAL');
for (const row of JSON.parse(bytes).files) assert.equal(hash(fs.readFileSync(join(own, row.path))), row.sha256, `CONTINUATION_PRE_RUN:${row.path}`);
assert.equal(hash(fs.readFileSync(join(original, 'EVIDENCE-MANIFEST.json'))), '5198c32b5c9793396c8db534419413168d6929d52baceaffea3fd5d7bc86da40');
for (const row of JSON.parse(fs.readFileSync(join(original, 'EVIDENCE-MANIFEST.json'))).files) assert.equal(hash(fs.readFileSync(join(original, row.path))), row.sha256, `ORIGINAL_PRE_RUN:${row.path}`);
const binding = JSON.parse(fs.readFileSync(join(original, 'BINDINGS.json')));
for (const row of binding.references) assert.equal(hash(fs.readFileSync(join(repo, row.path))), row.sha256, `REFERENCE_PRE_RUN:${row.path}`);
for (const row of binding.tools) assert.equal(hash(fs.readFileSync(row.path)), row.sha256, `TOOL_PRE_RUN:${row.path}`);
assert.equal(process.execPath, binding.tools[0].path); assert.equal(process.version, 'v22.22.2');
await import('./run.mjs');
