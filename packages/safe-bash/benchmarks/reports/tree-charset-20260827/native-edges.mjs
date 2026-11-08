import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const binary = '/tmp/safe-bash-tree-oracle-MlUjmM/unix-tree-2.2.1/tree';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const binarySha256 = sha256(await readFile(binary));
assert.equal(binarySha256, '34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a');
const directory = await mkdtemp(join(tmpdir(), 'safe-bash-tree-charset-native-'));
try {
  await mkdir(join(directory, 'root'));
  await writeFile(join(directory, 'root/file'), 'unchanged');
  const cases = [];
  for (const value of ['UTF-8', 'utf-8', 'UTF8', 'utf8', 'ASCII', 'US-ASCII', 'ascii', '', 'bogus', 'UTF-8 ', ' UTF-8']) {
    cases.push({ id: `env-${JSON.stringify(value)}`, args: [], env: { LC_ALL: 'en_US.UTF-8', TREE_CHARSET: value } });
    cases.push({ id: `option-${JSON.stringify(value)}`, args: [`--charset=${value}`], env: { LC_ALL: 'C' } });
  }
  for (const value of ['C', 'POSIX', 'C.UTF-8', 'C.utf8', 'en_US.UTF-8', 'en_US.utf8', 'en_US.UTF-8@modifier', 'not-installed.UTF-8']) {
    cases.push({ id: `locale-${value}`, args: [], env: { LC_ALL: value } });
  }
  cases.push({ id: 'explicit-over-empty', args: ['--charset=UTF-8'], env: { LC_ALL: 'C', TREE_CHARSET: '' } },
    { id: 'explicit-over-unknown', args: ['--charset=UTF-8'], env: { LC_ALL: 'C', TREE_CHARSET: 'unknown' } },
    { id: 'last-ascii', args: ['--charset=UTF-8', '--charset=ASCII'], env: { LC_ALL: 'en_US.UTF-8' } },
    { id: 'last-utf8', args: ['--charset=ASCII', '--charset=UTF-8'], env: { LC_ALL: 'C' } });
  const rows = cases.map(specimen => {
    const result = spawnSync(binary, ['-n', ...specimen.args, 'root'], { cwd: directory, env: { HOME: directory, TZ: 'UTC', ...specimen.env }, timeout: 2000, maxBuffer: 65536 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return { ...specimen, exitCode: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  });
  assert.equal(await readFile(join(directory, 'root/file'), 'utf8'), 'unchanged');
  assert.equal(sha256(await readFile(binary)), binarySha256);
  process.stdout.write(JSON.stringify({ binary, binarySha256, rows }, null, 2) + '\n');
} finally { await rm(directory, { recursive: true, force: true }); }
