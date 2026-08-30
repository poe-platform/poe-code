import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessRepository } from '../preflight-repair/preflight.mjs';

const here = fileURLToPath(new URL('./', import.meta.url));
const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false);
const profile = JSON.parse(readFileSync(join(here, 'policy.json')));
const cleanup = JSON.parse(readFileSync(join(here, 'cleanup-expected.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const controls = [], children = [];
const environment = { ...process.env, TREE_NATIVE_BIN: '/tmp/safe-bash-tree-external-oracle-TbVJVK/tree' };
const admitted = assessRepository({ repository, candidate: profile.candidate, profile, environment });
assert.deepEqual(admitted.issues, []); assert.equal(admitted.native.assets.length, 49);
controls.push('exact candidate and native49 admitted');
const missing = { ...environment }; delete missing.TREE_NATIVE_BIN;
assert.ok(assessRepository({ repository, candidate: profile.candidate, profile, environment: missing }).issues.some(entry => entry.kind === 'native-unavailable'));
controls.push('missing tree refuses admission');
assert.equal(assessRepository({ repository, candidate: 'b494675c34dc289f4ad4b10a9201e1211eb0a7d8', profile, environment }).issues[0].kind, 'unreviewed-candidate');
controls.push('other candidate refuses admission');
const { committedInputs } = await import('../' + '../' + '../shell-stress/invocation-cleanup-runtime/migration/replay.mjs');
const regenerated = await committedInputs(profile.candidate);
assert.deepEqual(cleanup, regenerated); controls.push('cleanup envelope independently regenerated');
const verifyCleanup = value => assert.deepEqual(value, regenerated);
for (const [name, change] of [
  ['old revision', value => { value.revision = '4bb4ad85d4554889cd6f59097af776f4172e34d1'; }],
  ['changed file', value => { value.files['package.json'] = '0'.repeat(64); }],
  ['missing file', value => { delete value.files['package.json']; }],
]) { const changed = structuredClone(cleanup); change(changed); assert.throws(() => verifyCleanup(changed)); controls.push('cleanup rejects ' + name); }
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'safe-bash-successor-controls-')));
try {
  const source = join(temporary, 'source'), directory = join(source, 'src/commands');
  mkdirSync(directory, { recursive: true });
  const files = { 'src/commands/execution.ts': 'export const first = 1;\n', 'src/commands/env-split.ts': 'export const second = 2;\n' };
  for (const [path, bytes] of Object.entries(files)) writeFileSync(join(source, path), bytes);
  const expected = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, hash(bytes)]));
  const expectedPath = join(temporary, 'expected.json'); writeFileSync(expectedPath, JSON.stringify(expected));
  const guard = join(temporary, 'guard.mjs'); writeFileSync(guard, readFileSync(join(here, 'import-guard.mjs')));
  const main = join(source, 'main.mjs'); writeFileSync(main, "await import('./src/commands/execution.ts');await import('./src/commands/env-split.ts');console.log('executed');\n");
  for (const mode of ['legitimate', 'old-source', 'missing-parser', 'compiled-fallback']) {
    for (const [path, bytes] of Object.entries(files)) writeFileSync(join(source, path), bytes);
    if (mode === 'old-source') writeFileSync(join(directory, 'execution.ts'), 'export const first = 0;\n');
    if (mode === 'missing-parser') rmSync(join(directory, 'env-split.ts'));
    if (mode === 'compiled-fallback') { writeFileSync(join(directory, 'execution.js'), files['src/commands/execution.ts']); writeFileSync(main, "await import('./src/commands/execution.js');console.log('executed');\n"); }
    const logs = join(temporary, mode), env = { ...environment, FULL_GATE_ROOT: temporary, FULL_GATE_SOURCE: source, FULL_GATE_EXPECTED: expectedPath, FULL_GATE_IMPORTS: logs, FULL_GATE_TOOL_ROOTS: '[]' };
    delete env.NODE_OPTIONS; delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, ['--import', guard, main], { env, cwd: source, encoding: 'utf8', timeout: 10000 });
    children.push({ mode, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr });
    assert.equal(child.error, undefined); assert.equal(child.signal, null);
    if (mode === 'legitimate') {
      assert.equal(child.status, 0);
      const records = readdirSync(logs).flatMap(name => readFileSync(join(logs, name), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
      for (const path of Object.keys(files)) assert.ok(records.some(entry => entry.stage === 'load' && entry.relative === path && entry.returnedSha256 === expected[path]));
    } else { assert.notEqual(child.status, 0); assert.doesNotMatch(child.stdout, /executed/u); }
    controls.push('load guard ' + mode);
  }
  const revision = execFileSync('git', ['rev-parse', `${profile.candidate}^{tree}`], { cwd: repository }).toString().trim();
  assert.equal(revision, cleanup.tree);
  writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), candidate: profile.candidate, controls, children, native: admitted.native, admission: { status: admitted.status, issues: admitted.issues, sourceInputs: profile.scopeInputs.length }, cleanup: { inputs: Object.keys(cleanup.files).length, sha256: hash(JSON.stringify(cleanup)) }, productRuns: 0, compilerRuns: 0, wholeGateLaunched: false }, null, 2) + '\n', { flag: 'wx' });
} finally { rmSync(temporary, { recursive: true, force: true }); assert.equal(existsSync(temporary), false); }
console.log(JSON.stringify({ candidate: profile.candidate, controls: controls.length, native: admitted.native.assets.length, wholeGateLaunched: false, output }));
