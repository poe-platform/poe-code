import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const owned = dirname(fileURLToPath(import.meta.url));
export const root = resolve(owned, '../../..');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const environment = { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
export const primary = '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash';

export async function sourceGuard() {
  const hashes = {};
  async function visit(filename) {
    const key = relative(root, filename);
    if (hashes[key]) return;
    const bytes = await readFile(filename);
    hashes[key] = sha256(bytes);
    for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/gu)) {
      await visit(resolve(dirname(filename), match[1].replace(/\.js$/u, '.ts')));
    }
  }
  for (const entry of ['src/shell/index.ts', 'src/fs/memory/index.ts', 'src/commands/index.ts', 'src/contracts/index.ts']) await visit(resolve(root, entry));
  const files = Object.fromEntries(Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)));
  return { sha256: sha256(JSON.stringify(files)), files };
}

export function runChild(executable, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    const trace = options.env?.CURRENT_SHELL_IMPORT_TRACE ?? process.env.CURRENT_SHELL_IMPORT_TRACE;
    const tracing = executable === process.execPath && trace;
    const childArgs = tracing ? ['--import', resolve(owned, 'acceptance-trace.mjs'), ...args] : args;
    const env = tracing ? { ...(options.env ?? environment), CURRENT_SHELL_IMPORT_TRACE: trace } : options.env ?? environment;
    const child = spawn(executable, childArgs, { cwd: options.cwd ?? root, env, argv0: options.argv0, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let overflow = false;
    let size = 0;
    const killGroup = () => {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, options.deadline ?? 8000);
    const capture = target => chunk => { size += chunk.length; if (size > 1024 * 1024) { overflow = true; killGroup(); } else target.push(chunk); };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      killGroup();
      let groupAlive = false;
      if (child.pid) { try { process.kill(-child.pid, 0); groupAlive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; } }
      resolveResult({ pid: child.pid, status, signal, timedOut, overflow, groupAlive, stdout: Buffer.concat(stdout).toString('base64'), stderr: Buffer.concat(stderr).toString('base64') });
    });
    child.stdin.end(options.stdin ?? '');
  });
}

export async function snapshot(directory) {
  const files = {};
  async function visit(current) {
    for (const name of (await readdir(current)).sort()) {
      if (current === directory && name === 'bin') continue;
      const path = resolve(current, name);
      const stat = await lstat(path);
      const key = relative(directory, path);
      if (stat.isDirectory()) { files[`${key}/`] = null; await visit(path); }
      else if (stat.isFile()) files[key] = (await readFile(path)).toString('base64');
      else throw new Error(`Unexpected fixture entry: ${key}`);
    }
  }
  await visit(directory);
  return files;
}

export function patchJson(filename, value) {
  const path = relative(root, resolve(owned, filename));
  if (!path.startsWith('tests/shell-stress/current-shell/')) throw new Error('Output outside ownership');
  if (existsSync(resolve(root, path))) throw new Error(`Refusing to overwrite evidence: ${path}`);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  execFileSync(process.env.CURRENT_SHELL_APPLY_PATCH ?? 'apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${path}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`, maxBuffer: 4 * 1024 * 1024 });
}
