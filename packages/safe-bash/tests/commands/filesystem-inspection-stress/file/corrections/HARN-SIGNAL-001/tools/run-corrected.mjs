import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const selected = ['F29', 'F33', 'F34'];
const started = Date.now();
const rows = [];
assert(!existsSync(join(root, 'corrected-run.json')), 'No automatic correction-case retry');
for (const id of selected) {
  assert(!existsSync(join(root, 'results', `${id}.events.jsonl`)), 'Never duplicate an attempted case');
  const caseStarted = new Date().toISOString();
  const result = spawnSync(process.execPath, ['--experimental-loader', join(root, 'audit-loader.mjs'), join(root, 'child.mjs'), id], {
    cwd: root, timeout: Math.min(60000, 600000 - (Date.now() - started)), killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', HOME: root, LC_ALL: 'C', HOLDOUT_MODULE_LOG: join(root, 'results', `${id}.modules.jsonl`) },
  });
  writeFileSync(join(root, 'results', `${id}.stdout.txt`), result.stdout ?? '');
  writeFileSync(join(root, 'results', `${id}.stderr.txt`), result.stderr ?? '');
  const reportExists = existsSync(join(root, 'results', `${id}.json`));
  const report = reportExists ? JSON.parse(readFileSync(join(root, 'results', `${id}.json`))).reports[0] : null;
  const row = { id, caseStarted, caseFinished: new Date().toISOString(), pid: result.pid, childStatus: result.status, signal: result.signal, error: result.error?.message ?? null, reportExists, semanticStatus: report?.semanticStatus ?? 'not-run', nativeStatus: report?.nativeStatus ?? 'not-run' };
  rows.push(row);
  writeFileSync(join(root, 'corrected-run.progress.json'), `${JSON.stringify(rows, null, 2)}\n`);
  if (row.childStatus !== 0 || row.semanticStatus !== 'pass') {
    appendFileSync('/tmp/safe-bash-file-harness-correction-failures.txt', `${JSON.stringify({ route: 'ROOT: new corrected-case failure; no retries or author fixes authorized', candidate: 'd168d18b118592e04a6eec9b00eb50cc2b1e5058', row, rawReport: report }, null, 2)}\n`);
  }
  console.log(JSON.stringify(row));
}
writeFileSync(join(root, 'corrected-run.json'), `${JSON.stringify({ startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started, selected, perCaseTimeoutMs: 60000, globalTimeoutMs: 600000, nativeCalls: 0, full40Reruns: 0, childRetries: 0, rows }, null, 2)}\n`, { flag: 'wx' });
