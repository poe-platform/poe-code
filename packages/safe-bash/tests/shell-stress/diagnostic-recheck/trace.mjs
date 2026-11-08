import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import childProcess from 'node:child_process';
const trace = process.env.DIAGNOSTIC_RECHECK_TRACE;
const override = process.env.DIAGNOSTIC_NATIVE_OVERRIDE;
const record = value => appendFileSync(trace, JSON.stringify(value) + '\n');
function snapshot(directory, prefix = '') {
  const files = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) { const key = prefix + entry.name; const path = resolve(directory, entry.name); if (entry.isDirectory()) { files[key] = { type: 'directory' }; Object.assign(files, snapshot(path, key + '/')); } else if (entry.isFile()) files[key] = { type: 'file', base64: readFileSync(path).toString('base64') }; else throw Error('Unexpected native fixture kind'); }
  return files;
}
if (trace) {
  registerHooks({ load(url, context, nextLoad) { const loaded = nextLoad(url, context); if (url.startsWith('file:')) { const path = fileURLToPath(url.split('?')[0]); if (path.includes('/safe-bash/src/') || path.includes('/safe-bash/tests/')) record({ type: 'load', pid: process.pid, path, hash: createHash('sha256').update(readFileSync(path)).digest('hex') }); } return loaded; } });
  for (const method of ['spawn', 'spawnSync']) {
    const original = childProcess[method];
    childProcess[method] = function(command, args, options) {
      const requested = command; const originalArgs = [...(args ?? [])]; const native = command === '/bin/bash' || command === '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash';
      if (native && command === '/bin/bash' && override) command = override;
      const node = command === process.execPath;
      if (node) { args = ['--import', fileURLToPath(import.meta.url), ...args]; options = { ...options, env: { ...(options?.env ?? process.env), DIAGNOSTIC_RECHECK_TRACE: trace, ...(override ? { DIAGNOSTIC_NATIVE_OVERRIDE: override } : {}) } }; }
      const initialFiles = native && args?.includes('-c') ? snapshot(options?.cwd ?? process.cwd()) : undefined;
      const child = original.call(this, command, args, options);
      if (!native && !node) return child;
      const launch = { type: 'process', parent: process.pid, method, requested, executable: command, args, originalArgs, argv0: options?.argv0 ?? command, cwd: options?.cwd ?? process.cwd(), env: options?.env ?? process.env, pid: child.pid, initialFiles };
      if (method === 'spawnSync') { record({ ...launch, status: child.status, signal: child.signal, stdout: Buffer.from(child.stdout ?? '').toString('base64'), stderr: Buffer.from(child.stderr ?? '').toString('base64') }); return child; }
      const stdout = []; const stderr = []; const input = [];
      child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk))); child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)));
      if (child.stdin) { const end = child.stdin.end; child.stdin.end = function(chunk, ...rest) { if (chunk != null && typeof chunk !== 'function') input.push(Buffer.from(chunk)); return end.call(this, chunk, ...rest); }; }
      child.on('close', (status, signal) => { let files; let snapshotError; if (native && args.includes('-c')) { try { files = snapshot(launch.cwd); } catch (error) { snapshotError = error.message; } } record({ ...launch, status, signal, stdout: Buffer.concat(stdout).toString('base64'), stderr: Buffer.concat(stderr).toString('base64'), stdin: Buffer.concat(input).toString('base64'), files, snapshotError }); });
      return child;
    };
  }
  syncBuiltinESMExports();
}
