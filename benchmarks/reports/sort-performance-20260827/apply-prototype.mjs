import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const own = dirname(import.meta.filename), root = (await readFile(process.env.SORT_STATE ?? join(own, 'scratch-path.txt'), 'utf8')).trim();
assert.match(root, /^\/tmp\/safe-bash-sort-performance-[A-Za-z0-9]+$/);
const proposal = JSON.parse(await readFile(join(own, 'prototypes/proposal.json'), 'utf8'));
const target = join(root, 'candidate/src/commands/text.ts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(target)), proposal.beforeSha256, 'refuse different candidate preimage');
const patch = await readFile(join(own, 'prototypes/candidate.patch'), 'utf8');
assert.equal(hash(patch), proposal.patchSha256);
const hunks = patch.slice(patch.indexOf('@@')).trimEnd().split('\n').map(line => line.startsWith('@@') ? '@@' : line).join('\n');
execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Update File: ${target}\n${hunks}\n*** End Patch\n` });
assert.equal(hash(await readFile(target)), proposal.candidateSha256);
console.log('Applied only to owned isolated candidate:', target);
