import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceSnapshot } from '../jq-42-independent-review/common.mjs';
import { artifact, directory } from './artifacts.mjs';

const owned = 'tests/commands/structured-stress/jq-42-independent-final';
const before = sourceSnapshot();
const jobs = [
  ['r2-immutable-start-command', 'node', `${owned}/immutable.mjs`, 'r2-immutable-start.json'],
  ['r2-main-command', 'node', '--import', 'tsx', `${owned}/replay.mjs`, 'main', 'r2-main.json'],
  ['r2-legacy-command', 'node', '--import', 'tsx', `${owned}/replay.mjs`, 'legacy', 'r2-legacy.json'],
];
for (const name of ['boundaries-1', 'boundaries-2', 'boundaries-3', 'author114', 'historical238', 'author-nearby117',
  'author-evidence2', 'review-evidence4', 'author-safety-1', 'author-safety-2', 'author-safety-3', 'scoped-types', 'global-types']) {
  const prior = JSON.parse(readFileSync(join(directory, `r1-${name}.json`)));
  jobs.push([`r2-${name}`, ...prior.command]);
}
jobs.push(['r2-build-smoke-command', 'node', `${owned}/build-smoke.mjs`, 'r2-build-smoke.json']);
const selected = JSON.parse(readFileSync(join(directory, 'r1-legacy-red.json')));
jobs.push(['r2-legacy-red', ...selected.command]);
jobs.push(['r2-immutable-end-command', 'node', `${owned}/immutable.mjs`, 'r2-immutable-end.json']);
const results = [];
for (const job of jobs) {
  const result = spawnSync(process.execPath, [`${owned}/command.mjs`, ...job], { encoding: 'utf8', timeout: 130000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  console.log(result.stdout.trim());
  const recorded = JSON.parse(readFileSync(join(directory, `${job[0]}.json`)));
  results.push({ name: job[0], wrapperStatus: result.status, status: recorded.status, signal: recorded.signal,
    stable: recorded.stable, productBefore: recorded.before.productSha256, productAfter: recorded.after.productSha256,
    structuredBefore: recorded.before.structuredSha256, structuredAfter: recorded.after.structuredSha256,
    toolingBefore: recorded.before.tooling, toolingAfter: recorded.after.tooling, summary: recorded.summary });
}
const after = sourceSnapshot();
const stable = before.productSha256 === after.productSha256 && results.every(row => row.stable &&
  row.productBefore === before.productSha256 && row.productAfter === before.productSha256 &&
  JSON.stringify(row.toolingBefore) === JSON.stringify(before.tooling) && JSON.stringify(row.toolingAfter) === JSON.stringify(before.tooling));
artifact('r2-checkpoint.json', { before, after, stable, results,
  validity: stable ? 'All measured phase boundaries share one product/tooling hash; not clean HEAD or protection against transient ABA edits.' : 'INVALID as one stable whole-product checkpoint; retained without green rebaselining. No third rerun.' });
console.log(JSON.stringify({ stable, productSha256: after.productSha256, phases: results.length }));
process.exitCode = stable ? 0 : 2;
