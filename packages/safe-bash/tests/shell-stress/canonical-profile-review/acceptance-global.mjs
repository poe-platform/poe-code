import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { owned, root, save, sha256 } from './support.mjs';
import { git } from './acceptance-audit.mjs';

const output = 'acceptance-live-global.json';
assert.equal(existsSync(resolve(owned, output)), false);
const paths = ['package.json', 'package-lock.json', 'tsconfig.json', 'src/shell/runtime.ts', 'src/shell/parser.ts', 'node_modules/typescript/lib/typescript.js'];
const capture = async () => ({ head: git(['rev-parse', 'HEAD']).toString().trim(), status: git(['status', '--porcelain=v1']).toString(), index: git(['diff', '--cached', '--name-only']).toString(), files: Object.fromEntries(await Promise.all(paths.map(async path => [path, sha256(await readFile(resolve(root, path)))]))) });
const before = await capture();
const args = ['tests/shell-stress/canonical-profile-review/acceptance-types.mjs', 'global'];
const env = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
const result = await new Promise((resolveResult, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [], stderr = [];
  let bytes = 0, overflow = false, timedOut = false;
  const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } };
  const timer = setTimeout(() => { timedOut = true; stop(); }, 120000);
  const collect = chunks => chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) { overflow = true; stop(); } else chunks.push(chunk); };
  child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', (status, signal) => {
    clearTimeout(timer); stop();
    let groupAlive = false;
    try { process.kill(-child.pid, 0); groupAlive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
    resolveResult({ pid: child.pid, status, signal, timedOut, overflow, groupAlive, stdoutBase64: Buffer.concat(stdout).toString('base64'), stderrBase64: Buffer.concat(stderr).toString('base64') });
  });
});
const after = await capture();
let compiler = null;
try { compiler = JSON.parse(Buffer.from(result.stdoutBase64, 'base64').toString()); } catch {}
save(output, { recordedAt: new Date().toISOString(), scope: 'One requested qualified LIVE global noEmit, distinct from archived candidate acceptance. No build, no retry and no foreign fix.', before, after, args, cwd: root, env, node: { path: process.execPath, version: process.version, sha256: sha256(await readFile(process.execPath)) }, result, compiler });
console.log(JSON.stringify({ status: result.status, diagnostics: compiler?.diagnostics.length, roots: compiler?.roots.length, reads: compiler?.reads.length, guardValid: compiler?.guardValid, headBefore: before.head, headAfter: after.head, diagnosticFiles: compiler?.diagnostics.map(row => row.file) }));
