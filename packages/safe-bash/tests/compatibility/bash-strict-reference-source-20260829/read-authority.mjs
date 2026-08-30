import { mkdir, open, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('./', import.meta.url));
await writeFile(root + 'AUTHORITY-STARTUP.json', JSON.stringify({ at: new Date().toISOString(), role: 'FROZEN_GIT_SOURCE_METADATA', maxChildren: 3 }) + '\n', { flag: 'wx', mode: 0o600 });
await mkdir(root + 'home', { mode: 0o700 });
const jobs = [
  ['design', ['show', '90c109913cf2a1ec5b39ba0c4eb0518caca01147:tests/compatibility/bash-strict-mode-design-20260829/README.md']],
  ['accepted-paths', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'be284b6f799e7501c793daff4d7bffc36ce4090b']],
  ['author-paths', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '928be558']]
];
const records = [];
try {
  for (const [name, argv] of jobs) {
    const stdout = await open(root + name + '.stdout.raw', 'wx', 0o600);
    const stderr = await open(root + name + '.stderr.raw', 'wx', 0o600);
    const child = spawn('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...argv], { cwd: '/Users/kjopek/Workspace/safe-bash', env: { PATH: '/usr/bin:/bin', HOME: root + 'home', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const pieces = [[], []]; const lengths = [0, 0]; let failure = null;
    const timer = setTimeout(() => { failure = 'METADATA_TIMEOUT'; child.kill('SIGKILL'); }, 10000);
    const read = async (stream, handle, index) => { for await (const bytes of stream) { lengths[index] += bytes.length; if (lengths[index] > 4 * 1024 * 1024) { failure = 'CAPTURE_CAP'; child.kill('SIGKILL'); continue; } await handle.write(bytes); pieces[index].push(Buffer.from(bytes)); } };
    const streams = Promise.all([read(child.stdout, stdout, 0), read(child.stderr, stderr, 1)]);
    const status = await new Promise((fulfill, reject) => { child.once('error', error => { failure = error.message; }); child.once('close', (code, signal) => fulfill({ code, signal })); streams.catch(reject); });
    clearTimeout(timer); await streams; await stdout.close(); await stderr.close();
    records.push({ name, argv, status, lengths, closed: true, failure });
    assert(!failure && status.code === 0 && status.signal === null);
    const bytes = Buffer.concat(pieces[0]);
    console.log(JSON.stringify({ name, text: name === 'design' ? bytes.toString('utf8') : bytes.toString('utf8').split('\0').filter(Boolean) }));
  }
} catch (error) { process.exitCode = 1; await writeFile(root + 'AUTHORITY-FAILURE.json', JSON.stringify({ message: error.message }) + '\n', { flag: 'wx', mode: 0o600 }); }
finally { await writeFile(root + 'AUTHORITY-RESULT.json', JSON.stringify({ records, childrenClosed: records.length }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
