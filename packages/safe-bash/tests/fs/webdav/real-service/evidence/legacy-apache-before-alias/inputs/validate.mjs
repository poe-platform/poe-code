import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const evidence = join(own, 'evidence', process.argv[2] ?? 'source-fix-validation');
await mkdir(evidence);
const workspace = await mkdtemp(join(own, '.work-validation-'));
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: workspace, TMPDIR: workspace };
const sourcePaths = ['src/fs/webdav/webdav.ts', 'src/fs/webdav/README.md', 'tests/fs/webdav/real-service/timestamp-postcondition.test.ts'];
const records = [];
try {
  const hashes = {};
  for (const path of sourcePaths) hashes[path] = createHash('sha256').update(await readFile(join(repo, path))).digest('hex');
  await writeFile(`${evidence}/source-hashes.json`, JSON.stringify(hashes, null, 2), { flag: 'wx' });
  const tests = (await readdir(join(repo, 'tests/fs/webdav'))).filter(name => name.endsWith('.test.ts')).map(name => `tests/fs/webdav/${name}`);
  const regression = 'tests/fs/webdav/real-service/timestamp-postcondition.test.ts';
  const compiler = join(repo, 'node_modules/typescript/bin/tsc');
  for (const args of [
    ['--unhandled-rejections=strict', '--import', 'tsx', '--test', regression],
    ['--unhandled-rejections=strict', '--import', 'tsx', '--test', ...tests],
    [compiler, '--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', ...tests, regression],
    [compiler, '-p', 'tsconfig.build.json', '--outDir', `${workspace}/dist`],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: repo, env, timeout: 120000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    records.push({ args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
    console.log(args.slice(0, 4).join(' '), result.status);
    if (result.status !== 0) process.exitCode = 1;
  }
} finally {
  await writeFile(`${evidence}/commands.json`, JSON.stringify(records, null, 2), { flag: 'wx' });
  await rm(workspace, { recursive: true, force: true });
}
