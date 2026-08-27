import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const read = path => JSON.parse(readFileSync(path));
export function save(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
export function inventory(root, prefix = '', result = {}) {
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) inventory(root, path + '/', result);
    else { assert(entry.isFile(), 'nonregular file: ' + path); result[path] = hash(readFileSync(join(root, path))); }
  }
  return result;
}
export function toolInventory(root, prefix = '', result = {}) {
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) toolInventory(root, path + '/', result);
    else if (entry.isSymbolicLink()) {
      const target = realpathSync(join(root, path)); assert(target.startsWith(root + '/'));
      result[path] = { link: readlinkSync(join(root, path)), targetSHA256: hash(readFileSync(target)) };
    } else { assert(entry.isFile()); result[path] = hash(readFileSync(join(root, path))); }
  }
  return result;
}
export async function supervised(directory, id, executable, args, options = {}) {
  mkdirSync(directory, { recursive: true });
  const prefix = join(directory, id);
  const pre = { at: new Date().toISOString(), executable, executableSHA256: hash(readFileSync(executable)), args, cwd: options.cwd, env: options.env, inputs: options.inputs, supervisorSHA256: hash(readFileSync(new URL(import.meta.url))), driver: options.driver };
  save(prefix + '.pre.json', pre);
  const stdout = [], stderr = []; let killed = false, spawnError;
  const start = performance.now();
  const child = spawn(executable, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {}); child.stdin.end(options.input);
  child.stdout.on('data', bytes => stdout.push(Buffer.from(bytes)));
  child.stderr.on('data', bytes => stderr.push(Buffer.from(bytes)));
  const deadlineMs = options.deadlineMs ?? 5000;
  const timer = setTimeout(() => { killed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, deadlineMs);
  const result = await new Promise(resolve => {
    child.on('error', error => { spawnError = error.message; });
    child.on('close', (status, signal) => resolve({ status, signal }));
  });
  clearTimeout(timer);
  let processGroupGone = false;
  try { process.kill(-child.pid, 0); } catch (error) { processGroupGone = error.code === 'ESRCH'; }
  const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
  writeFileSync(prefix + '.stdout', out); writeFileSync(prefix + '.stderr', err);
  const row = { id, ...result, spawnError, pid: child.pid, killed, processGroupGone, elapsedMs: performance.now() - start, deadlineMs, preSHA256: hash(readFileSync(prefix + '.pre.json')), stdoutSHA256: hash(out), stderrSHA256: hash(err), stdoutBytes: out.length, stderrBytes: err.length };
  try { row.result = JSON.parse(out.toString().trim().split('\n').at(-1)); } catch {}
  row.loads = err.toString().split('\n').filter(line => line.startsWith('LOAD ')).map(line => JSON.parse(line.slice(5)));
  row.outcome = !killed && processGroupGone && row.status === (options.expectedStatus ?? 0) && (!options.expectedError || new RegExp(options.expectedError).test(out.toString() + err.toString())) ? 'PASS' : 'FAIL';
  if (options.intentionalKill) row.outcome = killed && processGroupGone ? 'EXPECTED_SUPERVISOR_KILL' : 'FAIL';
  save(prefix + '.receipt.json', row);
  return row;
}
