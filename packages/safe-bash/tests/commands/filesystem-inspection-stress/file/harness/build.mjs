import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, lstat, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const candidate = join(root, 'candidate');
const args = ['node_modules/typescript/bin/tsc', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', '--declaration', '--sourceMap', '--noEmitOnError', '--rootDir', 'src', '--outDir', 'dist', 'src/commands/file/index.ts', 'src/shell/index.ts'];
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, args, { cwd: candidate, timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', HOME: root } });
await writeFile(join(root, 'build.stdout.txt'), result.stdout ?? '');
await writeFile(join(root, 'build.stderr.txt'), result.stderr ?? '');
const files = [];
async function visit(path = 'dist') {
  for (const name of (await readdir(join(candidate, path))).sort()) {
    const relativePath = `${path}/${name}`;
    const metadata = await lstat(join(candidate, relativePath));
    if (metadata.isDirectory()) await visit(relativePath);
    else {
      const bytes = await readFile(join(candidate, relativePath));
      files.push({ path: relativePath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      await chmod(join(candidate, relativePath), 0o400);
    }
  }
}
if (result.status === 0) await visit();
const evidence = { startedAt, finishedAt: new Date().toISOString(), executable: process.execPath, nodeVersion: process.version, args, cwd: candidate, status: result.status, signal: result.signal, error: result.error?.message ?? null, files };
await writeFile(join(root, 'build.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ status: result.status, signal: result.signal, emittedFiles: files.length }));
process.exitCode = result.status ?? 1;
