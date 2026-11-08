import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const directory = path.resolve('tests/compatibility/bash-ere-core-public-pilot-preparation-20260829/runtime-author-v1/r2/final-binding-v2');
const now = () => Number(process.hrtime.bigint() / 1000000n);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (file, cap = 4 * 1024 * 1024) => { const stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap); const bytes = fs.readFileSync(file); assert.equal(bytes.length, stat.size); return bytes; };
const failure = { present: false, primary: null, secondary: [], omitted: 0 };
const describe = value => { if (value === undefined) return { type: 'undefined' }; if (value === null) return { type: 'null' }; if (['string', 'boolean', 'number'].includes(typeof value)) return { type: typeof value, value: typeof value === 'string' ? value.slice(0, 4096) : value }; const descriptors = Object.getOwnPropertyDescriptors(value); return { type: typeof value, message: typeof descriptors.message?.value === 'string' ? descriptors.message.value.slice(0, 4096) : null, stack: typeof descriptors.stack?.value === 'string' ? descriptors.stack.value.slice(0, 8192) : null }; };
const remember = (reason, phase) => { const row = { phase, reason: describe(reason) }; if (!failure.present) { failure.present = true; failure.primary = row; } else if (failure.secondary.length < 32) failure.secondary.push(row); else failure.omitted++; };
const receipt = { schema: 1, startedUtc: new Date().toISOString(), startedMonotonic: now(), outerStarted: 267531292, ownerPid: process.pid, parentPid: process.ppid, attemptConsumed: true, status: 'ADMISSION', coordinatorLaunched: false, coordinator: { pid: null, exit: false, close: false, stdoutEOF: false, stderrEOF: false, retired: false, code: null, signal: null }, captured: { stdout: 0, stderr: 0 }, signals: [], failure, commandSha256: '47a843889d997ee006b3f66c03015eb88bc477cee98ad1accb1d47e36851e721', grantSha256: '1bef3edb200f9a67c7c27260d33ff850e0d1f85fff0f80022cda2636c6ac3adf', sourcePostguard: false, noRetry: true };
const descriptors = [];
const timers = [];
let child;
let profile;
let stopped = false;
const retained = [];
const signal = name => { if (child && !receipt.coordinator.exit) { try { receipt.signals.push({ name, monotonic: now() }); child.kill(name); } catch (reason) { remember(reason, `outer-${name}`); } } };
const bind = row => { const stat = fs.lstatSync(row.path); assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.size); if (row.mode !== undefined) assert.equal(stat.mode & 0o777, row.mode); const descriptor = fs.openSync(row.path, 'r'); const digest = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536); try { const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, stat.ino); assert.equal(opened.dev, stat.dev); let count; while ((count = fs.readSync(descriptor, buffer))) digest.update(buffer.subarray(0, count)); } finally { fs.closeSync(descriptor); } assert.equal(digest.digest('hex'), row.sha256, row.path); };
try {
  fs.writeFileSync(path.join(directory, 'ATTEMPT.json'), JSON.stringify({ startedUtc: receipt.startedUtc, ownerPid: process.pid, outerStarted: 267531292, consumed: true, noRetry: true }) + '\n', { flag: 'wx', mode: 0o600 });
  const grantBytes = read(path.join(directory, 'PENDING-GRANT.json'), 667); assert.equal(grantBytes.length, 667); assert.equal(hash(grantBytes), receipt.grantSha256);
  const grant = JSON.parse(grantBytes); assert.equal(Object.keys(grant).length, 18); assert.equal(grant.outerStarted, 267531292); assert.equal(grant.authorized, true);
  const checkTime = () => { const wall = Date.now(); assert(wall >= Date.parse(grant.issuedAt) && wall <= Date.parse(grant.latestStart) && wall < Date.parse(grant.expiresAt), 'ROOT wall start window closed'); assert(now() + 180000 < grant.outerStarted + 1200000, 'publication reservation no longer fits'); };
  checkTime();
  const commandPath = path.join(directory, 'RESOLVED-COMMAND.txt'); const commandBytes = read(commandPath, 995); assert.equal(commandBytes.length, 995); assert.equal(hash(commandBytes), receipt.commandSha256);
  const launch = JSON.parse(read(path.join(directory, 'RESOLVED-LAUNCH.json'), 16384));
  const profileBytes = read(launch.argv[1]); assert.equal(hash(profileBytes), 'bacc21fb126bb6e0b5441bee560cb0bad1f7ffda01d129b996c1cdd3e6312e05'); profile = JSON.parse(profileBytes);
  const review = read(path.resolve('tests/compatibility/bash-ere-core-public-pilot-independent-20260829/runtime-review-r2/RESULT.json')); assert.equal(hash(review), 'f5499bbffd18ef06483b26c256bd989d2124abe0fa8afb261d00aa7936becd7b');
  const binding = JSON.parse(read(path.join(directory, 'BINDING-RECEIPT.json')));
  for (const filename of binding.unusedSlots) assert(!fs.existsSync(filename), `occupied slot ${filename}`);
  for (const row of profile.assets) bind(row);
  for (const row of profile.tools) bind(row);
  bind(profile.archive);
  for (const layout of profile.layouts) {
    const names = [];
    const walk = folder => { for (const name of fs.readdirSync(folder)) { const filename = path.join(folder, name); const stat = fs.lstatSync(filename); assert(!stat.isSymbolicLink()); if (stat.isDirectory()) walk(filename); else { assert(stat.isFile()); names.push(path.relative(layout.source, filename)); } } };
    walk(layout.source); assert.deepEqual(names.sort(), layout.shipping.map(row => row.path).sort());
    for (const row of layout.shipping) bind({ ...row, path: path.join(layout.source, row.path) });
  }
  for (const cell of profile.cells) bind(cell.inheritedCell);
  for (const filename of binding.unusedSlots) assert(!fs.existsSync(filename));
  assert.equal(hash(read(commandPath, 995)), receipt.commandSha256);
  checkTime();
  receipt.admittedUtc = new Date().toISOString(); receipt.remainingAtAdmission = grant.outerStarted + 1200000 - now();
  descriptors.push(fs.openSync(launch.stdout, 'wx', 0o600)); descriptors.push(fs.openSync(launch.stderr, 'wx', 0o600));
  fs.writeFileSync(launch.activationGrantPath, grantBytes, { flag: 'wx', mode: 0o600 });
  assert.equal(hash(read(launch.activationGrantPath, 667)), receipt.grantSha256);
  checkTime();
  receipt.status = 'RUNNING'; receipt.coordinatorLaunched = true;
  child = spawn('/bin/zsh', ['-f', commandPath], { cwd: '/Users/kjopek/Workspace/safe-bash', stdio: ['ignore', 'pipe', 'pipe'] });
  retained.push(child); receipt.coordinator.pid = child.pid;
  await new Promise(resolve => {
    const finish = () => { receipt.coordinator.retired = receipt.coordinator.exit && receipt.coordinator.close && receipt.coordinator.stdoutEOF && receipt.coordinator.stderrEOF; if (receipt.coordinator.retired || stopped) resolve(); };
    const enroll = body => { try { body(); } catch (reason) { remember(reason, 'outer-enrollment'); signal('SIGTERM'); } };
    enroll(() => child.once('exit', (code, reason) => { receipt.coordinator.exit = true; receipt.coordinator.code = code; receipt.coordinator.signal = reason; finish(); }));
    enroll(() => child.once('close', () => { receipt.coordinator.close = true; finish(); }));
    enroll(() => child.on('error', reason => { remember(reason, 'outer-child-error'); }));
    for (const [index, channel] of ['stdout', 'stderr'].entries()) {
      enroll(() => child[channel].on('data', bytes => { if (stopped) return; try { assert(Buffer.isBuffer(bytes)); assert(bytes.length <= 524288 - receipt.captured[channel], 'outer prewrite capture cap'); receipt.captured[channel] += bytes.length; let offset = 0; while (offset < bytes.length) { const written = fs.writeSync(descriptors[index], bytes, offset, bytes.length - offset); assert(written > 0); offset += written; } } catch (reason) { remember(reason, `outer-${channel}-capture`); signal('SIGTERM'); } }));
      enroll(() => child[channel].once('end', () => { receipt.coordinator[channel + 'EOF'] = true; finish(); }));
      enroll(() => child[channel].on('error', reason => remember(reason, `outer-${channel}-error`)));
    }
    const remaining = Math.max(0, grant.outerStarted + 1200000 - 180000 - now());
    timers.push(setTimeout(() => { remember('outer work cutoff preserves publication', 'deadline'); signal('SIGTERM'); }, remaining));
    timers.push(setTimeout(() => signal('SIGKILL'), remaining + 2000));
    timers.push(setTimeout(() => { if (!receipt.coordinator.retired) { stopped = true; remember('UNKNOWN coordinator retirement', 'deadline'); finish(); } }, remaining + 3000));
  });
  receipt.status = receipt.coordinator.retired ? (receipt.coordinator.code === 0 && !failure.present ? 'COORDINATOR_EXIT_ZERO' : 'HARD_STOP') : 'UNKNOWN';
} catch (reason) { remember(reason, receipt.coordinatorLaunched ? 'outer-execution' : 'admission-refusal'); receipt.status = receipt.coordinatorLaunched ? 'HARD_STOP' : 'REFUSED'; if (child && !receipt.coordinator.retired) signal('SIGTERM'); }
finally {
  for (const timer of timers) { try { clearTimeout(timer); } catch (reason) { remember(reason, 'timer-cleanup'); } }
  for (const descriptor of descriptors) { try { fs.closeSync(descriptor); } catch (reason) { remember(reason, 'outer-capture-close'); } }
}
if (profile) {
  try { for (const row of profile.assets) bind(row); for (const row of profile.tools) bind(row); bind(profile.archive); receipt.sourcePostguard = true; } catch (reason) { remember(reason, 'source-postguard'); receipt.status = 'HARD_STOP'; }
  const finalPath = path.join(profile.root, 'FINAL.json');
  if (fs.existsSync(finalPath)) { try { receipt.innerFinal = JSON.parse(read(finalPath, 1048576)); } catch (reason) { remember(reason, 'inner-final-admission'); } }
  const journalPath = path.join(profile.root, 'EMERGENCY.jsonl');
  if (fs.existsSync(journalPath)) { try { receipt.innerJournal = read(journalPath, 1048576).toString('utf8').trimEnd().split('\n').filter(Boolean).map(JSON.parse); } catch (reason) { remember(reason, 'inner-journal-admission'); } }
}
receipt.finishedUtc = new Date().toISOString(); receipt.finishedMonotonic = now(); receipt.remainingIncludingPublication = Math.max(0, 267531292 + 1200000 - now()); receipt.actualCoordinatorRetirementOnly = true;
receipt.unknownReferencesRetained = child ? !receipt.coordinator.retired : false;
const output = Buffer.from(JSON.stringify(receipt, null, 2) + '\n'); assert(output.length <= 1048576);
fs.writeFileSync(path.join(directory, 'ACTUAL-RECEIPT.json'), output, { flag: 'wx', mode: 0o600 });
console.log(output.toString('utf8'));
if (receipt.coordinator.retired) retained.length = 0;
process.exitCode = receipt.status === 'COORDINATOR_EXIT_ZERO' ? 0 : 1;
