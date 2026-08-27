import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const label = process.argv[2], source = process.argv[3];
assert.match(label ?? '', /^[a-z0-9-]+$/); assert.match(source ?? '', /^[0-9a-f]{40}$/);
const evidence = join(own, 'evidence', label);
await mkdir(evidence);
const workspace = await mkdtemp(join(own, '.work-scope-'));
const snapshot = join(workspace, 'snapshot');
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: workspace, TMPDIR: workspace, TSX_DISABLE_CACHE: '1' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const commands = [];
function execute(command, args, cwd = repo) {
  const result = spawnSync(command, args, { cwd, env, timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  commands.push({ command, args, cwd, status: result.status, signal: result.signal, stderr: String(result.stderr), error: result.error?.message });
  return result;
}
try {
  await mkdir(snapshot);
  const archive = execute('git', ['archive', source, 'src', 'package.json', 'tsconfig.json', 'tsconfig.build.json']);
  assert.equal(archive.status, 0);
  await writeFile(join(workspace, 'source.tar'), archive.stdout);
  assert.equal(execute('tar', ['xf', join(workspace, 'source.tar'), '-C', snapshot]).status, 0);
  if (process.argv.includes('--candidate')) await copyFile(join(repo, 'src/fs/webdav/webdav.ts'), join(snapshot, 'src/fs/webdav/webdav.ts'));
  const target = join(snapshot, 'tests/fs/webdav/real-service');
  await mkdir(join(target, 'evidence/apache-final'), { recursive: true });
  await copyFile(join(own, 'lock-scope.test.ts'), join(target, 'lock-scope.test.ts'));
  await copyFile(join(own, 'lock-scope.test.ts'), join(evidence, 'input.test.ts.txt'));
  await copyFile(join(own, 'evidence/apache-final/raw.json'), join(target, 'evidence/apache-final/raw.json'));
  await writeFile(join(evidence, 'inputs.json'), JSON.stringify({ source, candidateOverlay: process.argv.includes('--candidate'), archiveSha256: hash(archive.stdout),
    sourceSha256: hash(await readFile(join(snapshot, 'src/fs/webdav/webdav.ts'))), testSha256: hash(await readFile(join(target, 'lock-scope.test.ts'))),
    grantFixtureSha256: hash(await readFile(join(target, 'evidence/apache-final/raw.json'))) }, null, 2), { flag: 'wx' });
  const test = execute(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', 'tests/fs/webdav/real-service/lock-scope.test.ts'], snapshot);
  await writeFile(join(evidence, 'test.tap'), test.stdout, { flag: 'wx' });
  const types = execute(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', 'tests/fs/webdav/real-service/lock-scope.test.ts'], snapshot);
  await writeFile(join(evidence, 'types.log'), types.stdout, { flag: 'wx' });
  console.log(String(test.stdout).split('\n').filter(line => /^# (tests|pass|fail|skipped)/.test(line)).join('\n'));
  if (test.status !== 0 || types.status !== 0) process.exitCode = 1;
} finally {
  await writeFile(join(evidence, 'commands.json'), JSON.stringify(commands, null, 2), { flag: 'wx' });
  await rm(workspace, { recursive: true, force: true });
  await writeFile(join(evidence, 'cleanup.json'), JSON.stringify({ workspace, removed: true }, null, 2), { flag: 'wx' });
}
