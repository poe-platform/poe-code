import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const started = Date.now();
const root = "/Users/kjopek/Workspace/safe-bash/tests/commands/node-provider-experiments-20260828/repair-v7-f05-external-owner";
const runtime = path.join(root, 'runtime');
const state = { child: null, closed: false, exit: null, signal: null, seen: 0, kept: 0, primary: null, secondary: [], signals: [], events: [{ kind: 'owner-entry', elapsedMs: 0, pid: process.pid }] };
let stdoutFd, stderrFd, terminationTimer, forcedTimer, config;
let closeResolve;
const closed = new Promise(resolve => { closeResolve = resolve; });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function event(kind, fields = {}) { if (state.events.length >= 64) throw new Error('event cap'); state.events.push({ kind, elapsedMs: Date.now() - started, ...fields }); }
function remember(reason) { if (state.primary === null) state.primary = reason; else if (state.secondary.length < 16) state.secondary.push(reason); }
function signalGroup(signal) {
  if (!state.child?.pid) return;
  state.signals.push(signal);
  try { process.kill(-state.child.pid, signal); } catch (reason) { if (reason.code !== 'ESRCH') remember(reason); }
}
function contain(reason) {
  remember(reason);
  if (!state.child || state.closed || terminationTimer) return;
  signalGroup('SIGTERM');
  terminationTimer = setTimeout(() => { if (!state.closed) signalGroup('SIGKILL'); }, 1000);
  forcedTimer = setTimeout(() => { if (!state.closed) { remember(new Error('retirement-unconfirmed')); event('retirement-unconfirmed'); } }, 3000);
}
const deadline = setTimeout(() => contain(new Error('owner-deadline-cleanup-reserve')), 270000);
function read(filename, maximum) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum || fs.realpathSync(filename) !== filename) throw new Error('read admission: ' + filename);
  const bytes = fs.readFileSync(filename);
  if (bytes.length !== stat.size) throw new Error('read changed');
  return bytes;
}
function write(name, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > 131072) throw new Error('metadata cap');
  fs.writeFileSync(path.join(runtime, name), bytes, { flag: 'wx', mode: 0o600 });
}
function capture(fd, bytes) {
  state.seen += bytes.length;
  const available = Math.max(0, 65536 - state.kept);
  const take = Math.min(bytes.length, available);
  let offset = 0;
  while (offset < take) offset += fs.writeSync(fd, bytes, offset, take - offset);
  state.kept += take;
  if (take !== bytes.length) contain(new Error('raw capture overflow'));
}
function authenticateGroup(group) {
  const expected = new Map(group.files.map(row => [row.path, row]));
  let entries = 0, bytes = 0;
  const found = [];
  function visit(relative) {
    const directory = path.join(group.root, relative);
    if (fs.realpathSync(directory) !== directory) throw new Error('directory alias');
    for (const name of fs.readdirSync(directory)) {
      const next = relative ? relative + '/' + name : name;
      if (group.exclusions.includes(next.split('/')[0])) continue;
      if (++entries > 1024 || !/^[A-Za-z0-9_.\/-]+$/.test(next)) throw new Error('inventory admission');
      const stat = fs.lstatSync(path.join(group.root, next));
      if (stat.isSymbolicLink()) throw new Error('input symlink');
      if (stat.isDirectory()) visit(next);
      else {
        const expectedFile = expected.get(next);
        if (!expectedFile || stat.size !== expectedFile.bytes) throw new Error('input membership/size');
        const body = read(path.join(group.root, next), 2097152);
        if (hash(body) !== expectedFile.sha256) throw new Error('input hash');
        bytes += body.length;
        if (bytes > 4194304) throw new Error('input work cap');
        found.push(next);
      }
    }
  }
  visit('');
  if (JSON.stringify(found.sort()) !== JSON.stringify([...expected.keys()].sort())) throw new Error('incomplete inventory');
  return bytes;
}
let result = null;
try {
  fs.mkdirSync(runtime, { mode: 0o700 });
  stdoutFd = fs.openSync(path.join(runtime, 'cli.stdout.raw'), 'wx', 0o600);
  stderrFd = fs.openSync(path.join(runtime, 'cli.stderr.raw'), 'wx', 0o600);
  write('OWNER-ENTRY.json', { started, pid: process.pid, qualification: 'Owner top-level entry after builtin import; prior tool scheduling/process startup excluded from numeric wall claim.' });
  event('raw-pipes-and-deadline-owned-before-admission');
  const configBytes = read(path.join(root, 'CONFIG.json'), 131072);
  if (process.argv.length !== 3 || hash(configBytes) !== process.argv[2]) throw new Error('config admission');
  config = JSON.parse(configBytes);
  if (config.authorized !== true || config.profile !== 'F05-EXTERNAL-OWNER-3PROCESS-v1' || config.maximumProcesses !== 3 || config.maximumOwnedChildren !== 12) throw new Error('root profile');
  if (hash(read(fileURLToPath(import.meta.url), 65536)) !== config.ownerSha256) throw new Error('actual owner source');
  if (process.execPath !== config.node.origin || process.version !== 'v22.22.2' || process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('tool metadata');
  if (JSON.stringify(Object.keys(process.env).sort()) !== JSON.stringify(['LC_ALL','PATH','TZ']) || process.env.PATH !== '/usr/bin:/bin' || process.env.LC_ALL !== 'C' || process.env.TZ !== 'UTC') throw new Error('finite env');
  const toolStat = fs.lstatSync(config.node.origin);
  if (!toolStat.isFile() || toolStat.isSymbolicLink() || toolStat.size !== config.node.bytes) throw new Error('tool read admission');
  const toolHash = createHash('sha256');
  const toolFd = fs.openSync(config.node.origin, 'r');
  const scratch = Buffer.alloc(65536);
  try { for (;;) { const count = fs.readSync(toolFd, scratch, 0, scratch.length, null); if (!count) break; toolHash.update(scratch.subarray(0, count)); } } finally { fs.closeSync(toolFd); }
  if (toolHash.digest('hex') !== config.node.sha256) throw new Error('tool body');
  for (const group of config.inputs) authenticateGroup(group);
  if (hash(read(config.grant.path, 8192)) !== config.grant.sha256) throw new Error('inner grant binding');
  for (const absent of config.mustBeAbsent) if (fs.existsSync(absent)) throw new Error('occupied runtime root');
  if (Date.now() - started >= 240000) throw new Error('pre-spawn time admission');
  event('child-admission', { executable: config.node.origin });
  const child = spawn(config.node.origin, config.cliArgs, { cwd: config.cliCwd, env: config.environment, stdio: ['ignore','pipe','pipe'], detached: true });
  state.child = child;
  child.once('error', reason => { remember(reason); });
  child.once('close', (code, signal) => { state.closed = true; state.exit = code; state.signal = signal; event('child-close', { code, signal }); closeResolve(); });
  child.stdout.on('error', reason => contain(reason));
  child.stderr.on('error', reason => contain(reason));
  child.stdout.on('data', bytes => { try { capture(stdoutFd, bytes); } catch (reason) { contain(reason); } });
  child.stderr.on('data', bytes => { try { capture(stderrFd, bytes); } catch (reason) { contain(reason); } });
  event('child-spawn', { pid: child.pid ?? null });
  write('SPAWN.json', { pid: child.pid ?? null, executable: config.node.origin, argv: config.cliArgs, cwd: config.cliCwd, environment: config.environment });
  await closed;
  if (state.exit !== 0 || state.signal !== null || state.kept !== state.seen) throw new Error('child exit/capture negative');
  const closure = JSON.parse(read(config.closurePath, 131072));
  if (closure.allPass !== true || closure.closeObserved !== true || closure.unsafe !== false || closure.archiveAuthenticated !== true || closure.outputRemoved !== true || closure.parentRemoved !== true || closure.fixtureChildren !== 0) throw new Error('inner closure unqualified');
  for (const group of config.inputs) authenticateGroup(group);
  try { process.kill(-child.pid, 0); throw new Error('owned process group remains'); } catch (reason) { if (reason.code !== 'ESRCH') throw reason; }
  result = { allPass: state.primary === null, inner: closure, processGroupGone: true };
} catch (reason) {
  contain(reason);
  if (state.child && !state.closed) await closed;
} finally {
  clearTimeout(deadline); clearTimeout(terminationTimer); clearTimeout(forcedTimer);
  if (stdoutFd !== undefined) fs.closeSync(stdoutFd);
  if (stderrFd !== undefined) fs.closeSync(stderrFd);
  const elapsedMs = Date.now() - started;
  const shape = value => value === null ? null : { name: typeof value?.name === 'string' ? value.name.slice(0,128) : null, message: String(value?.message ?? value).slice(0,2048) };
  const receipt = { schema: 'f05-external-owner-v1', allPass: result?.allPass === true && state.closed && elapsedMs <= 300000 && state.primary === null, ownerPid: process.pid, childPid: state.child?.pid ?? null, ownerEntry: started, elapsedMs, childClosed: state.closed, childExit: state.exit, childSignal: state.signal, primary: shape(state.primary), secondary: state.secondary.map(shape), rawSeen: state.seen, rawKept: state.kept, captureTruncated: state.seen !== state.kept, signals: state.signals, events: state.events, processGroupGone: result?.processGroupGone ?? false, maximumProcesses: 3, actualExpectedProcesses: state.child ? 3 : 1, qualification: 'Actual controller count comes from inner closure; no host/RSS/startup-before-owner bound; tool observes actual owner exit separately.', inner: result?.inner ?? null };
  try { write('OWNER-CLOSURE.json', receipt); } catch (reason) { remember(reason); receipt.allPass = false; }
  process.stdout.write(JSON.stringify({ allPass: receipt.allPass, elapsedMs, childClosed: state.closed, rawSeen: state.seen, receipt: path.join(runtime,'OWNER-CLOSURE.json') }) + '\n');
  process.exitCode = receipt.allPass ? 0 : 1;
}
