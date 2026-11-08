import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function bindChild(context) {
  const { assert, spawn, remaining, control, evidence, limits, sha, errorData, created, write } = context;
  let activeChild;
  let childCount = 0;
async function child(executable, args, options) {
  remaining(); assert.ok(!activeChild); assert.ok(++childCount <= control.maximumSpawnedChildren, 'CHILD_BOUND');
  const row = { number: childCount, role: options.role, executable, args, cwd: options.cwd, stdoutBytes: 0, stderrBytes: 0, containment: null, naturallyReaped: false };
  evidence.children.push(row);
  const stdout = [], stderr = [];
  let grace, forced, deadline;
  const result = await new Promise((resolve, reject) => {
    const processChild = spawn(executable, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChild = processChild; row.pid = processChild.pid;
    const contain = reason => {
      if (row.containment) return;
      row.containment = reason; processChild.kill('SIGTERM');
      grace = setTimeout(() => {
        processChild.kill('SIGKILL');
        forced = setTimeout(() => { processChild.stdout.destroy(); processChild.stderr.destroy(); processChild.unref(); reject(new Error('DIRECT_CHILD_NOT_REAPED')); }, limits.containmentGraceMs);
      }, limits.containmentGraceMs);
    };
    deadline = setTimeout(() => contain('DEADLINE'), Math.min(options.timeoutMs, remaining()));
    processChild.on('error', error => { row.spawnError = errorData(error); });
    processChild.stdout.on('data', chunk => { row.stdoutBytes += chunk.length; if (row.stdoutBytes > limits.stdoutBytesPerChild) contain('STDOUT_BOUND'); else stdout.push(Buffer.from(chunk)); });
    processChild.stderr.on('data', chunk => { row.stderrBytes += chunk.length; if (row.stderrBytes > limits.stderrBytesPerChild) contain('STDERR_BOUND'); else stderr.push(Buffer.from(chunk)); });
    processChild.once('close', (status, signal) => {
      row.status = status; row.signal = signal; row.naturallyReaped = !row.spawnError && !row.containment && signal === null;
      row.closeObserved = true; resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  }).finally(() => { clearTimeout(deadline); clearTimeout(grace); clearTimeout(forced); if (row.closeObserved) activeChild = undefined; });
  row.stdoutSha256 = sha(result.stdout); row.stderrSha256 = sha(result.stderr);
  if (created && options.role !== 'git-read') { write('logs/' + options.label + '.stdout', result.stdout, 0o600); write('logs/' + options.label + '.stderr', result.stderr, 0o600); }
  assert.ok(row.naturallyReaped, 'CHILD_CONTAINMENT_OR_SPAWN');
  return { ...result, row };
}
  return { child, active: () => activeChild };
}
export function assessReceipt({ result, label, output, readLimited, limits }) {
    const receiptBytes = readLimited(output,limits.receiptBytesPerChild); const receipt = JSON.parse(receiptBytes);
    const terminal = JSON.parse(result.stdout.toString());
    assert.ok(result.stdout.equals(Buffer.from(JSON.stringify(terminal) + '\n'))); assert.equal(result.stderr.length,0);
    assert.equal(terminal.label,label); assert.equal(terminal.receiptSha256,sha(receiptBytes)); assert.equal(terminal.classification,receipt.classification);
    assert.equal(receipt.label,label); assert.equal(receipt.clean,true); assert.equal(receipt.unhandled.length,0);
    assert.ok(['PASS','ASSERTION_FAILURE_CLEAN'].includes(receipt.classification));
    assert.equal(result.row.status,receipt.classification === 'PASS' ? 0 : 1);
    assert.equal(receipt.counters.engineEntered,1); assert.equal(receipt.counters.engineSettled,1);
  return true;
}
