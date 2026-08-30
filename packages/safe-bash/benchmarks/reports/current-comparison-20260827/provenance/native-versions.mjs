import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 3 || process.argv[2] !== '--approved-version-only') {
  throw new Error('Only the explicit --approved-version-only operation is supported');
}
const inputs = JSON.parse(await readFile(new URL('./INPUTS.json', import.meta.url)));
const selections = [
  ['old224-mixed-Darwin', 'true'],
  ['old224-mixed-Darwin', 'bash'],
  ['old224-mixed-Darwin', 'sed'],
  ['old224-mixed-Darwin', 'grep'],
  ['file5.41-libmagic-Darwin', 'file'],
  ['tree2.2.1-Darwin', 'tree'],
];
const scratch = await mkdtemp('/tmp/safe-bash-provenance-versions-');
const environment = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
const caps = { childExecutionMs: 2500, totalChildDeadlineMs: 3000, combinedStdoutStderrBytes: 65536, concurrency: 1, maximumChildren: 6, arguments: ['--version'], stdin: 'ignore', shell: false };

function groupAbsent(pid) {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
}

for (const [profile, name] of selections) {
  const prerequisite = inputs.nativePrerequisites.find(entry => entry.profile === profile && entry.name === name);
  const result = { profile, name, path: prerequisite?.path, args: ['--version'], expectedSha256: prerequisite?.sha256, spawned: false, closed: false, signals: [], status: 'BLOCKED_PREREQUISITE' };
  results.push(result);
  try {
    const stat = await lstat(prerequisite.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 67108864 || !prerequisite.path.startsWith('/')) throw new Error('Not an allowed existing regular absolute native file');
    result.beforeSha256 = hash(await readFile(prerequisite.path));
    if (result.beforeSha256 !== prerequisite.sha256) throw new Error('Native identity mismatch');
    await new Promise(resolve => {
      const child = spawn(prerequisite.path, ['--version'], { cwd: scratch, env: environment, detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      const output = { stdout: [], stderr: [] };
      let observedBytes = 0;
      let retainedBytes = 0;
      const killGroup = reason => {
        result.failure ??= reason;
        if (!child.pid) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
          result.signals.push({ signal: 'SIGKILL', reason });
        } catch (error) {
          if (error.code !== 'ESRCH') result.cleanupError = error.code;
        }
      };
      const executionTimer = setTimeout(() => killGroup('EXECUTION_DEADLINE'), caps.childExecutionMs);
      const totalTimer = setTimeout(() => killGroup('TOTAL_CHILD_DEADLINE'), caps.totalChildDeadlineMs);
      child.on('spawn', () => { result.spawned = true; result.pid = child.pid; });
      child.on('error', error => { result.failure = error.code ?? error.message; });
      for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
        observedBytes += chunk.length;
        const keep = Math.min(chunk.length, caps.combinedStdoutStderrBytes - retainedBytes);
        if (keep > 0) { output[stream].push(chunk.subarray(0, keep)); retainedBytes += keep; }
        if (observedBytes > caps.combinedStdoutStderrBytes) killGroup('COMBINED_OUTPUT_CAP');
      });
      child.on('close', (code, signal) => {
        clearTimeout(executionTimer);
        clearTimeout(totalTimer);
        result.closed = true;
        result.exitCode = code;
        result.exitSignal = signal;
        result.observedBytes = observedBytes;
        result.retainedBytes = retainedBytes;
        result.stdoutBase64 = Buffer.concat(output.stdout).toString('base64');
        result.stderrBase64 = Buffer.concat(output.stderr).toString('base64');
        result.stdout = Buffer.concat(output.stdout).toString('utf8');
        result.stderr = Buffer.concat(output.stderr).toString('utf8');
        if (child.pid) {
          result.processGroupAbsent = groupAbsent(child.pid);
          if (!result.processGroupAbsent) { killGroup('RESIDUAL_PROCESS_GROUP'); result.processGroupAbsent = groupAbsent(child.pid); }
        }
        resolve();
      });
    });
    result.afterSha256 = hash(await readFile(prerequisite.path));
    if (!result.failure && result.exitCode === 0 && result.processGroupAbsent && result.afterSha256 === result.beforeSha256) result.status = 'VERIFIED_VERSION_ONLY';
  } catch (error) {
    result.failure = error.code ?? error.message;
  }
  if (result.status !== 'VERIFIED_VERSION_ONLY') break;
}
const receipt = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  operation: 'Only six fixed identity-gated native --version children; no oracle workloads or product engines.',
  scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  inputsSha256: hash(await readFile(new URL('./INPUTS.json', import.meta.url))),
  caps,
  environment,
  scratch,
  results,
  counts: { planned: selections.length, attempted: results.length, spawned: results.filter(entry => entry.spawned).length, closed: results.filter(entry => entry.spawned && entry.closed).length, groupsAbsent: results.filter(entry => entry.processGroupAbsent).length, timeoutOrOutputFailures: results.filter(entry => entry.failure).length, cleanupSignals: results.reduce((total, entry) => total + entry.signals.length, 0), activeManagedChildren: results.filter(entry => entry.spawned && !entry.closed).length },
  cleanupBoundary: 'Direct child close and owned process-group absence; not a universal process/thread or dynamic-library census. Empty owned scratch retained for evidence.',
  productCalls: 0,
  nativeOracleWorkloads: 0,
  timingTrials: 0,
  releaseGate: 'BLOCKED_NO_AUTHORIZED_FUTURE_CANDIDATE',
};
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
process.exitCode = results.length === selections.length && results.every(entry => entry.status === 'VERIFIED_VERSION_ONLY') ? 0 : 2;
