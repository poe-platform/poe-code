import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workloads } from '../sort-performance-20260827/workloads.mjs';

const root = (await readFile(process.env.SORT_STATE, 'utf8')).trim(), directory = join(root, 'tmp/independent-native');
await mkdir(directory);
const fixtures = [];
try {
  for (const specimen of workloads) {
    for (const [name, bytes] of Object.entries(specimen.files)) await writeFile(join(directory, name), Buffer.from(bytes, 'base64'));
    const native = spawnSync(join(root, 'native/sort'), specimen.args, { cwd: directory, env: { LC_ALL: 'C', TZ: 'UTC' }, input: Buffer.from(specimen.stdin, 'base64'), timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(native.error); assert.equal(native.signal, null); assert.equal(native.status, 0);
    let stdout = native.stdout;
    if (specimen.nativeUniq) {
      const unique = spawnSync(join(root, 'native/uniq'), [], { cwd: directory, env: { LC_ALL: 'C' }, input: stdout, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
      assert.ifError(unique.error); assert.equal(unique.signal, null); assert.equal(unique.status, 0); stdout = unique.stdout;
    }
    const files = {};
    for (const name of Object.keys(specimen.files)) { files[name] = (await readFile(join(directory, name))).toString('base64'); await rm(join(directory, name)); }
    if (specimen.nativeReadOutput) stdout = Buffer.from(files.input, 'base64');
    fixtures.push({ ...specimen, expected: { stdout: stdout.toString('base64'), stderr: native.stderr.toString('base64'), status: native.status, files } });
  }
  const original = JSON.parse(await readFile(new URL('../sort-performance-20260827/evidence/workloads-native.json', import.meta.url)));
  assert.deepEqual(fixtures, original);
  const text = JSON.stringify(fixtures, null, 2) + '\n';
  await writeFile(join(root, 'workloads.json'), text, { flag: 'wx' }); await writeFile(join(process.env.SORT_REPORT, 'workloads-native.json'), text, { flag: 'wx' });
  console.log('Ten independent native captures exactly match original recipes and effects');
} finally { await rm(directory, { recursive: true, force: true }); }
