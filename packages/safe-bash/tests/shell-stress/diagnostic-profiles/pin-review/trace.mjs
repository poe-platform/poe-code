import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { register, syncBuiltinESMExports } from 'node:module';

const policyPath = process.env.PIN_REVIEW_POLICY;
const tracePath = process.env.PIN_REVIEW_TRACE;
assert.ok(policyPath && tracePath);
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const record = value => appendFileSync(tracePath, JSON.stringify({ owner: process.pid, ...value }) + '\n');
register(`data:text/javascript,${encodeURIComponent(String.raw`
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const policy = JSON.parse(readFileSync(process.env.PIN_REVIEW_POLICY, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:')) return nextLoad(url, context);
  const path = realpathSync(fileURLToPath(url));
  const before = hash(readFileSync(path));
  const result = await nextLoad(url, context);
  const after = hash(readFileSync(path));
  const expected = policy.files[path];
  const valid = before === after && before === expected;
  appendFileSync(process.env.PIN_REVIEW_TRACE, JSON.stringify({ kind: 'load', owner: process.pid, url, path, before, after, expected: expected ?? null, valid }) + '\n');
  if (!valid) throw new Error('Independent committed import rejected: ' + path);
  return result;
}
`)}`);

function optionsFor(command, options) {
  if (command !== process.execPath) return options;
  const env = { ...(options?.env ?? process.env) };
  const preload = `--import=${import.meta.url}`;
  env.NODE_OPTIONS = (env.NODE_OPTIONS ?? '').includes(preload) ? env.NODE_OPTIONS : `${env.NODE_OPTIONS ?? ''} ${preload}`.trim();
  env.PIN_REVIEW_POLICY = policyPath;
  env.PIN_REVIEW_TRACE = tracePath;
  env.TSX_DISABLE_CACHE = '1';
  return { ...options, env };
}
function checkProductCapability(command) {
  if (!process.argv.some(argument => argument.endsWith('/virtual-child.ts'))) return;
  assert.equal(command, policy.esbuild, `Product process fallback rejected: ${command}`);
}
const spawn = childProcess.spawn;
childProcess.spawn = function observed(command, args, options) {
  checkProductCapability(command);
  const forwarded = optionsFor(command, options);
  const child = spawn(command, args, forwarded);
  const stdout = [], stderr = [], input = [];
  let bytes = 0, overflow = false;
  const collect = (target, chunk) => {
    bytes += chunk.length;
    if (bytes <= 2 * 1024 * 1024) target.push(Buffer.from(chunk));
    else overflow = true;
  };
  record({ kind: 'spawn', pid: child.pid, command, args, cwd: forwarded?.cwd ?? process.cwd(), env: forwarded?.env ?? null, detached: forwarded?.detached ?? false });
  child.stdout?.on('data', chunk => collect(stdout, chunk));
  child.stderr?.on('data', chunk => collect(stderr, chunk));
  if (child.stdin) {
    const end = child.stdin.end;
    child.stdin.end = function observedEnd(chunk, ...rest) {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) input.push(Buffer.from(chunk));
      return end.call(this, chunk, ...rest);
    };
  }
  child.once('close', (status, signal) => record({ kind: 'close', pid: child.pid, status, signal, stdout: Buffer.concat(stdout).toString('base64'), stderr: Buffer.concat(stderr).toString('base64'), input: Buffer.concat(input).toString('base64'), overflow }));
  return child;
};
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = function observedSync(command, args, options) {
  checkProductCapability(command);
  const forwarded = optionsFor(command, options);
  const result = spawnSync(command, args, forwarded);
  record({ kind: 'sync', command, args, cwd: forwarded?.cwd ?? process.cwd(), status: result.status, signal: result.signal, stdout: Buffer.from(result.stdout ?? '').toString('base64'), stderr: Buffer.from(result.stderr ?? '').toString('base64') });
  return result;
};
if (process.argv.some(argument => argument.endsWith('/virtual-child.ts'))) {
  globalThis.fetch = () => { throw new Error('Product network fallback rejected'); };
}
syncBuiltinESMExports();
