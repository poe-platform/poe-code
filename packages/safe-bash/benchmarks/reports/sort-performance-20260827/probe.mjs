import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cpus, loadavg, release } from 'node:os';
import { workloads } from './workloads.mjs';
import { session } from './session.mjs';

const own = dirname(import.meta.filename), root = (await readFile(process.env.SORT_STATE ?? join(own, 'scratch-path.txt'), 'utf8')).trim();
const evidence = process.env.SORT_REPORT ?? join(own, 'evidence');
await cp(join(own, 'worker.mjs'), join(root, 'harness/worker.mjs'));
const directory = join(root, 'tmp/oracle'); await mkdir(directory);
const fixtures = [];
for (const specimen of workloads) {
  for (const [name, content] of Object.entries(specimen.files)) await writeFile(join(directory, name), Buffer.from(content, 'base64'));
  const expected = spawnSync(join(root, 'native/sort'), specimen.args, { cwd: directory, env: { LC_ALL: 'C', TZ: 'UTC' }, input: Buffer.from(specimen.stdin, 'base64'), timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(expected.error); assert.equal(expected.signal, null); assert.equal(expected.status, 0);
  let stdout = expected.stdout;
  if (specimen.nativeUniq) {
    const unique = spawnSync(join(root, 'native/uniq'), [], { cwd: directory, env: { LC_ALL: 'C' }, input: stdout, timeout: 5000 });
    assert.equal(unique.status, 0); stdout = unique.stdout;
  }
  const files = {};
  for (const name of Object.keys(specimen.files)) { files[name] = (await readFile(join(directory, name))).toString('base64'); await rm(join(directory, name)); }
  if (specimen.nativeReadOutput) stdout = Buffer.from(files.input, 'base64');
  fixtures.push({ ...specimen, expected: { stdout: stdout.toString('base64'), stderr: expected.stderr.toString('base64'), status: expected.status, files } });
}
await writeFile(join(root, 'workloads.json'), JSON.stringify(fixtures, null, 2) + '\n', { flag: 'wx' });
await cp(join(root, 'workloads.json'), join(evidence, 'workloads-native.json'));
const build = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: join(root, 'base'), encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
await writeFile(join(evidence, 'base-build.json'), JSON.stringify(build, null, 2) + '\n'); assert.equal(build.status, 0, build.stdout + build.stderr);
const events = [], report = { node: process.version, release: release(), cpu: cpus()[0], events, loadBefore: loadavg(), controls: [], profiles: [] };
try {
  for (const variant of ['base', 'baseline']) {
    const worker = await session(root, variant, events);
    try {
      for (const specimen of fixtures) {
        const response = await worker.request({ workload: specimen.id, repetitions: 3 });
        assert.ok(!response.error, response.error); report.controls.push({ variant, workload: specimen.id, ...response });
        console.log(variant, specimen.id, response.samples.map(row => [row.equivalent, +row.milliseconds.toFixed(3)]));
      }
      if (variant === 'base') for (const workload of ['plain-5000', 'historical-sort-uniq-5000', 'numeric-stable-8000']) {
        const profile = join(root, 'evidence', `${workload}.cpuprofile`);
        const response = await worker.request({ workload, repetitions: workload.startsWith('numeric') ? 30 : 200, profile });
        assert.ok(!response.error, response.error); report.profiles.push({ workload, samples: response.samples });
        await cp(profile, join(evidence, `${workload}.cpuprofile`));
      }
    } finally { await worker.close(); }
  }
} finally { report.loadAfter = loadavg(); await writeFile(join(evidence, 'probe.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
