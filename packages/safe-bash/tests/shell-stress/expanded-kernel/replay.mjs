import assert from 'node:assert/strict';
import { execFileSync, fork, spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, decode, encode, environment, fixedTime, fixtureRoot, hash, maximumBytes, snapshot, projectBytes } from './frozen/common.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
assert.equal(process.cwd(), root, 'Run from the intended repository root');
const corpus = JSON.parse(await readFile(join(owned, 'corpus.json'), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString().trim();
const shaFile = async path => hash(await readFile(path));
const sourceSnapshot = async () => {
  const paths = git('ls-files', '--cached', '--others', '--exclude-standard', 'src').split('\n').filter(Boolean);
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, await shaFile(join(root, path))])));
};
const authoritativePath = 'benchmarks/reports/expanded-20260827/native-corrected/native.json';
const authoritativeBytes = execFileSync('git', ['show', `${corpus.benchmarkCommit}:${authoritativePath}`], { maxBuffer: 64 * 1024 * 1024 });
assert.equal(hash(authoritativeBytes), corpus.provenance[authoritativePath].sha256);
const authoritative = JSON.parse(authoritativeBytes.toString());
for (const entry of corpus.cases) {
  assert.deepEqual(entry.specimen, authoritative.recipes.find(specimen => specimen.id === entry.specimen.id));
  assert.deepEqual(entry.expected, authoritative.observations.find(observation => observation.id === entry.specimen.id));
  assert.equal(entry.specimen.network, false);
}
for (const specimen of corpus.cases) assert.equal(hash(JSON.stringify(specimen.specimen)), specimen.expected.recipeHash);
for (const name of ['common', 'engine']) assert.equal(await shaFile(join(owned, `frozen/${name}.mjs`)), corpus.provenance[`benchmarks/expanded/${name}.mjs`].sha256);
assert.equal(corpus.cases.length, 7);
const started = new Date().toISOString();
const startHead = git('rev-parse', 'HEAD');
const before = await sourceSnapshot();
const initialStatus = git('status', '--short');
const workspace = await mkdtemp(join(owned, '.run-'));
const live = new Set();
const pids = [];
const controls = [];

async function nativeExecute(executable, args, options) {
  return await new Promise(resolveResult => {
    const child = spawn(executable, args, { ...options, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    live.add(child); pids.push(child.pid);
    const stdout = [], stderr = []; let count = 0, reason = null;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const collect = target => chunk => { count += chunk.length; if (count > maximumBytes) { reason = 'output limit'; kill(); } else target.push(chunk); };
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
    child.stdin.on('error', () => {}); child.stdin.end(Buffer.alloc(0));
    const timer = setTimeout(() => { reason = 'deadline'; kill(); }, 8000);
    child.once('error', error => { reason = error.message; });
    child.once('close', (exitCode, signal) => { clearTimeout(timer); live.delete(child); kill(); resolveResult({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode, signal, reason }); });
  });
}

async function nativeProfile(label, bash) {
  const bin = join(workspace, label, 'bin'); await mkdir(bin, { recursive: true });
  const identities = {};
  for (const [name, identity] of Object.entries(corpus.toolIdentities)) {
    const executable = name === 'bash' || name === 'sh' ? bash : identity.executable;
    const sha256 = await shaFile(executable);
    if (label === 'gnu53' || (name !== 'bash' && name !== 'sh')) assert.equal(sha256, identity.sha256, `native identity drift: ${name}`);
    await symlink(executable, join(bin, name));
    identities[name] = { executable: await realpath(executable), sha256 };
  }
  identities.absoluteEnv = { executable: '/usr/bin/env', sha256: await shaFile('/usr/bin/env') };
  const version = await nativeExecute(bash, ['--version'], { cwd: workspace, env: { PATH: bin, LC_ALL: 'C', TZ: 'UTC' }, argv0: 'bash' });
  assert.match(version.stdout.toString(), label === 'gnu53' ? /version 5\.3\./ : /version 3\.2\./);
  const env = { ...environment, PATH: bin, HOME: workspace, TMPDIR: join(workspace, 'tmp') };
  const control = await nativeExecute(bash, ['--noprofile', '--norc', '-c', 'printf "%s|%s|%s|%s|%s|%s\\n" "$0" "$1" "$LC_ALL" "$TZ" "$PATH" "$BASH_VERSION"; printf "\\000\\377"; type -t printf; type -t cat; command -v bash; /usr/bin/env bash -c \'printf "%s" "$BASH_VERSION"\'', 'benchmark', 'argument'], { cwd: workspace, env, argv0: 'bash' });
  assert.equal(control.exitCode, 0); assert.equal(control.stderr.length, 0);
  assert.ok(control.stdout.includes(Buffer.from([0, 255])));
  assert.ok(control.stdout.includes(Buffer.from('benchmark|argument|C|UTC|')));
  assert.ok(control.stdout.includes(Buffer.from('builtin\nfile\n')));
  assert.ok(control.stdout.includes(Buffer.from(`${bin}/bash\n`)));
  const versionNumber = version.stdout.toString().match(/version ([^ ]+)/)[1];
  assert.ok(control.stdout.toString().endsWith(versionNumber));
  controls.push({ label, pass: true, argv0: 'bash', stdout: encode(control.stdout), stderr: encode(control.stderr), exitCode: control.exitCode });
  return { label, bash, bin, identities, version: { ...version, stdout: encode(version.stdout), stderr: encode(version.stderr) } };
}

async function observeNative(profile, specimen) {
  assert.equal(specimen.stdin, '', 'All seven frozen inputs are explicitly empty');
  const cwd = await mkdtemp(join(workspace, `${profile.label}-case-`));
  await chmod(cwd, 0o755);
  const env = { ...environment, PATH: profile.bin, HOME: cwd, TMPDIR: join(cwd, 'tmp') };
  const replacements = [[await realpath(cwd), fixtureRoot], [cwd, fixtureRoot], [await realpath(profile.bin), '/usr/bin'], [profile.bin, '/usr/bin']];
  for (const directory of specimen.directories) await mkdir(join(cwd, directory), { recursive: true, mode: 0o755 });
  for (const [path, bytes] of Object.entries(specimen.files)) {
    const target = join(cwd, path); await mkdir(dirname(target), { recursive: true, mode: 0o755 });
    await writeFile(target, decode(bytes), { mode: specimen.fileModes[path] ?? 0o644 });
    const time = specimen.fileTimes[path] ?? fixedTime; await utimes(target, new Date(time), new Date(time));
  }
  const args = ['--noprofile', '--norc', '-c', `umask 022\n${specimen.script}`, 'benchmark'];
  const raw = await nativeExecute(profile.bash, args, { cwd, env, argv0: 'bash' });
  const entries = await snapshot({ list: readdir, read: readFile, link: readlink, stat: async path => {
    const info = await lstat(path); return { type: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', mode: info.mode };
  } }, specimen, cwd);
  return { stdout: encode(projectBytes(raw.stdout, replacements)), stderr: encode(projectBytes(raw.stderr, replacements)), exitCode: raw.exitCode, entries,
    raw: { stdout: encode(raw.stdout), stderr: encode(raw.stderr), entries }, reason: raw.reason, signal: raw.signal,
    launch: { executable: profile.bash, argv0: 'bash', args, cwd, env, stdin: specimen.stdin, replacements } };
}

async function virtualSession() {
  const audit = join(workspace, 'imports.jsonl');
  const child = fork(join(owned, 'frozen/engine.mjs'), [], {
    detached: true, execArgv: ['--expose-gc', '--unhandled-rejections=strict', '--import', 'tsx', '--import', join(owned, 'guard.mjs'), '--max-old-space-size=256'],
    env: { ...process.env, EXPANDED_ENGINE: 'virtual-bash', EXPANDED_SOURCE_ROOT: root, SEVEN_IMPORT_AUDIT: audit }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  live.add(child); pids.push(child.pid);
  let logs = '';
  child.stdout.on('data', bytes => { logs += bytes.toString(); }); child.stderr.on('data', bytes => { logs += bytes.toString(); });
  const receive = () => new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('virtual deadline')); }, 15000);
    const exit = (code, signal) => { clearTimeout(timer); reject(new Error(`virtual exit ${code}/${signal}: ${logs}`)); };
    child.once('exit', exit);
    child.once('message', message => { clearTimeout(timer); child.off('exit', exit); resolveMessage(message); });
  });
  assert.equal((await receive()).ready, true);
  return { async run(specimen, id) { const pending = receive(); child.send({ id, specimen, instrument: true, warmup: 0 }); return await pending; },
    async close() { const ended = new Promise(resolveExit => child.once('exit', resolveExit)); child.kill('SIGTERM'); await ended; live.delete(child); },
    audit, get logs() { return logs; } };
}

let report;
try {
  const profiles = [await nativeProfile('gnu53', '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash'), await nativeProfile('bash32', '/bin/bash')];
  const session = await virtualSession();
  const rows = [];
  try {
    for (const [index, entry] of corpus.cases.entries()) {
      const virtual = await session.run(entry.specimen, index + 1);
      const native = {};
      for (const profile of profiles) {
        const observation = await observeNative(profile, entry.specimen);
        native[profile.label] = { observation, frozenComparison: compare(entry.expected, observation), currentComparison: virtual.observation ? compare(observation, virtual.observation) : { pass: false, error: virtual.error } };
      }
      rows.push({ id: entry.specimen.id, recipeHash: entry.expected.recipeHash, virtual,
        frozenComparison: virtual.observation ? compare(entry.expected, virtual.observation) : { pass: false, error: virtual.error }, native });
    }
  } finally { await session.close(); }
  const imports = (await readFile(session.audit, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const after = await sourceSnapshot();
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
  const sourceImports = imports.filter(entry => entry.path.startsWith(join(root, 'src/')));
  const importMismatches = sourceImports.filter(entry => before[relative(root, entry.path)] !== entry.sha256 || after[relative(root, entry.path)] !== entry.sha256);
  assert.ok(sourceImports.some(entry => entry.path === join(root, 'src/index.ts')));
  const frozenDrift = Object.entries(before).flatMap(([path, sha256]) => {
    try { const frozenSha256 = hash(execFileSync('git', ['show', `${corpus.frozenSource}:${path}`], { maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })); return frozenSha256 === sha256 ? [] : [{ path, frozenSha256, sha256 }]; }
    catch { return [{ path, frozenSha256: null, sha256 }]; }
  });
  const counts = { currentVsFrozen: rows.filter(row => row.frozenComparison.pass).length, denominator: 7 };
  for (const profile of profiles) counts[profile.label] = { nativeVsFrozen: rows.filter(row => row.native[profile.label].frozenComparison.pass).length, currentVsNative: rows.filter(row => row.native[profile.label].currentComparison.pass).length, denominator: 7 };
  report = { started, finished: new Date().toISOString(), startHead, endHead: git('rev-parse', 'HEAD'), shellCommit: git('log', '-1', '--format=%H', '--', 'src/shell'),
    corpusSha256: await shaFile(join(owned, 'corpus.json')), initialStatus, finalStatus: git('status', '--short'), before, after, frozenDrift, imports, sourceImports: sourceImports.length,
    changed, importMismatches, guarded: changed.length === 0 && importMismatches.length === 0, node: process.version,
    tooling: Object.fromEntries(await Promise.all(['package.json', 'package-lock.json', 'node_modules/tsx/package.json'].map(async path => [path, await shaFile(join(root, path))]))),
    runnerHashes: Object.fromEntries(await Promise.all(['replay.mjs', 'guard.mjs', 'loader.mjs', 'frozen/engine.mjs', 'frozen/common.mjs'].map(async path => [path, await shaFile(join(owned, path))]))),
    profiles, controls, counts, rows, virtualLogs: session.logs, pids };
} finally {
  for (const child of live) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  await rm(workspace, { recursive: true, force: true });
}
report.cleanup = { workspaceRemoved: true, liveChildren: live.size, processGroupsAbsent: pids.every(pid => { try { process.kill(-pid, 0); return false; } catch { return true; } }) };
const record = process.argv.indexOf('--record');
if (record !== -1) {
  const name = process.argv[record + 1]; assert.match(name, /^[a-z0-9-]+\.json$/);
  const path = relative(root, join(owned, name));
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${path}\n${(JSON.stringify(report, null, 2) + '\n').split('\n').slice(0, -1).map(line => '+' + line).join('\n')}\n*** End Patch\n`, stdio: ['pipe', 'ignore', 'inherit'] });
}
console.log(JSON.stringify({ counts: report.counts, guarded: report.guarded, cleanup: report.cleanup, rows: report.rows.map(row => ({ id: row.id, pass: row.frozenComparison.pass, stdout: row.virtual.observation ? decode(row.virtual.observation.stdout).toString() : null, stderr: row.virtual.observation ? decode(row.virtual.observation.stderr).toString() : row.virtual.error, exitCode: row.virtual.observation?.exitCode })) }, null, 2));
process.exitCode = report.guarded && report.cleanup.processGroupsAbsent && report.counts.currentVsFrozen === 7 && report.counts.gnu53.nativeVsFrozen === 7 ? 0 : 1;
