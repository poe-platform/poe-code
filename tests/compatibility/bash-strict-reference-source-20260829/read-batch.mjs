import { mkdir, open, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('./', import.meta.url));
const stage = process.argv[2]; assert(['binding', 'product'].includes(stage));
await mkdir(root + stage, { mode: 0o700 });
await writeFile(root + stage + '/STARTUP.json', JSON.stringify({ at: new Date().toISOString(), sourceOnly: true }) + '\n', { flag: 'wx', mode: 0o600 });
const common = ['tests/compatibility/bash-strict-mode-design-20260829/CASES.json', 'tests/compatibility/bash-strict-mode-design-20260829/BINDING.json'];
const jobs = stage === 'binding' ? [
  ['accepted', ['show', 'be284b6f799e7501c793daff4d7bffc36ce4090b:tests/compatibility/bash-strict-mode-independent-20260829/ROOT-ACCEPTANCE.md']],
  ...common.map((path, index) => ['design-' + index, ['show', '90c109913cf2a1ec5b39ba0c4eb0518caca01147:' + path]]),
  ['paths', ['ls-tree', '-r', '-z', 'be284b6f799e7501c793daff4d7bffc36ce4090b', '--', 'tests/compatibility/bash-strict-mode-author-20260829', 'tests/compatibility/bash-strict-mode-independent-20260829']],
  ['gnu-inventory', ['show', 'efcd8b49a63ceb4276ae9d075da59bfb027b3510:tests/compatibility/bash-reference-preparation-20260829/source-preparation-v1/RUN-01/FINAL-SOURCE-INVENTORY.json']]
] : JSON.parse(await readFile(root + 'product-jobs.json', 'utf8'));
assert(jobs.length <= 8);
const records = [];
try {
  for (const [name, argv] of jobs) {
    const folder = root + stage + '/';
    const handles = [await open(folder + name + '.stdout.raw', 'wx', 0o600), await open(folder + name + '.stderr.raw', 'wx', 0o600)];
    const child = spawn('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...argv], { cwd: '/Users/kjopek/Workspace/safe-bash', env: { PATH: '/usr/bin:/bin', HOME: root + 'home', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const pieces = [[], []]; const lengths = [0, 0]; let failure = null;
    const timer = setTimeout(() => { failure = 'METADATA_TIMEOUT'; child.kill('SIGKILL'); }, 10000);
    const read = async (stream, index) => { for await (const bytes of stream) { lengths[index] += bytes.length; if (lengths[index] > 4 * 1024 * 1024) { failure = 'CAPTURE_CAP'; child.kill('SIGKILL'); continue; } await handles[index].write(bytes); pieces[index].push(Buffer.from(bytes)); } };
    const streams = Promise.all([read(child.stdout, 0), read(child.stderr, 1)]);
    const status = await new Promise((fulfill, reject) => { child.once('error', error => { failure = error.message; }); child.once('close', (code, signal) => fulfill({ code, signal })); streams.catch(reject); });
    clearTimeout(timer); await streams; await Promise.all(handles.map(handle => handle.close()));
    const bytes = Buffer.concat(pieces[0]);
    records.push({ name, argv, status, lengths, sha256: createHash('sha256').update(bytes).digest('hex'), closed: true, failure });
    assert(!failure && status.code === 0 && status.signal === null);
    if (name === 'paths') console.log(JSON.stringify({ name, paths: bytes.toString('utf8').split('\0').filter(line => /(?:HANDOFF|BINDING|SUMMARY|REPORT|ROOT|manifest|SEAL|COVERAGE|OPEN)/.test(line)) }));
    else if (name === 'accepted') console.log(bytes.toString('utf8'));
    else if (name === 'design-0') { const data = JSON.parse(bytes); console.log(JSON.stringify({ name, keys: Object.keys(data), cases: data.cases ?? data })); }
    else console.log(JSON.stringify({ name, bytes: bytes.length }));
  }
} catch (error) { process.exitCode = 1; await writeFile(root + stage + '/FAILURE.json', JSON.stringify({ message: error.message }) + '\n', { flag: 'wx', mode: 0o600 }); }
finally { await writeFile(root + stage + '/RESULT.json', JSON.stringify({ records, childrenClosed: records.length }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
