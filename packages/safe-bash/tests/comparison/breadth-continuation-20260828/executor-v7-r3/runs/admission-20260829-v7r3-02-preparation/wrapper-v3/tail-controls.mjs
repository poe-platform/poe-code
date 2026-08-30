import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const home = path.dirname(fileURLToPath(import.meta.url));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const boundedRead = (file, limit = 262144) => { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > limit) throw Error('READ_BOUNDARY'); return fs.readFileSync(file); };
const sealBytes = boundedRead(path.join(home, 'REPAIR-SEAL.json'));
if (digest(sealBytes) !== process.argv[2]) throw Error('SEAL_HASH');
const seal = JSON.parse(sealBytes);
const authenticate = () => { for (const row of seal.inputs) { const stat = fs.lstatSync(row.path); if (!stat.isFile() || stat.size !== row.bytes || (stat.mode & 511) !== row.mode) throw Error('INPUT_METADATA'); const handle = fs.openSync(row.path, 'r'); const hash = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536); try { for (;;) { const count = fs.readSync(handle, buffer, 0, buffer.length, null); if (!count) break; hash.update(buffer.subarray(0, count)); } } finally { fs.closeSync(handle); } if (hash.digest('hex') !== row.sha256) throw Error('INPUT_HASH'); } };
authenticate();
const plan = JSON.parse(boundedRead(path.join(home, 'TAIL-PLAN.json')));
const root = path.join(home, 'tails-01');
fs.mkdirSync(root, { mode: 0o700 });
if (fs.realpathSync(root) !== root) throw Error('ROOT_REALPATH');
const started = Date.now();
const report = { schema: 'MODE_WRAPPER_TAIL_CONTROLS_V3', runnerPid: process.pid, sealSha256: process.argv[2], cases: [], children: [], unsafe: false, failure: null, actualEngines: 0, actualAdmission: 0, peakOwnedProcesses: 3 };
const persist = (name, value) => { const bytes = Buffer.from(JSON.stringify(value) + '\n'); if (bytes.length > 262144) throw Error('RECORD_BOUND'); const descriptor = fs.openSync(path.join(root, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600); try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } };
const absent = identifier => { try { process.kill(identifier, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const check = (condition, label) => { if (!condition) throw Error(label); };
const launch = async row => {
  const oldMask = process.umask(Number.parseInt(row.parentMask, 8));
  let child;
  try { child = spawn('/bin/sh', [path.join(home, 'wrappers', row.id + '.sh')], { cwd: plan.cwd, env: { PATH: '', LANG: 'C', MODE_PARENT_MARKER: 'must-not-leak' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } finally { process.umask(oldMask); }
  const receipt = { id: row.id, pid: child.pid ?? null, group: child.pid ?? null, closed: false, exitCode: null, signal: null, error: null, stdoutObserved: 0, stderrObserved: 0, stdout: [], stderr: [], timedOut: false, overflow: false };
  report.children.push(receipt);
  await new Promise(resolve => {
    let termTimer; let killTimer;
    const terminate = () => { if (receipt.closed) return; try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') receipt.error = String(error); } killTimer ??= setTimeout(() => { if (!receipt.closed) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') receipt.error = String(error); } } }, 2000); };
    child.on('error', error => { receipt.error = String(error); });
    for (const channel of ['stdout', 'stderr']) child[channel].on('data', bytes => { receipt[channel + 'Observed'] += bytes.length; const retained = receipt[channel].reduce((sum, value) => sum + value.length, 0); if (retained + bytes.length <= 65536) receipt[channel].push(bytes); else { receipt.overflow = true; receipt[channel].push(bytes.subarray(0, Math.max(0, 65536 - retained))); terminate(); } });
    child.on('close', (code, signal) => { receipt.closed = true; receipt.exitCode = code; receipt.signal = signal; clearTimeout(termTimer); clearTimeout(killTimer); resolve(); });
    termTimer = setTimeout(() => { receipt.timedOut = true; terminate(); }, 5000);
  });
  for (const channel of ['stdout', 'stderr']) { const bytes = Buffer.concat(receipt[channel]); fs.writeFileSync(path.join(root, row.id, 'wrapper-' + channel + '.raw'), bytes, { flag: 'wx', mode: 0o600 }); receipt[channel + 'Retained'] = bytes.length; receipt[channel + 'Sha256'] = digest(bytes); delete receipt[channel]; }
  receipt.pidAbsent = receipt.pid !== null && absent(receipt.pid);
  receipt.groupAbsent = receipt.group !== null && absent(-receipt.group);
  if (!receipt.closed || !receipt.pidAbsent || !receipt.groupAbsent || receipt.signal || receipt.error || receipt.timedOut || receipt.overflow || receipt.stdoutObserved !== receipt.stdoutRetained || receipt.stderrObserved !== receipt.stderrRetained) throw Error('UNSAFE_CHILD_DISPOSITION');
  return receipt;
};
try {
  for (const row of plan.cases) {
    if (Date.now() - started > 120000) throw Error('CONTROL_ELAPSED_CAP');
    const caseRoot = path.join(root, row.id); fs.mkdirSync(caseRoot, { mode: 0o700 });
    if (row.existing) fs.writeFileSync(path.join(caseRoot, row.existing), 'preserved-private-sentinel\n', { mode: 0o600, flag: 'wx' });
    const child = await launch(row);
    authenticate();
    const prepared = JSON.parse(boundedRead(path.join(caseRoot, 'PREPARE.json'), 16384));
    check(Number.isSafeInteger(prepared.pid) && prepared.pid > 0 && absent(prepared.pid), 'UNKNOWN_PREPARER_RETIREMENT');
    report.children.push({ id: row.id + '-prepare', pid: prepared.pid, parentPid: prepared.parentPid, retired: true, closureEvidence: 'parent-shell-awaited-exit-and-pid-absent' });
    let guard = null;
    if (exists(path.join(caseRoot, 'FD-GUARD.json'))) { guard = JSON.parse(boundedRead(path.join(caseRoot, 'FD-GUARD.json'), 16384)); check(Number.isSafeInteger(guard.pid) && guard.pid > 0 && absent(guard.pid), 'UNKNOWN_GUARD_RETIREMENT'); report.children.push({ id: row.id + '-fd', pid: guard.pid, parentPid: guard.parentPid, retired: true, closureEvidence: 'parent-shell-awaited-exit-and-pid-absent' }); }
    const outcome = { id: row.id, qualified: false, failure: null, observedExit: child.exitCode, prepared, guard };
    try {
      check(child.exitCode === row.exit && child.stdoutObserved === 0 && child.stderrObserved === 0, 'EXPECTED_EXIT_AND_CAPTURE');
      check(prepared.parentPid === child.pid && prepared.umask === Number.parseInt(row.mask, 8), 'PREPARER_EXEC_PARENT_MASK');
      check(prepared.captures.every(item => item.mode === 384 && item.synced && item.closed) && prepared.secondary.length === 0, 'CAPTURE_CLOSURE');
      check(Number(boundedRead(path.join(caseRoot, 'EXEC-PID.data'), 64).toString().trim()) === child.pid, 'SHELL_PID_WITNESS');
      if (row.exit === 0 || row.exit === 72) {
        check(prepared.qualified && !prepared.primaryPresent && guard?.parentPid === child.pid && guard.captures.length === 2 && guard.captures.every(item => item.mode === 384 && item.bytes === 0), 'PREOPENED_PRIVATE_CAPTURE');
        const observed = JSON.parse(boundedRead(path.join(caseRoot, 'stdout.raw'), 16384)); outcome.stub = observed;
        check(observed.pid === child.pid && observed.parentPid === process.pid && observed.cwd === plan.cwd && observed.environment.length === 1 && observed.environment[0] === '__CF_USER_TEXT_ENCODING' && observed.hostEnvironmentQualified === true && observed.umask === Number.parseInt(row.mask, 8), 'EXEC_REPLACEMENT_FINITE_ENV');
        check(observed.actualMode === (row.exit === 0 ? 420 : 384) && observed.requestedMode === 420 && observed.privateStdoutMode === 384 && observed.privateStderrMode === 384 && observed.outputDescriptorClosed, 'MODE_PROOF');
        check(boundedRead(path.join(caseRoot, 'stderr.raw'), 64).toString() === 'mode-stderr\n', 'STDERR_BYTES');
        check(boundedRead(path.join(caseRoot, 'requested-0644.data'), 64).toString() === 'mode-proof\n', 'REQUESTED_BYTES');
      } else {
        check(!prepared.qualified && prepared.primaryPresent && !guard && !exists(path.join(caseRoot, 'requested-0644.data')), 'PREPARATION_FAILURE_NO_EXEC');
        if (row.existing) { check(prepared.primaryCode === 'EEXIST' && prepared.captures.length === (row.existing === 'stdout.raw' ? 0 : 1), 'EXCLUSIVE_CAPTURE_REFUSAL'); check(boundedRead(path.join(caseRoot, row.existing), 64).toString() === 'preserved-private-sentinel\n', 'NO_OVERWRITE'); }
        else check(prepared.primaryType === (row.fault === 'false' ? 'boolean' : row.fault) && prepared.captures.length === 2, 'FALSY_PRIMARY_PRESENT');
      }
      for (const name of ['stdout.raw', 'stderr.raw']) if (exists(path.join(caseRoot, name))) check((fs.lstatSync(path.join(caseRoot, name)).mode & 511) === 384, 'PRIVATE_MODE_AFTER_CLOSE');
      outcome.qualified = true;
    } catch (error) { outcome.failure = String(error); }
    report.cases.push(outcome); persist(row.id + '.json', outcome);
  }
  authenticate();
} catch (error) { report.unsafe = true; report.failure = String(error); }
report.qualified = report.cases.filter(row => row.qualified).length;
report.failed = report.cases.filter(row => !row.qualified).length;
report.unrun = plan.cases.length - report.cases.length;
report.totalOwnedProcesses = 1 + report.children.length;
report.elapsedMilliseconds = Date.now() - started;
report.status = !report.unsafe && report.qualified === 3 && report.totalOwnedProcesses === 10 ? 'MODE_PREPARATION_QUALIFIED' : 'HOLD';
persist('REPORT.json', report);
process.stdout.write(JSON.stringify({ status: report.status, qualified: report.qualified, failed: report.failed, unrun: report.unrun, processes: report.totalOwnedProcesses, unsafe: report.unsafe }) + '\n');
process.exitCode = report.status === 'MODE_PREPARATION_QUALIFIED' ? 0 : 1;
