import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const { freeze } = JSON.parse(await readFile(join(output, 'location.json')));
const source = join(freeze, 'product'), phase = process.argv[2];
assert.ok(['controls', 'original', 'scratch-aligned'].includes(phase));
const directory = join(output, phase);
await mkdir(directory, { recursive: false });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(output, 'frozen-files.json')));
async function integrity() {
  const mismatches = [], names = [];
  async function visit(root, prefix = '') {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(root, entry.name), path);
      else { names.push(path); if (!entry.isFile() || digest(await readFile(join(source, path))) !== manifest[path]?.sha256) mismatches.push(path); }
    }
  }
  await visit(source);
  for (const name of Object.keys(manifest)) if (!names.includes(name)) mismatches.push(name);
  return { count: names.length, mismatches, expectedTreeSha256: digest(JSON.stringify(manifest)), at: new Date().toISOString() };
}
const before = await integrity();
assert.deepEqual(before.mismatches, []);
await writeFile(join(directory, 'integrity-before.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });
const imports = join(directory, 'imports.jsonl');
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(freeze, 'home'), TMPDIR: join(freeze, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
  NODE_OPTIONS: `--import=${join(source, 'audit/preload.mjs')}`, TSX_DISABLE_CACHE: '1', REPLAY_FREEZE: freeze, REPLAY_IMPORT_LOG: imports };
const args = ['--unhandled-rejections=strict', '--import', 'tsx', join(source, 'audit/phase.mjs'), phase];
const child = spawn(process.execPath, args, { cwd: source, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
const stdout = createWriteStream(join(directory, 'stdout.log'), { flags: 'wx' }), stderr = createWriteStream(join(directory, 'stderr.log'), { flags: 'wx' });
child.stdout.pipe(stdout); child.stderr.pipe(stderr);
child.stdout.on('data', chunk => process.stdout.write(chunk)); child.stderr.on('data', chunk => process.stderr.write(chunk));
const startedAt = new Date().toISOString(), processSamples = [], known = new Set([child.pid]);
function processes() {
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return match ? { pid: +match[1], ppid: +match[2], pgid: +match[3], command: match[4] } : null;
  }).filter(Boolean);
}
function owned() {
  const rows = processes();
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (row.pgid === child.pid || known.has(row.ppid)) { if (!known.has(row.pid)) { known.add(row.pid); changed = true; } } }
  return rows.filter(row => known.has(row.pid) || row.pgid === child.pid || row.command.includes(join(source, 'profiles')) || row.command.includes(join(source, 'node_modules/esbuild')));
}
const sampler = setInterval(() => processSamples.push({ at: new Date().toISOString(), processes: owned() }), 100);
const deadlineMs = phase === 'controls' ? 90000 : 180000;
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, deadlineMs);
const result = await new Promise(resolve => { child.once('error', error => resolve({ error: String(error) })); child.once('exit', (code, signal) => resolve({ code, signal })); });
clearTimeout(timer); clearInterval(sampler);
await new Promise(resolve => setTimeout(resolve, 1000));
const events = (await readFile(imports, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
for (const event of events) { if (event.event === 'process-start') known.add(event.pid); if (event.event === 'child-start' && event.childPid) known.add(event.childPid); }
const leaked = owned();
if (leaked.length) {
  await writeFile('/tmp/safe-bash-comparison-replay-checkpoint.txt', JSON.stringify({ phase, lifecycle: 'FAIL', leaked, at: new Date().toISOString() }, null, 2) + '\n');
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  for (const row of leaked) try { process.kill(row.pid, 'SIGKILL'); } catch {}
}
await new Promise(resolve => setTimeout(resolve, 200));
const remaining = owned();
const after = await integrity();
const imported = events.filter(row => row.event === 'module-load');
const outside = imported.filter(row => !row.actual.startsWith(source + '/'));
const wrongBytes = imported.filter(row => manifest[row.actual.slice(source.length + 1)]?.sha256 !== row.sourceSha256);
const workers = events.filter(row => row.event === 'process-start' && row.argv.some(arg => arg.endsWith('/engine.mjs'))).map(row => ({ pid: row.pid, argv: row.argv, modules: [...new Set(imported.filter(module => module.pid === row.pid).map(module => module.actual))],
  loadedProductEntry: imported.some(module => module.pid === row.pid && module.actual === join(source, 'src/index.ts')),
  loadedBaselineEntry: imported.some(module => module.pid === row.pid && module.actual === join(source, 'benchmarks/node_modules/just-bash/dist/bundle/index.js')) }));
const lifecycle = { phase, startedAt, finishedAt: new Date().toISOString(), command: [process.execPath, ...args], cwd: source, env, pgid: child.pid, deadlineMs, result, timedOut, leaked, remaining, sourceIntegrity: after,
  importAudit: { totalLoadEvents: imported.length, uniqueModules: new Set(imported.map(row => row.actual)).size, outside, wrongBytes, workers, pass: imported.length > 0 && outside.length === 0 && wrongBytes.length === 0 && workers.length >= 4 && workers.every(row => row.loadedProductEntry !== row.loadedBaselineEntry) },
  gate: !timedOut && result.code === 0 && leaked.length === 0 && remaining.length === 0 && after.mismatches.length === 0 ? 'PASS' : 'FAIL' };
if (!lifecycle.importAudit.pass) lifecycle.gate = 'FAIL';
await writeFile(join(directory, 'lifecycle.json'), JSON.stringify(lifecycle, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(directory, 'process-samples.json'), JSON.stringify(processSamples, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(directory, 'integrity-after.json'), JSON.stringify(after, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ phase, lifecycleGate: lifecycle.gate, result, leaked, remaining, importAudit: { pass: lifecycle.importAudit.pass, workers: workers.length, modules: lifecycle.importAudit.uniqueModules }, sourceChanged: after.mismatches }, null, 2));
if (lifecycle.gate !== 'PASS') process.exitCode = 1;
