import { lstat, realpath, readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const output = root + 'CLOSURE-01/';
const tool = '/Library/Developer/CommandLineTools/usr/bin/llvm-otool';
const toolHash = '61ff2c63cf68eeeadf9c4700dadb8271740ff4960f98500f30db82b31521c0de';
const targets = ['/opt/homebrew/Cellar/gnupg/2.5.21/bin/gpgv', '/opt/homebrew/Cellar/gnupg/2.5.21/bin/gpg'];
const expected = ['d9eb7bc783a1a0f1f39bb1f12ff0c94d7c2aac3b25aac2a7909a647d60be7bd4', '9d8501878158144e8db80be1454f6c69d62b8a97c21441da3b720081f917f8ac'];
let starts = 0;
let allClosed = true;
let readBytes = 0;
const bindings = [];
const batches = [];
const system = new Set();
const unresolved = new Set();
await mkdir(output, { mode: 0o700 });
const save = (name, value) => writeFile(output + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
await save('STARTUP.json', { startedAt: new Date().toISOString(), tool, targets, childrenMax: 4 });
const bind = async path => {
  const resolved = await realpath(path);
  assert(resolved === tool || resolved.startsWith('/opt/homebrew/Cellar/'));
  const before = await lstat(resolved, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink() && before.size <= 268435456n);
  readBytes += Number(before.size);
  assert(readBytes <= 536870912);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(resolved, { highWaterMark: 65536 })) digest.update(chunk);
  const after = await lstat(resolved, { bigint: true });
  assert(before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs);
  return { path, resolved, bytes: Number(before.size), mode: Number(before.mode & 0o777n).toString(8), sha256: digest.digest('hex') };
};
const run = async argv => {
  assert(starts < 4);
  const toolBefore = await bind(tool);
  assert.equal(toolBefore.sha256, toolHash);
  const index = ++starts;
  const stdout = await open(output + `${index}.stdout.raw`, 'wx', 0o600);
  const stderr = await open(output + `${index}.stderr.raw`, 'wx', 0o600);
  const environment = { HOME: output + 'home', TMPDIR: output + 'tmp', PATH: output + 'empty', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
  await save(`${index}.admission.json`, { tool: toolBefore, argv, environment, cwd: output + 'home' });
  const started = performance.now();
  const events = [];
  let failure = null;
  let timer;
  let closeTimer;
  let child;
  let disposition;
  const lengths = { stdout: 0, stderr: 0 };
  try {
    allClosed = false;
    child = spawn(tool, argv, { shell: false, detached: true, env: environment, cwd: output + 'home', stdio: ['ignore', 'pipe', 'pipe'] });
    events.push({ type: 'spawn', pid: child.pid ?? null });
    const kill = reason => {
      failure ??= new Error(reason);
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failure = error; } }
    };
    const consume = async (source, handle, name) => {
      try {
        for await (const chunk of source) {
          lengths[name] += chunk.length;
          if (lengths[name] > 262144) throw new Error('CAPTURE_CAP');
          await handle.writeFile(chunk);
        }
      } catch (error) { failure ??= error; kill('CAPTURE_FAILURE'); }
    };
    const consumed = Promise.all([consume(child.stdout, stdout, 'stdout'), consume(child.stderr, stderr, 'stderr')]);
    disposition = await new Promise((resolve, reject) => {
      child.once('error', error => { failure ??= error; events.push({ type: 'error', message: error.message }); });
      child.once('exit', (code, signal) => events.push({ type: 'exit', code, signal, elapsedMs: performance.now() - started }));
      child.once('close', (code, signal) => { allClosed = true; events.push({ type: 'close', code, signal, elapsedMs: performance.now() - started }); resolve({ code, signal }); });
      timer = setTimeout(() => kill('BODY_DEADLINE'), 10000);
      closeTimer = setTimeout(() => { kill('UNKNOWN_RETIREMENT'); reject(new Error('UNKNOWN_RETIREMENT')); }, 11000);
    });
    await consumed;
    if (failure) throw failure;
    assert.equal(disposition.code, 0, 'METADATA_TOOL_NONZERO');
    const toolAfter = await bind(tool);
    assert.equal(toolAfter.sha256, toolHash);
  } finally {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    await stdout.close();
    await stderr.close();
    await save(`${index}.result.json`, { events, lengths, disposition, allClosed, failure: failure?.message ?? null, elapsedMs: performance.now() - started });
  }
  return readFile(output + `${index}.stdout.raw`, 'utf8');
};
try {
  for (const name of ['home', 'tmp', 'empty']) await mkdir(output + name, { mode: 0o700 });
  const seen = new Set();
  let pending = targets;
  for (let depth = 0; depth < 3 && pending.length; depth++) {
    const current = [];
    for (const path of pending) {
      const identity = await bind(path);
      const targetIndex = targets.indexOf(path);
      if (targetIndex >= 0) assert.equal(identity.sha256, expected[targetIndex]);
      if (!seen.has(identity.resolved)) {
        assert(seen.size < 24);
        seen.add(identity.resolved);
        bindings.push(identity);
        current.push(identity.resolved);
      }
    }
    if (!current.length) break;
    const text = await run(['-L', ...current]);
    const next = new Set();
    const dependencies = [];
    let owner;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      if (!/^\s/.test(line) && line.endsWith(':')) { owner = line.slice(0, -1); assert(current.includes(owner)); continue; }
      const match = /^\s+(.+) \(compatibility version [^)]+\)$/.exec(line);
      assert(match && owner, 'UNRECOGNIZED_LOAD_METADATA');
      const dependency = match[1];
      dependencies.push({ owner, dependency });
      if (dependency.startsWith('/opt/homebrew/')) {
        const resolved = await realpath(dependency);
        if (!seen.has(resolved)) next.add(dependency);
      } else if (dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/')) system.add(dependency);
      else unresolved.add(dependency);
    }
    batches.push({ depth, inputs: current, dependencies });
    pending = [...next];
  }
  for (const path of pending) if (!seen.has(await realpath(path))) unresolved.add(path);
  if (starts < 4) await run(['-l', ...targets]);
  for (const identity of bindings) assert.equal((await bind(identity.resolved)).sha256, identity.sha256);
  await save('CLOSURE.json', { bindings, batches, systemDependencies: [...system].sort(), unresolved: [...unresolved].sort(), starts, allClosed, gpgExecutions: 0, systemCacheQualification: 'STATIC_PLATFORM_IDENTIFIERS_WITH_PREPARED_DYLD_AND_OS_BINDINGS_NOT_SHARED_CACHE_IMAGE_HASHES' });
} catch (error) {
  process.exitCode = 1;
  await save('FAILURE.json', { name: error.name, message: error.message, starts, allClosed, bindings, batches });
} finally {
  await save('RESULT.json', { starts, allClosed, readBytes, status: process.exitCode ? 'STOP' : 'STATIC_METADATA_COMPLETE_NOT_VERIFIER_ADMISSION', endedAt: new Date().toISOString() });
}
