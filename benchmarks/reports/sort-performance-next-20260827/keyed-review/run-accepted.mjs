import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { acceptedIndependentCommit } from './holdouts.mjs';
import { authenticate, childRun, consumerCopy, directory, git, hash, inventory, json } from './harness.mjs';
export async function runAccepted(prepared, label) {
  const root = consumerCopy(prepared, label);
  const evidence = join(directory, label); mkdirSync(evidence);
  const prefix = 'benchmarks/reports/sort-performance-next-20260827/';
  const paths = {
    'accepted-worker.mjs': prefix + 'unkeyed-review/public-worker.mjs',
    'acceptance.json': prefix + 'workloads.json',
    'independent.json': prefix + 'unkeyed-review/expected-v2.json',
    'caps.json': prefix + 'unkeyed-review/caps-expected.json',
  };
  const inputs = [];
  for (const [name, path] of Object.entries(paths)) {
    const bytes = git(acceptedIndependentCommit, path);
    writeFileSync(join(root, name), bytes, { flag: 'wx' });
    inputs.push({ name, path, commit: acceptedIndependentCommit, sha256: hash(bytes) });
  }
  json(join(root, 'empty.json'), { specimens: [] });
  const packagePath = join(root, 'node_modules/virtual-bash');
  json(join(root, 'package-manifest.json'), inventory(packagePath));
  const results = [];
  for (const [cohort, acceptance, independent] of [['accepted21-revised34', 'acceptance.json', 'independent.json'], ['accepted-caps11', 'empty.json', 'caps.json']]) {
    const result = await childRun(root, ['accepted-worker.mjs', packagePath, join(root, acceptance), join(root, independent), join(root, 'package-manifest.json')], join(evidence, cohort));
    const capture = JSON.parse(readFileSync(join(evidence, cohort + '.tap.txt')));
    json(join(evidence, cohort + '.capture.json'), capture);
    const counts = {};
    for (const row of capture.rows) { counts[row.cohort] ??= { pass: 0, fail: 0 }; counts[row.cohort][row.passed ? 'pass' : 'fail']++; }
    results.push({ cohort, ...result, counts });
    assert.ok(capture.rows.every(row => row.passed));
  }
  for (const file of inputs) assert.equal(hash(readFileSync(join(root, file.name))), file.sha256);
  assert.deepEqual(inventory(packagePath), prepared.packageBefore);
  json(join(evidence, 'summary.json'), { inputs, results, ...authenticate(prepared), unchangedPriorWorkerAndInputs: true });
  return results;
}
if (process.argv[2]) console.log(JSON.stringify(await runAccepted(JSON.parse(readFileSync(process.argv[2])), process.argv[3])));
