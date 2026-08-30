import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const owned = dirname(fileURLToPath(import.meta.url));
export const root = resolve(owned, '../../..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const envTool = '/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/env';
export const profiles = [
  { role: 'primary', binary: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash', hash: '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c' },
  { role: 'historical', binary: '/bin/bash', hash: '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3' },
];
export function save(name, value) {
  if (!/^[a-zA-Z0-9_.-]+$/u.test(name)) throw new Error('Owned filename required');
  const path = resolve(owned, name);
  if (existsSync(path)) throw new Error('Immutable evidence already exists: ' + path);
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${path}\n${content.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 8e6 });
}
export function run(executable, args, options) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, argv0: options.argv0, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = []; const stderr = []; let size = 0; let timedOut = false; let overflow = false;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.deadline ?? 5000);
    const append = target => bytes => { size += bytes.length; if (size > 1024 * 1024) { overflow = true; kill(); } else target.push(bytes); };
    child.stdout.on('data', append(stdout)); child.stderr.on('data', append(stderr));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => {
      clearTimeout(timer); kill(); let groupAlive = false;
      try { process.kill(-child.pid, 0); groupAlive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
      accept({ pid: child.pid, status, signal, timedOut, overflow, groupAlive, stdoutHex: Buffer.concat(stdout).toString('hex'), stderrHex: Buffer.concat(stderr).toString('hex') });
    });
    child.stdin.end(options.input ?? '');
  });
}
