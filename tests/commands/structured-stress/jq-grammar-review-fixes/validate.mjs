import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { artifact, root, snapshot } from './common.mjs';

const before = snapshot();
const testCommand = paths => [process.execPath, '--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', ...paths];
const jobs = [];
for (let repetition = 1; repetition <= 3; repetition++) jobs.push([`seven-boundaries-${repetition}`, testCommand(['tests/commands/structured-stress/jq-42-independent-review/failure-boundaries.test.ts'])]);
jobs.push(['new-limits', testCommand(['tests/commands/structured-stress/jq-grammar-review-fixes/limits.test.ts'])]);
for (const name of ['author114', 'historical238', 'author-nearby117', 'broad-unchanged', 'author-new', 'scoped-types', 'author-scoped-types', 'global-types']) {
  const prior = JSON.parse(readFileSync(new URL(`../jq-grammar-source-review/${name}.json`, import.meta.url)));
  jobs.push([name, prior.command]);
}
jobs.push(['owned-types', [process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tests/commands/structured-stress/jq-grammar-review-fixes/tsconfig.json', '--pretty', 'false']]);
const results = [];
for (const [name, command] of jobs) {
  const result = spawnSync(process.execPath, ['tests/commands/structured-stress/jq-grammar-review-fixes/record.mjs', name, ...command], { cwd: root, timeout: 250000, maxBuffer: 1024 * 1024 });
  const record = JSON.parse(readFileSync(new URL(`${name}.json`, import.meta.url)));
  results.push({ name, status: record.status, counts: record.counts, stableProduct: record.stableProduct });
  console.log(result.stdout.toString().trim());
  if (result.stderr.length) console.error(result.stderr.toString());
}
artifact('validation-summary.json', { before, after: snapshot(), results, note: 'Old exact command arrays reused without running their old evidence writers. Broad1580 and author2157 remain separate; no assertion edits or skipped known failures.' });
