import { readFileSync, lstatSync, readdirSync, realpathSync, mkdirSync, openSync, closeSync, writeSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative, dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const recipe = JSON.parse(readFileSync(join(root, 'TEST-RECIPE.json')));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const started = performance.now();
const startedUtc = new Date().toISOString();
const allowedEvidence = new Set(recipe.evidenceFiles);

function requireFact(condition, detail) {
  if (!condition) throw new Error(detail);
}

function identity(file) {
  const stat = lstatSync(file);
  requireFact(stat.isFile() && !stat.isSymbolicLink(), 'REGULAR_FILE_ONLY');
  return { sha256: sha256(readFileSync(file)), bytes: stat.size, mode: stat.mode & 0o777 };
}

function guard(after = false) {
  const names = [];
  let evidenceBytes = 0;
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name);
      const rel = relative(root, file);
      const stat = lstatSync(file);
      requireFact(!stat.isSymbolicLink(), 'NO_SYMLINKS');
      if (stat.isDirectory()) {
        requireFact(after && ['evidence', 'evidence/synthetic-v1'].includes(rel), 'UNKNOWN_DIRECTORY');
        walk(file);
      } else {
        requireFact(stat.isFile(), 'NONREGULAR_ENTRY');
        if (allowedEvidence.has(rel) && after) evidenceBytes += stat.size;
        else names.push(rel);
      }
    }
  }
  walk(root);
  const expected = [...Object.keys(recipe.sourceFiles), 'TEST-RECIPE.json'].sort();
  requireFact(JSON.stringify(names.sort()) === JSON.stringify(expected), 'UNKNOWN_OR_MISSING_SOURCE_ENTRY');
  for (const [name, expectedIdentity] of Object.entries(recipe.sourceFiles)) requireFact(JSON.stringify(identity(join(root, name))) === JSON.stringify(expectedIdentity), 'SOURCE_IDENTITY:' + name);
  requireFact(evidenceBytes <= recipe.bounds.storageBytes, 'TOTAL_STORAGE_BOUND');
  requireFact(JSON.stringify(identity(recipe.node.path)) === JSON.stringify(recipe.node.identity), 'NODE_IDENTITY');
  requireFact(realpathSync(process.execPath) === recipe.node.path, 'NODE_PATH');
  return { files: names.length, evidenceBytes };
}

const recipeIdentity = identity(join(root, 'TEST-RECIPE.json'));
const before = guard();
mkdirSync(join(root, 'evidence', 'synthetic-v1'), { recursive: true });
const stdoutFile = openSync(join(root, 'evidence/synthetic-v1/stdout.bin'), 'wx', 0o644);
const stderrFile = openSync(join(root, 'evidence/synthetic-v1/stderr.bin'), 'wx', 0o644);
const launch = { schema: 1, role: 'SYNTHETIC_ONLY', startedUtc, recipeIdentity, before, executable: recipe.node, argv: [join(root, 'synthetic-checks.mjs')], cwd: root, env: recipe.environment, bounds: recipe.bounds, noTargetGo: true };
writeFileSync(join(root, 'evidence/synthetic-v1/launch.json'), JSON.stringify(launch, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
let child;
let stdoutBytes = 0;
let stderrBytes = 0;
let overflow = false;
let timedOut = false;
let spawnFailure = null;
let captureFailure = null;
let childClosed = false;
const terminate = () => { if (child && !childClosed) child.kill('SIGKILL'); };
const remaining = recipe.bounds.wallMs - (performance.now() - started);
requireFact(remaining > recipe.bounds.cleanupReserveMs, 'BUDGET_EXHAUSTED_BEFORE_SPAWN');
const timeout = setTimeout(() => { timedOut = true; terminate(); }, remaining - recipe.bounds.cleanupReserveMs);
const hardStop = setTimeout(() => { terminate(); console.error('UNSAFE_REAP_DEADLINE'); process.exit(1); }, remaining);
child = spawn(recipe.node.path, [join(root, 'synthetic-checks.mjs')], { cwd: root, env: recipe.environment, stdio: ['ignore', 'pipe', 'pipe'] });
child.on('error', error => { spawnFailure = { name: error.name, message: error.message }; });
for (const [stream, descriptor, limit] of [[child.stdout, stdoutFile, recipe.bounds.stdoutBytes], [child.stderr, stderrFile, recipe.bounds.stderrBytes]]) {
  stream.on('data', bytes => {
    const current = descriptor === stdoutFile ? stdoutBytes : stderrBytes;
    if (descriptor === stdoutFile) stdoutBytes += bytes.length; else stderrBytes += bytes.length;
    if (current + bytes.length > limit) { overflow = true; terminate(); return; }
    try {
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
    } catch (error) { captureFailure = { name: error.name, message: error.message }; terminate(); }
  });
}
const outcome = await new Promise(resolve => child.on('close', (code, signal) => { childClosed = true; resolve({ code, signal }); }));
clearTimeout(timeout);
clearTimeout(hardStop);
closeSync(stdoutFile);
closeSync(stderrFile);
const raw = { schema: 1, ...outcome, stdoutBytes, stderrBytes, overflow, timedOut, spawnFailure, captureFailure, childClosed, elapsedMs: performance.now() - started, rawBeforeAssert: true, overflowPolicy: 'FAIL_AND_KILL; no passing truncated-capture claim', descendants: 0, activeOwnedChildren: 0 };
writeFileSync(join(root, 'evidence/synthetic-v1/child-raw.json'), JSON.stringify(raw, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
let after;
let integrityFailure = null;
try {
  after = guard(true);
  requireFact(JSON.stringify(identity(join(root, 'TEST-RECIPE.json'))) === JSON.stringify(recipeIdentity), 'RECIPE_CHANGED');
} catch (error) { integrityFailure = { name: error.name, message: error.message }; }
const failed = outcome.code !== 0 || outcome.signal !== null || overflow || timedOut || spawnFailure !== null || captureFailure !== null || integrityFailure !== null || performance.now() - started > recipe.bounds.wallMs;
const result = { schema: 1, status: failed ? 'FAIL' : 'SYNTHETIC_PROCESS_AND_INTEGRITY_MATCH', raw, after: after ?? null, integrityFailure, targetExecutions: 0, acceptance: false, peakOwnedProcessesIncludingSupervisor: 2, activeOwnedChildren: 0 };
writeFileSync(join(root, 'evidence/synthetic-v1/supervisor.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
console.log(JSON.stringify(result));
if (failed) process.exitCode = 1;
