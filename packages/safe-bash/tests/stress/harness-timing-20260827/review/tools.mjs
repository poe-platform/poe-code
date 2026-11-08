import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const directory = fileURLToPath(new URL('./', import.meta.url));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString().trim();
export const active = new Map();
export const retired = [];
export function save(name, content) {
  assert(!name.split('/').includes('..'));
  const path = directory + name;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n', { flag: 'wx' });
}
export function ready() {
  assert(existsSync('/tmp/harness-timing-author-ready.txt'), 'author freeze required before dynamic work');
  return readFileSync('/tmp/harness-timing-author-ready.txt', 'utf8');
}
export function identity() {
  const paths = git('ls-files', 'src', 'package.json', 'package-lock.json',
    'tests/commands/search-stress', 'tests/commands/structured-stress/jq-grammar-author-20260827',
    'tests/commands/structured-stress/jq-42-independent-review/harness.ts',
    'tests/stress/harness-timing-20260827').split('\n').filter(path => !path.includes('/review/') && !path.includes('/evidence/') && !path.includes('/frozen/'));
  return {
    at: new Date().toISOString(), head: git('rev-parse', 'HEAD'), status: git('status', '--short'), index: git('diff', '--cached', '--name-only'),
    node: process.version, versions: process.versions, platform: process.platform, arch: process.arch, loadavg: loadavg(),
    hashes: Object.fromEntries(paths.map(path => [path, digest(readFileSync(root + path))])),
    rootNotes: readFileSync('/tmp/harness-timing-root-notes.txt', 'utf8'),
  };
}
export async function run(name, command, args, { timeoutMs = 45000, cwd = root, extraEnv = {}, input = '', captureBytes = 2 * 1024 * 1024 } = {}) {
  ready();
  assert(active.size < 2, 'at most two directly owned children; descendant count requires reviewed schedule');
  assert(!existsSync(directory + `evidence/${name}.json`), 'attempt names cannot be reused');
  const started = performance.now();
  const events = [];
  const mark = (event, detail = {}) => events.push({ event, ms: performance.now() - started, ...detail });
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C', RIPGREP_CONFIG_PATH: '', NO_COLOR: '1', ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  mark('launch', { command, args, cwd, timeoutMs, dueMs: timeoutMs, loadavg: loadavg() });
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  active.set(name, child);
  const output = [];
  const errors = [];
  const failures = [];
  const listeners = [];
  const listen = (target, event, callback) => { target.on(event, callback); listeners.push([target, event, callback]); };
  let captured = 0;
  let firstByte = false;
  let exitSeen = false;
  let closeSeen = false;
  let cleanupTimer;
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const kill = reason => {
    failures.push(reason);
    mark('kill-request', { reason, pid: child.pid, accepted: child.kill('SIGKILL') });
    if (!cleanupTimer) cleanupTimer = setTimeout(() => {
      failures.push('exact child cleanup acknowledgement missing');
      mark('cleanup-timeout', { dueAfterKillMs: 2000, exitSeen, closeSeen });
      child.kill('SIGKILL');
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      finish();
    }, 2000);
  };
  const deadline = setTimeout(() => {
    mark('deadline-fired', { dueMs: timeoutMs, actualMs: performance.now() - started });
    kill('review outer watchdog expired');
  }, timeoutMs);
  listen(child, 'spawn', () => mark('spawn', { pid: child.pid, notApplicationReadiness: true }));
  listen(child, 'error', error => { failures.push(String(error)); mark('child-error', { error: String(error) }); });
  listen(child, 'exit', (code, signal) => { exitSeen = true; mark('exit', { code, signal }); });
  listen(child, 'close', (code, signal) => { closeSeen = true; mark('close', { code, signal }); finish(); });
  listen(child.stdin, 'error', error => mark('stdin-error', { error: String(error) }));
  for (const [label, stream, chunks] of [['stdin', child.stdin, null], ['stdout', child.stdout, output], ['stderr', child.stderr, errors]]) {
    listen(stream, 'close', () => mark(`${label}-close`));
    if (!chunks) continue;
    listen(stream, 'end', () => mark(`${label}-end`));
    listen(stream, 'error', error => kill(`${label} error: ${error}`));
    listen(stream, 'data', chunk => {
      if (!firstByte) { firstByte = true; mark('first-byte', { stream: label }); }
      mark(`${label}-data`, { bytes: chunk.length });
      captured += chunk.length;
      if (captured > captureBytes) kill('review capture limit');
      else chunks.push(Buffer.from(chunk));
    });
  }
  child.stdin.end(input);
  await completed;
  clearTimeout(deadline); clearTimeout(cleanupTimer);
  if (closeSeen) active.delete(name);
  for (const [target, event, callback] of listeners) target.off(event, callback);
  const result = {
    name, command, args, cwd, startedAtOffset: started, durationMs: performance.now() - started,
    pid: child.pid ?? null, code: child.exitCode, signal: child.signalCode, failures,
    exitSeen, closeSeen, streamDestroyed: { stdin: child.stdin.destroyed, stdout: child.stdout.destroyed, stderr: child.stderr.destroyed },
    ownedListenersRemaining: listeners.filter(([target, event, callback]) => target.listeners(event).includes(callback)).length,
    events, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString(),
  };
  retired.push({ name, pid: result.pid, exitSeen, closeSeen, failures });
  save(`evidence/${name}.stdout.log`, result.stdout);
  save(`evidence/${name}.stderr.log`, result.stderr);
  save(`evidence/${name}.json`, result);
  return result;
}
export function assertClosed(result) {
  assert.deepEqual(result.failures, [], result.name);
  assert.equal(result.exitSeen, true, result.name);
  assert.equal(result.closeSeen, true, result.name);
  assert.deepEqual(result.streamDestroyed, { stdin: true, stdout: true, stderr: true }, result.name);
  assert.equal(result.ownedListenersRemaining, 0, result.name);
  assert.equal(result.signal, null, result.name);
  assert.equal(result.code, 0, `${result.name}\n${result.stdout}\n${result.stderr}`);
}
