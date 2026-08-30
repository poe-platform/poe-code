import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = process.hrtime.bigint();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const demand = (condition, label) => { if (!condition) throw new Error(label); };
const [flag, expectedSeal, outputFlag, output] = process.argv.slice(2);
demand(flag === '--preseal-sha256' && /^[a-f0-9]{64}$/u.test(expectedSeal) && outputFlag === '--evidence' && typeof output === 'string', 'EXPLICIT_SYNTHETIC_AUTHORITY');
const prepared = dirname(fileURLToPath(import.meta.url));
const sealPath = join(prepared, '..', 'SYNTHETIC-PRESEAL.json');
const sealBytes = readFileSync(sealPath);
demand(digest(sealBytes) === expectedSeal, 'PRESEAL_HASH');
const seal = JSON.parse(sealBytes);
demand(seal.purpose === 'CORE_HELPERS_SYNTHETIC_ONLY' && seal.targetExecution === false, 'SYNTHETIC_ROLE');
demand(resolve(output) === output && dirname(output) === '/private/tmp' && /^yq-coverage-core-stubs-[A-Za-z0-9-]+$/u.test(output.split('/').at(-1)), 'OWNED_OUTPUT_PATH');
demand(process.execPath === seal.node.path && process.execArgv.length === 0 && !Object.hasOwn(process.env, 'NODE_OPTIONS') && !Object.hasOwn(process.env, 'NODE_PATH'), 'SYNTHETIC_NODE');
const snapshot = root => {
  const files = {}, directories = {};
  let total = 0;
  let entries = 0;
  const walk = relative => {
    demand(++entries <= 4096, 'SNAPSHOT_ENTRIES');
    const filename = join(root, relative);
    const stat = lstatSync(filename);
    demand(!stat.isSymbolicLink(), 'SNAPSHOT_SYMLINK');
    if (stat.isDirectory()) { directories[relative] = stat.mode & 4095; for (const name of readdirSync(filename).sort()) walk(relative ? `${relative}/${name}` : name); }
    else { demand(stat.isFile() && stat.nlink === 1 && stat.size <= 134217728 && (total += stat.size) <= 268435456, 'SNAPSHOT_FILE'); files[relative] = { sha256: digest(readFileSync(filename)), bytes: stat.size, mode: stat.mode & 4095 }; }
  };
  walk('');
  return { files, directories, total };
};
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fileCheck = entry => { const stat = lstatSync(entry.path); demand(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size === entry.bytes && (stat.mode & 4095) === entry.mode && digest(readFileSync(entry.path)) === entry.sha256, 'BOUND_FILE'); };
const guard = () => { const actual = snapshot(prepared); demand(equal(actual.files, seal.prepared.files) && equal(actual.directories, seal.prepared.directories), 'PREPARED_INTEGRITY'); for (const entry of seal.inputs) fileCheck(entry); fileCheck(seal.node); demand(digest(readFileSync(sealPath)) === expectedSeal, 'PRESEAL_CHANGED'); };
guard();
demand(realpathSync('/private/tmp') === '/private/tmp', 'EVIDENCE_PARENT');
process.umask(0o022);
mkdirSync(output, { mode: 0o755 });
const scratch = join(output, 'scratch');
mkdirSync(scratch, { mode: 0o755 });
const stdoutPath = join(output, 'stdout.bin'), stderrPath = join(output, 'stderr.bin');
const stdoutFd = openSync(stdoutPath, 'wx', 0o600), stderrFd = openSync(stderrPath, 'wx', 0o600);
let stdoutBytes = 0, stderrBytes = 0, overflow = false, timedOut = false, spawnError = null, closeReceipt = null;
let child;
const globalDeadline = origin + BigInt(seal.bounds.globalMs) * 1000000n;
const childDeadline = process.hrtime.bigint() + BigInt(seal.bounds.childMs) * 1000000n;
const deadline = childDeadline < globalDeadline ? childDeadline : globalDeadline;
const signalOwned = signal => { if (child?.pid) { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } } };
const capture = (fd, bytes, stream) => {
  const used = stream === 'stdout' ? stdoutBytes : stderrBytes;
  const allowed = Math.max(0, Math.min(bytes.length, seal.bounds.streamBytes - used));
  let written = 0;
  while (written < allowed) written += writeSync(fd, bytes, written, allowed - written);
  if (stream === 'stdout') stdoutBytes += written; else stderrBytes += written;
  if (allowed !== bytes.length) { overflow = true; signalOwned('SIGTERM'); }
};
child = spawn(seal.node.path, [join(prepared, 'synthetic-child.mjs'), scratch], { cwd: scratch, env: { LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
child.stdout.on('data', bytes => capture(stdoutFd, bytes, 'stdout'));
child.stderr.on('data', bytes => capture(stderrFd, bytes, 'stderr'));
child.on('error', error => { spawnError = { name: error.name, message: error.message, code: error.code ?? null }; });
const closed = new Promise(resolveClose => child.on('close', (code, signal) => { closeReceipt = { code, signal }; resolveClose(true); }));
let termSent = false, killSent = false;
const clock = setInterval(() => {
  const now = process.hrtime.bigint();
  if (now >= deadline - BigInt(seal.bounds.cleanupMs) * 1000000n) { timedOut = true; if (!termSent) { termSent = true; signalOwned('SIGTERM'); } }
  if (now >= deadline - 1000000000n && !killSent) { killSent = true; signalOwned('SIGKILL'); }
}, 10);
let barrier;
const completed = await Promise.race([closed, new Promise(resolveBarrier => { barrier = setTimeout(() => resolveBarrier(false), Math.max(0, Number((deadline - process.hrtime.bigint()) / 1000000n))); })]);
clearInterval(clock); clearTimeout(barrier);
if (!completed) { timedOut = true; signalOwned('SIGKILL'); child.stdout.removeAllListeners('data'); child.stderr.removeAllListeners('data'); child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
closeSync(stdoutFd); closeSync(stderrFd);
let knownReap = completed;
if (child.pid) { try { process.kill(-child.pid, 0); knownReap = false; } catch (error) { if (error.code !== 'ESRCH') knownReap = false; } }
let integrity = true;
try { guard(); } catch { integrity = false; }
const raw = { stdout: { path: stdoutPath, bytes: stdoutBytes, sha256: digest(readFileSync(stdoutPath)) }, stderr: { path: stderrPath, bytes: stderrBytes, sha256: digest(readFileSync(stderrPath)) } };
const processRecord = { jobId: 'source-contract-stubs', pid: child.pid ?? null, closeReceipt, spawnError, timedOut, overflow, knownReap, integrity, raw, originNs: origin.toString(), deadlineNs: deadline.toString(), endedNs: process.hrtime.bigint().toString() };
writeFileSync(join(output, 'process.json'), JSON.stringify(processRecord) + '\n', { flag: 'wx', mode: 0o600 });
let receipt = null, receiptValid = false;
try { receipt = JSON.parse(readFileSync(stdoutPath, 'utf8')); receiptValid = receipt.schema === 1 && receipt.jobId === 'source-contract-stubs' && receipt.status === 'PASS_SYNTHETIC_ONLY' && Array.isArray(receipt.results) && equal(receipt.results.map(row => row.id), seal.caseIds) && receipt.results.every(row => row.status === 'PASS_SYNTHETIC_ONLY') && receipt.targetImports === 0 && receipt.semanticPasses === 0; } catch {}
const beforeReport = snapshot(output);
const failed = !completed || !knownReap || !integrity || spawnError !== null || closeReceipt?.code !== 0 || closeReceipt?.signal !== null || timedOut || overflow || stderrBytes !== 0 || !receiptValid || beforeReport.total > seal.bounds.storageBytes - 65536 || process.hrtime.bigint() >= globalDeadline;
const report = { schema: 1, status: failed ? 'FAIL' : 'PASS_COMPONENT_STUB_CHECKS_ONLY', presealSha256: expectedSeal, process: processRecord, receipt, receiptValid, storageBytesBeforeReport: beforeReport.total, targetExecutions: 0, productPasses: 0, noFurtherAdmissionsUnlessIntegrityAndKnownReap: true, activeOwnedChildren: knownReap ? [] : [child.pid] };
writeFileSync(join(output, 'RESULT.json'), JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 });
const finalStorage = snapshot(output).total;
process.stdout.write(JSON.stringify({ status: finalStorage <= seal.bounds.storageBytes ? report.status : 'FAIL_STORAGE', evidenceRoot: output, activeOwnedChildren: report.activeOwnedChildren, finalStorageBytes: finalStorage }) + '\n');
process.exitCode = failed || finalStorage > seal.bounds.storageBytes ? 1 : 0;
