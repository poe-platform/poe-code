import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const label = process.argv[2];
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('unique owned label required');
const baseline = process.argv.find(argument => argument.startsWith('--source='))?.slice(9) ?? '76d1dd721f8b6efc9417b847e14d674cf9cbae0f';
if (!/^[0-9a-f]{40}$/.test(baseline)) throw new Error('full frozen source hash required');
const evidence = join(own, 'evidence', label);
await mkdir(evidence);
const workspace = await mkdtemp(join(own, '.work-phase2-validation-'));
const snapshot = join(workspace, 'snapshot');
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: workspace, TMPDIR: workspace };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
function execute(command, args, cwd = repo, binary = false) {
  const result = spawnSync(command, args, { cwd, env, timeout: 120000, ...(binary ? {} : { encoding: 'utf8' }), maxBuffer: 32 * 1024 * 1024 });
  if (!binary) records.push({ command, args, cwd, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.stdout}`);
  return result.stdout;
}
try {
  const tests = execute('git', ['ls-tree', '-r', '--name-only', baseline, '--', 'tests/fs/webdav']).trim().split('\n').filter(path => /^tests\/fs\/webdav\/[^/]+\.(ts|json)$/.test(path));
  const guards = ['tests/fs/mount/copy-identity-guards.test.ts', 'tests/fs/overlay/copy-identity.test.ts'];
  const helpers = ['tests/fs/overlay/helpers.ts'];
  const archive = execute('git', ['archive', baseline, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json', ...tests, ...guards, ...helpers], repo, true);
  await mkdir(snapshot);
  await writeFile(join(workspace, 'archive.tar'), archive);
  execute('tar', ['xf', join(workspace, 'archive.tar'), '-C', snapshot]);
  const overlays = ['src/fs/webdav/webdav.ts', 'src/fs/webdav/README.md'];
  if (!process.argv.includes('--committed-only')) for (const path of overlays) await copyFile(join(repo, path), join(snapshot, path));
  const ownedTests = ['legacy-lock.test.ts', 'timestamp-postcondition.test.ts'];
  if (process.argv.includes('--aliases')) ownedTests.push('direct-comparison.test.ts');
  const target = join(snapshot, 'tests/fs/webdav/real-service');
  await mkdir(join(target, 'evidence/apache-final'), { recursive: true });
  for (const name of ownedTests) await copyFile(join(own, name), join(target, name));
  await copyFile(join(own, 'evidence/apache-final/raw.json'), join(target, 'evidence/apache-final/raw.json'));
  const inputs = {};
  async function inventory(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await inventory(join(path, entry.name), `${relative}/`);
      else inputs[relative] = hash(await readFile(join(path, entry.name)));
    }
  }
  await inventory(snapshot);
  const historicalGuards = {};
  for (const path of [...guards, ...helpers]) {
    assert.equal(inputs[path], hash(await readFile(join(repo, path))), `unchanged current fixture ${path}`);
    historicalGuards[path] = hash(execute('git', ['show', `eab1d48a90456c1c2cdeb9289b32f1ed62429137:${path}`], repo, true));
    assert.equal(inputs[path], historicalGuards[path], `unchanged historical required49 fixture ${path}`);
  }
  await writeFile(join(evidence, 'inputs.json'), JSON.stringify({ baseline, archivedSha256: hash(archive), overlays: process.argv.includes('--committed-only') ? [] : overlays, inputs, historicalGuards }, null, 2), { flag: 'wx' });
  const testArgs = ['--unhandled-rejections=strict', '--import', 'tsx', '--test'];
  for (const name of ownedTests) execute(process.execPath, [...testArgs, `tests/fs/webdav/real-service/${name}`], snapshot);
  execute(process.execPath, [...testArgs, ...tests.filter(path => path.endsWith('.test.ts'))], snapshot);
  execute(process.execPath, [...testArgs, 'tests/fs/webdav/constructor-comparison.test.ts'], snapshot);
  execute(process.execPath, [...testArgs, ...guards], snapshot);
  const compiler = join(repo, 'node_modules/typescript/bin/tsc');
  execute(process.execPath, [compiler, '--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', ...tests.filter(path => path.endsWith('.ts')), ...guards, ...ownedTests.map(name => `tests/fs/webdav/real-service/${name}`)], snapshot);
  execute(process.execPath, [compiler, '-p', 'tsconfig.build.json'], snapshot);
  console.log(records.filter(record => record.args.includes('--test')).map(record => record.stdout.match(/# tests.*\n# suites.*\n# pass.*\n# fail.*/)?.[0]).join('\n'));
} finally {
  await writeFile(join(evidence, 'commands.json'), JSON.stringify(records, null, 2), { flag: 'wx' });
  await rm(workspace, { recursive: true, force: true });
  await writeFile(join(evidence, 'cleanup.json'), JSON.stringify({ workspace, removed: true, at: new Date().toISOString() }, null, 2), { flag: 'wx' });
}
