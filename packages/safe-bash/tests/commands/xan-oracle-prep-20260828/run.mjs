import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scope = path.dirname(fileURLToPath(import.meta.url));
const repository = process.cwd();
const provenance = JSON.parse(await fs.readFile(path.join(scope, 'provenance.json'), 'utf8'));
const protocol = JSON.parse(await fs.readFile(path.join(scope, 'ROWS.json'), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const binding = execFileSync('git', ['log', '-1', '--format=%H', '--', scope], { encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain', '--', scope], { encoding: 'utf8' }).trim()) throw Error('Owned protocol scope is dirty');
if (protocol.rows.length !== 28) throw Error('Frozen row count mismatch');
if (hash(await fs.readFile(provenance.binary.path)) !== provenance.binary.sha256) throw Error('Binary changed');
for (const source of provenance.sources) {
  if (hash(await fs.readFile(source.cachePath)) !== source.sha256) throw Error(`Source changed: ${source.cachePath}`);
}
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'xan-dev-oracle-20260828-'));
const receipts = [];
let active;
let interrupted;
const terminate = () => { if (active?.pid) { try { process.kill(-active.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = signal; terminate(); });
console.log(output);
for (const row of protocol.rows) {
  if (interrupted) break;
  const cwd = path.join(output, row.id);
  await fs.mkdir(cwd);
  const files = row.files ?? {};
  const stdin = row.stdinHex ? Buffer.from(row.stdinHex, 'hex') : Buffer.from(row.stdin ?? '');
  if (stdin.length + Object.values(files).reduce((sum, value) => sum + Buffer.byteLength(value), 0) > 65536) throw Error('Input budget');
  for (const [name, value] of Object.entries(files)) await fs.writeFile(path.join(cwd, name), value, { flag: 'wx' });
  const env = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NO_COLOR: '1', TERM: 'dumb', PATH: '/usr/bin:/bin', HOME: cwd, TMPDIR: cwd };
  const started = new Date().toISOString();
  const stdout = [];
  const stderr = [];
  let bytes = 0;
  let limit;
  let spawnError;
  let stdinError;
  active = spawn(provenance.binary.path, row.argv, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const child = active;
  const timer = setTimeout(() => { limit = 'wall'; terminate(); }, 5000);
  const fileTimer = setInterval(() => {
    try {
      let total = 0;
      for (const name of row.outputs ?? []) {
        try { total += statSync(path.join(cwd, name)).size; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (total > 1048576) { limit = 'files'; terminate(); }
    } catch (error) { limit = String(error); terminate(); }
  }, 20);
  child.on('error', error => { spawnError = String(error); });
  child.stdin.on('error', error => { stdinError = String(error); });
  for (const [stream, collection] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
    bytes += chunk.length;
    if (bytes <= 1048576) collection.push(Buffer.from(chunk));
    else { limit = 'stdio'; terminate(); }
  });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, at: new Date().toISOString() })));
  child.stdin.end(stdin);
  const close = await closed;
  clearTimeout(timer);
  clearInterval(fileTimer);
  let groupAbsent = true;
  if (child.pid) {
    try { process.kill(-child.pid, 0); groupAbsent = false; terminate(); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  active = undefined;
  const effects = {};
  let effectBytes = 0;
  for (const name of await fs.readdir(cwd)) {
    const stat = await fs.lstat(path.join(cwd, name));
    effectBytes += stat.size;
    effects[name] = stat.isFile() && effectBytes <= 1048576 ? { bytes: stat.size, base64: (await fs.readFile(path.join(cwd, name))).toString('base64') } : { bytes: stat.size, uncaptured: true };
  }
  receipts.push({ id: row.id, binary: provenance.binary, argv: row.argv, cwd, env, stdinBase64: stdin.toString('base64'), fixtureFiles: files, started, pid: child.pid, close, groupAbsent, limit: limit ?? null, spawnError: spawnError ?? null, stdinError: stdinError ?? null, stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64'), effects });
  await fs.writeFile(path.join(output, 'RESULTS.json'), JSON.stringify({ classification: 'author-dev-observations-not-independent-acceptance', protocolCommit: binding, repository, host: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version }, interrupted: interrupted ?? null, receipts }, null, 2) + '\n');
  console.log(`${row.id}: ${close.code}/${close.signal}, ${bytes} bytes, groupAbsent=${groupAbsent}`);
  if (!groupAbsent || spawnError || limit) break;
}
for (const source of provenance.sources) if (hash(await fs.readFile(source.cachePath)) !== source.sha256) throw Error('Post-run source mismatch');
if (hash(await fs.readFile(provenance.binary.path)) !== provenance.binary.sha256) throw Error('Post-run binary mismatch');
console.log(`Complete: ${receipts.length}/28; protocol ${binding}; source/binary original-path hashes unchanged (not append-proof)`);
