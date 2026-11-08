import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: own }).toString().trim();
export const candidate = '618d8967009117547ab476256bc6eb0a9463309a';
export const author = 'cb94b17d0eefc62e2a51f5a6f7cf46ebbcad2faf';
export const freeze = 'e974d60a1c7153aa0491799e4784249311d62099';
export const work = path.join(own, '.work');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('/usr/bin/git', ['-c', 'core.fsmonitor=false', ...args], { cwd: repo, env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, maxBuffer: 256 * 1024 * 1024 });
export const write = (name, bytes) => { assert(path.resolve(name).startsWith(own + '/')); fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, bytes, { flag: 'wx' }); };
export const save = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
export function inventory(root) {
  const entries = {};
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const child = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(path.join(root, child));
      assert(!stat.isSymbolicLink(), `not a regular copy: ${child}`);
      if (stat.isDirectory()) { entries[child + '/'] = { kind: 'directory' }; visit(child); }
      else { assert(stat.isFile()); const bytes = fs.readFileSync(path.join(root, child)); entries[child] = { kind: 'file', bytes: bytes.length, sha256: hash(bytes), mode: stat.mode & 0o111 ? '100755' : '100644' }; }
    }
  }
  visit('');
  return entries;
}
export function environment(extra = {}) {
  return { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: path.join(work, 'home'), TMPDIR: path.join(work, 'tmp'), TMP: path.join(work, 'tmp'), TEMP: path.join(work, 'tmp'), XDG_CACHE_HOME: path.join(work, 'cache'), npm_config_cache: path.join(work, 'npm-cache'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', TSX_DISABLE_CACHE: '1', GIT_OPTIONAL_LOCKS: '0', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', ...extra };
}
export async function run(label, command, cwd, options = {}) {
  const directory = path.join(work, 'logs', label);
  assert(!fs.existsSync(directory), `capture exists ${label}`);
  fs.mkdirSync(directory, { recursive: true });
  const stdout = fs.createWriteStream(path.join(directory, 'stdout'), { flags: 'wx' });
  const stderr = fs.createWriteStream(path.join(directory, 'stderr'), { flags: 'wx' });
  const started = new Date().toISOString();
  const env = environment(options.env);
  const child = spawn(command[0], command.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let total = 0, termination = null, error = null;
  const terminate = reason => { termination ??= reason; try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(() => terminate('timeout'), options.timeout ?? 180000);
  for (const [source, sink] of [[child.stdout, stdout], [child.stderr, stderr]]) source.on('data', chunk => { total += chunk.length; if (total > (options.maxBytes ?? 16 * 1024 * 1024)) terminate('output-limit'); sink.write(chunk); });
  child.on('error', failure => { error = String(failure); });
  const result = await new Promise(resolve => child.on('close', (status, signal) => resolve({ status, signal })));
  clearTimeout(timer);
  await Promise.all([new Promise(resolve => stdout.end(resolve)), new Promise(resolve => stderr.end(resolve))]);
  const output = fs.readFileSync(path.join(directory, 'stdout'), 'utf8');
  const counts = Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const record = { label, command, cwd, env, started, ended: new Date().toISOString(), pid: child.pid, ...result, termination, error, bytes: total, counts, closeAwaited: true };
  save(path.join(directory, 'PROCESS.json'), record);
  console.log(JSON.stringify({ label, ...result, termination, counts }));
  return record;
}
