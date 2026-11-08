import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const candidate = '/tmp/safe-bash-tree-initial-run-NN3E3X/candidate';
assert.equal(process.env.TREE_N18_CORRECTION_AUTHORIZED, 'ROOT_ONE_INVOCATION', 'Explicit single-case root authorization required');
const declaration = JSON.parse(await readFile(join(directory, 'derivation.json'), 'utf8'));
for (const [name, digest] of Object.entries(declaration.files)) assert.equal(createHash('sha256').update(await readFile(join(directory, name))).digest('hex'), digest, name);
await writeFile(join(directory, 'single-invocation.lock'), 'N18 only; do not rerun this correction cohort.\n', { flag: 'wx', mode: 0o600 });
const raw = join(directory, 'raw/N18');
await mkdir(join(raw, 'coverage'), { recursive: true, mode: 0o700 });
const argv = ['--import', join(candidate, 'node_modules/tsx/dist/loader.mjs'), join(directory, 'derived/run.mjs'), '--execute', join(directory, 'bridge.mjs'), join(directory, 'profile.json'), 'N18'];
const startedAt = new Date().toISOString();
const began = Date.now();
const child = spawn(process.execPath, argv, { cwd: candidate, detached: true, env: {
  PATH: process.env.PATH, HOME: directory, TMPDIR: directory, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TERM: 'dumb',
  TREE_HOLDOUT_ROOT_RESUMED: 'AUTHOR_FINISHED', TREE_CANDIDATE_DIR: candidate,
  TREE_HOLDOUT_OBSERVATION: join(raw, 'observations.json'), TSX_DISABLE_CACHE: '1', NODE_V8_COVERAGE: join(raw, 'coverage'),
}, stdio: ['ignore', 'pipe', 'pipe'] });
const stdout = [];
const stderr = [];
let totalBytes = 0;
let killedFor;
const kill = (reason) => {
  killedFor ??= reason;
  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
};
for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', (chunk) => {
  totalBytes += chunk.length;
  if (totalBytes > 1024 * 1024) kill('log-ceiling');
  else chunks.push(chunk);
});
const watchdog = setTimeout(() => kill('120-second-deadline'), 120000);
const completion = await new Promise((accept) => {
  child.once('error', (error) => accept({ spawnError: String(error) }));
  child.once('close', (exitCode, signal) => accept({ exitCode, signal }));
});
clearTimeout(watchdog);
const output = Buffer.concat(stdout);
await writeFile(join(raw, 'stdout.txt'), output, { flag: 'wx' });
await writeFile(join(raw, 'stderr.txt'), Buffer.concat(stderr), { flag: 'wx' });
let observations;
try { observations = JSON.parse(await readFile(join(raw, 'observations.json'), 'utf8')); } catch {}
const rows = output.toString().trim().split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const record = { selectedCase: 'N18', startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - began, node: process.version,
  pid: child.pid, completion, killedFor, processDeadlineMs: 120000, unchangedSealedSettlementGuardMs: 2000,
  executable: process.execPath, argv, cwd: candidate, rawPredicate: rows.find((row) => row.id === 'N18'),
  productInvocations: observations?.invocations.length ?? 0, otherSelectionsExecuted: 0, nativeInvocations: 0, activeOwnedChildren: 0 };
await writeFile(join(directory, 'corrected-result.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(record));
assert.equal(record.productInvocations, 1, 'authorized single tree invocation');
assert.equal(record.completion.signal, null);
assert.equal(record.killedFor, undefined);
assert.equal(record.rawPredicate?.id, 'N18');
