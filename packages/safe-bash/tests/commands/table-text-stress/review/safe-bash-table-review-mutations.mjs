import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { work, sha, save, manifest, drift } from './safe-bash-table-review-tools.mjs';

const cwd = `${work}/audit`;
const source = `${cwd}/src/commands/table-text/internal.ts`;
const pristine = readFileSync(source, 'utf8');
const before = manifest(cwd);
function run(name, args) {
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', ...args], {cwd, encoding:'utf8', timeout:60000, maxBuffer:16*1024*1024});
  save(`${work}/${name}-verified.tap`, result.stdout + result.stderr);
  return {name, args, exitCode:result.status, signal:result.signal, error:result.error?.message ?? null, logSha256:sha(result.stdout + result.stderr), pass:Number(result.stdout.match(/# pass (\d+)/)?.[1] ?? 0), fail:Number(result.stdout.match(/# fail (\d+)/)?.[1] ?? 0), assertions:[...result.stdout.matchAll(/not ok \d+ - ([^\n]+)/g)].map(match => match[1]), semanticAssertion: result.stdout.includes('ERR_ASSERTION')};
}
const targets = ['tests/commands/table-text-stress/corpus.test.ts', 'tests/commands/table-text/contracts.test.ts'];
const baseline = run('mutation-baseline', targets);
assert.equal(baseline.exitCode, 0);
const mutations = [
  {name:'shared-cursor', from:'    if (name === "-" && this.stdin) return this.stdin;', to:'    if (false && name === "-" && this.stdin) return this.stdin;', pattern:'independent frozen GNU: paste shared alternating empty EOF'},
  {name:'byte-fidelity', from:'        this.chunk = Uint8Array.from(result.value);', to:'        this.chunk = new TextEncoder().encode(new TextDecoder().decode(result.value));', pattern:'independent frozen GNU: paste NUL shared invalid bytes'},
  {name:'byte-order', from:'    if (first !== second) return first - second;', to:'    if (first !== second) return second - first;', pattern:'independent frozen GNU: comm C byte collation'},
  {name:'borrowed-buffer', from:'        this.chunk = Uint8Array.from(result.value);', to:'        this.chunk = result.value.slice();', pattern:'records retain Buffer fragments after producer reuse'}
];
const results = [];
for (const mutation of mutations) {
  assert.ok(pristine.includes(mutation.from));
  save(source, pristine.replace(mutation.from, mutation.to));
  try {
    const result = run(`mutation-${mutation.name}`, ['--test-name-pattern', mutation.pattern, ...targets]);
    result.mutation = mutation;
    result.mutatedSourceSha256 = sha(readFileSync(source));
    result.killed = result.exitCode === 1 && result.signal === null && result.error === null && result.fail > 0 && result.semanticAssertion;
    results.push(result);
  } finally { save(source, pristine); }
}
const restored = run('mutation-restored', targets);
const after = manifest(cwd);
save(`${work}/mutation-results-verified.json`, {baseline, results, restored, pristineSourceSha256:sha(pristine), afterSourceSha256:sha(readFileSync(source)), inputDrift:drift(before,after)});
console.log(JSON.stringify({baseline, results, restored, inputDrift:drift(before,after)}, null, 2));
assert.equal(restored.exitCode, 0);
assert.ok(results.every(result => result.killed));
