import assert from 'node:assert/strict';
import { execFileSync, fork, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const owned = resolve('tests/stress/regex-execution/cleanup-boundary-review');
const [label, format = 'compiled'] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]*$/u.test(label ?? '') || !['compiled', 'packed'].includes(format)) throw new Error('immutable label and compiled/packed required');
const snapshot = resolve(owned, '.temporary', label);
const source = JSON.parse(await readFile(resolve(owned, 'evidence', `${label}-freeze.json`)));
const build = JSON.parse(await readFile(resolve(owned, 'evidence', `${label}-build.json`)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(build.status, 0);
for (const entry of [...source.identities, ...build.emitted]) assert.equal(hash(await readFile(resolve(snapshot, entry.path))), entry.sha256, entry.path);
const fixtureRoot = resolve(owned, '.temporary', `${label}-${format}-old-five`);
const fixture = resolve(fixtureRoot, 'production-continuation-review');
const prior = 'tests/stress/regex-execution/production-continuation-review';
const historical = path => execFileSync('git', ['show', `839f2d4:tests/stress/regex-execution/${path}`], { maxBuffer: 8 * 1024 * 1024 });
for (const path of ['production-continuation-review/cohort.mjs', 'production-continuation-review/walker-cases.mjs', 'production-review/cohort.mjs', 'production-review/evidence/production-final/cohort.json', 'production-continuation-review/evidence/native-walker.json', 'production-continuation-review/evidence/baseline/walker.json']) {
  const target = resolve(fixtureRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, historical(path), { flag: 'wx' });
}
await mkdir(resolve(fixture, 'snapshots'), { recursive: true });
await symlink(snapshot, resolve(fixture, 'snapshots/candidate'));
const original = historical('production-continuation-review/child.mjs').toString();
const selected = ['early-downstream-zero-active', 'rg-early-downstream-zero-active', 'caller-abort-active-benign-request', 'caller-abort-glob-no-continued-filesystem-work'];
const generated = original.replace("const owned = resolve('tests/stress/regex-execution/production-continuation-review');", `const owned = ${JSON.stringify(fixture)};`).replace('async function caseCheck(name, callback) {', `async function caseCheck(name, callback) {\n  if (job !== 'cohort' && !${JSON.stringify(selected)}.includes(name)) return;`);
assert.notEqual(generated, original);
assert.equal(generated.split('if (job !==').length, 2);
await writeFile(resolve(fixture, 'child.mjs'), generated, { flag: 'wx' });
const packageEvidence = { format, commands: [], assets: [] };
if (format === 'packed') {
  const packageRoot = resolve(fixture, 'node_modules/virtual-bash');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(resolve(fixture, 'package.json'), JSON.stringify({ name: 'independent-cleanup-consumer', private: true, type: 'module' }) + '\n', { flag: 'wx' });
  const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    packageEvidence.commands.push({ command, args, cwd, status: result.status, stdout: result.stdout, stderr: result.stderr });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const metadata = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', fixture], snapshot))[0];
  const archive = resolve(fixture, metadata.filename);
  run('/usr/bin/tar', ['-xzf', archive, '-C', packageRoot, '--strip-components=1'], fixture);
  packageEvidence.archiveSha256 = hash(await readFile(archive));
  packageEvidence.name = metadata.name;
  packageEvidence.version = metadata.version;
  assert.equal(metadata.name, 'virtual-bash');
  const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json')));
  assert.deepEqual(manifest.dependencies ?? {}, {});
  for (const entry of build.emitted) {
    assert.equal(hash(await readFile(resolve(packageRoot, entry.path))), entry.sha256, entry.path);
    assert.ok(metadata.files.some(file => file.path === entry.path), entry.path);
  }
  packageEvidence.assets = build.emitted;
  await writeFile(resolve(fixture, 'consumer.mts'), 'import { Shell, MemoryFileSystem, agentCommands, type CommandContext, type InvocationCleanup } from "virtual-bash";\nconst cleanup: InvocationCleanup = async () => {};\ndeclare const context: CommandContext;\ncontext.registerCleanup?.(cleanup);\nconst shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());\nawait shell.exec("rg hit");\nawait shell.dispose();\n', { flag: 'wx' });
  run(resolve('node_modules/.bin/tsc'), ['--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--lib', 'ES2023', '--strict', '--skipLibCheck', resolve(fixture, 'consumer.mts')], fixture);
}
const runs = [];
for (const job of ['cohort', 'lifecycle', 'public', 'walker']) {
  runs.push(await new Promise(resolveResult => {
    const child = fork(resolve(fixture, 'child.mjs'), [format === 'packed' ? 'packed' : 'candidate', job], { execArgv: ['--unhandled-rejections=strict', '--max-old-space-size=128', '--stack-size=1024'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
    const state = { job, pid: child.pid, events: [], stdout: '', stderr: '', result: null, killed: false };
    let bytes = 0;
    const kill = reason => { if (!state.killed) { state.killed = true; state.killReason = reason; child.kill('SIGKILL'); } };
    const timer = setTimeout(() => kill('exact child hard watchdog'), 20000);
    child.on('message', message => {
      if (JSON.stringify(message).length > 1024 * 1024) return kill('IPC cap');
      if (message.kind === 'ready') child.send({ kind: 'run' });
      else if (message.kind === 'result') state.result = message;
      else kill('unexpected IPC');
    });
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) kill('output cap'); else state[key] += chunk; });
      stream.on('close', () => state.events.push(`${key}-close`));
    }
    child.on('error', error => { state.spawnError = String(error); });
    child.on('disconnect', () => state.events.push('disconnect'));
    child.on('exit', (code, signal) => state.events.push({ exit: code, signal }));
    child.on('close', (code, signal) => { clearTimeout(timer); resolveResult({ ...state, code, signal }); });
  }));
}
const all = runs.flatMap(run => run.result?.observations ?? []);
const boundaries = all.filter(observation => observation.name === 'pipe-early' || selected.includes(observation.name));
const premature = boundaries.filter(observation => !observation.pass || observation.publicSettlement?.active || observation.details?.activeAtExec);
const record = { label, format, sourceCommit: source.commit, time: new Date().toISOString(), originalChildSha256: hash(original), generatedChildSha256: hash(generated), transformations: ['owned data-directory literal only', 'caseCheck scheduler selects original four callbacks; full original24 cohort unchanged'], historicalAssertionsPath: `${prior}/child.mjs`, packageEvidence, runs, summary: { originalTriples: all.filter(observation => !selected.includes(observation.name)).length, originalTriplePasses: all.filter(observation => !selected.includes(observation.name) && observation.pass).length, boundaries: boundaries.length, premature: premature.map(observation => observation.name), exactWorkers: runs.flatMap(run => run.result?.final ?? []).length, allWorkersEventuallyRetired: runs.every(run => run.result?.final?.every(worker => worker.exited && worker.terminationCalls <= 1 && Object.values(worker.listeners).every(count => count === 0))), childrenClosed: runs.every(run => run.code === 0 && !run.killed && run.events.includes('disconnect') && run.events.includes('stdout-close') && run.events.includes('stderr-close')) }, riskConsumed: 0, defaultAcceptance: false };
await writeFile(resolve(owned, 'evidence', `${label}-${format}-old-five.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(record.summary));
if (boundaries.length !== 5 || premature.length || !record.summary.childrenClosed || !record.summary.allWorkersEventuallyRetired) process.exitCode = 1;
