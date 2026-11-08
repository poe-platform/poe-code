import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { artifact, root, snapshot } from './common.mjs';
const phase = process.argv[2] ?? 'pre';
const before = snapshot();
const testCommand = paths => [process.execPath, '--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', ...paths];
const jobs = [];
for (let repetition = 1; repetition <= 3; repetition++) jobs.push(['seven-boundaries-' + repetition, testCommand(['tests/commands/structured-stress/jq-42-independent-review/failure-boundaries.test.ts'])]);
jobs.push(['new-limits6', testCommand(['tests/commands/structured-stress/jq-grammar-review-fixes/limits.test.ts'])]);
jobs.push(['author-limits9', testCommand(['tests/commands/structured-stress/jq-grammar-author-20260827/limits.test.ts'])]);
for (const name of ['safety-1', 'author114', 'historical238', 'author-nearby117', 'broad-unchanged', 'author-new', 'scoped-types', 'author-scoped-types', 'global-types']) {
 const prior = JSON.parse(readFileSync(new URL('../jq-grammar-source-review/' + name + '.json', import.meta.url)));
 jobs.push([name, prior.command]);
}
const results = [];
for (const [name, command] of jobs) {
 const label = phase + '-' + name;
 const result = spawnSync(process.execPath, ['tests/commands/structured-stress/jq-grammar-final-review/record.mjs', label, ...command], {cwd: root, timeout: 250000, maxBuffer: 1024 * 1024});
 const record = JSON.parse(readFileSync(new URL(label + '.json', import.meta.url)));
 results.push({name, status: record.status, counts: record.counts, stableProduct: record.stableProduct});
 console.log(result.stdout.toString().trim());
 if(result.stderr.length) console.error(result.stderr.toString());
}
artifact(phase + '-gates.json', {before, after:snapshot(), results, note:'Read-only reuse of exact historical commands; outputs only in final-review. No changes to old generators, reports, fixtures or selectors.'});
