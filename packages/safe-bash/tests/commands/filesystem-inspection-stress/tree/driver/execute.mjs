import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const sealed = process.env.TREE_SEALED_DIR ?? '/tmp/safe-bash-tree-hidden-prep-vyzfHc';
const { cases } = await import(pathToFileURL(join(sealed, 'corpus.mjs')).href);
const candidate = process.env.TREE_CANDIDATE_DIR ?? join(directory, 'candidate');
const profile = process.env.TREE_PROFILE_PATH ?? join(directory, 'profile.json');
const raw = join(directory, 'raw');
await mkdir(raw, { mode: 0o700 });
const started = Date.now();
const cohort = [];
for (const entry of cases) {
  const remaining = 600000 - (Date.now() - started);
  if (remaining <= 0) { cohort.push({ id: entry.id, status: 'incomplete-global-deadline', productExecuted: false }); continue; }
  const caseRoot = join(raw, entry.id);
  await mkdir(caseRoot, { mode: 0o700 });
  const coverage = join(caseRoot, 'coverage');
  await mkdir(coverage, { mode: 0o700 });
  const argv = ['--import', join(candidate, 'node_modules/tsx/dist/loader.mjs'), join(sealed, 'run.mjs'), '--execute', join(directory, 'bridge.mjs'), profile, entry.id];
  const began = Date.now();
  const child = spawn(process.execPath, argv, { cwd: candidate, detached: true, env: {
    PATH: process.env.PATH, HOME: directory, TMPDIR: directory, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TERM: 'dumb',
    TREE_HOLDOUT_ROOT_RESUMED: 'AUTHOR_FINISHED', TREE_CANDIDATE_DIR: candidate,
    TREE_HOLDOUT_OBSERVATION: join(caseRoot, 'observations.json'), TSX_DISABLE_CACHE: '1', NODE_V8_COVERAGE: coverage,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  let bytes = 0;
  let killedFor;
  const kill = (reason) => {
    killedFor ??= reason;
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) kill('harness-log-ceiling');
    else chunks.push(chunk);
  });
  const watchdog = setTimeout(() => kill(remaining < 120000 ? 'global-deadline' : 'case-deadline'), Math.min(120000, remaining));
  const completion = await new Promise((accept) => {
    child.once('error', (error) => accept({ spawnError: String(error) }));
    child.once('close', (exitCode, signal) => accept({ exitCode, signal }));
  });
  clearTimeout(watchdog);
  const stdoutBytes = Buffer.concat(stdout);
  const stderrBytes = Buffer.concat(stderr);
  await writeFile(join(caseRoot, 'stdout.txt'), stdoutBytes, { flag: 'wx' });
  await writeFile(join(caseRoot, 'stderr.txt'), stderrBytes, { flag: 'wx' });
  const rows = stdoutBytes.toString().trim().split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const matched = rows.find((row) => row.id === entry.id);
  let observation;
  try { observation = JSON.parse(await readFile(join(caseRoot, 'observations.json'), 'utf8')); } catch {}
  const result = { id: entry.id, status: killedFor ? 'cancelled-by-watchdog' : matched?.status ?? 'source-or-harness-error', rawPredicate: matched,
    completion, killedFor, elapsedMs: Date.now() - began, pid: child.pid, productInvocations: observation?.invocations.length ?? 0,
    command: { executable: process.execPath, argv, cwd: candidate }, observationAvailable: observation !== undefined };
  await writeFile(join(caseRoot, 'process.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  cohort.push(result);
  console.log(JSON.stringify({ id: result.id, status: result.status, elapsedMs: result.elapsedMs, productInvocations: result.productInvocations }));
}
assert.equal(cohort.length, 38);
const totals = {};
for (const row of cohort) totals[row.status] = (totals[row.status] ?? 0) + 1;
const report = { startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
  perCaseDeadlineMs: 120000, globalDeadlineMs: 600000, sealedInternalSettlementDeadlineMs: 2000,
  intendedCases: 38, totals, productInvocations: cohort.reduce((sum, row) => sum + (row.productInvocations ?? 0), 0), cohort };
await writeFile(join(directory, 'initial-results.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ totals, productInvocations: report.productInvocations, elapsedMs: report.elapsedMs }));
