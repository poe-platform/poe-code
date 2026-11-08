import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

assert.deepEqual(process.argv.slice(2), ['--source-data-only']);
const repo = '/Users/kjopek/Workspace/safe-bash';
const root = await fs.mkdtemp('/tmp/bash-surface-source-v2-');
const started = Date.now(), hash = bytes => createHash('sha256').update(bytes).digest('hex');
await fs.writeFile(path.join(root, 'START.json'), JSON.stringify({ role: 'SOURCE_DATA_ONLY_FRESH_GRANT', started: new Date(started).toISOString(), noInstructionCapture: true, product: 0, nativeBash: 0, compiler: 0, private: 0 }) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ outerCapture: root }));
let captured = 0;
const write = async (name, bytes) => { assert.ok(!name.split('/').includes('AGENTS.md')); captured += Buffer.byteLength(bytes); assert.ok(captured <= 134217728); await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), bytes, { flag: 'wx' }); };
const readText = async (name, cap = 4194304) => { assert.ok(/\.(json|md|mjs|data|txt)$/.test(name) && path.basename(name) !== 'AGENTS.md'); const stat = await fs.lstat(name); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap); const bytes = await fs.readFile(name); assert.equal(bytes.length, stat.size); return bytes; };
const commands = [];
const git = async (label, args, input) => {
  const result = spawnSync('/usr/bin/git', args, { cwd: repo, env: { PATH: '/usr/bin', GIT_OPTIONAL_LOCKS: '0' }, input, timeout: 10000, maxBuffer: 16777216 });
  await write(label + '.stdout', result.stdout ?? Buffer.alloc(0)); await write(label + '.stderr', result.stderr ?? Buffer.alloc(0));
  commands.push({ label, executable: '/usr/bin/git', args, status: result.status, signal: result.signal, error: result.error?.message, stdoutSha256: hash(result.stdout ?? Buffer.alloc(0)) });
  assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined); return result.stdout;
};
try {
  const sourceBytes = await readText(path.join(repo, 'tests/integration/git-public-20260829/SOURCE.json'));
  assert.equal(hash(sourceBytes), '14a2a6a50d7748b677c4cc1261d6f69a411c1c21926c7acd884c86f2077e9450');
  const source = JSON.parse(sourceBytes); assert.equal(source.computedTree, 'c83f352f057c64917f219eb938f54aa42cdab829'); assert.equal(source.inputs.length, 292);
  const packagePath = path.join(repo, 'tests/integration/git-public-20260829/results-v1/PACKAGE.tgz.base64');
  const packageStat = await fs.lstat(packagePath); assert.ok(packageStat.isFile() && !packageStat.isSymbolicLink() && packageStat.size < 2097152);
  const archive = Buffer.from((await fs.readFile(packagePath, 'utf8')).trim(), 'base64'); assert.equal(hash(archive), '4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156'); assert.equal(archive.length, 864000);
  const selected = source.inputs.filter(row => row.path.startsWith('src/shell/') || ['src/contracts/command.ts', 'src/contracts/io.ts', 'src/commands/core.ts', 'src/commands/execution.ts', 'src/commands/internal.ts', 'src/commands/index.ts', 'src/plugins/index.ts'].includes(row.path));
  assert.ok(selected.length > 10 && selected.length < 40);
  const blobs = await git('selected-source-blobs', ['cat-file', '--batch'], selected.map(row => row.blob).join('\n') + '\n'); let cursor = 0;
  for (const row of selected) {
    assert.ok(/^src\/[A-Za-z0-9_./-]+\.ts$/.test(row.path));
    const newline = blobs.indexOf(10, cursor); assert.equal(blobs.subarray(cursor, newline).toString(), `${row.blob} blob ${row.bytes}`); cursor = newline + 1;
    const bytes = blobs.subarray(cursor, cursor + row.bytes); cursor += row.bytes; assert.equal(blobs[cursor++], 10); assert.equal(hash(bytes), row.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), row.blob);
    await write('selected/' + row.path + '.data', bytes);
  }
  assert.equal(cursor, blobs.length);
  await git('tracked-status-nul', ['status', '--porcelain=v1', '-z', '--untracked-files=no']);
  const declarationPaths = await git('declaration-ratification-paths-nul', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '7719f39e416a401588c83d355888f6b82202c109']);
  const binaries = [];
  for (const name of ['/bin/bash', '/opt/homebrew/bin/bash']) {
    try {
      const link = await fs.lstat(name), resolved = await fs.realpath(name), stat = await fs.lstat(resolved); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size < 67108864);
      const digest = createHash('sha256'); let bytes = 0; for await (const chunk of createReadStream(resolved, { highWaterMark: 65536 })) { bytes += chunk.length; assert.ok(bytes <= stat.size); digest.update(chunk); }
      assert.equal(bytes, stat.size); const after = await fs.lstat(resolved); assert.equal(after.size, stat.size); assert.equal(after.mtimeMs, stat.mtimeMs); assert.equal(after.ino, stat.ino);
      binaries.push({ requested: name, symlink: link.isSymbolicLink(), linkTarget: link.isSymbolicLink() ? await fs.readlink(name) : null, resolved, bytes, mode: stat.mode & 0o777, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, sha256: digest.digest('hex'), versionExecuted: false, versionClaim: 'NONE: metadata/path is not an executed Bash version probe' });
    } catch (error) { if (error.code !== 'ENOENT') throw error; binaries.push({ requested: name, status: 'ABSENT' }); }
  }
  await write('ADMISSION.json', JSON.stringify({ role: 'SOURCE_DATA_ONLY_NOT_RUNTIME_ACCEPTANCE', candidate: source.computedTree, sourceManifestSha256: hash(sourceBytes), packageSha256: hash(archive), packageBytes: archive.length, packageMembers: '950 bound by prior full-package evidence; not re-extracted here', selected, declarationPaths: declarationPaths.toString().split('\0').filter(Boolean), binaries, commands, capturedBytes: captured, elapsedMs: Date.now() - started, productExecutions: 0, nativeExecutions: 0, privateExecutions: 0 }, null, 2) + '\n');
  console.log(JSON.stringify({ root, selected: selected.length, capturedBytes: captured, binaries }));
} catch (error) { await write('FAILURE.json', JSON.stringify({ error: String(error?.stack ?? error), commands, capturedBytes: captured, elapsedMs: Date.now() - started }) + '\n'); throw error; }
