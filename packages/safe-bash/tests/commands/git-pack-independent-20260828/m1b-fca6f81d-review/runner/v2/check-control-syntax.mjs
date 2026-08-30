import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const origin = performance.now();
const root = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(fs.readFileSync(path.join(root, 'CONTROL-SYNTAX-PRESEAL.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const output = path.join(root, 'control-syntax-evidence');
fs.mkdirSync(output, { mode: 0o700 });
const results = [];
let captureBytes = 0;
let failed = false;
let starts = 0;
function raw(name, bytes) {
  if (captureBytes + bytes.length > plan.captureBytes) throw new Error('PREPARATION_CAPTURE_LIMIT');
  captureBytes += bytes.length;
  fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx', mode: 0o600 });
}
function checkFile(row) {
  const filename = row.path.startsWith('/') ? row.path : path.join(root, row.path);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== row.mode || stat.size !== row.bytes || digest(fs.readFileSync(filename)) !== row.sha256) throw new Error(`PREPARATION_INTEGRITY:${row.path}`);
}
try {
  checkFile(plan.node);
  for (const row of plan.files) checkFile(row);
  for (const row of plan.files) {
    if (!row.path.endsWith('.mjs')) continue;
    const remaining = plan.wallMs - (performance.now() - origin) - plan.finalizeMs;
    if (remaining <= 0 || ++starts > plan.maxChildren) throw new Error('PREPARATION_ADMISSION');
    const result = spawnSync(plan.node.path, ['--check', path.join(root, row.path)], { cwd: root, env: { PATH: '', LANG: 'C', LC_ALL: 'C', NODE_OPTIONS: '' }, timeout: Math.min(10000, remaining), killSignal: 'SIGKILL', maxBuffer: 131072 });
    raw(`${starts}.stdout.bin`, result.stdout ?? Buffer.alloc(0));
    raw(`${starts}.stderr.bin`, result.stderr ?? Buffer.alloc(0));
    const receipt = { file: row.path, pid: result.pid ?? null, status: result.status, signal: result.signal, error: result.error?.code ?? null, elapsedMs: performance.now() - origin, role: 'SYNTAX_ONLY_NO_IMPORT_EVALUATION' };
    raw(`${starts}.process.json`, Buffer.from(JSON.stringify(receipt) + '\n'));
    results.push(receipt);
    checkFile(row);
    checkFile(plan.node);
    if (result.status !== 0 || result.signal !== null || result.error) { failed = true; break; }
  }
  for (const row of plan.files) checkFile(row);
} catch (error) {
  failed = true;
  raw('failure.txt', Buffer.from(String(error) + '\n'));
} finally {
  const elapsedMs = performance.now() - origin;
  if (elapsedMs > plan.wallMs) failed = true;
  raw('RESULT.json', Buffer.from(JSON.stringify({ status: failed ? 'FAIL' : 'SYNTAX_ONLY_COMPLETE', starts, peakOwnedChildren: 1, elapsedMs, captureBytesBeforeResult: captureBytes, results, candidateImports: 0, activeChildren: 0 }) + '\n'));
  process.exitCode = failed ? 1 : 0;
}
