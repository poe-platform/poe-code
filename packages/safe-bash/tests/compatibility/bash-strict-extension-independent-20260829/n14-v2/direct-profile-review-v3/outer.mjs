import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const stdout = fs.openSync(path.join(root, 'capture/runtime.stdout.raw'), 'wx');
const stderr = fs.openSync(path.join(root, 'capture/runtime.stderr.raw'), 'wx');
const events = fs.openSync(path.join(root, 'capture/runtime.events.jsonl'), 'wx');
const record = {owner: process.pid, ownerEnteredAt: Date.now(), exit: false, close: false, signals: []};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const event = value => fs.writeSync(events, JSON.stringify({...value, at: Date.now()}) + '\n');
let timer;
let heartbeat;
let child;
event({event: 'outer-entered', pid: process.pid});
process.on('exit', code => {
  event({event: 'outer-exit', pid: process.pid, code});
  fs.fsyncSync(events);
  fs.closeSync(events);
});
try {
  const stat = fs.lstatSync(path.join(root, 'PRESEAL.json'));
  if (!stat.isFile() || stat.size > 2097152) throw Error('PRESEAL_TYPE_SIZE');
  const bytes = fs.readFileSync(path.join(root, 'PRESEAL.json'));
  if (hash(bytes) !== process.argv[2]) throw Error('PRESEAL_HASH');
  const seal = JSON.parse(bytes);
  if (Date.now() >= seal.deadline) throw Error('PHASE_DEADLINE');
  const source = fs.readFileSync(path.join(root, 'review.mjs'));
  if (source.length !== seal.executor.bytes || hash(source) !== seal.executor.sha256) throw Error('EXECUTOR_HASH');
  await new Promise(resolve => {
    record.childAcquisitionAt = Date.now();
    child = spawn(seal.node.path, [path.join(root, 'review.mjs'), hash(bytes)], {
      cwd: seal.repo,
      env: {PATH: '/usr/bin:/bin', HOME: seal.work, TMPDIR: seal.work, LC_ALL: 'C', LANG: 'C', TZ: 'UTC'},
      stdio: ['ignore', stdout, stderr],
      detached: false,
    });
    record.child = child.pid;
    child.on('error', reason => { record.error = String(reason); event({event: 'child-error', reasonPresent: true, reason: String(reason)}); });
    child.on('spawn', () => { record.childSpawnAt = Date.now(); event({event: 'child-spawn', pid: child.pid}); });
    child.on('exit', (status, signal) => { record.exit = true; record.childExitAt = Date.now(); record.status = status; record.signal = signal; });
    child.on('close', () => { record.close = true; record.childCloseAt = Date.now(); clearTimeout(timer); clearInterval(heartbeat); resolve(); });
    const stop = reason => {
      record.stop = reason;
      if (!record.signals.length) {
        record.signals.push('SIGTERM');
        child.kill('SIGTERM');
        timer = setTimeout(() => { record.signals.push('SIGKILL'); child.kill('SIGKILL'); }, 2000);
      }
    };
    timer = setTimeout(() => stop('RUNTIME_DEADLINE'), Math.min(90000, seal.deadline - Date.now()));
    heartbeat = setInterval(() => {
      if (fs.fstatSync(stdout).size + fs.fstatSync(stderr).size > 4194304) stop('CAPTURE_CEILING');
    }, 100);
  });
  fs.fsyncSync(stdout);
  fs.fsyncSync(stderr);
  record.stdoutBytes = fs.fstatSync(stdout).size;
  record.stderrBytes = fs.fstatSync(stderr).size;
  if (record.status !== 0 || record.signal || record.error || record.stop) process.exitCode = 1;
} catch (reason) {
  record.primaryPresent = true;
  record.primary = String(reason);
  event({event: 'outer-failure', reasonPresent: true, reason: String(reason)});
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  clearInterval(heartbeat);
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  record.finalizingAt = Date.now();
  event({event: 'outer-finalizing', record});
  fs.writeFileSync(path.join(root, 'RUNTIME-OWNER.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(record));
}
