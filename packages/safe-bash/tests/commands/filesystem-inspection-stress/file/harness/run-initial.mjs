import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const rows = [];
assert(!existsSync(join(root, 'initial-run.json')), 'Initial run must never be silently repeated');
for (let index = 1; index <= 40; index++) {
  const id = `F${String(index).padStart(2, '0')}`;
  const remaining = 600000 - (Date.now() - started);
  if (remaining <= 0) { rows.push({ id, status: 'not-run', reason: 'global 10-minute limit' }); continue; }
  assert(!existsSync(join(root, 'results', `${id}.json`)), 'Do not rerun completed product work');
  const caseStarted = new Date().toISOString();
  const result = spawnSync(process.execPath, ['--experimental-loader', join(root, 'audit-loader.mjs'), join(root, 'child.mjs'), id], {
    cwd: join(root, 'candidate'), timeout: Math.min(60000, remaining), killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', HOME: root, LC_ALL: 'C', HOLDOUT_MODULE_LOG: join(root, 'results', `${id}.modules.jsonl`) },
  });
  writeFileSync(join(root, 'results', `${id}.stdout.txt`), result.stdout ?? '');
  writeFileSync(join(root, 'results', `${id}.stderr.txt`), result.stderr ?? '');
  const row = { id, caseStarted, caseFinished: new Date().toISOString(), pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, reportExists: existsSync(join(root, 'results', `${id}.json`)) };
  rows.push(row);
  writeFileSync(join(root, 'initial-run.progress.json'), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(JSON.stringify(row));
}
writeFileSync(join(root, 'initial-run.json'), `${JSON.stringify({ startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started, maximumCases: 40, caseTimeoutMs: 60000, globalTimeoutMs: 600000, nativeCaptures: 0, rows }, null, 2)}\n`, { flag: 'wx' });
