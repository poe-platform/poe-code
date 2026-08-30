import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allScenarios, observeCase } from './resume-fixtures.ts';

const base = 'e7f4f2e3753184415f8098445c2009cb4cd9a6e9';
const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const entries = execFileSync('git', ['ls-tree', '-r', base, '--', 'src'], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [metadata, path] = line.split('\t');
  return { path, blob: metadata.split(' ')[2] };
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshot = async () => Object.fromEntries(await Promise.all(entries.map(async ({ path, blob }) => {
  const bytes = await readFile(`${sourceRoot}${path}`);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), blob, `Committed baseline mismatch: ${path}`);
  return [path, hash(bytes)];
})));
const before = await snapshot();
const report = { base, sourceRoot, observedRepositoryHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), before, importedRuntime: import.meta.resolve('../../../src/shell/runtime.js'), importedEnv: import.meta.resolve('../../../src/commands/execution.js'), fixtureHash: hash(await readFile(new URL('./resume-cases.json', import.meta.url))), rows: [] };
assert.match(report.importedRuntime, /runtime\.ts$/u);
assert.match(report.importedEnv, /execution\.ts$/u);
for (const scenario of allScenarios) report.rows.push(await observeCase(scenario.name));
report.after = await snapshot();
assert.deepEqual(report.after, before);
assert.ok(process.argv[2]?.startsWith('/tmp/'));
await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ rows: report.rows.length, sourceInputs: entries.length, stableCommittedSource: true }));
