import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const owned = 'tests/integration/adapter-tools-diagnostics';
const filename = process.argv[2] ?? 'coverage-rerun.json';
assert.match(filename, /^[a-z-]+\.json$/);
assert.equal(existsSync(`${root}${owned}/${filename}`), false, 'choose a new evidence filename');
const env = { ...process.env, DIAGNOSTIC_REVISION: '19149d3d9c5dc6f309b61f215a140df18adaf6e4',
  DIAGNOSTIC_MATRIX_REVISION: 'df5bc453de004a8eb483696cf4ae1986a012cca1', DIAGNOSTIC_MUTATION: 'append-untyped' };
const runs = [];
for (const [label, path, pattern] of [
  ['revised-matrix', 'tests/integration/adapter-tools/matrix.test.ts', "^readonly: rejects mutation: printf 'changed' >> target\\.txt$"],
  ['independent-acceptance', `${owned}/eight-cases.test.ts`, '^readonly:append:EROFS$'],
]) {
  const argv = ['--unhandled-rejections=strict', '--import', 'tsx', '--import', `./${owned}/register.mjs`,
    '--test', '--test-reporter=tap', '--test-name-pattern', pattern, path];
  const result = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  runs.push({ label, argv, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
  console.log(label, 'exit', result.status);
}
assert.equal(runs[0].exitCode, 0, 'counterexample must pass the unchanged revised matrix row');
assert.equal(runs[1].exitCode, 1, 'independent acceptance must reject the boundary regression');
assert.match(runs[0].stdout, /# tests 1\n/);
assert.match(runs[1].stdout, /# tests 1\n/);
assert.match(runs[1].stdout, /FsError identity/);
const evidence = { recordedAt: new Date().toISOString(), verdict: 'NOT PASS: actual append-open typed-boundary gap',
  sourceRevision: env.DIAGNOSTIC_REVISION, matrixRevision: env.DIAGNOSTIC_MATRIX_REVISION,
  mutation: 'Only in-memory readonly writeFile with flag a throws Error carrying code EROFS and correct path, not FsError. All other operations unchanged; no filesystem effects.',
  loaderSha256: createHash('sha256').update(readFileSync(`${root}${owned}/revision-loader.mjs`)).digest('hex'),
  nativeCalls: 0, runs };
const patch = `*** Begin Patch\n*** Add File: ${owned}/${filename}\n${JSON.stringify(evidence, null, 2).split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
const saved = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(saved.status, 0, saved.stderr);
console.log(saved.stdout.trim());
process.exitCode = 1;
