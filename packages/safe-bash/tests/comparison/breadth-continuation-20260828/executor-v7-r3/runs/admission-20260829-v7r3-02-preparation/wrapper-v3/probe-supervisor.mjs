import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const home = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(home, 'probe-01');
const started = Date.now();
const receipt = { schema: 'ONE_ENV_PROBE_SUPERVISION_V1', pid: process.pid, child: null, helpers: [], primaryPresent: false, primary: null, secondary: [], qualified: false, stdoutObserved: 0, stderrObserved: 0, stdoutRetained: 0, stderrRetained: 0, closed: false };
const descriptors = [];
let child;
const recordFailure = error => { const text = String(error).slice(0, 1024); if (!receipt.primaryPresent) { receipt.primaryPresent = true; receipt.primary = text; } else receipt.secondary.push(text); };
const read = (file, limit = 262144) => { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > limit) throw Error('READ_BOUND'); return fs.readFileSync(file); };
const absent = identifier => { try { process.kill(identifier, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
let seal;
const authenticate = () => { for (const expected of seal.inputs) { const stat = fs.lstatSync(expected.path); if (!stat.isFile() || stat.size !== expected.bytes || (stat.mode & 511) !== expected.mode) throw Error('INPUT_METADATA'); const handle = fs.openSync(expected.path, 'r'); const hash = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536); try { for (;;) { const count = fs.readSync(handle, buffer, 0, buffer.length, null); if (!count) break; hash.update(buffer.subarray(0, count)); } } finally { fs.closeSync(handle); } if (hash.digest('hex') !== expected.sha256) throw Error('INPUT_HASH'); } };
try {
  fs.mkdirSync(root, { mode: 0o700 });
  if (fs.realpathSync(root) !== root) throw Error('ROOT_REALPATH');
  for (const name of ['startup.stdout.raw', 'startup.stderr.raw']) { const descriptor = fs.openSync(path.join(root, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); descriptors.push(descriptor); if ((fs.fstatSync(descriptor).mode & 511) !== 384) throw Error('STARTUP_CAPTURE_MODE'); }
  const sealBytes = read(path.join(home, 'PROBE-SEAL.json')); if (crypto.createHash('sha256').update(sealBytes).digest('hex') !== process.argv[2]) throw Error('PROBE_SEAL_HASH'); seal = JSON.parse(sealBytes); authenticate();
  fs.mkdirSync(path.join(root, 'fixture'), { mode: 0o700 });
  const oldMask = process.umask(0o077);
  try { child = spawn('/bin/sh', [path.join(home, 'probe-wrapper.sh')], { cwd: seal.cwd, env: { PATH: '', LANG: 'C', MODE_PARENT_MARKER: 'must-not-leak' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } finally { process.umask(oldMask); }
  receipt.child = { pid: child.pid ?? null, group: child.pid ?? null, exited: false, closed: false, code: null, signal: null };
  await new Promise(resolve => {
    let deadline; let killTimer;
    const stop = () => { if (receipt.child.closed) return; try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') recordFailure(error); } killTimer ??= setTimeout(() => { if (!receipt.child.closed) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') recordFailure(error); } } }, 2000); };
    child.on('error', error => recordFailure(error));
    child.on('exit', (code, signal) => Object.assign(receipt.child, { exited: true, code, signal }));
    for (const [index, name] of ['stdout', 'stderr'].entries()) child[name].on('data', bytes => { receipt[name + 'Observed'] += bytes.length; const allowed = Math.max(0, 65536 - receipt[name + 'Retained']); const part = bytes.subarray(0, allowed); try { let offset = 0; while (offset < part.length) { const count = fs.writeSync(descriptors[index], part, offset, part.length - offset); if (count <= 0) throw Error('SHORT_WRITE'); offset += count; receipt[name + 'Retained'] += count; } } catch (error) { recordFailure(error); stop(); } if (part.length !== bytes.length) { recordFailure(Error('CAPTURE_OVERFLOW')); stop(); } });
    child.on('close', (code, signal) => { Object.assign(receipt.child, { closed: true, closeCode: code, closeSignal: signal }); clearTimeout(deadline); clearTimeout(killTimer); resolve(); });
    deadline = setTimeout(() => { recordFailure(Error('PROBE_DEADLINE')); stop(); }, 5000);
  });
  receipt.child.pidAbsent = child.pid !== undefined && absent(child.pid); receipt.child.groupAbsent = child.pid !== undefined && absent(-child.pid);
  if (!receipt.child.exited || !receipt.child.closed || !receipt.child.pidAbsent || !receipt.child.groupAbsent || receipt.child.signal || receipt.child.code !== receipt.child.closeCode) throw Error('UNKNOWN_RETIREMENT');
  for (const name of ['PREPARE.json', 'FD-GUARD.json']) { const value = JSON.parse(read(path.join(root, 'fixture', name), 16384)); if (!Number.isSafeInteger(value.pid) || !absent(value.pid) || value.parentPid !== child.pid) throw Error('HELPER_RETIREMENT'); receipt.helpers.push({ name, pid: value.pid, parentPid: value.parentPid, absent: true, receipt: value }); }
  receipt.observation = JSON.parse(read(path.join(root, 'fixture', 'stdout.raw'), 16384));
  receipt.probeStderrBytes = read(path.join(root, 'fixture', 'stderr.raw'), 65536).length;
  if (receipt.child.code !== 0 || !receipt.observation.qualified || receipt.observation.pid !== child.pid || receipt.observation.parentPid !== process.pid || receipt.probeStderrBytes !== 0 || receipt.stdoutObserved !== 0 || receipt.stderrObserved !== 0) throw Error('PROBE_PROFILE_REFUSAL');
  authenticate();
} catch (error) { recordFailure(error); }
finally {
  for (const descriptor of descriptors) { try { fs.fsyncSync(descriptor); } catch (error) { recordFailure(error); } try { fs.closeSync(descriptor); } catch (error) { recordFailure(error); } }
  receipt.closed = true;
}
receipt.elapsedMilliseconds = Date.now() - started;
receipt.qualified = !receipt.primaryPresent && receipt.stdoutObserved === receipt.stdoutRetained && receipt.stderrObserved === receipt.stderrRetained && receipt.child?.closed === true;
const bytes = Buffer.from(JSON.stringify(receipt) + '\n'); if (bytes.length > 262144) throw Error('RECEIPT_CAP');
const handle = fs.openSync(path.join(root, 'RECEIPT.json'), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600); try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
process.stdout.write(JSON.stringify({ qualified: receipt.qualified, primary: receipt.primary, observation: receipt.observation ?? null, childRetired: receipt.child?.pidAbsent && receipt.child?.groupAbsent, helpers: receipt.helpers.length }) + '\n');
process.exitCode = receipt.qualified ? 0 : 1;
