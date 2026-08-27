import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const own = dirname(import.meta.filename), repo = resolve(own, '../../..');
const [commit, destination] = process.argv.slice(2); assert.match(commit ?? '', /^[a-f0-9]{40}$/u); assert.ok(destination);
const output = resolve(destination); mkdirSync(output);
const work = realpathSync(mkdtempSync(join(tmpdir(), 'safe-bash-release-regressions-')));
const report = { commit, steps: [], startedAt: new Date().toISOString(), status: 'failed' };
const sha = value => createHash('sha256').update(value).digest('hex');
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: work, TMPDIR: work, TSX_DISABLE_CACHE: '1', LC_ALL: 'C' };
function run(name, command, args, cwd = work) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 4000000 });
  const record = { name, command, args, cwd, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  report.steps.push(record); writeFileSync(join(output, `${name}.json`), JSON.stringify(record, null, 2));
  assert.equal(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`); assert.equal(result.error, undefined); assert.equal(result.signal, null); return result;
}
try {
  const paths = ['package.json', 'tsconfig.json', 'tests/integration/qualified-current-release-repair/coverage.test.ts', 'tests/plugins/qualified-current-release/runtime-coverage.mjs', 'tests/plugins/qualified-current-release/consumers.mjs', 'tests/plugins/qualified-current-release/inventory-check.mjs', 'tests/plugins/stream-five-public/current-profile.mjs'];
  run('archive', 'git', ['archive', '--format=tar', `--output=${join(work, 'source.tar')}`, commit, ...paths], repo);
  run('extract', '/usr/bin/tar', ['-xf', join(work, 'source.tar'), '-C', work]);
  report.files = paths.map(path => ({ path, sha256: sha(readFileSync(join(work, path))) }));
  cpSync(join(repo, 'node_modules'), join(work, 'node_modules'), { recursive: true, dereference: true });
  report.tools = ['typescript/lib/_tsc.js', 'tsx/package.json'].map(path => ({ path, sha256: sha(readFileSync(join(work, 'node_modules', path))) }));
  const fixture = paths[2];
  run('strict-types', process.execPath, [join(work, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--lib', 'ES2023', '--types', 'node', fixture]);
  const tested = run('canonical-regressions', process.execPath, ['--import', 'tsx', '--test', fixture]);
  report.counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, Number(tested.stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1])]));
  assert.deepEqual(report.counts, { tests: 24, pass: 24, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  run('canonical-discovery', process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict';import{globSync}from'node:fs';const files=globSync('tests/**/*.test.ts',{exclude:path=>path==='tests/commands/regex-execution/continuation/artifacts/native'});assert.ok(files.includes(${JSON.stringify(fixture)}));console.log(JSON.stringify({fixture:${JSON.stringify(fixture)},discovered:true,scope:'exact npm glob on selected frozen copy, not whole-suite execution'}));`]);
  for (const entry of report.files) assert.equal(sha(readFileSync(join(work, entry.path))), entry.sha256);
  report.status = 'passed-frozen-canonical-regressions';
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally { rmSync(work, { recursive: true, force: true }); report.cleaned = true; report.finishedAt = new Date().toISOString(); writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, counts: report.counts, error: report.error })); }
