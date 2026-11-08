import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, save } from '../execution-prep-v1/artifacts.mjs';
import { verifyInputs } from '../execution-prep-v1/verify-inputs.mjs';
import { correctedRow, matrix, guardIds, historySha256, historyEncodedSha256 } from './proof.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), repository = resolve(root, '../../..');
const original = verifyInputs(repository); correctedRow();
const binding = JSON.parse(readFileSync(join(root, 'stack-binding-v1/BINDING.json')));
assert.equal(realpathSync(process.execPath), binding.node.path); assert.equal(hash(readFileSync(binding.node.path)), binding.node.sha256);
for (const tool of binding.typeTools) assert.deepEqual(inventory(tool.root), tool.inventory.files);
const npm = JSON.parse(readFileSync(join(root, 'execution-v2/NPM-TOOLS.json'))); assert.deepEqual(inventory(npm.root), npm.files);
const files = {};
for (const [name, entry] of Object.entries(inventory(root))) {
  if (name === 'continuation-v2/SEAL.json' || name.startsWith('.')) continue;
  if (name.includes('/') && !['byte-overlay-v1/', 'execution-prep-v1/', 'execution-v2/', 'stack-binding-v1/', 'continuation-v2/'].some(prefix => name.startsWith(prefix))) continue;
  assert.equal(entry.link, undefined); assert.equal(name.split('/').includes('AGENTS.md'), false);
  files[name] = entry.sha256;
}
save(join(root, 'continuation-v2/SEAL.json'), { role: 'pre-execution continuation seal, no candidate execution', date: '2026-08-28', candidate: 'd2502aae3c8458e0ac92662f2af07e7f9fc3923a', selectedTree: '37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e', packageSha256: 'b0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa', history: { revision: '2e2bfa68', historySha256, historyEncodedSha256 }, original: original.checked, correction: correctedRow(), matrix, guards: guardIds, node: binding.node, npmVersion: npm.version, files });
console.log(JSON.stringify({ sealedFiles: Object.keys(files).length, originalFiles: original.checked.length, correctedCase: 'G039-v2', procedures: 'R24-v2 per layout', mutants: matrix.length, newGuards: guardIds.length, productExecutions: 0 }));
