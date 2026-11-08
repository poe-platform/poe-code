import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parse } from 'yaml';

// actionlint 1.7.12 does not recognize concurrency.queue yet:
// https://github.com/rhysd/actionlint/pull/654
// Validate the new field before suppressing only that unsupported-key diagnostic.
export function checkWorkflowQueues(source, filename) {
  const workflow = parse(source);
  const groups = [
    ['concurrency', workflow?.concurrency],
    ...Object.entries(workflow?.jobs ?? {}).map(([name, job]) => [`jobs.${name}.concurrency`, job?.concurrency])
  ];
  for (const [location, group] of groups) {
    if (group === null || typeof group !== 'object' || !Object.hasOwn(group, 'queue')) continue;
    assert.ok(group.queue === 'single' || group.queue === 'max', `${filename}: ${location}.queue must be single or max`);
    if (group.queue === 'max') {
      assert.ok(group['cancel-in-progress'] === undefined || group['cancel-in-progress'] === false,
        `${filename}: ${location} with queue: max must omit cancel-in-progress or set it to false`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const name of readdirSync('.github/workflows').filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))) {
    const filename = `.github/workflows/${name}`;
    checkWorkflowQueues(readFileSync(filename, 'utf8'), filename);
  }
}
