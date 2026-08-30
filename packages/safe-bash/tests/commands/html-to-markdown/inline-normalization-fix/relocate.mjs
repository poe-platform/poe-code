import assert from 'node:assert/strict';
import { existsSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, read, save, toolInventory } from '../../html-to-markdown-independent-20260827/fix-review-3ef5811f/common.mjs';

const own = dirname(fileURLToPath(import.meta.url)), repo = resolve(own, '../../../..');
const from = join(own, 'node_modules'), to = join(repo, 'src/commands/html-to-markdown/node_modules/inline-normalization-early');
assert(!existsSync(to));
const before = statSync(from);
renameSync(from, to);
assert.equal(statSync(to).ino, before.ino);
const baseline = read(join(to, 'baseline-04/RESULT.json'));
const observations = [];
for (const label of ['baseline-01', 'baseline-02', 'baseline-03', 'baseline-04']) {
  assert.deepEqual(inventory(join(to, label, 'candidate')), baseline.sourceBefore);
  observations.push({ label, originalPath: join(from, label), retainedPath: join(to, label), allRegularCandidateBytesAndMembershipVerified: true });
}
assert.deepEqual(toolInventory(join(to, 'baseline-04/tools')), baseline.toolsBefore);
assert.deepEqual(inventory(join(to, 'baseline-04/moved/node_modules/virtual-bash')), baseline.movedBefore);
save(join(own, 'RELOCATION.json'), { at: new Date().toISOString(), reason: 'Keep captured TypeScript/native data outside canonical tests/**/*.test.ts discovery without changing any shared discovery configuration. No source aliases are introduced.', from, to, sameDirectoryInode: true, observations, originalReceiptPathsRemainHistorical: true });
console.log(JSON.stringify({ from, to, observations: observations.length }));
