import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { census, configurationPaths, copyRegularTools, digest, fixturePath, helperPath, probePath } from './binding.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
export const historicalRuntime = '4c16d9c5a0e8661bc326a754205559a3e7ea6a32';
export const historicalHarness = '85e6d56017bafebf9aa8849cd9e038229e49c863';
const controlsPath = 'tests/shell-stress/invocation-cleanup-runtime/migration/controls.mjs';
export const historicalPins = {
  'src/shell/cleanup.ts': '134f55641d6437681cd185960a2923d68086096921758717c5b8059595304385',
  'src/shell/runtime.ts': '2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b',
  'src/shell/shell.ts': '0e1d1396490970bf8db4d74ab07115d73e8303d29d7b748e145a06b13b316fee',
  'src/commands/grep.ts': 'a5e93d8dd97c35f1a1530792b38478942647e6e66ac01fcd44fbea05fbfa78d1',
  'src/commands/search/rg.ts': 'fee9a380679e17da179a1c6b4f9bacf9c89a10e0dd1d18981c26b9296f9846d3',
  'src/commands/regex-execution/client.ts': '1638d492d11d466875b98451a59bace4e60e71fcd5468d671182187549922bca',
};

export function git(args, origin = repository) {
  const result = spawnSync('git', ['--no-replace-objects', ...args], { cwd: origin, timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

export async function committedInputs(revision, origin = repository) {
  assert.match(revision, /^[a-f0-9]{40}$/u, 'Explicit full committed SHA required; HEAD and abbreviations are not provenance');
  assert.equal(git(['rev-parse', '--verify', `${revision}^{commit}`], origin).toString().trim(), revision);
  const tree = git(['rev-parse', `${revision}^{tree}`], origin).toString().trim();
  const entries = git(['ls-tree', '-rz', revision], origin).toString().split('\0').filter(Boolean).map(record => {
    const delimiter = record.indexOf('\t');
    const [mode, type, object] = record.slice(0, delimiter).split(' ');
    return { mode, type, object, path: record.slice(delimiter + 1) };
  });
  const configs = await configurationPaths(async path => git(['show', `${revision}:${path}`], origin).toString());
  const selected = new Set([...entries.filter(entry => entry.path.startsWith('src/')).map(entry => entry.path), 'package.json', 'package-lock.json', ...configs, fixturePath, probePath, helperPath]);
  const files = {};
  for (const path of [...selected].sort((left, right) => left.localeCompare(right))) {
    const entry = entries.find(entry => entry.path === path);
    assert.ok(entry && entry.type === 'blob' && ['100644', '100755'].includes(entry.mode), `Missing/nonregular committed input: ${path}`);
    files[path] = digest(git(['cat-file', 'blob', entry.object], origin));
  }
  return { format: 'public-cleanup-committed-v1', revision, tree, files };
}

export async function replay({ mode, revision, output, origin = repository }) {
  assert.ok(mode === 'current' || mode === 'historical');
  await mkdir(output);
  output = await realpath(output);
  const writeJson = (name, value) => writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  const scratch = await mkdtemp(join(output, '.work-'));
  const source = join(scratch, 'source');
  await mkdir(source);
  try {
    const runtime = mode === 'historical' ? historicalRuntime : revision;
    const expected = mode === 'current' ? await committedInputs(runtime, origin) : null;
    const paths = expected ? [...Object.keys(expected.files), controlsPath] : ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
    const archive = git(['archive', runtime, '--', ...paths], origin);
    const extracted = spawnSync('tar', ['-x', '-C', source], { input: archive, timeout: 15000, maxBuffer: 1024 * 1024 });
    assert.equal(extracted.status, 0, extracted.stderr?.toString());
    if (mode === 'historical') {
      for (const path of [fixturePath, probePath]) {
        await mkdir(dirname(join(source, path)), { recursive: true });
        await writeFile(join(source, path), git(['show', `${historicalHarness}:${path}`], origin), { flag: 'wx' });
      }
      for (const [path, pin] of Object.entries(historicalPins)) assert.equal(digest(await readFile(join(source, path))), pin, path);
    } else {
      assert.equal(digest(await readFile(fileURLToPath(import.meta.url))), digest(git(['show', `${runtime}:tests/shell-stress/invocation-cleanup-runtime/migration/replay.mjs`], origin)), 'Qualified runner must itself match the explicit candidate');
      assert.equal(digest(await readFile(join(here, 'binding.ts'))), expected.files[helperPath]);
      await writeJson('expected-inputs.json', expected);
    }
    const before = await census(source);
    await writeJson('source-before.json', before);
    await copyRegularTools(join(origin, 'node_modules'), join(source, 'node_modules'));
    await writeJson('tools.json', await census(join(source, 'node_modules')));
    const nested = join(scratch, 'nested');
    await mkdir(nested);
    const environment = { ...process.env, TSX_DISABLE_CACHE: '1', TMPDIR: nested, TMP: nested, TEMP: nested, FORCE_COLOR: '0', NO_COLOR: '1' };
    delete environment.VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED;
    delete environment.VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT;
    delete environment.NODE_TEST_CONTEXT;
    if (expected) {
      environment.VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED = join(output, 'expected-inputs.json');
      environment.VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT = expected.revision;
    } else {
      environment.GIT_DIR = git(['rev-parse', '--absolute-git-dir'], origin).toString().trim();
      environment.GIT_OPTIONAL_LOCKS = '0';
    }
    const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', fixturePath], { cwd: source, env: environment, encoding: 'utf8', timeout: 150000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
    await writeFile(join(output, 'runtime.stdout.log'), run.stdout ?? '', { flag: 'wx' });
    await writeFile(join(output, 'runtime.stderr.log'), run.stderr ?? '', { flag: 'wx' });
    const counts = Object.fromEntries([...(run.stdout ?? '').matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
    const result = { mode, revision: runtime, historicalHarness: mode === 'historical' ? historicalHarness : null, node: process.version, platform: process.platform, arch: process.arch, archiveSha256: digest(archive), sourceInputSha256: digest(JSON.stringify(before)), status: run.status, signal: run.signal, error: run.error?.message ?? null, counts, runnerSha256: digest(await readFile(fileURLToPath(import.meta.url))), expectedManifestSha256: expected ? digest(JSON.stringify(expected)) : null };
    await writeJson('result.json', result);
    let controls;
    if (expected && run.status === 0 && counts.tests === 10 && counts.pass === 10) {
      const controlRun = spawnSync(process.execPath, ['--import', 'tsx', '--test', controlsPath], { cwd: source, env: environment, encoding: 'utf8', timeout: 150000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
      await writeFile(join(output, 'controls.stdout.log'), controlRun.stdout ?? '', { flag: 'wx' });
      await writeFile(join(output, 'controls.stderr.log'), controlRun.stderr ?? '', { flag: 'wx' });
      const controlCounts = Object.fromEntries([...(controlRun.stdout ?? '').matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
      controls = { status: controlRun.status, signal: controlRun.signal, error: controlRun.error?.message ?? null, counts: controlCounts, sourceHash: before[controlsPath], committedSource: runtime };
      await writeJson('controls.json', controls);
    }
    for (const [path, pin] of Object.entries(before)) assert.equal(digest(await readFile(join(source, path))), pin, `Original replay input changed: ${path}`);
    await writeJson('source-after.json', Object.fromEntries(await Promise.all(Object.keys(before).map(async path => [path, digest(await readFile(join(source, path)))]))));
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(counts, { tests: 10, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
    if (expected) {
      assert.ok(controls);
      assert.equal(controls.error, null);
      assert.equal(controls.signal, null);
      assert.equal(controls.status, 0);
      assert.deepEqual(controls.counts, { tests: 15, pass: 15, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
    }
    return result;
  } catch (error) {
    await writeJson('FAILURE.json', { message: error.message, stack: error.stack });
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await writeJson('CLEANUP.json', { scratch, removed: true, time: new Date().toISOString(), retained: 'Only bounded evidence; all outer and nested snapshot/tool directories removed.' });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, first, second] = process.argv.slice(2);
  assert.ok((mode === 'current' && first && second) || (mode === 'historical' && first && !second), 'current FULL_COMMIT NEW_OUTPUT_DIRECTORY | historical NEW_OUTPUT_DIRECTORY');
  const result = await replay({ mode, revision: mode === 'current' ? first : historicalRuntime, output: resolve(mode === 'current' ? second : first) });
  console.log(JSON.stringify(result));
}
