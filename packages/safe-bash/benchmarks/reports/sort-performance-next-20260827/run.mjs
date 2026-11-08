import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadavg, platform, arch } from 'node:os';

const repo = '/Users/kjopek/Workspace/safe-bash';
const report = join(repo, 'benchmarks/reports/sort-performance-next-20260827');
const output = process.argv[2] ? join(report, process.argv[2]) : report;
if (output !== report) { assert.equal(process.argv[2], 'attempt-2'); mkdirSync(output); }
const inputs = JSON.parse(readFileSync(join(report, 'inputs.json')));
const manifest = JSON.parse(readFileSync(join(report, 'instrumentation.json')));
const scratch = inputs.scratch;
assert.ok(scratch.startsWith('/tmp/sort-performance-next-independent-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (path, value) => writeFileSync(join(output, path), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const verify = () => { for (const [variant, tree] of Object.entries(manifest.trees)) for (const [path, expected] of Object.entries(tree)) assert.equal(hash(readFileSync(join(scratch, variant, path))), expected, `${variant}/${path}`); };
verify();
const initial = readFileSync(join(report, 'workloads.initial.json'));
const workloads = readFileSync(join(report, 'workloads.json'));
assert.equal(hash(initial), inputs.freezeSha256);
writeFileSync(join(scratch, 'workloads.json'), workloads);
writeFileSync(join(scratch, 'worker.mjs'), readFileSync(join(report, 'worker.mjs')), { flag: 'wx' });
put('run-freeze.json', { frozenBeforeChildren: new Date().toISOString(), initialWorkloadSha256: hash(initial), activeWorkloadSha256: hash(workloads), correction: 'Before any execution, source inspection corrected only missing-file diagnostic syscall open to readStream; original freeze preserved in workloads.initial.json. Status and effects unchanged.', tools: { node: process.version, nodeSha256: hash(readFileSync(process.execPath)), platform: platform(), arch: arch() }, harnessHashes: Object.fromEntries(['prepare.mjs', 'instrument.mjs', 'worker.mjs', 'run.mjs'].map(path => [path, hash(readFileSync(join(report, path)))])), startup: 'Fresh process/import and fresh Shell/VFS per specimen; setup is not counted; no warmups, CPU sampling or walltime recording.', scope: 'Counters alter text.ts and internal.ts only in isolated copy; all other product originals authenticated. TypeScript isolated transpilation, not build/typecheck qualification.', loadBefore: loadavg() });
const children = [];
async function run(variant) {
  const child = spawn('/bin/zsh', ['-c', 'ulimit -t 60; exec "$@"', 'sort-diagnosis', process.execPath, '--max-old-space-size=512', join(scratch, 'worker.mjs'), scratch, variant], { cwd: scratch, env: { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { variant, pid: child.pid, closed: false, forced: false, outputBytes: 0 }; children.push(entry);
  const stdout = [], stderr = [];
  const kill = () => { entry.forced = true; child.kill('SIGKILL'); };
  const timeout = setTimeout(kill, 90000);
  child.stdout.on('data', bytes => { entry.outputBytes += bytes.length; if (entry.outputBytes > 8 * 1024 * 1024) kill(); else stdout.push(bytes); });
  child.stderr.on('data', bytes => { entry.outputBytes += bytes.length; if (entry.outputBytes > 8 * 1024 * 1024) kill(); else stderr.push(bytes); });
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => { entry.closed = true; entry.code = code; entry.signal = signal; resolve(); }); }).finally(() => clearTimeout(timeout));
  writeFileSync(join(output, variant + '.stdout'), Buffer.concat(stdout), { flag: 'wx' });
  writeFileSync(join(output, variant + '.stderr'), Buffer.concat(stderr), { flag: 'wx' });
  assert.equal(entry.code, 0); assert.equal(entry.signal, null); assert.equal(entry.forced, false);
  const result = JSON.parse(Buffer.concat(stdout));
  assert.equal(result.completed, true);
  put(variant + '.json', result);
  return result;
}
let successful = false;
try {
  const control = await run('control');
  assert.ok(control.rows.every(row => row.equivalent), 'Control must satisfy frozen exact bytes/status/effects before instrumented run');
  const instrumented = await run('instrumented');
  assert.ok(instrumented.rows.every(row => row.equivalent));
  assert.deepEqual(instrumented.rows.map(({ id, observationHash }) => ({ id, observationHash })), control.rows.map(({ id, observationHash }) => ({ id, observationHash })));
  verify();
  assert.equal(hash(readFileSync(join(scratch, 'workloads.json'))), hash(workloads));
  assert.equal(hash(readFileSync(join(scratch, 'worker.mjs'))), hash(readFileSync(join(report, 'worker.mjs'))));
  successful = true;
} finally {
  assert.ok(children.every(child => child.closed));
  verify();
  rmSync(scratch, { recursive: true });
  rmSync('/tmp/sort-performance-next-independent-state.txt');
  put('cleanup.json', { completedAt: new Date().toISOString(), successful, children, beforeAfterTreesMatch: true, scratchRemoved: !existsSync(scratch), remainingOwnedChildren: children.filter(child => !child.closed), loadAfter: loadavg(), observedFinalHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim() });
}
console.log(JSON.stringify({ successful, controlledChildren: children.length, allClosed: children.every(child => child.closed) }));
