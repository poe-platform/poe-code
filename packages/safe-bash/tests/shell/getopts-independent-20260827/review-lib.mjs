import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const save = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export function inventory(root) {
  const entries = {};
  const walk = (relative = '') => {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const key = relative ? `${relative}/${name}` : name;
      const filename = path.join(root, key); const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) entries[key] = { type: 'symlink', target: fs.readlinkSync(filename) };
      else if (stat.isDirectory()) { entries[key] = { type: 'directory' }; walk(key); }
      else { const bytes = fs.readFileSync(filename); entries[key] = { type: 'file', bytes: bytes.length, sha256: sha256(bytes) }; }
    }
  };
  walk(); return entries;
}
export async function execute(command, args, options = {}) {
  const started = new Date().toISOString(); const before = performance.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = []; let stdoutBytes = 0; let stderrBytes = 0; let terminated = null;
    const cap = options.cap ?? 16 * 1024 * 1024;
    const timer = setTimeout(() => { terminated = 'timeout'; child.kill('SIGKILL'); }, options.timeout ?? 60000);
    child.stdout.on('data', (chunk) => { stdoutBytes += chunk.length; if (stdoutBytes > cap) { terminated = 'stdout-cap'; child.kill('SIGKILL'); } else stdout.push(Buffer.from(chunk)); });
    child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; if (stderrBytes > cap) { terminated = 'stderr-cap'; child.kill('SIGKILL'); } else stderr.push(Buffer.from(chunk)); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => { clearTimeout(timer); const out = Buffer.concat(stdout); const err = Buffer.concat(stderr); resolve({ command, args, started, milliseconds: performance.now() - before, status, signal, terminated, pid: child.pid, settled: true, stdout: out.toString(), stderr: err.toString(), stdoutBase64: out.toString('base64'), stderrBase64: err.toString('base64') }); });
  });
}
