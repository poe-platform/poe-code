import { lstat, readFile, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('./', import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const signatureCommit = 'fe5d87a215310cbe847bee99bbe3c7650aa3f6e3';
await writeFile(root + 'SEAL-STARTUP.json', JSON.stringify({ at: new Date().toISOString(), maxChildren: 1, metadataOnly: true }) + '\n', { flag: 'wx', mode: 0o600 });
const stdout = await open(root + 'git-tree.stdout.raw', 'wx', 0o600);
const stderr = await open(root + 'git-tree.stderr.raw', 'wx', 0o600);
try {
  const child = spawn('/usr/bin/git', ['ls-tree', '-r', '-z', signatureCommit, '--', 'tests/compatibility/bash-reference-preparation-20260829/verification-v2'], { cwd: repository, env: { PATH: '/usr/bin:/bin', HOME: root, LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  let total = 0;
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  const consume = async (stream, handle, retain) => { for await (const bytes of stream) { total += bytes.length; assert(total <= 1048576); await handle.write(bytes); if (retain) chunks.push(Buffer.from(bytes)); } };
  const streams = Promise.all([consume(child.stdout, stdout, true), consume(child.stderr, stderr, false)]);
  const status = await new Promise((fulfill, reject) => { child.once('error', reject); child.once('close', (code, signal) => fulfill({ code, signal })); });
  clearTimeout(timer); await streams;
  assert.deepEqual(status, { code: 0, signal: null });
  const records = Buffer.concat(chunks).toString('utf8').split('\0');
  assert.equal(records.pop(), '');
  const inputs = [];
  const gitRows = [];
  for (const record of records) {
    const [metadata, pathname] = record.split('\t');
    const [mode, type, oid] = metadata.split(' ');
    assert(type === 'blob' && (mode === '100644' || mode === '100755'));
    assert(pathname.startsWith('tests/compatibility/bash-reference-preparation-20260829/verification-v2/'));
    const full = repository + '/' + pathname;
    const stat = await lstat(full);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 * 1024);
    const bytes = await readFile(full);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), oid, 'GIT_BLOB_BINDING');
    inputs.push({ path: full, bytes: stat.size, mode: (stat.mode & 0o777).toString(8), sha256: createHash('sha256').update(bytes).digest('hex') });
    gitRows.push({ path: pathname, mode, oid });
  }
  for (const filename of ['PRESEAL.md', 'TOOLS.json', 'PATCH-PATHS.json', 'prepare-source.mjs', 'seal.mjs']) {
    const pathname = root + filename;
    const stat = await lstat(pathname);
    const bytes = await readFile(pathname);
    inputs.push({ path: pathname, bytes: stat.size, mode: (stat.mode & 0o777).toString(8), sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(root + 'EXECUTION-SEAL.json', JSON.stringify({ signatureCommit, gitRows, inputs, captureStatus: status, sourceOnly: true }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'SOURCE_EXECUTION_PRESEALED', signatureCommit, gitRows: gitRows.length, inputs: inputs.length, childrenClosed: 1 }));
} catch (error) { await writeFile(root + 'SEAL-FAILURE.json', JSON.stringify({ message: error.message }) + '\n', { flag: 'wx', mode: 0o600 }); process.exitCode = 1; }
finally { await stdout.close(); await stderr.close(); }
