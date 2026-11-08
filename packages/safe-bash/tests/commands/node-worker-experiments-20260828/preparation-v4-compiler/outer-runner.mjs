import { openSync, closeSync, writeSync, writeFileSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export async function runCompiler(presealSha256) {
const root = path.dirname(fileURLToPath(import.meta.url));
const stdout = openSync(path.join(root, 'run/compiler.stdout.raw'), 'wx');
const stderr = openSync(path.join(root, 'run/compiler.stderr.raw'), 'wx');
const started = Date.now(); let child; let closed = false; let primary = null; let captured = 0; let termTimer; let killTimer;
const events = [{ kind: 'raw-capture-owned', at: 0 }];
const fail = value => { primary ??= String(value?.message ?? value); if (child && !closed) { child.kill('SIGTERM'); killTimer ??= setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 2000); } };
const deadline = setTimeout(() => fail(Error('compiler deadline')), 180000);
let code = null; let signal = null;
try {
  const stat = lstatSync(path.join(root, 'PRESEAL.json')); if (!stat.isFile() || stat.size > 131072) throw Error('preseal admission');
  const bytes = readFileSync(path.join(root, 'PRESEAL.json')); if (createHash('sha256').update(bytes).digest('hex') !== presealSha256) throw Error('outer preseal');
  const seal = JSON.parse(bytes);
  for (const row of seal.files) { const location = path.join(root, row.path); const stat = lstatSync(location); if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(location) !== location || stat.size !== row.bytes || stat.size > 131072) throw Error('frozen source admission'); if (createHash('sha256').update(readFileSync(location)).digest('hex') !== row.sha256) throw Error('frozen source changed'); }
  if (Date.now() - started >= 180000) throw Error('pre-spawn deadline');
  child = spawn(seal.node, seal.compilerArgv, { cwd: root, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const completion = new Promise(resolve => { child.once('error', value => fail(value)); child.once('close', (exitCode, exitSignal) => { closed = true; code = exitCode; signal = exitSignal; events.push({ kind: 'compiler-close', code, signal, at: Date.now()-started }); resolve(); }); });
  for (const [stream, fd] of [[child.stdout, stdout], [child.stderr, stderr]]) { stream.on('error', fail); stream.on('data', bytes => { try { captured += bytes.length; if (captured > 16777216) { fail(Error('capture ceiling')); return; } writeSync(fd, bytes); } catch (value) { fail(value); } }); }
  try { events.push({ kind: 'compiler-spawn', pid: child.pid ?? null, at: Date.now()-started }); } catch (value) { fail(value); }
  await completion;
} catch (value) {
  fail(value);
  if (child && !closed) await new Promise(resolve => child.once('close', resolve));
} finally { clearTimeout(deadline); clearTimeout(termTimer); clearTimeout(killTimer); closeSync(stdout); closeSync(stderr); }
const receipt = { phase: 'compiler-only', started, elapsedMs: Date.now()-started, code, signal, primary, childAcquired: Boolean(child?.pid), childClosed: closed, rawCaptureClosed: true, captured, events, workers: 0, engineEvaluations: 0, cleanup: 'child close awaited; raw descriptors closed; regular artifacts retained; no scratch deletion' };
writeFileSync(path.join(root, 'run/OUTER.json'), JSON.stringify(receipt,null,2)+'\n', { flag: 'wx' });
return receipt;
}
